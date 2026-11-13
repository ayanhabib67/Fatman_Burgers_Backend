require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');

(async () => {
  await mongoose.connect(config.mongoUri);
  const r = await mongoose.connection.db
    .collection('hremployees')
    .updateMany({}, { $set: { attendancePrivileges: [] } });
  console.log('cleared privileges on', r.modifiedCount, 'employees (matched', r.matchedCount, ')');
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
