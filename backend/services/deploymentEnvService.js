const DeploymentEnv = require('../models/DeploymentEnv');
const Settings = require('../models/Settings');
const logger = require('../utils/logger');
const { encrypt } = require('../mcp/tools/envTools');

/**
 * Get master key for encryption
 */
function getMasterKey() {
  return process.env.ENV_ENCRYPTION_KEY || process.env.JWT_SECRET || 'development-key-change-in-production';
}

/**
 * Deployment Environment Service
 * Manages deployment-specific .env files
 */
class DeploymentEnvService {
  /**
   * Get or create deployment environment
   * Uses upsert to prevent race conditions when multiple requests try to create simultaneously
   */
  async getOrCreate(deploymentId, userId, service = 'main') {
    try {
      // Check if document already exists
      let deploymentEnv = await DeploymentEnv.findOne({ deploymentId, service });
      
      if (deploymentEnv) {
        // Ensure envVariables Map is initialized (safety check)
        if (!deploymentEnv.envVariables || !(deploymentEnv.envVariables instanceof Map)) {
          deploymentEnv.envVariables = new Map();
          await deploymentEnv.save();
        }
        return deploymentEnv;
      }
      
      // Create new document with required encryptedContent field
      // Encrypt an empty string as default content
      const masterKey = getMasterKey();
      const emptyContent = '';
      const encryptedContent = encrypt(emptyContent, masterKey);
      
      // Use findOneAndUpdate with upsert to prevent duplicate key errors
      deploymentEnv = await DeploymentEnv.findOneAndUpdate(
        { deploymentId, service },
        {
          $setOnInsert: {
            deploymentId,
            service,
            encryptedContent,
            variableKeys: [],
            variableCount: 0
            // envVariables will use default from schema (new Map())
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      
      // Ensure envVariables Map is initialized (safety check)
      if (!deploymentEnv.envVariables || !(deploymentEnv.envVariables instanceof Map)) {
        deploymentEnv.envVariables = new Map();
        await deploymentEnv.save();
      }
      
      return deploymentEnv;
    } catch (error) {
      // If duplicate key error still occurs (race condition), try to fetch existing
      if (error.code === 11000 || error.name === 'MongoServerError') {
        logger.warn('Duplicate key error in getOrCreate, fetching existing record', { deploymentId, service });
        const deploymentEnv = await DeploymentEnv.findOne({ deploymentId, service });
        if (deploymentEnv) {
          // Ensure envVariables Map is initialized
          if (!deploymentEnv.envVariables || !(deploymentEnv.envVariables instanceof Map)) {
            deploymentEnv.envVariables = new Map();
            await deploymentEnv.save();
          }
          return deploymentEnv;
        }
      }
      throw error;
    }
  }

  /**
   * Get deployment environment
   */
  async get(deploymentId, service = 'main') {
    const deploymentEnv = await DeploymentEnv.findOne({ deploymentId, service });
    return deploymentEnv;
  }

  /**
   * Update deployment environment variables
   */
  async update(deploymentId, envVariables, userId = null) {
    const deploymentEnv = await this.getOrCreate(deploymentId, userId);
    
    // Update all variables
    for (const [key, value] of Object.entries(envVariables)) {
      await deploymentEnv.addEnvVar(key, value);
    }
    
    return deploymentEnv;
  }

  /**
   * Add or update a single environment variable
   */
  async setEnvVar(deploymentId, key, value, userId = null) {
    const deploymentEnv = await this.getOrCreate(deploymentId, userId);
    await deploymentEnv.addEnvVar(key, value);
    return deploymentEnv;
  }

  /**
   * Remove an environment variable
   */
  async removeEnvVar(deploymentId, key, userId = null) {
    const deploymentEnv = await this.getOrCreate(deploymentId, userId);
    await deploymentEnv.removeEnvVar(key);
    return deploymentEnv;
  }

  /**
   * Merge with global environment variables
   */
  async mergeWithGlobal(deploymentId, userId) {
    const deploymentEnv = await this.getOrCreate(deploymentId, userId);
    const settings = await Settings.findOne({ userId, type: 'user' });
    
    if (settings && settings.environmentVariables) {
      // Merge global env vars into deployment env (deployment vars take precedence)
      for (const [key, value] of settings.environmentVariables.entries()) {
        if (!deploymentEnv.envVariables.has(key)) {
          deploymentEnv.envVariables.set(key, value);
        }
      }
      await deploymentEnv.save();
    }
    
    return deploymentEnv;
  }

  /**
   * Generate .env file content
   */
  async generateEnvFile(deploymentId, userId = null) {
    const deploymentEnv = await this.mergeWithGlobal(deploymentId, userId);
    return deploymentEnv.toEnvString();
  }

  /**
   * Validate environment variables
   */
  async validate(deploymentId, requiredVars = []) {
    const deploymentEnv = await this.get(deploymentId);
    if (!deploymentEnv) {
      return {
        valid: false,
        missing: requiredVars,
        errors: ['Deployment environment not found']
      };
    }
    
    const missing = [];
    const errors = [];
    
    for (const varName of requiredVars) {
      if (!deploymentEnv.envVariables.has(varName)) {
        missing.push(varName);
      }
    }
    
    // Validate format (basic checks)
    for (const [key, value] of deploymentEnv.envVariables.entries()) {
      if (!key || key.trim() === '') {
        errors.push(`Invalid variable name: ${key}`);
      }
      if (value === undefined || value === null) {
        errors.push(`Variable ${key} has no value`);
      }
    }
    
    return {
      valid: missing.length === 0 && errors.length === 0,
      missing,
      errors
    };
  }

  /**
   * Update chat context
   */
  async updateChatContext(deploymentId, context) {
    const deploymentEnv = await this.getOrCreate(deploymentId);
    deploymentEnv.chatContext = context;
    await deploymentEnv.save();
    return deploymentEnv;
  }

  /**
   * Get environment variables as object
   */
  async getAsObject(deploymentId, userId = null) {
    const deploymentEnv = await this.mergeWithGlobal(deploymentId, userId);
    const envObj = {};
    
    for (const [key, value] of deploymentEnv.envVariables.entries()) {
      envObj[key] = value;
    }
    
    return envObj;
  }
}

module.exports = new DeploymentEnvService();

