const mongoose = require('mongoose');

const LEAVE_TYPES = [
  'Casual',
  'City Situation',
  'Death in Family',
  'Educational',
  'General',
  'Incident',
  'Post Incident',
  'Pregnancy/Disability',
  'Sick',
  'Travelling',
  'Vacation',
  'Official Leave',
  'Official Task',
  'Official Travelling',
  'Official Work From Home',
  'In Lieu of Offday',
  'Long Unpaid Leave',
  'Forced Leave',
];

const DEDUCTING = new Set([
  'Casual',
  'City Situation',
  'Death in Family',
  'Educational',
  'General',
  'Incident',
  'Post Incident',
  'Pregnancy/Disability',
  'Sick',
  'Travelling',
  'Vacation',
]);

const OFFICIAL = new Set([
  'Official Leave',
  'Official Task',
  'Official Travelling',
  'Official Work From Home',
]);

const UNPAID = new Set(['Long Unpaid Leave', 'Forced Leave']);

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
      index: true,
    },
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
    },
    leaveType: { type: String, enum: LEAVE_TYPES, required: true },
    fromDate: { type: String, required: true },
    toDate: { type: String, required: true },
    reason: { type: String, required: true, trim: true },
    halfDay: { type: Boolean, default: false },
    halfDayPart: { type: String, enum: ['first', 'second', null], default: null },
    halfDayTimes: {
      start: { type: String, default: null },
      end: { type: String, default: null },
    },
    days: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending_hod', 'pending_hr', 'approved', 'rejected'],
      default: 'pending_hr',
      index: true,
    },
    deducted: { type: Boolean, default: false },
    overrideReason: { type: String, default: '' },
  },
  { timestamps: true, versionKey: false }
);

leaveRequestSchema.statics.LEAVE_TYPES = LEAVE_TYPES;
leaveRequestSchema.statics.metaForType = (leaveType) => {
  if (OFFICIAL.has(leaveType)) {
    return { deduct: false, attendanceStatus: 'Official-leave', unpaid: false };
  }
  if (leaveType === 'In Lieu of Offday') {
    return { deduct: false, attendanceStatus: 'Lieu', unpaid: false };
  }
  if (UNPAID.has(leaveType)) {
    return { deduct: false, attendanceStatus: 'Leave', unpaid: true };
  }
  if (DEDUCTING.has(leaveType)) {
    return { deduct: true, attendanceStatus: 'Leave', unpaid: false };
  }
  return { deduct: true, attendanceStatus: 'Leave', unpaid: false };
};

module.exports = mongoose.model('HrLeaveRequest', leaveRequestSchema);
