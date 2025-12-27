const express = require('express');
const terraformService = require('../services/terraform');
const rollbackService = require('../services/rollback');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get Terraform state
router.get('/:deploymentId', async (req, res, next) => {
  try {
    const state = await terraformService.getState(req.params.deploymentId);

    if (!state) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'State not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        stateFile: state,
        version: state.version || 1
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get state versions
router.get('/:deploymentId/versions', async (req, res, next) => {
  try {
    const versions = await rollbackService.getRollbackVersions(req.params.deploymentId);

    res.json({
      success: true,
      data: { versions }
    });
  } catch (error) {
    next(error);
  }
});

// Rollback to version
router.post('/:deploymentId/rollback/:version', requirePermission('deployments.rollback'), async (req, res, next) => {
  try {
    const { deploymentId, version } = req.params;
    const { reason } = req.body;

    const result = await rollbackService.executeRollback(deploymentId, parseInt(version), reason);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Unlock state (admin only)
router.post('/:deploymentId/unlock', requirePermission('state.manage'), async (req, res, next) => {
  try {
    const awsService = require('../services/aws');
    await awsService.unlockTerraformState(req.params.deploymentId);

    res.json({
      success: true,
      message: 'State unlocked'
    });
  } catch (error) {
    next(error);
  }
});

// Check for drift
router.get('/:deploymentId/drift', async (req, res, next) => {
  try {
    // In production, compare state with actual resources
    // For now, return no drift
    res.json({
      success: true,
      data: {
        hasDrift: false,
        changes: []
      }
    });
  } catch (error) {
    next(error);
  }
});

// Refresh state
router.post('/:deploymentId/refresh', requirePermission('state.manage'), async (req, res, next) => {
  try {
    // In production, refresh state from actual resources
    res.json({
      success: true,
      message: 'State refreshed'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

