const sandboxService = require('./sandbox');
const terraformService = require('./terraform');
const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');

/**
 * Sandbox Orchestrator Service
 * Orchestrates the complete sandbox deployment and testing workflow
 */
class SandboxOrchestrator {
  /**
   * Deploy to sandbox and run tests
   * Complete workflow: create sandbox -> deploy terraform -> run tests
   */
  async deployToSandboxAndTest(deploymentId, options = {}) {
    const { durationHours = 4, autoApprove = true } = options;
    
    try {
      logger.info('Starting sandbox deployment and test workflow', { deploymentId });

      // Step 1: Validate deployment has Terraform code
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      if (!deployment.terraformCode || !deployment.terraformCode.main) {
        throw new Error('Deployment does not have Terraform code. Please generate Terraform code first.');
      }

      // Step 2: Create sandbox environment
      logger.info('Creating sandbox environment', { deploymentId });
      const sandbox = await sandboxService.create(deploymentId, durationHours);
      const sandboxId = sandbox.sandboxId;

      // Update deployment with sandbox reference
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          sandboxId: sandbox._id,
          status: 'SANDBOX_DEPLOYING'
        }
      );

      // Step 3: Initialize Terraform (if not already done)
      try {
        logger.info('Initializing Terraform for sandbox', { deploymentId });
        await terraformService.init(deploymentId);
      } catch (error) {
        // If init fails, it might already be initialized, continue
        logger.warn('Terraform init warning (may already be initialized)', {
          deploymentId,
          error: error.message
        });
      }

      // Step 4: Apply Terraform to sandbox environment
      logger.info('Applying Terraform to sandbox environment', { deploymentId, sandboxId });
      const applyResult = await terraformService.apply(deploymentId, {
        autoApprove,
        environment: 'sandbox'
      });

      // Update deployment status
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          status: 'TESTING',
          'terraformStateKey': applyResult.state?.key || deployment.terraformStateKey
        }
      );

      // Step 5: Run automated tests
      logger.info('Running automated tests on sandbox', { deploymentId, sandboxId });
      const testResults = await sandboxService.runTests(sandboxId);

      // Step 6: Update deployment with test results
      const finalStatus = testResults.passed ? 'SANDBOX_VALIDATED' : 'SANDBOX_FAILED';
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          status: finalStatus,
          sandboxTestResults: {
            passed: testResults.passed,
            tests: testResults.tests,
            completedAt: new Date()
          }
        }
      );

      logger.info('Sandbox deployment and test workflow completed', {
        deploymentId,
        sandboxId,
        passed: testResults.passed,
        status: finalStatus
      });

      return {
        success: true,
        sandboxId,
        sandbox: {
          sandboxId,
          deploymentId,
          expiresAt: sandbox.expiresAt,
          region: sandbox.region
        },
        terraformApply: {
          success: applyResult.success,
          resources: applyResult.resources || []
        },
        testResults: {
          passed: testResults.passed,
          tests: testResults.tests,
          details: testResults.details
        },
        status: finalStatus
      };

    } catch (error) {
      logger.error('Sandbox deployment and test workflow failed', {
        deploymentId,
        error: error.message,
        stack: error.stack
      });

      // Update deployment status to failed
      try {
        await Deployment.findOneAndUpdate(
          { deploymentId },
          {
            status: 'SANDBOX_FAILED',
            'sandboxTestResults.passed': false,
            'sandboxTestResults.error': error.message
          }
        );
      } catch (updateError) {
        logger.error('Failed to update deployment status', {
          deploymentId,
          error: updateError.message
        });
      }

      throw error;
    }
  }

  /**
   * Get sandbox deployment status
   */
  async getStatus(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId })
        .populate('sandboxId');

      if (!deployment) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      const result = {
        deploymentId,
        status: deployment.status,
        hasSandbox: !!deployment.sandboxId,
        sandboxTestResults: deployment.sandboxTestResults || null
      };

      if (deployment.sandboxId) {
        const sandbox = await sandboxService.getSandbox(deployment.sandboxId.sandboxId);
        result.sandbox = {
          sandboxId: sandbox.sandboxId,
          testStatus: sandbox.testStatus,
          expiresAt: sandbox.expiresAt,
          testResults: sandbox.testResults
        };
      }

      return result;
    } catch (error) {
      logger.error('Get sandbox status error:', error);
      throw error;
    }
  }
}

// Singleton instance
const sandboxOrchestrator = new SandboxOrchestrator();

module.exports = sandboxOrchestrator;

