const User = require('./auth.model');
const AppError = require('../../shared/errors/AppError');

const registerUser = async ({ name, email, password, role }) => {
  const existing = await User.findOne({ email });

  if (existing) {
    throw new AppError('Email already registered', 409);
  }

  // Password hashing will be added when auth is fully implemented
  const user = await User.create({ name, email, password, role });

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
};

const getUsers = async () => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  return users;
};

module.exports = {
  registerUser,
  getUsers,
};
