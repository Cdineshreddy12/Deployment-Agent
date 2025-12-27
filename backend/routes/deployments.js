const express = require('express');
const Deployment = require('../models/Deployment');
const deploymentOrchestrator = require('../services/deploymentOrchestrator');
const workflowOrchestrator = require('../services/workflowOrchestrator');
const progressTracker = require('../services/progressTracker');
const approvalService = require('../services/approval');
const rollbackService = require('../services/rollback');
const deploymentEnvService = require('../services/deploymentEnvService');
const envDetector = require('../services/envDetector');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { deploymentLimiter } = require('../middleware/rateLimit');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all deployments
router.get('/', async (req, res, next) => {
  try {
    const { environment, status, page = 1, limit = 20 } = req.query;

    const query = {};
    if (environment) query.environment = environment;
    if (status) query.status = status;

    // Filter by user permissions
    if (req.user.role !== 'admin' && req.user.role !== 'devops') {
      // Users can only see their own deployments or team deployments
      query.$or = [
        { userId: req.user._id },
        { team: req.user.team }
      ];
    }

    const deployments = await Deployment.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'name email');

    const total = await Deployment.countDocuments(query);

    res.json({
      success: true,
      data: {
        deployments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Create new deployment
router.post('/', deploymentLimiter, validate(schemas.createDeployment), async (req, res, next) => {
  try {
    const { name, description, environment, region, repositoryUrl, repositoryBranch, githubToken, workspacePath } = req.body;
    const cursorIntegration = require('../services/cursorIntegration');

    const deployment = new Deployment({
      name,
      description,
      environment,
      region: region || 'us-east-1',
      repositoryUrl,
      repositoryBranch: repositoryBranch || 'main',
      githubToken, // Store GitHub token if provided
      userId: req.user._id,
      userName: req.user.name,
      userEmail: req.user.email,
      team: req.user.team,
      status: 'INITIATED',
      tags: {
        Environment: environment,
        Owner: req.user.email,
        ManagedBy: 'deployment-platform'
      }
    });

    await deployment.save();

    // Set workspace path if provided (Cursor integration)
    if (workspacePath) {
      cursorIntegration.setWorkspacePath(deployment.deploymentId, workspacePath);
      logger.info(`Workspace path set for deployment ${deployment.deploymentId}: ${workspacePath}`);
    }

    // Refresh deployment to ensure githubToken is included
    const savedDeployment = await Deployment.findOne({ deploymentId: deployment.deploymentId });

    // Start deployment process (don't await to return response quickly)
    // Use setTimeout to ensure deployment is fully saved before processing
    setTimeout(() => {
      deploymentOrchestrator.processDeployment(deployment.deploymentId).catch(err => {
        logger.error('Error processing deployment:', err);
      });
    }, 100);

    res.status(201).json({
      success: true,
      data: { deployment: savedDeployment }
    });
  } catch (error) {
    next(error);
  }
});

// Get deployment by ID
router.get('/:id', async (req, res, next) => {
  try {
    const deployment = await Deployment.findOne({ deploymentId: req.params.id })
      .populate('userId', 'name email')
      .populate('sandboxId');

    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    res.json({
      success: true,
      data: { deployment }
    });
  } catch (error) {
    next(error);
  }
});

// Update deployment
router.patch('/:id', requirePermission('deployments.update:own'), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const deployment = await Deployment.findOne({ deploymentId: req.params.id });
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    if (name) deployment.name = name;
    if (description) deployment.description = description;

    await deployment.save();

    res.json({
      success: true,
      data: { deployment }
    });
  } catch (error) {
    next(error);
  }
});

// Approve deployment
router.post('/:id/approve', requirePermission('deployments.approve'), validate(schemas.approval), async (req, res, next) => {
  try {
    const { comment } = req.body;

    const result = await approvalService.approve(req.params.id, req.user._id, comment);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Reject deployment
router.post('/:id/reject', requirePermission('deployments.approve'), validate(schemas.approval), async (req, res, next) => {
  try {
    const { reason } = req.body;

    await approvalService.reject(req.params.id, req.user._id, reason);

    res.json({
      success: true,
      message: 'Deployment rejected'
    });
  } catch (error) {
    next(error);
  }
});

// Resume deployment processing
router.post('/:id/resume', requirePermission('deployments.update:own'), async (req, res, next) => {
  try {
    const deployment = await Deployment.findOne({ deploymentId: req.params.id });
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    // Check if deployment can be resumed (not in terminal states)
    const terminalStates = ['DEPLOYED', 'CANCELLED', 'DESTROYED', 'ROLLED_BACK', 'ROLLBACK_FAILED'];
    if (terminalStates.includes(deployment.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: `Cannot resume deployment in ${deployment.status} state`
        }
      });
    }

    // Check if we should retry a failed step
    // If in GATHERING but repository URL exists, try repository analysis first
    if (deployment.status === 'GATHERING' && deployment.repositoryUrl && !deployment.terraformCode) {
      // Check if repository analysis was attempted before
      const hasRepoAnalysisAttempt = deployment.statusHistory?.some(
        sh => sh.status === 'REPOSITORY_ANALYSIS' && sh.reason
      );
      
      if (hasRepoAnalysisAttempt) {
        // Retry repository analysis
        await deploymentOrchestrator.transitionState(deployment.deploymentId, 'REPOSITORY_ANALYSIS');
      }
    }

    // Resume processing
    await deploymentOrchestrator.processDeployment(deployment.deploymentId);

    // Refresh deployment
    const updatedDeployment = await Deployment.findOne({ deploymentId: req.params.id });

    res.json({
      success: true,
      data: { deployment: updatedDeployment },
      message: 'Deployment processing resumed'
    });
  } catch (error) {
    next(error);
  }
});

// Cancel deployment
router.post('/:id/cancel', requirePermission('deployments.update:own'), async (req, res, next) => {
  try {
    await deploymentOrchestrator.transitionState(req.params.id, 'CANCELLED');

    res.json({
      success: true,
      message: 'Deployment cancelled'
    });
  } catch (error) {
    next(error);
  }
});

// Rollback deployment
router.post('/:id/rollback', requirePermission('deployments.rollback'), validate(schemas.rollback), async (req, res, next) => {
  try {
    const { version, reason } = req.body;

    const result = await rollbackService.executeRollback(req.params.id, version, reason);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Get deployment state history
router.get('/:id/state-history', async (req, res, next) => {
  try {
    const deployment = await Deployment.findOne({ deploymentId: req.params.id });

    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        history: deployment.statusHistory
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get deployment versions
router.get('/:id/versions', async (req, res, next) => {
  try {
    const versions = await rollbackService.getRollbackVersions(req.params.id);

    res.json({
      success: true,
      data: { versions }
    });
  } catch (error) {
    next(error);
  }
});

// Get deployment environment variables
router.get('/:id/env', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const deploymentEnv = await deploymentEnvService.get(req.params.id);
    
    if (!deploymentEnv) {
      return res.json({
        success: true,
        data: { environmentVariables: {} }
      });
    }
    
    const envVars = {};
    for (const [key, value] of deploymentEnv.envVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: {
        environmentVariables: envVars,
        version: deploymentEnv.version,
        chatContext: deploymentEnv.chatContext
      }
    });
  } catch (error) {
    logger.error('Failed to get deployment env:', error);
    next(error);
  }
});

// Update deployment environment variables
router.put('/:id/env', requirePermission('deployments.update'), async (req, res, next) => {
  try {
    const { environmentVariables } = req.body;
    
    if (!environmentVariables || typeof environmentVariables !== 'object') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'environmentVariables object is required'
        }
      });
    }
    
    const deploymentEnv = await deploymentEnvService.update(
      req.params.id,
      environmentVariables,
      req.user._id
    );
    
    const envVars = {};
    for (const [key, value] of deploymentEnv.envVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: {
        environmentVariables: envVars,
        version: deploymentEnv.version
      }
    });
  } catch (error) {
    logger.error('Failed to update deployment env:', error);
    next(error);
  }
});

// Generate .env from code analysis
router.post('/:id/env/generate', requirePermission('deployments.update'), async (req, res, next) => {
  try {
    const cursorIntegration = require('../services/cursorIntegration');
    const deployment = await Deployment.findOne({ deploymentId: req.params.id });
    
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }
    
    // Check for workspace path (Cursor integration)
    const workspacePath = cursorIntegration.getWorkspacePath(req.params.id);
    
    let detection;
    
    if (workspacePath) {
      // Detect from local workspace
      logger.info(`Detecting env variables from workspace: ${workspacePath}`, { deploymentId: req.params.id });
      detection = await envDetector.detectFromWorkspace(req.params.id, workspacePath);
    } else if (deployment.repositoryUrl) {
      // Detect from GitHub repository
      logger.info(`Detecting env variables from repository: ${deployment.repositoryUrl}`, { deploymentId: req.params.id });
      detection = await envDetector.detectFromRepository(
        deployment.repositoryUrl,
        deployment.repositoryBranch
      );
    } else {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Deployment does not have a repository URL or workspace path'
        }
      });
    }
    
    // Create/update deployment env with detected variables
    const envVars = {};
    for (const varName of detection.variables) {
      // Set empty values - user will fill them
      envVars[varName] = '';
    }
    
    const deploymentEnv = await deploymentEnvService.update(
      req.params.id,
      envVars,
      req.user._id
    );
    
    const resultEnvVars = {};
    for (const [key, value] of deploymentEnv.envVariables.entries()) {
      resultEnvVars[key] = value;
    }
    
    res.json({
      success: true,
      data: {
        environmentVariables: resultEnvVars,
        schema: detection.schema,
        sources: detection.sources
      }
    });
  } catch (error) {
    logger.error('Failed to generate deployment env:', error);
    next(error);
  }
});

// Get deployment .env as file content
router.get('/:id/env/file', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const envContent = await deploymentEnvService.generateEnvFile(req.params.id, req.user._id);
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="deployment-${req.params.id}.env"`);
    res.send(envContent);
  } catch (error) {
    logger.error('Failed to get deployment env file:', error);
    next(error);
  }
});

// Get reusable env variables
router.get('/:id/env/reuse', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { projectType } = req.query;
    
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    const envVariableManager = require('../services/envVariableManager');
    const reusableEnvs = await envVariableManager.reuseEnvVariables(
      deployment.userId,
      projectType || deployment.requirements?.projectType || null
    );

    res.json({
      success: true,
      data: {
        reusableEnvs,
        count: reusableEnvs.length
      }
    });
  } catch (error) {
    logger.error('Failed to get reusable env variables:', error);
    next(error);
  }
});

// Reuse env variables from another deployment
router.post('/:id/env/reuse/:sourceDeploymentId', requirePermission('deployments.update'), async (req, res, next) => {
  try {
    const { id: targetDeploymentId, sourceDeploymentId } = req.params;
    
    const targetDeployment = await Deployment.findOne({ deploymentId: targetDeploymentId });
    if (!targetDeployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Target deployment not found'
        }
      });
    }

    const sourceDeployment = await Deployment.findOne({ deploymentId: sourceDeploymentId });
    if (!sourceDeployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Source deployment not found'
        }
      });
    }

    const envVariableManager = require('../services/envVariableManager');
    const result = await envVariableManager.reuseFromDeployment(
      targetDeploymentId,
      sourceDeploymentId,
      req.user._id
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to reuse env variables:', error);
    next(error);
  }
});

/**
 * Unified Deployment Endpoint
 * Single entry point for chat, UI, and API deployment triggers
 * POST /api/v1/deployments/:id/deploy
 */
router.post('/:id/deploy', deploymentLimiter, requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { source = 'api', autoApprove = true, durationHours = 4, async: asyncMode = true } = req.body;

    // Validate deployment exists
    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment not found'
        }
      });
    }

    // Validate source
    if (!['chat', 'ui', 'api'].includes(source)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SOURCE',
          message: 'Source must be one of: chat, ui, api'
        }
      });
    }

    // Check if deployment already in progress
    const existingJob = workflowOrchestrator.getJobStatus(deploymentId);
    if (existingJob && ['starting', 'initialization', 'writing_files', 'initializing', 'planning', 'applying', 'verifying'].includes(existingJob.phase)) {
      return res.json({
        success: true,
        data: {
          jobId: existingJob.jobId,
          status: 'in_progress',
          message: 'Deployment already in progress',
          progress: existingJob.progress,
          phase: existingJob.phase
        }
      });
    }

    // Progress callback for real-time updates
    const progressCallback = (progressEvent) => {
      // Broadcast via WebSocket
      progressTracker.trackProgress(deploymentId, progressEvent);
    };

    if (asyncMode) {
      // Async mode: Start deployment and return immediately
      workflowOrchestrator.startDeployment(deploymentId, {
        source,
        autoApprove,
        durationHours,
        progressCallback
      }).catch(error => {
        logger.error('Deployment workflow failed', {
          deploymentId,
          error: error.message
        });
        progressTracker.emitDeploymentFailed(deploymentId, error);
      });

      const job = workflowOrchestrator.getJobStatus(deploymentId);

      res.json({
        success: true,
        data: {
          jobId: job?.jobId,
          deploymentId,
          status: 'started',
          message: 'Deployment workflow started',
          source,
          async: true
        }
      });
    } else {
      // Sync mode: Wait for deployment to complete (not recommended for long operations)
      try {
        const result = await workflowOrchestrator.startDeployment(deploymentId, {
          source,
          autoApprove,
          durationHours,
          progressCallback
        });

        res.json({
          success: true,
          data: {
            ...result,
            async: false
          }
        });
      } catch (error) {
        logger.error('Deployment workflow failed', {
          deploymentId,
          error: error.message
        });

        res.status(500).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_FAILED',
            message: error.message
          }
        });
      }
    }
  } catch (error) {
    logger.error('Unified deployment endpoint error:', error);
    next(error);
  }
});

/**
 * Get deployment job status
 * GET /api/v1/deployments/:id/deploy/status
 */
router.get('/:id/deploy/status', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const job = workflowOrchestrator.getJobStatus(deploymentId);
    const currentProgress = progressTracker.getCurrentProgress(deploymentId);
    const history = progressTracker.getHistory(deploymentId, 20);

    if (!job && !currentProgress) {
      return res.json({
        success: true,
        data: {
          status: 'not_started',
          message: 'No deployment job found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        job: job || null,
        currentProgress,
        history,
        connectionCount: progressTracker.getConnectionCount(deploymentId)
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Cancel deployment
 * POST /api/v1/deployments/:id/deploy/cancel
 */
router.post('/:id/deploy/cancel', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const result = await workflowOrchestrator.cancelDeployment(deploymentId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('not in progress')) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: error.message
        }
      });
    }

    if (error.message.includes('Cannot cancel')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATE',
          message: error.message
        }
      });
    }

    next(error);
  }
});

module.exports = router;

