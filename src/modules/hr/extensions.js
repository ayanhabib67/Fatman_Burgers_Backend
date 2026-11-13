/**
 * Extension points for later HR slices (do not implement here yet).
 *
 * Slice 2: devices, raw punches, manual punch, attendance worker/engine
 * Slice 3: timesheets grid, staff presence board
 * Slice 4: leave, holidays, balances, dashboard payload
 * Slice 5: attendance corrections, overtime sessions
 *
 * Explicitly OUT OF SCOPE for this HR module:
 * payroll, payslips, tax, loans, recruitment, interviews, letters,
 * notices, tasks, training, announcements, official-visit workflows,
 * student attendance, SMS/email alert campaigns.
 *
 * ZKTeco LAN agent (node-zklib · TCP/UDP 4370) is LIVE via zkAgent.service.
 */
module.exports = {
  plannedCollections: [
    'HrDevice',
    'HrPunch',
    'HrAttendanceDay',
    'HrAttendanceMovement',
    'HrLeaveRequest',
    'HrLeaveAudit',
    'HrHoliday',
    'HrCorrection',
    'HrOvertimeSession',
  ],
};
