/**
 * ZKTeco LAN agent (uFace800 Plus / standalone TCP 4370).
 * Uses node-zklib to pull attendance logs into HrPunch.
 */
const ZKLib = require('node-zklib');
const Device = require('../models/Device');
const Punch = require('../models/Punch');
const AppError = require('../../../shared/errors/AppError');
const { insertPunch } = require('./punch.service');
const { processPendingPunches } = require('./attendanceEngine');
const { getSettings } = require('./settings.service');
const { offsetMsFor } = require('../utils/time');

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_INPORT = 4000;

const connectDevice = async (device) => {
  if (!device?.ipAddress) throw new AppError('Device IP is required', 400);
  const port = Number(device.tcpPort || 4370);
  const zk = new ZKLib(device.ipAddress, port, DEFAULT_TIMEOUT_MS, DEFAULT_INPORT);
  await zk.createSocket();
  return zk;
};

/**
 * ZK packed time is device local wall-clock. node-zklib builds a JS Date from
 * Y/M/D H:M:S in the Node process local TZ. Rebuild with the HR timezone offset
 * so the UTC instant is correct even if the OS timezone differs.
 */
const zkRecordToUtc = (recordTime, timezone) => {
  const raw = new Date(recordTime);
  if (Number.isNaN(raw.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const y = raw.getFullYear();
  const m = raw.getMonth() + 1;
  const d = raw.getDate();
  const h = raw.getHours();
  const mi = raw.getMinutes();
  const s = raw.getSeconds();
  const offsetMs = offsetMsFor(timezone);
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  const oh = Math.floor(abs / 3600000);
  const om = Math.floor((abs % 3600000) / 60000);
  return new Date(
    `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${sign}${pad(oh)}:${pad(om)}`
  );
};

const pinFromRecord = (row) =>
  String(row.deviceUserId ?? row.userId ?? row.uid ?? '').trim();

/**
 * Face terminals often don't mark IN/OUT. Alternate from last punch for that PIN.
 */
const resolveDirection = async (deviceUserPin, eventTimeUtc, state) => {
  const s = Number(state);
  if (s === 0 || s === 4) return 'IN';
  if (s === 1 || s === 5) return 'OUT';

  const last = await Punch.findOne({
    deviceUserPin,
    eventTimeUtc: { $lt: eventTimeUtc },
  })
    .sort({ eventTimeUtc: -1 })
    .select('direction')
    .lean();

  if (!last) return 'IN';
  return last.direction === 'IN' ? 'OUT' : 'IN';
};

const mapVerifyMode = (row) => {
  const m = Number(row.verifyMode ?? row.verifytype ?? row.verifyType);
  if (m === 1) return 'fingerprint';
  if (m === 15 || m === 3) return 'face';
  if (m === 2 || m === 4) return 'card';
  if (m === 0) return 'password';
  return 'unknown';
};

const testConnection = async (deviceId) => {
  const device = await Device.findById(deviceId);
  if (!device) throw new AppError('Device not found', 404);

  let zk;
  try {
    zk = await connectDevice(device);
    const info = await zk.getInfo();
    device.lastStatus = 'online';
    device.lastError = '';
    await device.save();
    return {
      ok: true,
      connectionType: zk.connectionType,
      info,
      ip: device.ipAddress,
      port: device.tcpPort,
    };
  } catch (err) {
    device.lastStatus = 'error';
    device.lastError = err.message || String(err);
    await device.save();
    throw new AppError(
      `Cannot reach ${device.ipAddress}:${device.tcpPort} — ${err.message || err}`,
      502
    );
  } finally {
    if (zk) {
      try {
        await zk.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
};

const pullDevice = async (deviceId, { sinceWatermark = true } = {}) => {
  const device = await Device.findById(deviceId);
  if (!device) throw new AppError('Device not found', 404);
  if (!device.active) throw new AppError('Device is inactive', 400);

  const settings = await getSettings();
  let zk;
  const summary = {
    deviceId: String(device._id),
    code: device.code,
    fetched: 0,
    created: 0,
    skipped: 0,
    unmapped: 0,
    errors: 0,
  };

  try {
    zk = await connectDevice(device);
    const logs = await zk.getAttendances();
    const rows = Array.isArray(logs?.data) ? logs.data : Array.isArray(logs) ? logs : [];
    summary.fetched = rows.length;

    const watermark = sinceWatermark && device.watermark ? new Date(device.watermark) : null;
    let newest = device.watermark ? new Date(device.watermark) : null;

    // Sort oldest → newest so direction alternation is stable
    const sorted = [...rows].sort(
      (a, b) => new Date(a.recordTime || a.attTime) - new Date(b.recordTime || b.attTime)
    );

    for (const row of sorted) {
      const pin = pinFromRecord(row);
      const eventTimeUtc = zkRecordToUtc(row.recordTime || row.attTime, settings.timezone);
      if (!pin || !eventTimeUtc) {
        summary.skipped += 1;
        continue;
      }
      if (watermark && eventTimeUtc <= watermark) {
        summary.skipped += 1;
        continue;
      }

      try {
        const direction = await resolveDirection(pin, eventTimeUtc, row.state);
        const result = await insertPunch({
          deviceId: device._id,
          deviceUserPin: pin,
          eventTimeUtc,
          direction,
          source: 'agent',
          verifyMode: mapVerifyMode(row),
          deviceClockString: String(row.recordTime || row.attTime || ''),
        });
        if (result.created) {
          summary.created += 1;
          if (result.punch.ingestStatus === 'unmapped') summary.unmapped += 1;
        } else {
          summary.skipped += 1;
        }
        if (!newest || eventTimeUtc > newest) newest = eventTimeUtc;
      } catch (err) {
        summary.errors += 1;
        console.error('[zk-agent] punch insert failed', pin, err.message || err);
      }
    }

    device.lastSuccessfulPullAt = new Date();
    device.lastStatus = 'ok';
    device.lastError = '';
    if (newest) device.watermark = newest;
    await device.save();

    if (summary.created > 0) {
      await processPendingPunches({ limit: Math.max(100, summary.created * 2) });
    }

    return summary;
  } catch (err) {
    device.lastStatus = 'error';
    device.lastError = err.message || String(err);
    await device.save();
    throw new AppError(
      `Pull failed for ${device.ipAddress}:${device.tcpPort} — ${err.message || err}`,
      502
    );
  } finally {
    if (zk) {
      try {
        await zk.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
};

const pullAllActive = async () => {
  const devices = await Device.find({ active: true, ipAddress: { $ne: '' } }).lean();
  const results = [];
  for (const d of devices) {
    try {
      results.push({ ok: true, ...(await pullDevice(d._id)) });
    } catch (err) {
      results.push({
        ok: false,
        deviceId: String(d._id),
        code: d.code,
        error: err.message,
      });
    }
  }
  return results;
};

module.exports = {
  testConnection,
  pullDevice,
  pullAllActive,
  connectDevice,
};
