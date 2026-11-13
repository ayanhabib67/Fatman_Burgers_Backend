require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
const Employee = require('../modules/hr/models/Employee');
const { remapUnmappedForPin } = require('../modules/hr/services/punch.service');
const { processPendingPunches } = require('../modules/hr/services/attendanceEngine');

(async () => {
  await mongoose.connect(config.mongoUri);

  const emp = await Employee.findOne({
    deletedAt: null,
    $or: [
      { zkUserPin: '1093' },
      { employeeNumber: '1093' },
      { displayName: /ayan habib/i },
      { displayName: /ayan/i },
    ],
  })
    .select('displayName employeeNumber zkUserPin status')
    .lean();

  console.log('Employee:', emp || 'NOT FOUND');

  if (emp) {
    const n = await remapUnmappedForPin('1093', emp._id);
    console.log('Remapped punches:', n);
    await processPendingPunches({ limit: 100 });
  }

  const punches = await Punch.find({ deviceUserPin: '1093' })
    .sort({ eventTimeUtc: -1 })
    .limit(12)
    .populate('employee', 'displayName')
    .lean();

  console.log('\nPIN 1093 punches:', punches.length ? '' : 'NONE');
  if (punches[0]) {
    console.log(
      '\nLAST PUNCH:',
      new Date(punches[0].eventTimeUtc).toLocaleString('en-GB', {
        timeZone: 'Asia/Karachi',
      }),
      punches[0].direction,
      punches[0].ingestStatus,
      punches[0].employee?.displayName || 'UNMAPPED'
    );
  }
  console.log('\nRecent:');
  for (const p of punches) {
    console.log(
      new Date(p.eventTimeUtc).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' }),
      p.direction,
      p.ingestStatus,
      p.employee?.displayName || 'UNMAPPED'
    );
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
