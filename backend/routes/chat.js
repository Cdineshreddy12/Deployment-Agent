const express = require('express');
const path = require('path');
const claudeService = require('../services/claude');
const cliExecutor = require('../services/cliExecutor');
const commandExecutor = require('../services/commandExecutor');
const sandboxOrchestrator = require('../services/sandboxOrchestrator');
const workflowOrchestrator = require('../services/workflowOrchestrator');
const progressTracker = require('../services/progressTracker');
const Conversation = require('../models/Conversation');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimit');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Detect sandbox-related intent in user message
 * Returns intent type if detected, null otherwise
 */
function detectSandboxIntent(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  const normalizedMessage = message.toLowerCase().trim();
  
  // Patterns for sandbox deployment and testing
  const sandboxPatterns = [
    /move\s+to\s+sandbox/i,
    /deploy\s+to\s+sandbox/i,
    /test\s+in\s+sandbox/i,
    /sandbox\s+environment/i,
    /sandbox\s+and\s+test/i,
    /deploy\s+and\s+test\s+in\s+sandbox/i,
    /create\s+sandbox\s+and\s+test/i,
    /sandbox\s+deployment/i,
    /run\s+tests\s+in\s+sandbox/i,
    /sandbox\s+testing/i
  ];

  for (const pattern of sandboxPatterns) {
    if (pattern.test(normalizedMessage)) {
      return 'deploy_and_test';
    }
  }

  return null;
}

/**
 * Detect deployment intent in user message
 * Returns intent type if detected, null otherwise
 */
function detectDeploymentIntent(message) {
  if (!message || typeof message !== 'string') {
    return null;
  }

  const normalizedMessage = message.toLowerCase().trim();
  
  // Patterns for deployment commands
  const deploymentPatterns = [
    /deploy\s+infrastructure/i,
    /run\s+terraform\s+apply/i,
    /apply\s+terraform/i,
    /deploy\s+resources/i,
    /create\s+infrastructure/i,
    /deploy\s+to\s+aws/i
  ];

  for (const pattern of deploymentPatterns) {
    if (pattern.test(normalizedMessage)) {
      return 'deploy';
    }
  }

  return null;
}

// All routes require authentication
router.use(authenticate);

// Send chat message
router.post('/message', chatLimiter, validate(schemas.chatMessage), async (req, res, next) => {
  try {
    const { deploymentId, message, stream } = req.body;
    const userId = req.user._id;

    // Check for deployment intent (includes sandbox and direct deployment)
    const sandboxIntent = detectSandboxIntent(message);
    const deploymentIntent = detectDeploymentIntent(message);
    
    // Handle unified deployment workflow
    if (sandboxIntent === 'deploy_and_test' || deploymentIntent === 'deploy') {
      logger.info('Sandbox intent detected in chat message', { deploymentId, message });
      
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

      // Check if deployment has Terraform code
      if (!deployment.terraformCode || !deployment.terraformCode.main) {
        return res.json({
          success: true,
          data: {
            message: 'I detected you want to deploy to sandbox and test. However, this deployment does not have Terraform code yet. Please generate Terraform code first, then I can deploy it to the sandbox environment and run tests.',
            intent: 'sandbox_deploy_and_test',
            requiresTerraformCode: true
          }
        });
      }

      // Use unified deployment workflow
      try {
        const isSandboxDeployment = sandboxIntent === 'deploy_and_test';
        const deploymentMessage = isSandboxDeployment
          ? 'I\'ll deploy your infrastructure to the sandbox environment and run automated tests. This may take a few minutes. You can monitor the progress in real-time...\n\n'
          : 'I\'ll deploy your infrastructure now. This may take a few minutes. You can monitor the progress in real-time...\n\n';

        // For streaming, send initial message then process
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');

          res.write(`data: ${JSON.stringify({ 
            type: 'text', 
            content: deploymentMessage
          })}\n\n`);

          // Progress callback for streaming updates
          const progressCallback = (progressEvent) => {
            progressTracker.trackProgress(deploymentId, progressEvent);
            
            // Send progress updates to stream
            const progressMessage = formatProgressMessage(progressEvent);
            if (progressMessage) {
              res.write(`data: ${JSON.stringify({ 
                type: 'text', 
                content: progressMessage
              })}\n\n`);
            }
          };

          // Start unified deployment workflow
          workflowOrchestrator.startDeployment(deploymentId, {
            source: 'chat',
            autoApprove: true,
            durationHours: isSandboxDeployment ? 4 : undefined,
            progressCallback
          })
            .then(result => {
              const successMessage = formatDeploymentSuccessMessage(result, isSandboxDeployment);
              res.write(`data: ${JSON.stringify({ type: 'text', content: successMessage })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
            })
            .catch(error => {
              logger.error('Deployment workflow error:', error);
              res.write(`data: ${JSON.stringify({ 
                type: 'error', 
                message: `Deployment failed: ${error.message}` 
              })}\n\n`);
              res.end();
            });
        } else {
          // Non-streaming: use async mode
          const progressCallback = (progressEvent) => {
            progressTracker.trackProgress(deploymentId, progressEvent);
          };

          // Start deployment asynchronously
          workflowOrchestrator.startDeployment(deploymentId, {
            source: 'chat',
            autoApprove: true,
            durationHours: isSandboxDeployment ? 4 : undefined,
            progressCallback
          }).catch(error => {
            logger.error('Deployment workflow error:', error);
            progressTracker.emitDeploymentFailed(deploymentId, error);
          });

          res.json({
            success: true,
            data: {
              message: deploymentMessage + '\n\nDeployment started. Monitor progress in the Sandbox tab or check deployment status.',
              intent: isSandboxDeployment ? 'sandbox_deploy_and_test' : 'deploy',
              status: 'started',
              async: true
            }
          });
        }
        return; // Exit early, don't send to Claude
      } catch (error) {
        logger.error('Deployment workflow error:', error);
        
        if (stream) {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: `Failed to start deployment: ${error.message}` 
          })}\n\n`);
          res.end();
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'DEPLOYMENT_FAILED',
              message: error.message
            }
          });
        }
        return;
      }
    }

    // Check for command execution intent
    const commandIntent = commandExecutor.detectCommandIntent(message);
    
    if (commandIntent) {
      logger.info('Command execution intent detected', { deploymentId, commandIntent });
      
      try {
        let commandResult;
        
        if (commandIntent.type === 'terraform') {
          // Execute Terraform command
          commandResult = await commandExecutor.executeTerraformCommand(
            deploymentId,
            commandIntent.command
          );
        } else if (commandIntent.type === 'shell') {
          // Execute shell command
          const tempDir = await cliExecutor.getTempDir(deploymentId);
          commandResult = await commandExecutor.executeCommand(
            deploymentId,
            commandIntent.command,
            { cwd: tempDir }
          );
        }

        // Format results
        const formattedResults = commandExecutor.formatCommandResults(commandResult);
        
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          
          res.write(`data: ${JSON.stringify({ 
            type: 'text', 
            content: `I executed the command for you:\n\n${formattedResults}` 
          })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.json({
            success: true,
            data: {
              message: `I executed the command for you:\n\n${formattedResults}`,
              commandResult: commandResult,
              tokensUsed: { input: 0, output: 0, total: 0 }
            }
          });
        }
        return;
      } catch (error) {
        logger.error('Command execution error:', error);
        const errorMessage = `Failed to execute command: ${error.message}`;
        
        if (stream) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`);
          res.end();
        } else {
          res.status(500).json({
            success: false,
            error: {
              code: 'COMMAND_EXECUTION_FAILED',
              message: errorMessage
            }
          });
        }
        return;
      }
    }

    // No sandbox intent detected, proceed with normal Claude chat
    if (stream) {
      // Set up streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        for await (const chunk of claudeService.chatStream(deploymentId, message, { userId })) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (error) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
        res.end();
      }
    } else {
      // Non-streaming response
      const response = await claudeService.chat(deploymentId, message, { userId });

      res.json({
        success: true,
        data: {
          message: response.message,
          detectedCommands: response.detectedCommands,
          tokensUsed: response.tokensUsed
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

// Get conversation history
router.get('/history/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;

    const conversation = await Conversation.findOne({ deploymentId });

    if (!conversation) {
      return res.json({
        success: true,
        data: {
          messages: [],
          tokensUsed: { input: 0, output: 0, total: 0 }
        }
      });
    }

    res.json({
      success: true,
      data: {
        messages: conversation.messages,
        tokensUsed: conversation.tokensUsed
      }
    });
  } catch (error) {
    next(error);
  }
});

// Regenerate response
router.post('/regenerate', async (req, res, next) => {
  try {
    const { deploymentId, messageId } = req.body;
    const userId = req.user._id;

    const conversation = await Conversation.findOne({ deploymentId });
    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Conversation not found'
        }
      });
    }

    // Find the message to regenerate
    const messageIndex = conversation.messages.findIndex(
      m => m._id.toString() === messageId
    );

    if (messageIndex === -1) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found'
        }
      });
    }

    // Get the user message before this assistant message
    const userMessage = conversation.messages[messageIndex - 1];
    if (!userMessage || userMessage.role !== 'user') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Cannot regenerate this message'
        }
      });
    }

    // Remove the old assistant message and regenerate
    conversation.messages.splice(messageIndex, 1);
    await conversation.save();

    const response = await claudeService.chat(deploymentId, userMessage.content, { userId });

    res.json({
      success: true,
      data: {
        message: response.message,
        tokensUsed: response.tokensUsed
      }
    });
  } catch (error) {
    next(error);
  }
});

// Clear conversation
router.delete('/clear/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;

    await Conversation.findOneAndUpdate(
      { deploymentId },
      { messages: [] }
    );

    res.json({
      success: true,
      message: 'Conversation cleared'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Execute CLI command via chat (for AI-triggered operations)
 * POST /api/v1/chat/cli-execute
 */
router.post('/cli-execute', chatLimiter, async (req, res, next) => {
  try {
    const { deploymentId, operation, params } = req.body;
    const userId = req.user._id;

    if (!deploymentId || !operation) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and operation are required'
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

    let result;

    switch (operation) {
      case 'clone':
        result = await cliExecutor.cloneRepository(
          deploymentId,
          params.repositoryUrl,
          params.branch || 'main',
          params.githubToken || deployment.githubToken
        );
        break;

      case 'generate_files':
        const tempDir = await cliExecutor.getTempDir(deploymentId);
        const repoPath = params.repoPath || path.join(tempDir, 'repo');
        result = await cliExecutor.generateDeploymentFiles(
          deploymentId,
          repoPath,
          params.terraformCode || deployment.terraformCode
        );
        break;

      case 'execute':
        result = await cliExecutor.executeDeployment(
          deploymentId,
          params.command,
          { cwd: params.cwd, env: params.env, timeout: params.timeout }
        );
        break;

      case 'terraform':
        const tfTempDir = await cliExecutor.getTempDir(deploymentId);
        const terraformDir = params.terraformDir || path.join(tfTempDir, 'repo', 'terraform');
        result = await cliExecutor.runTerraform(
          deploymentId,
          params.command,
          terraformDir
        );
        break;

      case 'get_logs':
        result = await cliExecutor.getLogs(deploymentId, {
          level: params.level,
          limit: params.limit || 100,
          offset: params.offset || 0
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_OPERATION',
            message: `Unknown operation: ${operation}`
          }
        });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('CLI execution error:', error);
    next(error);
  }
});

/**
 * Format progress message for chat display
 */
function formatProgressMessage(progressEvent) {
  const { phase, status, progress, message } = progressEvent;
  
  if (status === 'in_progress') {
    return `🔄 ${message} (${progress}%)`;
  } else if (status === 'completed') {
    return `✅ ${message}`;
  } else if (status === 'failed') {
    return `❌ ${message}`;
  }
  
  return null;
}

/**
 * Format deployment success message
 */
function formatDeploymentSuccessMessage(result, isSandboxDeployment) {
  if (isSandboxDeployment && result.testResults) {
    return result.testResults.passed
      ? `✅ Sandbox deployment and testing completed successfully!\n\n` +
        `**Resources Created:** ${result.resources?.length || 0}\n` +
        `**Test Results:**\n` +
        result.testResults.tests.map(test => 
          `- ${test.name}: ${test.passed ? '✅ Passed' : '❌ Failed'}`
        ).join('\n') +
        `\n\nYour infrastructure has been deployed to the sandbox environment and all tests passed.`
      : `⚠️ Sandbox deployment completed but some tests failed.\n\n` +
        `**Resources Created:** ${result.resources?.length || 0}\n` +
        `**Test Results:**\n` +
        result.testResults.tests.map(test => 
          `- ${test.name}: ${test.passed ? '✅ Passed' : '❌ Failed'}`
        ).join('\n');
  }
  
  return `✅ Deployment completed successfully!\n\n` +
    `**Resources Created:** ${result.resources?.length || 0}\n` +
    `**Status:** ${result.status}\n\n` +
    `Your infrastructure has been deployed successfully.`;
}

module.exports = router;

