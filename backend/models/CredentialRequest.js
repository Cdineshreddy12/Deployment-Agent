const mongoose = require('mongoose');

const credentialRequestSchema = new mongoose.Schema({
  requestId: {
    type: String,
    required: true,
    unique: true,
    default: () => `cred_req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  },
  deploymentId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  serviceType: {
    type: String,
    required: true
  },
  schema: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'expired'],
    default: 'pending',
    index: true
  },
  requestedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  approvedAt: {
    type: Date
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
  },
  credentials: {
    type: mongoose.Schema.Types.Mixed // Encrypted credentials after approval
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
credentialRequestSchema.index({ deploymentId: 1, status: 1 });
credentialRequestSchema.index({ userId: 1, status: 1 });
credentialRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if request is expired
credentialRequestSchema.methods.isExpired = function() {
  return this.expiresAt && this.expiresAt < new Date();
};

// Method to approve request
credentialRequestSchema.methods.approve = function(credentials) {
  this.status = 'approved';
  this.approvedAt = new Date();
  this.credentials = credentials;
  return this.save();
};

// Method to reject request
credentialRequestSchema.methods.reject = function(reason) {
  this.status = 'rejected';
  this.metadata.rejectionReason = reason;
  return this.save();
};

module.exports = mongoose.model('CredentialRequest', credentialRequestSchema);

