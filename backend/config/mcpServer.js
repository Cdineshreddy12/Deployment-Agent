const logger = require('../utils/logger');

/**
 * MCP Server Configuration
 * Configures the Model Context Protocol server for Cursor AI integration
 */
const mcpServerConfig = {
  // Server identification
  name: 'deployment-agent-mcp',
  version: '1.0.0',
  description: 'AI-Powered Deployment Automation Platform MCP Server',

  // Transport configuration
  transports: {
    stdio: {
      enabled: true,
      // stdio is the primary transport for Cursor IDE integration
    },
    http: {
      enabled: true,
      port: process.env.MCP_HTTP_PORT || 3001,
      host: process.env.MCP_HTTP_HOST || 'localhost',
      // CORS settings for HTTP transport
      cors: {
        origin: process.env.MCP_CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'Authorization']
      }
    }
  },

  // Authentication configuration
  auth: {
    enabled: process.env.MCP_AUTH_ENABLED === 'true',
    // API key authentication
    apiKey: process.env.MCP_API_KEY,
    // JWT authentication (uses same secret as main app)
    jwtSecret: process.env.JWT_SECRET,
    // Allow unauthenticated access for local development
    allowUnauthenticated: process.env.NODE_ENV === 'development'
  },

  // Tool registration settings
  tools: {
    // Auto-register all available tools on startup
    autoRegister: true,
    // Tool categories to enable
    enabledCategories: ['deployment', 'terraform', 'sandbox', 'monitoring', 'github', 'docker'],
    // Rate limiting per tool
    rateLimiting: {
      enabled: true,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000
    }
  },

  // Resource settings (MCP resources for context)
  resources: {
    // Expose deployment states as resources
    deployments: true,
    // Expose Terraform code as resources
    terraformCode: true,
    // Expose logs as resources
    logs: true
  },

  // Prompt templates for AI
  prompts: {
    enabled: true,
    categories: ['deployment', 'troubleshooting', 'optimization']
  },

  // Logging configuration
  logging: {
    level: process.env.MCP_LOG_LEVEL || 'info',
    includeToolCalls: true,
    includeResponses: true
  },

  // Error handling
  errorHandling: {
    // Return detailed errors in development
    verbose: process.env.NODE_ENV === 'development',
    // Retry failed operations
    retryEnabled: true,
    maxRetries: 3,
    retryDelayMs: 1000
  }
};

/**
 * Get server capabilities for MCP protocol
 */
const getServerCapabilities = () => {
  return {
    tools: mcpServerConfig.tools.autoRegister ? {} : undefined,
    resources: mcpServerConfig.resources.deployments || 
               mcpServerConfig.resources.terraformCode || 
               mcpServerConfig.resources.logs ? {} : undefined,
    prompts: mcpServerConfig.prompts.enabled ? {} : undefined,
    logging: {}
  };
};

/**
 * Validate MCP server configuration
 */
const validateConfig = () => {
  const issues = [];

  if (mcpServerConfig.auth.enabled && !mcpServerConfig.auth.apiKey && !mcpServerConfig.auth.jwtSecret) {
    issues.push('MCP authentication enabled but no API key or JWT secret configured');
  }

  if (mcpServerConfig.transports.http.enabled && !mcpServerConfig.transports.http.port) {
    issues.push('HTTP transport enabled but no port configured');
  }

  if (issues.length > 0) {
    logger.warn('MCP Server configuration issues:', issues);
  }

  return issues.length === 0;
};

module.exports = {
  mcpServerConfig,
  getServerCapabilities,
  validateConfig
};





