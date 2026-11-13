/**
 * Create till-only portal user:
 *   email: pos@fatman.local
 *   password: admin
 *   hrRole: pos  (no HR pages — till only)
 *
 *   node src/scripts/seed-pos-user.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const Department = require('../modules/hr/models/Department');
const Employee = require('../modules/hr/models/Employee');
const { ensureDefaultShift } = require('../modules/hr/services/shift.service');
const { ensureFixedDepartments } = require('../modules/hr/services/department.service');

(async () => {
  await mongoose.connect(config.mongoUri);
  await ensureFixedDepartments();
  const shift = await ensureDefaultShift();
  const dept =
    (await Department.findOne({ name: 'Fatman Burgers', active: true })) ||
    (await Department.findOne({ active: true }));

  if (!dept) throw new Error('No department found — run seed-hr / ensure departments first');

  const email = 'pos@fatman.local';
  const password = 'admin';
  let emp = await Employee.findOne({ workEmail: email, deletedAt: null }).select(
    '+portalPasswordHash'
  );

  const hash = await bcrypt.hash(password, 10);

  if (!emp) {
    emp = await Employee.create({
      employeeNumber: 'FB-POS-01',
      firstName: 'POS',
      lastName: 'Operator',
      displayName: 'POS Operator',
      designation: 'Till',
      department: dept._id,
      hrRole: 'pos',
      workEmail: email,
      joiningDate: '2025-01-01',
      status: 'active',
      zkUserPin: '9101',
      shift: shift._id,
      dutyStart: shift.dutyStart || '09:00',
      dutyEnd: shift.dutyEnd || '17:00',
      dutyHistory: [
        {
          fromDate: '2025-01-01',
          toDate: null,
          start: shift.dutyStart || '09:00',
          end: shift.dutyEnd || '17:00',
          shift: shift._id,
        },
      ],
      leaveEntitlement: 0,
      leaveRemaining: 0,
      portalPasswordHash: hash,
    });
    console.log('Created', email, '/', password, 'role=pos');
  } else {
    emp.hrRole = 'pos';
    emp.status = 'active';
    emp.deletedAt = null;
    emp.portalPasswordHash = hash;
    emp.displayName = emp.displayName || 'POS Operator';
    await emp.save();
    console.log('Updated', email, '/', password, 'role=pos');
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
