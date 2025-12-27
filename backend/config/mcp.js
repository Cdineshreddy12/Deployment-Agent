const logger = require('../utils/logger');

/**
 * MCP Server Configuration
 * 
 * These functions return configuration for Claude API integration.
 * They only return valid configs when URLs are properly configured.
 * 
 * Environment variables:
 * - TERRAFORM_MCP_URL: URL for Terraform MCP server
 * - AWS_MCP_URL: URL for AWS MCP server  
 * - GITHUB_MCP_URL: URL for GitHub MCP server
 * - TFE_TOKEN: Terraform Enterprise token (optional)
 * - GITHUB_TOKEN: GitHub personal access token (optional)
 */

// Terraform MCP Server configuration for Claude API integration
const getTerraformMCPConfig = () => {
  const url = process.env.TERRAFORM_MCP_URL;
  
  // Return null config if no URL is configured
  if (!url) {
    return {
      type: 'none',
      name: 'terraform-mcp',
      available: false
    };
  }
  
  const config = {
    type: 'url',
    url,
    name: 'terraform-mcp'
  };

  // Add HCP Terraform / Terraform Enterprise configuration if token is provided
  if (process.env.TFE_TOKEN) {
    config.env = {
      TFE_TOKEN: process.env.TFE_TOKEN,
      TFE_HOSTNAME: process.env.TFE_HOSTNAME || 'app.terraform.io',
      TFE_SKIP_VERIFY: process.env.TFE_SKIP_VERIFY || 'false',
      ENABLE_TF_OPERATIONS: process.env.ENABLE_TF_OPERATIONS || 'false' // Default to read-only
    };
  }

  return config;
};

// GitHub MCP Server configuration for Claude API integration
const getGitHubMCPConfig = () => {
  const url = process.env.GITHUB_MCP_URL;
  
  // Return null config if no URL is configured
  if (!url) {
    return {
      type: 'none',
      name: 'github-mcp',
      available: false
    };
  }
  
  const config = {
    type: 'url',
    url,
    name: 'github-mcp'
  };

  // Add GitHub token if provided (for API access)
  if (process.env.GITHUB_TOKEN) {
    config.env = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GITHUB_API_BASE_URL: process.env.GITHUB_API_BASE_URL || 'https://api.github.com'
    };
  }

  // Add GitHub App credentials if provided
  if (process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY) {
    config.env = {
      ...config.env,
      GITHUB_APP_ID: process.env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: process.env.GITHUB_APP_PRIVATE_KEY
    };
  }

  return config;
};

// Docker MCP configuration (local Docker operations)
const getDockerMCPConfig = () => {
  return {
    type: 'local',
    name: 'docker-mcp',
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
  };
};

/**
 * MCP Server Configuration
 * 
 * Note: MCP servers can be configured via environment variables:
 * - TERRAFORM_MCP_URL: URL for Terraform MCP server (optional, uses fallback if not set)
 * - AWS_MCP_URL: URL for AWS MCP server (optional, uses fallback if not set)
 * - GITHUB_MCP_URL: URL for GitHub MCP server (optional, uses fallback if not set)
 * 
 * When MCP servers are not available, the system uses fallback implementations
 * that provide similar functionality using direct API calls or cached data.
 * 
 * To run local MCP servers, you can use:
 * - npx @anthropic-ai/terraform-mcp-server (for Terraform)
 * - Local implementations of AWS/GitHub tools
 */
const mcpConfig = {
  terraform: {
    name: 'terraform-mcp',
    // Only use URL if explicitly configured - no placeholder
    url: process.env.TERRAFORM_MCP_URL || null,
    env: process.env.TFE_TOKEN ? {
      TFE_TOKEN: process.env.TFE_TOKEN,
      TFE_HOSTNAME: process.env.TFE_HOSTNAME || 'app.terraform.io'
    } : {},
    // MCP tools available via Terraform MCP Server
    tools: [
      'get_provider_documentation',
      'search_modules',
      'get_module_info',
      'get_sentinel_policies',
      'list_organizations',
      'list_workspaces',
      'create_workspace',
      'update_workspace',
      'delete_workspace',
      'create_run',
      'manage_variables',
      'manage_tags'
    ],
    // Get Claude API compatible config
    getClaudeConfig: getTerraformMCPConfig
  },
  aws: {
    name: 'aws-mcp',
    // Only use URL if explicitly configured - no placeholder
    url: process.env.AWS_MCP_URL || null,
    tools: [
      'describe_resources',
      'get_cost_and_usage',
      'check_service_quotas',
      'get_cloudwatch_metrics',
      'create_budget',
      'tag_resources',
      'estimate_cost'
    ]
  },
  github: {
    name: 'github-mcp',
    // Only use URL if explicitly configured - no placeholder
    url: process.env.GITHUB_MCP_URL || null,
    env: process.env.GITHUB_TOKEN ? {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN
    } : {},
    // GitHub MCP tools (if MCP server exists, otherwise use REST API)
    tools: [
      'read_repository',
      'list_repositories',
      'read_file',
      'list_files',
      'create_branch',
      'create_commit',
      'create_pull_request',
      'trigger_workflow',
      'get_workflow_status',
      'list_workflows',
      'manage_secrets',
      'get_actions_status'
    ],
    // Get Claude API compatible config
    getClaudeConfig: getGitHubMCPConfig
  },
  docker: {
    name: 'docker-mcp',
    type: 'local',
    socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    // Docker MCP tools (local operations via dockerode)
    tools: [
      'docker_build',
      'docker_run',
      'docker_compose_up',
      'docker_compose_down',
      'docker_inspect',
      'docker_logs',
      'docker_ps',
      'docker_stop',
      'docker_remove',
      'docker_pull',
      'docker_push',
      'docker_images'
    ],
    // Get Docker config
    getClaudeConfig: getDockerMCPConfig
  }
};

// MCP Server Connection Status
const mcpConnections = {
  terraform: {
    connected: false,
    lastConnected: null,
    error: null
  },
  aws: {
    connected: false,
    lastConnected: null,
    error: null
  },
  github: {
    connected: false,
    lastConnected: null,
    error: null
  },
  docker: {
    connected: false,
    lastConnected: null,
    error: null
  }
};

// Initialize MCP connections
const initializeMCP = async () => {
  logger.info('Initializing MCP servers...');
  
  // Note: Actual MCP server connection will be handled by the orchestrator
  // This is just configuration
  logger.info('MCP configuration loaded:', {
    terraform: mcpConfig.terraform.name,
    aws: mcpConfig.aws.name,
    github: mcpConfig.github.name,
    docker: mcpConfig.docker.name
  });
  
  return mcpConfig;
};

// Test MCP server connectivity using the orchestrator
const testMCPConnection = async (serverName) => {
  const server = mcpConfig[serverName];
  if (!server) {
    throw new Error(`Unknown MCP server: ${serverName}`);
  }

  try {
    const mcpOrchestrator = require('../services/mcpOrchestrator');
    
    // Use orchestrator to test connection
    if (mcpOrchestrator.isConnected(serverName)) {
      mcpConnections[serverName].connected = true;
      mcpConnections[serverName].lastConnected = new Date();
      mcpConnections[serverName].error = null;
      logger.info(`MCP server ${serverName} connection test passed`);
      return true;
    }
    
    // Try to reconnect
    await mcpOrchestrator.reconnect(serverName);
    mcpConnections[serverName].connected = true;
    mcpConnections[serverName].lastConnected = new Date();
    mcpConnections[serverName].error = null;
    logger.info(`MCP server ${serverName} reconnected successfully`);
    return true;
    
  } catch (error) {
    mcpConnections[serverName].connected = false;
    mcpConnections[serverName].error = error.message;
    logger.error(`MCP server ${serverName} connection test failed:`, error);
    return false;
  }
};

// Validate MCP configuration
const validateMCPConfig = () => {
  const issues = [];
  
  // Check Terraform MCP
  if (!process.env.TERRAFORM_MCP_URL) {
    issues.push('TERRAFORM_MCP_URL not configured - using default');
  }
  
  // Check AWS MCP
  if (!process.env.AWS_MCP_URL) {
    issues.push('AWS_MCP_URL not configured - AWS MCP tools will use fallback');
  }
  
  // Check GitHub MCP
  if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_APP_ID) {
    issues.push('No GitHub credentials configured - GitHub MCP tools may not work');
  }
  
  // Check TFE configuration
  if (process.env.ENABLE_TF_OPERATIONS === 'true' && !process.env.TFE_TOKEN) {
    issues.push('TF operations enabled but TFE_TOKEN not set');
  }
  
  if (issues.length > 0) {
    logger.warn('MCP configuration issues:', issues);
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
};

// Get MCP configuration summary
const getMCPConfigSummary = () => {
  return {
    terraform: {
      url: mcpConfig.terraform.url,
      toolCount: mcpConfig.terraform.tools.length,
      hasAuth: !!process.env.TFE_TOKEN,
      writeEnabled: process.env.ENABLE_TF_OPERATIONS === 'true'
    },
    aws: {
      url: mcpConfig.aws.url,
      toolCount: mcpConfig.aws.tools.length,
      configured: !!process.env.AWS_MCP_URL
    },
    github: {
      url: mcpConfig.github.url,
      toolCount: mcpConfig.github.tools.length,
      hasAuth: !!(process.env.GITHUB_TOKEN || process.env.GITHUB_APP_ID)
    },
    docker: {
      type: 'local',
      toolCount: mcpConfig.docker.tools.length,
      socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
    }
  };
};

// Get all connection statuses
const getAllConnectionStatuses = () => {
  return { ...mcpConnections };
};

module.exports = {
  mcpConfig,
  mcpConnections,
  initializeMCP,
  testMCPConnection,
  validateMCPConfig,
  getMCPConfigSummary,
  getAllConnectionStatuses
};

