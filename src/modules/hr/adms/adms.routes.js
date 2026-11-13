/**
 * ZKTeco ADMS / iClock push protocol (uFace800 Plus).
 * Device polls and POSTs attendance to /iclock/* on this server.
 */
const express = require('express');
const Device = require('../models/Device');
const Punch = require('../models/Punch');
const { insertPunch } = require('../services/punch.service');
const { processPendingPunches } = require('../services/attendanceEngine');
const config = require('../../../config');

const router = express.Router();

const stampCache = new Map(); // SN -> last ATTLOG stamp string
const pendingCmds = new Map(); // SN -> [cmd strings]
let cmdSeq = 1;

const queueCommand = (sn, command) => {
  const key = String(sn || '').toUpperCase();
  if (!key) return;
  const list = pendingCmds.get(key) || [];
  list.push(command);
  pendingCmds.set(key, list);
};

const pad = (n) => String(n).padStart(2, '0');
const ymdLocal = (d = new Date()) => {
  // Device clock is Asia/Karachi (+05:00)
  const local = new Date(d.getTime() + 5 * 60 * 60 * 1000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
};

/** Ask device to re-push attendance (today + last ~14 days). */
const requestAttlogResync = (sn) => {
  const key = String(sn || '').toUpperCase();
  stampCache.set(key, 'None');
  const end = ymdLocal();
  const start14 = ymdLocal(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
  // firmware variants accept DATA QUERY ATTLOG
  queueCommand(key, `DATA QUERY ATTLOG StartTime=${end} 00:00:00 EndTime=${end} 23:59:59`);
  queueCommand(
    key,
    `DATA QUERY ATTLOG StartTime=${start14} 00:00:00 EndTime=${end} 23:59:59`
  );
};

const mapDirection = (status) => {
  const s = Number(status);
  if (s === 0 || s === 4) return 'IN';
  if (s === 1 || s === 5) return 'OUT';
  return null;
};

const mapVerify = (v) => {
  const n = Number(v);
  if (n === 1) return 'fingerprint';
  if (n === 15 || n === 25) return 'face';
  if (n === 4 || n === 3) return 'card';
  if (n === 0 || n === 2) return 'password';
  return 'unknown';
};

const FAKE_ADMS_SNS = new Set(['test', 'check', 'unknown', '']);

const ensureDevice = async (sn, req) => {
  const code = String(sn || '').trim().toLowerCase();
  // Ignore probe / health-check serials so they never clutter Gate & Devices
  if (!code || FAKE_ADMS_SNS.has(code)) {
    return null;
  }
  let device = await Device.findOne({ code });
  if (!device) {
    device = await Device.create({
      code,
      name: `uFace800 · ${String(sn).toUpperCase()}`,
      ipAddress: req.ip?.replace('::ffff:', '') || '',
      tcpPort: 4370,
      location: 'ADMS push',
      active: true,
      lastStatus: 'adms_online',
    });
  } else {
    device.lastStatus = 'adms_online';
    device.location = 'ADMS push';
    device.lastSuccessfulPullAt = new Date();
    device.lastError = '';
    const ip = req.ip?.replace('::ffff:', '');
    if (ip && ip !== '127.0.0.1') device.ipAddress = ip;
    await device.save();
  }
  return device;
};

const optionsReply = (sn) => {
  // Keep stamp None so device continues pushing (realtime + catch-up)
  const stamp = 'None';
  stampCache.set(String(sn).toUpperCase(), stamp);
  requestAttlogResync(sn);
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${stamp}`,
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=None',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;14:00',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog AttPhoto EnrollUser EnrollFP EnrollFace',
    'Realtime=1',
    'Encrypt=None',
    'ServerVer=2.2.14',
    'PushVersion=2.2.14',
  ].join('\n');
};

const handleCdataGet = async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || 'UNKNOWN');
  const ip = req.ip?.replace('::ffff:', '') || '';
  console.log(`[adms] GET cdata SN=${sn} ip=${ip} q=${JSON.stringify(req.query)}`);
  try {
    await ensureDevice(sn, req);
  } catch (err) {
    console.error('[adms] ensureDevice', err.message);
  }
  res.set('Content-Type', 'text/plain');
  if (req.query.options != null) {
    return res.status(200).send(optionsReply(sn));
  }
  return res.status(200).send('OK');
};

const ingestAttlog = async (device, bodyText) => {
  const lines = String(bodyText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let created = 0;
  let skipped = 0;
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const pin = String(parts[0] || '').trim();
    const timeStr = String(parts[1] || '').trim(); // YYYY-MM-DD HH:mm:ss (device local)
    const status = parts[2];
    const verify = parts[3];
    if (!pin || !timeStr) {
      skipped += 1;
      continue;
    }

    const eventTimeLocal = timeStr.replace(' ', 'T');
    const eventTimeUtc = new Date(
      eventTimeLocal.includes('+') || eventTimeLocal.endsWith('Z')
        ? eventTimeLocal
        : `${eventTimeLocal}+05:00`
    );

    try {
      let direction = mapDirection(status);
      if (!direction) {
        const last = await Punch.findOne({
          deviceUserPin: pin,
          eventTimeUtc: { $lt: eventTimeUtc },
        })
          .sort({ eventTimeUtc: -1 })
          .select('direction')
          .lean();
        direction = !last || last.direction === 'OUT' ? 'IN' : 'OUT';
      }
      const result = await insertPunch({
        deviceId: device._id,
        deviceUserPin: pin,
        eventTimeUtc,
        direction,
        source: 'agent',
        verifyMode: mapVerify(verify),
        deviceClockString: timeStr,
      });
      if (result.created) created += 1;
      else skipped += 1;
      stampCache.set(device.code, timeStr);
    } catch (err) {
      skipped += 1;
      console.error('[adms] attlog line failed', pin, err.message);
    }
  }

  if (created > 0) {
    await processPendingPunches({ limit: Math.max(50, created * 2) });
  }
  return { created, skipped, lines: lines.length };
};

const handleCdataPost = async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || 'UNKNOWN');
  const table = String(req.query.table || '').toUpperCase();
  res.set('Content-Type', 'text/plain');

  let device;
  try {
    device = await ensureDevice(sn, req);
  } catch (err) {
    console.error('[adms] ensureDevice', err.message);
    return res.status(200).send('OK');
  }

  const bodyText =
    typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : '';

  if (table === 'ATTLOG') {
    if (!device) {
      return res.status(200).send('OK');
    }
    const summary = await ingestAttlog(device, bodyText);
    console.log(
      `[adms] ATTLOG SN=${sn} lines=${summary.lines} created=${summary.created} skipped=${summary.skipped}`
    );
    if (req.query.Stamp) stampCache.set(device.code, String(req.query.Stamp));
  } else if (bodyText) {
    console.log(`[adms] POST table=${table || 'unknown'} SN=${sn} bytes=${bodyText.length}`);
  }

  return res.status(200).send('OK');
};

const handleGetRequest = async (req, res) => {
  const sn = String(req.query.SN || req.query.sn || '');
  const ip = req.ip?.replace('::ffff:', '') || '';
  // heartbeat — log occasionally would spam; keep light
  if (sn) {
    try {
      await ensureDevice(sn, req);
    } catch {
      /* ignore */
    }
  }
  res.set('Content-Type', 'text/plain');
  const key = String(sn || '').toUpperCase();
  const queue = pendingCmds.get(key) || [];
  if (queue.length) {
    const command = queue.shift();
    pendingCmds.set(key, queue);
    const id = cmdSeq++;
    console.log(`[adms] getrequest SN=${sn} ip=${ip} CMD=${command}`);
    return res.status(200).send(`C:${id}:${command}`);
  }
  return res.status(200).send('OK');
};

const handlePing = (_req, res) => {
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

const handleDeviceCmd = (_req, res) => {
  res.set('Content-Type', 'text/plain');
  return res.status(200).send('OK');
};

/** Browser / ops check — device itself uses cdata/getrequest. */
router.get(['/health', '/status'], async (_req, res) => {
  const devices = await Device.find({
    location: 'ADMS push',
    code: { $nin: ['test', 'check'] },
  })
    .sort({ lastSuccessfulPullAt: -1 })
    .limit(20)
    .lean();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = await Punch.countDocuments({
    source: 'agent',
    eventTimeUtc: { $gte: todayStart },
  });
  res.json({
    ok: true,
    mode: 'ADMS / iClock',
    publicUrl: config.admsPublicUrl || null,
    listenPort: config.port,
    extraPorts: config.admsExtraPorts,
    endpoints: {
      cdata: '/iclock/cdata',
      getrequest: '/iclock/getrequest',
      ping: '/iclock/ping',
    },
    deviceHint: {
      serverAddress: config.admsPublicUrl
        ? config.admsPublicUrl.replace(/^https?:\/\//, '').split(':')[0].split('/')[0]
        : 'YOUR_VPS_IP_OR_DOMAIN',
      serverPort: config.admsPublicUrl?.match(/:(\d+)/)?.[1] || '8088',
      protocol: 'HTTP (not HTTPS)',
      pathNote: 'Device auto-uses /iclock — do not type /iclock in server field',
    },
    admsDevices: devices.map((d) => ({
      code: d.code,
      name: d.name,
      sn: d.code,
      lastStatus: d.lastStatus,
      lastSeen: d.lastSuccessfulPullAt,
      lastError: d.lastError,
    })),
    punchesTodayApprox: today,
  });
});

// With and without .aspx (firmware varies)
router.get(['/cdata', '/cdata.aspx'], handleCdataGet);
router.post(['/cdata', '/cdata.aspx'], handleCdataPost);
router.get(['/getrequest', '/getrequest.aspx'], handleGetRequest);
router.post(['/getrequest', '/getrequest.aspx'], handleGetRequest);
router.get(['/ping', '/ping.aspx'], handlePing);
router.get(['/devicecmd', '/devicecmd.aspx'], handleDeviceCmd);
router.post(['/devicecmd', '/devicecmd.aspx'], handleDeviceCmd);

// Catch unknown ADMS paths so device doesn't drop the session
router.all('*', (req, res) => {
  console.log(`[adms] catch-all ${req.method} ${req.originalUrl || req.url}`);
  res.set('Content-Type', 'text/plain');
  if (String(req.query.options || '') !== '') {
    return res.status(200).send(optionsReply(String(req.query.SN || req.query.sn || 'UNKNOWN')));
  }
  return res.status(200).send('OK');
});

module.exports = router;
module.exports.requestAttlogResync = requestAttlogResync;
module.exports.queueCommand = queueCommand;
