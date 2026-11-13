const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, unique: true },
    name: { type: String, required: true, trim: true },
    ipAddress: { type: String, default: '', trim: true },
    tcpPort: { type: Number, default: 4370 },
    commKey: { type: Number, default: 0 },
    location: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
    lastSuccessfulPullAt: { type: Date, default: null },
    lastStatus: { type: String, default: 'never_pulled' },
    lastError: { type: String, default: '' },
    /** Newest punch timestamp already stored for this device (agent watermark). */
    watermark: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('HrDevice', deviceSchema);
