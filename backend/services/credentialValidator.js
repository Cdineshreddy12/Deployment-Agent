const ServiceProvider = require('./serviceProvider');
const logger = require('../utils/logger');

/**
 * Credential Validator Service
 * Validates credentials for various services in sandbox before deployment
 */
class CredentialValidator {
  constructor() {
    this.validatedServices = new Map();
  }

  /**
   * Validate credentials for a service
   */
  async validateServiceCredentials(serviceType, credentials, deploymentId = null) {
    try {
      logger.info(`Validating credentials for ${serviceType}`, { deploymentId });

      const provider = new ServiceProvider(serviceType, credentials);
      const result = await provider.validateCredentials();

      // Store validated service
      const serviceKey = `${serviceType}_${deploymentId || 'default'}`;
      this.validatedServices.set(serviceKey, {
        serviceType,
        credentials: this.sanitizeCredentials(credentials),
        validatedAt: new Date(),
        result
      });

      logger.info(`Credentials validated successfully for ${serviceType}`, { deploymentId });
      
      return {
        success: true,
        serviceType,
        result,
        message: `Credentials validated successfully for ${serviceType}`
      };
    } catch (error) {
      logger.error(`Credential validation failed for ${serviceType}:`, error);
      return {
        success: false,
        serviceType,
        error: error.message,
        message: `Credential validation failed for ${serviceType}: ${error.message}`
      };
    }
  }

  /**
   * Test credentials in sandbox environment
   */
  async testInSandbox(serviceType, credentials, deploymentId) {
    try {
      logger.info(`Testing ${serviceType} credentials in sandbox`, { deploymentId });

      // First validate credentials
      const validation = await this.validateServiceCredentials(serviceType, credentials, deploymentId);
      
      if (!validation.success) {
        return validation;
      }

      // Perform a test operation in sandbox
      const provider = new ServiceProvider(serviceType, credentials);
      const testResult = await this.performSandboxTest(provider, serviceType);

      return {
        success: true,
        serviceType,
        validation,
        sandboxTest: testResult,
        message: `Sandbox test completed successfully for ${serviceType}`
      };
    } catch (error) {
      logger.error(`Sandbox test failed for ${serviceType}:`, error);
      return {
        success: false,
        serviceType,
        error: error.message,
        message: `Sandbox test failed for ${serviceType}: ${error.message}`
      };
    }
  }

  /**
   * Perform a test operation in sandbox
   */
  async performSandboxTest(provider, serviceType) {
    switch (serviceType.toLowerCase()) {
      case 'aws':
        // Test S3 bucket access
        const AWS = require('aws-sdk');
        AWS.config.update({
          accessKeyId: provider.credentials.accessKeyId,
          secretAccessKey: provider.credentials.secretAccessKey,
          region: provider.credentials.region || 'us-east-1'
        });
        const s3 = new AWS.S3();
        await s3.listBuckets().promise();
        return { operation: 'listBuckets', success: true };

      case 'supabase':
        // Test API access
        const axios = require('axios');
        await axios.get(`${provider.credentials.projectUrl}/rest/v1/`, {
          headers: { 'apikey': provider.credentials.apiKey }
        });
        return { operation: 'apiAccess', success: true };

      case 'postgresql':
      case 'postgres':
        // Test connection and simple query
        const { Client } = require('pg');
        const client = new Client(provider.credentials.connectionString || provider.credentials);
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return { operation: 'connectionTest', success: true };

      case 'mongodb':
      case 'mongo':
        // Test connection
        const mongoose = require('mongoose');
        await mongoose.connect(provider.credentials.connectionString);
        await mongoose.connection.db.admin().ping();
        return { operation: 'connectionTest', success: true };

      case 'redis':
        // Test connection
        const redis = require('redis');
        const redisClient = redis.createClient({
          socket: {
            host: provider.credentials.host || 'localhost',
            port: provider.credentials.port || 6379
          },
          password: provider.credentials.password
        });
        await redisClient.connect();
        await redisClient.ping();
        await redisClient.quit();
        return { operation: 'ping', success: true };

      default:
        return { operation: 'validationOnly', success: true };
    }
  }

  /**
   * Sanitize credentials for logging (remove sensitive data)
   */
  sanitizeCredentials(credentials) {
    const sanitized = { ...credentials };
    const sensitiveKeys = ['password', 'secret', 'key', 'token', 'apiKey', 'accessKey', 'secretAccessKey', 'clientSecret'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
        sanitized[key] = '***REDACTED***';
      }
    }
    
    return sanitized;
  }

  /**
   * Get required credentials for a service type
   */
  getRequiredCredentials(serviceType) {
    const requirements = {
      aws: {
        accessKeyId: 'AWS Access Key ID',
        secretAccessKey: 'AWS Secret Access Key',
        region: 'AWS Region (optional, defaults to us-east-1)'
      },
      supabase: {
        projectUrl: 'Supabase Project URL',
        apiKey: 'Supabase API Key'
      },
      postgresql: {
        connectionString: 'PostgreSQL Connection String (or individual fields)',
        host: 'Database Host',
        port: 'Database Port (default: 5432)',
        database: 'Database Name',
        user: 'Database User',
        password: 'Database Password'
      },
      mongodb: {
        connectionString: 'MongoDB Connection String'
      },
      redis: {
        host: 'Redis Host',
        port: 'Redis Port (default: 6379)',
        password: 'Redis Password (optional)'
      },
      elasticsearch: {
        url: 'Elasticsearch URL',
        username: 'Username (optional)',
        password: 'Password (optional)'
      },
      azure: {
        subscriptionId: 'Azure Subscription ID',
        clientId: 'Azure Client ID',
        clientSecret: 'Azure Client Secret',
        tenantId: 'Azure Tenant ID'
      },
      gcp: {
        projectId: 'GCP Project ID',
        keyFile: 'GCP Service Account Key File (JSON)'
      }
    };

    return requirements[serviceType.toLowerCase()] || {};
  }
}

module.exports = new CredentialValidator();

