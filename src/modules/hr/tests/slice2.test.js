require('dotenv').config();

const assert = require('assert');
const mongoose = require('mongoose');
const config = require('../../../config');
const { ensureDefaultShift } = require('../services/shift.service');
const { getSettings } = require('../services/settings.service');
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const Punch = require('../models/Punch');
const { insertPunch } = require('../services/punch.service');
const {
  rebuildDay,
  dedupePunches,
  pairSessions,
} = require('../services/attendanceEngine');

const run = async () => {
  await mongoose.connect(config.mongoUri);
  await getSettings();
  const shift = await ensureDefaultShift();
  let dept = await Department.findOne({ name: 'Ops Slice2' });
  if (!dept) dept = await Department.create({ name: 'Ops Slice2', active: true });

  const pin = `s2${Date.now().toString().slice(-7)}`;
  const emp = await Employee.create({
    employeeNumber: `FB-S2-${Date.now().toString().slice(-5)}`,
    firstName: 'Slice',
    lastName: 'Two',
    displayName: 'Slice Two',
    department: dept._id,
    hrRole: 'employee',
    joiningDate: '2026-01-01',
    status: 'active',
    zkUserPin: pin,
    shift: shift._id,
    dutyStart: '09:00',
    dutyEnd: '17:00',
    dutyHistory: [
      { fromDate: '2026-01-01', toDate: null, start: '09:00', end: '17:00', shift: shift._id },
    ],
    leaveEntitlement: 30,
    leaveRemaining: 30,
  });

  // Idempotent punch insert
  const t1 = '2026-08-10T09:10:00+05:00';
  const a = await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeUtc: t1,
    source: 'manual',
  });
  const b = await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeUtc: t1,
    source: 'manual',
  });
  assert.strictEqual(a.created, true);
  assert.strictEqual(b.created, false);

  // Unmapped punch
  const orphan = await insertPunch({
    deviceUserPin: 'no-such-pin-999',
    direction: 'IN',
    eventTimeUtc: '2026-08-10T09:20:00+05:00',
    source: 'manual',
  });
  assert.strictEqual(orphan.punch.ingestStatus, 'unmapped');

  // Dedupe 60s
  const cleaned = dedupePunches(
    [
      { eventTimeUtc: new Date('2026-08-10T09:00:00Z'), direction: 'IN' },
      { eventTimeUtc: new Date('2026-08-10T09:00:30Z'), direction: 'IN' },
      { eventTimeUtc: new Date('2026-08-10T09:02:00Z'), direction: 'OUT' },
    ],
    60
  );
  assert.strictEqual(cleaned.length, 2);

  // Pairing
  const sessions = pairSessions([
    { eventTimeUtc: new Date('2026-08-10T04:00:00Z'), direction: 'IN' },
    { eventTimeUtc: new Date('2026-08-10T08:00:00Z'), direction: 'OUT' },
  ]);
  assert.strictEqual(sessions.length, 1);

  // 9:15 present / 9:16 late
  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-11 09:15',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-11 17:00',
    source: 'manual',
  });
  let day = (await rebuildDay(emp._id, '2026-08-11')).day;
  assert.strictEqual(day.status, 'Present');

  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-12 09:16',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-12 17:00',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-12')).day;
  assert.strictEqual(day.status, 'Late');

  // Half-day arrival threshold (240 min => 13:00)
  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-13 13:00',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-13 17:00',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-13')).day;
  assert.strictEqual(day.status, 'Half-day');

  // Early grace: 16:56 ok, 16:55 early
  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-14 09:00',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-14 16:56',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-14')).day;
  assert.ok(['Present', 'Late'].includes(day.status));

  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-15 09:00',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-15 16:55',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-15')).day;
  assert.strictEqual(day.status, 'Early-departure');

  // Short stay under 180 on 8h duty => Absent
  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-16 09:00',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-16 11:00',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-16')).day;
  assert.strictEqual(day.status, 'Absent');
  assert.ok(String(day.remark).includes('under 3 hours'));

  // Night shift: 22:00–07:00, 07:00 out belongs to previous work date
  emp.dutyStart = '22:00';
  emp.dutyEnd = '07:00';
  emp.dutyHistory.push({
    fromDate: '2026-08-17',
    toDate: null,
    start: '22:00',
    end: '07:00',
    shift: shift._id,
  });
  // close previous window
  emp.dutyHistory[emp.dutyHistory.length - 2].toDate = '2026-08-17';
  await emp.save();

  await Punch.deleteMany({ employee: emp._id });
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeLocal: '2026-08-17 22:05',
    source: 'manual',
  });
  await insertPunch({
    employeeId: emp._id,
    direction: 'OUT',
    eventTimeLocal: '2026-08-18 07:00',
    source: 'manual',
  });
  day = (await rebuildDay(emp._id, '2026-08-17')).day;
  assert.ok(day.timeOut === '07:00' || day.timeOutAt);
  assert.ok(day.shiftSnapshot?.crossesMidnight);

  console.log('slice2.test.js: all assertions passed');
  await mongoose.connection.close();
};

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.connection.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
