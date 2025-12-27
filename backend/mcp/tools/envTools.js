const crypto = require('crypto');
const logger = require('../../utils/logger');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// In-memory store for development (in production, use MongoDB)
const envStore = new Map();

/**
 * Environment Management MCP Tools
 * Handles encrypted storage and retrieval of environment variables
 */

/**
 * Get encryption key from password
 */
function getKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt content using AES-256-GCM
 */
function encrypt(text, masterKey) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = getKey(masterKey, salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  // Combine salt + iv + tag + encrypted data
  const result = Buffer.concat([
    salt,
    iv,
    tag,
    Buffer.from(encrypted, 'hex')
  ]).toString('base64');
  
  return result;
}

/**
 * Decrypt content
 */
function decrypt(encryptedData, masterKey) {
  const buffer = Buffer.from(encryptedData, 'base64');
  
  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  
  const key = getKey(masterKey, salt);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Get master key for encryption
 */
function getMasterKey() {
  // Use environment variable or generate a default for development
  return process.env.ENV_ENCRYPTION_KEY || process.env.JWT_SECRET || 'development-key-change-in-production';
}

/**
 * Parse .env content into key-value pairs
 */
function parseEnvContent(content) {
  const variables = {};
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    // Match KEY=VALUE pattern
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Remove surrounding quotes if present
      let cleanValue = value.trim();
      if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
          (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
        cleanValue = cleanValue.slice(1, -1);
      }
      variables[key] = cleanValue;
    }
  }
  
  return variables;
}

/**
 * Convert variables object to .env format
 */
function toEnvFormat(variables) {
  return Object.entries(variables)
    .map(([key, value]) => {
      // Quote values with spaces or special characters
      if (value.includes(' ') || value.includes('=') || value.includes('#')) {
        return `${key}="${value}"`;
      }
      return `${key}=${value}`;
    })
    .join('\n');
}

/**
 * Store environment variables (encrypted)
 */
async function storeEnv({ deploymentId, content, service = 'main', overwrite = false }) {
  try {
    if (!deploymentId) {
      return {
        success: false,
        error: 'deploymentId is required'
      };
    }
    
    if (!content) {
      return {
        success: false,
        error: 'content is required'
      };
    }
    
    const storeKey = `${deploymentId}:${service}`;
    
    // Check if already exists
    if (envStore.has(storeKey) && !overwrite) {
      return {
        success: false,
        error: `Environment for ${service} already exists. Use overwrite=true to replace.`
      };
    }
    
    // Parse and validate
    const variables = parseEnvContent(content);
    const variableCount = Object.keys(variables).length;
    
    if (variableCount === 0) {
      return {
        success: false,
        error: 'No valid environment variables found in content'
      };
    }
    
    // Encrypt the content
    const masterKey = getMasterKey();
    const encryptedContent = encrypt(content, masterKey);
    
    // Store encrypted data
    const storedData = {
      deploymentId,
      service,
      encryptedContent,
      variableKeys: Object.keys(variables),
      variableCount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    envStore.set(storeKey, storedData);
    
    // Also try to persist to MongoDB if available
    try {
      const DeploymentEnv = require('../../models/DeploymentEnv');
      await DeploymentEnv.findOneAndUpdate(
        { deploymentId, service },
        {
          deploymentId,
          service,
          encryptedContent,
          variableKeys: Object.keys(variables),
          variableCount,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
      logger.info(`Environment stored in MongoDB for ${deploymentId}:${service}`);
    } catch (dbError) {
      // MongoDB not available, continue with in-memory store
      logger.warn('MongoDB not available, using in-memory store:', dbError.message);
    }
    
    return {
      success: true,
      deploymentId,
      service,
      variableCount,
      variableKeys: Object.keys(variables),
      message: `Stored ${variableCount} environment variables for ${service}`
    };
    
  } catch (error) {
    logger.error('storeEnv failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Retrieve environment variables (decrypted)
 */
async function retrieveEnv({ deploymentId, service = 'main', format = 'object' }) {
  try {
    if (!deploymentId) {
      return {
        success: false,
        error: 'deploymentId is required'
      };
    }
    
    const storeKey = `${deploymentId}:${service}`;
    let storedData = envStore.get(storeKey);
    
    // Try MongoDB if not in memory
    if (!storedData) {
      try {
        const DeploymentEnv = require('../../models/DeploymentEnv');
        const dbData = await DeploymentEnv.findOne({ deploymentId, service });
        if (dbData) {
          storedData = {
            encryptedContent: dbData.encryptedContent,
            variableKeys: dbData.variableKeys,
            variableCount: dbData.variableCount,
            createdAt: dbData.createdAt,
            updatedAt: dbData.updatedAt
          };
          // Cache in memory
          envStore.set(storeKey, storedData);
        }
      } catch (dbError) {
        logger.warn('MongoDB not available:', dbError.message);
      }
    }
    
    if (!storedData) {
      return {
        success: false,
        error: `No environment found for ${deploymentId}:${service}`
      };
    }
    
    // Decrypt content
    const masterKey = getMasterKey();
    const decryptedContent = decrypt(storedData.encryptedContent, masterKey);
    
    if (format === 'raw') {
      return {
        success: true,
        deploymentId,
        service,
        content: decryptedContent,
        variableCount: storedData.variableCount
      };
    }
    
    // Parse to object
    const variables = parseEnvContent(decryptedContent);
    
    return {
      success: true,
      deploymentId,
      service,
      variables,
      variableKeys: Object.keys(variables),
      variableCount: Object.keys(variables).length
    };
    
  } catch (error) {
    logger.error('retrieveEnv failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate environment variables against required list
 */
async function validateEnv({ deploymentId, service = 'main', requiredVars = [] }) {
  try {
    // Retrieve the stored env
    const retrieved = await retrieveEnv({ deploymentId, service, format: 'object' });
    
    if (!retrieved.success) {
      return {
        success: false,
        error: retrieved.error,
        valid: false
      };
    }
    
    const storedVars = Object.keys(retrieved.variables);
    const missing = requiredVars.filter(v => !storedVars.includes(v));
    const extra = storedVars.filter(v => !requiredVars.includes(v));
    
    return {
      success: true,
      valid: missing.length === 0,
      deploymentId,
      service,
      storedCount: storedVars.length,
      requiredCount: requiredVars.length,
      missingVars: missing,
      extraVars: extra,
      message: missing.length === 0 
        ? 'All required variables are present' 
        : `Missing ${missing.length} required variables: ${missing.join(', ')}`
    };
    
  } catch (error) {
    logger.error('validateEnv failed:', error);
    return {
      success: false,
      error: error.message,
      valid: false
    };
  }
}

/**
 * Merge two environment configurations
 */
async function mergeEnv({ baseContent, overlayContent, conflictResolution = 'overlay' }) {
  try {
    const baseVars = parseEnvContent(baseContent || '');
    const overlayVars = parseEnvContent(overlayContent || '');
    
    let merged;
    
    if (conflictResolution === 'overlay') {
      // Overlay wins on conflicts
      merged = { ...baseVars, ...overlayVars };
    } else if (conflictResolution === 'base') {
      // Base wins on conflicts
      merged = { ...overlayVars, ...baseVars };
    } else {
      return {
        success: false,
        error: 'Invalid conflictResolution. Use "overlay" or "base"'
      };
    }
    
    const conflicts = Object.keys(baseVars).filter(k => 
      overlayVars[k] !== undefined && baseVars[k] !== overlayVars[k]
    );
    
    return {
      success: true,
      merged: toEnvFormat(merged),
      mergedVariables: merged,
      baseCount: Object.keys(baseVars).length,
      overlayCount: Object.keys(overlayVars).length,
      mergedCount: Object.keys(merged).length,
      conflicts,
      conflictResolution
    };
    
  } catch (error) {
    logger.error('mergeEnv failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Delete stored environment
 */
async function deleteEnv({ deploymentId, service = 'main' }) {
  try {
    const storeKey = `${deploymentId}:${service}`;
    
    // Delete from memory
    const existed = envStore.delete(storeKey);
    
    // Delete from MongoDB
    try {
      const DeploymentEnv = require('../../models/DeploymentEnv');
      await DeploymentEnv.deleteOne({ deploymentId, service });
    } catch (dbError) {
      logger.warn('MongoDB delete failed:', dbError.message);
    }
    
    return {
      success: true,
      deploymentId,
      service,
      deleted: existed,
      message: existed ? 'Environment deleted' : 'No environment found to delete'
    };
    
  } catch (error) {
    logger.error('deleteEnv failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * List all stored environments for a deployment
 */
async function listEnvs({ deploymentId }) {
  try {
    const envs = [];
    
    // Check in-memory store
    for (const [key, data] of envStore.entries()) {
      if (key.startsWith(`${deploymentId}:`)) {
        envs.push({
          service: data.service,
          variableCount: data.variableCount,
          variableKeys: data.variableKeys,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt
        });
      }
    }
    
    // Also check MongoDB
    try {
      const DeploymentEnv = require('../../models/DeploymentEnv');
      const dbEnvs = await DeploymentEnv.find({ deploymentId }).select('-encryptedContent');
      
      for (const dbEnv of dbEnvs) {
        // Check if already in list (from memory)
        if (!envs.find(e => e.service === dbEnv.service)) {
          envs.push({
            service: dbEnv.service,
            variableCount: dbEnv.variableCount,
            variableKeys: dbEnv.variableKeys,
            createdAt: dbEnv.createdAt,
            updatedAt: dbEnv.updatedAt
          });
        }
      }
    } catch (dbError) {
      logger.warn('MongoDB query failed:', dbError.message);
    }
    
    return {
      success: true,
      deploymentId,
      count: envs.length,
      environments: envs
    };
    
  } catch (error) {
    logger.error('listEnvs failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate .env content from a template with values
 */
async function generateEnv({ template, values = {} }) {
  try {
    const templateVars = parseEnvContent(template);
    const result = {};
    
    // Merge template with provided values
    for (const [key, defaultValue] of Object.entries(templateVars)) {
      result[key] = values[key] !== undefined ? values[key] : defaultValue;
    }
    
    // Add any additional values not in template
    for (const [key, value] of Object.entries(values)) {
      if (result[key] === undefined) {
        result[key] = value;
      }
    }
    
    return {
      success: true,
      content: toEnvFormat(result),
      variables: result,
      variableCount: Object.keys(result).length,
      fromTemplate: Object.keys(templateVars).length,
      fromValues: Object.keys(values).length
    };
    
  } catch (error) {
    logger.error('generateEnv failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get MCP tool definitions
 */
function getTools() {
  return [
    {
      name: 'storeEnv',
      description: 'Store environment variables with AES-256 encryption. Content should be in .env format (KEY=value)',
      inputSchema: {
        type: 'object',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Unique deployment identifier'
          },
          content: {
            type: 'string',
            description: 'Environment variables in .env format (KEY=value per line)'
          },
          service: {
            type: 'string',
            description: 'Service name (for multi-service deployments)',
            default: 'main'
          },
          overwrite: {
            type: 'boolean',
            description: 'Whether to overwrite existing env',
            default: false
          }
        },
        required: ['deploymentId', 'content']
      },
      handler: storeEnv
    },
    {
      name: 'retrieveEnv',
      description: 'Retrieve and decrypt stored environment variables',
      inputSchema: {
        type: 'object',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Unique deployment identifier'
          },
          service: {
            type: 'string',
            description: 'Service name',
            default: 'main'
          },
          format: {
            type: 'string',
            enum: ['object', 'raw'],
            description: 'Return format - object (parsed) or raw (.env content)',
            default: 'object'
          }
        },
        required: ['deploymentId']
      },
      handler: retrieveEnv
    },
    {
      name: 'validateEnv',
      description: 'Validate stored environment variables against a list of required variables',
      inputSchema: {
        type: 'object',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Unique deployment identifier'
          },
          service: {
            type: 'string',
            description: 'Service name',
            default: 'main'
          },
          requiredVars: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of required variable names'
          }
        },
        required: ['deploymentId', 'requiredVars']
      },
      handler: validateEnv
    },
    {
      name: 'mergeEnv',
      description: 'Merge two .env contents, with configurable conflict resolution',
      inputSchema: {
        type: 'object',
        properties: {
          baseContent: {
            type: 'string',
            description: 'Base .env content'
          },
          overlayContent: {
            type: 'string',
            description: 'Overlay .env content to merge on top'
          },
          conflictResolution: {
            type: 'string',
            enum: ['overlay', 'base'],
            description: 'Which wins on conflicts',
            default: 'overlay'
          }
        },
        required: ['baseContent', 'overlayContent']
      },
      handler: mergeEnv
    },
    {
      name: 'deleteEnv',
      description: 'Delete stored environment variables',
      inputSchema: {
        type: 'object',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Unique deployment identifier'
          },
          service: {
            type: 'string',
            description: 'Service name',
            default: 'main'
          }
        },
        required: ['deploymentId']
      },
      handler: deleteEnv
    },
    {
      name: 'listEnvs',
      description: 'List all stored environments for a deployment',
      inputSchema: {
        type: 'object',
        properties: {
          deploymentId: {
            type: 'string',
            description: 'Unique deployment identifier'
          }
        },
        required: ['deploymentId']
      },
      handler: listEnvs
    },
    {
      name: 'generateEnv',
      description: 'Generate .env content from a template with provided values',
      inputSchema: {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            description: '.env template content with default values'
          },
          values: {
            type: 'object',
            description: 'Values to fill in or override'
          }
        },
        required: ['template']
      },
      handler: generateEnv
    }
  ];
}

module.exports = {
  getTools,
  storeEnv,
  retrieveEnv,
  validateEnv,
  mergeEnv,
  deleteEnv,
  listEnvs,
  generateEnv,
  // Export utilities for use by other services
  encrypt,
  decrypt,
  parseEnvContent,
  toEnvFormat
};


