const mongoose = require('mongoose');

const overtimeSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrEmployee',
      required: true,
      index: true,
    },
    task: { type: String, required: true, trim: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    workDate: { type: String, required: true, index: true },
    status: { type: String, enum: ['running', 'ended'], default: 'running', index: true },
    completeHours: { type: Number, default: 0 },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployee', required: true },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'HrEmployee', default: null },
  },
  { timestamps: true, versionKey: false }
);

overtimeSchema.index(
  { employee: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'running' } }
);

module.exports = mongoose.model('HrOvertimeSession', overtimeSchema);
