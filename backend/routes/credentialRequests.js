const express = require('express');
const credentialApprovalService = require('../services/credentialApprovalService');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Request credentials
 * POST /api/v1/credentials/request
 */
router.post('/request', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, serviceType, schema } = req.body;
    const userId = req.user._id;

    if (!deploymentId || !serviceType || !schema) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId, serviceType, and schema are required'
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

    const request = await credentialApprovalService.requestCredentials(
      deploymentId,
      serviceType,
      schema,
      userId
    );

    res.json({
      success: true,
      data: request
    });
  } catch (error) {
    logger.error('Failed to request credentials:', error);
    next(error);
  }
});

/**
 * Approve credentials
 * POST /api/v1/credentials/approve/:requestId
 */
router.post('/approve/:requestId', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { credentials } = req.body;
    const userId = req.user._id;

    if (!credentials) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'credentials are required'
        }
      });
    }

    const result = await credentialApprovalService.approveCredentials(requestId, credentials, userId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to approve credentials:', error);
    next(error);
  }
});

/**
 * Reject credential request
 * POST /api/v1/credentials/reject/:requestId
 */
router.post('/reject/:requestId', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;
    const userId = req.user._id;

    const result = await credentialApprovalService.rejectCredentials(requestId, reason || 'Rejected by user', userId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to reject credentials:', error);
    next(error);
  }
});

/**
 * Get pending credential requests
 * GET /api/v1/credentials/pending/:deploymentId
 */
router.get('/pending/:deploymentId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;

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

    const requests = await credentialApprovalService.getPendingCredentialRequests(deploymentId);

    res.json({
      success: true,
      data: {
        requests,
        count: requests.length
      }
    });
  } catch (error) {
    logger.error('Failed to get pending requests:', error);
    next(error);
  }
});

module.exports = router;

