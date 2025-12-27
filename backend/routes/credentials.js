const express = require('express');
const multer = require('multer');
const DeploymentCredential = require('../models/DeploymentCredential');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { 
    fileSize: 10 * 1024 * 1024 // 10MB max for credential files
  }
});

// Apply authentication to all routes
router.use(authenticate);

/**
 * GET /api/v1/credentials
 * List all deployment credentials for the user
 */
router.get('/', async (req, res, next) => {
  try {
    const { platform, type, active } = req.query;
    
    const query = { userId: req.user.id };
    if (platform) query.platform = platform;
    if (type) query.type = type;
    if (active !== undefined) query.active = active === 'true';

    const credentials = await DeploymentCredential.find(query)
      .sort({ createdAt: -1 })
      .select('-encryptedData -iv'); // Don't send encrypted data

    res.json({
      success: true,
      count: credentials.length,
      credentials: credentials.map(c => ({
        id: c._id,
        name: c.name,
        platform: c.platform,
        type: c.type,
        metadata: c.metadata,
        tags: c.tags,
        active: c.active,
        lastUsed: c.lastUsed,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        // For env-file type, show parsed vars count
        envVarCount: c.type === 'env-file' ? c.parsedEnvVars.size : undefined
      }))
    });
  } catch (error) {
    logger.error('Error listing credentials:', error);
    next(error);
  }
});

/**
 * GET /api/v1/credentials/:id
 * Get a specific credential (without decrypted data)
 */
router.get('/:id', async (req, res, next) => {
  try {
    const credential = await DeploymentCredential.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found'
      });
    }

    res.json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        metadata: credential.metadata,
        tags: credential.tags,
        active: credential.active,
        lastUsed: credential.lastUsed,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
        envVarCount: credential.type === 'env-file' ? credential.parsedEnvVars.size : undefined
      }
    });
  } catch (error) {
    logger.error('Error getting credential:', error);
    next(error);
  }
});

/**
 * POST /api/v1/credentials/env-file
 * Upload and store a .env file
 */
router.post('/env-file', upload.single('file'), async (req, res, next) => {
  try {
    const { name, platform, tags } = req.body;
    const file = req.file;

    if (!file && !req.body.content) {
      return res.status(400).json({
        success: false,
        error: 'Either file or content must be provided'
      });
    }

    const envContent = file ? file.buffer.toString('utf8') : req.body.content;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    // Check if name already exists
    const existing = await DeploymentCredential.findOne({
      userId: req.user.id,
      name,
      type: 'env-file'
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'A credential with this name already exists'
      });
    }

    const credential = await DeploymentCredential.createFromEnvFile(
      req.user.id,
      name,
      envContent,
      {
        platform: platform || 'generic',
        fileName: file?.originalname,
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',') })
      }
    );

    await credential.save();

    logger.info(`Credential created: ${credential._id} (${name})`);

    res.status(201).json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        envVarCount: credential.parsedEnvVars.size,
        metadata: credential.metadata
      }
    });
  } catch (error) {
    logger.error('Error creating env-file credential:', error);
    next(error);
  }
});

/**
 * POST /api/v1/credentials/from-env
 * Create a credential from parsed .env content (from project import)
 */
router.post('/from-env', async (req, res, next) => {
  try {
    const { name, content, platform, description, tags } = req.body;

    if (!name || !content) {
      return res.status(400).json({
        success: false,
        error: 'Name and content are required'
      });
    }

    // Check if name already exists
    const existing = await DeploymentCredential.findOne({
      userId: req.user.id,
      name,
      type: 'env-file'
    });

    if (existing) {
      // Update existing credential
      existing.setEncryptedData(content);
      existing.metadata = {
        ...existing.metadata,
        description: description || existing.metadata?.description,
        importedAt: new Date().toISOString()
      };
      if (tags) {
        existing.tags = Array.isArray(tags) ? tags : tags.split(',');
      }
      await existing.save();

      logger.info(`Credential updated: ${existing._id} (${name})`);

      return res.json({
        success: true,
        updated: true,
        credential: {
          id: existing._id,
          name: existing.name,
          platform: existing.platform,
          type: existing.type,
          envVarCount: existing.parsedEnvVars?.size || 0,
          metadata: existing.metadata
        }
      });
    }

    // Create new credential
    const credential = await DeploymentCredential.createFromEnvFile(
      req.user.id,
      name,
      content,
      {
        platform: platform || 'env-file',
        description,
        importedAt: new Date().toISOString(),
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',') })
      }
    );

    await credential.save();

    logger.info(`Credential created from env: ${credential._id} (${name})`);

    res.status(201).json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        envVarCount: credential.parsedEnvVars?.size || 0,
        metadata: credential.metadata
      }
    });
  } catch (error) {
    logger.error('Error creating credential from env:', error);
    next(error);
  }
});

/**
 * POST /api/v1/credentials/ssh-key
 * Upload and store an SSH private key
 */
router.post('/ssh-key', upload.single('file'), async (req, res, next) => {
  try {
    const { name, tags } = req.body;
    const file = req.file;

    if (!file && !req.body.content) {
      return res.status(400).json({
        success: false,
        error: 'Either file or content must be provided'
      });
    }

    const keyContent = file ? file.buffer.toString('utf8') : req.body.content;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    const credential = await DeploymentCredential.createFromSSHKey(
      req.user.id,
      name,
      keyContent,
      {
        fileName: file?.originalname,
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',') })
      }
    );

    await credential.save();

    res.status(201).json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        metadata: credential.metadata
      }
    });
  } catch (error) {
    logger.error('Error creating SSH key credential:', error);
    next(error);
  }
});

/**
 * POST /api/v1/credentials/aws
 * Store AWS credentials
 */
router.post('/aws', async (req, res, next) => {
  try {
    const { name, accessKeyId, secretAccessKey, sessionToken, region, tags } = req.body;

    if (!name || !accessKeyId || !secretAccessKey) {
      return res.status(400).json({
        success: false,
        error: 'Name, accessKeyId, and secretAccessKey are required'
      });
    }

    const credential = await DeploymentCredential.createFromAWSCredentials(
      req.user.id,
      name,
      {
        accessKeyId,
        secretAccessKey,
        sessionToken,
        region: region || 'us-east-1'
      },
      {
        ...(tags && { tags: Array.isArray(tags) ? tags : tags.split(',') })
      }
    );

    await credential.save();

    res.status(201).json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        metadata: credential.metadata
      }
    });
  } catch (error) {
    logger.error('Error creating AWS credential:', error);
    next(error);
  }
});

/**
 * GET /api/v1/credentials/:id/decrypt
 * Get decrypted credential data (use with caution!)
 */
router.get('/:id/decrypt', async (req, res, next) => {
  try {
    const credential = await DeploymentCredential.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found'
      });
    }

    // Mark as used
    await credential.markAsUsed();

    const decryptedData = credential.getDecryptedData();

    res.json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        platform: credential.platform,
        type: credential.type,
        data: decryptedData
      }
    });
  } catch (error) {
    logger.error('Error decrypting credential:', error);
    next(error);
  }
});

/**
 * PUT /api/v1/credentials/:id
 * Update credential metadata
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { name, tags, active } = req.body;

    const credential = await DeploymentCredential.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found'
      });
    }

    if (name) credential.name = name;
    if (tags !== undefined) credential.tags = Array.isArray(tags) ? tags : tags.split(',');
    if (active !== undefined) credential.active = active;

    await credential.save();

    res.json({
      success: true,
      credential: {
        id: credential._id,
        name: credential.name,
        tags: credential.tags,
        active: credential.active
      }
    });
  } catch (error) {
    logger.error('Error updating credential:', error);
    next(error);
  }
});

/**
 * DELETE /api/v1/credentials/:id
 * Delete a credential
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const credential = await DeploymentCredential.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found'
      });
    }

    logger.info(`Credential deleted: ${credential._id}`);

    res.json({
      success: true,
      message: 'Credential deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting credential:', error);
    next(error);
  }
});

/**
 * POST /api/v1/credentials/:id/use
 * Mark credential as used (for tracking)
 */
router.post('/:id/use', async (req, res, next) => {
  try {
    const credential = await DeploymentCredential.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!credential) {
      return res.status(404).json({
        success: false,
        error: 'Credential not found'
      });
    }

    await credential.markAsUsed();

    res.json({
      success: true,
      message: 'Credential marked as used',
      lastUsed: credential.lastUsed
    });
  } catch (error) {
    logger.error('Error marking credential as used:', error);
    next(error);
  }
});

module.exports = router;
