const logger = require('../utils/logger');

/**
 * Cursor AI Configuration
 * Configuration for integrating with Cursor's built-in AI models
 */
const cursorAIConfig = {
  // Enable/disable Cursor AI integration
  enabled: process.env.CURSOR_AI_ENABLED !== 'false',

  // Model preferences
  models: {
    // Default model for general operations
    default: process.env.CURSOR_AI_DEFAULT_MODEL || 'cursor-small',
    
    // Model for complex operations (Terraform generation, etc.)
    complex: process.env.CURSOR_AI_COMPLEX_MODEL || 'cursor-large',
    
    // Available models (these are conceptual - actual models depend on Cursor configuration)
    available: ['cursor-small', 'cursor-large', 'gpt-4', 'claude-3-opus']
  },

  // Fallback configuration
  fallback: {
    // Enable fallback to Claude API
    enabled: process.env.CURSOR_AI_FALLBACK_ENABLED !== 'false',
    
    // Conditions to trigger fallback
    conditions: {
      // Fallback on timeout
      timeout: true,
      timeoutMs: parseInt(process.env.CURSOR_AI_TIMEOUT_MS) || 30000,
      
      // Fallback on rate limit
      rateLimit: true,
      
      // Fallback on specific error types
      errorTypes: ['timeout', 'rate_limit', 'service_unavailable'],
      
      // Fallback for complex operations (always use Claude for Terraform generation)
      complexOperations: true
    }
  },

  // Operation categorization
  operations: {
    // Quick operations (use Cursor AI)
    quick: [
      'status_check',
      'list_deployments',
      'get_logs',
      'simple_query',
      'code_analysis',
      'log_parsing'
    ],
    
    // Complex operations (use Claude API or complex model)
    complex: [
      'terraform_generation',
      'infrastructure_planning',
      'cost_estimation',
      'security_analysis',
      'multi_step_reasoning'
    ]
  },

  // Prompt templates for different operations
  prompts: {
    // System prompts for Cursor AI
    system: {
      deployment: `You are a deployment automation assistant. Help users with:
- Checking deployment status
- Listing and filtering deployments
- Understanding deployment logs
- Basic troubleshooting

Keep responses concise and actionable.`,
      
      codeAnalysis: `You are a code analysis assistant. Help users with:
- Analyzing repository structure
- Identifying dependencies
- Detecting deployment requirements
- Suggesting infrastructure

Provide clear, structured analysis.`,
      
      troubleshooting: `You are a troubleshooting assistant. Help users with:
- Diagnosing deployment failures
- Interpreting error messages
- Suggesting fixes
- Guiding through resolution steps

Be methodical and thorough.`
    }
  },

  // Rate limiting for Cursor AI calls
  rateLimiting: {
    enabled: true,
    maxRequestsPerMinute: parseInt(process.env.CURSOR_AI_RATE_LIMIT) || 30,
    maxRequestsPerHour: parseInt(process.env.CURSOR_AI_RATE_LIMIT_HOUR) || 500
  },

  // Cost tracking
  costTracking: {
    enabled: true,
    // Track separately from Claude API costs
    trackSeparately: true
  },

  // Caching configuration
  caching: {
    enabled: true,
    // Cache simple query results
    cacheSimpleQueries: true,
    // Cache TTL in seconds
    ttlSeconds: 300
  }
};

/**
 * Determine which AI to use for an operation
 * @param {string} operation - The operation type
 * @returns {Object} - AI configuration for the operation
 */
const getAIForOperation = (operation) => {
  const isComplex = cursorAIConfig.operations.complex.includes(operation);
  const isQuick = cursorAIConfig.operations.quick.includes(operation);

  if (isComplex) {
    return {
      provider: cursorAIConfig.fallback.conditions.complexOperations ? 'claude' : 'cursor',
      model: cursorAIConfig.models.complex,
      reason: 'Complex operation requiring advanced reasoning'
    };
  }

  if (isQuick) {
    return {
      provider: 'cursor',
      model: cursorAIConfig.models.default,
      reason: 'Quick operation suitable for fast response'
    };
  }

  // Default to Cursor for unknown operations
  return {
    provider: 'cursor',
    model: cursorAIConfig.models.default,
    reason: 'Default operation'
  };
};

/**
 * Get prompt template for operation
 * @param {string} category - The prompt category
 * @returns {string} - System prompt
 */
const getPromptTemplate = (category) => {
  return cursorAIConfig.prompts.system[category] || cursorAIConfig.prompts.system.deployment;
};

/**
 * Check if Cursor AI is available
 * @returns {boolean}
 */
const isCursorAIAvailable = () => {
  return cursorAIConfig.enabled;
};

/**
 * Validate Cursor AI configuration
 */
const validateConfig = () => {
  const issues = [];

  if (cursorAIConfig.enabled && !cursorAIConfig.fallback.enabled) {
    logger.warn('Cursor AI enabled without fallback - may cause failures if Cursor AI is unavailable');
  }

  if (cursorAIConfig.rateLimiting.maxRequestsPerMinute < 1) {
    issues.push('Invalid rate limit configuration');
  }

  return issues.length === 0;
};

module.exports = {
  cursorAIConfig,
  getAIForOperation,
  getPromptTemplate,
  isCursorAIAvailable,
  validateConfig
};





