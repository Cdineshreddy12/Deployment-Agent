const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Deployment Credentials Model
 * Stores encrypted credentials for various deployment platforms
 */
const deploymentCredentialSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  platform: {
    type: String,
    enum: ['aws', 'gcp', 'azure', 'kubernetes', 'docker', 'ssh', 'generic'],
    required: true
  },
  type: {
    type: String,
    enum: ['env-file', 'ssh-key', 'kubeconfig', 'aws-credentials', 'terraform-vars', 'custom'],
    required: true
  },
  // Encrypted credential data
  encryptedData: {
    type: String,
    required: true
  },
  // IV for encryption
  iv: {
    type: String,
    required: true
  },
  // Metadata (non-sensitive)
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Parsed .env variables (for env-file type)
  parsedEnvVars: {
    type: Map,
    of: String,
    default: new Map()
  },
  // Tags for organization
  tags: {
    type: [String],
    default: []
  },
  // Active flag
  active: {
    type: Boolean,
    default: true
  },
  // Last used timestamp
  lastUsed: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for quick lookup
deploymentCredentialSchema.index({ userId: 1, platform: 1, active: 1 });
deploymentCredentialSchema.index({ userId: 1, name: 1 });

/**
 * Encrypt credential data
 */
deploymentCredentialSchema.methods.encryptData = function(data) {
  const algorithm = 'aes-256-gcm';
  const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32-chars!!', 'utf8').slice(0, 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
};

/**
 * Decrypt credential data
 */
deploymentCredentialSchema.methods.decryptData = function() {
  try {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32-chars!!', 'utf8').slice(0, 32);
    const iv = Buffer.from(this.iv, 'hex');
    const authTag = Buffer.from(this.metadata.authTag || '', 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(this.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('Failed to decrypt credential data');
  }
};

/**
 * Parse .env file content
 */
deploymentCredentialSchema.methods.parseEnvFile = function(content) {
  const envVars = new Map();
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
      envVars.set(key, value);
    }
  }
  
  return envVars;
};

/**
 * Get decrypted data as object
 */
deploymentCredentialSchema.methods.getDecryptedData = function() {
  const decrypted = this.decryptData();
  
  if (this.type === 'env-file') {
    // Return as key-value object for easy use
    return Object.fromEntries(this.parsedEnvVars);
  }
  
  return decrypted;
};

/**
 * Static method to create credential from .env file
 */
deploymentCredentialSchema.statics.createFromEnvFile = async function(userId, name, envContent, metadata = {}) {
  const credential = new this({
    userId,
    name,
    platform: metadata.platform || 'generic',
    type: 'env-file',
    metadata: {
      ...metadata,
      originalSize: envContent.length,
      lineCount: envContent.split('\n').length
    }
  });
  
  // Parse env vars
  const parsedVars = credential.parseEnvFile(envContent);
  credential.parsedEnvVars = parsedVars;
  
  // Encrypt the content
  const encrypted = credential.encryptData({ content: envContent, parsed: Object.fromEntries(parsedVars) });
  credential.encryptedData = encrypted.encryptedData;
  credential.iv = encrypted.iv;
  credential.metadata.authTag = encrypted.authTag;
  
  return credential;
};

/**
 * Static method to create credential from SSH key
 */
deploymentCredentialSchema.statics.createFromSSHKey = async function(userId, name, keyContent, metadata = {}) {
  const credential = new this({
    userId,
    name,
    platform: 'ssh',
    type: 'ssh-key',
    metadata: {
      ...metadata,
      keyType: keyContent.includes('BEGIN RSA PRIVATE KEY') ? 'RSA' : 
               keyContent.includes('BEGIN EC PRIVATE KEY') ? 'EC' : 'OPENSSH',
      keySize: keyContent.length
    }
  });
  
  const encrypted = credential.encryptData({ key: keyContent });
  credential.encryptedData = encrypted.encryptedData;
  credential.iv = encrypted.iv;
  credential.metadata.authTag = encrypted.authTag;
  
  return credential;
};

/**
 * Static method to create credential from AWS credentials
 */
deploymentCredentialSchema.statics.createFromAWSCredentials = async function(userId, name, credentials, metadata = {}) {
  const credential = new this({
    userId,
    name,
    platform: 'aws',
    type: 'aws-credentials',
    metadata: {
      ...metadata,
      region: credentials.region || 'us-east-1',
      hasAccessKey: !!credentials.accessKeyId,
      hasSecretKey: !!credentials.secretAccessKey,
      hasSessionToken: !!credentials.sessionToken
    }
  });
  
  const encrypted = credential.encryptData(credentials);
  credential.encryptedData = encrypted.encryptedData;
  credential.iv = encrypted.iv;
  credential.metadata.authTag = encrypted.authTag;
  
  return credential;
};

/**
 * Update last used timestamp
 */
deploymentCredentialSchema.methods.markAsUsed = async function() {
  this.lastUsed = new Date();
  await this.save();
};

module.exports = mongoose.model('DeploymentCredential', deploymentCredentialSchema);


