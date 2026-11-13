/**
 * Slice 1 HR unit/integration checks (no external test runner).
 */
require('dotenv').config();

const assert = require('assert');
const mongoose = require('mongoose');
const config = require('../../../config');
const {
  attendanceMonthForDate,
  attendanceMonthRange,
  isOnProbation,
  probationEndDate,
} = require('../utils/time');
const { ensureDefaultShift } = require('../services/shift.service');
const { getSettings } = require('../services/settings.service');
const Department = require('../models/Department');
const Employee = require('../models/Employee');
const employeeService = require('../services/employee.service');

const run = async () => {
  // --- pure helpers ---
  const aug = attendanceMonthForDate('2026-08-10', 26);
  assert.strictEqual(aug.key, '2026-08');
  const lateJul = attendanceMonthForDate('2026-07-26', 26);
  assert.strictEqual(lateJul.key, '2026-08');
  const range = attendanceMonthRange(2026, 8, 26);
  assert.strictEqual(range.start, '2026-07-26');
  assert.strictEqual(range.end, '2026-08-25');

  assert.strictEqual(probationEndDate('2026-01-15'), '2026-07-15');
  assert.strictEqual(
    isOnProbation({ joiningDate: '2026-01-15' }, '2026-07-14'),
    true
  );
  assert.strictEqual(
    isOnProbation({ joiningDate: '2026-01-15' }, '2026-07-15'),
    false
  );
  assert.strictEqual(
    isOnProbation(
      { joiningDate: '2026-01-15', probationEndedOn: '2026-03-01' },
      '2026-03-01'
    ),
    false
  );

  await mongoose.connect(config.mongoUri);
  await getSettings();
  const shift = await ensureDefaultShift();
  assert.ok(shift);
  assert.strictEqual(shift.dutyStart, '09:00');
  assert.strictEqual(shift.dutyEnd, '17:00');

  let dept = await Department.findOne({ name: 'QA Dept' });
  if (!dept) dept = await Department.create({ name: 'QA Dept', active: true });

  const actor = {
    _id: new mongoose.Types.ObjectId(),
    displayName: 'Tester',
    hrRole: 'admin',
    department: dept._id,
  };

  const pin = `t${Date.now().toString().slice(-8)}`;
  const created = await employeeService.createEmployee(actor, {
    firstName: 'Slice',
    lastName: 'One',
    displayName: 'Slice One',
    departmentId: String(dept._id),
    joiningDate: '2026-01-01',
    zkUserPin: pin,
    shiftId: String(shift._id),
    workEmail: `slice1.${Date.now()}@fatman.local`,
  });
  assert.ok(created.employeeNumber);
  assert.strictEqual(created.status, 'active');
  assert.ok(created.dutyHistory?.length >= 1);

  await employeeService.setStatus(actor, created._id, 'inactive');
  const listedActive = await employeeService.listEmployees(actor, {
    status: 'active',
    q: created.employeeNumber,
  });
  assert.strictEqual(
    listedActive.items.find((e) => String(e._id) === String(created._id)),
    undefined
  );

  const listedInactive = await employeeService.listEmployees(actor, {
    status: 'inactive',
    q: created.employeeNumber,
  });
  assert.ok(listedInactive.items.find((e) => String(e._id) === String(created._id)));

  // duty history not rewritten on re-assign
  const before = (await Employee.findById(created._id)).dutyHistory.length;
  await employeeService.setStatus(actor, created._id, 'active');
  await require('../services/shift.service').assignShift(created._id, shift._id);
  const after = (await Employee.findById(created._id)).dutyHistory.length;
  assert.ok(after >= before);

  await employeeService.softRemove(actor, created._id);
  const gone = await Employee.findOne({ _id: created._id, deletedAt: null });
  assert.strictEqual(gone, null);
  const kept = await Employee.findById(created._id);
  assert.ok(kept.deletedAt);

  console.log('slice1.test.js: all assertions passed');
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
