/**
 * Seed HR defaults: settings, General Day shift, Kitchen department, HR Admin user.
 *
 *   node src/scripts/seed-hr.js
 */
require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getSettings } = require('../modules/hr/services/settings.service');
const { ensureDefaultShift } = require('../modules/hr/services/shift.service');
const Department = require('../modules/hr/models/Department');
const Employee = require('../modules/hr/models/Employee');

const run = async () => {
  await mongoose.connect(config.mongoUri);
  console.log('Connected');

  const settings = await getSettings();
  console.log(`Timezone=${settings.timezone} cutoff=${settings.attendanceCutoffDay}`);

  const shift = await ensureDefaultShift();
  console.log(`Shift: ${shift.name} ${shift.dutyStart}-${shift.dutyEnd}`);

  let dept = await Department.findOne({ name: 'Operations' });
  if (!dept) dept = await Department.create({ name: 'Operations', active: true });
  console.log(`Department: ${dept.name}`);

  const email = process.env.HR_ADMIN_EMAIL || 'hr@fatman.local';
  let admin = await Employee.findOne({ workEmail: email, deletedAt: null });
  if (!admin) {
    admin = await Employee.create({
      employeeNumber: 'FB-1001',
      firstName: 'HR',
      lastName: 'Admin',
      displayName: 'HR Admin',
      designation: 'HR Manager',
      department: dept._id,
      hrRole: 'admin',
      allDepartments: true,
      workEmail: email,
      joiningDate: '2025-01-01',
      status: 'active',
      zkUserPin: '9001',
      shift: shift._id,
      dutyStart: shift.dutyStart,
      dutyEnd: shift.dutyEnd,
      dutyHistory: [
        {
          fromDate: '2025-01-01',
          toDate: null,
          start: shift.dutyStart,
          end: shift.dutyEnd,
          shift: shift._id,
        },
      ],
      leaveEntitlement: 30,
      leaveRemaining: 30,
      portalPasswordHash: await bcrypt.hash(process.env.HR_ADMIN_PASSWORD || 'admin123', 10),
    });
    console.log(`Created admin ${email} / ${process.env.HR_ADMIN_PASSWORD || 'admin123'}`);
  } else {
    console.log(`Admin already exists: ${email}`);
  }

  // Keep sequence ahead of seed number
  if (settings.employeeNumberSequence < 1001) {
    settings.employeeNumberSequence = 1001;
    await settings.save();
  }

  await mongoose.connection.close();
  console.log('Done');
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
