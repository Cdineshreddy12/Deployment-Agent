const express = require('express');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const dynamicServiceManager = require('../services/dynamicServiceManager');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Register a new service type dynamically
 * POST /api/v1/services/register
 */
router.post('/register', authenticate, validate({
  body: {
    serviceType: 'string',
    serviceDescription: 'string',
    credentialSchema: 'object' // Optional - AI will generate if not provided
  }
}), async (req, res, next) => {
  try {
    const { serviceType, serviceDescription, credentialSchema } = req.body;
    
    const serviceDef = await dynamicServiceManager.registerService(
      serviceType,
      serviceDescription,
      credentialSchema
    );
    
    res.status(201).json({
      success: true,
      data: {
        serviceDefinition: {
          serviceType: serviceDef.serviceType,
          displayName: serviceDef.displayName,
          description: serviceDef.description,
          credentialSchema: serviceDef.credentialSchema
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Test service connection dynamically
 * POST /api/v1/services/test
 */
router.post('/test', authenticate, validate({
  body: {
    serviceType: 'string',
    credentials: 'object',
    deploymentId: 'string'
  }
}), async (req, res, next) => {
  try {
    const { serviceType, credentials, deploymentId } = req.body;
    
    logger.info(`Testing connection for ${serviceType}`, { deploymentId });
    
    const result = await dynamicServiceManager.testServiceConnection(
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
          code: 'CONNECTION_TEST_FAILED',
          message: result.message || result.error
        },
        data: result
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Get service definition
 * GET /api/v1/services/:serviceType
 */
router.get('/:serviceType', authenticate, async (req, res, next) => {
  try {
    const { serviceType } = req.params;
    
    const serviceDef = await dynamicServiceManager.getServiceDefinition(serviceType);
    
    if (!serviceDef) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: `Service ${serviceType} not found. Register it first or it will be auto-registered on first use.`
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        serviceDefinition: {
          serviceType: serviceDef.serviceType,
          displayName: serviceDef.displayName,
          description: serviceDef.description,
          credentialSchema: serviceDef.credentialSchema,
          terraformProvider: serviceDef.terraformProvider
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * List all registered services
 * GET /api/v1/services
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const services = await dynamicServiceManager.listServices();
    
    res.json({
      success: true,
      data: {
        services: services.map(s => ({
          serviceType: s.serviceType,
          displayName: s.displayName,
          description: s.description,
          active: s.active
        }))
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

