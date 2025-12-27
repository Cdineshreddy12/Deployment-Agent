const express = require('express');
const path = require('path');
const cliExecutor = require('../services/cliExecutor');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');
const wizardOrchestrator = require('../services/wizardOrchestrator');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Clone repository for deployment
 * POST /api/v1/cli/clone
 */
router.post('/clone', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, repositoryUrl, branch, githubToken } = req.body;

    if (!deploymentId || !repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and repositoryUrl are required'
        }
      });
    }

    // Verify deployment exists and user has access
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

    const result = await cliExecutor.cloneRepository(
      deploymentId,
      repositoryUrl,
      branch || 'main',
      githubToken || deployment.githubToken
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to clone repository:', error);
    next(error);
  }
});

/**
 * Generate deployment files
 * POST /api/v1/cli/generate-files
 */
router.post('/generate-files', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, repoPath, terraformCode } = req.body;

    if (!deploymentId || !repoPath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and repoPath are required'
        }
      });
    }

    // Get terraform code from deployment if not provided
    let terraform = terraformCode;
    if (!terraform) {
      const deployment = await Deployment.findOne({ deploymentId });
      if (deployment && deployment.terraformCode) {
        terraform = deployment.terraformCode;
      }
    }

    const result = await cliExecutor.generateDeploymentFiles(
      deploymentId,
      repoPath,
      terraform
    );

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to generate deployment files:', error);
    next(error);
  }
});

/**
 * Execute deployment command
 * POST /api/v1/cli/execute
 */
router.post('/execute', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, command, cwd, env, timeout } = req.body;

    if (!deploymentId || !command) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and command are required'
        }
      });
    }

    // Verify deployment exists
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

    // Execute command (non-blocking, logs stream via WebSocket)
    cliExecutor.executeDeployment(deploymentId, command, { cwd, env, timeout })
      .then(result => {
        // Result already logged, just acknowledge
        logger.info(`Command executed for deployment ${deploymentId}`);
      })
      .catch(error => {
        logger.error(`Command execution failed for deployment ${deploymentId}:`, error);
      });

    res.json({
      success: true,
      message: 'Command execution started. Logs will stream via WebSocket.'
    });
  } catch (error) {
    logger.error('Failed to execute command:', error);
    next(error);
  }
});

/**
 * Get logs for deployment
 * GET /api/v1/cli/logs/:deploymentId
 */
router.get('/logs/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { level, limit = 100, offset = 0 } = req.query;

    const logs = await cliExecutor.getLogs(deploymentId, {
      level,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      data: {
        logs,
        total: logs.length
      }
    });
  } catch (error) {
    logger.error('Failed to get logs:', error);
    next(error);
  }
});

/**
 * Run Terraform command
 * POST /api/v1/cli/terraform
 */
router.post('/terraform', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, command, terraformDir } = req.body;

    if (!deploymentId || !command) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and command are required'
        }
      });
    }

    // Verify deployment exists
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

    // Get terraform directory
    const tempDir = await cliExecutor.getTempDir(deploymentId);
    const tfDir = terraformDir || path.join(tempDir, 'repo', 'terraform');

    // Execute terraform command (non-blocking)
    cliExecutor.runTerraform(deploymentId, command, tfDir)
      .then(result => {
        logger.info(`Terraform ${command} completed for deployment ${deploymentId}`);
      })
      .catch(error => {
        logger.error(`Terraform ${command} failed for deployment ${deploymentId}:`, error);
      });

    res.json({
      success: true,
      message: `Terraform ${command} started. Logs will stream via WebSocket.`
    });
  } catch (error) {
    logger.error('Failed to run terraform command:', error);
    next(error);
  }
});

/**
 * Execute command with SSE streaming
 * POST /api/v1/cli/execute-stream (body params)
 * GET /api/v1/cli/execute-stream?deploymentId=...&command=... (query params)
 * Streams stdout/stderr in real-time via Server-Sent Events
 * Also saves logs to wizard session in real-time
 */
const executeStreamHandler = async (req, res, next) => {
  try {
    // Support both POST (body) and GET (query) parameters
    const deploymentId = req.body.deploymentId || req.query.deploymentId;
    const command = req.body.command || req.query.command;
    const cwd = req.body.cwd || req.query.cwd;
    const env = req.body.env || (req.query.env ? JSON.parse(req.query.env) : undefined);
    const timeout = req.body.timeout || req.query.timeout || 300000;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'command is required'
        }
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial event
    res.write(`data: ${JSON.stringify({ type: 'start', command, timestamp: new Date().toISOString() })}\n\n`);

    // Update command status to running if we have a deploymentId
    if (deploymentId) {
      try {
        await wizardOrchestrator.updateCommandStatus(deploymentId, command, 'running');
        // Save command start log
        await wizardOrchestrator.saveCommandLog(deploymentId, command, `$ ${command}`, 'info');
      } catch (wizardErr) {
        // Don't fail command execution if wizard update fails
        logger.warn(`Failed to update wizard command status: ${wizardErr.message}`);
      }
    }

    // Collect all output for final save
    let fullOutput = '';

    try {
      // Execute with streaming using cliExecutor
      const result = await cliExecutor.executeWithStream(
        deploymentId || 'temp',
        command,
        {
          cwd,
          env,
          timeout,
          onStdout: async (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stdout', content: data, timestamp: new Date().toISOString() })}\n\n`);
            fullOutput += data + '\n';
            
            // Save log to wizard session in real-time
            if (deploymentId) {
              // Don't await - save in background to not slow down streaming
              wizardOrchestrator.saveCommandLog(deploymentId, command, data, 'stdout')
                .catch(err => logger.warn(`Failed to save stdout log: ${err.message}`));
            }
          },
          onStderr: async (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stderr', content: data, timestamp: new Date().toISOString() })}\n\n`);
            fullOutput += data + '\n';
            
            // Save log to wizard session in real-time
            if (deploymentId) {
              wizardOrchestrator.saveCommandLog(deploymentId, command, data, 'stderr')
                .catch(err => logger.warn(`Failed to save stderr log: ${err.message}`));
            }
          }
        }
      );

      // Send completion event
      const success = result.code === 0;
      res.write(`data: ${JSON.stringify({ 
        type: 'complete', 
        exitCode: result.code, 
        success: success,
        timestamp: new Date().toISOString() 
      })}\n\n`);
      
      // Save completion log
      if (deploymentId) {
        const completionMsg = success 
          ? `Command completed successfully (exit code: ${result.code})`
          : `Command failed (exit code: ${result.code})`;
        wizardOrchestrator.saveCommandLog(deploymentId, command, completionMsg, success ? 'info' : 'error')
          .catch(err => logger.warn(`Failed to save completion log: ${err.message}`));
      }
      
    } catch (execError) {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: execError.message,
        timestamp: new Date().toISOString() 
      })}\n\n`);
      
      // Save error log
      if (deploymentId) {
        wizardOrchestrator.saveCommandLog(deploymentId, command, `Error: ${execError.message}`, 'error')
          .catch(err => logger.warn(`Failed to save error log: ${err.message}`));
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    logger.error('Failed to execute stream command:', error);
    
    // If headers already sent, try to send error via SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      next(error);
    }
  }
};

// Register handler for both POST and GET
router.post('/execute-stream', requirePermission('deployments.create'), executeStreamHandler);
router.get('/execute-stream', requirePermission('deployments.create'), executeStreamHandler);

/**
 * Execute Docker command with streaming
 * POST /api/v1/cli/docker-stream
 */
router.post('/docker-stream', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, command, args = [], workDir } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'command is required (e.g., build, compose, run)'
        }
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Build the full docker command
    let fullCommand;
    switch (command) {
      case 'build':
        fullCommand = `docker build ${args.join(' ')}`;
        break;
      case 'compose':
        fullCommand = `docker compose ${args.join(' ')}`;
        break;
      case 'run':
        fullCommand = `docker run ${args.join(' ')}`;
        break;
      case 'ps':
        fullCommand = 'docker ps';
        break;
      case 'images':
        fullCommand = 'docker images';
        break;
      default:
        fullCommand = `docker ${command} ${args.join(' ')}`;
    }

    res.write(`data: ${JSON.stringify({ type: 'start', command: fullCommand, timestamp: new Date().toISOString() })}\n\n`);

    try {
      const result = await cliExecutor.executeWithStream(
        deploymentId || 'temp',
        fullCommand,
        {
          cwd: workDir,
          timeout: 600000, // 10 minutes for Docker operations
          onStdout: (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stdout', content: data, timestamp: new Date().toISOString() })}\n\n`);
          },
          onStderr: (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stderr', content: data, timestamp: new Date().toISOString() })}\n\n`);
          }
        }
      );

      res.write(`data: ${JSON.stringify({ 
        type: 'complete', 
        exitCode: result.code, 
        success: result.code === 0,
        timestamp: new Date().toISOString() 
      })}\n\n`);
      
    } catch (execError) {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: execError.message,
        timestamp: new Date().toISOString() 
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    logger.error('Failed to execute Docker stream:', error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      next(error);
    }
  }
});

/**
 * Execute AWS CLI command with streaming
 * POST /api/v1/cli/aws-stream
 */
router.post('/aws-stream', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, service, subCommand, args = [], region } = req.body;

    if (!service || !subCommand) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'service and subCommand are required (e.g., service: ec2, subCommand: describe-instances)'
        }
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Build the AWS CLI command
    let fullCommand = `aws ${service} ${subCommand}`;
    if (args.length > 0) {
      fullCommand += ` ${args.join(' ')}`;
    }
    if (region) {
      fullCommand += ` --region ${region}`;
    }
    fullCommand += ' --output json';

    res.write(`data: ${JSON.stringify({ type: 'start', command: fullCommand, timestamp: new Date().toISOString() })}\n\n`);

    try {
      const result = await cliExecutor.executeWithStream(
        deploymentId || 'temp',
        fullCommand,
        {
          timeout: 120000, // 2 minutes for AWS commands
          onStdout: (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stdout', content: data, timestamp: new Date().toISOString() })}\n\n`);
          },
          onStderr: (data) => {
            res.write(`data: ${JSON.stringify({ type: 'stderr', content: data, timestamp: new Date().toISOString() })}\n\n`);
          }
        }
      );

      res.write(`data: ${JSON.stringify({ 
        type: 'complete', 
        exitCode: result.code, 
        success: result.code === 0,
        timestamp: new Date().toISOString() 
      })}\n\n`);
      
    } catch (execError) {
      res.write(`data: ${JSON.stringify({ 
        type: 'error', 
        error: execError.message,
        timestamp: new Date().toISOString() 
      })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error) {
    logger.error('Failed to execute AWS stream:', error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      next(error);
    }
  }
});

/**
 * Cleanup deployment temp files
 * DELETE /api/v1/cli/cleanup/:deploymentId
 */
router.delete('/cleanup/:deploymentId', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;

    await cliExecutor.cleanup(deploymentId);

    res.json({
      success: true,
      message: 'Cleanup completed'
    });
  } catch (error) {
    logger.error('Failed to cleanup:', error);
    next(error);
  }
});

module.exports = router;

