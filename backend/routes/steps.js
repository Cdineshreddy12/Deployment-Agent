const express = require('express');
const stepCompletionGate = require('../services/stepCompletionGate');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Get step completion status
 * GET /api/v1/steps/status/:deploymentId
 */
router.get('/status/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { step } = req.query;

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

    let status;
    if (step) {
      status = await stepCompletionGate.checkStepCompletion(deploymentId, step);
    } else {
      status = await stepCompletionGate.getStepStatus(deploymentId);
    }

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Failed to get step status:', error);
    next(error);
  }
});

/**
 * Get step checklist
 * GET /api/v1/steps/checklist/:deploymentId
 */
router.get('/checklist/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { step } = req.query;

    if (!step) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'step query parameter is required'
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

    const checklist = await stepCompletionGate.getStepChecklist(deploymentId, step);

    res.json({
      success: true,
      data: checklist
    });
  } catch (error) {
    logger.error('Failed to get step checklist:', error);
    next(error);
  }
});

/**
 * Mark step as complete
 * POST /api/v1/steps/complete/:deploymentId
 */
router.post('/complete/:deploymentId', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { step, metadata = {} } = req.body;

    if (!step) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'step is required'
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

    const result = await stepCompletionGate.markStepComplete(deploymentId, step, metadata);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to mark step complete:', error);
    next(error);
  }
});

/**
 * Check if can proceed to next step
 * GET /api/v1/steps/can-proceed/:deploymentId
 */
router.get('/can-proceed/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { nextStep } = req.query;

    if (!nextStep) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'nextStep query parameter is required'
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

    const canProceed = await stepCompletionGate.canProceedToNextStep(deploymentId, nextStep);

    res.json({
      success: true,
      data: canProceed
    });
  } catch (error) {
    logger.error('Failed to check if can proceed:', error);
    next(error);
  }
});

module.exports = router;

