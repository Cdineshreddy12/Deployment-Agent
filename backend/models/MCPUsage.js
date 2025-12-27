const mongoose = require('mongoose');

const mcpUsageSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  toolName: {
    type: String,
    required: true
  },
  serverName: {
    type: String,
    enum: ['terraform', 'aws', 'github', 'docker', 'unknown'],
    default: 'unknown'
  },
  input: {
    type: mongoose.Schema.Types.Mixed
  },
  result: {
    type: mongoose.Schema.Types.Mixed
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  latency: {
    type: Number // milliseconds
  },
  success: {
    type: Boolean,
    default: true
  },
  error: {
    type: String
  },
  fallback: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Indexes
mcpUsageSchema.index({ deploymentId: 1, timestamp: -1 });
mcpUsageSchema.index({ toolName: 1, timestamp: -1 });
mcpUsageSchema.index({ serverName: 1, timestamp: -1 });
mcpUsageSchema.index({ success: 1, timestamp: -1 });

// Static methods for analytics
mcpUsageSchema.statics.getToolStats = async function(startDate, endDate) {
  const match = {};
  if (startDate || endDate) {
    match.timestamp = {};
    if (startDate) match.timestamp.$gte = startDate;
    if (endDate) match.timestamp.$lte = endDate;
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: { server: '$serverName', tool: '$toolName' },
        total: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        failed: { $sum: { $cond: ['$success', 0, 1] } },
        avgLatency: { $avg: '$latency' },
        fallbackCount: { $sum: { $cond: ['$fallback', 1, 0] } }
      }
    },
    { $sort: { total: -1 } }
  ]);
};

mcpUsageSchema.statics.getServerStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$serverName',
        total: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        failed: { $sum: { $cond: ['$success', 0, 1] } },
        avgLatency: { $avg: '$latency' }
      }
    },
    { $sort: { total: -1 } }
  ]);
};

mcpUsageSchema.statics.getDeploymentUsage = async function(deploymentId) {
  return this.aggregate([
    { $match: { deploymentId } },
    {
      $group: {
        _id: '$toolName',
        count: { $sum: 1 },
        successful: { $sum: { $cond: ['$success', 1, 0] } },
        failed: { $sum: { $cond: ['$success', 0, 1] } },
        avgLatency: { $avg: '$latency' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('MCPUsage', mcpUsageSchema);

