const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    role: { type: String, enum: ['barista', 'owner'], required: true },
    outlet: { type: String, required: true, index: true },
    label: { type: String, default: 'device', maxlength: 60 },
    revoked: { type: Boolean, default: false },
    fails: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastSeen: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

deviceSchema.index({ outlet: 1, role: 1, revoked: 1 });

module.exports = mongoose.model('PosDevice', deviceSchema);
