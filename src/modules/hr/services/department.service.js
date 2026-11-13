const Department = require('../models/Department');
const AppError = require('../../../shared/errors/AppError');

const FIXED_DEPARTMENTS = ['Fatman Burgers', 'Whipped Coffee', 'Greenwich Padel'];

const ensureFixedDepartments = async () => {
  for (const name of FIXED_DEPARTMENTS) {
    const existing = await Department.findOne({ name });
    if (!existing) {
      await Department.create({ name, active: true });
    } else if (!existing.active) {
      existing.active = true;
      await existing.save();
    }
  }
  // Keep only the three brands active
  await Department.updateMany(
    { name: { $nin: FIXED_DEPARTMENTS } },
    { $set: { active: false } }
  );
};

const listDepartments = async ({ activeOnly = false } = {}) => {
  await ensureFixedDepartments();
  const filter = activeOnly ? { active: true } : { name: { $in: FIXED_DEPARTMENTS } };
  return Department.find(filter).sort({ name: 1 }).lean();
};

const createDepartment = async ({ name }) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new AppError('Department name is required', 400);
  try {
    return await Department.create({ name: trimmed, active: true });
  } catch (err) {
    if (err.code === 11000) throw new AppError('Department already exists', 409);
    throw err;
  }
};

const updateDepartment = async (id, patch) => {
  const row = await Department.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true }
  );
  if (!row) throw new AppError('Department not found', 404);
  return row;
};

module.exports = {
  FIXED_DEPARTMENTS,
  ensureFixedDepartments,
  listDepartments,
  createDepartment,
  updateDepartment,
};
