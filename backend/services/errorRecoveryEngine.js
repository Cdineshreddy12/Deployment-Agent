const logger = require('../utils/logger');
const terraformService = require('./terraform');

/**
 * Error Recovery Engine
 * Intelligent error handling with retry logic and rollback capabilities
 */
class ErrorRecoveryEngine {
  constructor() {
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 5000]; // Exponential backoff in ms
    this.retryableErrors = [
      'timeout',
      'network',
      'connection',
      'temporary',
      'rate limit',
      'throttl',
      'service unavailable',
      'internal server error'
    ];
    this.criticalErrors = [
      'state locked',
      'permission denied',
      'unauthorized',
      'invalid credentials',
      'authentication failed'
    ];
    this.configurationErrors = [
      'syntax error',
      'invalid configuration',
      'missing required',
      'validation failed',
      'invalid parameter'
    ];
  }

  /**
   * Classify error type
   */
  classifyError(error) {
    const errorMessage = (error.message || '').toLowerCase();
    const errorCode = (error.code || '').toLowerCase();

    // Check for critical errors
    if (this.criticalErrors.some(pattern => 
      errorMessage.includes(pattern) || errorCode.includes(pattern)
    )) {
      return 'critical';
    }

    // Check for configuration errors
    if (this.configurationErrors.some(pattern => 
      errorMessage.includes(pattern) || errorCode.includes(pattern)
    )) {
      return 'configuration';
    }

    // Check for retryable errors
    if (this.retryableErrors.some(pattern => 
      errorMessage.includes(pattern) || errorCode.includes(pattern)
    )) {
      return 'retryable';
    }

    // Check AWS-specific error codes
    if (errorCode) {
      if (errorCode.includes('throttling') || errorCode.includes('ratelimit')) {
        return 'retryable';
      }
      if (errorCode.includes('unauthorized') || errorCode.includes('forbidden')) {
        return 'critical';
      }
      if (errorCode.includes('validation') || errorCode.includes('invalid')) {
        return 'configuration';
      }
    }

    // Default to permanent error
    return 'permanent';
  }

  /**
   * Determine if error should be retried
   */
  shouldRetry(error, attemptNumber) {
    if (attemptNumber >= this.maxRetries) {
      return false;
    }

    const errorType = this.classifyError(error);
    return errorType === 'retryable';
  }

  /**
   * Get retry delay for attempt
   */
  getRetryDelay(attemptNumber) {
    if (attemptNumber < this.retryDelays.length) {
      return this.retryDelays[attemptNumber];
    }
    // Exponential backoff beyond predefined delays
    return this.retryDelays[this.retryDelays.length - 1] * Math.pow(2, attemptNumber - this.retryDelays.length);
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryOperation(operation, context = {}) {
    const { deploymentId, operationName, maxRetries = this.maxRetries } = context;
    let lastError;
    let attemptNumber = 0;

    while (attemptNumber < maxRetries) {
      try {
        const result = await operation();
        
        if (attemptNumber > 0) {
          logger.info('Operation succeeded after retry', {
            deploymentId,
            operationName,
            attemptNumber
          });
        }

        return result;
      } catch (error) {
        lastError = error;
        attemptNumber++;

        if (!this.shouldRetry(error, attemptNumber)) {
          logger.warn('Error not retryable or max retries reached', {
            deploymentId,
            operationName,
            attemptNumber,
            errorType: this.classifyError(error),
            error: error.message
          });
          break;
        }

        const delay = this.getRetryDelay(attemptNumber - 1);
        logger.warn('Retrying operation after error', {
          deploymentId,
          operationName,
          attemptNumber,
          maxRetries,
          delay,
          error: error.message
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Check if error requires rollback
   */
  requiresRollback(error, deploymentPhase) {
    const errorType = this.classifyError(error);

    // Critical errors always require rollback if resources were created
    if (errorType === 'critical') {
      return deploymentPhase === 'applying' || deploymentPhase === 'verifying';
    }

    // Configuration errors don't require rollback (nothing was created)
    if (errorType === 'configuration') {
      return false;
    }

    // For other errors, rollback only if we're past the apply phase
    return deploymentPhase === 'verifying' || deploymentPhase === 'completed';
  }

  /**
   * Attempt rollback
   */
  async attemptRollback(deploymentId, error, deploymentPhase) {
    if (!this.requiresRollback(error, deploymentPhase)) {
      logger.debug('Rollback not required', {
        deploymentId,
        errorType: this.classifyError(error),
        deploymentPhase
      });
      return {
        attempted: false,
        reason: 'Rollback not required for this error type'
      };
    }

    logger.warn('Attempting rollback due to error', {
      deploymentId,
      error: error.message,
      deploymentPhase
    });

    try {
      // Check if Terraform state exists (resources were created)
      const state = await terraformService.getState(deploymentId);
      
      if (!state || !state.resources || state.resources.length === 0) {
        logger.info('No resources to rollback', { deploymentId });
        return {
          attempted: false,
          reason: 'No resources were created'
        };
      }

      // Perform Terraform destroy
      logger.info('Executing Terraform destroy for rollback', { deploymentId });
      await terraformService.destroy(deploymentId, { autoApprove: true });

      logger.info('Rollback completed successfully', {
        deploymentId,
        resourcesDestroyed: state.resources.length
      });

      return {
        attempted: true,
        success: true,
        resourcesDestroyed: state.resources.length
      };
    } catch (rollbackError) {
      logger.error('Rollback failed', {
        deploymentId,
        error: rollbackError.message
      });

      return {
        attempted: true,
        success: false,
        error: rollbackError.message
      };
    }
  }

  /**
   * Get error recovery strategy
   */
  getRecoveryStrategy(error) {
    const errorType = this.classifyError(error);
    const strategies = {
      retryable: {
        action: 'retry',
        maxRetries: this.maxRetries,
        delay: 'exponential_backoff',
        message: 'This appears to be a temporary error. Will retry automatically.'
      },
      configuration: {
        action: 'stop',
        retry: false,
        message: 'This is a configuration error. Please fix the configuration and try again.',
        suggestions: [
          'Check Terraform syntax',
          'Verify all required variables are set',
          'Review error details for specific issues'
        ]
      },
      critical: {
        action: 'rollback',
        retry: false,
        message: 'This is a critical error. Rollback may be required.',
        suggestions: [
          'Check AWS credentials',
          'Verify permissions',
          'Check if resources are locked'
        ]
      },
      permanent: {
        action: 'stop',
        retry: false,
        message: 'This error cannot be automatically recovered.',
        suggestions: [
          'Review error details',
          'Check AWS service status',
          'Contact support if issue persists'
        ]
      }
    };

    return strategies[errorType] || strategies.permanent;
  }

  /**
   * Format error message with recovery suggestions
   */
  formatErrorMessage(error, context = {}) {
    const strategy = this.getRecoveryStrategy(error);
    const { deploymentId, operationName } = context;

    let message = `Error during ${operationName || 'operation'}: ${error.message}\n\n`;
    message += `${strategy.message}\n\n`;

    if (strategy.suggestions) {
      message += 'Suggestions:\n';
      strategy.suggestions.forEach((suggestion, index) => {
        message += `${index + 1}. ${suggestion}\n`;
      });
    }

    return {
      message,
      strategy,
      errorType: this.classifyError(error),
      retryable: strategy.action === 'retry'
    };
  }

  /**
   * Handle error with appropriate recovery action
   */
  async handleError(error, context = {}) {
    const { deploymentId, operationName, deploymentPhase } = context;
    const errorType = this.classifyError(error);
    const strategy = this.getRecoveryStrategy(error);

    logger.error('Error recovery engine handling error', {
      deploymentId,
      operationName,
      errorType,
      strategy: strategy.action,
      error: error.message
    });

    const result = {
      error,
      errorType,
      strategy,
      handled: false
    };

    switch (strategy.action) {
      case 'retry':
        // Retry logic is handled by retryOperation method
        result.handled = true;
        result.message = 'Error will be retried automatically';
        break;

      case 'rollback':
        const rollbackResult = await this.attemptRollback(deploymentId, error, deploymentPhase);
        result.handled = rollbackResult.attempted;
        result.rollback = rollbackResult;
        break;

      case 'stop':
        result.handled = true;
        result.message = 'Operation stopped due to error';
        break;

      default:
        result.handled = false;
        result.message = 'No recovery strategy available';
    }

    return result;
  }
}

// Singleton instance
const errorRecoveryEngine = new ErrorRecoveryEngine();

module.exports = errorRecoveryEngine;





