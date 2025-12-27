const mongoose = require('mongoose');

const deploymentEnvSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
    // Removed index: true to avoid conflict with compound unique index { deploymentId: 1, service: 1 }
  },
  service: {
    type: String,
    default: 'main',
    index: true
  },
  // Encrypted .env content (AES-256-GCM)
  encryptedContent: {
    type: String,
    required: true
  },
  // Store variable keys (not values) for quick reference
  variableKeys: [{
    type: String
  }],
  variableCount: {
    type: Number,
    default: 0
  },
  // Legacy fields for backward compatibility
  envVariables: {
    type: Map,
    of: String,
    default: new Map()
  },
  chatContext: {
    type: String
  },
  version: {
    type: Number,
    default: 1
  },
  history: [{
    version: Number,
    envVariables: Map,
    encryptedContent: String,
    updatedAt: Date,
    updatedBy: mongoose.Schema.Types.ObjectId
  }],
  // Reuse fields for Phase 4
  projectType: {
    type: String,
    index: true
  },
  templateName: {
    type: String
  },
  reusedFrom: {
    type: String, // deploymentId that this was reused from
    index: true
  },
  isReusable: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Compound unique index for deploymentId + service
deploymentEnvSchema.index({ deploymentId: 1, service: 1 }, { unique: true });

// Indexes
// Note: deploymentId index is created automatically by unique: true in schema
deploymentEnvSchema.index({ createdAt: -1 });

// Methods
deploymentEnvSchema.methods.addEnvVar = function(key, value) {
  // Save current version to history
  this.history.push({
    version: this.version,
    envVariables: new Map(this.envVariables),
    updatedAt: new Date()
  });
  
  this.envVariables.set(key, value);
  this.version += 1;
  return this.save();
};

deploymentEnvSchema.methods.removeEnvVar = function(key) {
  // Save current version to history
  this.history.push({
    version: this.version,
    envVariables: new Map(this.envVariables),
    updatedAt: new Date()
  });
  
  this.envVariables.delete(key);
  this.version += 1;
  return this.save();
};

deploymentEnvSchema.methods.toEnvString = function() {
  let envString = '';
  for (const [key, value] of this.envVariables.entries()) {
    envString += `${key}=${value}\n`;
  }
  return envString;
};

module.exports = mongoose.model('DeploymentEnv', deploymentEnvSchema);

