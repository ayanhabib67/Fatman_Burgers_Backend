try { require('dotenv').config(); } catch (e) {}
const mongoose = require('mongoose');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fatman_burgers_pos';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const outlet = process.env.DEFAULT_OUTLET || 'fatman';

  const kinds = ['orders', 'voided', 'expenses', 'days', 'moves'];
  const before = await db.collection('posrecords').countDocuments({
    outlet,
    kind: { $in: kinds },
  });
  const del = await db.collection('posrecords').deleteMany({
    outlet,
    kind: { $in: kinds },
  });

  const seqKey = 'seq:' + outlet;
  const seq = await db.collection('poscounters').findOneAndUpdate(
    { key: seqKey },
    { $set: { value: 0 } },
    { upsert: true, returnDocument: 'after' }
  );

  console.log(JSON.stringify({
    outlet,
    kinds,
    deletedRecords: del.deletedCount,
    before,
    seqKey,
    seq: seq && seq.value,
  }, null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
