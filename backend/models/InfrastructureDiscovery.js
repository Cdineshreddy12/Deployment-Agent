const mongoose = require('mongoose');

const infrastructureDiscoverySchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  region: {
    type: String,
    required: true
  },
  providers: {
    type: mongoose.Schema.Types.Mixed
  },
  resources: {
    networking: [{
      type: {
        type: String
      },
      provider: String,
      id: String,
      cidr: String,
      vpcId: String
    }],
    compute: [{
      type: {
        type: String
      },
      provider: String,
      id: String,
      instanceType: String,
      state: String
    }],
    databases: [{
      type: {
        type: String
      },
      provider: String,
      id: String,
      engine: String,
      status: String
    }],
    storage: [{
      type: {
        type: String
      },
      provider: String,
      name: String
    }],
    loadBalancers: [{
      type: {
        type: String
      },
      provider: String,
      id: String,
      scheme: String
    }],
    security: [{
      type: {
        type: String
      },
      provider: String,
      id: String,
      name: String
    }]
  },
  recommendations: {
    reuse: [{
      type: {
        type: String
      },
      reason: String,
      resources: [mongoose.Schema.Types.Mixed]
    }],
    create: [{
      type: {
        type: String
      },
      reason: String
    }]
  },
  discoveredAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
infrastructureDiscoverySchema.index({ deploymentId: 1 });
infrastructureDiscoverySchema.index({ region: 1 });
infrastructureDiscoverySchema.index({ discoveredAt: -1 });

module.exports = mongoose.model('InfrastructureDiscovery', infrastructureDiscoverySchema);

