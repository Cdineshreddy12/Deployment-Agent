const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs').promises;
const { pipelineOrchestrator, STAGES } = require('../services/pipelineOrchestrator');
const { claudeVerification } = require('../services/claudeVerification');
const projectTools = require('../mcp/tools/projectTools');
const envTools = require('../mcp/tools/envTools');
const fileTools = require('../mcp/tools/fileTools');
const portDetector = require('../services/portDetector');
const cursorIntegration = require('../services/cursorIntegration');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1MB max for .env files
  fileFilter: (req, file, cb) => {
    // Only accept .env files
    if (file.originalname.match(/^\.env/)) {
      cb(null, true);
    } else {
      cb(new Error('Only .env files are allowed'));
    }
  }
});

// Apply authentication to all routes
router.use(authenticate);

/**
 * Helper function to read .env files from project directory
 * Returns array of environment variable names
 */
async function readEnvFilesFromProject(deploymentId, projectPath, servicePath = '.') {
  const envVariables = [];
  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];
  
  try {
    // Read from project root
    for (const envFile of envFiles) {
      try {
        const envPath = path.join(projectPath, envFile);
        const content = await fs.readFile(envPath, 'utf8');
        const parsed = envTools.parseEnvContent(content);
        envVariables.push(...Object.keys(parsed));
        logger.info(`Read ${Object.keys(parsed).length} variables from ${envFile}`);
      } catch (err) {
        // File doesn't exist, continue
        if (err.code !== 'ENOENT') {
          logger.warn(`Failed to read ${envFile}:`, err.message);
        }
      }
    }
    
    // Read from service directory if different from root
    if (servicePath && servicePath !== '.') {
      const serviceDir = path.join(projectPath, servicePath);
      for (const envFile of envFiles) {
        try {
          const envPath = path.join(serviceDir, envFile);
          const content = await fs.readFile(envPath, 'utf8');
          const parsed = envTools.parseEnvContent(content);
          envVariables.push(...Object.keys(parsed));
          logger.info(`Read ${Object.keys(parsed).length} variables from ${servicePath}/${envFile}`);
        } catch (err) {
          // File doesn't exist, continue
          if (err.code !== 'ENOENT') {
            logger.warn(`Failed to read ${servicePath}/${envFile}:`, err.message);
          }
        }
      }
    }
    
    // Remove duplicates
    return [...new Set(envVariables)];
  } catch (error) {
    logger.warn(`Failed to read .env files for deployment ${deploymentId}:`, error.message);
    return [];
  }
}

/**
 * Helper function to get project path from deploymentId
 */
function getProjectPath(deploymentId) {
  // Try cursorIntegration first
  const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
  if (workspacePath) {
    return workspacePath;
  }
  
  // Try pipelineOrchestrator
  const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
  if (pipeline && pipeline.projectPath) {
    return pipeline.projectPath;
  }
  
  return null;
}

/**
 * POST /api/v1/project/analyze
 * Analyze a local project directory
 */
router.post('/analyze', async (req, res, next) => {
  try {
    const { path: projectPath } = req.body;

    if (!projectPath) {
      return res.status(400).json({
        success: false,
        error: 'Project path is required'
      });
    }

    logger.info(`Analyzing project: ${projectPath}`);

    // Perform project analysis
    const analysis = await projectTools.analyzeProject({ projectPath });

    if (!analysis.success) {
      return res.status(400).json({
        success: false,
        error: analysis.error
      });
    }

    // Detect ports from project files
    const detectedPorts = await portDetector.detectPorts(projectPath);
    
    // Merge detected ports into services
    const servicesWithPorts = (analysis.services || []).map(service => {
      const portInfo = detectedPorts[service.name] || detectedPorts[service.type] || detectedPorts.main;
      const port = typeof portInfo === 'object' ? portInfo.port : portInfo;
      return {
        ...service,
        port: port || service.port || portDetector.defaultPorts[service.type] || 3000
      };
    });

    // Generate a deployment ID for this project
    const deploymentId = uuidv4();

    // Set workspace path in cursor integration for file reading
    cursorIntegration.setWorkspacePath(deploymentId, projectPath);

    // Initialize pipeline
    await pipelineOrchestrator.initializePipeline(deploymentId, projectPath);
    
    // Create a Deployment document to store userId for Claude conversations
    const Deployment = require('../models/Deployment');
    try {
      await Deployment.create({
        deploymentId,
        userId: req.user._id,
        userName: req.user.name || req.user.email,
        userEmail: req.user.email,
        name: analysis.projectPath.split('/').pop() || 'Untitled Project',
        environment: 'development',
        status: 'ANALYZING',
        repositoryUrl: projectPath
      });
    } catch (dbError) {
      logger.warn('Could not create deployment record:', dbError.message);
      // Continue even if DB save fails - we'll handle missing userId later
    }

    res.json({
      success: true,
      deploymentId,
      data: {
        projectPath: analysis.projectPath,
        projectType: analysis.projectType,
        framework: analysis.framework,
        services: servicesWithPorts,
        structure: analysis.structure,
        envStatus: analysis.envStatus,
        missingFiles: analysis.missingFiles,
        recommendations: analysis.recommendations,
        detectedPorts
      }
    });

  } catch (error) {
    logger.error('Project analysis failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/env
 * Store environment variables (upload file or paste content)
 */
router.post('/env', upload.single('envFile'), async (req, res, next) => {
  try {
    const { deploymentId, service = 'main', content } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    let envContent = content;

    // If file was uploaded, use its content
    if (req.file) {
      envContent = req.file.buffer.toString('utf8');
    }

    if (!envContent) {
      return res.status(400).json({
        success: false,
        error: 'Either envFile or content is required'
      });
    }

    // Store encrypted env
    const result = await envTools.storeEnv({
      deploymentId,
      content: envContent,
      service,
      overwrite: true
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update pipeline context
    await pipelineOrchestrator.storeUserEnv(deploymentId, envContent, service);

    res.json({
      success: true,
      data: {
        deploymentId,
        service,
        variableCount: result.variableCount,
        variableKeys: result.variableKeys,
        message: result.message
      }
    });

  } catch (error) {
    logger.error('Env storage failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/:id/env
 * Get stored environment variables (decrypted)
 */
router.get('/:id/env', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { service = 'main', format = 'object' } = req.query;

    const result = await envTools.retrieveEnv({
      deploymentId,
      service,
      format
    });

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Env retrieval failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/:id/env/list
 * List all stored environments for a deployment
 */
router.get('/:id/env/list', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const result = await envTools.listEnvs({ deploymentId });

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Env list failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/generate
 * Generate infrastructure files (preview before writing)
 */
router.post('/generate', async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    // Execute generate files stage
    const result = await pipelineOrchestrator.executeCurrentStage(deploymentId);

    res.json({
      success: result.success,
      data: result.data,
      message: result.message,
      needsVerification: result.needsVerification
    });

  } catch (error) {
    logger.error('File generation failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/generate/confirm
 * Confirm and write generated files to disk
 */
router.post('/generate/confirm', async (req, res, next) => {
  try {
    const { deploymentId, approve = true, feedback } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    // Get Claude verification if approved
    if (approve) {
      const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
      const verification = await claudeVerification.verifyStageResult(
        pipeline.currentStage,
        { data: { files: pipeline.context.generatedFiles } }
      );

      if (!verification.approved) {
        return res.json({
          success: false,
          verification,
          message: 'Claude did not approve the generated files'
        });
      }
    }

    // Advance to next stage (writes files)
    const result = await pipelineOrchestrator.advanceToNextStage(deploymentId, approve, feedback);

    res.json({
      success: result.success,
      data: result,
      message: result.message
    });

  } catch (error) {
    logger.error('Generate confirm failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/build
 * Start Docker build with log streaming (SSE)
 */
router.post('/build', async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Subscribe to build logs
    const unsubscribe = pipelineOrchestrator.on('log', (data) => {
      if (data.deploymentId === deploymentId) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    });

    pipelineOrchestrator.on('build:completed', (data) => {
      if (data.deploymentId === deploymentId) {
        res.write(`data: ${JSON.stringify({ type: 'build_complete', ...data })}\n\n`);
      }
    });

    // Execute build stage
    const result = await pipelineOrchestrator.executeCurrentStage(deploymentId);

    // Send final result
    res.write(`data: ${JSON.stringify({ type: 'result', ...result })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    logger.error('Build failed:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/v1/project/test
 * Start local Docker test with log streaming (SSE)
 */
router.post('/test', async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Subscribe to logs
    pipelineOrchestrator.on('log', (data) => {
      if (data.deploymentId === deploymentId) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    });

    // Execute test stage
    const result = await pipelineOrchestrator.executeCurrentStage(deploymentId);

    res.write(`data: ${JSON.stringify({ type: 'result', ...result })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    logger.error('Test failed:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/v1/project/deploy
 * Deploy to production with log streaming (SSE)
 */
router.post('/deploy', async (req, res, next) => {
  try {
    const { deploymentId, skipLocalTest = false, skipInfra = false } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: 'Pipeline not found' })}\n\n`);
      res.end();
      return;
    }

    // Update options
    pipeline.options.skipLocalTest = skipLocalTest;
    pipeline.options.skipInfra = skipInfra;

    // Subscribe to all events
    const events = ['log', 'stage:started', 'stage:completed', 'stage:failed', 
                   'build:started', 'build:completed', 'infra:started', 'infra:completed',
                   'deploy:started', 'deploy:completed', 'pipeline:completed'];

    for (const event of events) {
      pipelineOrchestrator.on(event, (data) => {
        if (data.deploymentId === deploymentId) {
          res.write(`data: ${JSON.stringify({ type: event.replace(':', '_'), ...data })}\n\n`);
        }
      });
    }

    // Run through remaining stages
    while (pipeline.currentStage !== STAGES.COMPLETE && pipeline.status !== 'error') {
      res.write(`data: ${JSON.stringify({ type: 'stage_start', stage: pipeline.currentStage })}\n\n`);

      const result = await pipelineOrchestrator.executeCurrentStage(deploymentId);
      
      res.write(`data: ${JSON.stringify({ type: 'stage_result', stage: pipeline.currentStage, ...result })}\n\n`);

      if (!result.success) {
        res.write(`data: ${JSON.stringify({ type: 'error', stage: pipeline.currentStage, error: result.error })}\n\n`);
        break;
      }

      // Claude verification
      const verification = await claudeVerification.verifyStageResult(pipeline.currentStage, result);
      res.write(`data: ${JSON.stringify({ type: 'verification', stage: pipeline.currentStage, ...verification })}\n\n`);

      if (!verification.approved) {
        res.write(`data: ${JSON.stringify({ type: 'verification_failed', stage: pipeline.currentStage, issues: verification.issues })}\n\n`);
        break;
      }

      // Advance to next stage
      await pipelineOrchestrator.advanceToNextStage(deploymentId, true);
    }

    // Generate summary
    const summary = await claudeVerification.generateDeploymentSummary(deploymentId, pipeline.context);
    res.write(`data: ${JSON.stringify({ type: 'summary', summary })}\n\n`);

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    logger.error('Deploy failed:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/v1/project/:id/logs
 * Stream deployment logs (SSE)
 */
router.get('/:id/logs', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { type = 'all' } = req.query; // all, docker, terraform, ssh

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Subscribe to logs
    const handler = (data) => {
      if (data.deploymentId === deploymentId) {
        if (type === 'all' || data.type === type) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      }
    };

    pipelineOrchestrator.on('log', handler);

    // Handle client disconnect
    req.on('close', () => {
      pipelineOrchestrator.off('log', handler);
    });

    // Send heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(heartbeat);
    });

  } catch (error) {
    logger.error('Log streaming failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/:id/status
 * Get pipeline status
 */
router.get('/:id/status', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const summary = pipelineOrchestrator.getPipelineSummary(deploymentId);

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    res.json({
      success: true,
      data: summary
    });

  } catch (error) {
    logger.error('Status check failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/:id/stage/verify
 * Manually verify current stage
 */
router.post('/:id/stage/verify', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { approve = true, feedback } = req.body;

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    // Get last stage result
    const lastResult = pipeline.stageHistory[pipeline.stageHistory.length - 1];

    if (approve) {
      // Claude verification
      const verification = await claudeVerification.verifyStageResult(
        pipeline.currentStage,
        lastResult?.result || {}
      );

      res.json({
        success: verification.approved,
        verification,
        message: verification.approved 
          ? 'Stage verified successfully' 
          : 'Verification failed'
      });
    } else {
      res.json({
        success: false,
        message: 'Stage manually rejected',
        feedback
      });
    }

  } catch (error) {
    logger.error('Stage verification failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/:id/stage/advance
 * Advance to next stage
 */
router.post('/:id/stage/advance', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { approve = true, feedback } = req.body;

    const result = await pipelineOrchestrator.advanceToNextStage(deploymentId, approve, feedback);

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    logger.error('Stage advance failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/:id/rollback
 * Rollback deployment
 */
router.post('/:id/rollback', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { targetStage, reason } = req.body;

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    // For now, simple rollback - stop containers if running
    const dockerTools = require('../mcp/tools/dockerTools');
    
    // Stop docker-compose if test was running
    if (pipeline.context.testResults) {
      try {
        const { spawn } = require('child_process');
        const proc = spawn('docker', ['compose', 'down'], { cwd: pipeline.projectPath });
        await new Promise((resolve) => proc.on('close', resolve));
      } catch (e) {
        logger.warn('Docker compose down failed:', e);
      }
    }

    // Record rollback
    pipeline.status = 'rolled_back';
    pipeline.stageHistory.push({
      stage: 'ROLLBACK',
      reason,
      targetStage,
      completedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Rollback completed',
      data: {
        rolledBackFrom: pipeline.currentStage,
        reason
      }
    });

  } catch (error) {
    logger.error('Rollback failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/:id/files
 * Get project file structure
 */
router.get('/:id/files', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    const files = await fileTools.listFiles({
      projectPath: pipeline.projectPath,
      recursive: true
    });

    // Mark generated files
    const generatedPaths = new Set(
      (pipeline.context.generatedFiles || []).map(f => f.path)
    );

    if (files.files) {
      files.files = files.files.map(f => ({
        ...f,
        isGenerated: generatedPaths.has(f.path)
      }));
    }

    res.json({
      success: true,
      data: files
    });

  } catch (error) {
    logger.error('File listing failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/:id/file
 * Read a specific file
 */
router.get('/:id/file', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { path: filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: 'filePath query parameter is required'
      });
    }

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    if (!pipeline) {
      return res.status(404).json({
        success: false,
        error: 'Pipeline not found'
      });
    }

    const fullPath = filePath.startsWith('/') 
      ? filePath 
      : `${pipeline.projectPath}/${filePath}`;

    const result = await fileTools.readFile({ filePath: fullPath });

    res.json({
      success: result.success,
      data: result
    });

  } catch (error) {
    logger.error('File read failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/:id/ask
 * Ask Claude for clarification
 */
router.post('/:id/ask', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { question, context } = req.body;

    const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
    const pipelineContext = pipeline?.context || {};

    const questions = await claudeVerification.generateClarificationQuestions(
      pipeline?.currentStage || 'unknown',
      { ...pipelineContext, userQuestion: question, additionalContext: context }
    );

    res.json({
      success: true,
      data: questions
    });

  } catch (error) {
    logger.error('Ask failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/generate-docker
 * Generate Dockerfile for a specific service using Claude
 */
router.post('/generate-docker', async (req, res, next) => {
  try {
    const dockerGenerator = require('../services/dockerGenerator');
    const {
      deploymentId,
      serviceName,
      serviceType,
      framework,
      packageJson,
      envVariables: providedEnvVariables,
      projectStructure,
      servicePath
    } = req.body;

    if (!serviceName) {
      return res.status(400).json({
        success: false,
        error: 'serviceName is required'
      });
    }

    const actualServicePath = servicePath || '.';
    let envVariables = providedEnvVariables || [];
    let writtenFilePath = null;

    // Read .env files from project if deploymentId is provided
    if (deploymentId) {
      const projectPath = getProjectPath(deploymentId);
      if (projectPath) {
        try {
          const envVarsFromFiles = await readEnvFilesFromProject(deploymentId, projectPath, actualServicePath);
          if (envVarsFromFiles.length > 0) {
            // Merge with provided env variables, avoiding duplicates
            const allEnvVars = new Set([...envVariables, ...envVarsFromFiles]);
            envVariables = Array.from(allEnvVars);
            logger.info(`Found ${envVarsFromFiles.length} environment variables from .env files`);
          }
        } catch (error) {
          logger.warn(`Failed to read .env files: ${error.message}`);
        }
      }
    }

    logger.info(`Generating Dockerfile for service: ${serviceName}`);

    const result = await dockerGenerator.generateDockerfile({
      serviceName,
      serviceType: serviceType || 'backend',
      framework,
      packageJson: packageJson || {},
      envVariables,
      projectStructure: projectStructure || {},
      servicePath: actualServicePath
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // Write Dockerfile to project directory
    if (deploymentId) {
      const projectPath = getProjectPath(deploymentId);
      if (projectPath) {
        try {
          const dockerfilePath = actualServicePath === '.' 
            ? 'Dockerfile' 
            : path.join(actualServicePath, 'Dockerfile');
          const fullPath = path.join(projectPath, dockerfilePath);
          
          // Ensure directory exists
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          
          // Write file
          await fs.writeFile(fullPath, result.content, 'utf8');
          writtenFilePath = dockerfilePath;
          logger.info(`Dockerfile written to: ${fullPath}`);
        } catch (writeError) {
          logger.error(`Failed to write Dockerfile to disk: ${writeError.message}`);
          // Continue - we'll still return the content so user can manually save
        }
      } else {
        logger.warn(`No project path found for deployment ${deploymentId}, Dockerfile not written to disk`);
      }
    }

    // Update pipeline context
    if (deploymentId) {
      const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
      if (pipeline) {
        if (!pipeline.context.generatedFiles) {
          pipeline.context.generatedFiles = [];
        }
        pipeline.context.generatedFiles.push({
          path: writtenFilePath || `${actualServicePath === '.' ? '' : actualServicePath + '/'}Dockerfile`,
          content: result.content,
          type: 'dockerfile',
          service: serviceName,
          generatedAt: new Date(),
          writtenToDisk: !!writtenFilePath
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...result,
        writtenFilePath,
        envVariablesUsed: envVariables
      }
    });

  } catch (error) {
    logger.error('Dockerfile generation failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/generate-compose
 * Generate docker-compose.yml for the entire project using Claude
 */
router.post('/generate-compose', async (req, res, next) => {
  try {
    const dockerGenerator = require('../services/dockerGenerator');
    const {
      deploymentId,
      services,
      databases,
      projectInfo,
      envVariables: providedEnvVariables,
      projectStructure
    } = req.body;

    if (!services || services.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one service is required'
      });
    }

    let envVariables = providedEnvVariables || [];
    let writtenFilePath = null;

    // Read .env files from project root if deploymentId is provided
    if (deploymentId) {
      const projectPath = getProjectPath(deploymentId);
      if (projectPath) {
        try {
          const envVarsFromFiles = await readEnvFilesFromProject(deploymentId, projectPath, '.');
          if (envVarsFromFiles.length > 0) {
            // Merge with provided env variables, avoiding duplicates
            const allEnvVars = new Set([...envVariables, ...envVarsFromFiles]);
            envVariables = Array.from(allEnvVars);
            logger.info(`Found ${envVarsFromFiles.length} environment variables from .env files`);
          }
        } catch (error) {
          logger.warn(`Failed to read .env files: ${error.message}`);
        }
      }
    }

    logger.info(`Generating docker-compose.yml for ${services.length} services`);

    const result = await dockerGenerator.generateDockerCompose({
      services: services || [],
      databases: databases || [],
      projectInfo: projectInfo || {},
      envVariables,
      projectStructure: projectStructure || {}
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // Write docker-compose.yml to project root
    if (deploymentId) {
      const projectPath = getProjectPath(deploymentId);
      if (projectPath) {
        try {
          const composePath = path.join(projectPath, 'docker-compose.yml');
          await fs.writeFile(composePath, result.content, 'utf8');
          writtenFilePath = 'docker-compose.yml';
          logger.info(`docker-compose.yml written to: ${composePath}`);
        } catch (writeError) {
          logger.error(`Failed to write docker-compose.yml to disk: ${writeError.message}`);
          // Continue - we'll still return the content so user can manually save
        }
      } else {
        logger.warn(`No project path found for deployment ${deploymentId}, docker-compose.yml not written to disk`);
      }
    }

    // Update pipeline context
    if (deploymentId) {
      const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
      if (pipeline) {
        if (!pipeline.context.generatedFiles) {
          pipeline.context.generatedFiles = [];
        }
        pipeline.context.generatedFiles.push({
          path: writtenFilePath || 'docker-compose.yml',
          content: result.content,
          type: 'docker-compose',
          generatedAt: new Date(),
          writtenToDisk: !!writtenFilePath
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...result,
        writtenFilePath,
        envVariablesUsed: envVariables
      }
    });

  } catch (error) {
    logger.error('docker-compose.yml generation failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/generate-dockerignore
 * Generate .dockerignore file
 */
router.post('/generate-dockerignore', async (req, res, next) => {
  try {
    const dockerGenerator = require('../services/dockerGenerator');
    const { deploymentId, framework, language, servicePath } = req.body;

    const actualServicePath = servicePath || '.';
    let writtenFilePath = null;

    const result = await dockerGenerator.generateDockerignore({
      framework,
      language: language || 'javascript'
    });

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // Write .dockerignore to project directory
    if (deploymentId) {
      const projectPath = getProjectPath(deploymentId);
      if (projectPath) {
        try {
          const dockerignorePath = actualServicePath === '.' 
            ? '.dockerignore' 
            : path.join(actualServicePath, '.dockerignore');
          const fullPath = path.join(projectPath, dockerignorePath);
          
          // Ensure directory exists
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          
          // Write file
          await fs.writeFile(fullPath, result.content, 'utf8');
          writtenFilePath = dockerignorePath;
          logger.info(`.dockerignore written to: ${fullPath}`);
        } catch (writeError) {
          logger.error(`Failed to write .dockerignore to disk: ${writeError.message}`);
          // Continue - we'll still return the content so user can manually save
        }
      } else {
        logger.warn(`No project path found for deployment ${deploymentId}, .dockerignore not written to disk`);
      }
    }

    // Update pipeline context
    if (deploymentId) {
      const pipeline = pipelineOrchestrator.getPipeline(deploymentId);
      if (pipeline) {
        if (!pipeline.context.generatedFiles) {
          pipeline.context.generatedFiles = [];
        }
        pipeline.context.generatedFiles.push({
          path: writtenFilePath || `${actualServicePath && actualServicePath !== '.' ? actualServicePath + '/' : ''}.dockerignore`,
          content: result.content,
          type: 'dockerignore',
          generatedAt: new Date(),
          writtenToDisk: !!writtenFilePath
        });
      }
    }

    res.json({
      success: true,
      data: {
        ...result,
        writtenFilePath
      }
    });

  } catch (error) {
    logger.error('.dockerignore generation failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/:id/env/import
 * Import .env file from project structure and store as credential
 */
router.post('/:id/env/import', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { filePath, content, name, service } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'content is required'
      });
    }

    // Parse the .env content
    const variables = {};
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        let cleanValue = value.trim();
        // Remove surrounding quotes
        if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
          cleanValue = cleanValue.slice(1, -1);
        }
        variables[key] = cleanValue;
      }
    }

    // Store using envTools
    const result = await envTools.storeEnv({
      deploymentId,
      content,
      service: service || 'main',
      overwrite: true
    });

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Update pipeline context
    await pipelineOrchestrator.storeUserEnv(deploymentId, content, service || 'main');

    res.json({
      success: true,
      data: {
        deploymentId,
        service: service || 'main',
        filePath,
        variableCount: Object.keys(variables).length,
        variableKeys: Object.keys(variables),
        message: `Imported ${Object.keys(variables).length} variables from ${filePath || '.env'}`
      }
    });

  } catch (error) {
    logger.error('Env import failed:', error);
    next(error);
  }
});

// ============================================================================
// WIZARD ENDPOINTS
// ============================================================================

const wizardOrchestrator = require('../services/wizardOrchestrator');

/**
 * POST /api/v1/project/wizard/init
 * Initialize a wizard session for a deployment
 */
router.post('/wizard/init', async (req, res, next) => {
  try {
    const { deploymentId, projectContext } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId is required'
      });
    }

    // Get userId from authenticated user
    const userId = req.user?.id || req.user?._id;
    
    // Normalize projectContext before passing to initSession
    const normalizedProjectContext = { ...projectContext };
    if (normalizedProjectContext && normalizedProjectContext.generatedFiles !== undefined) {
      const rawGeneratedFiles = normalizedProjectContext.generatedFiles;
      
      // Log what we received
      logger.info('Route handler: Received generatedFiles', {
        type: typeof rawGeneratedFiles,
        isArray: Array.isArray(rawGeneratedFiles),
        preview: typeof rawGeneratedFiles === 'string' 
          ? rawGeneratedFiles.substring(0, 300)
          : Array.isArray(rawGeneratedFiles)
            ? `Array with ${rawGeneratedFiles.length} items`
            : String(rawGeneratedFiles).substring(0, 300)
      });
      
      // CRITICAL: Early validation - reject JavaScript code strings with clear error
      if (typeof rawGeneratedFiles === 'string') {
        const isJavaScriptCode = 
          rawGeneratedFiles.includes("' +\n") || 
          rawGeneratedFiles.includes('" +\n') || 
          rawGeneratedFiles.includes("' +\\n") || 
          rawGeneratedFiles.includes('" +\\n') ||
          rawGeneratedFiles.trim().startsWith("[\n' +") || 
          rawGeneratedFiles.trim().startsWith('[\n" +') ||
          rawGeneratedFiles.includes("' +\n  '") ||
          rawGeneratedFiles.includes('" +\n  "') ||
          /^\s*\[\s*['"]\s*\+\s*\\?n/.test(rawGeneratedFiles);
        
        if (isJavaScriptCode) {
          logger.error('Route handler: Detected JavaScript code string in generatedFiles! This indicates a serialization error in the frontend.');
          logger.error('String preview:', rawGeneratedFiles.substring(0, 500));
          
          // Return clear error to help identify the root cause
          return res.status(400).json({
            success: false,
            error: 'Invalid generatedFiles format: received JavaScript code string instead of array',
            details: 'The generatedFiles field contains JavaScript string concatenation syntax. This suggests the data was incorrectly serialized before being sent to the API. Please check the frontend code that prepares this data.',
            receivedType: typeof rawGeneratedFiles,
            preview: rawGeneratedFiles.substring(0, 200)
          });
        } else {
          // Try to parse as JSON if it's a string
          try {
            const parsed = JSON.parse(rawGeneratedFiles);
            if (Array.isArray(parsed)) {
              normalizedProjectContext.generatedFiles = parsed;
            } else {
              logger.warn('Route handler: Parsed JSON is not an array, forcing to empty array');
              normalizedProjectContext.generatedFiles = [];
            }
          } catch (e) {
            logger.error('Route handler: Failed to parse generatedFiles string as JSON:', e.message);
            normalizedProjectContext.generatedFiles = [];
          }
        }
      }
      
      // Now normalize using the wizard orchestrator's normalization function
      if (normalizedProjectContext.generatedFiles !== undefined && normalizedProjectContext.generatedFiles !== null) {
        const normalized = wizardOrchestrator.normalizeGeneratedFiles(
          normalizedProjectContext.generatedFiles
        );
        
        // CRITICAL: Ensure normalization returned an array, not a string
        if (typeof normalized === 'string') {
          logger.error('CRITICAL: normalizeGeneratedFiles returned a string! Forcing to empty array.');
          logger.error('String preview:', normalized.substring(0, 500));
          normalizedProjectContext.generatedFiles = [];
        } else if (!Array.isArray(normalized)) {
          logger.error('CRITICAL: normalizeGeneratedFiles did not return an array! Type:', typeof normalized);
          normalizedProjectContext.generatedFiles = [];
        } else {
          normalizedProjectContext.generatedFiles = normalized;
        }
      }
    }
    
    // CRITICAL: Final safety check before passing to initSession
    // Ensure generatedFiles is definitely an array, never a string
    if (normalizedProjectContext && normalizedProjectContext.generatedFiles !== undefined) {
      if (typeof normalizedProjectContext.generatedFiles === 'string') {
        logger.error('CRITICAL: After all normalization, generatedFiles is still a string! Forcing to empty array.');
        logger.error('String preview:', normalizedProjectContext.generatedFiles.substring(0, 500));
        normalizedProjectContext.generatedFiles = [];
      } else if (!Array.isArray(normalizedProjectContext.generatedFiles)) {
        logger.error('CRITICAL: After normalization, generatedFiles is not an array! Type:', typeof normalizedProjectContext.generatedFiles);
        normalizedProjectContext.generatedFiles = [];
      } else {
        // CRITICAL: JSON round-trip to ensure clean serialization (removes any Mongoose artifacts)
        try {
          normalizedProjectContext.generatedFiles = JSON.parse(JSON.stringify(normalizedProjectContext.generatedFiles));
          logger.debug('Route handler: Applied JSON round-trip for clean serialization', {
            length: normalizedProjectContext.generatedFiles.length
          });
        } catch (e) {
          logger.error('Route handler: JSON round-trip failed, using original array:', e.message);
        }
      }
      
      logger.info('Route handler: Final validated generatedFiles before initSession', {
        isArray: Array.isArray(normalizedProjectContext.generatedFiles),
        length: normalizedProjectContext.generatedFiles.length,
        type: typeof normalizedProjectContext.generatedFiles
      });
    }
    
    const session = await wizardOrchestrator.initSession(deploymentId, normalizedProjectContext || {}, userId);

    res.json({
      success: true,
      data: {
        deploymentId,
        currentStage: session.currentStage,
        stages: wizardOrchestrator.getAllStages()
      }
    });

  } catch (error) {
    logger.error('Wizard init failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/status
 * Get wizard status for a deployment
 */
router.get('/wizard/:id/status', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    
    const status = await wizardOrchestrator.getStatus(deploymentId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Wizard session not found'
      });
    }

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Wizard status failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/step
 * Get instructions for a wizard stage or execute an action
 */
router.post('/wizard/step', async (req, res, next) => {
  try {
    const { deploymentId, stage, action, projectContext } = req.body;

    if (!deploymentId || !stage) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId and stage are required'
      });
    }

    // Auto-initialize session if it doesn't exist
    let session = await wizardOrchestrator.getSession(deploymentId);
    let wasAutoInitialized = false;
    if (!session) {
      logger.info(`Auto-initializing wizard session for ${deploymentId}`);
      session = await wizardOrchestrator.initSession(deploymentId, projectContext || {});
      wasAutoInitialized = true;
    }

    switch (action) {
      case 'generate':
        // Generate instructions for the stage
        const instructions = await wizardOrchestrator.generateStageInstructions(deploymentId, stage);
        return res.json({
          success: true,
          data: {
            ...instructions,
            // Include session info if it was just auto-initialized
            ...(wasAutoInitialized ? {
              sessionInitialized: true,
              stages: wizardOrchestrator.getAllStages()
            } : {})
          }
        });

      case 'verify':
        // Verify stage completion
        const verification = await wizardOrchestrator.verifyStage(deploymentId, stage);
        return res.json({
          success: true,
          data: verification
        });

      case 'complete':
        // Mark stage as complete
        const { success: stageSuccess, notes } = req.body;
        const completion = await wizardOrchestrator.completeStage(
          deploymentId,
          stage,
          stageSuccess !== false,
          notes || ''
        );
        return res.json({
          success: true,
          data: completion
        });

      case 'analyze-error':
        // Analyze a failed command and suggest fixes
        const { command, errorOutput, exitCode } = req.body;
        if (!command) {
          return res.status(400).json({
            success: false,
            error: 'command is required for analyze-error action'
          });
        }
        const errorAnalysis = await wizardOrchestrator.analyzeError(
          deploymentId,
          stage,
          command,
          errorOutput || '',
          exitCode
        );
        return res.json({
          success: true,
          data: errorAnalysis
        });

      case 'analyze-errors':
        // Analyze multiple failed commands and generate fix plan
        const { failedCommands } = req.body;
        if (!failedCommands || !Array.isArray(failedCommands) || failedCommands.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'failedCommands array is required for analyze-errors action'
          });
        }
        const fixPlan = await wizardOrchestrator.generateFixCommands(
          deploymentId,
          stage,
          failedCommands
        );
        return res.json({
          success: true,
          data: fixPlan
        });

      case 'auto-verify':
        // Automatically verify stage and determine next action
        const autoVerifyResult = await wizardOrchestrator.autoVerifyStage(deploymentId, stage);
        return res.json({
          success: true,
          data: autoVerifyResult
        });

      default:
        // Just get stage info
        const stageInfo = wizardOrchestrator.getStageInfo(stage);
        return res.json({
          success: true,
          data: {
            stage: stageInfo,
            session: {
              currentStage: session.currentStage,
              stageHistory: session.stageHistory
            }
          }
        });
    }

  } catch (error) {
    logger.error('Wizard step failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/record
 * Record command execution result
 */
router.post('/wizard/:id/record', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { stage, command, result } = req.body;

    if (!stage || !command) {
      return res.status(400).json({
        success: false,
        error: 'stage and command are required'
      });
    }

    await wizardOrchestrator.recordExecution(deploymentId, stage, command, result);

    res.json({
      success: true,
      message: 'Execution recorded'
    });

  } catch (error) {
    logger.error('Wizard record failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/reset
 * Reset wizard to a specific stage
 */
router.post('/wizard/:id/reset', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { toStage } = req.body;

    if (!toStage) {
      return res.status(400).json({
        success: false,
        error: 'toStage is required'
      });
    }

    const status = await wizardOrchestrator.resetToStage(deploymentId, toStage);

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Wizard reset failed:', error);
    next(error);
  }
});

/**
 * DELETE /api/v1/project/wizard/:id
 * Cleanup wizard session (just cache, not database)
 */
router.delete('/wizard/:id', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { permanent } = req.query;

    if (permanent === 'true') {
      await wizardOrchestrator.deleteSession(deploymentId);
      res.json({
        success: true,
        message: 'Wizard session permanently deleted'
      });
    } else {
      wizardOrchestrator.cleanupCache(deploymentId);
      res.json({
        success: true,
        message: 'Wizard session cache cleaned up'
      });
    }

  } catch (error) {
    logger.error('Wizard cleanup failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/session
 * Get full session data including all history
 */
router.get('/wizard/:id/session', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const session = await wizardOrchestrator.getFullSession(deploymentId);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Wizard session not found'
      });
    }

    res.json({
      success: true,
      data: session
    });

  } catch (error) {
    logger.error('Get wizard session failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/history
 * Get stage history
 */
router.get('/wizard/:id/history', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { stageId } = req.query;

    const history = await wizardOrchestrator.getStageHistory(deploymentId, stageId);

    if (!history) {
      return res.status(404).json({
        success: false,
        error: 'Wizard session not found'
      });
    }

    res.json({
      success: true,
      data: history
    });

  } catch (error) {
    logger.error('Get wizard history failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/stage/:stageId
 * Get specific stage details
 */
router.get('/wizard/:id/stage/:stageId', async (req, res, next) => {
  try {
    const { id: deploymentId, stageId } = req.params;

    const stageData = await wizardOrchestrator.getStageHistory(deploymentId, stageId);

    if (!stageData) {
      return res.status(404).json({
        success: false,
        error: 'Stage data not found'
      });
    }

    res.json({
      success: true,
      data: stageData
    });

  } catch (error) {
    logger.error('Get wizard stage failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/pause
 * Pause a wizard session
 */
router.post('/wizard/:id/pause', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const result = await wizardOrchestrator.pauseSession(deploymentId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Wizard pause failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/resume
 * Resume a paused wizard session
 */
router.post('/wizard/:id/resume', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const status = await wizardOrchestrator.resumeSession(deploymentId);

    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('Wizard resume failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/logs
 * Append terminal logs for current stage
 */
router.post('/wizard/:id/logs', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { logs } = req.body;

    if (!logs) {
      return res.status(400).json({
        success: false,
        error: 'logs is required'
      });
    }

    await wizardOrchestrator.appendTerminalLogs(deploymentId, logs);

    res.json({
      success: true,
      message: 'Logs appended'
    });

  } catch (error) {
    logger.error('Append wizard logs failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/next-command
 * Get the next command to execute in the queue
 */
router.get('/wizard/:id/next-command', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    
    const nextCommand = await wizardOrchestrator.getNextCommand(deploymentId);
    const queueStatus = await wizardOrchestrator.getCommandQueueStatus(deploymentId);

    res.json({
      success: true,
      data: {
        command: nextCommand,
        isBlocked: queueStatus.isBlocked,
        blockingError: queueStatus.blockingError,
        queue: queueStatus.queue,
        progress: queueStatus.progress
      }
    });

  } catch (error) {
    logger.error('Get next command failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/execute-command
 * Record command execution result and advance queue
 */
router.post('/wizard/:id/execute-command', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { command, success, exitCode, output } = req.body;

    if (!command) {
      return res.status(400).json({
        success: false,
        error: 'command is required'
      });
    }

    const result = await wizardOrchestrator.markCommandComplete(
      deploymentId,
      command,
      success,
      exitCode,
      output
    );

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Execute command failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/resolve-error
 * Analyze blocking error with Claude and insert fix commands
 */
router.post('/wizard/:id/resolve-error', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { stageId } = req.body;

    if (!stageId) {
      return res.status(400).json({
        success: false,
        error: 'stageId is required'
      });
    }

    const result = await wizardOrchestrator.resolveBlockingError(deploymentId, stageId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Resolve error failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/skip-command
 * Skip a blocked command and continue with the next one
 */
router.post('/wizard/:id/skip-command', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;

    const result = await wizardOrchestrator.skipBlockedCommand(deploymentId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Skip command failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/pending-files
 * Get pending file proposals awaiting approval
 */
router.get('/wizard/:id/pending-files', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    
    const proposals = await wizardOrchestrator.getPendingFileProposals(deploymentId);

    res.json({
      success: true,
      data: {
        proposals,
        count: proposals.length
      }
    });

  } catch (error) {
    logger.error('Get pending files failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/approve-file
 * Approve and write a file proposal
 */
router.post('/wizard/:id/approve-file', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { proposalId } = req.body;

    if (!proposalId) {
      return res.status(400).json({
        success: false,
        error: 'proposalId is required'
      });
    }

    const result = await wizardOrchestrator.approveFileGeneration(deploymentId, proposalId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Approve file failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/reject-file
 * Reject a file proposal
 */
router.post('/wizard/:id/reject-file', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { proposalId } = req.body;

    if (!proposalId) {
      return res.status(400).json({
        success: false,
        error: 'proposalId is required'
      });
    }

    const result = await wizardOrchestrator.rejectFileGeneration(deploymentId, proposalId);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Reject file failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/user-input
 * Submit user input for a pending input request
 */
router.post('/wizard/:id/user-input', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { inputRequestId, responses } = req.body;

    if (!inputRequestId || !responses) {
      return res.status(400).json({
        success: false,
        error: 'inputRequestId and responses are required'
      });
    }

    const result = await wizardOrchestrator.submitUserInput(deploymentId, inputRequestId, responses);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Submit user input failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/chat
 * Send a chat message to Claude during wizard stages
 */
router.post('/wizard/:id/chat', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const { message, currentStage } = req.body;
    const userId = req.user._id;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    const claudeService = require('../services/claude');
    const wizardOrchestrator = require('../services/wizardOrchestrator');
    
    // Get session context for better responses
    const session = await wizardOrchestrator.getSession(deploymentId);
    const stageContext = currentStage || session?.currentStage || 'UNKNOWN';
    
    // Build context-aware prompt
    const contextualPrompt = `You are helping with a deployment wizard. Current stage: ${stageContext}.

User question: ${message}

Please provide a helpful response. If the user is asking about the current stage or deployment process, provide relevant guidance. If they want to modify instructions or commands, you can suggest changes.`;

    // Get Claude's response
    const response = await claudeService.chat(deploymentId, contextualPrompt, {
      userId: userId.toString(),
      includeContext: true
    });

    // Extract response text (chat method returns { message, detectedCommands, tokensUsed })
    const responseText = response.message || 'I received your message.';
    const detectedCommands = response.detectedCommands || [];
    
    // Parse files from markdown code blocks
    const filesFromMarkdown = await wizardOrchestrator.parseFilesFromMarkdown(responseText);
    
    // Create file proposals from detected files
    if (filesFromMarkdown.length > 0) {
      const WizardSession = require('../models/WizardSession');
      const session = await WizardSession.findOne({ deploymentId });
      
      if (session) {
        // Ensure workspace path is set
        const cursorIntegration = require('../services/cursorIntegration');
        let workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
        
        if (!workspacePath && session.projectContext?.projectPath) {
          workspacePath = session.projectContext.projectPath;
          cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
        }
        
        // Create file proposals
        const fileProposals = filesFromMarkdown.map(file => ({
          id: `${deploymentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          filePath: file.filePath,
          content: file.content,
          preview: file.content.substring(0, 500),
          type: file.type,
          size: file.content.length,
          requiresApproval: true,
          status: 'pending',
          createdAt: new Date(),
          detectedFrom: file.detectedFrom
        }));
        
        // Store in session
        if (!session.currentStageData) {
          session.currentStageData = {};
        }
        if (!session.currentStageData.pendingFileProposals) {
          session.currentStageData.pendingFileProposals = [];
        }
        session.currentStageData.pendingFileProposals.push(...fileProposals);
        await session.save();
        
        logger.info(`Created ${fileProposals.length} file proposal(s) from chat response`, {
          deploymentId,
          files: fileProposals.map(f => f.filePath)
        });
      }
    }

    res.json({
      success: true,
      data: {
        message: responseText,
        instructions: responseText, // For backward compatibility
        commands: detectedCommands, // Include any detected commands
        filesDetected: filesFromMarkdown.length // Indicate files were found
      }
    });

  } catch (error) {
    logger.error('Chat with AI failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/recommendations
 * Get infrastructure recommendations
 */
router.get('/wizard/:id/recommendations', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    
    const recommendations = await wizardOrchestrator.generateInfrastructureRecommendations(deploymentId);

    res.json({
      success: true,
      data: recommendations
    });

  } catch (error) {
    logger.error('Get recommendations failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/:id/command-queue
 * Get the full command queue status
 */
router.get('/wizard/:id/command-queue', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    
    const queueStatus = await wizardOrchestrator.getCommandQueueStatus(deploymentId);

    res.json({
      success: true,
      data: queueStatus
    });

  } catch (error) {
    logger.error('Get command queue failed:', error);
    next(error);
  }
});

/**
 * GET /api/v1/project/wizard/sessions
 * List all wizard sessions for the current user
 */
router.get('/wizard/sessions', async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { status, limit = 50, offset = 0 } = req.query;
    
    const WizardSession = require('../models/WizardSession');
    
    // Build query
    const query = { userId };
    if (status) {
      query.status = status;
    }
    
    // Get sessions with pagination
    const sessions = await WizardSession.find(query)
      .sort({ lastUpdatedAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .select('deploymentId currentStage status progress projectContext.projectPath projectContext.projectType startedAt lastUpdatedAt completedAt metadata')
      .lean();
    
    // Get total count
    const total = await WizardSession.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        sessions,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    logger.error('List wizard sessions failed:', error);
    next(error);
  }
});

/**
 * POST /api/v1/project/wizard/:id/resume
 * Resume a previous wizard session
 */
router.post('/wizard/:id/resume-session', async (req, res, next) => {
  try {
    const { id: deploymentId } = req.params;
    const userId = req.user._id;
    
    const WizardSession = require('../models/WizardSession');
    
    // Find the session
    const session = await WizardSession.findOne({ deploymentId, userId });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Wizard session not found'
      });
    }
    
    // Check if already active
    if (session.status === 'active') {
      return res.json({
        success: true,
        message: 'Session is already active',
        data: session.getSummary()
      });
    }
    
    // Resume the session
    session.status = 'active';
    session.metadata.resumeCount = (session.metadata.resumeCount || 0) + 1;
    await session.save();
    
    logger.info(`Resumed wizard session for deployment ${deploymentId}`);
    
    res.json({
      success: true,
      message: 'Wizard session resumed successfully',
      data: session.getSummary()
    });

  } catch (error) {
    logger.error('Resume wizard session failed:', error);
    next(error);
  }
});

module.exports = router;

