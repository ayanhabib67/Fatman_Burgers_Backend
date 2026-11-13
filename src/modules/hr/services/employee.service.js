const Employee = require('../models/Employee');
const Department = require('../models/Department');
const Shift = require('../models/Shift');
const AppError = require('../../../shared/errors/AppError');
const { nextEmployeeNumber, getSettings } = require('./settings.service');
const { writeAudit, listAudit } = require('./audit.service');
const {
  toLocalDateString,
  isOnProbation,
  probationEndDate,
} = require('../utils/time');

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const publicEmployee = (doc, settings) => {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  delete obj.portalPasswordHash;
  delete obj.attendancePrivileges;
  const today = toLocalDateString(new Date(), settings?.timezone || 'Asia/Karachi');
  obj.onProbation = isOnProbation(obj, today);
  obj.probationEndsOn = obj.probationEndedOn || (obj.joiningDate ? probationEndDate(obj.joiningDate) : null);
  return obj;
};

const assertAdmin = (actor) => {
  if (actor?.hrRole !== 'admin') {
    throw new AppError('Admin required', 403);
  }
};

const scopeDepartmentFilter = (actor, requestedDepartmentId) => {
  if (actor?.hrRole === 'admin') {
    return requestedDepartmentId || null;
  }
  throw new AppError('Directory access denied', 403);
};

const buildListFilter = ({
  actor,
  q,
  departmentId,
  status = 'active',
  hiredFrom,
  portalAccess,
}) => {
  const filter = { deletedAt: null };
  const scopedDept = scopeDepartmentFilter(actor, departmentId);
  if (scopedDept) filter.department = scopedDept;

  if (status === 'active' || status === 'inactive') filter.status = status;
  // status === 'all' → no status filter

  if (q) {
    const rx = new RegExp(escapeRegex(q.trim()), 'i');
    filter.$or = [
      { displayName: rx },
      { firstName: rx },
      { lastName: rx },
      { workEmail: rx },
      { employeeNumber: rx },
    ];
  }

  if (hiredFrom) {
    filter.joiningDate = { $gte: hiredFrom };
  }

  if (portalAccess === 'logged_in') {
    filter.lastPortalLoginAt = { $ne: null };
  } else if (portalAccess === 'never') {
    filter.lastPortalLoginAt = null;
  }

  return filter;
};

const listEmployees = async (actor, query = {}) => {
  const settings = await getSettings();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 50));
  const filter = buildListFilter({
    actor,
    q: query.q,
    departmentId: query.departmentId,
    status: query.status || 'active',
    hiredFrom: query.hiredFrom,
    portalAccess: query.portalAccess,
  });

  const [total, rows] = await Promise.all([
    Employee.countDocuments(filter),
    Employee.find(filter)
      .populate('department')
      .populate('shift')
      .sort({ displayName: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  return {
    items: rows.map((r) => publicEmployee(r, settings)),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
  };
};

const getEmployee = async (actor, id) => {
  const settings = await getSettings();
  const row = await Employee.findOne({ _id: id, deletedAt: null })
    .populate('department')
    .populate('shift');
  if (!row) throw new AppError('Employee not found', 404);

  if (actor.hrRole !== 'admin' && String(actor._id) !== String(id)) {
    throw new AppError('Forbidden', 403);
  }

  return publicEmployee(row, settings);
};

const createEmployee = async (actor, payload) => {
  assertAdmin(actor);
  const settings = await getSettings();

  if (!payload.firstName || !payload.lastName) {
    throw new AppError('First and last name are required', 400);
  }
  if (!payload.departmentId) throw new AppError('Department is required', 400);
  if (!payload.joiningDate) throw new AppError('Date of joining is required', 400);
  if (!payload.zkUserPin) throw new AppError('ZKTeco user PIN is required', 400);

  const dept = await Department.findById(payload.departmentId);
  if (!dept || !dept.active) throw new AppError('Active department required', 400);

  let shift = null;
  if (payload.shiftId) {
    shift = await Shift.findById(payload.shiftId);
    if (!shift || !shift.active) throw new AppError('Active shift required', 400);
  }

  const employeeNumber =
    String(payload.employeeNumber || '').trim() || (await nextEmployeeNumber());

  const displayName =
    String(payload.displayName || '').trim() ||
    [payload.firstName, payload.middleName, payload.lastName].filter(Boolean).join(' ');

  const dutyStart = payload.dutyStart || shift?.dutyStart || '09:00';
  const dutyEnd = payload.dutyEnd || shift?.dutyEnd || '17:00';
  const entitlement =
    payload.leaveEntitlement != null
      ? Number(payload.leaveEntitlement)
      : settings.defaultLeaveEntitlement;
  let remaining =
    payload.leaveRemaining != null ? Number(payload.leaveRemaining) : entitlement;
  if (remaining > entitlement) {
    throw new AppError('Remaining leave cannot exceed entitlement', 400);
  }

  const bcrypt = require('bcryptjs');
  let portalPasswordHash = null;
  if (payload.portalPassword) {
    portalPasswordHash = await bcrypt.hash(String(payload.portalPassword), 10);
  }

  try {
    const employee = await Employee.create({
      employeeNumber,
      firstName: String(payload.firstName).trim(),
      middleName: String(payload.middleName || '').trim(),
      lastName: String(payload.lastName).trim(),
      displayName,
      designation: String(payload.designation || '').trim(),
      department: dept._id,
      hrRole: ['admin', 'pos'].includes(payload.hrRole) ? payload.hrRole : 'employee',
      allDepartments: false,
      workEmail: payload.workEmail ? String(payload.workEmail).trim().toLowerCase() : null,
      phone: String(payload.phone || '').trim(),
      gender: String(payload.gender || '').trim(),
      cnic: String(payload.cnic || '').trim(),
      photoUrl: String(payload.photoUrl || '').trim(),
      joiningDate: payload.joiningDate,
      dateOfBirth: payload.dateOfBirth || null,
      status: payload.status === 'inactive' ? 'inactive' : 'active',
      zkUserPin: String(payload.zkUserPin).trim(),
      shift: shift?._id || null,
      dutyStart,
      dutyEnd,
      dutyHistory: [
        {
          fromDate: payload.joiningDate,
          toDate: null,
          start: dutyStart,
          end: dutyEnd,
          shift: shift?._id || null,
        },
      ],
      weeklyRoster: Array.isArray(payload.weeklyRoster) ? payload.weeklyRoster : [],
      attendancePrivileges: [],
      leaveEntitlement: entitlement,
      leaveRemaining: remaining,
      probationEndedOn: payload.probationEndedOn || null,
      portalPasswordHash,
    });

    await writeAudit({
      employeeId: employee._id,
      actor,
      action: 'create',
      summary: `Created ${displayName} (${employeeNumber})`,
    });

    return publicEmployee(
      await employee.populate(['department', 'shift']),
      settings
    );
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      throw new AppError(`Duplicate ${field}`, 409);
    }
    throw err;
  }
};

const updateEmployee = async (actor, id, payload) => {
  assertAdmin(actor);
  const settings = await getSettings();
  const employee = await Employee.findOne({ _id: id, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);

  const today = toLocalDateString(new Date(), settings.timezone);
  const changes = [];

  const setStr = (field, value) => {
    if (value === undefined) return;
    const next = value == null ? value : String(value).trim();
    if (String(employee[field] || '') !== String(next || '')) {
      changes.push(`${field}`);
      employee[field] = next;
    }
  };

  setStr('firstName', payload.firstName);
  setStr('middleName', payload.middleName);
  setStr('lastName', payload.lastName);
  setStr('displayName', payload.displayName);
  setStr('designation', payload.designation);
  setStr('phone', payload.phone);
  setStr('gender', payload.gender);
  setStr('cnic', payload.cnic);
  setStr('photoUrl', payload.photoUrl);
  setStr('dateOfBirth', payload.dateOfBirth);
  const prevZk = employee.zkUserPin;
  setStr('zkUserPin', payload.zkUserPin);
  setStr('probationEndedOn', payload.probationEndedOn);

  if (payload.workEmail !== undefined) {
    employee.workEmail = payload.workEmail
      ? String(payload.workEmail).trim().toLowerCase()
      : null;
    changes.push('workEmail');
  }

  if (payload.hrRole) {
    employee.hrRole = ['admin', 'pos'].includes(payload.hrRole)
      ? payload.hrRole
      : 'employee';
    changes.push('hrRole');
  }
  employee.allDepartments = false;
  if (payload.departmentId) {
    const dept = await Department.findById(payload.departmentId);
    if (!dept) throw new AppError('Department not found', 404);
    employee.department = dept._id;
    changes.push('department');
  }

  // Attendance privileges removed — always empty
  if ((employee.attendancePrivileges || []).length) {
    employee.attendancePrivileges = [];
    changes.push('privileges_cleared');
  }
  if (payload.weeklyRoster) {
    employee.weeklyRoster = payload.weeklyRoster;
    changes.push('weeklyRoster');
  }

  if (payload.leaveEntitlement != null) {
    employee.leaveEntitlement = Number(payload.leaveEntitlement);
    changes.push('leaveEntitlement');
  }
  if (payload.leaveRemaining != null) {
    employee.leaveRemaining = Number(payload.leaveRemaining);
    changes.push('leaveRemaining');
  }
  if (employee.leaveRemaining > employee.leaveEntitlement) {
    throw new AppError('Remaining leave cannot exceed entitlement', 400);
  }

  // Duty change → history window (do not rewrite past)
  const nextStart = payload.dutyStart;
  const nextEnd = payload.dutyEnd;
  const nextShiftId = payload.shiftId;
  const dutyChanging =
    (nextStart && nextStart !== employee.dutyStart) ||
    (nextEnd && nextEnd !== employee.dutyEnd) ||
    (nextShiftId && String(nextShiftId) !== String(employee.shift || ''));

  if (dutyChanging) {
    let shift = null;
    if (nextShiftId) {
      shift = await Shift.findById(nextShiftId);
      if (!shift || !shift.active) throw new AppError('Active shift required', 400);
      employee.shift = shift._id;
    }
    const start = nextStart || shift?.dutyStart || employee.dutyStart;
    const end = nextEnd || shift?.dutyEnd || employee.dutyEnd;

    if (employee.dutyHistory?.length) {
      const last = employee.dutyHistory[employee.dutyHistory.length - 1];
      if (!last.toDate) last.toDate = today;
    }
    employee.dutyHistory.push({
      fromDate: today,
      toDate: null,
      start,
      end,
      shift: employee.shift,
    });
    employee.dutyStart = start;
    employee.dutyEnd = end;
    changes.push('duty');
  }

  if (payload.portalPassword) {
    const bcrypt = require('bcryptjs');
    employee.portalPasswordHash = await bcrypt.hash(String(payload.portalPassword), 10);
    changes.push('portalPassword');
  }

  try {
    await employee.save();
  } catch (err) {
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      throw new AppError(`Duplicate ${field}`, 409);
    }
    throw err;
  }

  if (payload.zkUserPin && String(payload.zkUserPin).trim() !== String(prevZk)) {
    const remapped = await require('./punch.service').remapUnmappedForPin(
      employee.zkUserPin,
      employee._id
    );
    if (remapped) {
      await require('./attendanceEngine').processPendingPunches({ limit: 100 });
    }
  }

  await writeAudit({
    employeeId: employee._id,
    actor,
    action: 'edit',
    summary: `Updated ${employee.displayName}: ${changes.join(', ') || 'no field changes'}`,
    meta: { changes },
  });

  return publicEmployee(await employee.populate(['department', 'shift']), settings);
};

const setStatus = async (actor, id, status) => {
  assertAdmin(actor);
  if (!['active', 'inactive'].includes(status)) {
    throw new AppError('Invalid status', 400);
  }
  const settings = await getSettings();
  const employee = await Employee.findOne({ _id: id, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);

  employee.status = status;
  await employee.save();
  await writeAudit({
    employeeId: employee._id,
    actor,
    action: status === 'active' ? 'activate' : 'deactivate',
    summary: `${status === 'active' ? 'Activated' : 'Deactivated'} ${employee.displayName}`,
  });
  return publicEmployee(await employee.populate(['department', 'shift']), settings);
};

const softRemove = async (actor, id) => {
  assertAdmin(actor);
  const employee = await Employee.findOne({ _id: id, deletedAt: null });
  if (!employee) throw new AppError('Employee not found', 404);

  employee.deletedAt = new Date();
  employee.status = 'inactive';
  // Free unique keys for reuse while keeping history on this document
  employee.workEmail = employee.workEmail
    ? `deleted.${Date.now()}.${employee.workEmail}`
    : null;
  employee.zkUserPin = `deleted.${Date.now()}.${employee.zkUserPin}`;
  employee.employeeNumber = `deleted.${Date.now()}.${employee.employeeNumber}`;
  await employee.save();

  await writeAudit({
    employeeId: employee._id,
    actor,
    action: 'remove',
    summary: `Soft-removed ${employee.displayName}`,
  });

  return { ok: true };
};

const exportCsv = async (actor, query = {}) => {
  const result = await listEmployees(actor, { ...query, page: 1, limit: 5000 });
  const header = [
    'employeeNumber',
    'displayName',
    'designation',
    'department',
    'workEmail',
    'status',
    'zkUserPin',
    'joiningDate',
    'hrRole',
  ];
  const lines = [header.join(',')];
  for (const row of result.items) {
    const vals = [
      row.employeeNumber,
      row.displayName,
      row.designation,
      row.department?.name || '',
      row.workEmail || '',
      row.status,
      row.zkUserPin,
      row.joiningDate,
      row.hrRole,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`);
    lines.push(vals.join(','));
  }
  return lines.join('\n');
};

module.exports = {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  setStatus,
  softRemove,
  exportCsv,
  listAudit,
  publicEmployee,
};
