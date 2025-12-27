const express = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const credentialValidator = require('../services/credentialValidator');
const ServiceConfig = require('../models/ServiceConfig');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Get required credentials for a service type
 */
router.get('/credentials/:serviceType', authenticate, async (req, res, next) => {
  try {
    const { serviceType } = req.params;
    const requirements = credentialValidator.getRequiredCredentials(serviceType);
    
    res.json({
      success: true,
      data: {
        serviceType,
        requiredCredentials: requirements
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Validate service credentials
 */
router.post('/credentials/validate', authenticate, validate({
  body: {
    serviceType: 'string',
    credentials: 'object'
  }
}), async (req, res, next) => {
  try {
    const { serviceType, credentials, deploymentId } = req.body;
    
    const result = await credentialValidator.validateServiceCredentials(
      serviceType,
      credentials,
      deploymentId
    );
    
    if (result.success) {
      res.json({
        success: true,
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: result.message
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Test credentials in sandbox
 */
router.post('/credentials/test-sandbox', authenticate, validate({
  body: {
    serviceType: 'string',
    credentials: 'object',
    deploymentId: 'string'
  }
}), async (req, res, next) => {
  try {
    const { serviceType, credentials, deploymentId } = req.body;
    
    const result = await credentialValidator.testInSandbox(
      serviceType,
      credentials,
      deploymentId
    );
    
    if (result.success) {
      // Save service configuration
      const serviceConfig = new ServiceConfig({
        deploymentId,
        serviceType,
        serviceName: `${serviceType}-${deploymentId}`,
        credentials,
        validated: true,
        validatedAt: new Date(),
        sandboxTested: true,
        sandboxTestedAt: new Date(),
        environment: 'sandbox'
      });
      await serviceConfig.save();
      
      res.json({
        success: true,
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'SANDBOX_TEST_FAILED',
          message: result.message
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Save service configuration
 */
router.post('/config', authenticate, validate({
  body: {
    deploymentId: 'string',
    serviceType: 'string',
    serviceName: 'string',
    credentials: 'object'
  }
}), async (req, res, next) => {
  try {
    const { deploymentId, serviceType, serviceName, credentials, terraformProviderConfig } = req.body;
    
    const serviceConfig = new ServiceConfig({
      deploymentId,
      serviceType,
      serviceName,
      credentials,
      terraformProviderConfig,
      userId: req.user._id
    });
    
    await serviceConfig.save();
    
    res.status(201).json({
      success: true,
      data: {
        serviceConfig: {
          id: serviceConfig._id,
          deploymentId: serviceConfig.deploymentId,
          serviceType: serviceConfig.serviceType,
          serviceName: serviceConfig.serviceName,
          validated: serviceConfig.validated,
          sandboxTested: serviceConfig.sandboxTested
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get service configurations for a deployment
 */
router.get('/config/:deploymentId', authenticate, async (req, res, next) => {
  try {
    const { deploymentId } = req.params;
    
    const serviceConfigs = await ServiceConfig.find({ deploymentId })
      .select('-credentials -encryptedCredentials');
    
    res.json({
      success: true,
      data: {
        serviceConfigs
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Delete service configuration
 */
router.delete('/config/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const serviceConfig = await ServiceConfig.findById(id);
    if (!serviceConfig) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Service configuration not found'
        }
      });
    }
    
    await serviceConfig.deleteOne();
    
    res.json({
      success: true,
      message: 'Service configuration deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

