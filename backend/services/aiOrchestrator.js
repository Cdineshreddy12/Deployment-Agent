const cursorAIService = require('./cursorAI');
const claudeService = require('./claude');
const { cursorAIConfig, getAIForOperation } = require('../config/cursorAI');
const logger = require('../utils/logger');

/**
 * AI Orchestrator Service
 * Manages the hybrid AI system, deciding between Cursor AI and Claude API
 * based on operation type, availability, and performance requirements
 */
class AIOrchestrator {
  constructor() {
    this.operationHistory = [];
    this.performanceMetrics = {
      cursor: { totalTime: 0, count: 0, errors: 0 },
      claude: { totalTime: 0, count: 0, errors: 0 }
    };
  }

  /**
   * Process an AI request, automatically choosing the best provider
   * @param {Object} request - The AI request
   * @returns {Promise<Object>} - AI response
   */
  async process(request) {
    const { operation, input, context = {}, options = {} } = request;
    const startTime = Date.now();

    // Determine which AI to use
    const aiConfig = this.selectAI(operation, options);
    logger.info(`AI Orchestrator: Using ${aiConfig.provider} for ${operation}`, { reason: aiConfig.reason });

    let response;
    let provider = aiConfig.provider;

    try {
      if (provider === 'cursor') {
        response = await this.processCursor(operation, input, context);
      } else {
        response = await this.processClaude(operation, input, context);
      }

      // Record success metrics
      const duration = Date.now() - startTime;
      this.recordMetrics(provider, duration, true);
      this.recordOperation(operation, provider, duration, true);

      return {
        ...response,
        orchestrator: {
          provider,
          operation,
          duration,
          reason: aiConfig.reason
        }
      };

    } catch (error) {
      logger.error(`AI Orchestrator: ${provider} failed for ${operation}`, error);
      
      // Record failure metrics
      const duration = Date.now() - startTime;
      this.recordMetrics(provider, duration, false);

      // Try fallback if enabled and we used Cursor
      if (provider === 'cursor' && cursorAIConfig.fallback.enabled) {
        logger.info('AI Orchestrator: Attempting fallback to Claude');
        try {
          response = await this.processClaude(operation, input, context);
          
          const fallbackDuration = Date.now() - startTime;
          this.recordMetrics('claude', fallbackDuration - duration, true);
          this.recordOperation(operation, 'claude', fallbackDuration, true, true);

          return {
            ...response,
            orchestrator: {
              provider: 'claude',
              operation,
              duration: fallbackDuration,
              reason: 'Fallback after Cursor AI failure',
              fallback: true
            }
          };
        } catch (fallbackError) {
          logger.error('AI Orchestrator: Fallback to Claude also failed', fallbackError);
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  /**
   * Select which AI provider to use
   */
  selectAI(operation, options = {}) {
    // Check if forced provider is specified
    if (options.forceProvider) {
      return {
        provider: options.forceProvider,
        reason: 'Forced by request options'
      };
    }

    // Get default AI for operation type
    const defaultAI = getAIForOperation(operation);

    // Check if Cursor AI is available
    if (defaultAI.provider === 'cursor' && !cursorAIService.shouldUseCursorAI(operation)) {
      return {
        provider: 'claude',
        reason: 'Cursor AI not available'
      };
    }

    // Check Cursor AI rate limits
    if (defaultAI.provider === 'cursor') {
      const rateLimitCheck = cursorAIService.checkRateLimit();
      if (!rateLimitCheck.allowed) {
        return {
          provider: 'claude',
          reason: `Cursor AI rate limited: ${rateLimitCheck.reason}`
        };
      }
    }

    return defaultAI;
  }

  /**
   * Process request with Cursor AI
   */
  async processCursor(operation, input, context) {
    switch (operation) {
      case 'simple_query':
      case 'list_deployments':
        return cursorAIService.processQuery(input, context);

      case 'code_analysis':
        return cursorAIService.analyzeCode(input, context);

      case 'log_parsing':
        return cursorAIService.analyzeLogs(input, context);

      case 'status_check':
        return cursorAIService.getStatusSummary(input);

      default:
        return cursorAIService.processQuery(input, context);
    }
  }

  /**
   * Process request with Claude API
   */
  async processClaude(operation, input, context) {
    switch (operation) {
      case 'terraform_generation':
        return claudeService.generateTerraformCode({
          requirements: input,
          ...context
        });

      case 'infrastructure_planning':
        return claudeService.analyzeAndPlanInfrastructure({
          requirements: input,
          ...context
        });

      case 'cost_estimation':
        return claudeService.estimateCostWithReasoning({
          terraformCode: input,
          ...context
        });

      case 'security_analysis':
        return claudeService.analyzeSecurityIssues({
          code: input,
          ...context
        });

      default:
        return claudeService.chat({
          message: typeof input === 'string' ? input : JSON.stringify(input),
          context,
          deploymentId: context.deploymentId || 'orchestrator-request'
        });
    }
  }

  /**
   * Chat with automatic AI selection
   */
  async chat(message, options = {}) {
    // Analyze message to determine complexity
    const complexity = this.analyzeComplexity(message);
    
    const operation = complexity === 'complex' ? 'multi_step_reasoning' : 'simple_query';

    return this.process({
      operation,
      input: message,
      context: options.context || {},
      options
    });
  }

  /**
   * Generate Terraform code (always uses Claude for complexity)
   */
  async generateTerraform(requirements, options = {}) {
    return this.process({
      operation: 'terraform_generation',
      input: requirements,
      context: options,
      options: { forceProvider: 'claude' } // Always use Claude for Terraform
    });
  }

  /**
   * Analyze code (uses Cursor AI for quick analysis)
   */
  async analyzeCode(code, options = {}) {
    return this.process({
      operation: 'code_analysis',
      input: code,
      context: options
    });
  }

  /**
   * Parse and analyze logs (uses Cursor AI)
   */
  async analyzeLogs(logs, options = {}) {
    return this.process({
      operation: 'log_parsing',
      input: logs,
      context: options
    });
  }

  /**
   * Get deployment status summary (uses Cursor AI)
   */
  async getStatusSummary(deployment, options = {}) {
    return this.process({
      operation: 'status_check',
      input: deployment,
      context: options
    });
  }

  /**
   * Analyze security issues (uses Claude for thoroughness)
   */
  async analyzeSecurityIssues(code, options = {}) {
    return this.process({
      operation: 'security_analysis',
      input: code,
      context: options,
      options: { forceProvider: 'claude' }
    });
  }

  /**
   * Estimate costs with reasoning (uses Claude)
   */
  async estimateCost(terraformCode, options = {}) {
    return this.process({
      operation: 'cost_estimation',
      input: terraformCode,
      context: options,
      options: { forceProvider: 'claude' }
    });
  }

  /**
   * Analyze message complexity
   */
  analyzeComplexity(message) {
    const complexIndicators = [
      'terraform', 'infrastructure', 'deploy', 'create',
      'generate', 'estimate', 'security', 'analyze',
      'multi-step', 'plan', 'design'
    ];

    const simpleIndicators = [
      'status', 'list', 'show', 'get', 'what is',
      'check', 'logs', 'help', 'how'
    ];

    const lowerMessage = message.toLowerCase();
    
    const complexScore = complexIndicators.filter(i => lowerMessage.includes(i)).length;
    const simpleScore = simpleIndicators.filter(i => lowerMessage.includes(i)).length;

    // Also check message length
    if (message.length > 500) return 'complex';
    if (message.length < 50 && simpleScore > 0) return 'simple';

    return complexScore > simpleScore ? 'complex' : 'simple';
  }

  /**
   * Record performance metrics
   */
  recordMetrics(provider, duration, success) {
    const metrics = this.performanceMetrics[provider];
    if (metrics) {
      metrics.count++;
      metrics.totalTime += duration;
      if (!success) metrics.errors++;
    }
  }

  /**
   * Record operation for history
   */
  recordOperation(operation, provider, duration, success, fallback = false) {
    this.operationHistory.push({
      operation,
      provider,
      duration,
      success,
      fallback,
      timestamp: new Date()
    });

    // Keep only last 1000 operations
    if (this.operationHistory.length > 1000) {
      this.operationHistory = this.operationHistory.slice(-1000);
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    const cursorStats = cursorAIService.getUsageStats();

    return {
      cursor: {
        ...this.performanceMetrics.cursor,
        avgDuration: this.performanceMetrics.cursor.count > 0 
          ? this.performanceMetrics.cursor.totalTime / this.performanceMetrics.cursor.count 
          : 0,
        ...cursorStats
      },
      claude: {
        ...this.performanceMetrics.claude,
        avgDuration: this.performanceMetrics.claude.count > 0 
          ? this.performanceMetrics.claude.totalTime / this.performanceMetrics.claude.count 
          : 0
      },
      recentOperations: this.operationHistory.slice(-20),
      operationCounts: this.getOperationCounts()
    };
  }

  /**
   * Get operation counts by type
   */
  getOperationCounts() {
    return this.operationHistory.reduce((acc, op) => {
      if (!acc[op.operation]) {
        acc[op.operation] = { cursor: 0, claude: 0 };
      }
      acc[op.operation][op.provider]++;
      return acc;
    }, {});
  }

  /**
   * Get recommendations for AI usage optimization
   */
  getOptimizationRecommendations() {
    const recommendations = [];
    const stats = this.getStats();

    // Check if Cursor AI is underutilized
    if (stats.cursor.count < stats.claude.count * 0.3) {
      recommendations.push({
        type: 'utilization',
        message: 'Cursor AI is underutilized. Consider using it for more simple queries.',
        priority: 'medium'
      });
    }

    // Check if there are many fallbacks
    if (stats.cursor.fallbacks > stats.cursor.totalRequests * 0.2) {
      recommendations.push({
        type: 'reliability',
        message: 'High fallback rate for Cursor AI. Check rate limits and availability.',
        priority: 'high'
      });
    }

    // Check if Claude is being used for simple operations
    const simpleOps = ['simple_query', 'status_check', 'list_deployments'];
    const claudeSimpleOps = this.operationHistory.filter(
      op => simpleOps.includes(op.operation) && op.provider === 'claude'
    ).length;
    
    if (claudeSimpleOps > 10) {
      recommendations.push({
        type: 'cost',
        message: 'Claude API is being used for simple operations. Consider using Cursor AI instead.',
        priority: 'medium'
      });
    }

    return recommendations;
  }
}

// Singleton instance
const aiOrchestrator = new AIOrchestrator();

module.exports = aiOrchestrator;





