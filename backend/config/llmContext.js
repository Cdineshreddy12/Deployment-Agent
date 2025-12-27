const logger = require('../utils/logger');

/**
 * LLM Context Configuration
 * Configuration for context management and compression
 */
const llmContextConfig = {
  contextWindow: {
    recentMessages: parseInt(process.env.CONTEXT_WINDOW_RECENT_MESSAGES) || 15,
    summaryThreshold: parseInt(process.env.CONTEXT_SUMMARY_THRESHOLD) || 20,
    maxSummaryTokens: parseInt(process.env.CONTEXT_MAX_SUMMARY_TOKENS) || 500,
  },
  summarization: {
    enabled: process.env.ENABLE_CONTEXT_COMPRESSION !== 'false',
    model: process.env.SUMMARIZATION_MODEL || 'claude-haiku-3-20240307',
    maxTokens: parseInt(process.env.SUMMARIZATION_MAX_TOKENS) || 500,
    batchSize: parseInt(process.env.SUMMARIZATION_BATCH_SIZE) || 50
  },
  deploymentContext: {
    includeStatusHistory: process.env.DEPLOYMENT_CONTEXT_STATUS_HISTORY !== 'false',
    maxStatusEntries: parseInt(process.env.DEPLOYMENT_CONTEXT_MAX_STATUS_ENTRIES) || 10,
    includeKeyDecisions: process.env.DEPLOYMENT_CONTEXT_KEY_DECISIONS !== 'false',
    includeErrors: process.env.DEPLOYMENT_CONTEXT_ERRORS !== 'false'
  },
  systemPrompt: {
    useShortVersion: process.env.USE_SHORT_SYSTEM_PROMPT !== 'false',
    useFullVersionFor: ['terraform_generation']
  },
  costTracking: {
    enabled: process.env.ENABLE_COST_TRACKING !== 'false',
    logCompressionRatio: process.env.LOG_COMPRESSION_RATIO !== 'false'
  }
};

/**
 * Get context window size
 */
const getContextWindowSize = () => {
  return llmContextConfig.contextWindow.recentMessages;
};

/**
 * Get summary threshold
 */
const getSummaryThreshold = () => {
  return llmContextConfig.contextWindow.summaryThreshold;
};

/**
 * Check if summarization is enabled
 */
const isSummarizationEnabled = () => {
  return llmContextConfig.summarization.enabled;
};

/**
 * Get summarization model
 */
const getSummarizationModel = () => {
  return llmContextConfig.summarization.model;
};

/**
 * Should use short system prompt
 */
const shouldUseShortPrompt = (operationType = 'chat') => {
  if (!llmContextConfig.systemPrompt.useShortVersion) {
    return false;
  }
  return !llmContextConfig.systemPrompt.useFullVersionFor.includes(operationType);
};

module.exports = {
  llmContextConfig,
  getContextWindowSize,
  getSummaryThreshold,
  isSummarizationEnabled,
  getSummarizationModel,
  shouldUseShortPrompt
};

