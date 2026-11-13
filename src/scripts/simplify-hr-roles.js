require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');

(async () => {
  await mongoose.connect(config.mongoUri);
  const col = mongoose.connection.db.collection('hremployees');

  const before = await col
    .find({ deletedAt: null }, { projection: { displayName: 1, workEmail: 1, hrRole: 1 } })
    .toArray();
  console.log(
    'BEFORE',
    before.map((e) => ({ name: e.displayName, email: e.workEmail, role: e.hrRole }))
  );

  // Only existing admin stays admin; hod / hr_manager / override → employee
  const toAdmin = await col.updateMany(
    { hrRole: 'admin' },
    { $set: { hrRole: 'admin', allDepartments: false } }
  );
  const toEmployee = await col.updateMany(
    { hrRole: { $ne: 'admin' } },
    { $set: { hrRole: 'employee', allDepartments: false } }
  );

  // Pending leave: fold HOD queue into admin queue
  const leaves = await mongoose.connection.db.collection('hrleaverequests').updateMany(
    { status: 'pending_hod' },
    { $set: { status: 'pending_hr' } }
  );

  const after = await col
    .find({ deletedAt: null }, { projection: { displayName: 1, workEmail: 1, hrRole: 1 } })
    .toArray();
  console.log('promoted/kept admin:', toAdmin.modifiedCount, 'matched', toAdmin.matchedCount);
  console.log('set employee:', toEmployee.modifiedCount, 'matched', toEmployee.matchedCount);
  console.log('leave pending_hod→pending_hr:', leaves.modifiedCount);
  console.log(
    'AFTER',
    after.map((e) => ({ name: e.displayName, email: e.workEmail, role: e.hrRole }))
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
