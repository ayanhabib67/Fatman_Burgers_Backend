require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
require('../modules/hr/models/Employee');

(async () => {
  await mongoose.connect(config.mongoUri);
  const punches = await Punch.find()
    .sort({ eventTimeUtc: -1 })
    .limit(15)
    .populate('employee', 'displayName employeeNumber')
    .lean();

  console.log('Latest punches:\n');
  for (const p of punches) {
    const name = p.employee?.displayName || 'UNMAPPED';
    console.log(
      new Date(p.eventTimeUtc).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }),
      '| PIN',
      p.deviceUserPin,
      '|',
      p.direction,
      '|',
      name,
      '|',
      p.ingestStatus
    );
  }
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
