require('dotenv').config();

const assert = require('assert');
const mongoose = require('mongoose');
const config = require('../../../config');
const { ensureDefaultShift } = require('../services/shift.service');
const { getSettings } = require('../services/settings.service');
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const Holiday = require('../models/Holiday');
const AttendanceDay = require('../models/AttendanceDay');
const leaveService = require('../services/leave.service');
const holidayService = require('../services/holiday.service');
const correctionService = require('../services/correction.service');
const overtimeService = require('../services/overtime.service');
const dashboardService = require('../services/dashboard.service');
const { insertPunch } = require('../services/punch.service');
const { processPendingPunches } = require('../services/attendanceEngine');

const run = async () => {
  await mongoose.connect(config.mongoUri);
  await getSettings();
  const shift = await ensureDefaultShift();

  let dept = await Department.findOne({ name: 'Ops Slice3' });
  if (!dept) dept = await Department.create({ name: 'Ops Slice3', active: true });

  const stamp = Date.now().toString().slice(-6);
  const emp = await Employee.create({
    employeeNumber: `FB-S3-EMP-${stamp}`,
    firstName: 'Emp',
    lastName: 'Slice3',
    displayName: 'Emp Slice3',
    department: dept._id,
    hrRole: 'employee',
    joiningDate: '2024-01-01',
    probationEndedOn: '2024-07-01',
    status: 'active',
    zkUserPin: `s3e${stamp}`,
    shift: shift._id,
    dutyStart: '09:00',
    dutyEnd: '17:00',
    dutyHistory: [
      { fromDate: '2024-01-01', toDate: null, start: '09:00', end: '17:00', shift: shift._id },
    ],
    leaveEntitlement: 30,
    leaveRemaining: 30,
  });
  const hod = await Employee.create({
    employeeNumber: `FB-S3-HOD-${stamp}`,
    firstName: 'Hod',
    lastName: 'Slice3',
    displayName: 'Hod Slice3',
    department: dept._id,
    hrRole: 'hod',
    joiningDate: '2024-01-01',
    probationEndedOn: '2024-07-01',
    status: 'active',
    zkUserPin: `s3h${stamp}`,
    shift: shift._id,
    dutyStart: '09:00',
    dutyEnd: '17:00',
    dutyHistory: [
      { fromDate: '2024-01-01', toDate: null, start: '09:00', end: '17:00', shift: shift._id },
    ],
    leaveEntitlement: 30,
    leaveRemaining: 30,
  });
  const hr = await Employee.create({
    employeeNumber: `FB-S3-HR-${stamp}`,
    firstName: 'Hr',
    lastName: 'Slice3',
    displayName: 'Hr Slice3',
    department: dept._id,
    hrRole: 'hr_manager',
    joiningDate: '2024-01-01',
    probationEndedOn: '2024-07-01',
    status: 'active',
    zkUserPin: `s3r${stamp}`,
    shift: shift._id,
    dutyStart: '09:00',
    dutyEnd: '17:00',
    dutyHistory: [
      { fromDate: '2024-01-01', toDate: null, start: '09:00', end: '17:00', shift: shift._id },
    ],
    leaveEntitlement: 30,
    leaveRemaining: 30,
  });

  // Holiday
  const hol = await holidayService.upsertHoliday({
    date: '2026-08-14',
    name: 'Slice3 Holiday',
    portion: 'full',
  });
  assert.ok(hol._id);
  const holidays = await holidayService.listHolidays({ year: '2026' });
  assert.ok(holidays.some((h) => h.date === '2026-08-14'));

  // Leave flow
  const leave = await leaveService.submitLeave(emp, {
    leaveType: 'Casual',
    fromDate: '2026-08-11',
    toDate: '2026-08-11',
    reason: 'Slice3 personal',
  });
  assert.strictEqual(leave.status, 'pending_hod');
  assert.strictEqual(leave.days, 1);

  await leaveService.decideLeave(hod, leave._id, {
    action: 'hod_signoff',
    comment: 'OK from HOD',
  });
  let refreshed = await LeaveRequest.findById(leave._id);
  assert.strictEqual(refreshed.status, 'pending_hr');

  await leaveService.decideLeave(hr, leave._id, {
    action: 'hr_approve',
    comment: 'Approved by HR',
  });
  refreshed = await LeaveRequest.findById(leave._id);
  assert.strictEqual(refreshed.status, 'approved');
  assert.strictEqual(refreshed.deducted, true);

  const empAfter = await Employee.findById(emp._id);
  assert.strictEqual(empAfter.leaveRemaining, 29);

  const leaveDay = await AttendanceDay.findOne({
    employee: emp._id,
    workDate: '2026-08-11',
  });
  assert.ok(leaveDay);
  assert.strictEqual(leaveDay.status, 'Leave');
  assert.strictEqual(leaveDay.leaveApplied, true);

  // Balances
  const balances = await leaveService.listBalances(hr);
  assert.ok(balances.some((b) => String(b._id) === String(emp._id)));
  await leaveService.updateBalances(hr, emp._id, {
    leaveEntitlement: 30,
    leaveRemaining: 28,
  });
  const empBal = await Employee.findById(emp._id);
  assert.strictEqual(empBal.leaveRemaining, 28);

  // Correction
  await insertPunch({
    employeeId: emp._id,
    direction: 'IN',
    eventTimeUtc: '2026-08-12T09:05:00+05:00',
    source: 'manual',
  });
  await processPendingPunches({ limit: 20 });

  const corr = await correctionService.createCorrection(emp, {
    workDate: '2026-08-12',
    type: 'wrong_time',
    proposedTimeIn: '09:00',
    reason: 'Clock was late',
  });
  assert.strictEqual(corr.status, 'pending');
  await correctionService.decideCorrection(hr, corr._id, {
    action: 'approve',
    reviewNote: 'Fixed',
  });
  const day = await AttendanceDay.findOne({ employee: emp._id, workDate: '2026-08-12' });
  assert.strictEqual(day.timeIn, '09:00');
  assert.strictEqual(day.correctionApplied, true);

  // Overtime on off day (holiday) — no earliest-start rule
  const ot = await overtimeService.startOvertime(hod, {
    employeeId: emp._id,
    task: 'Inventory count',
    startedAt: '2026-08-14T10:00:00+05:00',
    workDate: '2026-08-14',
  });
  assert.strictEqual(ot.status, 'running');
  const ended = await overtimeService.endOvertime(hod, ot._id, {
    endedAt: '2026-08-14T13:30:00+05:00',
  });
  assert.strictEqual(ended.status, 'ended');
  assert.strictEqual(ended.completeHours, 3);

  // Working-day OT before duty end + 1h should fail
  let blocked = false;
  try {
    await overtimeService.startOvertime(hod, {
      employeeId: emp._id,
      task: 'Too early',
      startedAt: '2026-08-13T17:30:00+05:00',
      workDate: '2026-08-13',
    });
  } catch (err) {
    blocked = true;
    assert.ok(err.statusCode === 400 || err.status === 400);
  }
  assert.ok(blocked, 'early overtime should be blocked');

  const otOk = await overtimeService.startOvertime(hod, {
    employeeId: emp._id,
    task: 'Late stock',
    startedAt: '2026-08-13T18:05:00+05:00',
    workDate: '2026-08-13',
  });
  await overtimeService.endOvertime(hr, otOk._id);

  const listed = await overtimeService.listOvertime(hr, { year: 2026, month: 8 });
  assert.ok(listed.items.length >= 2);

  // Dashboard
  const dash = await dashboardService.getDashboard(hr);
  assert.ok(dash.header.welcome);
  assert.ok(dash.kpis);
  assert.ok(dash.monthSummary);

  // Cleanup soft markers
  await Holiday.updateOne({ _id: hol._id }, { $set: { active: false } });

  console.log('slice3 OK');
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
