const express = require('express');
const fileCheckService = require('../services/fileCheckService');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Check file existence
 * GET /api/v1/files/check/:deploymentId
 */
router.get('/check/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'filePath query parameter is required'
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

    const fileInfo = await fileCheckService.checkFileExists(deploymentId, filePath);

    res.json({
      success: true,
      data: fileInfo
    });
  } catch (error) {
    logger.error('Failed to check file existence:', error);
    next(error);
  }
});

/**
 * Batch check multiple files
 * POST /api/v1/files/batch-check/:deploymentId
 */
router.post('/batch-check/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { filePaths } = req.body;

    if (!filePaths || !Array.isArray(filePaths)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'filePaths array is required'
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

    const results = await fileCheckService.batchCheckFiles(deploymentId, filePaths);

    res.json({
      success: true,
      data: {
        results,
        checked: filePaths.length
      }
    });
  } catch (error) {
    logger.error('Failed to batch check files:', error);
    next(error);
  }
});

/**
 * Get file info
 * GET /api/v1/files/info/:deploymentId
 */
router.get('/info/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { filePath } = req.query;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'filePath query parameter is required'
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

    const fileInfo = await fileCheckService.getFileInfo(deploymentId, filePath);

    res.json({
      success: true,
      data: fileInfo
    });
  } catch (error) {
    logger.error('Failed to get file info:', error);
    next(error);
  }
});

/**
 * Verify file content
 * POST /api/v1/files/verify/:deploymentId
 */
router.post('/verify/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'filePath is required'
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

    const iterativeFileGenerator = require('../services/iterativeFileGenerator');
    const verification = await iterativeFileGenerator.verifyFileContent(deploymentId, filePath);

    res.json({
      success: true,
      data: verification
    });
  } catch (error) {
    logger.error('Failed to verify file content:', error);
    next(error);
  }
});

module.exports = router;

