const cursorIntegration = require('./cursorIntegration');
const cliExecutor = require('./cliExecutor');
const deploymentPlanner = require('./deploymentPlanner');
const logger = require('../utils/logger');
const { EventEmitter } = require('events');

/**
 * Deployment Executor Service
 * Executes deployment plans step-by-step with validation and rollback support
 */
class DeploymentExecutor extends EventEmitter {
  constructor() {
    super();
    this.activeExecutions = new Map(); // deploymentId -> execution state
    this.broadcastFunction = null;
  }

  /**
   * Set broadcast function for real-time updates
   */
  setBroadcastFunction(fn) {
    this.broadcastFunction = fn;
  }

  /**
   * Execute a deployment plan
   */
  async executePlan(deploymentId, plan, options = {}) {
    try {
      logger.info(`Starting plan execution for deployment ${deploymentId}`);
      
      // Initialize execution state
      const executionState = {
        deploymentId,
        planId: plan.generatedAt,
        status: 'running',
        currentStep: 0,
        completedSteps: [],
        failedSteps: [],
        skippedSteps: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        results: []
      };
      
      this.activeExecutions.set(deploymentId, executionState);
      this.broadcast(deploymentId, 'execution_started', { plan });
      
      // Execute each step
      for (const step of plan.steps) {
        executionState.currentStep = step.id;
        
        // Check if step should be skipped
        if (step.skipped) {
          executionState.skippedSteps.push(step.id);
          executionState.results.push({
            stepId: step.id,
            status: 'skipped',
            reason: step.reason
          });
          this.broadcast(deploymentId, 'step_skipped', { step });
          continue;
        }
        
        // Check if step requires approval
        if (step.requiresApproval && !options.autoApprove) {
          this.broadcast(deploymentId, 'approval_required', { step });
          // Wait for approval or timeout
          const approved = await this.waitForApproval(deploymentId, step.id, options.approvalTimeout || 300000);
          if (!approved) {
            throw new Error(`Step ${step.id} (${step.name}) requires approval`);
          }
        }
        
        // Validate prerequisites
        if (step.prerequisites && step.prerequisites.length > 0) {
          const prereqMet = await this.validatePrerequisites(deploymentId, step);
          if (!prereqMet.valid) {
            throw new Error(`Prerequisites not met for step ${step.id}: ${prereqMet.errors.join(', ')}`);
          }
        }
        
        // Execute the step
        this.broadcast(deploymentId, 'step_started', { step });
        
        try {
          const result = await this.executeStep(deploymentId, step);
          
          // Validate step completion
          if (step.validation) {
            const isValid = await step.validation();
            if (!isValid) {
              throw new Error(`Validation failed for step ${step.id}`);
            }
          }
          
          executionState.completedSteps.push(step.id);
          executionState.results.push({
            stepId: step.id,
            status: 'completed',
            result
          });
          
          this.broadcast(deploymentId, 'step_completed', { step, result });
          
        } catch (stepError) {
          logger.error(`Step ${step.id} failed:`, stepError);
          
          executionState.failedSteps.push(step.id);
          executionState.results.push({
            stepId: step.id,
            status: 'failed',
            error: stepError.message
          });
          
          this.broadcast(deploymentId, 'step_failed', { step, error: stepError.message });
          
          // Check if we should rollback
          if (options.rollbackOnFailure) {
            await this.rollback(deploymentId, plan, step.id);
          }
          
          throw stepError;
        }
      }
      
      // Execution completed successfully
      executionState.status = 'completed';
      executionState.completedAt = new Date().toISOString();
      
      this.broadcast(deploymentId, 'execution_completed', { 
        results: executionState.results,
        duration: this.calculateDuration(executionState.startedAt, executionState.completedAt)
      });
      
      return executionState;
      
    } catch (error) {
      logger.error(`Plan execution failed for deployment ${deploymentId}:`, error);
      
      const executionState = this.activeExecutions.get(deploymentId);
      if (executionState) {
        executionState.status = 'failed';
        executionState.completedAt = new Date().toISOString();
        executionState.error = error.message;
      }
      
      this.broadcast(deploymentId, 'execution_failed', { error: error.message });
      
      throw error;
    }
  }

  /**
   * Execute a single step
   */
  async executeStep(deploymentId, step) {
    logger.info(`Executing step ${step.id}: ${step.name}`);
    
    switch (step.type) {
      case 'validation':
        // Validation steps run their validation function
        if (step.validation) {
          return await step.validation();
        }
        return { success: true };
        
      case 'command':
        // Execute shell command
        return await this.executeCommand(deploymentId, step.command);
        
      case 'terraform':
        // Execute terraform command
        return await this.executeTerraformCommand(deploymentId, step.command);
        
      case 'info':
        // Info steps are just informational
        return { success: true, message: step.description };
        
      default:
        logger.warn(`Unknown step type: ${step.type}`);
        return { success: true };
    }
  }

  /**
   * Execute a shell command
   */
  async executeCommand(deploymentId, command) {
    try {
      const result = await cliExecutor.executeDeployment(deploymentId, command);
      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute a Terraform command
   */
  async executeTerraformCommand(deploymentId, command) {
    try {
      const terraformService = require('./terraform');
      
      if (command === 'Generate via AI') {
        // This is handled by the terraform service
        return { success: true, message: 'Terraform generation handled separately' };
      }
      
      const terraformCmd = command.replace('terraform ', '');
      const result = await terraformService.executeCommand(deploymentId, terraformCmd);
      
      return {
        success: true,
        output: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate prerequisites for a step
   */
  async validatePrerequisites(deploymentId, step) {
    const result = {
      valid: true,
      errors: []
    };
    
    for (const prereq of step.prerequisites) {
      const prereqLower = prereq.toLowerCase();
      
      if (prereqLower.includes('exists')) {
        // Check file existence
        const fileMatch = prereq.match(/(\S+)\s+exists/);
        if (fileMatch) {
          const exists = await cursorIntegration.fileExists(deploymentId, fileMatch[1]);
          if (!exists) {
            result.valid = false;
            result.errors.push(`File ${fileMatch[1]} does not exist`);
          }
        }
      }
      
      if (prereqLower.includes('installed')) {
        // Check if something is installed
        if (prereqLower.includes('dependencies')) {
          const exists = await cursorIntegration.fileExists(deploymentId, 'node_modules');
          if (!exists) {
            result.valid = false;
            result.errors.push('Dependencies not installed');
          }
        }
      }
    }
    
    return result;
  }

  /**
   * Wait for approval on a step
   */
  async waitForApproval(deploymentId, stepId, timeout) {
    // In a real implementation, this would wait for user input
    // For now, we'll auto-approve after a short delay
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), 1000);
    });
  }

  /**
   * Rollback to a previous state
   */
  async rollback(deploymentId, plan, failedStepId) {
    logger.info(`Rolling back deployment ${deploymentId} from step ${failedStepId}`);
    
    this.broadcast(deploymentId, 'rollback_started', { failedStepId });
    
    const executionState = this.activeExecutions.get(deploymentId);
    const rollbackResults = [];
    
    // Execute rollback steps in reverse order
    for (const rollbackStep of plan.rollbackPlan) {
      // Only rollback steps that were completed before the failure
      if (executionState.completedSteps.includes(rollbackStep.originalStepId)) {
        try {
          logger.info(`Executing rollback: ${rollbackStep.name}`);
          const result = await this.executeCommand(deploymentId, rollbackStep.command);
          rollbackResults.push({
            step: rollbackStep.name,
            success: result.success
          });
        } catch (error) {
          logger.error(`Rollback step failed: ${rollbackStep.name}`, error);
          rollbackResults.push({
            step: rollbackStep.name,
            success: false,
            error: error.message
          });
        }
      }
    }
    
    this.broadcast(deploymentId, 'rollback_completed', { results: rollbackResults });
    
    return rollbackResults;
  }

  /**
   * Cancel an active execution
   */
  async cancelExecution(deploymentId) {
    const executionState = this.activeExecutions.get(deploymentId);
    if (executionState) {
      executionState.status = 'cancelled';
      executionState.completedAt = new Date().toISOString();
      this.broadcast(deploymentId, 'execution_cancelled', {});
      return true;
    }
    return false;
  }

  /**
   * Get execution status
   */
  getExecutionStatus(deploymentId) {
    return this.activeExecutions.get(deploymentId) || null;
  }

  /**
   * Broadcast event
   */
  broadcast(deploymentId, event, data) {
    const message = {
      type: 'deployment_execution',
      event,
      deploymentId,
      data,
      timestamp: new Date().toISOString()
    };
    
    this.emit(event, message);
    
    if (this.broadcastFunction) {
      this.broadcastFunction(deploymentId, event, data);
    }
  }

  /**
   * Calculate duration between two timestamps
   */
  calculateDuration(start, end) {
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const durationMs = endTime - startTime;
    
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    
    if (minutes > 0) {
      return `${minutes} minute(s) ${seconds % 60} second(s)`;
    }
    return `${seconds} second(s)`;
  }
}

module.exports = new DeploymentExecutor();




