const HrSettings = require('../models/HrSettings');

const getSettings = async () => {
  let row = await HrSettings.findOne({ key: 'default' });
  if (!row) {
    row = await HrSettings.create({ key: 'default' });
  }
  return row;
};

const updateSettings = async (patch = {}) => {
  const allowed = [
    'timezone',
    'attendanceCutoffDay',
    'employeeNumberPrefix',
    'defaultLeaveEntitlement',
    'arrivalGraceMinutes',
    'earlyGraceMinutes',
    'halfDayArrivalMinutes',
    'shortStayMinutes',
    'punchDedupeSeconds',
    'checkoutConfirmMinutes',
  ];
  const $set = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) $set[key] = patch[key];
  }
  return HrSettings.findOneAndUpdate(
    { key: 'default' },
    { $set },
    { upsert: true, returnDocument: 'after' }
  );
};

const nextEmployeeNumber = async () => {
  const row = await HrSettings.findOneAndUpdate(
    { key: 'default' },
    {
      $inc: { employeeNumberSequence: 1 },
      $setOnInsert: {
        key: 'default',
        timezone: 'Asia/Karachi',
        attendanceCutoffDay: 26,
        employeeNumberPrefix: 'FB',
        defaultLeaveEntitlement: 30,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );
  const prefix = row.employeeNumberPrefix || 'FB';
  return `${prefix}-${row.employeeNumberSequence}`;
};

module.exports = {
  getSettings,
  updateSettings,
  nextEmployeeNumber,
};
