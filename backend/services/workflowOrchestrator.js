const Deployment = require('../models/Deployment');
const terraformService = require('./terraform');
const terraformLifecycleManager = require('./terraformLifecycleManager');
const resourceVerificationService = require('./resourceVerificationService');
const errorRecoveryEngine = require('./errorRecoveryEngine');
const sandboxService = require('./sandbox');
const logger = require('../utils/logger');
const EventEmitter = require('events');

/**
 * Workflow Orchestrator
 * Central intelligence that coordinates all deployment steps
 * Manages complete deployment lifecycle with error handling and progress tracking
 */
class WorkflowOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.activeDeployments = new Map(); // deploymentId -> deploymentJob
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 5000]; // Exponential backoff in ms
  }

  /**
   * Start a deployment workflow
   * @param {string} deploymentId - Deployment ID
   * @param {object} options - Deployment options
   * @param {string} options.source - Source of deployment: 'chat' | 'ui' | 'api'
   * @param {boolean} options.autoApprove - Auto-approve Terraform apply
   * @param {number} options.durationHours - Sandbox duration in hours
   * @param {function} options.progressCallback - Callback for progress updates
   */
  async startDeployment(deploymentId, options = {}) {
    const {
      source = 'api',
      autoApprove = true,
      durationHours = 4,
      progressCallback = null
    } = options;

    // Check if deployment already in progress
    if (this.activeDeployments.has(deploymentId)) {
      const existingJob = this.activeDeployments.get(deploymentId);
      logger.warn('Deployment already in progress', { deploymentId, status: existingJob.status });
      return {
        success: false,
        error: 'Deployment already in progress',
        jobId: existingJob.jobId
      };
    }

    const jobId = `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const deploymentJob = {
      jobId,
      deploymentId,
      source,
      status: 'starting',
      phase: 'initialization',
      progress: 0,
      startedAt: new Date(),
      updatedAt: new Date(),
      error: null,
      retryCount: 0
    };

    this.activeDeployments.set(deploymentId, deploymentJob);

    // Emit progress event
    this.emitProgress(deploymentId, {
      phase: 'initialization',
      status: 'started',
      progress: 0,
      message: 'Deployment workflow started'
    }, progressCallback);

    try {
      // Step 1: Validate deployment
      await this.validateDeployment(deploymentId);

      // Step 2: Write Terraform files
      await this.writeTerraformFiles(deploymentId, progressCallback);

      // Step 3: Initialize Terraform
      await this.initializeTerraform(deploymentId, progressCallback);

      // Step 4: Run Terraform plan
      const planResult = await this.runTerraformPlan(deploymentId, progressCallback);

      // Step 5: Apply Terraform
      const applyResult = await this.runTerraformApply(deploymentId, { autoApprove }, progressCallback);

      // Step 6: Verify resources
      const verificationResult = await this.verifyResources(deploymentId, applyResult.resources, progressCallback);

      // Step 7: Update deployment status
      await this.updateDeploymentStatus(deploymentId, {
        status: 'DEPLOYED',
        resources: applyResult.resources,
        verification: verificationResult
      });

      deploymentJob.status = 'completed';
      deploymentJob.progress = 100;
      deploymentJob.completedAt = new Date();

      this.emitProgress(deploymentId, {
        phase: 'completed',
        status: 'success',
        progress: 100,
        message: 'Deployment completed successfully',
        resources: applyResult.resources,
        verification: verificationResult
      }, progressCallback);

      logger.info('Deployment workflow completed successfully', {
        deploymentId,
        jobId,
        resourcesCreated: applyResult.resources?.length || 0
      });

      return {
        success: true,
        jobId,
        deploymentId,
        resources: applyResult.resources,
        verification: verificationResult,
        status: 'completed'
      };

    } catch (error) {
      logger.error('Deployment workflow failed', {
        deploymentId,
        jobId,
        error: error.message,
        stack: error.stack
      });

      deploymentJob.status = 'failed';
      deploymentJob.error = error.message;
      deploymentJob.failedAt = new Date();

      this.emitProgress(deploymentId, {
        phase: deploymentJob.phase,
        status: 'failed',
        progress: deploymentJob.progress,
        message: `Deployment failed: ${error.message}`,
        error: error.message
      }, progressCallback);

      // Attempt rollback if critical failure
      if (this.isCriticalError(error)) {
        await this.attemptRollback(deploymentId, error);
      }

      // Update deployment status
      await this.updateDeploymentStatus(deploymentId, {
        status: 'FAILED',
        error: error.message
      });

      throw error;
    } finally {
      // Clean up after delay (keep for status queries)
      setTimeout(() => {
        this.activeDeployments.delete(deploymentId);
      }, 300000); // 5 minutes
    }
  }

  /**
   * Validate deployment before starting
   */
  async validateDeployment(deploymentId) {
    const deployment = await Deployment.findOne({ deploymentId });
    
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    if (!deployment.terraformCode || !deployment.terraformCode.main) {
      throw new Error('Deployment does not have Terraform code. Please generate Terraform code first.');
    }

    return deployment;
  }

  /**
   * Write Terraform files to disk
   */
  async writeTerraformFiles(deploymentId, progressCallback) {
    this.updateJobPhase(deploymentId, 'writing_files', 10);

    this.emitProgress(deploymentId, {
      phase: 'writing_files',
      status: 'in_progress',
      progress: 10,
      message: 'Writing Terraform files to disk...'
    }, progressCallback);

    try {
      const deployment = await Deployment.findOne({ deploymentId });
      await terraformLifecycleManager.writeFilesAtomically(deploymentId, deployment.terraformCode);

      this.updateJobPhase(deploymentId, 'writing_files', 20);

      this.emitProgress(deploymentId, {
        phase: 'writing_files',
        status: 'completed',
        progress: 20,
        message: 'Terraform files written successfully'
      }, progressCallback);
    } catch (error) {
      logger.error('Failed to write Terraform files', { deploymentId, error: error.message });
      throw new Error(`Failed to write Terraform files: ${error.message}`);
    }
  }

  /**
   * Initialize Terraform
   */
  async initializeTerraform(deploymentId, progressCallback) {
    this.updateJobPhase(deploymentId, 'initializing', 20);

    this.emitProgress(deploymentId, {
      phase: 'initializing',
      status: 'in_progress',
      progress: 20,
      message: 'Initializing Terraform...'
    }, progressCallback);

    try {
      await this.retryOperation(
        () => terraformLifecycleManager.initialize(deploymentId),
        deploymentId,
        'terraform_init'
      );

      this.updateJobPhase(deploymentId, 'initializing', 30);

      this.emitProgress(deploymentId, {
        phase: 'initializing',
        status: 'completed',
        progress: 30,
        message: 'Terraform initialized successfully'
      }, progressCallback);
    } catch (error) {
      logger.error('Terraform initialization failed', { deploymentId, error: error.message });
      throw new Error(`Terraform initialization failed: ${error.message}`);
    }
  }

  /**
   * Run Terraform plan
   */
  async runTerraformPlan(deploymentId, progressCallback) {
    this.updateJobPhase(deploymentId, 'planning', 30);

    this.emitProgress(deploymentId, {
      phase: 'planning',
      status: 'in_progress',
      progress: 30,
      message: 'Running Terraform plan...'
    }, progressCallback);

    try {
      const planResult = await terraformLifecycleManager.plan(deploymentId, {});

      this.updateJobPhase(deploymentId, 'planning', 50);

      this.emitProgress(deploymentId, {
        phase: 'planning',
        status: 'completed',
        progress: 50,
        message: `Terraform plan completed: ${planResult.changes?.add || 0} to add, ${planResult.changes?.change || 0} to change`,
        plan: planResult
      }, progressCallback);

      return planResult;
    } catch (error) {
      logger.error('Terraform plan failed', { deploymentId, error: error.message });
      throw new Error(`Terraform plan failed: ${error.message}`);
    }
  }

  /**
   * Run Terraform apply
   */
  async runTerraformApply(deploymentId, options, progressCallback) {
    this.updateJobPhase(deploymentId, 'applying', 50);

    this.emitProgress(deploymentId, {
      phase: 'applying',
      status: 'in_progress',
      progress: 50,
      message: 'Applying Terraform configuration...'
    }, progressCallback);

    try {
      // Simulate progress updates during apply
      const progressInterval = setInterval(() => {
        const job = this.activeDeployments.get(deploymentId);
        if (job && job.phase === 'applying' && job.progress < 80) {
          job.progress = Math.min(job.progress + 5, 80);
          this.emitProgress(deploymentId, {
            phase: 'applying',
            status: 'in_progress',
            progress: job.progress,
            message: 'Applying Terraform resources...'
          }, progressCallback);
        }
      }, 2000);

      const applyResult = await terraformLifecycleManager.apply(deploymentId, options);

      clearInterval(progressInterval);

      this.updateJobPhase(deploymentId, 'applying', 85);

      this.emitProgress(deploymentId, {
        phase: 'applying',
        status: 'completed',
        progress: 85,
        message: `Terraform apply completed: ${applyResult.resources?.length || 0} resources created`,
        resources: applyResult.resources
      }, progressCallback);

      return applyResult;
    } catch (error) {
      logger.error('Terraform apply failed', { deploymentId, error: error.message });
      throw new Error(`Terraform apply failed: ${error.message}`);
    }
  }

  /**
   * Verify resources after deployment
   */
  async verifyResources(deploymentId, resources, progressCallback) {
    this.updateJobPhase(deploymentId, 'verifying', 85);

    this.emitProgress(deploymentId, {
      phase: 'verifying',
      status: 'in_progress',
      progress: 85,
      message: 'Verifying deployed resources...'
    }, progressCallback);

    try {
      const resourceVerificationService = require('./resourceVerificationService');
      const verificationResult = await resourceVerificationService.verifyResources(
        deploymentId,
        resources || []
      );

      this.updateJobPhase(deploymentId, 'verifying', 95);

      this.emitProgress(deploymentId, {
        phase: 'verifying',
        status: 'completed',
        progress: 95,
        message: `Resource verification completed: ${verificationResult.verified || 0}/${verificationResult.total || 0} verified`,
        verification: verificationResult
      }, progressCallback);

      return verificationResult;
    } catch (error) {
      logger.warn('Resource verification failed', { deploymentId, error: error.message });
      // Don't fail deployment if verification fails, just warn
      return {
        verified: 0,
        total: resources?.length || 0,
        errors: [error.message]
      };
    }
  }

  /**
   * Update deployment status in database
   */
  async updateDeploymentStatus(deploymentId, updates) {
    try {
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          ...updates,
          updatedAt: new Date(),
          $push: {
            statusHistory: {
              status: updates.status || 'UNKNOWN',
              timestamp: new Date(),
              ...(updates.error && { reason: updates.error })
            }
          }
        }
      );
    } catch (error) {
      logger.error('Failed to update deployment status', { deploymentId, error: error.message });
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryOperation(operation, deploymentId, operationName) {
    const job = this.activeDeployments.get(deploymentId);
    let lastError;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        job.retryCount = attempt + 1;

        if (attempt < this.maxRetries - 1 && this.isRetryableError(error)) {
          const delay = this.retryDelays[attempt];
          logger.warn(`Retrying ${operationName}`, {
            deploymentId,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delay
          });

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }

    throw lastError;
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryablePatterns = [
      /timeout/i,
      /network/i,
      /connection/i,
      /temporary/i,
      /rate limit/i,
      /throttl/i
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Check if error is critical (requires rollback)
   */
  isCriticalError(error) {
    const criticalPatterns = [
      /state locked/i,
      /permission denied/i,
      /unauthorized/i,
      /invalid credentials/i
    ];

    return criticalPatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Attempt rollback on critical failure
   */
  async attemptRollback(deploymentId, error) {
    logger.warn('Attempting rollback due to critical error', {
      deploymentId,
      error: error.message
    });

    try {
      // Check if resources were partially created
      const deployment = await Deployment.findOne({ deploymentId });
      if (deployment.resources && deployment.resources.length > 0) {
        // Rollback would destroy created resources
        // For now, just log - full rollback implementation can be added later
        logger.info('Rollback would be triggered here', { deploymentId });
      }
    } catch (rollbackError) {
      logger.error('Rollback attempt failed', {
        deploymentId,
        error: rollbackError.message
      });
    }
  }

  /**
   * Update job phase and progress
   */
  updateJobPhase(deploymentId, phase, progress) {
    const job = this.activeDeployments.get(deploymentId);
    if (job) {
      job.phase = phase;
      job.progress = progress;
      job.updatedAt = new Date();
    }
  }

  /**
   * Emit progress event
   */
  emitProgress(deploymentId, progressData, callback) {
    const job = this.activeDeployments.get(deploymentId);
    if (job) {
      const progressEvent = {
        jobId: job.jobId,
        deploymentId,
        ...progressData,
        timestamp: new Date()
      };

      // Emit event for WebSocket listeners
      this.emit('progress', progressEvent);

      // Call callback if provided
      if (callback && typeof callback === 'function') {
        callback(progressEvent);
      }
    }
  }

  /**
   * Get deployment job status
   */
  getJobStatus(deploymentId) {
    return this.activeDeployments.get(deploymentId) || null;
  }

  /**
   * Cancel deployment
   */
  async cancelDeployment(deploymentId) {
    const job = this.activeDeployments.get(deploymentId);
    if (!job) {
      throw new Error('Deployment not found or not in progress');
    }

    if (job.status === 'completed' || job.status === 'failed') {
      throw new Error(`Cannot cancel deployment in ${job.status} state`);
    }

    job.status = 'cancelled';
    job.cancelledAt = new Date();

    // Attempt to stop Terraform if possible
    // (This would require tracking the Terraform process)

    this.activeDeployments.delete(deploymentId);

    await this.updateDeploymentStatus(deploymentId, {
      status: 'CANCELLED'
    });

    return { success: true, message: 'Deployment cancelled' };
  }
}

// Singleton instance
const workflowOrchestrator = new WorkflowOrchestrator();

module.exports = workflowOrchestrator;

