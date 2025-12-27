const mongoose = require('mongoose');
const crypto = require('crypto');

const globalCredentialSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  serviceType: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  credentials: {
    type: Buffer, // Encrypted credentials
    required: true
  },
  credentialsIV: {
    type: Buffer, // Initialization vector for encryption
    required: true
  },
  tags: [{
    type: String
  }],
  reusable: {
    type: Boolean,
    default: true
  },
  sharedWith: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  description: {
    type: String
  },
  lastUsedAt: {
    type: Date
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Indexes
globalCredentialSchema.index({ userId: 1, serviceType: 1 });
globalCredentialSchema.index({ reusable: 1 });
globalCredentialSchema.index({ tags: 1 });

// Encryption key from environment (should be set)
const getEncryptionKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY not set in environment');
  }
  // Convert hex string to buffer
  return Buffer.from(key, 'hex');
};

// Methods
globalCredentialSchema.methods.encryptCredentials = function(credentials) {
  const algorithm = 'aes-256-cbc';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(JSON.stringify(credentials), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  this.credentials = Buffer.from(encrypted, 'hex');
  this.credentialsIV = iv;
  return this;
};

globalCredentialSchema.methods.decryptCredentials = function() {
  const algorithm = 'aes-256-cbc';
  const key = getEncryptionKey();
  const iv = this.credentialsIV;
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(this.credentials, null, 'utf8');
  decrypted += decipher.final('utf8');
  
  return JSON.parse(decrypted);
};

globalCredentialSchema.methods.markUsed = function() {
  this.lastUsedAt = new Date();
  this.usageCount += 1;
  return this.save();
};

// Pre-save hook to encrypt credentials if they're plain objects
globalCredentialSchema.pre('save', function(next) {
  if (this.isModified('credentials') && !Buffer.isBuffer(this.credentials)) {
    this.encryptCredentials(this.credentials);
  }
  next();
});

module.exports = mongoose.model('GlobalCredential', globalCredentialSchema);

