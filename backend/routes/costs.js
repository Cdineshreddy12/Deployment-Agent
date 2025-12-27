const express = require('express');
const costService = require('../services/cost');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Estimate cost
router.post('/estimate', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const { terraformPlan, deploymentId } = req.body;

    const estimate = await costService.estimateCost(deploymentId, terraformPlan);

    res.json({
      success: true,
      data: estimate
    });
  } catch (error) {
    next(error);
  }
});

// Get actual costs
router.get('/:deploymentId/actual', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { from, to } = req.query;

    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = to ? new Date(to) : new Date();

    const costs = await costService.trackCosts(deploymentId, startDate, endDate);

    res.json({
      success: true,
      data: costs
    });
  } catch (error) {
    next(error);
  }
});

// Get cost breakdown
router.get('/:deploymentId/breakdown', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    const { from, to } = req.query;

    const startDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = to ? new Date(to) : new Date();

    const breakdown = await costService.getCostBreakdown(deploymentId, startDate, endDate);

    res.json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    next(error);
  }
});

// Get optimization recommendations
router.get('/:deploymentId/recommendations', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const recommendations = await costService.getOptimizationRecommendations(req.params.deploymentId);

    res.json({
      success: true,
      data: { recommendations }
    });
  } catch (error) {
    next(error);
  }
});

// Set budget
router.post('/:deploymentId/budget', requirePermission('costs.manage'), validate(schemas.costBudget), async (req, res, next) => {
  try {
    const { monthlyBudget, alertThreshold } = req.body;

    await costService.setBudget(req.params.deploymentId, monthlyBudget, alertThreshold);

    res.json({
      success: true,
      message: 'Budget set successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Get cost forecast
router.get('/:deploymentId/forecast', requirePermission('costs.read'), async (req, res, next) => {
  try {
    const forecast = await costService.getCostForecast(req.params.deploymentId);

    res.json({
      success: true,
      data: forecast
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

