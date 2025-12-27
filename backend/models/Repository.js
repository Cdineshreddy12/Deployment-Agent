const mongoose = require('mongoose');

const repositorySchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    unique: true
  },
  owner: {
    type: String,
    required: true
  },
  repo: {
    type: String,
    required: true
  },
  defaultBranch: {
    type: String,
    default: 'main'
  },
  description: {
    type: String
  },
  language: {
    type: String
  },
  topics: [{
    type: String
  }],
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  connectedAt: {
    type: Date,
    default: Date.now
  },
  lastAnalyzedAt: {
    type: Date
  },
  analysisCache: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes
repositorySchema.index({ userId: 1 });
repositorySchema.index({ owner: 1, repo: 1 }, { unique: true });
// Note: url index is created automatically by unique: true in schema

module.exports = mongoose.model('Repository', repositorySchema);

