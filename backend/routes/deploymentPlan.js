const express = require('express');
const router = express.Router();
const deploymentPlanner = require('../services/deploymentPlanner');
const deploymentExecutor = require('../services/deploymentExecutor');
const architectureAnalyzer = require('../services/architectureAnalyzer');
const logger = require('../utils/logger');

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/generate
 * @desc Generate a deployment plan for a project
 */
router.post('/:deploymentId/generate', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const { analysis } = req.body; // Optional pre-computed analysis
    
    logger.info(`Generating deployment plan for ${deploymentId}`);
    
    const plan = await deploymentPlanner.generatePlan(deploymentId, { analysis });
    
    res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    logger.error('Failed to generate deployment plan:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/deployment-plan/:deploymentId
 * @desc Get existing deployment plan for a project
 */
router.get('/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    // Generate fresh plan (in production, might cache this)
    const analysis = await architectureAnalyzer.analyzeProject(deploymentId);
    const plan = await deploymentPlanner.generatePlan(deploymentId, { analysis });
    
    res.json({
      success: true,
      data: plan
    });
  } catch (error) {
    logger.error('Failed to get deployment plan:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/execute
 * @desc Execute a deployment plan
 */
router.post('/:deploymentId/execute', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const { autoApprove, rollbackOnFailure } = req.body;
    
    logger.info(`Executing deployment plan for ${deploymentId}`);
    
    // Generate plan first
    const plan = await deploymentPlanner.generatePlan(deploymentId);
    
    // Execute the plan
    const execution = await deploymentExecutor.executePlan(deploymentId, plan, {
      autoApprove: autoApprove || false,
      rollbackOnFailure: rollbackOnFailure || true
    });
    
    res.json({
      success: true,
      data: execution
    });
  } catch (error) {
    logger.error('Failed to execute deployment plan:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/execute-step
 * @desc Execute a single step from the plan
 */
router.post('/:deploymentId/execute-step', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const { stepId } = req.body;
    
    if (!stepId) {
      return res.status(400).json({
        success: false,
        error: 'stepId is required'
      });
    }
    
    logger.info(`Executing step ${stepId} for deployment ${deploymentId}`);
    
    // Generate plan to get the step
    const plan = await deploymentPlanner.generatePlan(deploymentId);
    const step = plan.steps.find(s => s.id === stepId);
    
    if (!step) {
      return res.status(404).json({
        success: false,
        error: `Step ${stepId} not found in plan`
      });
    }
    
    // Execute single step
    const result = await deploymentExecutor.executeStep(deploymentId, step);
    
    res.json({
      success: true,
      data: {
        step,
        result
      }
    });
  } catch (error) {
    logger.error('Failed to execute deployment step:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/deployment-plan/:deploymentId/status
 * @desc Get execution status
 */
router.get('/:deploymentId/status', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    const status = deploymentExecutor.getExecutionStatus(deploymentId);
    
    res.json({
      success: true,
      data: status || { status: 'not_started' }
    });
  } catch (error) {
    logger.error('Failed to get execution status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/cancel
 * @desc Cancel an active execution
 */
router.post('/:deploymentId/cancel', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    const cancelled = await deploymentExecutor.cancelExecution(deploymentId);
    
    res.json({
      success: cancelled,
      message: cancelled ? 'Execution cancelled' : 'No active execution found'
    });
  } catch (error) {
    logger.error('Failed to cancel execution:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/approve
 * @desc Approve a pending step that requires approval
 */
router.post('/:deploymentId/approve', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const { stepId } = req.body;
    
    logger.info(`Approving step ${stepId} for deployment ${deploymentId}`);
    
    // In a real implementation, this would signal to the executor
    // For now, we'll just acknowledge
    res.json({
      success: true,
      message: `Step ${stepId} approved`
    });
  } catch (error) {
    logger.error('Failed to approve step:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/deployment-plan/:deploymentId/rollback
 * @desc Rollback a deployment
 */
router.post('/:deploymentId/rollback', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    const { fromStepId } = req.body;
    
    logger.info(`Rolling back deployment ${deploymentId} from step ${fromStepId}`);
    
    // Generate plan
    const plan = await deploymentPlanner.generatePlan(deploymentId);
    
    // Execute rollback
    const result = await deploymentExecutor.rollback(deploymentId, plan, fromStepId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to rollback deployment:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;



