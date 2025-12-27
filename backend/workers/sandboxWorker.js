const sandboxService = require('../services/sandbox');
const sandboxOrchestrator = require('../services/sandboxOrchestrator');
const createSandboxQueue = require('../queues/sandboxQueue');
const Job = require('../models/Job');
const logger = require('../utils/logger');

let processor = null;

const start = async () => {
  if (processor) {
    logger.info('Sandbox worker already started');
    return;
  }

  const queue = await createSandboxQueue();

  processor = queue.process(async (job) => {
    const { operation, sandboxId, deploymentId, options = {} } = job.data;

    logger.info('Processing sandbox job', {
      jobId: job.id,
      operation,
      sandboxId
    });

    // Create job record
    const jobRecord = new Job({
      jobId: job.id.toString(),
      type: `sandbox_${operation}`,
      data: job.data,
      status: 'active',
      startedAt: new Date()
    });
    await jobRecord.save();

    try {
      job.progress(10);

      let result;

      switch (operation) {
        case 'create':
          result = await sandboxService.create(deploymentId, options.durationHours);
          break;
        case 'test':
          job.progress(30);
          result = await sandboxService.runTests(sandboxId);
          job.progress(90);
          break;
        case 'deploy_and_test':
          // Complete workflow: create sandbox -> deploy terraform -> run tests
          job.progress(10);
          logger.info('Starting deploy_and_test workflow', { deploymentId });
          result = await sandboxOrchestrator.deployToSandboxAndTest(deploymentId, options);
          job.progress(100);
          break;
        case 'destroy':
          result = await sandboxService.destroy(sandboxId);
          break;
        case 'extend':
          result = await sandboxService.extend(sandboxId, options.additionalHours);
          break;
        default:
          throw new Error(`Unknown sandbox operation: ${operation}`);
      }

      job.progress(100);

      // Update job record
      jobRecord.status = 'completed';
      jobRecord.result = result;
      jobRecord.completedAt = new Date();
      await jobRecord.save();

      return result;
    } catch (error) {
      logger.error('Sandbox job failed', {
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

  logger.info('Sandbox worker started');
};

const stop = async () => {
  if (processor) {
    await processor.close();
    processor = null;
    logger.info('Sandbox worker stopped');
  }
};

module.exports = {
  start,
  stop
};

