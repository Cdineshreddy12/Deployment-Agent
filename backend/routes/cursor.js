const express = require('express');
const cursorIntegration = require('../services/cursorIntegration');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Set workspace path for deployment
 * POST /api/v1/cursor/workspace
 */
router.post('/workspace', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, workspacePath } = req.body;

    if (!deploymentId || !workspacePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and workspacePath are required'
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

    // Set workspace path (persists to database)
    await cursorIntegration.setWorkspacePath(deploymentId, workspacePath);

    res.json({
      success: true,
      data: {
        deploymentId,
        workspacePath,
        message: 'Workspace path set successfully'
      }
    });
  } catch (error) {
    logger.error('Failed to set workspace path:', error);
    next(error);
  }
});

/**
 * Read file from workspace
 * POST /api/v1/cursor/read-file
 */
router.post('/read-file', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, filePath, projectPath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'filePath is required'
        }
      });
    }

    // Check if workspace path is set, or use provided projectPath as fallback
    let workspacePath = null;
    
    if (deploymentId) {
      workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
    }
    
    // If no workspace path from deploymentId, use projectPath directly
    if (!workspacePath && projectPath) {
      workspacePath = projectPath;
      // Also set it for future requests if we have a deploymentId
      if (deploymentId) {
        await cursorIntegration.setWorkspacePath(deploymentId, projectPath);
      }
    }
    
    if (!workspacePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'WORKSPACE_NOT_SET',
          message: 'Either deploymentId with workspace path or projectPath is required'
        }
      });
    }

    // Read file directly using the workspace path
    const fs = require('fs-extra');
    const path = require('path');
    
    const fullPath = path.resolve(workspacePath, filePath);
    
    // Security check: ensure path is within workspace
    const resolvedWorkspace = path.resolve(workspacePath);
    if (!fullPath.startsWith(resolvedWorkspace)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PATH_TRAVERSAL',
          message: 'Path traversal detected'
        }
      });
    }

    if (!(await fs.pathExists(fullPath))) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: `File not found: ${filePath}`
        }
      });
    }

    const content = await fs.readFile(fullPath, 'utf-8');
    const stats = await fs.stat(fullPath);

    res.json({
      success: true,
      data: {
        content,
        path: filePath,
        fullPath,
        size: stats.size,
        modified: stats.mtime,
        exists: true
      }
    });
  } catch (error) {
    logger.error('Failed to read file:', error);
    next(error);
  }
});

/**
 * List directory contents
 * POST /api/v1/cursor/list-directory
 */
router.post('/list-directory', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, dirPath = '.' } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId is required'
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

    const entries = await cursorIntegration.listDirectory(deploymentId, dirPath);

    res.json({
      success: true,
      data: {
        path: dirPath,
        entries
      }
    });
  } catch (error) {
    logger.error('Failed to list directory:', error);
    next(error);
  }
});

/**
 * Get project structure
 * POST /api/v1/cursor/get-structure
 */
router.post('/get-structure', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, rootPath = '.', maxDepth = 3 } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId is required'
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

    const structure = await cursorIntegration.getStructure(deploymentId, rootPath, maxDepth);

    res.json({
      success: true,
      data: {
        structure,
        rootPath
      }
    });
  } catch (error) {
    logger.error('Failed to get structure:', error);
    next(error);
  }
});

/**
 * Detect project type
 * POST /api/v1/cursor/detect-project-type
 */
router.post('/detect-project-type', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId is required'
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

    const projectType = await cursorIntegration.detectProjectType(deploymentId);

    res.json({
      success: true,
      data: projectType
    });
  } catch (error) {
    logger.error('Failed to detect project type:', error);
    next(error);
  }
});

/**
 * Read config files
 * POST /api/v1/cursor/config-files
 */
router.post('/config-files', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    if (!deploymentId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId is required'
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

    const configFiles = await cursorIntegration.readConfigFiles(deploymentId);

    res.json({
      success: true,
      data: configFiles
    });
  } catch (error) {
    logger.error('Failed to read config files:', error);
    next(error);
  }
});

/**
 * Write file to workspace
 * POST /api/v1/cursor/write-file
 */
router.post('/write-file', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, filePath, content, force = false } = req.body;

    if (!deploymentId || !filePath || content === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId, filePath, and content are required'
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

    // Check if file exists before writing
    const fileCheckService = require('../services/fileCheckService');
    const overwriteCheck = await fileCheckService.shouldOverwrite(deploymentId, filePath, { force });

    if (overwriteCheck.requiresConfirmation && !force) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'FILE_EXISTS',
          message: 'File already exists',
          fileInfo: overwriteCheck.fileInfo,
          requiresConfirmation: true
        }
      });
    }

    const result = await cursorIntegration.writeFile(deploymentId, filePath, content);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to write file:', error);
    next(error);
  }
});

/**
 * Check if file exists
 * POST /api/v1/cursor/file-exists
 */
router.post('/file-exists', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, filePath } = req.body;

    if (!deploymentId || !filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and filePath are required'
        }
      });
    }

    const exists = await cursorIntegration.fileExists(deploymentId, filePath);

    res.json({
      success: true,
      data: {
        filePath,
        exists
      }
    });
  } catch (error) {
    logger.error('Failed to check file existence:', error);
    next(error);
  }
});

module.exports = router;




