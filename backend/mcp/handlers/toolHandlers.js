const logger = require('../../utils/logger');

/**
 * Tool Handler Utilities
 * Common functionality for MCP tool handlers
 */

/**
 * Wrap a tool handler with error handling and logging
 */
const wrapHandler = (toolName, handler) => {
  return async (args) => {
    const startTime = Date.now();
    
    logger.info(`MCP Tool executing: ${toolName}`, { args });
    
    try {
      const result = await handler(args);
      
      const duration = Date.now() - startTime;
      logger.info(`MCP Tool completed: ${toolName}`, { duration, success: true });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`MCP Tool failed: ${toolName}`, { 
        duration, 
        error: error.message,
        stack: error.stack 
      });
      
      throw error;
    }
  };
};

/**
 * Validate required arguments for a tool
 */
const validateArgs = (args, required) => {
  const missing = required.filter(arg => args[arg] === undefined || args[arg] === null);
  
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.join(', ')}`);
  }
};

/**
 * Sanitize user input to prevent injection attacks
 */
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    // Remove potentially dangerous characters
    return input
      .replace(/[<>]/g, '')
      .replace(/javascript:/gi, '')
      .trim();
  }
  return input;
};

/**
 * Rate limiting for tool calls
 */
class ToolRateLimiter {
  constructor(maxRequestsPerMinute = 60) {
    this.requests = new Map();
    this.maxRequests = maxRequestsPerMinute;
    this.windowMs = 60000; // 1 minute
  }

  isAllowed(toolName, clientId = 'default') {
    const key = `${clientId}:${toolName}`;
    const now = Date.now();
    
    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }
    
    const timestamps = this.requests.get(key);
    
    // Remove old timestamps
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    
    if (validTimestamps.length >= this.maxRequests) {
      return false;
    }
    
    validTimestamps.push(now);
    this.requests.set(key, validTimestamps);
    
    return true;
  }

  getRemainingRequests(toolName, clientId = 'default') {
    const key = `${clientId}:${toolName}`;
    const now = Date.now();
    
    if (!this.requests.has(key)) {
      return this.maxRequests;
    }
    
    const timestamps = this.requests.get(key);
    const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);
    
    return Math.max(0, this.maxRequests - validTimestamps.length);
  }
}

/**
 * Tool call metrics tracking
 */
class ToolMetrics {
  constructor() {
    this.metrics = new Map();
  }

  record(toolName, duration, success) {
    if (!this.metrics.has(toolName)) {
      this.metrics.set(toolName, {
        calls: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        avgDuration: 0,
        lastCalled: null
      });
    }

    const metric = this.metrics.get(toolName);
    metric.calls++;
    metric.totalDuration += duration;
    metric.avgDuration = metric.totalDuration / metric.calls;
    metric.lastCalled = new Date();

    if (success) {
      metric.successes++;
    } else {
      metric.failures++;
    }
  }

  getMetrics(toolName) {
    return this.metrics.get(toolName) || null;
  }

  getAllMetrics() {
    const result = {};
    this.metrics.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
}

// Singleton instances
const rateLimiter = new ToolRateLimiter();
const toolMetrics = new ToolMetrics();

/**
 * Create a tool handler with all middleware
 */
const createToolHandler = (toolName, handler, options = {}) => {
  const { rateLimit = true, validate = true, sanitize = true } = options;

  return async (args) => {
    const startTime = Date.now();
    let success = true;

    try {
      // Rate limiting
      if (rateLimit && !rateLimiter.isAllowed(toolName)) {
        throw new Error(`Rate limit exceeded for tool: ${toolName}`);
      }

      // Sanitize inputs
      if (sanitize && typeof args === 'object') {
        Object.keys(args).forEach(key => {
          args[key] = sanitizeInput(args[key]);
        });
      }

      // Execute handler
      const result = await handler(args);

      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      // Record metrics
      const duration = Date.now() - startTime;
      toolMetrics.record(toolName, duration, success);
    }
  };
};

module.exports = {
  wrapHandler,
  validateArgs,
  sanitizeInput,
  ToolRateLimiter,
  ToolMetrics,
  rateLimiter,
  toolMetrics,
  createToolHandler
};





