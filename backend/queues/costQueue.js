const Queue = require('bull');
const { connectRedis } = require('../config/redis');
const logger = require('../utils/logger');

let costQueue = null;

const createCostQueue = async () => {
  if (costQueue) {
    return costQueue;
  }

  await connectRedis();

  costQueue = new Queue('costs', {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || 6379)
    },
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  costQueue.on('error', (error) => {
    logger.error('Cost queue error:', error);
  });

  costQueue.on('completed', (job, result) => {
    logger.debug('Cost job completed', { jobId: job.id });
  });

  costQueue.on('failed', (job, error) => {
    logger.error('Cost job failed', { jobId: job.id, error: error.message });
  });

  return costQueue;
};

module.exports = createCostQueue;

