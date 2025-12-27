const Deployment = require('../models/Deployment');
const terraformService = require('./terraform');
const awsService = require('./aws');
const logger = require('../utils/logger');

/**
 * Rollback Service
 * Handles deployment rollback operations
 */
class RollbackService {
  /**
   * Generate rollback plan
   */
  async generateRollbackPlan(deploymentId, targetVersion = null) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }
      
      if (!deployment.canRollback || deployment.version <= 1) {
        throw new Error('Cannot rollback: no previous version available');
      }
      
      const currentVersion = deployment.version;
      const rollbackVersion = targetVersion || currentVersion - 1;
      
      if (rollbackVersion < 1 || rollbackVersion >= currentVersion) {
        throw new Error('Invalid rollback version');
      }
      
      // Get current and previous state
      const currentState = await terraformService.getState(deploymentId);
      const previousState = await this.getStateVersion(deploymentId, rollbackVersion);
      
      if (!previousState) {
        throw new Error(`State version ${rollbackVersion} not found`);
      }
      
      // Compare states to determine what needs to be rolled back
      const stateDiff = this.compareStates(currentState, previousState);
      
      return {
        deploymentId,
        fromVersion: currentVersion,
        toVersion: rollbackVersion,
        stateDiff,
        resourcesToRollback: stateDiff.changes,
        estimatedTime: this.estimateRollbackTime(stateDiff),
        timestamp: new Date()
      };
      
    } catch (error) {
      logger.error('Generate rollback plan error:', error);
      throw error;
    }
  }

  /**
   * Execute rollback
   */
  async executeRollback(deploymentId, targetVersion = null, reason = '') {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }
      
      // Generate rollback plan
      const rollbackPlan = await this.generateRollbackPlan(deploymentId, targetVersion);
      
      // Update deployment status
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          status: 'ROLLING_BACK',
          $push: {
            statusHistory: {
              status: 'ROLLING_BACK',
              timestamp: new Date(),
              reason
            }
          }
        }
      );
      
      // Get previous state
      const previousState = await this.getStateVersion(deploymentId, rollbackPlan.toVersion);
      
      // Apply previous state
      const result = await terraformService.apply(deploymentId, {
        stateFile: previousState,
        autoApprove: true
      });
      
      // Verify rollback
      const verification = await this.verifyRollback(deploymentId, rollbackPlan);
      
      if (verification.success) {
        // Update deployment
        await Deployment.findOneAndUpdate(
          { deploymentId },
          {
            status: 'ROLLED_BACK',
            version: rollbackPlan.toVersion,
            canRollback: rollbackPlan.toVersion > 1,
            $push: {
              statusHistory: {
                status: 'ROLLED_BACK',
                timestamp: new Date(),
                reason
              }
            }
          }
        );
        
        logger.info('Rollback completed successfully', { deploymentId, toVersion: rollbackPlan.toVersion });
        
        return {
          success: true,
          rollbackPlan,
          verification
        };
      } else {
        throw new Error('Rollback verification failed');
      }
      
    } catch (error) {
      logger.error('Rollback execution error:', error);
      
      // Update deployment status
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          status: 'ROLLBACK_FAILED',
          $push: {
            statusHistory: {
              status: 'ROLLBACK_FAILED',
              timestamp: new Date(),
              reason: error.message
            }
          }
        }
      );
      
      throw error;
    }
  }

  /**
   * Get state version
   */
  async getStateVersion(deploymentId, version) {
    try {
      // In production, retrieve from S3 versioning
      // For now, try to get from current state
      const state = await terraformService.getState(deploymentId);
      
      if (!state) {
        return null;
      }
      
      // Store version info in state metadata
      return {
        ...state,
        version,
        retrievedAt: new Date()
      };
      
    } catch (error) {
      logger.error('Get state version error:', error);
      return null;
    }
  }

  /**
   * Compare two Terraform states
   */
  compareStates(currentState, previousState) {
    const changes = {
      added: [],
      removed: [],
      modified: []
    };
    
    if (!currentState || !previousState) {
      return { changes, summary: 'Unable to compare states' };
    }
    
    const currentResources = currentState.resources || [];
    const previousResources = previousState.resources || [];
    
    // Find added resources
    currentResources.forEach(resource => {
      const exists = previousResources.find(r => 
        r.type === resource.type && r.name === resource.name
      );
      if (!exists) {
        changes.added.push(resource);
      }
    });
    
    // Find removed resources
    previousResources.forEach(resource => {
      const exists = currentResources.find(r => 
        r.type === resource.type && r.name === resource.name
      );
      if (!exists) {
        changes.removed.push(resource);
      }
    });
    
    // Find modified resources
    currentResources.forEach(resource => {
      const previous = previousResources.find(r => 
        r.type === resource.type && r.name === resource.name
      );
      if (previous && JSON.stringify(resource) !== JSON.stringify(previous)) {
        changes.modified.push({
          resource,
          previous
        });
      }
    });
    
    return {
      changes,
      summary: {
        added: changes.added.length,
        removed: changes.removed.length,
        modified: changes.modified.length
      }
    };
  }

  /**
   * Estimate rollback time
   */
  estimateRollbackTime(stateDiff) {
    const totalChanges = 
      stateDiff.changes.added.length +
      stateDiff.changes.removed.length +
      stateDiff.changes.modified.length;
    
    // Estimate 30 seconds per resource change
    return totalChanges * 30;
  }

  /**
   * Verify rollback success
   */
  async verifyRollback(deploymentId, rollbackPlan) {
    try {
      // Get current state after rollback
      const currentState = await terraformService.getState(deploymentId);
      
      // Compare with target state
      const targetState = await this.getStateVersion(deploymentId, rollbackPlan.toVersion);
      
      // Simple verification: check if key resources match
      const verification = {
        success: true,
        checks: []
      };
      
      if (currentState && targetState) {
        const currentResources = currentState.resources || [];
        const targetResources = targetState.resources || [];
        
        // Check if resource counts match
        if (currentResources.length === targetResources.length) {
          verification.checks.push({
            check: 'resource_count',
            passed: true
          });
        } else {
          verification.checks.push({
            check: 'resource_count',
            passed: false,
            message: `Expected ${targetResources.length} resources, found ${currentResources.length}`
          });
          verification.success = false;
        }
      }
      
      return verification;
      
    } catch (error) {
      logger.error('Verify rollback error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available rollback versions
   */
  async getRollbackVersions(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }
      
      return deployment.previousVersions || [];
      
    } catch (error) {
      logger.error('Get rollback versions error:', error);
      throw error;
    }
  }
}

// Singleton instance
const rollbackService = new RollbackService();

module.exports = rollbackService;

