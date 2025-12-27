const mongoose = require('mongoose');

const serviceConfigSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  serviceType: {
    type: String,
    required: true,
    enum: ['aws', 'supabase', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'kibana', 'azure', 'gcp', 'other']
  },
  serviceName: {
    type: String,
    required: true
  },
  credentials: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  // Encrypted credentials (for production)
  encryptedCredentials: {
    type: String
  },
  validated: {
    type: Boolean,
    default: false
  },
  validatedAt: {
    type: Date
  },
  sandboxTested: {
    type: Boolean,
    default: false
  },
  sandboxTestedAt: {
    type: Date
  },
  terraformProviderConfig: {
    type: mongoose.Schema.Types.Mixed
  },
  environment: {
    type: String,
    enum: ['sandbox', 'staging', 'production'],
    default: 'sandbox'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
serviceConfigSchema.index({ deploymentId: 1, serviceType: 1 });
serviceConfigSchema.index({ validated: 1 });
serviceConfigSchema.index({ sandboxTested: 1 });

module.exports = mongoose.model('ServiceConfig', serviceConfigSchema);

