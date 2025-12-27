const express = require('express');
const sandboxService = require('../services/sandbox');
const sandboxOrchestrator = require('../services/sandboxOrchestrator');
const createSandboxQueue = require('../queues/sandboxQueue');
const Deployment = require('../models/Deployment');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Deploy to sandbox and test (complete workflow)
router.post('/deploy-and-test', requirePermission('sandbox.create'), async (req, res, next) => {
  try {
    const { deploymentId, durationHours } = req.body;

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

    // Check if deployment has Terraform code
    if (!deployment.terraformCode || !deployment.terraformCode.main) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Deployment does not have Terraform code. Please generate Terraform code first.'
        }
      });
    }

    // Use queue for async processing
    const queue = await createSandboxQueue();
    const job = await queue.add('sandbox_deploy_and_test', {
      operation: 'deploy_and_test',
      deploymentId,
      options: { durationHours: durationHours || 4 }
    });

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: 'queued',
        message: 'Sandbox deployment and testing queued. This may take several minutes.'
      }
    });
  } catch (error) {
    logger.error('Deploy and test error:', error);
    next(error);
  }
});

// Create sandbox
router.post('/create', requirePermission('sandbox.create'), validate(schemas.createSandbox), async (req, res, next) => {
  try {
    const { deploymentId, durationHours } = req.body;

    const queue = await createSandboxQueue();
    const job = await queue.add('sandbox_create', {
      operation: 'create',
      deploymentId,
      options: { durationHours }
    });

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: 'queued'
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get sandbox
router.get('/:id', async (req, res, next) => {
  try {
    const sandbox = await sandboxService.getSandbox(req.params.id);

    res.json({
      success: true,
      data: { sandbox }
    });
  } catch (error) {
    next(error);
  }
});

// Delete sandbox
router.delete('/:id', requirePermission('sandbox.create'), async (req, res, next) => {
  try {
    await sandboxService.destroy(req.params.id);

    res.json({
      success: true,
      message: 'Sandbox destroyed'
    });
  } catch (error) {
    next(error);
  }
});

// Run tests
router.post('/:id/test', requirePermission('sandbox.create'), async (req, res, next) => {
  try {
    const queue = await createSandboxQueue();
    const job = await queue.add('sandbox_test', {
      operation: 'test',
      sandboxId: req.params.id
    });

    res.json({
      success: true,
      data: {
        jobId: job.id,
        status: 'queued'
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get test results
router.get('/:id/results', async (req, res, next) => {
  try {
    const sandbox = await sandboxService.getSandbox(req.params.id);

    res.json({
      success: true,
      data: {
        testResults: sandbox.testResults,
        testStatus: sandbox.testStatus
      }
    });
  } catch (error) {
    next(error);
  }
});

// Extend sandbox
router.post('/:id/extend', requirePermission('sandbox.create'), async (req, res, next) => {
  try {
    const { additionalHours } = req.body;

    const result = await sandboxService.extend(req.params.id, additionalHours);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

