const Deployment = require('../models/Deployment');
const ServiceConfig = require('../models/ServiceConfig');
const claudeService = require('./claude');
const terraformService = require('./terraform');
const sandboxService = require('./sandbox');
const awsService = require('./aws');
const costService = require('./cost');
const approvalService = require('./approval');
const notificationService = require('./notification');
const credentialValidator = require('./credentialValidator');
const dynamicServiceManager = require('./dynamicServiceManager');
const credentialManager = require('./credentialManager');
const logger = require('../utils/logger');

/**
 * Deployment Orchestrator
 * Manages deployment state machine and coordinates all services
 * Now supports dynamic service discovery and credential management
 */
class DeploymentOrchestrator {
  constructor() {
    this.stateMachine = {
      INITIATED: ['GITHUB_INPUT', 'GATHERING', 'REPOSITORY_ANALYSIS', 'PLAN_READY', 'CANCELLED'],
      GITHUB_INPUT: ['ANALYZING', 'CANCELLED'],
      ANALYZING: ['ENV_COLLECTION', 'PLANNING', 'GATHERING', 'REPOSITORY_ANALYSIS', 'CANCELLED'], // Can transition to ENV_COLLECTION, GATHERING or REPOSITORY_ANALYSIS on error
      PLANNING: ['VALIDATING', 'ENV_COLLECTION', 'CANCELLED'], // Can go to VALIDATING after Terraform generation, or back to ENV_COLLECTION if needed
      ENV_COLLECTION: ['PLANNING', 'CREDENTIAL_COLLECTION', 'CANCELLED'], // Can go to PLANNING after env vars filled, or CREDENTIAL_COLLECTION if needed
      CREDENTIAL_COLLECTION: ['SANDBOX_TESTING', 'PLAN_EXECUTION', 'CANCELLED'],
      SANDBOX_TESTING: ['DEPLOYING', 'SANDBOX_FAILED', 'CANCELLED'],
      REPOSITORY_ANALYSIS: ['CODE_ANALYSIS', 'INFRASTRUCTURE_DISCOVERY', 'GATHERING', 'REPOSITORY_ANALYSIS', 'CANCELLED'], // Can retry itself
      CODE_ANALYSIS: ['INFRASTRUCTURE_DISCOVERY', 'DEPENDENCY_ANALYSIS', 'GATHERING', 'CODE_ANALYSIS', 'CANCELLED'], // Can retry itself
      INFRASTRUCTURE_DISCOVERY: ['DEPENDENCY_ANALYSIS', 'GATHERING', 'INFRASTRUCTURE_DISCOVERY', 'CANCELLED'], // Can retry itself
      DEPENDENCY_ANALYSIS: ['GATHERING', 'DEPENDENCY_ANALYSIS', 'CANCELLED'], // Can retry itself
      GATHERING: ['PLANNING', 'REPOSITORY_ANALYSIS', 'PLAN_READY', 'PLAN_EXECUTION', 'CANCELLED'], // Can transition to plan execution
      PLAN_READY: ['PLAN_EXECUTION', 'GATHERING', 'CANCELLED'], // Plan is ready, waiting for execution approval
      PLAN_EXECUTION: ['DEPLOYING', 'PLAN_FAILED', 'CANCELLED'], // Executing the deployment plan step by step
      PLAN_FAILED: ['GATHERING', 'PLAN_EXECUTION', 'CANCELLED'], // Plan execution failed, can retry
      VALIDATING: ['ESTIMATED', 'VALIDATION_FAILED', 'CANCELLED'],
      VALIDATION_FAILED: ['PLANNING', 'VALIDATING', 'CANCELLED'], // Can retry validation
      ESTIMATED: ['PENDING_APPROVAL', 'PLANNING', 'CANCELLED'],
      PENDING_APPROVAL: ['SANDBOX_DEPLOYING', 'REJECTED', 'CANCELLED'],
      SANDBOX_DEPLOYING: ['TESTING', 'SANDBOX_FAILED', 'CANCELLED'],
      SANDBOX_FAILED: ['PLANNING', 'CANCELLED'],
      TESTING: ['SANDBOX_VALIDATED', 'SANDBOX_FAILED', 'CANCELLED'],
      SANDBOX_VALIDATED: ['APPROVED', 'REJECTED', 'CANCELLED'],
      APPROVED: ['GITHUB_COMMIT', 'DEPLOYING', 'CANCELLED'],
      REJECTED: ['PLANNING', 'CANCELLED'],
      GITHUB_COMMIT: ['GITHUB_ACTIONS', 'DEPLOYING', 'CANCELLED'],
      GITHUB_ACTIONS: ['DEPLOYING', 'CANCELLED'],
      DEPLOYING: ['DEPLOYED', 'DEPLOYMENT_FAILED'],
      DEPLOYMENT_FAILED: ['ROLLING_BACK'],
      ROLLING_BACK: ['ROLLED_BACK', 'ROLLBACK_FAILED'],
      ROLLED_BACK: [],
      ROLLBACK_FAILED: [],
      DEPLOYED: ['DESTROYING'],
      DESTROYING: ['DESTROYED'],
      DESTROYED: [],
      CANCELLED: []
    };
  }

  /**
   * Helper function to get GitHub token for a deployment
   * Priority: deployment.githubToken > database > environment
   */
  async getGitHubToken(deployment) {
    // First, check if token is stored in deployment
    if (deployment.githubToken) {
      return deployment.githubToken;
    }
    
    // Second, try to get from database using deployment's userId
    if (deployment.userId) {
      try {
        const dbToken = await credentialManager.getGitHubToken(deployment.userId);
        if (dbToken) {
          return dbToken;
        }
      } catch (error) {
        logger.warn('Failed to get GitHub token from database:', error);
      }
    }
    
    // Finally, fallback to environment variable
    return process.env.GITHUB_TOKEN || null;
  }

  /**
   * Process deployment state transition
   */
  async processDeployment(deploymentId) {
    try {
      // Always fetch fresh deployment to ensure we have latest data including githubToken
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const currentStatus = deployment.status;
      const handler = this.getHandler(currentStatus);

      if (!handler) {
        logger.warn(`No handler for status: ${currentStatus}`, { deploymentId });
        return { status: currentStatus };
      }

      // Check step completion gates before proceeding
      const stepCompletionGate = require('./stepCompletionGate');
      const statusToStepMap = {
        'PLANNING': 'FILE_GENERATION',
        'ENV_COLLECTION': 'ENV_COLLECTION',
        'CREDENTIAL_COLLECTION': 'CREDENTIAL_COLLECTION',
        'VALIDATING': 'TERRAFORM_GENERATION',
        'SANDBOX_TESTING': 'SANDBOX_TESTING'
      };

      const requiredStep = statusToStepMap[currentStatus];
      if (requiredStep) {
        const canProceed = await stepCompletionGate.canProceedToNextStep(deploymentId, requiredStep);
        if (!canProceed.canProceed) {
          logger.info('Step completion gate blocked transition', {
            deploymentId,
            currentStatus,
            requiredStep,
            reason: canProceed.reason
          });
          return {
            status: currentStatus,
            blocked: true,
            reason: canProceed.reason,
            blockingStep: canProceed.blockingStep
          };
        }
      }

      const result = await handler(deployment);
      return result;
    } catch (error) {
      logger.error('Deployment processing error:', error);
      throw error;
    }
  }

  /**
   * Get handler for deployment status
   */
  getHandler(status) {
    const handlers = {
      INITIATED: (d) => this.handleInitiated(d),
      GITHUB_INPUT: (d) => this.handleGitHubInput(d),
      ANALYZING: (d) => this.handleAnalyzing(d),
      PLANNING: (d) => this.handlePlanning(d),
      ENV_COLLECTION: (d) => this.handleEnvCollection(d),
      CREDENTIAL_COLLECTION: (d) => this.handleCredentialCollection(d),
      SANDBOX_TESTING: (d) => this.handleSandboxTesting(d),
      PLAN_READY: (d) => this.handlePlanReady(d),
      PLAN_EXECUTION: (d) => this.handlePlanExecution(d),
      REPOSITORY_ANALYSIS: (d) => this.handleRepositoryAnalysis(d),
      CODE_ANALYSIS: (d) => this.handleCodeAnalysis(d),
      INFRASTRUCTURE_DISCOVERY: (d) => this.handleInfrastructureDiscovery(d),
      DEPENDENCY_ANALYSIS: (d) => this.handleDependencyAnalysis(d),
      GATHERING: (d) => this.handleGathering(d),
      VALIDATING: (d) => this.handleValidating(d),
      ESTIMATED: (d) => this.handleEstimated(d),
      PENDING_APPROVAL: (d) => this.handlePendingApproval(d),
      SANDBOX_DEPLOYING: (d) => this.handleSandboxDeploying(d),
      TESTING: (d) => this.handleTesting(d),
      SANDBOX_VALIDATED: (d) => this.handleSandboxValidated(d),
      APPROVED: (d) => this.handleApproved(d),
      GITHUB_COMMIT: (d) => this.handleGitHubCommit(d),
      GITHUB_ACTIONS: (d) => this.handleGitHubActions(d),
      DEPLOYING: (d) => this.handleDeploying(d)
    };

    return handlers[status];
  }

  /**
   * Transition deployment to new state
   */
  async transitionState(deploymentId, newStatus, metadata = {}) {
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      throw new Error('Deployment not found');
    }

    const currentStatus = deployment.status;
    
    // If already in the target state, skip transition
    if (currentStatus === newStatus) {
      logger.debug(`Deployment ${deploymentId} already in state ${newStatus}, skipping transition`);
      return;
    }
    
    const validTransitions = this.stateMachine[currentStatus] || [];

    if (!validTransitions.includes(newStatus)) {
      throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}`);
    }

    deployment.previousStatus = currentStatus;
    deployment.status = newStatus;
    deployment.statusHistory.push({
      status: newStatus,
      timestamp: new Date(),
      metadata
    });

    await deployment.save();
    logger.info(`Deployment ${deploymentId} transitioned: ${currentStatus} → ${newStatus}`);
  }

  /**
   * Handle INITIATED state
   */
  async handleInitiated(deployment) {
    const cursorIntegration = require('./cursorIntegration');
    const requirementParser = require('./requirementParser');
    const architectureAnalyzer = require('./architectureAnalyzer');
    const deploymentPlanner = require('./deploymentPlanner');
    
    // Check if workspace path is set (Cursor integration)
    const workspacePath = cursorIntegration.getWorkspacePath(deployment.deploymentId);
    if (workspacePath) {
      logger.info('Workspace path detected, using Cursor integration', {
        deploymentId: deployment.deploymentId,
        workspacePath
      });
      
      try {
        // Step 1: Analyze project architecture
        logger.info('Step 1: Analyzing project architecture', { deploymentId: deployment.deploymentId });
        const architectureAnalysis = await architectureAnalyzer.analyzeProject(deployment.deploymentId);
        
        // Step 2: Analyze deployment requirements
        logger.info('Step 2: Analyzing deployment requirements', { deploymentId: deployment.deploymentId });
        const analysis = await requirementParser.analyzeDeployment(deployment.deploymentId);
        
        // Store analysis in deployment
        await Deployment.findOneAndUpdate(
          { deploymentId: deployment.deploymentId },
          {
            'requirements.analysis': analysis,
            'requirements.projectType': analysis.projectType,
            'requirements.detectedRequirements': analysis.requirements,
            'requirements.architectureAnalysis': architectureAnalysis
          }
        );
        
        // Step 3: Generate deployment plan
        logger.info('Step 3: Generating deployment plan', { deploymentId: deployment.deploymentId });
        const deploymentPlan = await deploymentPlanner.generatePlan(deployment.deploymentId, {
          analysis: architectureAnalysis
        });
        
        // Store deployment plan
        await Deployment.findOneAndUpdate(
          { deploymentId: deployment.deploymentId },
          {
            'requirements.deploymentPlan': deploymentPlan
          }
        );
        
        logger.info('Deployment plan generated', {
          deploymentId: deployment.deploymentId,
          steps: deploymentPlan.steps?.length || 0,
          strategy: deploymentPlan.strategy
        });
        
        // Step 4: Generate scripts only if validation passes
        const scriptGenerator = require('./scriptGenerator');
        const scriptsResult = await scriptGenerator.generateAllScripts(
          deployment.deploymentId,
          analysis.requirements,
          analysis.projectType
        );
        
        // Log what scripts were generated
        logger.info('Script generation complete', {
          deploymentId: deployment.deploymentId,
          scriptsGenerated: Object.keys(scriptsResult.files || {}).length,
          warnings: scriptsResult.warnings?.length || 0
        });
        
        // Transition to gathering for credential collection
        await this.transitionState(deployment.deploymentId, 'GATHERING');
        await this.processDeployment(deployment.deploymentId);
        return { 
          status: 'GATHERING', 
          analysis,
          architectureAnalysis,
          deploymentPlan,
          scriptsResult
        };
      } catch (error) {
        logger.error('Cursor integration analysis failed:', error);
        // Continue to gathering anyway
        await this.transitionState(deployment.deploymentId, 'GATHERING');
        await this.processDeployment(deployment.deploymentId);
        return { status: 'GATHERING', error: error.message };
      }
    }
    
    // GitHub-first workflow: if repository URL is provided, check for token and start GitHub workflow
    if (deployment.repositoryUrl) {
      const token = await this.getGitHubToken(deployment);
      if (token) {
        await this.transitionState(deployment.deploymentId, 'GITHUB_INPUT');
        await this.processDeployment(deployment.deploymentId);
        return { status: 'GITHUB_INPUT' };
      }
      
      // Legacy workflow: if repository URL is provided, start with repository analysis
      await this.transitionState(deployment.deploymentId, 'REPOSITORY_ANALYSIS');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'REPOSITORY_ANALYSIS' };
    }
    
    // Otherwise, proceed to gathering credentials
    await this.transitionState(deployment.deploymentId, 'GATHERING');
    await this.processDeployment(deployment.deploymentId);
    return { status: 'GATHERING' };
  }

  /**
   * Handle GITHUB_INPUT state - GitHub URL and PAT provided
   */
  async handleGitHubInput(deployment) {
    try {
      logger.info('GitHub input received', {
        deploymentId: deployment.deploymentId,
        repositoryUrl: deployment.repositoryUrl
      });
      
      // Store GitHub PAT securely (already stored in deployment)
      // Transition to analyzing
      await this.transitionState(deployment.deploymentId, 'ANALYZING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'ANALYZING' };
    } catch (error) {
      logger.error('GitHub input handling failed:', error);
      await this.transitionState(deployment.deploymentId, 'GATHERING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GATHERING', error: error.message };
    }
  }

  /**
   * Handle ANALYZING state - Analyze repository and generate plan
   */
  async handleAnalyzing(deployment) {
    try {
      const githubAnalysis = require('./githubAnalysis');
      const envDetector = require('./envDetector');
      const deploymentEnvService = require('./deploymentEnvService');
      
      logger.info('Analyzing repository and generating plan', {
        deploymentId: deployment.deploymentId
      });
      
      // 1. Analyze repository (get token using helper)
      const token = await this.getGitHubToken(deployment);
      const analysis = await githubAnalysis.analyzeRepository(
        deployment.repositoryUrl,
        deployment.repositoryBranch,
        token
      );
      
      // 2. Detect environment variables
      const envDetection = await envDetector.detectFromRepository(
        deployment.repositoryUrl,
        deployment.repositoryBranch
      );
      
      // 3. Store detected env variables in deployment env
      const envVars = {};
      for (const varName of envDetection.variables) {
        envVars[varName] = ''; // Empty values - user will fill
      }
      await deploymentEnvService.update(deployment.deploymentId, envVars, deployment.userId);
      
      // 4. Generate missing infrastructure files (Dockerfile, CI/CD, scripts)
      const infrastructureGenerator = require('./infrastructureGenerator');
      let generatedFiles = null;
      
      if (analysis.missingInfrastructure && Object.keys(analysis.missingInfrastructure).length > 0) {
        logger.info('Generating missing infrastructure files', {
          deploymentId: deployment.deploymentId,
          missing: analysis.missingInfrastructure
        });
        
        try {
          generatedFiles = await infrastructureGenerator.generateMissingInfrastructure(
            deployment.deploymentId,
            analysis,
            analysis.missingInfrastructure,
            deployment.userId // Pass userId explicitly
          );
          
          // Store generated files in deployment
          await Deployment.findOneAndUpdate(
            { deploymentId: deployment.deploymentId },
            {
              'requirements.generatedFiles': generatedFiles,
              'requirements.missingInfrastructure': analysis.missingInfrastructure
            }
          );
          
          logger.info('Infrastructure files generated successfully', {
            deploymentId: deployment.deploymentId,
            files: Object.keys(generatedFiles).filter(k => generatedFiles[k] !== null)
          });
        } catch (error) {
          logger.error('Failed to generate infrastructure files:', error);
          // Continue with deployment plan even if file generation fails
        }
      }
      
      // 5. Generate deployment plan using AI
      const claudeService = require('./claude');
      const missingItems = analysis.missingInfrastructure?.requirements || [];
      const planPrompt = `Based on the repository analysis, create a comprehensive deployment plan.

Repository: ${deployment.repositoryUrl}
Language: ${analysis.repository.language}
Detected Infrastructure Needs:
- Databases: ${analysis.codeAnalysis.databases.join(', ') || 'None'}
- Storage: ${analysis.codeAnalysis.storage.join(', ') || 'None'}
- Caching: ${analysis.codeAnalysis.caching.join(', ') || 'None'}
- Messaging: ${analysis.codeAnalysis.messaging.join(', ') || 'None'}

Required Environment Variables: ${envDetection.variables.join(', ')}

${missingItems.length > 0 ? `\nIMPORTANT: The following infrastructure files have been generated:\n${missingItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n` : ''}

Create a detailed deployment plan including:
1. Infrastructure requirements
2. Required services/providers
3. Environment variables needed
4. Deployment steps (including using generated Dockerfile and CI/CD pipeline)
5. Estimated costs

Format as a structured plan that can be executed step by step.`;
      
      const planResponse = await claudeService.chat(
        deployment.deploymentId,
        planPrompt,
        { userId: deployment.userId }
      );
      
      // Store plan in deployment requirements
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        {
          'requirements.structured': {
            plan: planResponse.message,
            analysis,
            envDetection,
            generatedFiles: generatedFiles
          }
        }
      );
      
      // Transition to ENV_COLLECTION first (user needs to fill env vars before planning)
      await this.transitionState(deployment.deploymentId, 'ENV_COLLECTION');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'ENV_COLLECTION', plan: planResponse.message };
    } catch (error) {
      logger.error('Analysis failed:', error);
      
      // Check if it's an auth error - transition to REPOSITORY_ANALYSIS for retry
      const isAuthError = error.message?.includes('No GitHub token') || 
                         error.message?.includes('Access denied') ||
                         error.message?.includes('Authentication failed') ||
                         error.response?.status === 403 ||
                         error.response?.status === 401;
      
      if (isAuthError) {
        await this.transitionState(deployment.deploymentId, 'REPOSITORY_ANALYSIS', { reason: error.message });
        await this.processDeployment(deployment.deploymentId);
        return { status: 'REPOSITORY_ANALYSIS', error: error.message };
      } else {
        // For other errors, transition to GATHERING
        await this.transitionState(deployment.deploymentId, 'GATHERING', { reason: error.message });
        await this.processDeployment(deployment.deploymentId);
        return { status: 'GATHERING', error: error.message };
      }
    }
  }

  /**
   * Handle ENV_COLLECTION state - Collect environment variables
   */
  async handleEnvCollection(deployment) {
    try {
      const deploymentEnvService = require('./deploymentEnvService');
      
      logger.info('Collecting environment variables', {
        deploymentId: deployment.deploymentId
      });
      
      // Get deployment env to check if variables are filled
      const deploymentEnv = await deploymentEnvService.get(deployment.deploymentId);
      
      if (deploymentEnv) {
        // Check if all required variables are filled
        const emptyVars = [];
        for (const [key, value] of deploymentEnv.envVariables.entries()) {
          if (!value || value.trim() === '') {
            emptyVars.push(key);
          }
        }
        
        // If all variables are filled, proceed to PLANNING (generate Terraform)
        if (emptyVars.length === 0) {
          await this.transitionState(deployment.deploymentId, 'PLANNING');
          await this.processDeployment(deployment.deploymentId);
          return { status: 'PLANNING' };
        }
      }
      
      // Still collecting - wait for user input via chat
      // Don't auto-transition - let user fill env vars first
      return { status: 'ENV_COLLECTION', message: 'Please fill in all required environment variables', emptyVars };
    } catch (error) {
      logger.error('Env collection failed:', error);
      return { status: 'ENV_COLLECTION', error: error.message };
    }
  }

  /**
   * Handle CREDENTIAL_COLLECTION state - Collect or reuse credentials
   */
  async handleCredentialCollection(deployment) {
    try {
      const credentialManager = require('./credentialManager');
      const ServiceConfig = require('../models/ServiceConfig');
      
      logger.info('Collecting credentials', {
        deploymentId: deployment.deploymentId
      });
      
      // Check what services are needed from the plan
      const requiredServices = this.extractRequiredServices(deployment.requirements);
      
      // Check if credentials already exist for this deployment
      const existingConfigs = await ServiceConfig.find({
        deploymentId: deployment.deploymentId
      });
      
      const configuredServices = existingConfigs.map(c => c.serviceType);
      const missingServices = requiredServices.filter(s => !configuredServices.includes(s));
      
      // If all services have credentials, proceed to sandbox testing
      if (missingServices.length === 0) {
        // Verify all credentials are validated
        const allValidated = existingConfigs.every(c => c.validated && c.sandboxTested);
        if (allValidated) {
          await this.transitionState(deployment.deploymentId, 'SANDBOX_TESTING');
          await this.processDeployment(deployment.deploymentId);
          return { status: 'SANDBOX_TESTING' };
        }
      }
      
      // Suggest reusable credentials
      const suggestions = await credentialManager.suggestCredentials(
        deployment.deploymentId,
        missingServices,
        deployment.userId
      );
      
      // Still collecting - wait for user input via chat
      return {
        status: 'CREDENTIAL_COLLECTION',
        message: 'Please provide credentials for required services',
        missingServices,
        suggestions
      };
    } catch (error) {
      logger.error('Credential collection failed:', error);
      return { status: 'CREDENTIAL_COLLECTION', error: error.message };
    }
  }

  /**
   * Handle SANDBOX_TESTING state - Test with collected .env and credentials
   */
  async handleSandboxTesting(deployment) {
    try {
      const sandboxService = require('./sandbox');
      const deploymentEnvService = require('./deploymentEnvService');
      
      logger.info('Testing in sandbox with .env and credentials', {
        deploymentId: deployment.deploymentId
      });
      
      // Get deployment .env
      const envVars = await deploymentEnvService.getAsObject(deployment.deploymentId, deployment.userId);
      
      // Create sandbox with .env
      const sandbox = await sandboxService.createSandbox(deployment.deploymentId, {
        durationHours: 4,
        environmentVariables: envVars
      });
      
      // Update deployment with sandbox ID
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        { sandboxId: sandbox._id }
      );
      
      // Run tests in sandbox
      const testResults = await sandboxService.runTests(deployment.deploymentId);
      
      if (testResults.passed) {
        // Tests passed, proceed to deployment
        await this.transitionState(deployment.deploymentId, 'DEPLOYING');
        await this.processDeployment(deployment.deploymentId);
        return { status: 'DEPLOYING', testResults };
      } else {
        // Tests failed, go back to planning
        await this.transitionState(deployment.deploymentId, 'PLANNING', {
          error: 'Sandbox tests failed',
          testResults
        });
        await this.processDeployment(deployment.deploymentId);
        return { status: 'PLANNING', testResults };
      }
    } catch (error) {
      logger.error('Sandbox testing failed:', error);
      await this.transitionState(deployment.deploymentId, 'PLANNING', {
        error: error.message
      });
      await this.processDeployment(deployment.deploymentId);
      return { status: 'PLANNING', error: error.message };
    }
  }

  /**
   * Handle PLAN_READY state - Plan is generated and waiting for approval
   */
  async handlePlanReady(deployment) {
    try {
      logger.info('Deployment plan ready, waiting for execution approval', {
        deploymentId: deployment.deploymentId
      });
      
      // Get the deployment plan
      const plan = deployment.requirements?.deploymentPlan;
      
      if (!plan) {
        // No plan exists, generate one
        const architectureAnalyzer = require('./architectureAnalyzer');
        const deploymentPlanner = require('./deploymentPlanner');
        
        const analysis = await architectureAnalyzer.analyzeProject(deployment.deploymentId);
        const newPlan = await deploymentPlanner.generatePlan(deployment.deploymentId, { analysis });
        
        await Deployment.findOneAndUpdate(
          { deploymentId: deployment.deploymentId },
          { 'requirements.deploymentPlan': newPlan }
        );
        
        return {
          status: 'PLAN_READY',
          plan: newPlan,
          message: 'Deployment plan is ready. Review and execute when ready.'
        };
      }
      
      return {
        status: 'PLAN_READY',
        plan,
        message: 'Deployment plan is ready. Review and execute when ready.'
      };
    } catch (error) {
      logger.error('Plan ready handling failed:', error);
      return { status: 'PLAN_READY', error: error.message };
    }
  }

  /**
   * Handle PLAN_EXECUTION state - Execute the deployment plan step by step
   */
  async handlePlanExecution(deployment) {
    try {
      const deploymentExecutor = require('./deploymentExecutor');
      const deploymentPlanner = require('./deploymentPlanner');
      
      logger.info('Executing deployment plan', {
        deploymentId: deployment.deploymentId
      });
      
      // Get or regenerate plan
      let plan = deployment.requirements?.deploymentPlan;
      
      if (!plan) {
        plan = await deploymentPlanner.generatePlan(deployment.deploymentId);
      }
      
      // Execute the plan
      const executionResult = await deploymentExecutor.executePlan(
        deployment.deploymentId,
        plan,
        {
          autoApprove: false, // Require approval for critical steps
          rollbackOnFailure: true
        }
      );
      
      // Store execution result
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        {
          'requirements.planExecution': executionResult
        }
      );
      
      if (executionResult.status === 'completed') {
        // Plan executed successfully
        await this.transitionState(deployment.deploymentId, 'DEPLOYING');
        await this.processDeployment(deployment.deploymentId);
        return { status: 'DEPLOYING', executionResult };
      } else if (executionResult.status === 'failed') {
        await this.transitionState(deployment.deploymentId, 'PLAN_FAILED', {
          error: executionResult.error
        });
        return { status: 'PLAN_FAILED', executionResult };
      }
      
      // Still executing
      return { status: 'PLAN_EXECUTION', executionResult };
    } catch (error) {
      logger.error('Plan execution failed:', error);
      await this.transitionState(deployment.deploymentId, 'PLAN_FAILED', {
        error: error.message
      });
      return { status: 'PLAN_FAILED', error: error.message };
    }
  }

  /**
   * Handle REPOSITORY_ANALYSIS state
   */
  async handleRepositoryAnalysis(deployment) {
    try {
      const githubAnalysis = require('./githubAnalysis');
      
      logger.info('Analyzing repository', { 
        deploymentId: deployment.deploymentId,
        repositoryUrl: deployment.repositoryUrl 
      });
      
      // Get GitHub token using helper (checks deployment > database > environment)
      const token = await this.getGitHubToken(deployment);
      
      // Analyze repository
      const analysis = await githubAnalysis.analyzeRepository(
        deployment.repositoryUrl,
        deployment.repositoryBranch,
        token
      );
      
      // Store repository analysis
      const Repository = require('../models/Repository');
      const { owner, repo } = require('./githubService').parseRepositoryUrl(deployment.repositoryUrl);
      await Repository.findOneAndUpdate(
        { owner, repo },
        {
          url: deployment.repositoryUrl,
          owner,
          repo,
          defaultBranch: analysis.repository.defaultBranch,
          description: analysis.repository.description,
          language: analysis.repository.language,
          topics: analysis.repository.topics,
          userId: deployment.userId,
          lastAnalyzedAt: new Date(),
          analysisCache: analysis
        },
        { upsert: true, new: true }
      );
      
      // Transition to code analysis
      await this.transitionState(deployment.deploymentId, 'CODE_ANALYSIS');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'CODE_ANALYSIS', analysis };
    } catch (error) {
      logger.error('Repository analysis failed:', error);
      
      // Store error in deployment metadata
      const Deployment = require('../models/Deployment');
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        { 
          $push: { 
            statusHistory: {
              status: 'REPOSITORY_ANALYSIS',
              timestamp: new Date(),
              reason: error.message
            }
          }
        }
      );
      
      // Check if it's an authentication/access error
      const isAuthError = error.message.includes('Access denied') || 
                         error.message.includes('Authentication failed') ||
                         error.message.includes('No GitHub token') ||
                         error.response?.status === 403 ||
                         error.response?.status === 401;
      
      if (isAuthError) {
        // For auth errors, stay in REPOSITORY_ANALYSIS state so user can retry after providing token
        logger.warn('GitHub authentication issue - deployment paused for retry', {
          deploymentId: deployment.deploymentId,
          error: error.message
        });
        // Don't transition - stay in REPOSITORY_ANALYSIS so it can be retried
        return { status: 'REPOSITORY_ANALYSIS', error: error.message, retryable: true };
      }
      
      // For other errors, transition to gathering but allow retry
      await this.transitionState(deployment.deploymentId, 'GATHERING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GATHERING', error: error.message };
    }
  }

  /**
   * Handle CODE_ANALYSIS state
   */
  async handleCodeAnalysis(deployment) {
    try {
      const codeAnalysis = require('./codeAnalysis');
      const CodeAnalysis = require('../models/CodeAnalysis');
      const githubService = require('./githubService');
      
      logger.info('Analyzing code for infrastructure needs', { 
        deploymentId: deployment.deploymentId 
      });
      
      // Get repository files if available
      const Repository = require('../models/Repository');
      const { owner, repo } = githubService.parseRepositoryUrl(deployment.repositoryUrl);
      const repoRecord = await Repository.findOne({ owner, repo });
      
      if (repoRecord && repoRecord.analysisCache) {
        // Use cached analysis
        const analysisResults = await codeAnalysis.analyzeCodebase(
          repoRecord.analysisCache.structure || {}
        );
        
        // Store code analysis
        await CodeAnalysis.findOneAndUpdate(
          { deploymentId: deployment.deploymentId },
          {
            deploymentId: deployment.deploymentId,
            repositoryUrl: deployment.repositoryUrl,
            analysis: analysisResults,
            analyzedAt: new Date()
          },
          { upsert: true, new: true }
        );
        
        // Update deployment with code analysis reference
        const codeAnalysisDoc = await CodeAnalysis.findOne({ deploymentId: deployment.deploymentId });
        await Deployment.findOneAndUpdate(
          { deploymentId: deployment.deploymentId },
          { codeAnalysis: codeAnalysisDoc._id }
        );
      }
      
      // Transition to infrastructure discovery
      await this.transitionState(deployment.deploymentId, 'INFRASTRUCTURE_DISCOVERY');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'INFRASTRUCTURE_DISCOVERY' };
    } catch (error) {
      logger.error('Code analysis failed:', error);
      await this.transitionState(deployment.deploymentId, 'INFRASTRUCTURE_DISCOVERY');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'INFRASTRUCTURE_DISCOVERY', error: error.message };
    }
  }

  /**
   * Handle INFRASTRUCTURE_DISCOVERY state
   */
  async handleInfrastructureDiscovery(deployment) {
    try {
      const infrastructureDiscovery = require('./infrastructureDiscovery');
      
      logger.info('Discovering existing infrastructure', { 
        deploymentId: deployment.deploymentId,
        region: deployment.region 
      });
      
      // Discover existing infrastructure
      const discovery = await infrastructureDiscovery.discoverInfrastructure(
        deployment.deploymentId,
        deployment.region,
        ['aws'] // TODO: Detect providers from requirements
      );
      
      // Store infrastructure discovery
      const InfrastructureDiscovery = require('../models/InfrastructureDiscovery');
      const discoveryDoc = await InfrastructureDiscovery.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        discovery,
        { upsert: true, new: true }
      );
      
      // Update deployment
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        { existingInfrastructure: discoveryDoc._id }
      );
      
      // Transition to dependency analysis
      await this.transitionState(deployment.deploymentId, 'DEPENDENCY_ANALYSIS');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'DEPENDENCY_ANALYSIS', discovery };
    } catch (error) {
      logger.error('Infrastructure discovery failed:', error);
      await this.transitionState(deployment.deploymentId, 'DEPENDENCY_ANALYSIS');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'DEPENDENCY_ANALYSIS', error: error.message };
    }
  }

  /**
   * Handle DEPENDENCY_ANALYSIS state
   */
  async handleDependencyAnalysis(deployment) {
    try {
      const dependencyAnalysis = require('./dependencyAnalysis');
      const Repository = require('../models/Repository');
      const githubService = require('./githubService');
      
      logger.info('Analyzing dependencies', { 
        deploymentId: deployment.deploymentId 
      });
      
      if (deployment.repositoryUrl) {
        const { owner, repo } = githubService.parseRepositoryUrl(deployment.repositoryUrl);
        const repoRecord = await Repository.findOne({ owner, repo });
        
        if (repoRecord && repoRecord.analysisCache) {
          // Analyze dependencies from cached repository data
          const dependencyResults = await dependencyAnalysis.analyzeDependencies(
            repoRecord.analysisCache.structure || {}
          );
          
          // Store dependency analysis in deployment requirements
          await Deployment.findOneAndUpdate(
            { deploymentId: deployment.deploymentId },
            {
              'requirements.dependencyAnalysis': dependencyResults
            }
          );
        }
      }
      
      // Transition to gathering credentials
      await this.transitionState(deployment.deploymentId, 'GATHERING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GATHERING' };
    } catch (error) {
      logger.error('Dependency analysis failed:', error);
      await this.transitionState(deployment.deploymentId, 'GATHERING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GATHERING', error: error.message };
    }
  }

  /**
   * Handle GATHERING state
   * Collects requirements and credentials from user using dynamic service discovery
   */
  async handleGathering(deployment) {
    try {
      // Check if service configurations exist for this deployment
      const serviceConfigs = await ServiceConfig.find({ deploymentId: deployment.deploymentId });
      
      // If service configs exist but not validated, validate them using dynamic service manager
      for (const config of serviceConfigs) {
        if (!config.validated) {
          logger.info(`Validating credentials for ${config.serviceType}`, {
            deploymentId: deployment.deploymentId
          });
          
          const testResult = await dynamicServiceManager.testServiceConnection(
            config.serviceType,
            config.credentials,
            deployment.deploymentId
          );
          
          if (testResult.success) {
            config.validated = true;
            config.validatedAt = new Date();
            config.sandboxTested = true;
            config.sandboxTestedAt = new Date();
            await config.save();
          } else {
            logger.warn(`Credential validation failed for ${config.serviceType}`, {
              deploymentId: deployment.deploymentId,
              error: testResult.error
            });
          }
        }
      }
      
      // This is handled by chat service - no automatic transition
      return { status: 'GATHERING' };
    } catch (error) {
      logger.error('Gathering error:', error);
      throw error;
    }
  }

  /**
   * Handle PLANNING state - Generate Terraform code using Terraform MCP
   */
  async handlePlanning(deployment) {
    try {
      logger.info('Generating Terraform code with Terraform MCP', { 
        deploymentId: deployment.deploymentId 
      });

      // Generate Terraform code using Claude with Terraform MCP Server
      // Note: generateCode now automatically writes and formats files
      const { code, validation, mcpToolsUsed } = await terraformService.generateCode(
        deployment.requirements.structured,
        deployment.deploymentId
      );
      
      logger.info('Terraform code generated with MCP', {
        deploymentId: deployment.deploymentId,
        mcpToolsUsed: mcpToolsUsed || [],
        validationStatus: validation?.overall?.valid
      });

      // Update deployment with terraform code (but don't update status directly)
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        {
          terraformCode: code
        }
      );

      // Only transition if not already in VALIDATING state
      const currentDeployment = await Deployment.findOne({ deploymentId: deployment.deploymentId });
      if (currentDeployment.status !== 'VALIDATING') {
        await this.transitionState(deployment.deploymentId, 'VALIDATING');
      }
      await this.processDeployment(deployment.deploymentId);

      return { status: 'VALIDATING', code };
    } catch (error) {
      logger.error('Planning error:', error);
      await this.transitionState(deployment.deploymentId, 'VALIDATION_FAILED', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle VALIDATING state
   */
  async handleValidating(deployment) {
    try {
      const validation = await terraformService.validate(deployment.deploymentId);
      
      if (validation.valid) {
        await this.transitionState(deployment.deploymentId, 'ESTIMATED');
        await this.processDeployment(deployment.deploymentId);
        return { status: 'ESTIMATED', validation };
      } else {
        await this.transitionState(deployment.deploymentId, 'VALIDATION_FAILED', {
          errors: validation.errors
        });
        return { status: 'VALIDATION_FAILED', validation };
      }
    } catch (error) {
      logger.error('Validation error:', error);
      await this.transitionState(deployment.deploymentId, 'VALIDATION_FAILED', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle ESTIMATED state
   */
  async handleEstimated(deployment) {
    // Cost estimation happens here
    // Transition to PENDING_APPROVAL if approval required
    if (deployment.requiredApprovals > 0) {
      await this.transitionState(deployment.deploymentId, 'PENDING_APPROVAL');
      await approvalService.requestApproval(deployment.deploymentId);
      return { status: 'PENDING_APPROVAL' };
    }
    
    // No approval needed, go to sandbox
    await this.transitionState(deployment.deploymentId, 'SANDBOX_DEPLOYING');
    await this.processDeployment(deployment.deploymentId);
    return { status: 'SANDBOX_DEPLOYING' };
  }

  /**
   * Handle PENDING_APPROVAL state
   */
  async handlePendingApproval(deployment) {
    // Approval handled by approval service
    return { status: 'PENDING_APPROVAL' };
  }

  /**
   * Handle SANDBOX_DEPLOYING state
   */
  async handleSandboxDeploying(deployment) {
    try {
      const sandbox = await sandboxService.createSandbox(deployment.deploymentId);
      await this.transitionState(deployment.deploymentId, 'TESTING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'TESTING', sandbox };
    } catch (error) {
      logger.error('Sandbox deployment error:', error);
      await this.transitionState(deployment.deploymentId, 'SANDBOX_FAILED', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Handle TESTING state
   */
  async handleTesting(deployment) {
    // Testing happens in sandbox
    // Transition handled by test results
    return { status: 'TESTING' };
  }

  /**
   * Handle SANDBOX_VALIDATED state
   */
  async handleSandboxValidated(deployment) {
    // Sandbox validated, ready for approval or deployment
    return { status: 'SANDBOX_VALIDATED' };
  }

  /**
   * Handle APPROVED state
   */
  async handleApproved(deployment) {
    // If repository URL is provided, commit to GitHub first
    if (deployment.repositoryUrl) {
      await this.transitionState(deployment.deploymentId, 'GITHUB_COMMIT');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GITHUB_COMMIT' };
    }
    
    // Otherwise, proceed directly to deployment
    await this.transitionState(deployment.deploymentId, 'DEPLOYING');
    await this.processDeployment(deployment.deploymentId);
    return { status: 'DEPLOYING' };
  }

  /**
   * Handle GITHUB_COMMIT state
   */
  async handleGitHubCommit(deployment) {
    try {
      const githubService = require('./githubService');
      const infrastructureGenerator = require('./infrastructureGenerator');
      
      logger.info('Committing Terraform code and infrastructure files to GitHub', { 
        deploymentId: deployment.deploymentId,
        repositoryUrl: deployment.repositoryUrl 
      });
      
      const { owner, repo } = githubService.parseRepositoryUrl(deployment.repositoryUrl);
      const targetBranch = deployment.repositoryBranch || 'main';
      
      // Create deployment branch
      const branchName = `deployment/${deployment.deploymentId}-${Date.now()}`;
      const token = await this.getGitHubToken(deployment);
      await githubService.createBranch(owner, repo, branchName, targetBranch, token);
      
      const filesToCommit = [];
      
      // Add Terraform files if available
      if (deployment.terraformCode && deployment.terraformCode.main) {
        if (deployment.terraformCode.main) {
          filesToCommit.push({
            path: 'terraform/main.tf',
            content: Buffer.from(deployment.terraformCode.main).toString('base64'),
            mode: '100644'
          });
        }
        if (deployment.terraformCode.variables) {
          filesToCommit.push({
            path: 'terraform/variables.tf',
            content: Buffer.from(deployment.terraformCode.variables).toString('base64'),
            mode: '100644'
          });
        }
        if (deployment.terraformCode.outputs) {
          filesToCommit.push({
            path: 'terraform/outputs.tf',
            content: Buffer.from(deployment.terraformCode.outputs).toString('base64'),
            mode: '100644'
          });
        }
        if (deployment.terraformCode.providers) {
          filesToCommit.push({
            path: 'terraform/providers.tf',
            content: Buffer.from(deployment.terraformCode.providers).toString('base64'),
            mode: '100644'
          });
        }
      }
      
      // Add generated infrastructure files if available
      const generatedFiles = deployment.requirements?.generatedFiles;
      if (generatedFiles) {
        if (generatedFiles.dockerfile) {
          filesToCommit.push({
            path: 'Dockerfile',
            content: Buffer.from(generatedFiles.dockerfile).toString('base64'),
            mode: '100644'
          });
        }
        if (generatedFiles.dockerCompose) {
          filesToCommit.push({
            path: 'docker-compose.yml',
            content: Buffer.from(generatedFiles.dockerCompose).toString('base64'),
            mode: '100644'
          });
        }
        if (generatedFiles.cicdPipeline) {
          filesToCommit.push({
            path: '.github/workflows/deploy.yml',
            content: Buffer.from(generatedFiles.cicdPipeline).toString('base64'),
            mode: '100644'
          });
        }
        if (generatedFiles.deploymentScripts) {
          if (generatedFiles.deploymentScripts.deploy) {
            filesToCommit.push({
              path: 'scripts/deploy.sh',
              content: Buffer.from(generatedFiles.deploymentScripts.deploy).toString('base64'),
              mode: '100755' // Executable
            });
          }
          if (generatedFiles.deploymentScripts.rollback) {
            filesToCommit.push({
              path: 'scripts/rollback.sh',
              content: Buffer.from(generatedFiles.deploymentScripts.rollback).toString('base64'),
              mode: '100755'
            });
          }
          if (generatedFiles.deploymentScripts.healthCheck) {
            filesToCommit.push({
              path: 'scripts/health-check.sh',
              content: Buffer.from(generatedFiles.deploymentScripts.healthCheck).toString('base64'),
              mode: '100755'
            });
          }
        }
      }
      
      if (filesToCommit.length === 0) {
        throw new Error('No files to commit');
      }
      
      // Create commit
      const commitMessage = `Deploy infrastructure for ${deployment.name}\n\nDeployment ID: ${deployment.deploymentId}\nEnvironment: ${deployment.environment}\n\n${generatedFiles ? 'Includes generated Dockerfile, CI/CD pipeline, and deployment scripts.' : ''}`;
      const commitResult = await githubService.createCommit(
        owner,
        repo,
        branchName,
        filesToCommit,
        commitMessage,
        null, // author
        token
      );
      
      // Update deployment
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        {
          githubCommitSha: commitResult.sha,
          repositoryBranch: branchName
        }
      );
      
      // Transition to GitHub Actions or deployment
      await this.transitionState(deployment.deploymentId, 'GITHUB_ACTIONS');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'GITHUB_ACTIONS', commit: commitResult };
    } catch (error) {
      logger.error('GitHub commit failed:', error);
      // Continue to deployment even if commit fails
      await this.transitionState(deployment.deploymentId, 'DEPLOYING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'DEPLOYING', error: error.message };
    }
  }

  /**
   * Handle GITHUB_ACTIONS state
   */
  async handleGitHubActions(deployment) {
    try {
      const githubService = require('./githubService');
      
      logger.info('Triggering GitHub Actions workflow', { 
        deploymentId: deployment.deploymentId,
        repositoryUrl: deployment.repositoryUrl 
      });
      
      // Check if there are workflows configured
      const { owner, repo } = githubService.parseRepositoryUrl(deployment.repositoryUrl);
      const workflows = await githubService.listWorkflows(owner, repo);
      
      // Find deployment workflow (common names)
      const deploymentWorkflow = workflows.find(wf => 
        wf.name.toLowerCase().includes('deploy') || 
        wf.name.toLowerCase().includes('terraform')
      );
      
      if (deploymentWorkflow) {
        // Trigger workflow
        const branch = deployment.repositoryBranch || 'main';
        await githubService.triggerWorkflow(
          owner,
          repo,
          deploymentWorkflow.id,
          branch,
          {
            deployment_id: deployment.deploymentId,
            environment: deployment.environment
          }
        );
        
        // Get workflow run
        const runs = await githubService.listWorkflowRuns(owner, repo, deploymentWorkflow.id, branch);
        const latestRun = runs[0];
        
        if (latestRun) {
          await Deployment.findOneAndUpdate(
            { deploymentId: deployment.deploymentId },
            {
              githubActionsRunId: latestRun.id.toString()
            }
          );
        }
        
        logger.info('GitHub Actions workflow triggered', {
          deploymentId: deployment.deploymentId,
          workflowId: deploymentWorkflow.id,
          runId: latestRun?.id
        });
      } else {
        logger.info('No deployment workflow found, skipping GitHub Actions', {
          deploymentId: deployment.deploymentId
        });
      }
      
      // Transition to deployment
      await this.transitionState(deployment.deploymentId, 'DEPLOYING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'DEPLOYING' };
    } catch (error) {
      logger.error('GitHub Actions trigger failed:', error);
      // Continue to deployment even if Actions trigger fails
      await this.transitionState(deployment.deploymentId, 'DEPLOYING');
      await this.processDeployment(deployment.deploymentId);
      return { status: 'DEPLOYING', error: error.message };
    }
  }

  /**
   * Handle DEPLOYING state
   */
  async handleDeploying(deployment) {
    try {
      const result = await terraformService.apply(deployment.deploymentId);
      
      await Deployment.findOneAndUpdate(
        { deploymentId: deployment.deploymentId },
        {
          status: 'DEPLOYED',
          deployedAt: new Date(),
          resources: result.resources
        }
      );

      await notificationService.deploymentSuccess(deployment);
      
      return { status: 'DEPLOYED', result };
    } catch (error) {
      logger.error('Deployment error:', error);
      await this.transitionState(deployment.deploymentId, 'DEPLOYMENT_FAILED', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Check if all required service credentials are collected and validated
   */
  async checkCredentialsReady(deploymentId) {
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      return { ready: false, reason: 'Deployment not found' };
    }
    
    // Extract service types from requirements (this would be parsed from user requirements)
    const requiredServices = this.extractRequiredServices(deployment.requirements);
    
    if (requiredServices.length === 0) {
      return { ready: true, message: 'No services required' };
    }
    
    const serviceConfigs = await ServiceConfig.find({ 
      deploymentId,
      serviceType: { $in: requiredServices }
    });
    
    const validatedServices = serviceConfigs.filter(c => c.validated && c.sandboxTested);
    const missingServices = requiredServices.filter(
      s => !serviceConfigs.some(c => c.serviceType === s)
    );
    const unvalidatedServices = serviceConfigs.filter(
      c => !c.validated || !c.sandboxTested
    ).map(c => c.serviceType);
    
    return {
      ready: validatedServices.length === requiredServices.length,
      requiredServices,
      validatedServices: validatedServices.map(s => s.serviceType),
      missingServices,
      unvalidatedServices
    };
  }
  
  /**
   * Extract required services from deployment requirements
   * This is a simple implementation - can be enhanced with NLP
   */
  extractRequiredServices(requirements) {
    if (!requirements) return [];
    
    const services = [];
    const text = JSON.stringify(requirements).toLowerCase();
    
    // Use dynamic service discovery - check registered services
    // For now, simple text matching (can be enhanced with AI)
    if (text.includes('aws') || text.includes('amazon')) services.push('aws');
    if (text.includes('supabase')) services.push('supabase');
    if (text.includes('postgres') || text.includes('postgresql')) services.push('postgresql');
    if (text.includes('mongodb') || text.includes('mongo')) services.push('mongodb');
    if (text.includes('redis')) services.push('redis');
    if (text.includes('elasticsearch') || text.includes('kibana')) services.push('elasticsearch');
    if (text.includes('azure')) services.push('azure');
    if (text.includes('gcp') || text.includes('google cloud')) services.push('gcp');
    
    return [...new Set(services)]; // Remove duplicates
  }
}

module.exports = new DeploymentOrchestrator();
