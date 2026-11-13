const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema(
  {
    outlet: { type: String, required: true },
    kind: { type: String, required: true },
    id: { type: String, required: true },
    u: { type: Number, required: true },
    day: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    rev: { type: Number, required: true },
    device: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
  }
);

recordSchema.index({ outlet: 1, kind: 1, id: 1 }, { unique: true });
recordSchema.index({ outlet: 1, rev: 1 });
recordSchema.index({ outlet: 1, kind: 1, day: 1 });
recordSchema.index({ rev: 1 }, { unique: true });

module.exports = mongoose.model('PosRecord', recordSchema);
