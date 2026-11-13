const mongoose = require('mongoose');

/** Public holidays — full CRUD UI arrives with leave slice; model needed for attendance engine. */
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    name: { type: String, required: true, trim: true },
    portion: { type: String, enum: ['full', 'half'], default: 'full' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('HrHoliday', holidaySchema);
