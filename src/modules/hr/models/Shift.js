const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    type: {
      type: String,
      enum: ['general', 'night', 'custom'],
      default: 'general',
    },
    dutyStart: { type: String, required: true }, // HH:mm 24h
    dutyEnd: { type: String, required: true },
    // Sunday=0 … Saturday=6
    workingDays: {
      type: [Number],
      default: [1, 2, 3, 4, 5, 6],
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

shiftSchema.virtual('crossesMidnight').get(function crossesMidnight() {
  return String(this.dutyEnd) <= String(this.dutyStart);
});

module.exports = mongoose.model('HrShift', shiftSchema);
