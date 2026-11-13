const mongoose = require('mongoose');

const correctionSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
    },
    workDate: { type: String, required: true },
    type: {
      type: String,
      enum: [
        'missing_check_in',
        'missing_check_out',
        'wrong_time',
        'forgotten_punch',
        'device_failure',
        'sync_failure',
        'movement_reclassify',
        'other',
      ],
      required: true,
    },
    proposedTimeIn: { type: String, default: null },
    proposedTimeOut: { type: String, default: null },
    proposedStatus: { type: String, default: null },
    proposedMovementType: {
      type: String,
      enum: ['lunch', 'office_exit', 'unauthorized', null],
      default: null,
    },
    reason: { type: String, required: true },
    attachmentUrl: { type: String, default: '' },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewNote: { type: String, default: '' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployee', default: null },
    reviewedAt: { type: Date, default: null },
    changeLog: [
      {
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('HrCorrection', correctionSchema);
