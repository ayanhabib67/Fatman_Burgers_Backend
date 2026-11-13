require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');

(async () => {
  await mongoose.connect(config.mongoUri);
  const Punch = require('../modules/hr/models/Punch');
  const Device = require('../modules/hr/models/Device');

  const start = new Date('2026-11-13T00:00:00+05:00');
  const end = new Date('2026-11-14T00:00:00+05:00');
  const today = await Punch.find({ eventTimeUtc: { $gte: start, $lt: end } })
    .sort({ eventTimeUtc: -1 })
    .lean();

  console.log('TODAY count', today.length);
  today.slice(0, 20).forEach((p) => {
    console.log(
      p.deviceUserPin,
      p.direction,
      new Date(p.eventTimeUtc).toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
      p.ingestStatus,
      p.source
    );
  });

  const d = await Device.findOne({ code: /jym6245100353/i }).lean();
  console.log(
    'DEVICE',
    d && {
      id: String(d._id),
      code: d.code,
      status: d.lastStatus,
      wm: d.watermark,
      pull: d.lastSuccessfulPullAt,
    }
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
