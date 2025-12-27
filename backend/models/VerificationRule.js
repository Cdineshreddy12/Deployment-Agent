const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * Verification Rule Schema
 * Defines rules for verifying generated files
 */
const verificationRuleSchema = new mongoose.Schema({
  ruleId: {
    type: String,
    required: true,
    unique: true,
    default: () => `rule_${uuidv4().replace(/-/g, '')}`
  },
  name: {
    type: String,
    required: true,
    index: true
  },
  fileType: {
    type: String,
    enum: ['dockerfile', 'docker-compose', 'config', 'iac', 'other'],
    required: true,
    index: true
  },
  ruleType: {
    type: String,
    enum: ['syntax', 'semantic', 'security', 'best_practice', 'custom'],
    required: true
  },
  severity: {
    type: String,
    enum: ['error', 'warning', 'info'],
    default: 'error'
  },
  pattern: {
    type: String, // Regex pattern or command to run
    required: true
  },
  command: {
    type: String, // Command to execute for verification
    required: false
  },
  expectedResult: {
    type: mongoose.Schema.Types.Mixed // Expected command output or pattern match
  },
  description: {
    type: String,
    required: true
  },
  fixSuggestion: {
    type: String
  },
  enabled: {
    type: Boolean,
    default: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
verificationRuleSchema.index({ fileType: 1, ruleType: 1, enabled: 1 });
verificationRuleSchema.index({ severity: 1 });
verificationRuleSchema.index({ usageCount: -1 });

// Methods
verificationRuleSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  return this.save();
};

verificationRuleSchema.methods.matches = function(content) {
  if (this.ruleType === 'syntax' || this.ruleType === 'semantic' || this.ruleType === 'best_practice') {
    // Pattern-based matching
    const regex = new RegExp(this.pattern, 'gm');
    return regex.test(content);
  }
  return false;
};

const VerificationRule = mongoose.model('VerificationRule', verificationRuleSchema);

module.exports = VerificationRule;

