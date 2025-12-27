const Joi = require('joi');
const logger = require('../utils/logger');

// Validation middleware factory
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : 
                 source === 'query' ? req.query : 
                 source === 'params' ? req.params : {};
    
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      logger.warn('Validation error', { errors, source });
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors
        }
      });
    }
    
    // Replace request data with validated and sanitized data
    if (source === 'body') {
      req.body = value;
    } else if (source === 'query') {
      req.query = value;
    } else if (source === 'params') {
      req.params = value;
    }
    
    next();
  };
};

// Common validation schemas
const schemas = {
  // User registration
  register: Joi.object({
    email: Joi.string().email().required(),
    name: Joi.string().min(2).max(100).required(),
    password: Joi.string().min(8).required(),
    role: Joi.string().valid('developer', 'viewer').default('developer'),
    department: Joi.string().optional(),
    team: Joi.string().optional()
  }),
  
  // User login
  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),
  
  // Deployment creation
  createDeployment: Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().max(500).optional(),
    environment: Joi.string().valid('development', 'staging', 'production').required(),
    region: Joi.string().default('us-east-1'),
    repositoryUrl: Joi.string().uri().optional(),
    repositoryBranch: Joi.string().optional(),
    githubToken: Joi.string().optional() // Allow GitHub token to be passed
  }),
  
  // Chat message
  chatMessage: Joi.object({
    deploymentId: Joi.string().required(),
    message: Joi.string().min(1).max(10000).required(),
    stream: Joi.boolean().default(false)
  }),
  
  // Approval
  approval: Joi.object({
    comment: Joi.string().max(500).optional(),
    reason: Joi.string().max(500).optional()
  }),
  
  // Rollback
  rollback: Joi.object({
    version: Joi.number().integer().min(1).optional(),
    reason: Joi.string().max(500).optional()
  }),
  
  // Cost budget
  costBudget: Joi.object({
    monthlyBudget: Joi.number().min(0).required(),
    alertThreshold: Joi.number().min(0).max(1).default(0.8)
  }),
  
  // Sandbox creation
  createSandbox: Joi.object({
    deploymentId: Joi.string().required(),
    durationHours: Joi.number().integer().min(1).max(24).default(4)
  })
};

module.exports = {
  validate,
  schemas
};

