const terraformService = require('../services/terraform');
const createTerraformQueue = require('../queues/terraformQueue');
const Job = require('../models/Job');
const logger = require('../utils/logger');

let processor = null;

const start = async () => {
  if (processor) {
    logger.info('Terraform worker already started');
    return;
  }

  const queue = await createTerraformQueue();

  processor = queue.process(async (job) => {
    const { operation, deploymentId, options = {} } = job.data;

    logger.info('Processing Terraform job', {
      jobId: job.id,
      operation,
      deploymentId
    });

    // Create job record
    const jobRecord = new Job({
      jobId: job.id.toString(),
      type: `terraform_${operation}`,
      data: job.data,
      status: 'active',
      startedAt: new Date()
    });
    await jobRecord.save();

    try {
      job.progress(10);

      let result;

      switch (operation) {
        case 'init':
          result = await terraformService.init(deploymentId);
          break;
        case 'plan':
          result = await terraformService.plan(deploymentId, options);
          break;
        case 'apply':
          job.progress(30);
          result = await terraformService.apply(deploymentId, options);
          job.progress(90);
          break;
        case 'destroy':
          result = await terraformService.destroy(deploymentId, options);
          break;
        case 'validate':
          result = await terraformService.validate(deploymentId);
          break;
        default:
          throw new Error(`Unknown Terraform operation: ${operation}`);
      }

      job.progress(100);

      // Update job record
      jobRecord.status = 'completed';
      jobRecord.result = result;
      jobRecord.completedAt = new Date();
      await jobRecord.save();

      return result;
    } catch (error) {
      logger.error('Terraform job failed', {
        jobId: job.id,
        operation,
        error: error.message
      });

      // Update job record
      jobRecord.status = 'failed';
      jobRecord.error = {
        message: error.message,
        stack: error.stack
      };
      jobRecord.completedAt = new Date();
      await jobRecord.save();

      throw error;
    }
  });

  logger.info('Terraform worker started');
};

const stop = async () => {
  if (processor) {
    await processor.close();
    processor = null;
    logger.info('Terraform worker stopped');
  }
};

module.exports = {
  start,
  stop
};

