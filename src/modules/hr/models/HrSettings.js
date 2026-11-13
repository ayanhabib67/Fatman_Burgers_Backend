const mongoose = require('mongoose');

const hrSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'default' },
    timezone: { type: String, default: 'Asia/Karachi' },
    attendanceCutoffDay: { type: Number, default: 26, min: 2, max: 28 },
    employeeNumberSequence: { type: Number, default: 1000 },
    employeeNumberPrefix: { type: String, default: 'FB' },
    defaultLeaveEntitlement: { type: Number, default: 30 },
    arrivalGraceMinutes: { type: Number, default: 15 },
    earlyGraceMinutes: { type: Number, default: 5 },
    halfDayArrivalMinutes: { type: Number, default: 240 },
    shortStayMinutes: { type: Number, default: 180 },
    punchDedupeSeconds: { type: Number, default: 60 },
    checkoutConfirmMinutes: { type: Number, default: 30 },
    // Extension points (unused in slice 1)
    extensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('HrSettings', hrSettingsSchema);
