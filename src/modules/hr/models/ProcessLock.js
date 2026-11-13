const mongoose = require('mongoose');

/** Serialize attendance rebuild per employee+workDate. */
const processLockSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    lockedAt: { type: Date, default: Date.now },
    owner: { type: String, default: '' },
  },
  { versionKey: false }
);

module.exports = mongoose.model('HrProcessLock', processLockSchema);
