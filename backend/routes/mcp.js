const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const mcpOrchestrator = require('../services/mcpOrchestrator');
const { mcpConfig, mcpConnections, validateMCPConfig, getMCPConfigSummary, getAllConnectionStatuses } = require('../config/mcp');
const MCPUsage = require('../models/MCPUsage');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/mcp/status
 * Get overall MCP system status
 */
router.get('/status', async (req, res, next) => {
  try {
    const connectedServers = mcpOrchestrator.getConnectedServers();
    const allStatuses = mcpOrchestrator.getAllServerStatuses();
    const configValidation = validateMCPConfig();
    const configSummary = getMCPConfigSummary();
    
    res.json({
      success: true,
      data: {
        status: connectedServers.length > 0 ? 'operational' : 'degraded',
        connectedServers,
        serverCount: {
          total: Object.keys(mcpConfig).length,
          connected: connectedServers.length
        },
        servers: allStatuses,
        configuration: {
          valid: configValidation.valid,
          issues: configValidation.issues,
          summary: configSummary
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/servers
 * Get all MCP server configurations and statuses
 */
router.get('/servers', async (req, res, next) => {
  try {
    const servers = [];
    
    for (const [name, config] of Object.entries(mcpConfig)) {
      const status = mcpOrchestrator.getServerStatus(name);
      servers.push({
        name,
        url: config.url,
        type: config.type || 'url',
        tools: config.tools,
        toolCount: config.tools.length,
        connected: status.connected,
        connectedAt: status.connectedAt,
        error: status.error
      });
    }
    
    res.json({
      success: true,
      data: { servers }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/servers/:serverName
 * Get specific MCP server status
 */
router.get('/servers/:serverName', async (req, res, next) => {
  try {
    const { serverName } = req.params;
    
    if (!mcpConfig[serverName]) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SERVER_NOT_FOUND',
          message: `MCP server '${serverName}' not found`
        }
      });
    }
    
    const status = mcpOrchestrator.getServerStatus(serverName);
    const tools = mcpOrchestrator.getAvailableTools(serverName);
    
    res.json({
      success: true,
      data: {
        ...status,
        tools,
        toolCount: tools.length
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/mcp/servers/:serverName/reconnect
 * Reconnect to a specific MCP server
 */
router.post('/servers/:serverName/reconnect', async (req, res, next) => {
  try {
    const { serverName } = req.params;
    
    if (!mcpConfig[serverName]) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SERVER_NOT_FOUND',
          message: `MCP server '${serverName}' not found`
        }
      });
    }
    
    logger.info(`Reconnecting to MCP server: ${serverName}`, { userId: req.user._id });
    
    await mcpOrchestrator.reconnect(serverName);
    const status = mcpOrchestrator.getServerStatus(serverName);
    
    res.json({
      success: true,
      data: {
        message: `Successfully reconnected to ${serverName}`,
        status
      }
    });
  } catch (error) {
    logger.error(`Failed to reconnect to MCP server: ${req.params.serverName}`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RECONNECT_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/v1/mcp/health
 * Health check for all MCP servers
 */
router.get('/health', async (req, res, next) => {
  try {
    const healthResults = await mcpOrchestrator.healthCheck();
    
    const allHealthy = Object.values(healthResults).every(r => r.healthy);
    const someHealthy = Object.values(healthResults).some(r => r.healthy);
    
    res.json({
      success: true,
      data: {
        overall: allHealthy ? 'healthy' : (someHealthy ? 'degraded' : 'unhealthy'),
        servers: healthResults
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/tools
 * Get all available MCP tools across all servers
 */
router.get('/tools', async (req, res, next) => {
  try {
    const allTools = mcpOrchestrator.getAllAvailableTools();
    
    // Flatten into array with server info
    const tools = [];
    for (const [serverName, serverTools] of Object.entries(allTools)) {
      for (const toolName of serverTools) {
        tools.push({
          name: toolName,
          server: serverName,
          available: mcpOrchestrator.isConnected(serverName)
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        totalTools: tools.length,
        tools
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/mcp/tools/execute
 * Execute an MCP tool (admin only)
 */
router.post('/tools/execute', requirePermission('*'), async (req, res, next) => {
  try {
    const { serverName, toolName, parameters } = req.body;
    
    if (!serverName || !toolName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'serverName and toolName are required'
        }
      });
    }
    
    logger.info(`Executing MCP tool via API: ${serverName}.${toolName}`, {
      userId: req.user._id,
      parameters: Object.keys(parameters || {})
    });
    
    const result = await mcpOrchestrator.executeTool(serverName, toolName, parameters || {});
    
    res.json({
      success: true,
      data: {
        toolName,
        serverName,
        result
      }
    });
  } catch (error) {
    logger.error(`MCP tool execution failed: ${req.body.serverName}.${req.body.toolName}`, error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/v1/mcp/stats
 * Get MCP usage statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const orchestratorStats = mcpOrchestrator.getToolCallStats();
    const serverStats = await MCPUsage.getServerStats();
    
    res.json({
      success: true,
      data: {
        session: orchestratorStats,
        database: serverStats
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/usage
 * Get MCP usage history
 */
router.get('/usage', async (req, res, next) => {
  try {
    const { deploymentId, serverName, toolName, limit = 100, page = 1 } = req.query;
    
    const query = {};
    if (deploymentId) query.deploymentId = deploymentId;
    if (serverName) query.serverName = serverName;
    if (toolName) query.toolName = toolName;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [usage, total] = await Promise.all([
      MCPUsage.find(query)
        .sort({ timestamp: -1 })
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      MCPUsage.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      data: {
        usage,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/usage/deployment/:deploymentId
 * Get MCP usage for a specific deployment
 */
router.get('/usage/deployment/:deploymentId', async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    
    const usage = await MCPUsage.getDeploymentUsage(deploymentId);
    const recentCalls = await MCPUsage.find({ deploymentId })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean();
    
    res.json({
      success: true,
      data: {
        deploymentId,
        summary: usage,
        recentCalls
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/v1/mcp/history
 * Get tool call history from current session
 */
router.get('/history', async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    
    const history = mcpOrchestrator.getToolCallHistory(parseInt(limit));
    
    res.json({
      success: true,
      data: {
        count: history.length,
        history
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;


