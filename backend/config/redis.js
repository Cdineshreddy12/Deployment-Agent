// TODO: Redis - Commented out for now, uncomment when Redis is available
// const redis = require('redis');
const logger = require('../utils/logger');

let redisClient = null;

const connectRedis = async () => {
  // TODO: Redis - Commented out for now, uncomment when Redis is available
  logger.warn('Redis is disabled. Queue workers and caching features will not work.');
  return null;
  
  /* COMMENTED OUT - Uncomment when Redis is available
  if (redisClient && redisClient.isOpen) {
    logger.info('Using existing Redis connection');
    return redisClient;
  }

  try {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || 6379;

    redisClient = redis.createClient({
      socket: {
        host,
        port: parseInt(port)
      }
    });

    redisClient.on('error', (err) => {
      logger.error('Redis connection error:', err);
    });

    redisClient.on('connect', () => {
      logger.info('Redis connecting...');
    });

    redisClient.on('ready', () => {
      logger.info('Redis connected successfully');
    });

    redisClient.on('end', () => {
      logger.warn('Redis connection ended');
    });

    await redisClient.connect();

    return redisClient;

  } catch (error) {
    logger.error('Redis connection failed:', error);
    throw error;
  }
  */
};

const getRedisClient = () => {
  // TODO: Redis - Commented out for now, uncomment when Redis is available
  throw new Error('Redis is disabled. Please enable Redis to use this feature.');
  
  /* COMMENTED OUT - Uncomment when Redis is available
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis client not connected');
  }
  return redisClient;
  */
};

const disconnectRedis = async () => {
  // TODO: Redis - Commented out for now, uncomment when Redis is available
  logger.warn('Redis disconnect called but Redis is disabled');
  return;
  
  /* COMMENTED OUT - Uncomment when Redis is available
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected');
  }
  */
};

module.exports = {
  connectRedis,
  getRedisClient,
  disconnectRedis
};

