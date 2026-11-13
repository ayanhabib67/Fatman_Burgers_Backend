const mongoose = require('mongoose');

const movementSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
      index: true,
    },
    workDate: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['lunch', 'lunch_exceeded', 'office_exit', 'unauthorized', 'other'],
      default: 'office_exit',
    },
    outAt: { type: Date, required: true },
    inAt: { type: Date, default: null },
    minutes: { type: Number, default: 0 },
    manualOverride: { type: Boolean, default: false },
    note: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false }
);

movementSchema.index({ employee: 1, workDate: 1, outAt: 1 });

module.exports = mongoose.model('HrAttendanceMovement', movementSchema);
