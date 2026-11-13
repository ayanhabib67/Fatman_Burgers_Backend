require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');

(async () => {
  await mongoose.connect(config.mongoUri);
  const Device = require('../modules/hr/models/Device');

  const before = await Device.find().lean();
  console.log(
    'BEFORE',
    before.map((d) => ({ code: d.code, name: d.name, loc: d.location, status: d.lastStatus }))
  );

  // Fake devices created by health/probe requests (SN=TEST / SN=CHECK)
  const del = await Device.deleteMany({
    code: { $in: ['test', 'check'] },
  });
  console.log('deleted fake ADMS devices:', del.deletedCount);

  // Keep real uFace SN; rename for clarity
  const real = await Device.findOneAndUpdate(
    { code: /jym6245100353/i },
    {
      $set: {
        name: 'uFace800 Plus · Main Gate',
        location: 'ADMS push',
        active: true,
      },
    },
    { returnDocument: 'after' }
  ).lean();

  console.log(
    'REAL DEVICE',
    real && {
      id: String(real._id),
      code: real.code,
      name: real.name,
      status: real.lastStatus,
      ip: real.ipAddress,
    }
  );

  const left = await Device.find().lean();
  console.log(
    'LEFT',
    left.map((d) => ({ code: d.code, name: d.name, loc: d.location }))
  );

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
