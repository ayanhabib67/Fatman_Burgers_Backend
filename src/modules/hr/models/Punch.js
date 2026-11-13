const mongoose = require('mongoose');

const punchSchema = new mongoose.Schema(
  {
    dedupeKey: { type: String, required: true, unique: true },
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'HrDevice', default: null },
    deviceUserPin: { type: String, required: true, trim: true },
    deviceUserName: { type: String, default: '', trim: true },
    eventTimeUtc: { type: Date, required: true, index: true },
    deviceClockString: { type: String, default: '' },
    direction: { type: String, enum: ['IN', 'OUT'], required: true },
    verifyMode: {
      type: String,
      enum: ['fingerprint', 'face', 'card', 'password', 'manual', 'unknown'],
      default: 'unknown',
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      default: null,
      index: true,
    },
    ingestStatus: {
      type: String,
      enum: ['pending', 'processed', 'skipped', 'error', 'unmapped'],
      default: 'pending',
      index: true,
    },
    processError: { type: String, default: '' },
    source: {
      type: String,
      enum: ['agent', 'manual', 'import'],
      default: 'manual',
    },
    workDateHint: { type: String, default: null }, // YYYY-MM-DD local, optional
  },
  { timestamps: true, versionKey: false }
);

punchSchema.index({ ingestStatus: 1, employee: 1, eventTimeUtc: 1 });

module.exports = mongoose.model('HrPunch', punchSchema);
