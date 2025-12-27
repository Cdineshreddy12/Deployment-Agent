const express = require('express');
const Settings = require('../models/Settings');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Get user settings
 * GET /api/v1/settings
 */
router.get('/', requirePermission('settings.read'), async (req, res, next) => {
  try {
    let settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    if (!settings) {
      // Create default settings
      settings = new Settings({
        userId: req.user._id,
        type: 'user'
      });
      await settings.save();
    }
    
    // Convert Map to object for JSON response
    const envVars = {};
    for (const [key, value] of settings.environmentVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: {
        settings: {
          ...settings.toObject(),
          environmentVariables: envVars
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get settings:', error);
    next(error);
  }
});

/**
 * Update user settings
 * PUT /api/v1/settings
 */
router.put('/', requirePermission('settings.update'), async (req, res, next) => {
  try {
    const { apiUrls, credits, environmentVariables, preferences } = req.body;
    
    let settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    if (!settings) {
      settings = new Settings({
        userId: req.user._id,
        type: 'user'
      });
    }
    
    if (apiUrls) {
      settings.apiUrls = { ...settings.apiUrls, ...apiUrls };
    }
    
    if (credits) {
      settings.credits = { ...settings.credits, ...credits };
      settings.credits.remaining = settings.credits.total - settings.credits.used;
    }
    
    if (preferences) {
      settings.preferences = { ...settings.preferences, ...preferences };
    }
    
    await settings.save();
    
    // Convert Map to object for JSON response
    const envVars = {};
    for (const [key, value] of settings.environmentVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: {
        settings: {
          ...settings.toObject(),
          environmentVariables: envVars
        }
      }
    });
  } catch (error) {
    logger.error('Failed to update settings:', error);
    next(error);
  }
});

/**
 * Get environment variables
 * GET /api/v1/settings/env
 */
router.get('/env', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    if (!settings) {
      return res.json({
        success: true,
        data: { environmentVariables: {} }
      });
    }
    
    const envVars = {};
    for (const [key, value] of settings.environmentVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: { environmentVariables: envVars }
    });
  } catch (error) {
    logger.error('Failed to get environment variables:', error);
    next(error);
  }
});

/**
 * Update environment variables
 * PUT /api/v1/settings/env
 */
router.put('/env', requirePermission('settings.update'), async (req, res, next) => {
  try {
    const { environmentVariables } = req.body;
    
    let settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    if (!settings) {
      settings = new Settings({
        userId: req.user._id,
        type: 'user'
      });
    }
    
    // Update environment variables
    for (const [key, value] of Object.entries(environmentVariables)) {
      settings.environmentVariables.set(key, value);
    }
    
    await settings.save();
    
    const envVars = {};
    for (const [key, value] of settings.environmentVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: { environmentVariables: envVars }
    });
  } catch (error) {
    logger.error('Failed to update environment variables:', error);
    next(error);
  }
});

/**
 * Export .env file
 * POST /api/v1/settings/env/export
 */
router.post('/env/export', requirePermission('settings.read'), async (req, res, next) => {
  try {
    const settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    let envContent = '';
    if (settings && settings.environmentVariables) {
      for (const [key, value] of settings.environmentVariables.entries()) {
        envContent += `${key}=${value}\n`;
      }
    }
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=".env"');
    res.send(envContent);
  } catch (error) {
    logger.error('Failed to export .env:', error);
    next(error);
  }
});

/**
 * Import .env file
 * POST /api/v1/settings/env/import
 */
router.post('/env/import', requirePermission('settings.update'), async (req, res, next) => {
  try {
    const { envContent } = req.body;
    
    if (!envContent) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'envContent is required'
        }
      });
    }
    
    let settings = await Settings.findOne({ userId: req.user._id, type: 'user' });
    
    if (!settings) {
      settings = new Settings({
        userId: req.user._id,
        type: 'user'
      });
    }
    
    // Parse .env content
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (match) {
          const key = match[1];
          const value = match[2].replace(/^["']|["']$/g, ''); // Remove quotes
          settings.environmentVariables.set(key, value);
        }
      }
    }
    
    await settings.save();
    
    const envVars = {};
    for (const [key, value] of settings.environmentVariables.entries()) {
      envVars[key] = value;
    }
    
    res.json({
      success: true,
      data: { environmentVariables: envVars }
    });
  } catch (error) {
    logger.error('Failed to import .env:', error);
    next(error);
  }
});

module.exports = router;

