const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');
const { llmContextConfig } = require('../config/llmContext');
const commandHistoryService = require('./commandHistoryService');
const stepCompletionGate = require('./stepCompletionGate');
const iterativeFileGenerator = require('./iterativeFileGenerator');

/**
 * Deployment Context Builder
 * Builds lightweight context from Deployment model instead of full conversation
 */
class DeploymentContextBuilder {
  /**
   * Build deployment summary
   */
  buildDeploymentSummary(deployment) {
    if (!deployment) {
      return 'No deployment information available.';
    }

    const summary = [];
    
    summary.push(`**Deployment: ${deployment.name}**`);
    summary.push(`Status: ${deployment.status}`);
    summary.push(`Environment: ${deployment.environment}`);
    summary.push(`Region: ${deployment.region || 'us-east-1'}`);
    
    if (deployment.description) {
      summary.push(`Description: ${deployment.description}`);
    }

    // Add requirements if available
    if (deployment.requirements?.original) {
      summary.push(`\n**Requirements:** ${deployment.requirements.original.substring(0, 200)}...`);
    }

    // Add project type if available
    if (deployment.requirements?.projectType) {
      summary.push(`Project Type: ${deployment.requirements.projectType}`);
    }

    return summary.join('\n');
  }

  /**
   * Build status history summary
   */
  buildStatusHistorySummary(statusHistory) {
    if (!statusHistory || statusHistory.length === 0) {
      return '';
    }

    const config = llmContextConfig.deploymentContext;
    if (!config.includeStatusHistory) {
      return '';
    }

    // Get last N status entries
    const maxEntries = config.maxStatusEntries || 10;
    const recentStatuses = statusHistory.slice(-maxEntries);

    const summary = ['**Status History:**'];
    
    recentStatuses.forEach((entry, index) => {
      const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown';
      const reason = entry.reason ? ` (${entry.reason})` : '';
      summary.push(`${index + 1}. ${entry.status} - ${timestamp}${reason}`);
    });

    return summary.join('\n');
  }

  /**
   * Build key decisions from deployment state
   */
  buildKeyDecisions(deployment) {
    if (!deployment) {
      return '';
    }

    const config = llmContextConfig.deploymentContext;
    if (!config.includeKeyDecisions) {
      return '';
    }

    const decisions = [];

    // Check if Terraform code has been generated
    if (deployment.terraformCode?.main) {
      decisions.push('✓ Terraform code has been generated');
      
      // Check what resources are included
      const terraformMain = deployment.terraformCode.main || '';
      if (terraformMain.includes('aws_instance')) {
        decisions.push('✓ EC2 instances configured');
      }
      if (terraformMain.includes('aws_db_instance') || terraformMain.includes('aws_rds')) {
        decisions.push('✓ Database resources configured');
      }
      if (terraformMain.includes('aws_s3_bucket')) {
        decisions.push('✓ S3 buckets configured');
      }
      if (terraformMain.includes('aws_vpc') || terraformMain.includes('aws_subnet')) {
        decisions.push('✓ Networking resources configured');
      }
    }

    // Check if credentials have been collected
    if (deployment.status === 'CREDENTIAL_COLLECTION' || 
        deployment.status === 'VALIDATING' ||
        deployment.status === 'ESTIMATED') {
      decisions.push('✓ Credentials have been collected');
    }

    // Check if sandbox testing has been done
    if (deployment.sandboxId) {
      decisions.push('✓ Sandbox environment created');
    }

    if (deployment.sandboxTestResults?.completedAt) {
      const passed = deployment.sandboxTestResults.passed;
      decisions.push(`✓ Sandbox tests ${passed ? 'passed' : 'failed'}`);
    }

    // Check if deployment has been approved
    if (deployment.approvalStatus === 'approved') {
      decisions.push('✓ Deployment approved');
    }

    // Check if resources have been deployed
    if (deployment.resources && deployment.resources.length > 0) {
      decisions.push(`✓ ${deployment.resources.length} resource(s) deployed`);
    }

    if (decisions.length === 0) {
      return '';
    }

    return '**Key Decisions & Progress:**\n' + decisions.join('\n');
  }

  /**
   * Build errors and resolutions summary
   */
  buildErrorsAndResolutions(statusHistory) {
    if (!statusHistory || statusHistory.length === 0) {
      return '';
    }

    const config = llmContextConfig.deploymentContext;
    if (!config.includeErrors) {
      return '';
    }

    const errorStatuses = [
      'VALIDATION_FAILED',
      'SANDBOX_FAILED',
      'DEPLOYMENT_FAILED',
      'ROLLBACK_FAILED'
    ];

    const errors = statusHistory.filter(entry => 
      errorStatuses.includes(entry.status) && entry.reason
    );

    if (errors.length === 0) {
      return '';
    }

    const summary = ['**Recent Errors & Resolutions:**'];
    
    errors.slice(-5).forEach((error, index) => {
      const timestamp = error.timestamp ? new Date(error.timestamp).toLocaleString() : 'Unknown';
      summary.push(`${index + 1}. ${error.status} - ${timestamp}`);
      if (error.reason) {
        summary.push(`   Reason: ${error.reason}`);
      }
    });

    return summary.join('\n');
  }

  /**
   * Build current requirements and constraints
   */
  buildRequirementsAndConstraints(deployment) {
    if (!deployment) {
      return '';
    }

    const constraints = [];

    if (deployment.requirements?.structured) {
      const structured = deployment.requirements.structured;
      
      if (structured.services && Array.isArray(structured.services)) {
        constraints.push(`Required Services: ${structured.services.join(', ')}`);
      }
      
      if (structured.cloudProvider) {
        constraints.push(`Cloud Provider: ${structured.cloudProvider}`);
      }
      
      if (structured.infrastructure) {
        constraints.push(`Infrastructure: ${structured.infrastructure}`);
      }
    }

    if (deployment.budget?.monthly) {
      constraints.push(`Budget: $${deployment.budget.monthly}/month`);
    }

    if (deployment.estimatedMonthlyCost) {
      constraints.push(`Estimated Cost: $${deployment.estimatedMonthlyCost}/month`);
    }

    if (constraints.length === 0) {
      return '';
    }

    return '**Requirements & Constraints:**\n' + constraints.join('\n');
  }

  /**
   * Build complete context for deployment
   */
  async buildContext(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      
      if (!deployment) {
        logger.warn('Deployment not found for context building', { deploymentId });
        return '';
      }

      const contextParts = [];

      // Build deployment summary
      const deploymentSummary = this.buildDeploymentSummary(deployment);
      contextParts.push(deploymentSummary);

      // Build status history
      if (deployment.statusHistory && deployment.statusHistory.length > 0) {
        const statusSummary = this.buildStatusHistorySummary(deployment.statusHistory);
        if (statusSummary) {
          contextParts.push('\n' + statusSummary);
        }
      }

      // Build key decisions
      const keyDecisions = this.buildKeyDecisions(deployment);
      if (keyDecisions) {
        contextParts.push('\n' + keyDecisions);
      }

      // Build errors and resolutions
      if (deployment.statusHistory && deployment.statusHistory.length > 0) {
        const errors = this.buildErrorsAndResolutions(deployment.statusHistory);
        if (errors) {
          contextParts.push('\n' + errors);
        }
      }

      // Build requirements and constraints
      const requirements = this.buildRequirementsAndConstraints(deployment);
      if (requirements) {
        contextParts.push('\n' + requirements);
      }

      // Add command history summary
      const commandSummary = await commandHistoryService.buildCommandSummary(deploymentId, 5);
      if (commandSummary) {
        contextParts.push('\n' + commandSummary);
      }

      // Add detailed step completion status
      const stepStatus = await stepCompletionGate.getStepStatus(deploymentId);
      const incompleteSteps = [];
      const completeSteps = [];
      
      for (const [step, status] of Object.entries(stepStatus)) {
        if (status.complete) {
          completeSteps.push(step);
        } else {
          incompleteSteps.push({
            step,
            reason: status.reason || 'Not completed',
            details: status
          });
        }
      }
      
      if (completeSteps.length > 0) {
        contextParts.push(`\n**Completed Steps:** ${completeSteps.join(', ')}`);
      }
      
      if (incompleteSteps.length > 0) {
        contextParts.push(`\n**Incomplete Steps:**`);
        for (const { step, reason, details } of incompleteSteps) {
          let stepInfo = `- ${step}: ${reason}`;
          
          // Add specific details based on step type
          if (step === 'FILE_GENERATION' && details.missingFiles) {
            stepInfo += ` (Missing: ${details.missingFiles.join(', ')})`;
          } else if (step === 'ENV_COLLECTION' && details.missingVars) {
            stepInfo += ` (Missing vars: ${details.missingVars.join(', ')})`;
          } else if (step === 'CREDENTIAL_COLLECTION' && details.missingServices) {
            stepInfo += ` (Missing credentials for: ${details.missingServices.join(', ')})`;
          } else if (step === 'TERRAFORM_GENERATION') {
            if (!details.hasTerraformCode) {
              stepInfo += ' (Terraform code not generated)';
            } else if (!details.isValidated) {
              stepInfo += ' (Terraform code not validated - run terraform validate)';
            }
          }
          
          contextParts.push(stepInfo);
        }
        
        // Add step completion endpoint information
        contextParts.push(`\n**To mark a step as complete:** POST /api/v1/steps/complete/:deploymentId with body { step: "STEP_NAME" }`);
        contextParts.push(`**Check step status:** GET /api/v1/steps/status/:deploymentId?step=STEP_NAME`);
        contextParts.push(`**Check if can proceed:** GET /api/v1/steps/can-proceed/:deploymentId?nextStep=NEXT_STEP`);
      }

      // Add file generation progress
      const fileProgress = await iterativeFileGenerator.checkFileGenerationStatus(deploymentId);
      if (fileProgress.status !== 'no_requirements') {
        contextParts.push(`\n**File Generation:** ${fileProgress.existingFiles.length}/${fileProgress.totalFiles} files generated`);
        if (fileProgress.missingFiles.length > 0) {
          contextParts.push(`Missing: ${fileProgress.missingFiles.join(', ')}`);
        }
      }

      const fullContext = contextParts.join('\n');

      logger.debug('Deployment context built', {
        deploymentId,
        contextLength: fullContext.length,
        parts: contextParts.length
      });

      return fullContext;

    } catch (error) {
      logger.error('Failed to build deployment context:', error);
      return '';
    }
  }

  /**
   * Build minimal context (for simple queries)
   */
  async buildMinimalContext(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      
      if (!deployment) {
        return '';
      }

      return `Deployment: ${deployment.name} | Status: ${deployment.status} | Environment: ${deployment.environment}`;

    } catch (error) {
      logger.error('Failed to build minimal context:', error);
      return '';
    }
  }
}

// Singleton instance
const deploymentContextBuilder = new DeploymentContextBuilder();

module.exports = deploymentContextBuilder;

