require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
const { processPendingPunches } = require('../modules/hr/services/attendanceEngine');
const { remapUnmappedForPin } = require('../modules/hr/services/punch.service');
const Employee = require('../modules/hr/models/Employee');

(async () => {
  await mongoose.connect(config.mongoUri);

  const start = new Date('2026-11-13T00:00:00+05:00');
  const end = new Date('2026-11-14T00:00:00+05:00');

  // Remap any employees that now match
  const emps = await Employee.find({ deletedAt: null, status: 'active' })
    .select('_id zkUserPin displayName')
    .lean();
  for (const e of emps) {
    if (!e.zkUserPin) continue;
    const n = await remapUnmappedForPin(e.zkUserPin, e._id);
    if (n) console.log(`remapped ${n} punches -> ${e.displayName} (${e.zkUserPin})`);
  }
  await processPendingPunches({ limit: 500 });

  const today = await Punch.find({
    eventTimeUtc: { $gte: start, $lt: end },
  })
    .sort({ eventTimeUtc: 1 })
    .populate('employee', 'displayName employeeNumber')
    .lean();

  console.log('\nTODAY 13-Nov-2026 punches:', today.length);
  for (const p of today) {
    const name = p.employee?.displayName || 'UNMAPPED';
    console.log(
      `${new Date(p.eventTimeUtc).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} | PIN ${p.deviceUserPin} | ${p.direction} | ${name} | ${p.ingestStatus}`
    );
  }

  const wahab = await Punch.find({ deviceUserPin: '1094' })
    .sort({ eventTimeUtc: -1 })
    .limit(10)
    .lean();
  console.log('\nAbdul Wahab PIN 1094 (latest 10):');
  for (const p of wahab) {
    console.log(
      `${new Date(p.eventTimeUtc).toLocaleString('en-GB', { timeZone: 'Asia/Karachi' })} | ${p.direction} | ${p.ingestStatus}`
    );
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
