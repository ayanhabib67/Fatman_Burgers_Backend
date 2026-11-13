require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
const Employee = require('../modules/hr/models/Employee');
const { remapUnmappedForPin } = require('../modules/hr/services/punch.service');

const pin = String(process.argv[2] || '1093');

(async () => {
  await mongoose.connect(config.mongoUri);

  const emp = await Employee.findOne({
    deletedAt: null,
    $or: [
      { zkUserPin: pin },
      { employeeNumber: pin },
      { displayName: /ayan habib/i },
    ],
  }).lean();

  console.log(
    'Employee:',
    emp
      ? {
          name: emp.displayName,
          pin: emp.zkUserPin,
          no: emp.employeeNumber,
        }
      : 'NOT FOUND'
  );

  if (emp?.zkUserPin === pin || emp) {
    const n = await remapUnmappedForPin(pin, emp._id);
    if (n) console.log('remapped', n);
  }

  const punches = await Punch.find({ deviceUserPin: pin })
    .sort({ eventTimeUtc: -1 })
    .limit(8)
    .lean();

  if (!punches.length) {
    console.log(`No punches for PIN ${pin}`);
  } else {
    const last = punches[0];
    console.log('\nLAST PUNCH:');
    console.log(
      new Date(last.eventTimeUtc).toLocaleString('en-GB', {
        timeZone: 'Asia/Karachi',
      }),
      last.direction,
      last.ingestStatus
    );
    console.log('\nRecent:');
    for (const p of punches) {
      console.log(
        new Date(p.eventTimeUtc).toLocaleString('en-GB', {
          timeZone: 'Asia/Karachi',
        }),
        p.direction,
        p.ingestStatus
      );
    }
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
