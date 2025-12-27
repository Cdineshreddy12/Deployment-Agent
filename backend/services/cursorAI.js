const { cursorAIConfig, getAIForOperation, getPromptTemplate, isCursorAIAvailable } = require('../config/cursorAI');
const logger = require('../utils/logger');

/**
 * Cursor AI Service
 * Wrapper for integrating with Cursor's built-in AI models
 * 
 * Note: This service is designed to work within the Cursor IDE environment.
 * When running outside of Cursor, it will fall back to Claude API.
 */
class CursorAIService {
  constructor() {
    this.requestCache = new Map();
    this.requestCount = { minute: 0, hour: 0 };
    this.lastReset = { minute: Date.now(), hour: Date.now() };
    this.usageStats = {
      totalRequests: 0,
      cachedResponses: 0,
      fallbacks: 0,
      errors: 0
    };
  }

  /**
   * Check if rate limit allows a new request
   */
  checkRateLimit() {
    const now = Date.now();
    const config = cursorAIConfig.rateLimiting;

    // Reset minute counter
    if (now - this.lastReset.minute > 60000) {
      this.requestCount.minute = 0;
      this.lastReset.minute = now;
    }

    // Reset hour counter
    if (now - this.lastReset.hour > 3600000) {
      this.requestCount.hour = 0;
      this.lastReset.hour = now;
    }

    if (config.enabled) {
      if (this.requestCount.minute >= config.maxRequestsPerMinute) {
        return { allowed: false, reason: 'minute_limit' };
      }
      if (this.requestCount.hour >= config.maxRequestsPerHour) {
        return { allowed: false, reason: 'hour_limit' };
      }
    }

    return { allowed: true };
  }

  /**
   * Get cached response if available
   */
  getCachedResponse(cacheKey) {
    if (!cursorAIConfig.caching.enabled) return null;

    const cached = this.requestCache.get(cacheKey);
    if (!cached) return null;

    const ttl = cursorAIConfig.caching.ttlSeconds * 1000;
    if (Date.now() - cached.timestamp > ttl) {
      this.requestCache.delete(cacheKey);
      return null;
    }

    this.usageStats.cachedResponses++;
    return cached.response;
  }

  /**
   * Cache a response
   */
  cacheResponse(cacheKey, response) {
    if (!cursorAIConfig.caching.enabled) return;

    this.requestCache.set(cacheKey, {
      response,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.requestCache.size > 1000) {
      const oldestKey = this.requestCache.keys().next().value;
      this.requestCache.delete(oldestKey);
    }
  }

  /**
   * Generate a cache key for a request
   */
  generateCacheKey(operation, params) {
    return `${operation}:${JSON.stringify(params)}`;
  }

  /**
   * Process a simple query using Cursor AI
   * @param {string} query - The user query
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} - AI response
   */
  async processQuery(query, context = {}) {
    const operation = 'simple_query';
    const startTime = Date.now();

    try {
      // Check cache
      const cacheKey = this.generateCacheKey(operation, { query, context });
      const cached = this.getCachedResponse(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }

      // Check rate limit
      const rateLimitCheck = this.checkRateLimit();
      if (!rateLimitCheck.allowed) {
        logger.warn('Cursor AI rate limit exceeded, falling back to Claude');
        return this.fallbackToClaude(query, context);
      }

      // Update counters
      this.requestCount.minute++;
      this.requestCount.hour++;
      this.usageStats.totalRequests++;

      // Simulate Cursor AI response (in real implementation, this would use Cursor's API)
      const response = await this.simulateCursorAI(query, context, operation);

      // Cache response
      if (cursorAIConfig.caching.cacheSimpleQueries) {
        this.cacheResponse(cacheKey, response);
      }

      const duration = Date.now() - startTime;
      logger.info(`Cursor AI query processed in ${duration}ms`);

      return {
        ...response,
        provider: 'cursor',
        duration
      };

    } catch (error) {
      this.usageStats.errors++;
      logger.error('Cursor AI query failed:', error);

      if (cursorAIConfig.fallback.enabled) {
        return this.fallbackToClaude(query, context);
      }

      throw error;
    }
  }

  /**
   * Analyze code using Cursor AI
   * @param {string} code - Code to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeCode(code, options = {}) {
    const operation = 'code_analysis';
    const startTime = Date.now();

    try {
      const rateLimitCheck = this.checkRateLimit();
      if (!rateLimitCheck.allowed) {
        return this.fallbackToClaude(code, { type: 'code_analysis', ...options });
      }

      this.requestCount.minute++;
      this.requestCount.hour++;
      this.usageStats.totalRequests++;

      const systemPrompt = getPromptTemplate('codeAnalysis');

      const response = await this.simulateCursorAI(code, {
        systemPrompt,
        analysisType: options.analysisType || 'general',
        ...options
      }, operation);

      const duration = Date.now() - startTime;

      return {
        analysis: response.content,
        projectType: response.projectType,
        framework: response.framework,
        dependencies: response.dependencies,
        suggestions: response.suggestions,
        provider: 'cursor',
        duration
      };

    } catch (error) {
      this.usageStats.errors++;
      logger.error('Cursor AI code analysis failed:', error);

      if (cursorAIConfig.fallback.enabled) {
        return this.fallbackToClaude(code, { type: 'code_analysis', ...options });
      }

      throw error;
    }
  }

  /**
   * Parse and analyze logs using Cursor AI
   * @param {Array} logs - Log entries to analyze
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeLogs(logs, options = {}) {
    const operation = 'log_parsing';
    const startTime = Date.now();

    try {
      const rateLimitCheck = this.checkRateLimit();
      if (!rateLimitCheck.allowed) {
        return this.fallbackToClaude(JSON.stringify(logs), { type: 'log_analysis', ...options });
      }

      this.requestCount.minute++;
      this.requestCount.hour++;
      this.usageStats.totalRequests++;

      const logText = logs.map(log => 
        `[${log.level}] ${log.timestamp}: ${log.message}`
      ).join('\n');

      const response = await this.simulateCursorAI(logText, {
        type: 'log_analysis',
        ...options
      }, operation);

      const duration = Date.now() - startTime;

      return {
        summary: response.summary,
        errors: response.errors || [],
        warnings: response.warnings || [],
        suggestions: response.suggestions || [],
        provider: 'cursor',
        duration
      };

    } catch (error) {
      this.usageStats.errors++;
      logger.error('Cursor AI log analysis failed:', error);

      if (cursorAIConfig.fallback.enabled) {
        return this.fallbackToClaude(JSON.stringify(logs), { type: 'log_analysis' });
      }

      throw error;
    }
  }

  /**
   * Get quick status summary using Cursor AI
   * @param {Object} deployment - Deployment data
   * @returns {Promise<Object>} - Status summary
   */
  async getStatusSummary(deployment) {
    const operation = 'status_check';
    const startTime = Date.now();

    try {
      const cacheKey = this.generateCacheKey(operation, { 
        deploymentId: deployment.deploymentId,
        status: deployment.status 
      });
      const cached = this.getCachedResponse(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }

      this.requestCount.minute++;
      this.requestCount.hour++;
      this.usageStats.totalRequests++;

      const response = await this.simulateCursorAI(
        JSON.stringify(deployment),
        { type: 'status_summary' },
        operation
      );

      this.cacheResponse(cacheKey, response);

      const duration = Date.now() - startTime;

      return {
        summary: response.summary,
        health: response.health,
        nextSteps: response.nextSteps,
        provider: 'cursor',
        duration
      };

    } catch (error) {
      this.usageStats.errors++;
      logger.error('Cursor AI status summary failed:', error);

      if (cursorAIConfig.fallback.enabled) {
        return this.fallbackToClaude(JSON.stringify(deployment), { type: 'status_summary' });
      }

      throw error;
    }
  }

  /**
   * Simulate Cursor AI response (placeholder for actual Cursor API integration)
   * In production, this would integrate with Cursor's actual AI API
   */
  async simulateCursorAI(input, context, operation) {
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Generate contextual response based on operation type
    switch (operation) {
      case 'simple_query':
        return {
          content: `Processed query: ${input.substring(0, 100)}...`,
          type: 'query_response'
        };

      case 'code_analysis':
        return {
          content: 'Code analysis completed',
          projectType: this.detectProjectType(input),
          framework: this.detectFramework(input),
          dependencies: [],
          suggestions: ['Consider adding tests', 'Add documentation']
        };

      case 'log_parsing':
        return {
          summary: 'Log analysis completed',
          errors: [],
          warnings: [],
          suggestions: ['Monitor for patterns']
        };

      case 'status_check':
        const deploymentData = JSON.parse(input);
        return {
          summary: `Deployment ${deploymentData.deploymentId} is in ${deploymentData.status} state`,
          health: deploymentData.status === 'DEPLOYED' ? 'healthy' : 'pending',
          nextSteps: this.getNextSteps(deploymentData.status)
        };

      default:
        return {
          content: 'Response generated',
          type: 'generic'
        };
    }
  }

  /**
   * Detect project type from code
   */
  detectProjectType(code) {
    if (code.includes('package.json') || code.includes('node_modules')) return 'nodejs';
    if (code.includes('requirements.txt') || code.includes('import ')) return 'python';
    if (code.includes('go.mod') || code.includes('func main()')) return 'golang';
    if (code.includes('Gemfile') || code.includes('Rails')) return 'ruby';
    if (code.includes('pom.xml') || code.includes('build.gradle')) return 'java';
    return 'unknown';
  }

  /**
   * Detect framework from code
   */
  detectFramework(code) {
    if (code.includes('react') || code.includes('React')) return 'React';
    if (code.includes('express')) return 'Express';
    if (code.includes('fastapi') || code.includes('FastAPI')) return 'FastAPI';
    if (code.includes('django') || code.includes('Django')) return 'Django';
    if (code.includes('flask') || code.includes('Flask')) return 'Flask';
    if (code.includes('nextjs') || code.includes('next/')) return 'Next.js';
    return null;
  }

  /**
   * Get next steps based on deployment status
   */
  getNextSteps(status) {
    const stepsMap = {
      'INITIATED': ['Provide repository URL', 'Configure environment'],
      'ANALYZING': ['Wait for analysis to complete'],
      'PLANNING': ['Review generated Terraform code'],
      'VALIDATING': ['Wait for validation'],
      'ESTIMATED': ['Review cost estimate', 'Approve deployment'],
      'DEPLOYING': ['Monitor deployment progress'],
      'DEPLOYED': ['Verify deployment', 'Run health checks'],
      'DEPLOYMENT_FAILED': ['Check logs', 'Fix issues', 'Retry deployment']
    };

    return stepsMap[status] || ['Check deployment status'];
  }

  /**
   * Fallback to Claude API
   */
  async fallbackToClaude(input, context) {
    this.usageStats.fallbacks++;
    logger.info('Falling back to Claude API');

    const claudeService = require('./claude');
    
    try {
      const response = await claudeService.chat({
        message: typeof input === 'string' ? input : JSON.stringify(input),
        context: context,
        deploymentId: context.deploymentId || 'fallback-query'
      });

      return {
        ...response,
        provider: 'claude',
        fallback: true
      };
    } catch (error) {
      logger.error('Claude fallback failed:', error);
      throw error;
    }
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return {
      ...this.usageStats,
      currentRateLimits: {
        minuteRemaining: cursorAIConfig.rateLimiting.maxRequestsPerMinute - this.requestCount.minute,
        hourRemaining: cursorAIConfig.rateLimiting.maxRequestsPerHour - this.requestCount.hour
      },
      cacheSize: this.requestCache.size
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.requestCache.clear();
    logger.info('Cursor AI cache cleared');
  }

  /**
   * Check if Cursor AI should be used for an operation
   */
  shouldUseCursorAI(operation) {
    if (!isCursorAIAvailable()) return false;

    const aiConfig = getAIForOperation(operation);
    return aiConfig.provider === 'cursor';
  }
}

// Singleton instance
const cursorAIService = new CursorAIService();

module.exports = cursorAIService;





