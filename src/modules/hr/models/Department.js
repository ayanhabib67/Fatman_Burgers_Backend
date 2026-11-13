const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);

departmentSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('HrDepartment', departmentSchema);
