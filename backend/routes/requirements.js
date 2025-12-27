const express = require('express');
const requirementParser = require('../services/requirementParser');
const cursorIntegration = require('../services/cursorIntegration');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Analyze deployment requirements
 * POST /api/v1/requirements/analyze
 */
router.post('/analyze', requirePermission('deployments.read'), async (req, res, next) => {
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

    // Analyze deployment
    const analysis = await requirementParser.analyzeDeployment(deploymentId);

    // Generate questions
    const questions = requirementParser.generateQuestions(analysis);

    res.json({
      success: true,
      data: {
        analysis,
        questions
      }
    });
  } catch (error) {
    logger.error('Failed to analyze requirements:', error);
    next(error);
  }
});

/**
 * Parse README file
 * POST /api/v1/requirements/parse-readme
 */
router.post('/parse-readme', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, readmeContent } = req.body;

    if (!deploymentId && !readmeContent) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either deploymentId or readmeContent is required'
        }
      });
    }

    let content = readmeContent;

    // If deploymentId provided, read README from workspace
    if (deploymentId && !readmeContent) {
      const readmeFile = await cursorIntegration.readFile(deploymentId, 'README.md');
      if (!readmeFile || !readmeFile.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'README.md not found'
          }
        });
      }
      content = readmeFile.content;
    }

    const parsed = requirementParser.parseREADME(content);

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    logger.error('Failed to parse README:', error);
    next(error);
  }
});

/**
 * Parse package.json
 * POST /api/v1/requirements/parse-package
 */
router.post('/parse-package', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId, packageJsonContent } = req.body;

    if (!deploymentId && !packageJsonContent) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Either deploymentId or packageJsonContent is required'
        }
      });
    }

    let content = packageJsonContent;

    // If deploymentId provided, read package.json from workspace
    if (deploymentId && !packageJsonContent) {
      const packageFile = await cursorIntegration.readFile(deploymentId, 'package.json');
      if (!packageFile || !packageFile.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'package.json not found'
          }
        });
      }
      content = packageFile.content;
    }

    const parsed = requirementParser.parsePackageJson(content);

    res.json({
      success: true,
      data: parsed
    });
  } catch (error) {
    logger.error('Failed to parse package.json:', error);
    next(error);
  }
});

module.exports = router;





