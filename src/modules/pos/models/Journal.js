const mongoose = require('mongoose');

const journalSchema = new mongoose.Schema(
  {
    rev: { type: Number, required: true, unique: true },
    at: { type: Date, default: Date.now },
    outlet: { type: String, required: true, index: true },
    device: { type: String, default: '' },
    role: { type: String, default: '' },
    kind: { type: String, required: true },
    id: { type: String, required: true },
    u: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

journalSchema.index({ outlet: 1, rev: 1 });

module.exports = mongoose.model('PosJournal', journalSchema);
