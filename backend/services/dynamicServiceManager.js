const ServiceDefinition = require('../models/ServiceDefinition');
const ServiceConfig = require('../models/ServiceConfig');
const aiCodeGenerator = require('./aiCodeGenerator');
const logger = require('../utils/logger');

/**
 * Dynamic Service Manager
 * Manages services dynamically - no hardcoding
 * Uses AI to discover, validate, and test services
 */
class DynamicServiceManager {
  constructor() {
    this.serviceCache = new Map();
  }

  /**
   * Register or discover a new service type dynamically
   */
  async registerService(serviceType, serviceDescription, userProvidedSchema = null) {
    try {
      // Check if service already exists
      let serviceDef = await ServiceDefinition.findOne({ serviceType });
      
      if (serviceDef) {
        logger.info(`Service ${serviceType} already registered`);
        return serviceDef;
      }

      // Generate credential schema using AI if not provided
      let credentialSchema;
      if (userProvidedSchema) {
        credentialSchema = userProvidedSchema;
      } else {
        const schemaResult = await aiCodeGenerator.generateCredentialSchema(
          serviceType,
          serviceDescription
        );
        credentialSchema = schemaResult.schema;
      }

      // Generate connection test code using AI
      const testCodeResult = await aiCodeGenerator.generateConnectionTestCode(
        serviceType,
        serviceDescription,
        credentialSchema
      );

      // Create service definition
      serviceDef = new ServiceDefinition({
        serviceType,
        displayName: serviceType,
        description: serviceDescription,
        credentialSchema,
        connectionTestCode: {
          language: testCodeResult.language,
          code: testCodeResult.code,
          generatedAt: new Date(),
          generatedBy: 'ai'
        },
        active: true
      });

      await serviceDef.save();
      
      // Cache it
      this.serviceCache.set(serviceType, serviceDef);
      
      logger.info(`Registered new service: ${serviceType}`);
      
      return serviceDef;
    } catch (error) {
      logger.error(`Failed to register service ${serviceType}:`, error);
      throw error;
    }
  }

  /**
   * Get service definition (from cache or DB)
   */
  async getServiceDefinition(serviceType) {
    if (this.serviceCache.has(serviceType)) {
      return this.serviceCache.get(serviceType);
    }

    const serviceDef = await ServiceDefinition.findOne({ 
      serviceType, 
      active: true 
    });
    
    if (serviceDef) {
      this.serviceCache.set(serviceType, serviceDef);
    }
    
    return serviceDef;
  }

  /**
   * Test service connection dynamically using AI-generated code
   */
  async testServiceConnection(serviceType, credentials, deploymentId = null) {
    try {
      // Get service definition
      let serviceDef = await this.getServiceDefinition(serviceType);
      
      // If service not registered, register it dynamically
      if (!serviceDef) {
        logger.info(`Service ${serviceType} not found, registering dynamically...`);
        serviceDef = await this.registerService(
          serviceType,
          `Service type: ${serviceType}`
        );
      }

      // Execute AI-generated test code in sandbox
      const testResult = await this.executeConnectionTest(
        serviceDef.connectionTestCode.code,
        credentials
      );

      // Save service configuration if test successful
      if (testResult.success && deploymentId) {
        await this.saveServiceConfig(serviceType, credentials, deploymentId, testResult);
      }

      return testResult;
    } catch (error) {
      logger.error(`Failed to test service connection for ${serviceType}:`, error);
      return {
        success: false,
        error: error.message,
        message: `Connection test failed: ${error.message}`
      };
    }
  }

  /**
   * Execute connection test code in isolated sandbox
   */
  async executeConnectionTest(testCode, credentials) {
    try {
      // Create isolated VM context for code execution
      const vm = require('vm');
      const { promisify } = require('util');
      const { exec } = require('child_process');
      const execAsync = promisify(exec);
      
      // Create a safe execution context
      const context = {
        require: require,
        console: {
          log: (...args) => logger.debug('Test code:', ...args),
          error: (...args) => logger.error('Test code error:', ...args)
        },
        setTimeout,
        clearTimeout,
        Buffer,
        process: {
          env: {},
          exit: () => {}
        },
        // Add common libraries
        axios: require('axios'),
        mongoose: require('mongoose'),
        redis: require('redis'),
        pg: require('pg'),
        AWS: require('aws-sdk')
      };

      // Wrap test code in async function
      const wrappedCode = `
        (async () => {
          ${testCode}
          
          // Execute test
          try {
            const result = await testConnection(${JSON.stringify(credentials)});
            return result;
          } catch (error) {
            return {
              success: false,
              message: error.message,
              error: error.stack
            };
          }
        })()
      `;

      // Execute in VM with timeout
      const sandbox = vm.createContext(context);
      const script = new vm.Script(wrappedCode);
      
      // Execute with 10 second timeout
      const result = await Promise.race([
        script.runInContext(sandbox),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection test timeout')), 10000)
        )
      ]);

      return result;
    } catch (error) {
      logger.error('Connection test execution failed:', error);
      return {
        success: false,
        error: error.message,
        message: `Test execution failed: ${error.message}`
      };
    }
  }

  /**
   * Save service configuration after successful test
   */
  async saveServiceConfig(serviceType, credentials, deploymentId, testResult) {
    try {
      // Generate Terraform provider config if applicable
      let terraformProviderConfig = null;
      try {
        const providerResult = await aiCodeGenerator.generateTerraformProviderConfig(
          serviceType,
          credentials
        );
        terraformProviderConfig = providerResult.providerCode;
      } catch (error) {
        logger.warn(`Failed to generate Terraform config for ${serviceType}:`, error);
      }

      const serviceConfig = new ServiceConfig({
        deploymentId,
        serviceType,
        serviceName: `${serviceType}-${deploymentId}`,
        credentials,
        validated: true,
        validatedAt: new Date(),
        sandboxTested: true,
        sandboxTestedAt: new Date(),
        terraformProviderConfig,
        environment: 'sandbox',
        metadata: {
          testResult
        }
      });

      await serviceConfig.save();
      
      logger.info(`Saved service config for ${serviceType}`, { deploymentId });
      
      return serviceConfig;
    } catch (error) {
      logger.error('Failed to save service config:', error);
      throw error;
    }
  }

  /**
   * List all registered services
   */
  async listServices() {
    const services = await ServiceDefinition.find({ active: true })
      .select('serviceType displayName description active');
    
    return services;
  }

  /**
   * Update service definition (e.g., update test code)
   */
  async updateServiceDefinition(serviceType, updates) {
    const serviceDef = await ServiceDefinition.findOne({ serviceType });
    
    if (!serviceDef) {
      throw new Error(`Service ${serviceType} not found`);
    }

    Object.assign(serviceDef, updates);
    await serviceDef.save();
    
    // Clear cache
    this.serviceCache.delete(serviceType);
    
    return serviceDef;
  }
}

module.exports = new DynamicServiceManager();

