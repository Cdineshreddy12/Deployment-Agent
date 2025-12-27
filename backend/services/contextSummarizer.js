const Anthropic = require('@anthropic-ai/sdk');
const Conversation = require('../models/Conversation');
const logger = require('../utils/logger');
const { 
  isSummarizationEnabled, 
  getSummarizationModel, 
  getSummaryThreshold,
  getContextWindowSize 
} = require('../config/llmContext');

/**
 * Context Summarization Service
 * Handles compression of conversation history to reduce token costs
 */
class ContextSummarizer {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });
  }

  /**
   * Check if conversation should be summarized
   */
  shouldSummarize(conversation, threshold = null) {
    if (!isSummarizationEnabled()) {
      return false;
    }

    const messageCount = conversation.messages.length;
    const thresholdToUse = threshold || getSummaryThreshold();
    
    // Don't summarize if we have fewer messages than threshold
    if (messageCount <= thresholdToUse) {
      return false;
    }

    // Check if we need to update summary (if message count increased significantly)
    const lastSummarizedAt = conversation.lastSummarizedAt;
    const messagesSinceSummary = lastSummarizedAt 
      ? conversation.messages.filter(m => new Date(m.timestamp) > lastSummarizedAt).length
      : messageCount;

    // Update summary if we have 10+ new messages since last summary
    return messagesSinceSummary >= 10 || !lastSummarizedAt;
  }

  /**
   * Summarize older messages
   */
  async summarizeMessages(messages, maxMessagesToKeep = null) {
    if (!isSummarizationEnabled()) {
      return { summary: '', recentMessages: messages };
    }

    const windowSize = maxMessagesToKeep || getContextWindowSize();
    
    // If we have fewer messages than window size, no need to summarize
    if (messages.length <= windowSize) {
      return {
        summary: '',
        recentMessages: messages,
        messagesSummarized: 0
      };
    }

    // Split messages into old (to summarize) and recent (to keep)
    const messagesToSummarize = messages.slice(0, messages.length - windowSize);
    const recentMessages = messages.slice(-windowSize);

    try {
      // Build prompt for summarization
      const messagesText = messagesToSummarize.map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return `${role}: ${content}`;
      }).join('\n\n');

      const summaryPrompt = `Summarize the following conversation history in a concise way. Focus on:
1. Key decisions made
2. Important information shared
3. Errors encountered and resolutions
4. Current state and progress

Keep the summary under 500 tokens. Be specific but concise.

Conversation history:
${messagesText}

Summary:`;

      const model = getSummarizationModel();
      const response = await this.client.messages.create({
        model: model,
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: summaryPrompt
        }]
      });

      const summary = response.content[0].text.trim();

      logger.info('Messages summarized', {
        messagesSummarized: messagesToSummarize.length,
        recentMessagesKept: recentMessages.length,
        summaryLength: summary.length,
        model
      });

      return {
        summary,
        recentMessages,
        messagesSummarized: messagesToSummarize.length
      };

    } catch (error) {
      logger.error('Failed to summarize messages:', error);
      // Fallback: return all messages if summarization fails
      return {
        summary: '',
        recentMessages: messages,
        messagesSummarized: 0,
        error: error.message
      };
    }
  }

  /**
   * Get compressed messages (recent + summary)
   */
  async getCompressedMessages(conversation, windowSize = null) {
    const windowSizeToUse = windowSize || conversation.contextWindowSize || getContextWindowSize();
    
    // If summarization is disabled, return all messages
    if (!isSummarizationEnabled()) {
      return {
        summaryMessages: [],
        recentMessages: conversation.messages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        compressionRatio: 1.0
      };
    }

    // Check if we need to summarize
    const needsSummarization = this.shouldSummarize(conversation);
    
    if (needsSummarization && conversation.messages.length > windowSizeToUse) {
      // Summarize old messages
      const result = await this.summarizeMessages(conversation.messages, windowSizeToUse);
      
      // Update conversation with summary
      if (result.summary) {
        conversation.summary = result.summary;
        conversation.summaryVersion = (conversation.summaryVersion || 0) + 1;
        conversation.lastSummarizedAt = new Date();
        await conversation.save();
      }

      // Build summary message if exists
      const summaryMessages = result.summary ? [{
        role: 'system',
        content: `Previous conversation summary (messages 1-${result.messagesSummarized}):\n\n${result.summary}`
      }] : [];

      // Calculate compression ratio
      const originalTokenEstimate = conversation.messages.length * 200; // Rough estimate
      const compressedTokenEstimate = (result.summary.length / 4) + (result.recentMessages.length * 200);
      const compressionRatio = originalTokenEstimate > 0 
        ? compressedTokenEstimate / originalTokenEstimate 
        : 1.0;

      return {
        summaryMessages,
        recentMessages: result.recentMessages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        compressionRatio: Math.min(compressionRatio, 1.0),
        messagesSummarized: result.messagesSummarized
      };
    }

    // Use existing summary if available
    if (conversation.summary && conversation.messages.length > windowSizeToUse) {
      const recentMessages = conversation.messages.slice(-windowSizeToUse);
      
      const summaryMessages = [{
        role: 'system',
        content: `Previous conversation summary:\n\n${conversation.summary}`
      }];

      return {
        summaryMessages,
        recentMessages: recentMessages.map(msg => ({
          role: msg.role,
          content: msg.content
        })),
        compressionRatio: 0.3, // Estimated compression
        messagesSummarized: conversation.messages.length - recentMessages.length
      };
    }

    // No compression needed, return all messages
    return {
      summaryMessages: [],
      recentMessages: conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      compressionRatio: 1.0
    };
  }

  /**
   * Update compression metrics in conversation
   */
  async updateCompressionMetrics(conversation, tokensBefore, tokensAfter) {
    if (!conversation) return;

    const compressionRatio = tokensBefore > 0 ? tokensAfter / tokensBefore : 1.0;
    
    conversation.tokensBeforeCompression = (conversation.tokensBeforeCompression || 0) + tokensBefore;
    conversation.tokensAfterCompression = (conversation.tokensAfterCompression || 0) + tokensAfter;
    conversation.compressionRatio = compressionRatio;

    await conversation.save();

    logger.info('Compression metrics updated', {
      deploymentId: conversation.deploymentId,
      tokensBefore,
      tokensAfter,
      compressionRatio: (compressionRatio * 100).toFixed(2) + '%',
      costSavings: ((1 - compressionRatio) * 100).toFixed(2) + '%'
    });
  }
}

// Singleton instance
const contextSummarizer = new ContextSummarizer();

module.exports = contextSummarizer;

