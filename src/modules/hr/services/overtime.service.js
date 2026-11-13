const OvertimeSession = require('../models/OvertimeSession');
const Employee = require('../models/Employee');
const Holiday = require('../models/Holiday');
const AppError = require('../../../shared/errors/AppError');
const { getSettings } = require('./settings.service');
const {
  toLocalDateString,
  toLocalParts,
  attendanceMonthRange,
  attendanceMonthForDate,
} = require('../utils/time');
const { dutyWindowForEmployee } = require('./attendanceEngine');

const parseHm = (hm) => {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return h * 60 + m;
};

const startOvertime = async (actor, payload) => {
  if (actor.hrRole !== 'admin') {
    throw new AppError('Admin only', 403);
  }
  if (!payload.employeeId) throw new AppError('employeeId required', 400);
  if (!payload.task?.trim()) throw new AppError('task required', 400);
  if (!payload.startedAt) throw new AppError('startedAt required', 400);

  const employee = await Employee.findOne({
    _id: payload.employeeId,
    deletedAt: null,
    status: 'active',
  }).populate('shift');
  if (!employee) throw new AppError('Active employee required', 404);

  const running = await OvertimeSession.findOne({
    employee: employee._id,
    status: 'running',
  });
  if (running) throw new AppError('Employee already has a running overtime session', 409);

  const settings = await getSettings();
  const startedAt = new Date(payload.startedAt);
  const workDate =
    payload.workDate || toLocalDateString(startedAt, settings.timezone);

  const duty = dutyWindowForEmployee(employee, workDate);
  const holiday = await Holiday.findOne({ date: workDate, active: true }).lean();
  const isOff = duty.offDay || Boolean(holiday);
  const isNight = duty.dutyEnd <= duty.dutyStart;

  if (!isOff && !isNight) {
    const endM = parseHm(duty.dutyEnd);
    const hour = Math.floor(endM / 60) + 1;
    const min = endM % 60;
    const earliestLocal = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    const startParts = toLocalParts(startedAt, settings.timezone);
    const startHm = `${String(startParts.hour).padStart(2, '0')}:${String(startParts.minute).padStart(2, '0')}`;
    if (parseHm(startHm) < parseHm(earliestLocal)) {
      throw new AppError(
        `Earliest allowed start on a working day is ${earliestLocal} (duty end + 1 hour)`,
        400
      );
    }
  }

  return OvertimeSession.create({
    employee: employee._id,
    task: payload.task.trim(),
    startedAt,
    workDate,
    status: 'running',
    startedBy: actor._id,
  });
};

const endOvertime = async (actor, id, payload = {}) => {
  const session = await OvertimeSession.findById(id);
  if (!session) throw new AppError('Session not found', 404);
  if (session.status !== 'running') throw new AppError('Already ended', 400);

  const endedAt = payload.endedAt ? new Date(payload.endedAt) : new Date();
  if (endedAt <= session.startedAt) {
    throw new AppError('End time must be after start', 400);
  }
  const mins = Math.floor((endedAt - session.startedAt) / 60000);
  session.endedAt = endedAt;
  session.completeHours = Math.floor(mins / 60);
  session.status = 'ended';
  session.endedBy = actor._id;
  await session.save();
  return session;
};

const listOvertime = async (actor, query = {}) => {
  const settings = await getSettings();
  const cutoff = settings.attendanceCutoffDay || 26;
  let year = Number(query.year);
  let month = Number(query.month);
  if (!year || !month) {
    const cur = attendanceMonthForDate(new Date(), cutoff, settings.timezone);
    year = cur.year;
    month = cur.month;
  }
  const range = attendanceMonthRange(year, month, cutoff);
  const filter = { workDate: { $gte: range.start, $lte: range.end } };

  if (actor.hrRole !== 'admin') {
    filter.employee = actor._id;
  }
  if (query.employeeId) filter.employee = query.employeeId;
  if (query.q) {
    // resolved after populate in memory if needed — also search task
    filter.$or = [{ task: new RegExp(query.q, 'i') }];
  }

  const items = await OvertimeSession.find(filter)
    .populate('employee', 'displayName employeeNumber department')
    .populate('startedBy', 'displayName')
    .populate('endedBy', 'displayName')
    .sort({ startedAt: -1 })
    .lean();

  let filtered = items;
  if (query.q) {
    const rx = new RegExp(query.q, 'i');
    filtered = items.filter(
      (i) =>
        rx.test(i.task) ||
        rx.test(i.employee?.displayName || '') ||
        rx.test(i.employee?.employeeNumber || '')
    );
  }

  return { range, year, month, items: filtered };
};

const updateOvertime = async (actor, id, payload) => {
  if (actor.hrRole !== 'admin') {
    throw new AppError('Admin only', 403);
  }
  const session = await OvertimeSession.findById(id);
  if (!session) throw new AppError('Not found', 404);
  if (payload.task != null) session.task = String(payload.task).trim();
  if (payload.startedAt) session.startedAt = new Date(payload.startedAt);
  if (payload.endedAt) {
    session.endedAt = new Date(payload.endedAt);
    if (session.endedAt <= session.startedAt) {
      throw new AppError('End must be after start', 400);
    }
    const mins = Math.floor((session.endedAt - session.startedAt) / 60000);
    session.completeHours = Math.floor(mins / 60);
    session.status = 'ended';
  }
  await session.save();
  return session;
};

const deleteOvertime = async (actor, id) => {
  if (actor.hrRole !== 'admin') {
    throw new AppError('Admin only', 403);
  }
  await OvertimeSession.findByIdAndDelete(id);
  return { ok: true };
};

module.exports = {
  startOvertime,
  endOvertime,
  listOvertime,
  updateOvertime,
  deleteOvertime,
};
