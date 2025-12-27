const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  toolCalls: [{
    tool: String,
    parameters: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    timestamp: Date
  }]
});

const tokensUsedSchema = new mongoose.Schema({
  input: {
    type: Number,
    default: 0
  },
  output: {
    type: Number,
    default: 0
  },
  total: {
    type: Number,
    default: 0
  }
});

const conversationSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  messages: [messageSchema],
  tokensUsed: {
    type: tokensUsedSchema,
    default: () => ({ input: 0, output: 0, total: 0 })
  },
  mcpToolCalls: [{
    tool: String,
    operation: String,
    timestamp: Date,
    duration: Number,
    success: Boolean
  }],
  // Context compression fields
  summary: {
    type: String,
    default: ''
  },
  summaryVersion: {
    type: Number,
    default: 0
  },
  lastSummarizedAt: {
    type: Date
  },
  contextWindowSize: {
    type: Number,
    default: 15
  },
  // Cost tracking fields
  tokensBeforeCompression: {
    type: Number,
    default: 0
  },
  tokensAfterCompression: {
    type: Number,
    default: 0
  },
  compressionRatio: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
// Note: deploymentId index is created automatically by unique: true in schema
conversationSchema.index({ userId: 1, createdAt: -1 });

// Update total tokens
conversationSchema.methods.updateTokens = function(inputTokens, outputTokens) {
  this.tokensUsed.input += inputTokens;
  this.tokensUsed.output += outputTokens;
  this.tokensUsed.total = this.tokensUsed.input + this.tokensUsed.output;
};

module.exports = mongoose.model('Conversation', conversationSchema);

