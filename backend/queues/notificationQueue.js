const Queue = require('bull');
const { connectRedis } = require('../config/redis');
const logger = require('../utils/logger');

let notificationQueue = null;

const createNotificationQueue = async () => {
  if (notificationQueue) {
    return notificationQueue;
  }

  await connectRedis();

  notificationQueue = new Queue('notifications', {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || 6379)
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      },
      removeOnComplete: 200,
      removeOnFail: 1000
    }
  });

  notificationQueue.on('error', (error) => {
    logger.error('Notification queue error:', error);
  });

  notificationQueue.on('completed', (job, result) => {
    logger.debug('Notification job completed', { jobId: job.id });
  });

  notificationQueue.on('failed', (job, error) => {
    logger.error('Notification job failed', { jobId: job.id, error: error.message });
  });

  return notificationQueue;
};

module.exports = createNotificationQueue;

