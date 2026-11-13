const express = require('express');
const ctrl = require('./hr.controller');
const { requireHrAuth, requireHrRoles } = require('./middleware/hrAuth');

const router = express.Router();

router.post('/auth/login', ctrl.login);

router.use(requireHrAuth);

router.get('/auth/me', ctrl.me);
router.get('/settings', ctrl.getSettings);

router.get('/departments', ctrl.listDepartments);
router.post(
  '/departments',
  requireHrRoles('admin'),
  ctrl.createDepartment
);
router.patch(
  '/departments/:id',
  requireHrRoles('admin'),
  ctrl.updateDepartment
);

router.get('/shifts', ctrl.listShifts);
router.post('/shifts', requireHrRoles('admin'), ctrl.createShift);
router.patch(
  '/shifts/:id',
  requireHrRoles('admin'),
  ctrl.updateShift
);
router.post(
  '/employees/:id/assign-shift',
  requireHrRoles('admin'),
  ctrl.assignShift
);

router.get('/employees', ctrl.listEmployees);
router.get('/employees/export.csv', ctrl.exportEmployees);
router.get(
  '/employees/next-number',
  requireHrRoles('admin'),
  ctrl.previewEmployeeNumber
);
router.get('/employees/:id', ctrl.getEmployee);
router.get(
  '/employees/:id/audit',
  requireHrRoles('admin'),
  ctrl.employeeAudit
);
router.post(
  '/employees',
  requireHrRoles('admin'),
  ctrl.createEmployee
);
router.patch(
  '/employees/:id',
  requireHrRoles('admin'),
  ctrl.updateEmployee
);
router.post(
  '/employees/:id/activate',
  requireHrRoles('admin'),
  ctrl.activateEmployee
);
router.post(
  '/employees/:id/deactivate',
  requireHrRoles('admin'),
  ctrl.deactivateEmployee
);
router.post(
  '/employees/:id/remove',
  requireHrRoles('admin'),
  ctrl.removeEmployee
);

// ---- Devices / punches / ZKTeco LAN agent (uFace800 Plus · port 4370) ----
router.get('/devices', requireHrRoles('admin'), ctrl.listDevices);
router.post('/devices', requireHrRoles('admin'), ctrl.createDevice);
router.patch(
  '/devices/:id',
  requireHrRoles('admin'),
  ctrl.updateDevice
);
router.post(
  '/devices/pull-all',
  requireHrRoles('admin'),
  ctrl.pullAllDevices
);
router.post(
  '/devices/:id/test',
  requireHrRoles('admin'),
  ctrl.testDevice
);
router.post(
  '/devices/:id/pull',
  requireHrRoles('admin'),
  ctrl.pullDevice
);
router.get('/adms/setup', requireHrRoles('admin'), ctrl.getAdmsSetup);
router.post(
  '/devices/:id/adms-resync',
  requireHrRoles('admin'),
  ctrl.admsResyncDevice
);

router.get(
  '/punches',
  requireHrRoles('admin'),
  (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  },
  ctrl.listPunches
);
router.post(
  '/punches/manual',
  requireHrRoles('admin'),
  ctrl.createManualPunch
);
router.post(
  '/attendance/run-worker',
  requireHrRoles('admin'),
  ctrl.runAttendanceWorker
);
router.post(
  '/attendance/rebuild',
  requireHrRoles('admin'),
  ctrl.rebuildAttendanceDay
);
router.get('/attendance', ctrl.listAttendance);
router.get('/presence', ctrl.presenceNow);

router.get('/dashboard', ctrl.getDashboard);

router.get('/leave/types', ctrl.leaveTypes);
router.get('/leave', ctrl.listLeaves);
router.get('/leave/:id', ctrl.getLeave);
router.post('/leave', ctrl.submitLeave);
router.post(
  '/leave/:id/decide',
  requireHrRoles('admin'),
  ctrl.decideLeave
);

router.get('/balances', ctrl.listBalances);
router.patch(
  '/balances/:id',
  requireHrRoles('admin'),
  ctrl.updateBalances
);

router.get('/holidays', ctrl.listHolidays);
router.post('/holidays', requireHrRoles('admin'), ctrl.upsertHoliday);
router.delete(
  '/holidays/:id',
  requireHrRoles('admin'),
  ctrl.removeHoliday
);

router.get('/corrections', ctrl.listCorrections);
router.post('/corrections', ctrl.createCorrection);
router.post(
  '/corrections/:id/decide',
  requireHrRoles('admin'),
  ctrl.decideCorrection
);

router.get('/overtime', ctrl.listOvertime);
router.post(
  '/overtime',
  requireHrRoles('admin'),
  ctrl.startOvertime
);
router.post(
  '/overtime/:id/end',
  requireHrRoles('admin'),
  ctrl.endOvertime
);
router.patch(
  '/overtime/:id',
  requireHrRoles('admin'),
  ctrl.updateOvertime
);
router.delete(
  '/overtime/:id',
  requireHrRoles('admin'),
  ctrl.deleteOvertime
);

module.exports = router;
