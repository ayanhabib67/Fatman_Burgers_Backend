const AppError = require('../../../shared/errors/AppError');
const Employee = require('../models/Employee');
const { verifyToken } = require('../services/auth.service');

const requireHrAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['x-hr-token'];
    const employeeId = verifyToken(token);
    if (!employeeId) throw new AppError('Unauthorized', 401);

    const user = await Employee.findOne({
      _id: employeeId,
      deletedAt: null,
      status: 'active',
    }).populate('department');

    if (!user) throw new AppError('Unauthorized', 401);
    req.hrUser = user;
    next();
  } catch (err) {
    next(err);
  }
};

const requireHrRoles = (...roles) => (req, res, next) => {
  if (!req.hrUser) return next(new AppError('Unauthorized', 401));
  if (!roles.includes(req.hrUser.hrRole)) {
    return next(new AppError('Forbidden', 403));
  }
  return next();
};

module.exports = {
  requireHrAuth,
  requireHrRoles,
};
