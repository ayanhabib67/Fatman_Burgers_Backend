const mongoose = require('mongoose');

const employeeAuditSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      default: null,
    },
    actorName: { type: String, default: 'system' },
    action: {
      type: String,
      enum: ['create', 'edit', 'activate', 'deactivate', 'remove'],
      required: true,
    },
    summary: { type: String, required: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

module.exports = mongoose.model('HrEmployeeAudit', employeeAuditSchema);
