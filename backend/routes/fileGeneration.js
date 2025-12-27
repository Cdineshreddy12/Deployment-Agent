const express = require('express');
const multer = require('multer');
const fileGenerationOrchestrator = require('../services/fileGenerationOrchestrator');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads (accept all file types)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024, // 10MB max per file
    files: 20 // Max 20 files
  }
  // No fileFilter - accept all file types (including README files)
});

// Apply authentication to all routes
router.use(authenticate);

/**
 * POST /api/v1/file-generation/initiate
 * Start a file generation task
 */
router.post('/initiate', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, stageId, taskType = 'docker' } = req.body;
    const userId = req.user._id;

    if (!deploymentId || !stageId) {
      return res.status(400).json({
        success: false,
        error: 'deploymentId and stageId are required'
      });
    }

    const task = await fileGenerationOrchestrator.initiateFileGeneration(
      deploymentId,
      stageId,
      taskType,
      userId
    );

    res.json({
      success: true,
      data: {
        taskId: task.taskId,
        deploymentId: task.deploymentId,
        stageId: task.stageId,
        taskType: task.taskType,
        status: task.status
      }
    });
  } catch (error) {
    logger.error('Failed to initiate file generation:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/pre-check
 * Pre-check files before README generation (can be called anytime to refresh file status)
 */
router.post('/:taskId/pre-check', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const FileGenerationTask = require('../models/FileGenerationTask');
    
    const task = await FileGenerationTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const result = await fileGenerationOrchestrator.preCheckFiles(taskId);

    // Reload task to get updated status
    const updatedTask = await FileGenerationTask.findOne({ taskId });

    res.json({
      success: true,
      data: {
        taskId,
        fileStatus: result.fileStatus,
        status: updatedTask.status,
        metadata: {
          fileStatus: updatedTask.metadata?.fileStatus || null
        }
      }
    });
  } catch (error) {
    logger.error('Failed to pre-check files:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/readme
 * Generate README for file generation
 */
router.post('/:taskId/readme', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const FileGenerationTask = require('../models/FileGenerationTask');
    
    const task = await FileGenerationTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const result = await fileGenerationOrchestrator.generateReadme(
      task.deploymentId,
      taskId
    );

    res.json({
      success: true,
      data: {
        taskId,
        readme: result.readme,
        status: result.task.status,
        fileStatus: result.task.metadata.fileStatus
      }
    });
  } catch (error) {
    logger.error('Failed to generate README:', error);
    next(error);
  }
});

/**
 * GET /api/v1/file-generation/:taskId/readme
 * Get README content
 */
router.get('/:taskId/readme', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const FileGenerationTask = require('../models/FileGenerationTask');
    
    const task = await FileGenerationTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    if (!task.readme.content) {
      return res.status(404).json({
        success: false,
        error: 'README not generated yet'
      });
    }

    res.json({
      success: true,
      data: {
        taskId,
        readme: task.readme.content,
        generatedAt: task.readme.generatedAt,
        approved: !!task.readme.approvedAt
      }
    });
  } catch (error) {
    logger.error('Failed to get README:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/approve-readme
 * Approve README
 */
router.post('/:taskId/approve-readme', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user._id;

    const result = await fileGenerationOrchestrator.approveReadme(taskId, userId);

    res.json({
      success: true,
      data: {
        taskId,
        status: result.task.status,
        message: 'README approved successfully'
      }
    });
  } catch (error) {
    logger.error('Failed to approve README:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/reject-readme
 * Reject README
 */
router.post('/:taskId/reject-readme', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const result = await fileGenerationOrchestrator.rejectReadme(taskId, userId, reason);

    res.json({
      success: true,
      data: {
        taskId,
        status: result.task.status,
        message: 'README rejected. You can regenerate it.'
      }
    });
  } catch (error) {
    logger.error('Failed to reject README:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/upload
 * Upload generated files
 */
router.post('/:taskId/upload', 
  requirePermission('deployments.create'),
  upload.array('files', 20),
  async (req, res, next) => {
    try {
      const { taskId } = req.params;
      const userId = req.user._id;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No files uploaded'
        });
      }

      // Convert uploaded files to format expected by orchestrator
      const files = req.files.map(file => ({
        path: file.originalname,
        content: file.buffer.toString('utf8'),
        size: file.size
      }));

      const result = await fileGenerationOrchestrator.uploadFiles(taskId, files, userId);

      res.json({
        success: true,
        data: {
          taskId,
          status: result.task.status,
          filesUploaded: files.length,
          files: files.map(f => ({
            path: f.path,
            size: f.size
          }))
        }
      });
  } catch (error) {
    logger.error('Failed to upload files:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/verify-from-readme
 * Verify files using README-based auto-detection (new method)
 */
router.post('/:taskId/verify-from-readme', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const result = await fileGenerationOrchestrator.verifyFilesFromReadme(taskId);

    res.json({
      success: true,
      data: {
        taskId,
        status: result.task.status,
        verification: result.verification,
        detectedFiles: result.task.metadata.detectedFiles
      }
    });
  } catch (error) {
    logger.error('Failed to verify files from README:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/verify
 * Verify files (uses README-based verification by default, falls back to uploaded files if available)
 */
router.post('/:taskId/verify', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const FileGenerationTask = require('../models/FileGenerationTask');
    
    const task = await FileGenerationTask.findOne({ taskId });
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    // Use README-based verification by default
    let result;
    if (task.readme.content && (!task.uploadedFiles || task.uploadedFiles.length === 0)) {
      // Use README-based verification
      result = await fileGenerationOrchestrator.verifyFilesFromReadme(taskId);
    } else if (task.uploadedFiles && task.uploadedFiles.length > 0) {
      // Use legacy verification with uploaded files
      result = await fileGenerationOrchestrator.verifyFiles(taskId);
    } else {
      return res.status(400).json({
        success: false,
        error: 'No README or uploaded files found. Please generate README first.'
      });
    }

    res.json({
      success: true,
      data: {
        taskId,
        status: result.task.status,
        verification: result.verification,
        detectedFiles: result.task.metadata.detectedFiles
      }
    });
  } catch (error) {
    logger.error('Failed to verify files:', error);
    next(error);
  }
});

/**
 * POST /api/v1/file-generation/:taskId/approve-verification
 * Approve verification results
 */
router.post('/:taskId/approve-verification', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { taskId } = req.params;
    const userId = req.user._id;

    const result = await fileGenerationOrchestrator.approveVerification(taskId, userId);

    // Proceed to next step
    await fileGenerationOrchestrator.proceedToNextStep(result.task.deploymentId, taskId);

    res.json({
      success: true,
      data: {
        taskId,
        status: result.task.status,
        message: 'Verification approved. Proceeding to next stage.'
      }
    });
  } catch (error) {
    logger.error('Failed to approve verification:', error);
    next(error);
  }
});

/**
 * GET /api/v1/file-generation/:taskId/status
 * Get task status
 */
router.get('/:taskId/status', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { taskId } = req.params;

    const status = await fileGenerationOrchestrator.getTaskStatus(taskId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Failed to get task status:', error);
    next(error);
  }
});

/**
 * GET /api/v1/file-generation/deployment/:deploymentId/check-files
 * Check for existing files without creating a task
 */
router.get('/deployment/:deploymentId/check-files', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const filePreCheckService = require('../services/filePreCheckService');
    
    const fileStatus = await filePreCheckService.checkExistingFiles(deploymentId);
    
    res.json({
      success: true,
      data: { fileStatus }
    });
  } catch (error) {
    logger.error('Failed to check files:', error);
    next(error);
  }
});

/**
 * GET /api/v1/file-generation/deployment/:deploymentId
 * Get task by deployment ID
 */
router.get('/deployment/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { stageId } = req.query;

    const task = await fileGenerationOrchestrator.getTaskByDeployment(deploymentId, stageId);

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found'
      });
    }

    const status = await fileGenerationOrchestrator.getTaskStatus(task.taskId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Failed to get task by deployment:', error);
    next(error);
  }
});

module.exports = router;

