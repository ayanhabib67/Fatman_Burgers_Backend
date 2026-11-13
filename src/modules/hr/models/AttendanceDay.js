const mongoose = require('mongoose');

const STATUSES = [
  'Present',
  'Late',
  'Absent',
  'Half-day',
  'Early-departure',
  'Incomplete',
  'Missing Check-Out',
  'Weekend',
  'Public-holiday',
  'Leave',
  'Lieu',
  'Official-leave',
  'Open',
];

const attendanceDaySchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
    },
    workDate: { type: String, required: true }, // YYYY-MM-DD
    status: { type: String, enum: STATUSES, default: 'Open' },
    timeIn: { type: String, default: null }, // HH:mm local
    timeOut: { type: String, default: null },
    timeInAt: { type: Date, default: null },
    timeOutAt: { type: Date, default: null },
    source: {
      type: String,
      enum: ['device', 'manual', 'leave', 'correction', 'hybrid', 'system'],
      default: 'device',
    },
    lateMinutes: { type: Number, default: 0 },
    earlyMinutes: { type: Number, default: 0 },
    grossMinutesInside: { type: Number, default: 0 },
    workingMinutes: { type: Number, default: 0 },
    movementCount: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    overtimeHoursComplete: { type: Number, default: 0 },
    remark: { type: String, default: '' },
    halfDayPart: { type: String, enum: ['first', 'second', null], default: null },
    unpaid: { type: Boolean, default: false },
    shiftSnapshot: {
      name: { type: String },
      dutyStart: { type: String },
      dutyEnd: { type: String },
      shiftType: { type: String },
      crossesMidnight: { type: Boolean },
    },
    processingState: {
      type: String,
      enum: ['open', 'closed', 'finalized'],
      default: 'open',
    },
    currentlyInside: { type: Boolean, default: false },
    engineVersion: { type: Number, default: 1 },
    correctionApplied: { type: Boolean, default: false },
    leaveApplied: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

attendanceDaySchema.index({ employee: 1, workDate: 1 }, { unique: true });
attendanceDaySchema.index({ workDate: 1, status: 1 });
attendanceDaySchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('HrAttendanceDay', attendanceDaySchema);
