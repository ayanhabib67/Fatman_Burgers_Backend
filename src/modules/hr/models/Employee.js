const mongoose = require('mongoose');

const ATTENDANCE_PRIVILEGES = ['all', 'late', 'early', 'off', 'off_campus'];
const HR_ROLES = ['employee', 'admin', 'pos'];
const STATUSES = ['active', 'inactive'];

const dutyHistorySchema = new mongoose.Schema(
  {
    fromDate: { type: String, required: true }, // YYYY-MM-DD
    toDate: { type: String, default: null },
    start: { type: String, required: true },
    end: { type: String, required: true },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShift', default: null },
  },
  { _id: false }
);

const weeklyRosterSchema = new mongoose.Schema(
  {
    weekday: { type: Number, min: 0, max: 6, required: true },
    off: { type: Boolean, default: false },
    start: { type: String, default: null },
    end: { type: String, default: null },
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeNumber: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, default: '', trim: true },
    lastName: { type: String, required: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    designation: { type: String, default: '', trim: true },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HrDepartment',
      required: true,
    },
    hrRole: { type: String, enum: HR_ROLES, default: 'employee' },
    allDepartments: { type: Boolean, default: false },
    workEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, default: '', trim: true },
    gender: { type: String, default: '', trim: true },
    cnic: { type: String, default: '', trim: true },
    photoUrl: { type: String, default: '', trim: true },
    joiningDate: { type: String, required: true },
    dateOfBirth: { type: String, default: null },
    status: { type: String, enum: STATUSES, default: 'active' },
    deletedAt: { type: Date, default: null },
    zkUserPin: { type: String, required: true, trim: true },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'HrShift', default: null },
    dutyStart: { type: String, default: '09:00' },
    dutyEnd: { type: String, default: '17:00' },
    dutyHistory: { type: [dutyHistorySchema], default: [] },
    weeklyRoster: { type: [weeklyRosterSchema], default: [] },
    attendancePrivileges: {
      type: [{ type: String, enum: ATTENDANCE_PRIVILEGES }],
      default: [],
    },
    leaveEntitlement: { type: Number, default: 30 },
    leaveRemaining: { type: Number, default: 30 },
    probationEndedOn: { type: String, default: null },
    portalPasswordHash: { type: String, default: null, select: false },
    lastPortalLoginAt: { type: Date, default: null },
    // Extension hooks for payroll / recruitment later
    extensions: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, versionKey: false }
);

employeeSchema.index(
  { employeeNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
employeeSchema.index(
  { workEmail: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      workEmail: { $type: 'string', $gt: '' },
    },
  }
);
employeeSchema.index(
  { zkUserPin: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
employeeSchema.index({ department: 1, status: 1, deletedAt: 1, displayName: 1 });

employeeSchema.statics.ATTENDANCE_PRIVILEGES = ATTENDANCE_PRIVILEGES;
employeeSchema.statics.HR_ROLES = HR_ROLES;

module.exports = mongoose.model('HrEmployee', employeeSchema);
