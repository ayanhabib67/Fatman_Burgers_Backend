try { require('dotenv').config(); } catch (e) {}
const mongoose = require('mongoose');

(async () => {
  const orderNo = Number(process.env.ORDER_NO || process.argv[2] || 0);
  if (!orderNo || !Number.isFinite(orderNo) || orderNo < 1) {
    console.error('Usage: node src/scripts/delete-fatman-order-by-no.js <orderNo>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fatman_burgers_pos';
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const outlet = process.env.DEFAULT_OUTLET || 'fatman';

  const found = await db.collection('posrecords').find({
    outlet,
    kind: 'orders',
    'data.no': orderNo,
  }).toArray();

  if (!found.length) {
    console.log(JSON.stringify({ outlet, orderNo, deleted: 0, note: 'no matching order' }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const deleted = [];
  for (const rec of found) {
    const revRow = await db.collection('poscounters').findOneAndUpdate(
      { key: 'journal_rev' },
      { $inc: { value: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const rev = revRow && revRow.value;

    const voidData = Object.assign({}, rec.data || {}, {
      reason: 'Deleted order #' + String(orderNo).padStart(4, '0') + ' by admin',
      voidedAt: new Date().toISOString(),
      voidedBy: 'admin-delete',
    });
    if (!Array.isArray(voidData.items)) voidData.items = [];
    if (!voidData.payment || voidData.payment === 'Unpaid') voidData.payment = 'Cash';

    await db.collection('posrecords').updateOne(
      { outlet, kind: 'voided', id: rec.id },
      {
        $set: {
          outlet,
          kind: 'voided',
          id: rec.id,
          u: Date.now(),
          day: rec.day || (rec.data && rec.data.iso) || '',
          data: voidData,
          rev,
          device: 'admin-delete',
        },
      },
      { upsert: true }
    );

    await db.collection('posrecords').deleteOne({ _id: rec._id });
    deleted.push({ id: rec.id, no: orderNo, rev });
  }

  console.log(JSON.stringify({
    outlet,
    orderNo,
    deletedCount: deleted.length,
    deleted,
  }, null, 2));

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
