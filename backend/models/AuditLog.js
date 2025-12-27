const mongoose = require('mongoose');
const crypto = require('crypto');

const auditLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  userId: {
    type: String,
    required: true
  },
  userEmail: {
    type: String,
    required: true
  },
  action: {
    type: String,
    required: true
  },
  resourceType: {
    type: String,
    required: true
  },
  resourceId: {
    type: String
  },
  previousState: {
    type: mongoose.Schema.Types.Mixed
  },
  newState: {
    type: mongoose.Schema.Types.Mixed
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  sessionId: {
    type: String
  },
  hash: {
    type: String,
    required: false, // Will be set by pre-save hook
    sparse: true // Allow null values temporarily
  },
  previousHash: {
    type: String
  }
}, {
  timestamps: false // Don't use mongoose timestamps, we use our own timestamp field
});

// Indexes
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ userId: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1 });
auditLogSchema.index({ hash: 1 }, { unique: true, sparse: true });

// Generate hash before saving - ALWAYS generate hash
auditLogSchema.pre('save', async function(next) {
  try {
    // Ensure timestamp is set
    if (!this.timestamp) {
      this.timestamp = new Date();
    }
    
    // Get previous hash for chaining (only if hash not already set)
    if (!this.hash) {
      try {
        const previousLog = await this.constructor
          .findOne({ userId: this.userId })
          .sort({ timestamp: -1 })
          .limit(1)
          .lean(); // Use lean() for better performance
        
        if (previousLog && previousLog.hash) {
          this.previousHash = previousLog.hash;
        }
      } catch (err) {
        // If query fails, continue without previous hash
        // This allows the log to be created even if there's a DB issue
      }
    }
    
    // Always generate hash (even if one exists, regenerate for consistency)
    const hashData = JSON.stringify({
      timestamp: this.timestamp,
      userId: this.userId,
      action: this.action,
      resourceType: this.resourceType,
      resourceId: this.resourceId || '',
      previousHash: this.previousHash || ''
    });
    
    this.hash = crypto.createHash('sha256').update(hashData).digest('hex');
    
    next();
  } catch (error) {
    next(error);
  }
});

// Prevent updates and deletes (immutable logs)
auditLogSchema.pre(['updateOne', 'findOneAndUpdate', 'updateMany'], function() {
  throw new Error('Audit logs are immutable and cannot be updated');
});

auditLogSchema.pre(['deleteOne', 'findOneAndDelete', 'deleteMany'], function() {
  throw new Error('Audit logs are immutable and cannot be deleted');
});

module.exports = mongoose.model('AuditLog', auditLogSchema);

