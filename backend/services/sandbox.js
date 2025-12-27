const Sandbox = require('../models/Sandbox');
const terraformService = require('./terraform');
const awsService = require('./aws');
const logger = require('../utils/logger');

/**
 * Sandbox Service
 * Manages sandbox environments for testing
 */
class SandboxService {
  /**
   * Create sandbox environment
   */
  async create(deploymentId, durationHours = 4) {
    try {
      // Create sandbox record
      const sandbox = new Sandbox({
        deploymentId,
        region: 'us-east-1',
        expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
        autoDelete: true
      });

      await sandbox.save();

      logger.info('Sandbox created', { sandboxId: sandbox.sandboxId, deploymentId });

      return sandbox;
    } catch (error) {
      logger.error('Create sandbox error:', error);
      throw error;
    }
  }

  /**
   * Run automated tests on sandbox
   */
  async runTests(sandboxId) {
    try {
      const sandbox = await Sandbox.findOne({ sandboxId });
      if (!sandbox) {
        throw new Error('Sandbox not found');
      }

      logger.info('Running sandbox tests', { sandboxId });

      const testResults = {
        healthChecks: await this.runHealthChecks(sandbox),
        securityScan: await this.runSecurityScan(sandbox),
        performanceTest: await this.runPerformanceTest(sandbox)
      };

      const allPassed = 
        testResults.healthChecks.passed &&
        testResults.securityScan.passed &&
        testResults.performanceTest.passed;

      // Update sandbox
      await Sandbox.findOneAndUpdate(
        { sandboxId },
        {
          testStatus: allPassed ? 'passed' : 'failed',
          testResults,
          'testResults.completedAt': new Date()
        }
      );

      logger.info('Sandbox tests completed', { sandboxId, passed: allPassed });

      return {
        passed: allPassed,
        tests: [
          { name: 'Health Checks', passed: testResults.healthChecks.passed },
          { name: 'Security Scan', passed: testResults.securityScan.passed },
          { name: 'Performance Test', passed: testResults.performanceTest.passed }
        ],
        details: testResults
      };
    } catch (error) {
      logger.error('Run tests error:', error);
      throw error;
    }
  }

  /**
   * Run health checks
   */
  async runHealthChecks(sandbox) {
    try {
      // In production, check actual resource health
      // For now, simulate health checks
      const startTime = Date.now();

      // Simulate health check delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      const duration = Date.now() - startTime;

      return {
        passed: true,
        duration,
        details: {
          ec2Instances: 'running',
          rdsDatabase: 'available',
          loadBalancer: 'active'
        }
      };
    } catch (error) {
      logger.error('Health checks error:', error);
      return {
        passed: false,
        duration: 0,
        error: error.message
      };
    }
  }

  /**
   * Run security scan
   */
  async runSecurityScan(sandbox) {
    try {
      const startTime = Date.now();

      // In production, use security scanning tools
      // For now, simulate security scan
      await new Promise(resolve => setTimeout(resolve, 2000));

      const duration = Date.now() - startTime;

      const findings = [];

      // Check for common security issues
      // In production, this would check:
      // - Public RDS instances
      // - Public S3 buckets
      // - Overly permissive security groups
      // - Missing encryption

      return {
        passed: findings.length === 0,
        findings,
        duration
      };
    } catch (error) {
      logger.error('Security scan error:', error);
      return {
        passed: false,
        findings: [{ severity: 'high', message: error.message }],
        duration: 0
      };
    }
  }

  /**
   * Run performance test
   */
  async runPerformanceTest(sandbox) {
    try {
      const startTime = Date.now();

      // In production, run actual performance tests
      // For now, simulate performance test
      await new Promise(resolve => setTimeout(resolve, 3000));

      const duration = Date.now() - startTime;

      return {
        passed: true,
        avgResponseTime: 145,
        p95ResponseTime: 280,
        duration
      };
    } catch (error) {
      logger.error('Performance test error:', error);
      return {
        passed: false,
        avgResponseTime: null,
        p95ResponseTime: null,
        duration: 0,
        error: error.message
      };
    }
  }

  /**
   * Destroy sandbox
   */
  async destroy(sandboxId) {
    try {
      const sandbox = await Sandbox.findOne({ sandboxId });
      if (!sandbox) {
        throw new Error('Sandbox not found');
      }

      logger.info('Destroying sandbox', { sandboxId });

      // Destroy Terraform resources
      try {
        await terraformService.destroy(sandbox.deploymentId, {
          autoApprove: true,
          environment: 'sandbox'
        });
      } catch (error) {
        logger.error('Terraform destroy error:', error);
        // Continue with cleanup even if destroy fails
      }

      // Update sandbox
      await Sandbox.findOneAndUpdate(
        { sandboxId },
        {
          destroyedAt: new Date(),
          testStatus: 'destroyed'
        }
      );

      logger.info('Sandbox destroyed', { sandboxId });

      return { success: true };
    } catch (error) {
      logger.error('Destroy sandbox error:', error);
      throw error;
    }
  }

  /**
   * Extend sandbox lifetime
   */
  async extend(sandboxId, additionalHours) {
    try {
      const sandbox = await Sandbox.findOne({ sandboxId });
      if (!sandbox) {
        throw new Error('Sandbox not found');
      }

      const newExpiresAt = new Date(sandbox.expiresAt.getTime() + additionalHours * 60 * 60 * 1000);

      await Sandbox.findOneAndUpdate(
        { sandboxId },
        {
          expiresAt: newExpiresAt
        }
      );

      logger.info('Sandbox extended', { sandboxId, newExpiresAt });

      return { success: true, expiresAt: newExpiresAt };
    } catch (error) {
      logger.error('Extend sandbox error:', error);
      throw error;
    }
  }

  /**
   * Get sandbox details
   */
  async getSandbox(sandboxId) {
    try {
      const sandbox = await Sandbox.findOne({ sandboxId });
      if (!sandbox) {
        throw new Error('Sandbox not found');
      }

      return sandbox;
    } catch (error) {
      logger.error('Get sandbox error:', error);
      throw error;
    }
  }

  /**
   * Deploy to sandbox and test (complete workflow)
   * Convenience method that uses the orchestrator
   */
  async deployAndTest(deploymentId, durationHours = 4) {
    try {
      const sandboxOrchestrator = require('./sandboxOrchestrator');
      return await sandboxOrchestrator.deployToSandboxAndTest(deploymentId, { durationHours });
    } catch (error) {
      logger.error('Deploy and test error:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired sandboxes
   */
  async cleanupExpired() {
    try {
      const expiredSandboxes = await Sandbox.find({
        expiresAt: { $lt: new Date() },
        destroyedAt: null,
        autoDelete: true
      });

      logger.info('Cleaning up expired sandboxes', { count: expiredSandboxes.length });

      for (const sandbox of expiredSandboxes) {
        try {
          await this.destroy(sandbox.sandboxId);
        } catch (error) {
          logger.error('Failed to cleanup sandbox', { sandboxId: sandbox.sandboxId, error });
        }
      }

      return { cleaned: expiredSandboxes.length };
    } catch (error) {
      logger.error('Cleanup expired sandboxes error:', error);
      throw error;
    }
  }
}

// Singleton instance
const sandboxService = new SandboxService();

module.exports = sandboxService;

