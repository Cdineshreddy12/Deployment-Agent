const sandboxService = require('../services/sandbox');
const createSandboxQueue = require('../queues/sandboxQueue');
const logger = require('../utils/logger');

let intervalId = null;

const start = async () => {
  if (intervalId) {
    logger.info('Cleanup worker already started');
    return;
  }

  // Run cleanup every hour
  const cleanupInterval = 60 * 60 * 1000; // 1 hour

  const runCleanup = async () => {
    try {
      logger.info('Running sandbox cleanup');
      const result = await sandboxService.cleanupExpired();
      logger.info('Sandbox cleanup completed', { cleaned: result.cleaned });
    } catch (error) {
      logger.error('Sandbox cleanup error:', error);
    }
  };

  // Run immediately on start
  await runCleanup();

  // Then run on interval
  intervalId = setInterval(runCleanup, cleanupInterval);

  logger.info('Cleanup worker started', { interval: cleanupInterval });
};

const stop = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Cleanup worker stopped');
  }
};

module.exports = {
  start,
  stop
};

