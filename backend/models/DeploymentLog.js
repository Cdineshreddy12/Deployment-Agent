const mongoose = require('mongoose');

const deploymentLogSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  level: {
    type: String,
    enum: ['info', 'warn', 'error', 'debug'],
    default: 'info'
  },
  message: {
    type: String,
    required: true
  },
  source: {
    type: String,
    enum: ['cli', 'terraform', 'docker', 'github', 'aws', 'system'],
    default: 'cli'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: false // Use custom timestamp field
});

// Indexes
deploymentLogSchema.index({ deploymentId: 1, timestamp: -1 });
deploymentLogSchema.index({ level: 1 });
deploymentLogSchema.index({ source: 1 });

module.exports = mongoose.model('DeploymentLog', deploymentLogSchema);





