const authService = require('./auth.service');
const ApiResponse = require('../../shared/utils/ApiResponse');
const asyncHandler = require('../../shared/utils/asyncHandler');
const AppError = require('../../shared/errors/AppError');

const register = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    throw new AppError('name, email and password are required', 400);
  }

  const user = await authService.registerUser({ name, email, password, role });
  return ApiResponse.created(res, user, 'User registered successfully');
});

const listUsers = asyncHandler(async (req, res) => {
  const users = await authService.getUsers();
  return ApiResponse.success(res, users, 'Users fetched successfully');
});

module.exports = {
  register,
  listUsers,
};
