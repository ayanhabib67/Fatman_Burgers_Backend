const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const LeaveAudit = require('../models/LeaveAudit');
const AttendanceDay = require('../models/AttendanceDay');
const { getSettings } = require('./settings.service');
const {
  toLocalDateString,
  attendanceMonthForDate,
  attendanceMonthRange,
  isOnProbation,
} = require('../utils/time');

const isAdmin = (actor) => actor?.hrRole === 'admin';
const PENDING = ['pending_hod', 'pending_hr'];

const getDashboard = async (actor) => {
  const settings = await getSettings();
  const tz = settings.timezone || 'Asia/Karachi';
  const today = toLocalDateString(new Date(), tz);
  const month = attendanceMonthForDate(today, settings.attendanceCutoffDay, tz);
  const range = attendanceMonthRange(month.year, month.month, settings.attendanceCutoffDay);

  const me = await Employee.findById(actor._id)
    .populate('department')
    .populate('shift')
    .lean();

  const yesterday = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  })();

  const empFilter = { deletedAt: null, status: 'active' };
  const admin = isAdmin(actor);

  const activeCount = admin
    ? await Employee.countDocuments({ deletedAt: null, status: 'active' })
    : null;

  let inside = 0;
  let outside = 0;
  if (admin) {
    const emps = await Employee.find(empFilter).select('_id').lean();
    const ids = emps.map((e) => e._id);
    const days = await AttendanceDay.find({
      employee: { $in: ids },
      workDate: { $in: [today, yesterday] },
    }).lean();
    const byEmp = new Map();
    for (const day of days) {
      const key = String(day.employee);
      if (day.workDate === yesterday && day.currentlyInside) byEmp.set(key, day);
      else if (!byEmp.has(key) || day.workDate >= (byEmp.get(key).workDate || '')) {
        byEmp.set(key, day);
      }
    }
    for (const id of ids) {
      const day = byEmp.get(String(id));
      if (
        day?.currentlyInside ||
        (day?.processingState === 'open' && day?.timeIn && !day?.timeOut)
      ) {
        inside += 1;
      } else outside += 1;
    }
  }

  const pendingLeave = admin
    ? await LeaveRequest.countDocuments({ status: { $in: PENDING } })
    : 0;

  let todayCard = await AttendanceDay.findOne({
    employee: actor._id,
    workDate: today,
  }).lean();
  if (!todayCard?.timeIn) {
    const overnight = await AttendanceDay.findOne({
      employee: actor._id,
      workDate: yesterday,
      currentlyInside: true,
    }).lean();
    if (overnight) todayCard = overnight;
  }

  const myDays = await AttendanceDay.find({
    employee: actor._id,
    workDate: { $gte: range.start, $lte: range.end },
  }).lean();
  const monthSummary = {
    present: myDays.filter((d) => ['Present', 'Late', 'Early-departure'].includes(d.status)).length,
    late: myDays.filter((d) => d.status === 'Late').length,
    absent: myDays.filter((d) => d.status === 'Absent').length,
    leave: myDays.filter((d) =>
      ['Leave', 'Lieu', 'Official-leave'].includes(d.status)
    ).length,
  };

  let pendingApprovals = [];
  if (admin) {
    pendingApprovals = await LeaveRequest.find({ status: { $in: PENDING } })
      .populate('employee', 'displayName department')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
  }

  const myRequests = await LeaveRequest.find({ employee: actor._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const auditFilter = {};
  if (!admin) {
    const myLeaveIds = await LeaveRequest.find({ employee: actor._id }).distinct('_id');
    auditFilter.leaveRequest = { $in: myLeaveIds };
  }
  const activity = await LeaveAudit.find(auditFilter)
    .sort({ createdAt: -1 })
    .limit(12)
    .lean();

  const onProbation = isOnProbation(me, today);
  const leaveBalance = onProbation
    ? null
    : {
        remaining: me.leaveRemaining,
        entitlement: me.leaveEntitlement,
      };

  let lateWatch = [];
  if (admin) {
    const lateDays = await AttendanceDay.aggregate([
      {
        $match: {
          workDate: { $gte: range.start, $lte: range.end },
          status: 'Late',
        },
      },
      { $group: { _id: '$employee', count: { $sum: 1 } } },
      { $match: { count: { $gte: 3 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]);
    const ids = lateDays.map((x) => x._id);
    const people = await Employee.find({ _id: { $in: ids } })
      .populate('department', 'name')
      .select('displayName department')
      .lean();
    const byId = new Map(people.map((p) => [String(p._id), p]));
    lateWatch = lateDays.map((x) => ({
      employee: byId.get(String(x._id)),
      count: x.count,
    }));
  }

  return {
    header: {
      welcome: me.displayName,
      role: me.hrRole,
      department: me.department?.name || null,
      timezone: tz,
      serverTime: new Date().toISOString(),
    },
    kpis: {
      activeEmployees: activeCount,
      inside,
      outside,
      pendingHod: 0,
      pendingHr: pendingLeave,
      pendingOverride: 0,
    },
    todayCard,
    monthSummary,
    attendanceMonth: { ...month, ...range },
    pendingApprovals,
    myRequests,
    activity,
    leaveBalance,
    onProbation,
    lateWatch,
  };
};

module.exports = { getDashboard };
