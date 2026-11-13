const mongoose = require('mongoose');

const menuItemSchema = new mongoose.Schema(
  {
    outlet: { type: String, required: true, trim: true, lowercase: true },
    category: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    cost: { type: Number, default: 0, min: 0 },
    imageKey: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

menuItemSchema.index({ outlet: 1, category: 1, name: 1 }, { unique: true });
menuItemSchema.index({ outlet: 1, active: 1, sortOrder: 1 });

module.exports = mongoose.model('PosMenuItem', menuItemSchema);
