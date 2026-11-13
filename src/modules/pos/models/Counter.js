const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

module.exports = mongoose.model('PosCounter', counterSchema);
