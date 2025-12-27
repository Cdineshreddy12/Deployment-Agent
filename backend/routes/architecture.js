const express = require('express');
const router = express.Router();
const architectureAnalyzer = require('../services/architectureAnalyzer');
const mcpArchitectureAnalyzer = require('../services/mcpArchitectureAnalyzer');
const logger = require('../utils/logger');

/**
 * @route GET /api/v1/architecture/:deploymentId
 * @desc Get full architecture analysis for a deployment
 */
router.get('/:deploymentId', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    logger.info(`Analyzing architecture for deployment ${deploymentId}`);
    
    const analysis = await architectureAnalyzer.analyzeProject(deploymentId);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    logger.error('Failed to analyze architecture:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/architecture/:deploymentId/mcp
 * @desc Get enhanced MCP-based architecture analysis
 */
router.get('/:deploymentId/mcp', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    logger.info(`Performing MCP architecture analysis for deployment ${deploymentId}`);
    
    const analysis = await mcpArchitectureAnalyzer.analyzeWithMCP(deploymentId);
    
    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    logger.error('Failed to perform MCP architecture analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/architecture/:deploymentId/structure
 * @desc Get project structure analysis
 */
router.get('/:deploymentId/structure', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    const structure = await architectureAnalyzer.analyzeProjectStructure(deploymentId);
    
    res.json({
      success: true,
      data: structure
    });
  } catch (error) {
    logger.error('Failed to analyze project structure:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/architecture/:deploymentId/dependencies
 * @desc Get dependency analysis
 */
router.get('/:deploymentId/dependencies', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    // First get config files
    const cursorIntegration = require('../services/cursorIntegration');
    const configFiles = await cursorIntegration.readConfigFiles(deploymentId);
    
    const dependencies = await architectureAnalyzer.analyzeDependencies(deploymentId, configFiles);
    
    res.json({
      success: true,
      data: dependencies
    });
  } catch (error) {
    logger.error('Failed to analyze dependencies:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route GET /api/v1/architecture/:deploymentId/deployment-needs
 * @desc Get deployment needs based on architecture
 */
router.get('/:deploymentId/deployment-needs', async (req, res) => {
  try {
    const { deploymentId } = req.params;
    
    const needs = await mcpArchitectureAnalyzer.identifyDeploymentNeeds(deploymentId);
    
    res.json({
      success: true,
      data: needs
    });
  } catch (error) {
    logger.error('Failed to identify deployment needs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;




