const EmployeeAudit = require('../models/EmployeeAudit');

const writeAudit = async ({ employeeId, actor, action, summary, meta = {} }) => {
  return EmployeeAudit.create({
    employee: employeeId,
    actor: actor?._id || null,
    actorName: actor?.displayName || 'system',
    action,
    summary,
    meta,
  });
};

const listAudit = async (employeeId, { limit = 50 } = {}) => {
  return EmployeeAudit.find({ employee: employeeId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

module.exports = { writeAudit, listAudit };
