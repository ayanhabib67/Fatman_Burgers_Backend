const ApiResponse = require('../../shared/utils/ApiResponse');
const mongoose = require('mongoose');

const getHealth = (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  }[dbState] || 'unknown';

  return ApiResponse.success(res, {
    service: 'fatman-burgers-pos',
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
};

module.exports = { getHealth };
