const Queue = require('bull');
const { connectRedis } = require('../config/redis');
const logger = require('../utils/logger');

let sandboxQueue = null;

const createSandboxQueue = async () => {
  if (sandboxQueue) {
    return sandboxQueue;
  }

  await connectRedis();

  sandboxQueue = new Queue('sandbox', {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || 6379)
    },
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 3000
      },
      removeOnComplete: 50,
      removeOnFail: 200
    }
  });

  sandboxQueue.on('error', (error) => {
    logger.error('Sandbox queue error:', error);
  });

  sandboxQueue.on('completed', (job, result) => {
    logger.info('Sandbox job completed', { jobId: job.id });
  });

  sandboxQueue.on('failed', (job, error) => {
    logger.error('Sandbox job failed', { jobId: job.id, error: error.message });
  });

  return sandboxQueue;
};

module.exports = createSandboxQueue;

