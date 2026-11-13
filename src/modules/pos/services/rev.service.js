const Counter = require('../models/Counter');

const nextRev = async () => {
  const row = await Counter.findOneAndUpdate(
    { key: 'journal_rev' },
    { $inc: { value: 1 } },
    { upsert: true, new: true }
  );
  return row.value;
};

module.exports = { nextRev };
