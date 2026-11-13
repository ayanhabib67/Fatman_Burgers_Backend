const LeaveRequest = require('../models/LeaveRequest');
const LeaveAudit = require('../models/LeaveAudit');
const Holiday = require('../models/Holiday');
const AttendanceDay = require('../models/AttendanceDay');
const Employee = require('../models/Employee');
const AppError = require('../../../shared/errors/AppError');
const { getSettings } = require('./settings.service');
const {
  toLocalDateString,
  isOnProbation,
  ymdCompare,
} = require('../utils/time');
const { dutyWindowForEmployee } = require('./attendanceEngine');

const pad = (n) => String(n).padStart(2, '0');
const isAdmin = (actor) => actor?.hrRole === 'admin';
const PENDING = ['pending_hod', 'pending_hr'];

const eachDate = (from, to) => {
  const out = [];
  let cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(
      `${cur.getUTCFullYear()}-${pad(cur.getUTCMonth() + 1)}-${pad(cur.getUTCDate())}`
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
};

const isWorkingDay = async (employee, ymd) => {
  const duty = dutyWindowForEmployee(employee, ymd);
  if (duty.offDay) return false;
  const hol = await Holiday.findOne({ date: ymd, active: true, portion: 'full' }).lean();
  return !hol;
};

const countWorkingDays = async (employee, from, to, halfDay) => {
  if (halfDay) {
    if (from !== to) throw new AppError('Half-day must be a single date', 400);
    if (!(await isWorkingDay(employee, from))) {
      throw new AppError('Half-day must be on a working day', 400);
    }
    return 0.5;
  }
  const dates = eachDate(from, to);
  let days = 0;
  for (const d of dates) {
    if (await isWorkingDay(employee, d)) days += 1;
  }
  if (days <= 0) throw new AppError('Range contains no working day', 400);
  return days;
};

const writeLeaveAudit = async ({ leave, actor, action, comment }) => {
  await LeaveAudit.create({
    leaveRequest: leave._id,
    actor: actor?._id || null,
    actorName: actor?.displayName || '',
    actorRole: actor?.hrRole || '',
    action,
    comment: comment || '',
    employeeName: leave.employee?.displayName || '',
  });
};

const submitLeave = async (actor, payload) => {
  const settings = await getSettings();
  const today = toLocalDateString(new Date(), settings.timezone);

  let employeeId = payload.employeeId || String(actor._id);
  if (payload.employeeId && String(payload.employeeId) !== String(actor._id)) {
    if (!isAdmin(actor)) {
      throw new AppError('Cannot apply for another person', 403);
    }
  }

  const employee = await Employee.findOne({
    _id: employeeId,
    deletedAt: null,
    status: 'active',
  }).populate('shift');
  if (!employee) throw new AppError('Employee not found', 404);

  const leaveType = payload.leaveType;
  if (!LeaveRequest.LEAVE_TYPES.includes(leaveType)) {
    throw new AppError('Invalid leave type', 400);
  }
  const meta = LeaveRequest.metaForType(leaveType);
  if (!payload.reason?.trim()) throw new AppError('Reason is required', 400);
  if (!payload.fromDate || !payload.toDate) throw new AppError('Dates required', 400);
  if (ymdCompare(payload.fromDate, payload.toDate) > 0) {
    throw new AppError('fromDate after toDate', 400);
  }

  if (meta.deduct && isOnProbation(employee, today) && actor.hrRole === 'employee') {
    throw new AppError('Paid leave closed during probation', 400);
  }

  const halfDay = Boolean(payload.halfDay);
  const days = await countWorkingDays(
    employee,
    payload.fromDate,
    payload.toDate,
    halfDay
  );

  let halfDayTimes = { start: null, end: null };
  if (halfDay) {
    if (!['first', 'second'].includes(payload.halfDayPart)) {
      throw new AppError('halfDayPart must be first or second', 400);
    }
    const duty = dutyWindowForEmployee(employee, payload.fromDate);
    const [sh, sm] = duty.dutyStart.split(':').map(Number);
    const [eh, em] = duty.dutyEnd.split(':').map(Number);
    let startM = sh * 60 + sm;
    let endM = eh * 60 + em;
    if (endM <= startM) endM += 24 * 60;
    const mid = Math.floor((startM + endM) / 2);
    const toHm = (mins) =>
      `${pad(Math.floor((mins % (24 * 60)) / 60))}:${pad(mins % 60)}`;
    if (payload.halfDayPart === 'first') {
      halfDayTimes = { start: duty.dutyStart, end: toHm(mid) };
    } else {
      halfDayTimes = { start: toHm(mid), end: duty.dutyEnd };
    }
  }

  const leave = await LeaveRequest.create({
    employee: employee._id,
    appliedBy: actor._id,
    leaveType,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    reason: payload.reason.trim(),
    halfDay,
    halfDayPart: halfDay ? payload.halfDayPart : null,
    halfDayTimes,
    days,
    status: 'pending_hr',
  });

  await leave.populate([
    { path: 'employee', select: 'displayName employeeNumber department' },
    { path: 'appliedBy', select: 'displayName hrRole' },
  ]);

  await writeLeaveAudit({
    leave,
    actor,
    action: 'submitted',
    comment: payload.reason.trim(),
  });

  return leave;
};

const listLeaves = async (actor, query = {}) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.mine === 'true') filter.employee = actor._id;

  if (!isAdmin(actor)) {
    filter.employee = actor._id;
  } else if (query.queue === 'hr' || query.queue === 'pending') {
    filter.status = { $in: PENDING };
  }

  return LeaveRequest.find(filter)
    .populate('employee', 'displayName employeeNumber department')
    .populate('appliedBy', 'displayName hrRole')
    .sort({ createdAt: -1 })
    .limit(Number(query.limit) || 100)
    .lean();
};

const getLeave = async (id) => {
  const leave = await LeaveRequest.findById(id)
    .populate('employee', 'displayName employeeNumber department hrRole')
    .populate('appliedBy', 'displayName hrRole')
    .lean();
  if (!leave) throw new AppError('Leave not found', 404);
  const audit = await LeaveAudit.find({ leaveRequest: id }).sort({ createdAt: 1 }).lean();
  return { ...leave, audit };
};

const applyApprovalToAttendance = async (leave, employee) => {
  const meta = LeaveRequest.metaForType(leave.leaveType);
  const dates = leave.halfDay
    ? [leave.fromDate]
    : eachDate(leave.fromDate, leave.toDate);

  for (const workDate of dates) {
    if (!(await isWorkingDay(employee, workDate)) && !leave.halfDay) continue;
    await AttendanceDay.findOneAndUpdate(
      { employee: employee._id, workDate },
      {
        $set: {
          status: meta.attendanceStatus,
          source: 'leave',
          leaveApplied: true,
          unpaid: meta.unpaid,
          halfDayPart: leave.halfDay ? leave.halfDayPart : null,
          remark: `Approved leave: ${leave.leaveType}`,
          processingState: 'closed',
          currentlyInside: false,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  }
};

const decideLeave = async (actor, id, { action, comment } = {}) => {
  if (!isAdmin(actor)) throw new AppError('Admin only', 403);

  const leave = await LeaveRequest.findById(id).populate('employee');
  if (!leave) throw new AppError('Leave not found', 404);
  if (['approved', 'rejected'].includes(leave.status)) {
    throw new AppError('Leave already closed', 400);
  }

  const normalized =
    action === 'approve' || action === 'hr_approve' || action === 'override_approve'
      ? 'approve'
      : action === 'reject' || action === 'hod_reject' || action === 'hr_reject'
        ? 'reject'
        : action;

  if (normalized === 'reject') {
    if (!comment?.trim()) throw new AppError('Reject comment required', 400);
    leave.status = 'rejected';
    await leave.save();
    await writeLeaveAudit({ leave, actor, action: 'hr_reject', comment });
    return leave;
  }

  if (normalized === 'approve') {
    const meta = LeaveRequest.metaForType(leave.leaveType);
    const employee = await Employee.findById(leave.employee._id || leave.employee);
    if (!employee) throw new AppError('Employee missing', 404);

    if (meta.deduct && !leave.deducted) {
      if (Number(employee.leaveRemaining) < Number(leave.days)) {
        throw new AppError(
          `Insufficient leave balance. Remaining: ${employee.leaveRemaining}`,
          400
        );
      }
      employee.leaveRemaining = Number(employee.leaveRemaining) - Number(leave.days);
      await employee.save();
      leave.deducted = true;
    }

    leave.status = 'approved';
    await leave.save();
    await applyApprovalToAttendance(leave, employee);
    await writeLeaveAudit({
      leave,
      actor,
      action: 'hr_approve',
      comment: comment || 'Approved',
    });
    return leave;
  }

  throw new AppError('Unknown action', 400);
};

const updateBalances = async (actor, employeeId, { leaveEntitlement, leaveRemaining }) => {
  if (!isAdmin(actor)) throw new AppError('Admin only', 403);
  const employee = await Employee.findOne({ _id: employeeId, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);
  if (leaveEntitlement != null) employee.leaveEntitlement = Number(leaveEntitlement);
  if (leaveRemaining != null) employee.leaveRemaining = Number(leaveRemaining);
  if (employee.leaveRemaining > employee.leaveEntitlement) {
    throw new AppError('Remaining cannot exceed entitlement', 400);
  }
  await employee.save();
  return employee;
};

const listBalances = async (actor) => {
  const filter = { deletedAt: null, status: 'active' };
  if (!isAdmin(actor)) {
    filter._id = actor._id;
  }
  return Employee.find(filter)
    .select('displayName employeeNumber department leaveEntitlement leaveRemaining joiningDate probationEndedOn')
    .populate('department', 'name')
    .sort({ displayName: 1 })
    .lean();
};

module.exports = {
  submitLeave,
  listLeaves,
  getLeave,
  decideLeave,
  updateBalances,
  listBalances,
  countWorkingDays,
  writeLeaveAudit,
};
