const express = require('express');
const terraformService = require('../services/terraform');
const costService = require('../services/cost');
const createTerraformQueue = require('../queues/terraformQueue');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Generate Terraform code
router.post('/generate', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { requirements, deploymentId } = req.body;

    const result = await terraformService.generateCode(requirements, deploymentId);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

// Validate Terraform code
router.post('/validate', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    const validation = await terraformService.validate(deploymentId);

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    next(error);
  }
});

// Get Terraform code
router.get('/code/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;

    const Deployment = require('../models/Deployment');
    const deployment = await Deployment.findOne({ deploymentId });

    if (!deployment || !deployment.terraformCode) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Terraform code not found'
        }
      });
    }

    res.json({
      success: true,
      data: {
        code: deployment.terraformCode
      }
    });
  } catch (error) {
    next(error);
  }
});

// Estimate cost
router.post('/estimate-cost', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.body;

    const Deployment = require('../models/Deployment');
    const deployment = await Deployment.findOne({ deploymentId });

    if (!deployment || !deployment.terraformPlan) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Terraform plan not found. Run terraform plan first.'
        }
      });
    }

    const estimate = await costService.estimateCost(deploymentId, deployment.terraformPlan);

    res.json({
      success: true,
      data: estimate
    });
  } catch (error) {
    next(error);
  }
});

// Run Terraform plan
router.post('/plan', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, varFile } = req.body;

    const queue = await createTerraformQueue();
    const job = await queue.add('terraform_plan', {
      operation: 'plan',
      deploymentId,
      options: { varFile }
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

// Apply Terraform
router.post('/apply', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, autoApprove = false } = req.body;

    const queue = await createTerraformQueue();
    const job = await queue.add('terraform_apply', {
      operation: 'apply',
      deploymentId,
      options: { autoApprove }
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

module.exports = router;

