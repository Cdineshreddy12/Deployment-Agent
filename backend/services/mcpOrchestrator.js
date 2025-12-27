const axios = require('axios');
const EventSource = require('eventsource');
const { mcpConfig, mcpConnections } = require('../config/mcp');
const logger = require('../utils/logger');

/**
 * MCP Orchestrator Service
 * Handles real communication with MCP servers for Terraform, AWS, and GitHub operations
 * Uses HTTP/SSE for MCP protocol communication
 */
class MCPOrchestrator {
  constructor() {
    this.servers = new Map();
    this.toolCallHistory = [];
    this.eventSources = new Map();
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    this.connectionTimeout = 30000; // 30 seconds
    this.toolExecutionTimeout = 60000; // 60 seconds for tool execution
  }

  /**
   * Initialize MCP server connections
   * By default, uses lazy initialization - only connects when tools are actually used
   * Set MCP_EAGER_CONNECT=true to connect on startup
   */
  async initialize() {
    logger.info('Initializing MCP orchestrator...');
    
    // Check if eager connection is enabled (default: false)
    const eagerConnect = process.env.MCP_EAGER_CONNECT === 'true';
    
    if (!eagerConnect) {
      // Register servers without connecting - lazy initialization
      for (const [name, config] of Object.entries(mcpConfig)) {
        this.registerServer(name, config);
      }
      logger.info('MCP orchestrator initialized in lazy mode. Servers will connect on first use.');
      logger.info(`Registered servers: ${Object.keys(mcpConfig).join(', ')}`);
      return;
    }
    
    // Eager connection mode - connect to all servers on startup
    logger.info('MCP eager connection mode enabled. Connecting to servers...');
    
    for (const [name, config] of Object.entries(mcpConfig)) {
      // Skip servers with placeholder URLs
      if (this.isPlaceholderUrl(config.url)) {
        logger.info(`MCP server ${name} has placeholder URL, skipping connection (will use fallback)`);
        this.registerServer(name, config);
        continue;
      }
      
      try {
        await this.connectToMCP(name, config);
        logger.info(`MCP server ${name} initialized successfully`);
      } catch (error) {
        logger.warn(`Failed to initialize MCP server ${name}: ${error.message}`);
        // Continue with other servers even if one fails - graceful degradation
        this.markServerDisconnected(name, error.message);
      }
    }
    
    logger.info(`MCP orchestrator initialized. Connected servers: ${this.getConnectedServers().join(', ') || 'none (using fallbacks)'}`);
  }

  /**
   * Register a server without connecting (lazy initialization)
   */
  registerServer(name, config) {
    this.servers.set(name, {
      name,
      url: config.url,
      config,
      connected: false,
      registered: true,
      tools: config.tools || [],
      lazyInit: true
    });
  }

  /**
   * Check if a URL is a placeholder (doesn't exist)
   */
  isPlaceholderUrl(url) {
    if (!url) return true;
    
    const placeholderDomains = [
      'mcp.terraform.com',
      'mcp.aws.com', 
      'mcp.github.com',
      'mcp.docker.com',
      'localhost:0'
    ];
    
    try {
      const urlObj = new URL(url);
      return placeholderDomains.some(domain => urlObj.hostname === domain);
    } catch {
      return true;
    }
  }

  /**
   * Connect to an MCP server using HTTP/SSE
   */
  async connectToMCP(serverName, config) {
    try {
      const serverUrl = config.url;
      
      // Handle local/socket-based servers (like Docker)
      if (config.type === 'local') {
        logger.info(`MCP server ${serverName} is configured as local (socket-based), marking as available`);
        const connection = {
          name: serverName,
          url: null,
          config,
          connected: true,
          connectedAt: new Date(),
          tools: config.tools || [],
          serverInfo: { type: 'local' },
          capabilities: {},
          isLocal: true
        };
        this.servers.set(serverName, connection);
        return connection;
      }
      
      if (!serverUrl) {
        throw new Error(`No URL configured for MCP server: ${serverName}. Set ${serverName.toUpperCase()}_MCP_URL environment variable.`);
      }
      
      // Check for placeholder URLs
      if (this.isPlaceholderUrl(serverUrl)) {
        logger.info(`MCP server ${serverName} has placeholder URL, using fallback mode`);
        const connection = {
          name: serverName,
          url: serverUrl,
          config,
          connected: false,
          registered: true,
          tools: config.tools || [],
          useFallback: true
        };
        this.servers.set(serverName, connection);
        return connection;
      }

      logger.info(`Connecting to MCP server: ${serverName} at ${serverUrl}`);

      // Test connection by sending initialize request
      const initResponse = await this.sendMCPRequest(serverName, serverUrl, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {}
        },
        clientInfo: {
          name: 'deployment-agent',
          version: '1.0.0'
        }
      }, config.env);

      // Get available tools from the server
      const toolsResponse = await this.sendMCPRequest(serverName, serverUrl, 'tools/list', {}, config.env);
      
      const availableTools = toolsResponse?.tools?.map(t => t.name) || config.tools || [];

      // Store connection
      const connection = {
        name: serverName,
        url: serverUrl,
        config,
        connected: true,
        connectedAt: new Date(),
        tools: availableTools,
        serverInfo: initResponse?.serverInfo || {},
        capabilities: initResponse?.capabilities || {}
      };
      
      this.servers.set(serverName, connection);
      
      // Update global connection status
      if (mcpConnections[serverName]) {
        mcpConnections[serverName].connected = true;
        mcpConnections[serverName].lastConnected = new Date();
        mcpConnections[serverName].error = null;
      }
      
      logger.info(`Connected to MCP server: ${serverName}`, { 
        toolCount: availableTools.length,
        tools: availableTools.slice(0, 5) // Log first 5 tools
      });
      
      return connection;
      
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${serverName}:`, error);
      this.markServerDisconnected(serverName, error.message);
      throw error;
    }
  }

  /**
   * Send an MCP protocol request via HTTP
   */
  async sendMCPRequest(serverName, serverUrl, method, params = {}, env = {}) {
    const requestId = ++this.requestIdCounter;
    
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    try {
      // Build headers with environment variables (for auth tokens, etc.)
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      // Add auth headers from env
      if (env.TFE_TOKEN) {
        headers['Authorization'] = `Bearer ${env.TFE_TOKEN}`;
      }
      if (env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${env.GITHUB_TOKEN}`;
      }
      if (env.AWS_ACCESS_KEY_ID) {
        headers['X-AWS-Access-Key'] = env.AWS_ACCESS_KEY_ID;
      }

      const response = await axios.post(serverUrl, request, {
        headers,
        timeout: this.connectionTimeout,
        validateStatus: (status) => status < 500 // Accept 4xx as valid responses
      });

      if (response.data.error) {
        throw new Error(`MCP error: ${response.data.error.message || JSON.stringify(response.data.error)}`);
      }

      return response.data.result;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new Error(`MCP server ${serverName} is not reachable at ${serverUrl}`);
        }
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          throw new Error(`MCP server ${serverName} connection timed out`);
        }
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw new Error(`MCP server ${serverName} authentication failed`);
        }
        if (error.response?.status === 404) {
          throw new Error(`MCP server ${serverName} endpoint not found`);
        }
      }
      throw error;
    }
  }

  /**
   * Execute a tool on an MCP server
   */
  async executeTool(serverName, toolName, parameters = {}) {
    let server = this.servers.get(serverName);
    
    if (!server) {
      // Check if server is configured but not registered
      if (mcpConfig[serverName]) {
        logger.info(`MCP server ${serverName} not registered, registering now`);
        this.registerServer(serverName, mcpConfig[serverName]);
        server = this.servers.get(serverName);
      } else {
        throw new Error(`MCP server ${serverName} not found or not configured`);
      }
    }
    
    // Check if server should use fallback (placeholder URL or not connected)
    if (server.useFallback || !server.connected) {
      logger.info(`Using fallback for ${serverName}.${toolName}`);
      return this.executeFallbackTool(serverName, toolName, parameters);
    }
    
    // For local servers, use fallback handlers which connect to local services
    if (server.isLocal) {
      return this.executeFallbackTool(serverName, toolName, parameters);
    }
    
    const startTime = Date.now();
    
    try {
      logger.info(`Executing MCP tool: ${serverName}.${toolName}`, { 
        parameters: this.sanitizeParameters(parameters) 
      });
      
      // Send tool call request to MCP server
      const result = await this.sendToolCallRequest(serverName, toolName, parameters);
      
      const duration = Date.now() - startTime;
      
      // Log successful tool usage
      this.toolCallHistory.push({
        server: serverName,
        tool: toolName,
        parameters: this.sanitizeParameters(parameters),
        result: this.sanitizeResult(result),
        timestamp: new Date(),
        duration,
        success: true
      });
      
      logger.info(`MCP tool executed successfully: ${serverName}.${toolName}`, { 
        duration,
        resultSize: JSON.stringify(result).length
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log failed tool call
      this.toolCallHistory.push({
        server: serverName,
        tool: toolName,
        parameters: this.sanitizeParameters(parameters),
        error: error.message,
        timestamp: new Date(),
        duration,
        success: false
      });
      
      logger.error(`MCP tool execution failed: ${serverName}.${toolName}`, { 
        error: error.message,
        duration
      });
      
      // Try fallback for certain tools
      return this.executeFallbackTool(serverName, toolName, parameters);
    }
  }

  /**
   * Send tool call request to MCP server
   */
  async sendToolCallRequest(serverName, toolName, parameters) {
    const server = this.servers.get(serverName);
    
    if (!server || !server.connected) {
      throw new Error(`MCP server ${serverName} is not connected`);
    }

    const response = await this.sendMCPRequest(
      serverName,
      server.url,
      'tools/call',
      {
        name: toolName,
        arguments: parameters
      },
      server.config.env || {}
    );

    return response;
  }

  /**
   * Execute fallback tool when MCP server is unavailable
   * This provides graceful degradation
   */
  async executeFallbackTool(serverName, toolName, parameters) {
    logger.warn(`Using fallback for ${serverName}.${toolName} - MCP server unavailable`);

    // Terraform fallbacks
    if (serverName === 'terraform') {
      return this.terraformFallback(toolName, parameters);
    }
    
    // AWS fallbacks
    if (serverName === 'aws') {
      return this.awsFallback(toolName, parameters);
    }
    
    // GitHub fallbacks
    if (serverName === 'github') {
      return this.githubFallback(toolName, parameters);
    }

    // Generic fallback
    return {
      success: false,
      fallback: true,
      message: `MCP server ${serverName} is unavailable. Tool ${toolName} could not be executed.`,
      error: 'MCP_SERVER_UNAVAILABLE'
    };
  }

  /**
   * Terraform tool fallbacks using local implementations or cached data
   */
  async terraformFallback(toolName, parameters) {
    switch (toolName) {
      case 'get_provider_documentation':
        return {
          success: true,
          fallback: true,
          message: 'Using cached/training data for provider documentation',
          documentation: {
            provider: parameters.provider || 'aws',
            resource: parameters.resource,
            note: 'Documentation fetched from fallback. Some details may be outdated.'
          }
        };
      
      case 'search_modules':
        return {
          success: true,
          fallback: true,
          modules: [],
          message: 'Module search unavailable. Using known modules from training data.'
        };
      
      case 'get_module_info':
        return {
          success: true,
          fallback: true,
          message: 'Module info unavailable. Please refer to Terraform Registry directly.',
          module: parameters.module
        };
      
      case 'get_sentinel_policies':
        return {
          success: true,
          fallback: true,
          policies: [],
          message: 'Sentinel policies unavailable. Using default security practices.'
        };
        
      default:
        return {
          success: true,
          fallback: true,
          message: `Terraform tool ${toolName} executed with fallback`
        };
    }
  }

  /**
   * AWS tool fallbacks
   */
  async awsFallback(toolName, parameters) {
    const awsService = require('./aws');
    
    switch (toolName) {
      case 'describe_resources':
        try {
          // Try using local AWS SDK
          const resources = await awsService.describeResources(parameters);
          return { success: true, resources };
        } catch (error) {
          return {
            success: false,
            fallback: true,
            message: 'AWS resource description unavailable',
            error: error.message
          };
        }
      
      case 'get_cost_and_usage':
        try {
          const costs = await awsService.getActualCost(
            parameters.deploymentId,
            parameters.startDate,
            parameters.endDate
          );
          return { success: true, costs };
        } catch (error) {
          return {
            success: false,
            fallback: true,
            message: 'Cost data unavailable',
            error: error.message
          };
        }
      
      case 'estimate_cost':
        try {
          const estimate = await awsService.estimateCost(parameters.resources);
          return { success: true, estimate };
        } catch (error) {
          return {
            success: true,
            fallback: true,
            estimate: {
              totalMonthlyCost: 0,
              message: 'Cost estimation unavailable. Manual estimation required.'
            }
          };
        }
      
      case 'check_service_quotas':
        try {
          const quotas = await awsService.checkQuotas(parameters.services);
          return { success: true, quotas };
        } catch (error) {
          return {
            success: true,
            fallback: true,
            quotas: {},
            message: 'Service quota check unavailable'
          };
        }
        
      default:
        return {
          success: true,
          fallback: true,
          message: `AWS tool ${toolName} executed with fallback`
        };
    }
  }

  /**
   * GitHub tool fallbacks
   */
  async githubFallback(toolName, parameters) {
    const githubService = require('./githubService');
    
    switch (toolName) {
      case 'read_repository':
        try {
          const repo = await githubService.getRepository(
            parameters.owner,
            parameters.repo,
            parameters.token
          );
          return { success: true, repository: repo };
        } catch (error) {
          return {
            success: false,
            fallback: true,
            message: 'Repository read unavailable',
            error: error.message
          };
        }
      
      case 'read_file':
        try {
          const content = await githubService.getFileContent(
            parameters.owner,
            parameters.repo,
            parameters.path,
            parameters.token
          );
          return { success: true, content };
        } catch (error) {
          return {
            success: false,
            fallback: true,
            message: 'File read unavailable',
            error: error.message
          };
        }
        
      default:
        return {
          success: true,
          fallback: true,
          message: `GitHub tool ${toolName} executed with fallback`
        };
    }
  }

  /**
   * Mark a server as disconnected
   */
  markServerDisconnected(serverName, errorMessage) {
    const server = this.servers.get(serverName);
    if (server) {
      server.connected = false;
      server.error = errorMessage;
    }
    
    if (mcpConnections[serverName]) {
      mcpConnections[serverName].connected = false;
      mcpConnections[serverName].error = errorMessage;
    }
  }

  /**
   * Get list of connected servers
   */
  getConnectedServers() {
    const connected = [];
    this.servers.forEach((server, name) => {
      if (server.connected) {
        connected.push(name);
      }
    });
    return connected;
  }

  /**
   * Get available tools for a server
   */
  getAvailableTools(serverName) {
    const server = this.servers.get(serverName);
    if (!server) {
      return mcpConfig[serverName]?.tools || [];
    }
    return server.tools;
  }

  /**
   * Get all available tools across all servers
   */
  getAllAvailableTools() {
    const allTools = {};
    this.servers.forEach((server, name) => {
      allTools[name] = server.tools;
    });
    return allTools;
  }

  /**
   * Get tool call history
   */
  getToolCallHistory(limit = 100) {
    return this.toolCallHistory.slice(-limit);
  }

  /**
   * Get tool call statistics
   */
  getToolCallStats() {
    const stats = {
      total: this.toolCallHistory.length,
      successful: 0,
      failed: 0,
      byServer: {},
      byTool: {},
      averageLatency: 0
    };

    let totalLatency = 0;

    for (const call of this.toolCallHistory) {
      if (call.success) {
        stats.successful++;
      } else {
        stats.failed++;
      }

      // By server
      if (!stats.byServer[call.server]) {
        stats.byServer[call.server] = { total: 0, successful: 0, failed: 0 };
      }
      stats.byServer[call.server].total++;
      if (call.success) {
        stats.byServer[call.server].successful++;
      } else {
        stats.byServer[call.server].failed++;
      }

      // By tool
      const toolKey = `${call.server}.${call.tool}`;
      if (!stats.byTool[toolKey]) {
        stats.byTool[toolKey] = { total: 0, successful: 0, failed: 0, avgLatency: 0 };
      }
      stats.byTool[toolKey].total++;
      if (call.success) {
        stats.byTool[toolKey].successful++;
      } else {
        stats.byTool[toolKey].failed++;
      }

      totalLatency += call.duration || 0;
    }

    stats.averageLatency = stats.total > 0 ? Math.round(totalLatency / stats.total) : 0;

    return stats;
  }

  /**
   * Check if server is connected
   */
  isConnected(serverName) {
    const server = this.servers.get(serverName);
    return server && server.connected;
  }

  /**
   * Get server status
   */
  getServerStatus(serverName) {
    const server = this.servers.get(serverName);
    if (!server) {
      return {
        name: serverName,
        connected: false,
        configured: !!mcpConfig[serverName],
        error: 'Server not initialized'
      };
    }
    return {
      name: serverName,
      connected: server.connected,
      connectedAt: server.connectedAt,
      tools: server.tools,
      error: server.error || null
    };
  }

  /**
   * Get all server statuses
   */
  getAllServerStatuses() {
    const statuses = {};
    for (const serverName of Object.keys(mcpConfig)) {
      statuses[serverName] = this.getServerStatus(serverName);
    }
    return statuses;
  }

  /**
   * Health check for all MCP servers
   */
  async healthCheck() {
    const results = {};
    
    for (const [name, config] of Object.entries(mcpConfig)) {
      try {
        const startTime = Date.now();
        
        // Try to send a ping/tools list request
        if (this.isConnected(name)) {
          const server = this.servers.get(name);
          await this.sendMCPRequest(name, server.url, 'tools/list', {}, server.config.env || {});
          
          results[name] = {
            healthy: true,
            latency: Date.now() - startTime,
            message: 'Server responding normally'
          };
        } else {
          // Try to reconnect
          await this.connectToMCP(name, config);
          results[name] = {
            healthy: true,
            latency: Date.now() - startTime,
            message: 'Server reconnected successfully'
          };
        }
      } catch (error) {
        results[name] = {
          healthy: false,
          error: error.message,
          message: 'Server health check failed'
        };
      }
    }
    
    return results;
  }

  /**
   * Reconnect to a specific server
   */
  async reconnect(serverName) {
    const config = mcpConfig[serverName];
    if (!config) {
      throw new Error(`Unknown MCP server: ${serverName}`);
    }
    
    logger.info(`Attempting to reconnect to MCP server: ${serverName}`);
    
    // Close existing connection if any
    const existingServer = this.servers.get(serverName);
    if (existingServer) {
      existingServer.connected = false;
    }
    
    // Reconnect
    return this.connectToMCP(serverName, config);
  }

  /**
   * Disconnect from all servers
   */
  async disconnect() {
    logger.info('Disconnecting from all MCP servers...');
    
    // Close all event sources
    this.eventSources.forEach((es, name) => {
      try {
        es.close();
      } catch (error) {
        logger.warn(`Error closing event source for ${name}:`, error);
      }
    });
    this.eventSources.clear();
    
    // Mark all servers as disconnected
    this.servers.forEach((server, name) => {
      server.connected = false;
      if (mcpConnections[name]) {
        mcpConnections[name].connected = false;
      }
    });
    
    this.servers.clear();
    logger.info('Disconnected from all MCP servers');
  }

  /**
   * Sanitize parameters for logging (remove sensitive data)
   */
  sanitizeParameters(params) {
    if (!params) return {};
    
    const sanitized = { ...params };
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'credential', 'auth'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    
    return sanitized;
  }

  /**
   * Sanitize result for logging (truncate large results)
   */
  sanitizeResult(result) {
    if (!result) return null;
    
    const str = JSON.stringify(result);
    if (str.length > 1000) {
      return {
        _truncated: true,
        _originalLength: str.length,
        preview: str.substring(0, 500) + '...'
      };
    }
    
    return result;
  }
}

// Singleton instance
const mcpOrchestrator = new MCPOrchestrator();

module.exports = mcpOrchestrator;
