const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');

// JWT authentication middleware
const authenticate = async (req, res, next) => {
  try {
    // Check for token in Authorization header, query parameter (for SSE), or API key in header
    const authHeader = req.headers.authorization;
    const tokenFromQuery = req.query.token; // Support token in query for SSE endpoints
    const apiKey = req.headers['x-api-key'];
    
    if (!authHeader && !tokenFromQuery && !apiKey) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'No authentication token or API key provided'
        }
      });
    }
    
    let user = null;
    
    // Try JWT token first (from header or query)
    const token = (authHeader && authHeader.startsWith('Bearer ')) 
      ? authHeader.substring(7) 
      : tokenFromQuery;
    
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        user = await User.findById(decoded.userId).select('-passwordHash');
        
        if (!user) {
          return res.status(401).json({
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'User not found'
            }
          });
        }
      } catch (error) {
        if (error.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired'
            }
          });
        }
        throw error;
      }
    }
    
    // Try API key if JWT didn't work
    if (!user && apiKey) {
      const users = await User.find({});
      
      for (const u of users) {
        if (u.validateApiKey(apiKey)) {
          user = u;
          break;
        }
      }
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid API key'
          }
        });
      }
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication failed'
        }
      });
    }
    
    req.user = user;
    next();
    
  } catch (error) {
    logger.error('Authentication error:', error);
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication failed'
      }
    });
  }
};

// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-passwordHash');
        if (user) {
          req.user = user;
        }
      } catch (error) {
        // Ignore errors for optional auth
      }
    }
    
    next();
  } catch (error) {
    next();
  }
};

module.exports = {
  authenticate,
  optionalAuth
};

