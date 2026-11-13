const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Employee = require('../models/Employee');
const AppError = require('../../../shared/errors/AppError');
const config = require('../../../config');
const { publicEmployee } = require('./employee.service');
const { getSettings } = require('./settings.service');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const signToken = (employeeId) => {
  const secret = config.hrTokenSecret || 'fatman-hr-dev-secret';
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = Buffer.from(JSON.stringify({ sub: String(employeeId), exp })).toString(
    'base64url'
  );
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
};

const verifyToken = (token) => {
  if (!token) return null;
  const secret = config.hrTokenSecret || 'fatman-hr-dev-secret';
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.sub;
  } catch {
    return null;
  }
};

const login = async ({ email, password }) => {
  if (!email || !password) throw new AppError('Email and password required', 400);

  const employee = await Employee.findOne({
    workEmail: String(email).trim().toLowerCase(),
    deletedAt: null,
    status: 'active',
  }).select('+portalPasswordHash');

  if (!employee?.portalPasswordHash) {
    throw new AppError('Invalid credentials', 401);
  }

  const ok = await bcrypt.compare(String(password), employee.portalPasswordHash);
  if (!ok) throw new AppError('Invalid credentials', 401);

  employee.lastPortalLoginAt = new Date();
  await employee.save();

  const settings = await getSettings();
  const populated = await Employee.findById(employee._id)
    .populate('department')
    .populate('shift');

  return {
    token: signToken(employee._id),
    user: publicEmployee(populated, settings),
  };
};

const me = async (employeeId) => {
  const settings = await getSettings();
  const populated = await Employee.findOne({
    _id: employeeId,
    deletedAt: null,
    status: 'active',
  })
    .populate('department')
    .populate('shift');
  if (!populated) throw new AppError('Session expired', 401);
  return publicEmployee(populated, settings);
};

module.exports = {
  login,
  me,
  signToken,
  verifyToken,
};
