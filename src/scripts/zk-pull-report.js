require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const ZKLib = require('node-zklib');
const { pullDevice } = require('../modules/hr/services/zkAgent.service');
const Device = require('../modules/hr/models/Device');
const Punch = require('../modules/hr/models/Punch');
const Employee = require('../modules/hr/models/Employee');

(async () => {
  await mongoose.connect(config.mongoUri);

  console.log('=== LIVE ZK PULL 6.38.0.152:4370 ===');
  let liveRows = [];
  const zk = new ZKLib('6.38.0.152', 4370, 20000, 4000);
  try {
    await zk.createSocket();
    console.log('connected via', zk.connectionType);
    console.log('info', await zk.getInfo());
    const logs = await zk.getAttendances();
    liveRows = Array.isArray(logs?.data) ? logs.data : [];
    console.log('live attendance count', liveRows.length);
    await zk.disconnect();
  } catch (e) {
    console.log('live pull FAILED:', e.message || e);
    try {
      await zk.disconnect();
    } catch {
      /* ignore */
    }
  }

  let device =
    (await Device.findOne({ ipAddress: '6.38.0.152' })) ||
    (await Device.findOne({ code: 'jym6245100353' }));
  if (!device) {
    device = await Device.create({
      code: 'uface-main',
      name: 'uFace800 Plus',
      ipAddress: '6.38.0.152',
      tcpPort: 4370,
      active: true,
    });
  } else {
    device.ipAddress = '6.38.0.152';
    device.tcpPort = 4370;
    device.active = true;
    await device.save();
  }

  console.log('\n=== AGENT pullDevice (full) ===');
  try {
    console.log(await pullDevice(device._id, { sinceWatermark: false }));
  } catch (e) {
    console.log('agent pull FAILED:', e.message || e);
  }

  const punches = await Punch.find({ source: 'agent' }).sort({ eventTimeUtc: -1 }).lean();
  const byPin = new Map();
  for (const p of punches) {
    const pin = p.deviceUserPin;
    if (!byPin.has(pin)) {
      byPin.set(pin, {
        pin,
        count: 0,
        first: p.eventTimeUtc,
        last: p.eventTimeUtc,
        dirs: { IN: 0, OUT: 0 },
        unmapped: false,
      });
    }
    const row = byPin.get(pin);
    row.count += 1;
    row.dirs[p.direction] = (row.dirs[p.direction] || 0) + 1;
    if (p.eventTimeUtc < row.first) row.first = p.eventTimeUtc;
    if (p.eventTimeUtc > row.last) row.last = p.eventTimeUtc;
    if (p.ingestStatus === 'unmapped') row.unmapped = true;
  }

  const pins = [...byPin.keys()];
  const emps = await Employee.find({
    zkUserPin: { $in: pins },
    deletedAt: null,
  })
    .select('displayName employeeNumber zkUserPin')
    .lean();
  const empByPin = new Map(emps.map((e) => [String(e.zkUserPin), e]));

  const rows = [...byPin.values()].sort((a, b) => b.count - a.count);
  console.log('\n=== WHOSE LOGS (by ZK PIN) ===');
  console.log('total punches', punches.length, '| unique PINs', rows.length);
  for (const r of rows) {
    const emp = empByPin.get(String(r.pin));
    const name = emp ? `${emp.displayName} (${emp.employeeNumber})` : 'UNMAPPED';
    console.log(
      `PIN ${String(r.pin).padEnd(6)} | ${String(r.count).padStart(3)} logs | IN ${r.dirs.IN} OUT ${r.dirs.OUT} | ${name} | last ${new Date(r.last).toLocaleString()}`
    );
  }

  if (liveRows.length) {
    const livePins = new Map();
    for (const row of liveRows) {
      const pin = String(row.deviceUserId || row.userId || '').trim();
      if (!pin) continue;
      livePins.set(pin, (livePins.get(pin) || 0) + 1);
    }
    console.log('\n=== LIVE DEVICE PINS ===');
    [...livePins.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([pin, c]) => {
        const emp = empByPin.get(pin);
        console.log(`PIN ${pin} -> ${c} | ${emp ? emp.displayName : 'UNMAPPED'}`);
      });
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
