const asyncHandler = require('../../shared/utils/asyncHandler');
const ApiResponse = require('../../shared/utils/ApiResponse');
const authService = require('./services/auth.service');
const departmentService = require('./services/department.service');
const shiftService = require('./services/shift.service');
const employeeService = require('./services/employee.service');
const settingsService = require('./services/settings.service');
const deviceService = require('./services/device.service');
const punchService = require('./services/punch.service');
const attendanceEngine = require('./services/attendanceEngine');
const leaveService = require('./services/leave.service');
const holidayService = require('./services/holiday.service');
const correctionService = require('./services/correction.service');
const overtimeService = require('./services/overtime.service');
const dashboardService = require('./services/dashboard.service');
const zkAgentService = require('./services/zkAgent.service');
const AttendanceDay = require('./models/AttendanceDay');
const LeaveRequest = require('./models/LeaveRequest');
const { attendanceMonthForDate, attendanceMonthRange } = require('./utils/time');

const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body || {});
  return ApiResponse.success(res, data, 'Logged in');
});

const me = asyncHandler(async (req, res) => {
  const data = await authService.me(req.hrUser._id);
  return ApiResponse.success(res, data);
});

const getSettings = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  const today = require('./utils/time').toLocalDateString(new Date(), settings.timezone);
  const month = attendanceMonthForDate(today, settings.attendanceCutoffDay, settings.timezone);
  const range = attendanceMonthRange(month.year, month.month, settings.attendanceCutoffDay);
  return ApiResponse.success(res, {
    timezone: settings.timezone,
    attendanceCutoffDay: settings.attendanceCutoffDay,
    defaultLeaveEntitlement: settings.defaultLeaveEntitlement,
    currentAttendanceMonth: month,
    currentAttendanceRange: range,
    // Extension points reserved for later slices
    extensions: {
      payroll: false,
      recruitment: false,
      training: false,
      agentPull: true,
    },
  });
});

const listDepartments = asyncHandler(async (req, res) => {
  const items = await departmentService.listDepartments({
    activeOnly: req.query.activeOnly === 'true',
  });
  return ApiResponse.success(res, items);
});

const createDepartment = asyncHandler(async (req, res) => {
  const item = await departmentService.createDepartment(req.body || {});
  return ApiResponse.created(res, item, 'Department created');
});

const updateDepartment = asyncHandler(async (req, res) => {
  const item = await departmentService.updateDepartment(req.params.id, req.body || {});
  return ApiResponse.success(res, item, 'Department updated');
});

const listShifts = asyncHandler(async (req, res) => {
  const items = await shiftService.listShifts({
    activeOnly: req.query.activeOnly === 'true',
  });
  return ApiResponse.success(res, items);
});

const createShift = asyncHandler(async (req, res) => {
  const item = await shiftService.createShift(req.body || {});
  return ApiResponse.created(res, item, 'Shift created');
});

const updateShift = asyncHandler(async (req, res) => {
  const item = await shiftService.updateShift(req.params.id, req.body || {});
  return ApiResponse.success(res, item, 'Shift updated');
});

const assignShift = asyncHandler(async (req, res) => {
  const item = await shiftService.assignShift(req.params.id, req.body.shiftId);
  return ApiResponse.success(res, item, 'Shift assigned');
});

const listEmployees = asyncHandler(async (req, res) => {
  const data = await employeeService.listEmployees(req.hrUser, req.query);
  return ApiResponse.success(res, data);
});

const getEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.getEmployee(req.hrUser, req.params.id);
  return ApiResponse.success(res, data);
});

const createEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.createEmployee(req.hrUser, req.body || {});
  return ApiResponse.created(res, data, 'Employee created');
});

const updateEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.updateEmployee(req.hrUser, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Employee updated');
});

const activateEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.setStatus(req.hrUser, req.params.id, 'active');
  return ApiResponse.success(res, data, 'Employee activated');
});

const deactivateEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.setStatus(req.hrUser, req.params.id, 'inactive');
  return ApiResponse.success(res, data, 'Employee deactivated');
});

const removeEmployee = asyncHandler(async (req, res) => {
  const data = await employeeService.softRemove(req.hrUser, req.params.id);
  return ApiResponse.success(res, data, 'Employee removed');
});

const employeeAudit = asyncHandler(async (req, res) => {
  // ensure access
  await employeeService.getEmployee(req.hrUser, req.params.id);
  const items = await employeeService.listAudit(req.params.id);
  return ApiResponse.success(res, items);
});

const exportEmployees = asyncHandler(async (req, res) => {
  const csv = await employeeService.exportCsv(req.hrUser, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
  return res.status(200).send(csv);
});

const previewEmployeeNumber = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  const next = settings.employeeNumberSequence + 1;
  return ApiResponse.success(res, {
    preview: `${settings.employeeNumberPrefix || 'FB'}-${next}`,
  });
});

const listDevices = asyncHandler(async (req, res) => {
  const items = await deviceService.listDevices();
  const unmapped = await deviceService.unmappedPunches({ limit: 50 });
  return ApiResponse.success(res, { items, unmapped });
});

const createDevice = asyncHandler(async (req, res) => {
  const item = await deviceService.createDevice(req.body || {});
  return ApiResponse.created(res, item, 'Device created');
});

const updateDevice = asyncHandler(async (req, res) => {
  const item = await deviceService.updateDevice(req.params.id, req.body || {});
  return ApiResponse.success(res, item, 'Device updated');
});

const listPunches = asyncHandler(async (req, res) => {
  const data = await punchService.listPunches({
    status: req.query.status,
    pin: req.query.pin,
    q: req.query.q,
    from: req.query.from,
    to: req.query.to,
    source: req.query.source,
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 100,
  });
  return ApiResponse.success(res, data);
});

const createManualPunch = asyncHandler(async (req, res) => {
  const result = await punchService.insertPunch({
    ...(req.body || {}),
    source: 'manual',
    verifyMode: 'manual',
  });
  // Process immediately so UI can show attendance
  if (result.punch.employee) {
    await attendanceEngine.processPendingPunches({ limit: 50 });
  }
  return ApiResponse.created(
    res,
    result,
    result.created ? 'Punch stored' : 'Duplicate punch ignored'
  );
});

const runAttendanceWorker = asyncHandler(async (req, res) => {
  const result = await attendanceEngine.processPendingPunches({ limit: 500 });
  return ApiResponse.success(res, result, 'Worker tick complete');
});

const rebuildAttendanceDay = asyncHandler(async (req, res) => {
  const result = await attendanceEngine.rebuildDay(
    req.body.employeeId,
    req.body.workDate,
    { force: Boolean(req.body.force) }
  );
  return ApiResponse.success(res, result, 'Day rebuilt');
});

const listAttendance = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employeeId) filter.employee = req.query.employeeId;
  if (req.query.from && req.query.to) {
    filter.workDate = { $gte: req.query.from, $lte: req.query.to };
  } else if (req.query.workDate) {
    filter.workDate = req.query.workDate;
  }
  const items = await AttendanceDay.find(filter)
    .populate({
      path: 'employee',
      select: 'displayName employeeNumber department status photoUrl',
      populate: { path: 'department', select: 'name' },
    })
    .sort({ workDate: -1, createdAt: 1 })
    .limit(Number(req.query.limit) || 500)
    .lean();
  return ApiResponse.success(res, items);
});

const presenceNow = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();
  const today = require('./utils/time').toLocalDateString(
    new Date(),
    settings.timezone
  );
  const yesterday = (() => {
    const [y, m, d] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - 1));
    const pad = (n) => String(n).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  })();

  const Employee = require('./models/Employee');
  const filter = { deletedAt: null, status: 'active' };
  if (req.query.departmentId && req.hrUser.hrRole === 'admin') {
    filter.department = req.query.departmentId;
  }

  const employees = await Employee.find(filter)
    .select('displayName employeeNumber department photoUrl')
    .populate('department', 'name')
    .sort({ displayName: 1 })
    .lean();

  const ids = employees.map((e) => e._id);
  const days = await AttendanceDay.find({
    employee: { $in: ids },
    workDate: { $in: [today, yesterday] },
  }).lean();

  const byEmp = new Map();
  for (const day of days) {
    const key = String(day.employee);
    const prev = byEmp.get(key);
    if (!prev || day.workDate > prev.workDate) byEmp.set(key, day);
    // prefer open overnight from yesterday
    if (day.workDate === yesterday && day.currentlyInside) byEmp.set(key, day);
  }

  let inside = 0;
  let outside = 0;
  const cards = employees.map((e) => {
    const day = byEmp.get(String(e._id));
    let chip = 'Out';
    if (day?.leaveApplied && ['Leave', 'Lieu', 'Official-leave'].includes(day.status)) {
      chip = 'On leave';
    } else if (
      day?.currentlyInside ||
      (day?.processingState === 'open' && day?.timeIn && !day?.timeOut)
    ) {
      chip = 'Inside';
      inside += 1;
    } else if (day && ['Weekend', 'Public-holiday'].includes(day.status)) {
      chip = 'Off day';
      outside += 1;
    } else {
      outside += 1;
    }
    return { ...e, chip, day };
  });

  return ApiResponse.success(res, { today, inside, outside, cards });
});

const getDashboard = asyncHandler(async (req, res) => {
  const data = await dashboardService.getDashboard(req.hrUser);
  return ApiResponse.success(res, data);
});

const submitLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.submitLeave(req.hrUser, req.body || {});
  return ApiResponse.created(res, data, 'Leave submitted');
});

const listLeaves = asyncHandler(async (req, res) => {
  const data = await leaveService.listLeaves(req.hrUser, req.query);
  return ApiResponse.success(res, data);
});

const getLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.getLeave(req.params.id);
  return ApiResponse.success(res, data);
});

const decideLeave = asyncHandler(async (req, res) => {
  const data = await leaveService.decideLeave(req.hrUser, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Leave updated');
});

const listBalances = asyncHandler(async (req, res) => {
  const data = await leaveService.listBalances(req.hrUser);
  return ApiResponse.success(res, data);
});

const updateBalances = asyncHandler(async (req, res) => {
  const data = await leaveService.updateBalances(req.hrUser, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Balances updated');
});

const leaveTypes = asyncHandler(async (_req, res) => {
  return ApiResponse.success(res, {
    types: LeaveRequest.LEAVE_TYPES,
  });
});

const listHolidays = asyncHandler(async (req, res) => {
  const data = await holidayService.listHolidays({ year: req.query.year });
  return ApiResponse.success(res, data);
});

const upsertHoliday = asyncHandler(async (req, res) => {
  const data = await holidayService.upsertHoliday(req.body || {});
  return ApiResponse.success(res, data, 'Holiday saved');
});

const removeHoliday = asyncHandler(async (req, res) => {
  const data = await holidayService.removeHoliday(req.params.id);
  return ApiResponse.success(res, data, 'Holiday removed');
});

const createCorrection = asyncHandler(async (req, res) => {
  const data = await correctionService.createCorrection(req.hrUser, req.body || {});
  return ApiResponse.created(res, data, 'Correction submitted');
});

const listCorrections = asyncHandler(async (req, res) => {
  const data = await correctionService.listCorrections(req.hrUser, req.query);
  return ApiResponse.success(res, data);
});

const decideCorrection = asyncHandler(async (req, res) => {
  const data = await correctionService.decideCorrection(
    req.hrUser,
    req.params.id,
    req.body || {}
  );
  return ApiResponse.success(res, data, 'Correction updated');
});

const startOvertime = asyncHandler(async (req, res) => {
  const data = await overtimeService.startOvertime(req.hrUser, req.body || {});
  return ApiResponse.created(res, data, 'Overtime started');
});

const endOvertime = asyncHandler(async (req, res) => {
  const data = await overtimeService.endOvertime(req.hrUser, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Overtime ended');
});

const listOvertime = asyncHandler(async (req, res) => {
  const data = await overtimeService.listOvertime(req.hrUser, req.query);
  return ApiResponse.success(res, data);
});

const updateOvertime = asyncHandler(async (req, res) => {
  const data = await overtimeService.updateOvertime(req.hrUser, req.params.id, req.body || {});
  return ApiResponse.success(res, data, 'Overtime updated');
});

const deleteOvertime = asyncHandler(async (req, res) => {
  const data = await overtimeService.deleteOvertime(req.hrUser, req.params.id);
  return ApiResponse.success(res, data, 'Overtime deleted');
});

const testDevice = asyncHandler(async (req, res) => {
  const data = await zkAgentService.testConnection(req.params.id);
  return ApiResponse.success(res, data, 'Device reachable');
});

const pullDevice = asyncHandler(async (req, res) => {
  const data = await zkAgentService.pullDevice(req.params.id, {
    sinceWatermark: req.body?.full !== true,
  });
  return ApiResponse.success(res, data, 'Pull complete');
});

const pullAllDevices = asyncHandler(async (req, res) => {
  const data = await zkAgentService.pullAllActive();
  return ApiResponse.success(res, data, 'Pull all complete');
});

const getAdmsSetup = asyncHandler(async (_req, res) => {
  const config = require('../../config');
  const Device = require('./models/Device');
  const devices = await Device.find({
    location: 'ADMS push',
    code: { $nin: ['test', 'check'] },
  })
    .sort({ updatedAt: -1 })
    .lean();
  const publicUrl = config.admsPublicUrl || '';
  let host = 'YOUR_VPS_IP_OR_DOMAIN';
  let port = '8088';
  if (publicUrl) {
    try {
      const u = new URL(publicUrl.includes('://') ? publicUrl : `http://${publicUrl}`);
      host = u.hostname;
      port = u.port || (u.protocol === 'https:' ? '443' : '80');
    } catch {
      host = publicUrl.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    }
  }
  return ApiResponse.success(
    res,
    {
      publicUrl: publicUrl || null,
      deviceSettings: {
        communicationMode: 'ADMS / Cloud Server / Push',
        serverAddress: host,
        serverPort: Number(port) || 8088,
        protocol: 'HTTP',
        https: false,
        notes: [
          'Do NOT put http:// or /iclock in Server Address — only host/IP',
          'Prefer port 8088 (opened on VPS firewall)',
          'Device will call http://HOST:PORT/iclock/cdata automatically',
          'After save, reboot device once',
        ],
      },
      testUrls: {
        health: `${publicUrl || `http://HOST:${port}`}/iclock/health`,
      },
      connectedDevices: devices.map((d) => ({
        id: d._id,
        code: d.code,
        name: d.name,
        lastStatus: d.lastStatus,
        lastSeen: d.lastSuccessfulPullAt,
        lastError: d.lastError,
      })),
    },
    'ADMS setup'
  );
});

const admsResyncDevice = asyncHandler(async (req, res) => {
  const Device = require('./models/Device');
  const { requestAttlogResync } = require('./adms/adms.routes');
  const device = await Device.findById(req.params.id);
  if (!device) {
    const AppError = require('../../shared/errors/AppError');
    throw new AppError('Device not found', 404);
  }
  // code is usually SN lowercased from ADMS
  const sn = String(device.code || '').toUpperCase();
  requestAttlogResync(sn);
  requestAttlogResync(device.code);
  device.lastStatus = 'adms_resync_queued';
  await device.save();
  return ApiResponse.success(
    res,
    { sn, code: device.code },
    'ADMS resync queued — device will push on next getrequest poll'
  );
});

module.exports = {
  login,
  me,
  getSettings,
  listDepartments,
  createDepartment,
  updateDepartment,
  listShifts,
  createShift,
  updateShift,
  assignShift,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  activateEmployee,
  deactivateEmployee,
  removeEmployee,
  employeeAudit,
  exportEmployees,
  previewEmployeeNumber,
  listDevices,
  createDevice,
  updateDevice,
  listPunches,
  createManualPunch,
  runAttendanceWorker,
  rebuildAttendanceDay,
  listAttendance,
  presenceNow,
  getDashboard,
  submitLeave,
  listLeaves,
  getLeave,
  decideLeave,
  listBalances,
  updateBalances,
  leaveTypes,
  listHolidays,
  upsertHoliday,
  removeHoliday,
  createCorrection,
  listCorrections,
  decideCorrection,
  startOvertime,
  endOvertime,
  listOvertime,
  updateOvertime,
  deleteOvertime,
  testDevice,
  pullDevice,
  pullAllDevices,
  getAdmsSetup,
  admsResyncDevice,
};
