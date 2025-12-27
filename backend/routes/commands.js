const express = require('express');
const commandHistoryService = require('../services/commandHistoryService');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Get command history for deployment
 * GET /api/v1/commands/history/:deploymentId
 */
router.get('/history/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { step, limit = 50 } = req.query;

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

    let commands;
    if (step) {
      commands = await commandHistoryService.getCommandHistory(deploymentId, step);
    } else {
      commands = await commandHistoryService.getRecentCommands(deploymentId, parseInt(limit));
    }

    res.json({
      success: true,
      data: {
        commands,
        count: commands.length
      }
    });
  } catch (error) {
    logger.error('Failed to get command history:', error);
    next(error);
  }
});

/**
 * Get command summary for LLM context
 * GET /api/v1/commands/summary/:deploymentId
 */
router.get('/summary/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { maxCommands = 10 } = req.query;

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

    const summary = await commandHistoryService.buildCommandSummary(
      deploymentId,
      parseInt(maxCommands)
    );

    res.json({
      success: true,
      data: {
        summary
      }
    });
  } catch (error) {
    logger.error('Failed to get command summary:', error);
    next(error);
  }
});

module.exports = router;
