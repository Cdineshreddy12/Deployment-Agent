const mongoose = require('mongoose');
const logger = require('../utils/logger');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    logger.info('Using existing MongoDB connection');
    return;
  }

  try {
    // Use environment variable or fallback to hardcoded URI
    const mongoURI = process.env.MONGODB_URI || 'mongodb+srv://copilotlaunch:Dinesh9959%23@development.7ydtx.mongodb.net/deployment-agent?retryWrites=true&w=majority&appName=development';
    
    // Modern Mongoose doesn't need these options
    const options = {};

    await mongoose.connect(mongoURI, options);
    
    isConnected = true;
    logger.info('MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      isConnected = false;
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      isConnected = true;
    });

  } catch (error) {
    logger.error('MongoDB connection failed:', error);
    isConnected = false;
    throw error;
  }
};

const disconnectDB = async () => {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected');
  }
};

module.exports = {
  connectDB,
  disconnectDB,
  isConnected: () => isConnected
};

