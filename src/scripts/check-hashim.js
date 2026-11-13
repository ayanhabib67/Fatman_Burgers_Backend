require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
const Employee = require('../modules/hr/models/Employee');

(async () => {
  await mongoose.connect(config.mongoUri);
  const emps = await Employee.find({
    deletedAt: null,
    $or: [
      { displayName: /hashim/i },
      { zkUserPin: '1015' },
      { employeeNumber: '1015' },
    ],
  })
    .select('displayName employeeNumber zkUserPin status')
    .lean();
  console.log('Employees:', emps);

  const punches = await Punch.find({ deviceUserPin: '1015' })
    .sort({ eventTimeUtc: -1 })
    .lean();
  console.log('PIN 1015 total punches:', punches.length);
  for (const p of punches) {
    console.log(
      new Date(p.eventTimeUtc).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }),
      p.direction,
      p.ingestStatus,
      p.source
    );
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
