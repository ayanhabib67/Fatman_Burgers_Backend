const mongoose = require('mongoose');
const config = require('./index');

const connectDB = async () => {
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.mongoUri);

  console.log(`MongoDB connected: ${mongoose.connection.host}`);
};

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
});

module.exports = connectDB;
