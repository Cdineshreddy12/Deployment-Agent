const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const apiKeySchema = new mongoose.Schema({
  keyId: {
    type: String,
    required: true
  },
  hashedKey: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastUsedAt: {
    type: Date
  },
  expiresAt: {
    type: Date
  }
});

const preferencesSchema = new mongoose.Schema({
  theme: {
    type: String,
    enum: ['light', 'dark'],
    default: 'dark'
  },
  notifications: {
    email: {
      type: Boolean,
      default: true
    },
    slack: {
      type: Boolean,
      default: true
    },
    deploymentUpdates: {
      type: Boolean,
      default: true
    },
    approvalRequests: {
      type: Boolean,
      default: true
    }
  },
  defaultEnvironment: {
    type: String,
    enum: ['development', 'staging', 'production'],
    default: 'staging'
  }
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['admin', 'developer', 'tech_lead', 'viewer', 'devops'],
    default: 'developer'
  },
  department: {
    type: String
  },
  team: {
    type: String
  },
  passwordHash: {
    type: String
  },
  ssoId: {
    type: String,
    sparse: true
  },
  apiKeys: [apiKeySchema],
  preferences: {
    type: preferencesSchema,
    default: () => ({})
  },
  lastLoginAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
// Note: email index is created automatically by unique: true in schema
userSchema.index({ ssoId: 1 }, { unique: true, sparse: true });
userSchema.index({ role: 1 });
// Sparse unique index for API keys (only indexes documents that have apiKeys)
// Note: Uniqueness is enforced at application level since MongoDB sparse indexes
// don't prevent duplicate null values across different documents
userSchema.index({ 'apiKeys.keyId': 1 }, { unique: true, sparse: true });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) {
    return next();
  }
  
  if (this.passwordHash) {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
  }
  
  next();
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.passwordHash) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Method to generate API key
userSchema.methods.generateApiKey = function(name = 'CLI Access') {
  const { v4: uuidv4 } = require('uuid');
  const crypto = require('crypto');
  
  const keyId = `dp_${uuidv4().replace(/-/g, '')}`;
  const plainKey = `${keyId}_${crypto.randomBytes(32).toString('hex')}`;
  const hashedKey = crypto.createHash('sha256').update(plainKey).digest('hex');
  
  this.apiKeys.push({
    keyId,
    hashedKey,
    name,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
  });
  
  return plainKey; // Return plain key only once
};

// Method to validate API key
userSchema.methods.validateApiKey = function(apiKey) {
  const crypto = require('crypto');
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  
  const key = this.apiKeys.find(k => k.hashedKey === hashedKey);
  
  if (!key) {
    return false;
  }
  
  // Check expiration
  if (key.expiresAt && key.expiresAt < new Date()) {
    return false;
  }
  
  // Update last used
  key.lastUsedAt = new Date();
  this.save();
  
  return true;
};

module.exports = mongoose.model('User', userSchema);

