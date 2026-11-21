const mongoose = require('mongoose');

/**
 * Ledger row. type:
 *  - in     : stock arrived (delta = +qty)
 *  - out    : stock consumed / used (delta = -qty)
 *  - adjust : physical count correction (delta = counted - previous stock)
 */
const inventoryMovementSchema = new mongoose.Schema(
  {
    outlet: { type: String, required: true, trim: true, lowercase: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    unit: { type: String, default: 'pcs' },
    type: { type: String, enum: ['in', 'out', 'adjust'], required: true },
    qty: { type: Number, required: true, min: 0 },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    day: { type: String, required: true }, // YYYY-MM-DD (Asia/Karachi)
    note: { type: String, default: '', trim: true, maxlength: 200 },
    by: { type: String, default: '' }, // role + device label
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

inventoryMovementSchema.index({ outlet: 1, day: 1, createdAt: 1 });
inventoryMovementSchema.index({ outlet: 1, item: 1, day: 1 });

module.exports = mongoose.model('InventoryMovement', inventoryMovementSchema);
