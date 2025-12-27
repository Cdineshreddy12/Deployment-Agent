const mongoose = require('mongoose');

const codeAnalysisSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  repositoryUrl: {
    type: String
  },
  analysis: {
    databases: [{
      type: String
    }],
    storage: [{
      type: String
    }],
    messaging: [{
      type: String
    }],
    caching: [{
      type: String
    }],
    apis: [{
      type: String
    }],
    environmentVariables: [{
      type: String
    }],
    security: {
      ssl: {
        type: Boolean,
        default: false
      },
      encryption: {
        type: Boolean,
        default: false
      }
    }
  },
  filesAnalyzed: [{
    path: String,
    type: String,
    size: Number
  }],
  analyzedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
codeAnalysisSchema.index({ deploymentId: 1 });
codeAnalysisSchema.index({ repositoryUrl: 1 });
codeAnalysisSchema.index({ analyzedAt: -1 });

module.exports = mongoose.model('CodeAnalysis', codeAnalysisSchema);

