const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const AppError = require('../../../shared/errors/AppError');

const normalizeTime = (value) => {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new AppError('Duty time must be HH:mm', 400);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new AppError('Invalid duty time', 400);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const resolveType = (dutyStart, dutyEnd, type) => {
  if (type && type !== 'custom') {
    if (dutyEnd <= dutyStart) return 'night';
    return type;
  }
  if (dutyEnd <= dutyStart) return 'night';
  return type || 'general';
};

const listShifts = async ({ activeOnly = false } = {}) => {
  const filter = activeOnly ? { active: true } : {};
  return Shift.find(filter).sort({ name: 1 }).lean();
};

const createShift = async (payload) => {
  const dutyStart = normalizeTime(payload.dutyStart);
  const dutyEnd = normalizeTime(payload.dutyEnd);
  const workingDays = Array.isArray(payload.workingDays)
    ? payload.workingDays.map(Number).filter((d) => d >= 0 && d <= 6)
    : [1, 2, 3, 4, 5, 6];

  return Shift.create({
    name: String(payload.name || '').trim(),
    description: String(payload.description || '').trim(),
    type: resolveType(dutyStart, dutyEnd, payload.type),
    dutyStart,
    dutyEnd,
    workingDays,
    active: payload.active !== false,
  });
};

const updateShift = async (id, payload) => {
  const current = await Shift.findById(id);
  if (!current) throw new AppError('Shift not found', 404);

  if (payload.name != null) current.name = String(payload.name).trim();
  if (payload.description != null) current.description = String(payload.description).trim();
  if (payload.dutyStart != null) current.dutyStart = normalizeTime(payload.dutyStart);
  if (payload.dutyEnd != null) current.dutyEnd = normalizeTime(payload.dutyEnd);
  if (payload.workingDays != null) {
    current.workingDays = payload.workingDays.map(Number).filter((d) => d >= 0 && d <= 6);
  }
  if (payload.active != null) current.active = Boolean(payload.active);
  current.type = resolveType(current.dutyStart, current.dutyEnd, payload.type || current.type);

  await current.save();
  return current;
};

const assignShift = async (employeeId, shiftId) => {
  const shift = await Shift.findById(shiftId);
  if (!shift || !shift.active) throw new AppError('Active shift required', 400);

  const employee = await Employee.findOne({ _id: employeeId, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);
  if (employee.status !== 'active') {
    throw new AppError('Only active employees can be assigned a shift', 400);
  }

  const today = require('../utils/time').toLocalDateString(
    new Date(),
    (await require('./settings.service').getSettings()).timezone
  );

  // Close previous duty window without rewriting past
  if (employee.dutyHistory?.length) {
    const last = employee.dutyHistory[employee.dutyHistory.length - 1];
    if (!last.toDate) last.toDate = today;
  }

  employee.shift = shift._id;
  employee.dutyStart = shift.dutyStart;
  employee.dutyEnd = shift.dutyEnd;
  employee.dutyHistory.push({
    fromDate: today,
    toDate: null,
    start: shift.dutyStart,
    end: shift.dutyEnd,
    shift: shift._id,
  });

  await employee.save();
  return employee.populate(['department', 'shift']);
};

const ensureDefaultShift = async () => {
  const existing = await Shift.findOne({ name: 'General Day' });
  if (existing) return existing;
  return Shift.create({
    name: 'General Day',
    description: 'Default 9:00 AM – 5:00 PM, Monday–Saturday',
    type: 'general',
    dutyStart: '09:00',
    dutyEnd: '17:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    active: true,
  });
};

module.exports = {
  listShifts,
  createShift,
  updateShift,
  assignShift,
  ensureDefaultShift,
  normalizeTime,
};
