const Device = require('../models/Device');
const Punch = require('../models/Punch');
const AppError = require('../../../shared/errors/AppError');

const listDevices = async () => Device.find().sort({ name: 1 }).lean();

const createDevice = async (payload) => {
  const code = String(payload.code || '').trim().toLowerCase();
  const name = String(payload.name || '').trim();
  if (!code || !name) throw new AppError('Code and name are required', 400);
  try {
    return await Device.create({
      code,
      name,
      ipAddress: String(payload.ipAddress || '').trim(),
      tcpPort: Number(payload.tcpPort ?? 4370),
      commKey: Number(payload.commKey ?? 0),
      location: String(payload.location || '').trim(),
      active: payload.active !== false,
    });
  } catch (err) {
    if (err.code === 11000) throw new AppError('Device code already exists', 409);
    throw err;
  }
};

const updateDevice = async (id, payload) => {
  const device = await Device.findById(id);
  if (!device) throw new AppError('Device not found', 404);
  for (const key of ['name', 'ipAddress', 'location', 'lastStatus', 'lastError']) {
    if (payload[key] !== undefined) device[key] = payload[key];
  }
  if (payload.tcpPort != null) device.tcpPort = Number(payload.tcpPort);
  if (payload.commKey != null) device.commKey = Number(payload.commKey);
  if (payload.active != null) device.active = Boolean(payload.active);
  if (payload.lastSuccessfulPullAt) device.lastSuccessfulPullAt = new Date(payload.lastSuccessfulPullAt);
  if (payload.watermark) device.watermark = new Date(payload.watermark);
  await device.save();
  return device;
};

const unmappedPunches = async ({ limit = 100 } = {}) =>
  Punch.find({ ingestStatus: 'unmapped' })
    .sort({ eventTimeUtc: -1 })
    .limit(limit)
    .populate('device')
    .lean();

module.exports = {
  listDevices,
  createDevice,
  updateDevice,
  unmappedPunches,
};
