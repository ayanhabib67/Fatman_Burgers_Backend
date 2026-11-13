require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const Punch = require('../modules/hr/models/Punch');
const Employee = require('../modules/hr/models/Employee');
const Device = require('../modules/hr/models/Device');

(async () => {
  await mongoose.connect(config.mongoUri);

  const start = new Date('2026-11-13T00:00:00+05:00');
  const end = new Date('2026-11-14T00:00:00+05:00');

  const today = await Punch.find({
    eventTimeUtc: { $gte: start, $lt: end },
  })
    .sort({ eventTimeUtc: -1 })
    .lean();
  console.log('TODAY 13-Nov-2026 punches:', today.length);

  const recentCreated = await Punch.find()
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();
  console.log('\nLast DB inserts (createdAt):');
  for (const p of recentCreated) {
    console.log(
      `created ${new Date(p.createdAt).toLocaleString()} | event ${new Date(p.eventTimeUtc).toLocaleString()} | PIN ${p.deviceUserPin} | ${p.ingestStatus}`
    );
  }

  const byDay = await Punch.aggregate([
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$eventTimeUtc',
            timezone: 'Asia/Karachi',
          },
        },
        n: { $sum: 1 },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 15 },
  ]);
  console.log('\nPunches by day (Asia/Karachi):');
  byDay.forEach((d) => console.log(d._id, d.n));

  const wahab = await Employee.find({
    deletedAt: null,
    $or: [
      { displayName: /wahab/i },
      { firstName: /wahab/i },
      { lastName: /wahab/i },
      { displayName: /abdul/i },
    ],
  })
    .select('displayName employeeNumber zkUserPin status')
    .lean();
  console.log('\nName search Abdul/Wahab:');
  console.log(wahab);

  if (wahab.length) {
    for (const e of wahab) {
      const pin = e.zkUserPin;
      const logs = await Punch.find({ deviceUserPin: String(pin) })
        .sort({ eventTimeUtc: -1 })
        .limit(5)
        .lean();
      console.log(
        `\nLogs for ${e.displayName} PIN=${pin}:`,
        logs.length
          ? logs.map(
              (p) =>
                `${new Date(p.eventTimeUtc).toLocaleString()} ${p.direction} ${p.ingestStatus}`
            )
          : 'NONE'
      );
    }
  }

  console.log(
    '\nDevices:',
    await Device.find()
      .select('code ipAddress lastStatus lastSuccessfulPullAt lastError')
      .lean()
  );

  const newest = await Punch.findOne().sort({ eventTimeUtc: -1 }).lean();
  console.log(
    '\nNewest punch event time:',
    newest ? new Date(newest.eventTimeUtc).toLocaleString() : 'none'
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
