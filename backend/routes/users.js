const express = require('express');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/permissions');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get current user
router.get('/me', async (req, res, next) => {
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

// Update current user
router.patch('/me', async (req, res, next) => {
  try {
    const { name, preferences, department, team } = req.body;
    
    const user = await User.findById(req.user._id);
    
    if (name) user.name = name;
    if (preferences) user.preferences = { ...user.preferences, ...preferences };
    if (department) user.department = department;
    if (team) user.team = team;
    
    await user.save();
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          preferences: user.preferences,
          department: user.department,
          team: user.team
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get all users (admin/tech_lead only)
router.get('/', requireRole('admin', 'tech_lead'), async (req, res, next) => {
  try {
    const { role, team, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (role) query.role = role;
    if (team) query.team = team;
    
    const users = await User.find(query)
      .select('-passwordHash -apiKeys.hashedKey')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });
    
    const total = await User.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/:id', requireRole('admin', 'tech_lead'), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash -apiKeys.hashedKey');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }
    
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    next(error);
  }
});

// Update user (admin only)
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, role, department, team, preferences } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }
    
    if (name) user.name = name;
    if (role) user.role = role;
    if (department) user.department = department;
    if (team) user.team = team;
    if (preferences) user.preferences = { ...user.preferences, ...preferences };
    
    await user.save();
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          department: user.department,
          team: user.team,
          preferences: user.preferences
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Delete user (admin only)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'User not found'
        }
      });
    }
    
    // Don't allow deleting yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OPERATION',
          message: 'Cannot delete your own account'
        }
      });
    }
    
    await User.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

