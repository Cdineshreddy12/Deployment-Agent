const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');
const fileCheckService = require('./fileCheckService');
const commandHistoryService = require('./commandHistoryService');
const envVariableManager = require('./envVariableManager');

/**
 * Step Completion Gate System
 * Enforces step completion before proceeding to next step
 */
class StepCompletionGate {
  /**
   * Step definitions with completion requirements
   */
  getStepDefinitions() {
    return {
      FILE_GENERATION: {
        name: 'File Generation',
        requirements: ['Dockerfile', 'docker-compose.yml'],
        optional: ['deploy.sh', 'build.sh', '.dockerignore']
      },
      ENV_COLLECTION: {
        name: 'Environment Variable Collection',
        requirements: ['all_required_vars_collected']
      },
      CREDENTIAL_COLLECTION: {
        name: 'Credential Collection',
        requirements: ['all_credentials_collected', 'credentials_validated']
      },
      TERRAFORM_GENERATION: {
        name: 'Terraform Generation',
        requirements: ['terraform_code_generated', 'terraform_validated']
      },
      SANDBOX_TESTING: {
        name: 'Sandbox Testing',
        requirements: ['sandbox_deployed', 'tests_passed']
      }
    };
  }

  /**
   * Check if step is complete
   */
  async checkStepCompletion(deploymentId, step) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        return {
          complete: false,
          reason: 'Deployment not found'
        };
      }

      const stepDef = this.getStepDefinitions()[step];
      if (!stepDef) {
        return {
          complete: false,
          reason: `Unknown step: ${step}`
        };
      }

      // Check step-specific requirements
      switch (step) {
        case 'FILE_GENERATION':
          return await this.checkFileGeneration(deploymentId, stepDef);
        
        case 'ENV_COLLECTION':
          return await this.checkEnvCollection(deploymentId, stepDef);
        
        case 'CREDENTIAL_COLLECTION':
          return await this.checkCredentialCollection(deploymentId, stepDef);
        
        case 'TERRAFORM_GENERATION':
          return await this.checkTerraformGeneration(deploymentId, stepDef);
        
        case 'SANDBOX_TESTING':
          return await this.checkSandboxTesting(deploymentId, stepDef);
        
        default:
          return {
            complete: false,
            reason: `No completion check defined for step: ${step}`
          };
      }
    } catch (error) {
      logger.error('Failed to check step completion:', error);
      return {
        complete: false,
        reason: `Error checking step: ${error.message}`
      };
    }
  }

  /**
   * Check file generation completion
   */
  async checkFileGeneration(deploymentId, stepDef) {
    const cursorIntegration = require('./cursorIntegration');
    const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
    
    if (!workspacePath) {
      return {
        complete: false,
        reason: 'Workspace path not set'
      };
    }

    const missingFiles = [];
    const existingFiles = [];

    // Check required files
    for (const file of stepDef.requirements) {
      const fileInfo = await fileCheckService.getFileInfo(deploymentId, file);
      if (fileInfo.exists) {
        existingFiles.push(file);
      } else {
        missingFiles.push(file);
      }
    }

    // Check optional files (for completeness)
    const optionalFiles = [];
    for (const file of stepDef.optional || []) {
      const fileInfo = await fileCheckService.getFileInfo(deploymentId, file);
      if (fileInfo.exists) {
        optionalFiles.push(file);
      }
    }

    return {
      complete: missingFiles.length === 0,
      existingFiles,
      missingFiles,
      optionalFiles,
      reason: missingFiles.length > 0 
        ? `Missing required files: ${missingFiles.join(', ')}`
        : 'All required files generated'
    };
  }

  /**
   * Check env collection completion
   */
  async checkEnvCollection(deploymentId, stepDef) {
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      return {
        complete: false,
        reason: 'Deployment not found'
      };
    }

    const envVars = await envVariableManager.getEnvVariables(deploymentId);
    const varCount = Object.keys(envVars).length;

    // Check if deployment has detected required env vars
    const requiredVars = deployment.requirements?.detectedRequirements?.envVars || [];
    const collectedVars = Object.keys(envVars);

    const missingVars = requiredVars.filter(v => !collectedVars.includes(v));

    return {
      complete: missingVars.length === 0 && varCount > 0,
      collectedCount: varCount,
      requiredCount: requiredVars.length,
      missingVars,
      reason: missingVars.length > 0
        ? `Missing env variables: ${missingVars.join(', ')}`
        : 'All required env variables collected'
    };
  }

  /**
   * Check credential collection completion
   */
  async checkCredentialCollection(deploymentId, stepDef) {
    const credentialManager = require('./credentialManager');
    const deployment = await Deployment.findOne({ deploymentId });
    
    if (!deployment) {
      return {
        complete: false,
        reason: 'Deployment not found'
      };
    }

    // Check if credentials are needed based on deployment requirements
    const requiredServices = deployment.requirements?.detectedRequirements?.services || [];
    
    if (requiredServices.length === 0) {
      return {
        complete: true,
        reason: 'No credentials required'
      };
    }

    const userId = deployment.userId;
    const credentials = await credentialManager.listCredentials(userId, { reusable: true });
    
    // Check if we have credentials for required services
    const credentialServiceTypes = credentials.map(c => c.serviceType).filter(Boolean);
    const missingServices = requiredServices.filter(
      service => !credentialServiceTypes.includes(service)
    );

    return {
      complete: missingServices.length === 0,
      collectedCount: credentials.length,
      requiredServices,
      missingServices,
      reason: missingServices.length > 0
        ? `Missing credentials for: ${missingServices.join(', ')}`
        : 'All required credentials collected'
    };
  }

  /**
   * Check terraform generation completion
   */
  async checkTerraformGeneration(deploymentId, stepDef) {
    const deployment = await Deployment.findOne({ deploymentId });
    
    if (!deployment) {
      return {
        complete: false,
        reason: 'Deployment not found'
      };
    }

    const hasTerraformCode = deployment.terraformCode?.main && 
                            deployment.terraformCode.main.length > 0;

    // Check if terraform validation has been run
    const commandStatus = await commandHistoryService.getStepCommandStatus(
      deploymentId,
      'TERRAFORM_GENERATION'
    );

    const isValidated = commandStatus.hasCommands && 
                       commandStatus.allSuccessful &&
                       deployment.status !== 'VALIDATION_FAILED';

    return {
      complete: hasTerraformCode && isValidated,
      hasTerraformCode,
      isValidated,
      reason: !hasTerraformCode
        ? 'Terraform code not generated'
        : !isValidated
        ? 'Terraform code not validated'
        : 'Terraform code generated and validated'
    };
  }

  /**
   * Check sandbox testing completion
   */
  async checkSandboxTesting(deploymentId, stepDef) {
    const deployment = await Deployment.findOne({ deploymentId });
    
    if (!deployment) {
      return {
        complete: false,
        reason: 'Deployment not found'
      };
    }

    const hasSandbox = !!deployment.sandboxId;
    const hasTestResults = !!deployment.sandboxTestResults?.completedAt;
    const testsPassed = deployment.sandboxTestResults?.passed === true;

    return {
      complete: hasSandbox && hasTestResults && testsPassed,
      hasSandbox,
      hasTestResults,
      testsPassed,
      reason: !hasSandbox
        ? 'Sandbox not created'
        : !hasTestResults
        ? 'Tests not completed'
        : !testsPassed
        ? 'Tests failed'
        : 'Sandbox tests passed'
    };
  }

  /**
   * Mark step as complete
   */
  async markStepComplete(deploymentId, step, metadata = {}) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      // Initialize stepStatus if not exists
      if (!deployment.stepStatus) {
        deployment.stepStatus = {};
      }

      deployment.stepStatus[step] = {
        complete: true,
        completedAt: new Date(),
        metadata
      };

      await deployment.save();

      logger.info('Step marked as complete', {
        deploymentId,
        step
      });

      return {
        success: true,
        step,
        completedAt: deployment.stepStatus[step].completedAt
      };
    } catch (error) {
      logger.error('Failed to mark step complete:', error);
      throw error;
    }
  }

  /**
   * Check if can proceed to next step
   */
  async canProceedToNextStep(deploymentId, nextStep) {
    try {
      // Get step dependencies
      const dependencies = this.getStepDependencies(nextStep);
      
      // Check if all dependencies are complete
      for (const depStep of dependencies) {
        const depStatus = await this.checkStepCompletion(deploymentId, depStep);
        if (!depStatus.complete) {
          return {
            canProceed: false,
            reason: `Dependency step '${depStep}' not complete: ${depStatus.reason}`,
            blockingStep: depStep
          };
        }
      }

      return {
        canProceed: true,
        reason: 'All dependencies complete'
      };
    } catch (error) {
      logger.error('Failed to check if can proceed:', error);
      return {
        canProceed: false,
        reason: `Error checking dependencies: ${error.message}`
      };
    }
  }

  /**
   * Get step dependencies
   */
  getStepDependencies(step) {
    const dependencies = {
      ENV_COLLECTION: [],
      CREDENTIAL_COLLECTION: ['FILE_GENERATION'],
      TERRAFORM_GENERATION: ['CREDENTIAL_COLLECTION', 'ENV_COLLECTION'],
      SANDBOX_TESTING: ['TERRAFORM_GENERATION']
    };

    return dependencies[step] || [];
  }

  /**
   * Get step checklist
   */
  async getStepChecklist(deploymentId, step) {
    const stepDef = this.getStepDefinitions()[step];
    if (!stepDef) {
      return {
        step,
        requirements: [],
        reason: 'Unknown step'
      };
    }

    const completionStatus = await this.checkStepCompletion(deploymentId, step);

    return {
      step,
      name: stepDef.name,
      requirements: stepDef.requirements,
      optional: stepDef.optional || [],
      complete: completionStatus.complete,
      details: completionStatus
    };
  }

  /**
   * Get all step statuses
   */
  async getStepStatus(deploymentId) {
    const steps = Object.keys(this.getStepDefinitions());
    const statuses = {};

    for (const step of steps) {
      statuses[step] = await this.checkStepCompletion(deploymentId, step);
    }

    return statuses;
  }
}

// Singleton instance
const stepCompletionGate = new StepCompletionGate();

module.exports = stepCompletionGate;

