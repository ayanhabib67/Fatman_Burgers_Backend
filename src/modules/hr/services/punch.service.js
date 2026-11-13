const Punch = require('../models/Punch');
const Employee = require('../models/Employee');
const Device = require('../models/Device');
const AppError = require('../../../shared/errors/AppError');
const { getSettings } = require('./settings.service');
const { toLocalDateString, offsetMsFor } = require('../utils/time');

const buildDedupeKey = ({ deviceId, deviceUserPin, eventTimeUtc }) =>
  `${deviceId || 'manual'}|${deviceUserPin}|${new Date(eventTimeUtc).toISOString()}`;

const findEmployeeByZkPin = async (pin) =>
  Employee.findOne({
    zkUserPin: String(pin).trim(),
    deletedAt: null,
    status: 'active',
  });

/**
 * Idempotent insert used by future agent and manual entry.
 */
const insertPunch = async (payload) => {
  let employee = null;
  if (payload.employeeId) {
    employee = await Employee.findOne({
      _id: payload.employeeId,
      deletedAt: null,
    });
  }

  const deviceUserPin = String(
    payload.deviceUserPin || payload.zkUserPin || employee?.zkUserPin || ''
  ).trim();
  if (!deviceUserPin) throw new AppError('Device user PIN is required', 400);
  if (!payload.eventTimeUtc && !payload.eventTimeLocal) {
    throw new AppError('eventTimeUtc or eventTimeLocal is required', 400);
  }
  if (!['IN', 'OUT'].includes(payload.direction)) {
    throw new AppError('direction must be IN or OUT', 400);
  }

  const settings = await getSettings();
  let eventTimeUtc;
  if (payload.eventTimeUtc) {
    eventTimeUtc = new Date(payload.eventTimeUtc);
  } else {
    // interpret local wall time in configured timezone as UTC instant
    const local = String(payload.eventTimeLocal).replace('T', ' ').trim();
    const iso = local.includes('Z') ? local : `${local.replace(' ', 'T')}+05:00`;
    eventTimeUtc = new Date(iso);
  }
  if (Number.isNaN(eventTimeUtc.getTime())) throw new AppError('Invalid event time', 400);

  let device = null;
  if (payload.deviceId) {
    device = await Device.findById(payload.deviceId);
    if (!device) throw new AppError('Device not found', 404);
  }

  const dedupeKey =
    payload.dedupeKey ||
    buildDedupeKey({
      deviceId: device?._id || 'manual',
      deviceUserPin,
      eventTimeUtc,
    });

  const existing = await Punch.findOne({ dedupeKey }).lean();
  if (existing) {
    return { punch: existing, created: false };
  }

  if (!employee) {
    employee = await findEmployeeByZkPin(deviceUserPin);
  }

  const ingestStatus = employee ? 'pending' : 'unmapped';

  const punch = await Punch.create({
    dedupeKey,
    device: device?._id || null,
    deviceUserPin,
    deviceUserName: String(payload.deviceUserName || employee?.displayName || ''),
    eventTimeUtc,
    deviceClockString: String(payload.deviceClockString || payload.eventTimeLocal || ''),
    direction: payload.direction,
    verifyMode: payload.verifyMode || (payload.source === 'manual' ? 'manual' : 'unknown'),
    employee: employee?._id || null,
    ingestStatus,
    source: payload.source || 'manual',
    workDateHint: payload.workDateHint || toLocalDateString(eventTimeUtc, settings.timezone),
  });

  if (device && (!device.watermark || eventTimeUtc > device.watermark)) {
    device.watermark = eventTimeUtc;
    await device.save();
  }

  return { punch: punch.toObject(), created: true };
};

/** When HR fixes ZK PIN, attach matching unmapped punches. */
const remapUnmappedForPin = async (zkUserPin, employeeId) => {
  const result = await Punch.updateMany(
    {
      deviceUserPin: String(zkUserPin).trim(),
      ingestStatus: 'unmapped',
      employee: null,
    },
    {
      $set: {
        employee: employeeId,
        ingestStatus: 'pending',
      },
    }
  );
  return result.modifiedCount || 0;
};

const listPunches = async ({
  status,
  pin,
  q,
  from,
  to,
  source,
  page = 1,
  limit = 100,
} = {}) => {
  const filter = {};
  if (status && status !== 'all') filter.ingestStatus = status;
  if (source && source !== 'all') filter.source = source;
  if (pin) filter.deviceUserPin = String(pin).trim();
  if (from || to) {
    filter.eventTimeUtc = {};
    if (from) filter.eventTimeUtc.$gte = new Date(from);
    if (to) filter.eventTimeUtc.$lte = new Date(to);
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const lim = Math.min(1000, Math.max(1, Number(limit) || 100));
  const skip = (pageNum - 1) * lim;

  let query = Punch.find(filter)
    .sort({ eventTimeUtc: -1 })
    .skip(skip)
    .limit(lim)
    .populate('employee', 'displayName employeeNumber zkUserPin')
    .populate('device', 'code name')
    .lean();

  let items = await query;
  if (q) {
    const rx = new RegExp(String(q).trim(), 'i');
    items = items.filter(
      (p) =>
        rx.test(p.deviceUserPin || '') ||
        rx.test(p.employee?.displayName || '') ||
        rx.test(p.employee?.employeeNumber || '') ||
        rx.test(p.device?.code || '') ||
        rx.test(p.device?.name || '')
    );
  }

  const total = await Punch.countDocuments(filter);
  return {
    items,
    page: pageNum,
    limit: lim,
    total,
    pages: Math.ceil(total / lim) || 1,
  };
};

module.exports = {
  insertPunch,
  remapUnmappedForPin,
  listPunches,
  buildDedupeKey,
  findEmployeeByZkPin,
};
