const mongoose = require('mongoose');

/**
 * A stock item (raw material / packaging), e.g. "Burger Buns" counted in "pcs".
 * `stock` is the live balance and always equals the sum of all movement deltas.
 */
const inventoryItemSchema = new mongoose.Schema(
  {
    outlet: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    unit: { type: String, default: 'pcs', trim: true, maxlength: 15 },
    category: { type: String, default: 'General', trim: true, maxlength: 30 },
    stock: { type: Number, default: 0 },
    lowStockAt: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

inventoryItemSchema.index({ outlet: 1, name: 1 }, { unique: true });
inventoryItemSchema.index({ outlet: 1, active: 1, category: 1 });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
