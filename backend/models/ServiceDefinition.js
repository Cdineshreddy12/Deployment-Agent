const mongoose = require('mongoose');

/**
 * Service Definition Model
 * Stores dynamic service definitions discovered or registered at runtime
 * No hardcoding - everything is stored in DB
 */
const serviceDefinitionSchema = new mongoose.Schema({
  serviceType: {
    type: String,
    required: true,
    unique: true
  },
  displayName: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  // Dynamic credential schema - no hardcoding
  credentialSchema: {
    type: mongoose.Schema.Types.Mixed,
    required: true
    // Example: {
    //   connectionString: { type: 'string', required: true, description: '...' },
    //   apiKey: { type: 'string', required: false, description: '...' }
    // }
  },
  // AI-generated connection test code template
  connectionTestCode: {
    language: {
      type: String,
      enum: ['javascript', 'python', 'bash'],
      default: 'javascript'
    },
    code: {
      type: String,
      required: true
    },
    generatedAt: Date,
    generatedBy: String // 'ai' or 'user'
  },
  // Terraform provider information (if applicable)
  terraformProvider: {
    name: String, // e.g., 'aws', 'postgresql', 'mongodbatlas'
    version: String,
    requiredConfig: mongoose.Schema.Types.Mixed
  },
  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Whether this service is active/available
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
serviceDefinitionSchema.index({ serviceType: 1, active: 1 });

module.exports = mongoose.model('ServiceDefinition', serviceDefinitionSchema);

