const Queue = require('bull');
const { connectRedis } = require('../config/redis');
const logger = require('../utils/logger');

let terraformQueue = null;

const createTerraformQueue = async () => {
  if (terraformQueue) {
    return terraformQueue;
  }

  await connectRedis();

  terraformQueue = new Queue('terraform', {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || 6379)
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 100,
      removeOnFail: 500
    }
  });

  terraformQueue.on('error', (error) => {
    logger.error('Terraform queue error:', error);
  });

  terraformQueue.on('waiting', (jobId) => {
    logger.debug('Terraform job waiting', { jobId });
  });

  terraformQueue.on('active', (job) => {
    logger.info('Terraform job started', { jobId: job.id, data: job.data });
  });

  terraformQueue.on('completed', (job, result) => {
    logger.info('Terraform job completed', { jobId: job.id, result });
  });

  terraformQueue.on('failed', (job, error) => {
    logger.error('Terraform job failed', { jobId: job.id, error: error.message });
  });

  return terraformQueue;
};

module.exports = createTerraformQueue;

