const Correction = require('../models/Correction');
const AttendanceDay = require('../models/AttendanceDay');
const AttendanceMovement = require('../models/AttendanceMovement');
const Employee = require('../models/Employee');
const AppError = require('../../../shared/errors/AppError');
const { rebuildDay } = require('./attendanceEngine');

const createCorrection = async (actor, payload) => {
  let employeeId = payload.employeeId || String(actor._id);
  if (
    payload.employeeId &&
    String(payload.employeeId) !== String(actor._id) &&
    actor.hrRole !== 'admin'
  ) {
    throw new AppError('Only admin can correct for others', 403);
  }
  if (!payload.workDate) throw new AppError('workDate required', 400);
  if (!payload.type) throw new AppError('type required', 400);
  if (!payload.reason?.trim()) throw new AppError('reason required', 400);

  const employee = await Employee.findOne({ _id: employeeId, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);

  const day = await AttendanceDay.findOne({ employee: employeeId, workDate: payload.workDate }).lean();
  const movements = await AttendanceMovement.find({
    employee: employeeId,
    workDate: payload.workDate,
  }).lean();

  return Correction.create({
    employee: employeeId,
    requestedBy: actor._id,
    workDate: payload.workDate,
    type: payload.type,
    proposedTimeIn: payload.proposedTimeIn || null,
    proposedTimeOut: payload.proposedTimeOut || null,
    proposedStatus: payload.proposedStatus || null,
    proposedMovementType: payload.proposedMovementType || null,
    reason: payload.reason.trim(),
    attachmentUrl: payload.attachmentUrl || '',
    snapshot: { day, movements },
    status: 'pending',
  });
};

const listCorrections = async (actor, query = {}) => {
  const filter = {};
  if (query.status && query.status !== 'all') filter.status = query.status;
  if (actor.hrRole === 'employee') filter.employee = actor._id;
  return Correction.find(filter)
    .populate('employee', 'displayName employeeNumber')
    .populate('requestedBy', 'displayName')
    .populate('reviewedBy', 'displayName')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
};

const decideCorrection = async (actor, id, { action, reviewNote } = {}) => {
  if (actor.hrRole !== 'admin') {
    throw new AppError('Admin only', 403);
  }
  const row = await Correction.findById(id);
  if (!row) throw new AppError('Correction not found', 404);
  if (row.status !== 'pending') throw new AppError('Already decided', 400);

  if (action === 'reject') {
    row.status = 'rejected';
    row.reviewNote = reviewNote || '';
    row.reviewedBy = actor._id;
    row.reviewedAt = new Date();
    await row.save();
    return row;
  }

  if (action !== 'approve') throw new AppError('Unknown action', 400);

  const day =
    (await AttendanceDay.findOne({ employee: row.employee, workDate: row.workDate })) ||
    new AttendanceDay({ employee: row.employee, workDate: row.workDate });

  const changeLog = [];
  const track = (field, oldValue, newValue) => {
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      changeLog.push({ field, oldValue, newValue });
      day[field] = newValue;
    }
  };

  if (row.proposedTimeIn != null) track('timeIn', day.timeIn, row.proposedTimeIn);
  if (row.proposedTimeOut != null) track('timeOut', day.timeOut, row.proposedTimeOut);
  if (row.proposedStatus != null) track('status', day.status, row.proposedStatus);

  day.correctionApplied = true;
  day.source = day.source === 'device' ? 'hybrid' : day.source || 'correction';
  day.remark = [day.remark, `Correction: ${row.type}`].filter(Boolean).join(' · ');
  await day.save();

  if (row.type === 'movement_reclassify' && row.proposedMovementType) {
    await AttendanceMovement.updateMany(
      { employee: row.employee, workDate: row.workDate, manualOverride: { $ne: true } },
      {
        $set: {
          type: row.proposedMovementType,
          manualOverride: true,
          note: 'Reclassified by approved correction',
        },
      }
    );
  }

  // Reprocess punches but keep correction overlay
  await rebuildDay(row.employee, row.workDate);
  const after = await AttendanceDay.findOne({ employee: row.employee, workDate: row.workDate });
  if (after) {
    if (row.proposedTimeIn != null) after.timeIn = row.proposedTimeIn;
    if (row.proposedTimeOut != null) after.timeOut = row.proposedTimeOut;
    if (row.proposedStatus != null) after.status = row.proposedStatus;
    after.correctionApplied = true;
    await after.save();
  }

  row.status = 'approved';
  row.changeLog = changeLog;
  row.reviewNote = reviewNote || '';
  row.reviewedBy = actor._id;
  row.reviewedAt = new Date();
  await row.save();
  return row;
};

module.exports = {
  createCorrection,
  listCorrections,
  decideCorrection,
};
