const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { validate, schemas } = require('../middleware/validation');
const logger = require('../utils/logger');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
};

// Register new user
router.post('/register', authLimiter, validate(schemas.register), async (req, res, next) => {
  try {
    const { email, name, password, role, department, team } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'USER_EXISTS',
          message: 'User with this email already exists'
        }
      });
    }
    
    // Create new user
    const user = new User({
      email,
      name,
      passwordHash: password, // Will be hashed by pre-save hook
      role: role || 'developer',
      department,
      team
    });
    
    await user.save();
    
    // Generate token
    const token = generateToken(user._id);
    
    // Log audit
    await AuditLog.create({
      userId: user._id.toString(),
      userEmail: user.email,
      action: 'user.registered',
      resourceType: 'user',
      resourceId: user._id.toString(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    logger.info('User registered', { userId: user._id, email: user.email });
    
    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', authLimiter, validate(schemas.login), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }
    
    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }
    
    // Update last login
    user.lastLoginAt = new Date();
    await user.save();
    
    // Generate token
    const token = generateToken(user._id);
    
    // Log audit
    await AuditLog.create({
      userId: user._id.toString(),
      userEmail: user.email,
      action: 'user.logged_in',
      resourceType: 'user',
      resourceId: user._id.toString(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    logger.info('User logged in', { userId: user._id, email: user.email });
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        token
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Get current user
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash -apiKeys.hashedKey');
    
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    next(error);
  }
});

// Refresh token
router.post('/refresh', authenticate, async (req, res, next) => {
  try {
    const token = generateToken(req.user._id);
    
    res.json({
      success: true,
      data: { token }
    });
  } catch (error) {
    next(error);
  }
});

// Logout (client-side token removal, but we log it)
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    // Log audit
    await AuditLog.create({
      userId: req.user._id.toString(),
      userEmail: req.user.email,
      action: 'user.logged_out',
      resourceType: 'user',
      resourceId: req.user._id.toString(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Generate API key
router.post('/api-keys', authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    
    const user = await User.findById(req.user._id);
    const apiKey = user.generateApiKey(name || 'CLI Access');
    await user.save();
    
    // Log audit
    await AuditLog.create({
      userId: user._id.toString(),
      userEmail: user.email,
      action: 'api_key.created',
      resourceType: 'api_key',
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    logger.info('API key created', { userId: user._id });
    
    res.status(201).json({
      success: true,
      data: {
        apiKey,
        keyId: user.apiKeys[user.apiKeys.length - 1].keyId,
        expiresAt: user.apiKeys[user.apiKeys.length - 1].expiresAt
      },
      warning: 'Save this API key securely. It will not be shown again.'
    });
  } catch (error) {
    next(error);
  }
});

// List API keys
router.get('/api-keys', authenticate, async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    
    const apiKeys = user.apiKeys.map(key => ({
      keyId: key.keyId,
      name: key.name,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt
    }));
    
    res.json({
      success: true,
      data: { apiKeys }
    });
  } catch (error) {
    next(error);
  }
});

// Delete API key
router.delete('/api-keys/:keyId', authenticate, async (req, res, next) => {
  try {
    const { keyId } = req.params;
    
    const user = await User.findById(req.user._id);
    const keyIndex = user.apiKeys.findIndex(k => k.keyId === keyId);
    
    if (keyIndex === -1) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'API key not found'
        }
      });
    }
    
    user.apiKeys.splice(keyIndex, 1);
    await user.save();
    
    // Log audit
    await AuditLog.create({
      userId: user._id.toString(),
      userEmail: user.email,
      action: 'api_key.deleted',
      resourceType: 'api_key',
      resourceId: keyId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

