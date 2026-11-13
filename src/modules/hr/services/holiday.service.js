const Holiday = require('../models/Holiday');
const AppError = require('../../../shared/errors/AppError');

const listHolidays = async ({ year } = {}) => {
  const filter = { active: true };
  if (year) filter.date = { $regex: `^${year}` };
  return Holiday.find(filter).sort({ date: 1 }).lean();
};

const upsertHoliday = async ({ date, name, portion = 'full' }) => {
  if (!date || !name) throw new AppError('date and name required', 400);
  return Holiday.findOneAndUpdate(
    { date },
    { $set: { name: String(name).trim(), portion, active: true } },
    { upsert: true, returnDocument: 'after' }
  );
};

const removeHoliday = async (id) => {
  const row = await Holiday.findByIdAndUpdate(
    id,
    { $set: { active: false } },
    { returnDocument: 'after' }
  );
  if (!row) throw new AppError('Holiday not found', 404);
  return row;
};

module.exports = { listHolidays, upsertHoliday, removeHoliday };
