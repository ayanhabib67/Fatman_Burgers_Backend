const mongoose = require('mongoose');

const leaveAuditSchema = new mongoose.Schema(
  {
    leaveRequest: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrLeaveRequest',
      required: true,
      index: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployee', default: null },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    action: { type: String, required: true },
    comment: { type: String, default: '' },
    employeeName: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('HrLeaveAudit', leaveAuditSchema);
