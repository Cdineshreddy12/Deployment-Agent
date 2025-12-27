const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true
  },
  identifier: {
    type: String,
    required: true
  },
  status: {
    type: String
  }
});

const testResultSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  passed: {
    type: Boolean,
    required: true
  },
  duration: {
    type: Number
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  }
});

const sandboxSchema = new mongoose.Schema({
  sandboxId: {
    type: String,
    required: true,
    unique: true
  },
  deploymentId: {
    type: String,
    required: true
  },
  awsAccountId: {
    type: String
  },
  region: {
    type: String,
    default: 'us-east-1'
  },
  vpcId: {
    type: String
  },
  resources: [resourceSchema],
  testStatus: {
    type: String,
    enum: ['pending', 'running', 'passed', 'failed'],
    default: 'pending'
  },
  testResults: {
    healthChecks: {
      passed: Boolean,
      duration: Number,
      details: mongoose.Schema.Types.Mixed
    },
    securityScan: {
      passed: Boolean,
      findings: [mongoose.Schema.Types.Mixed],
      duration: Number
    },
    performanceTest: {
      passed: Boolean,
      avgResponseTime: Number,
      p95ResponseTime: Number,
      duration: Number
    }
  },
  estimatedHourlyCost: {
    type: Number
  },
  actualCost: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  destroyedAt: {
    type: Date
  },
  autoDelete: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
// Note: sandboxId index is created automatically by unique: true in schema
sandboxSchema.index({ deploymentId: 1 });
sandboxSchema.index({ expiresAt: 1 });
sandboxSchema.index({ autoDelete: 1, destroyedAt: 1 });

// Generate sandboxId before saving
sandboxSchema.pre('save', async function(next) {
  if (!this.sandboxId) {
    const { v4: uuidv4 } = require('uuid');
    const shortId = uuidv4().split('-')[0];
    this.sandboxId = `sandbox-${shortId}`;
  }
  
  // Set default expiration (4 hours from now)
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
  }
  
  next();
});

// Check if sandbox is expired
sandboxSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

module.exports = mongoose.model('Sandbox', sandboxSchema);

