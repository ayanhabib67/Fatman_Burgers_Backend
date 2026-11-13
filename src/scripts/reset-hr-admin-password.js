require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');

(async () => {
  await mongoose.connect(config.mongoUri);
  const email = (process.env.HR_ADMIN_EMAIL || 'hr@fatman.local').toLowerCase();
  const password = process.env.HR_ADMIN_PASSWORD || 'admin123';
  const col = mongoose.connection.db.collection('hremployees');

  const emp = await col.findOne({ workEmail: email, deletedAt: null });
  if (!emp) {
    console.log('NOT FOUND', email);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  await col.updateOne(
    { _id: emp._id },
    {
      $set: {
        portalPasswordHash: hash,
        hrRole: 'admin',
        status: 'active',
        allDepartments: false,
      },
    }
  );

  const check = await bcrypt.compare(password, hash);
  console.log({
    email,
    name: emp.displayName,
    role: 'admin',
    password,
    bcryptOk: check,
    hadHashBefore: Boolean(emp.portalPasswordHash),
  });

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
