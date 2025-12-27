const logger = require('../utils/logger');

/**
 * Service Provider Abstraction Layer
 * Supports multiple cloud providers and services: AWS, Supabase, PostgreSQL, MongoDB, Redis, Kibana, etc.
 */
class ServiceProvider {
  constructor(serviceType, credentials) {
    this.serviceType = serviceType;
    this.credentials = credentials;
    this.validated = false;
  }

  /**
   * Validate service credentials
   */
  async validateCredentials() {
    try {
      switch (this.serviceType.toLowerCase()) {
        case 'aws':
          return await this.validateAWS();
        case 'supabase':
          return await this.validateSupabase();
        case 'postgresql':
        case 'postgres':
          return await this.validatePostgreSQL();
        case 'mongodb':
        case 'mongo':
          return await this.validateMongoDB();
        case 'redis':
          return await this.validateRedis();
        case 'kibana':
        case 'elasticsearch':
          return await this.validateElasticsearch();
        case 'azure':
          return await this.validateAzure();
        case 'gcp':
        case 'google-cloud':
          return await this.validateGCP();
        default:
          throw new Error(`Unsupported service type: ${this.serviceType}`);
      }
    } catch (error) {
      logger.error(`Credential validation failed for ${this.serviceType}:`, error);
      throw error;
    }
  }

  /**
   * Validate AWS credentials
   */
  async validateAWS() {
    const AWS = require('aws-sdk');
    
    if (!this.credentials.accessKeyId || !this.credentials.secretAccessKey) {
      throw new Error('AWS credentials missing: accessKeyId and secretAccessKey required');
    }

    AWS.config.update({
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      region: this.credentials.region || 'us-east-1'
    });

    const sts = new AWS.STS();
    const identity = await sts.getCallerIdentity().promise();
    
    this.validated = true;
    return {
      success: true,
      accountId: identity.Account,
      userId: identity.UserId,
      arn: identity.Arn
    };
  }

  /**
   * Validate Supabase credentials
   */
  async validateSupabase() {
    if (!this.credentials.projectUrl || !this.credentials.apiKey) {
      throw new Error('Supabase credentials missing: projectUrl and apiKey required');
    }

    const axios = require('axios');
    const response = await axios.get(
      `${this.credentials.projectUrl}/rest/v1/`,
      {
        headers: {
          'apikey': this.credentials.apiKey,
          'Authorization': `Bearer ${this.credentials.apiKey}`
        },
        timeout: 5000
      }
    );

    this.validated = true;
    return {
      success: true,
      projectUrl: this.credentials.projectUrl,
      status: response.status
    };
  }

  /**
   * Validate PostgreSQL credentials
   */
  async validatePostgreSQL() {
    const { Client } = require('pg');
    
    if (!this.credentials.connectionString && !this.credentials.host) {
      throw new Error('PostgreSQL credentials missing: connectionString or host required');
    }

    const client = new Client(
      this.credentials.connectionString || {
        host: this.credentials.host,
        port: this.credentials.port || 5432,
        database: this.credentials.database || 'postgres',
        user: this.credentials.user,
        password: this.credentials.password,
        ssl: this.credentials.ssl || false
      }
    );

    await client.connect();
    const result = await client.query('SELECT version()');
    await client.end();

    this.validated = true;
    return {
      success: true,
      version: result.rows[0].version
    };
  }

  /**
   * Validate MongoDB credentials
   */
  async validateMongoDB() {
    const mongoose = require('mongoose');
    
    if (!this.credentials.connectionString) {
      throw new Error('MongoDB credentials missing: connectionString required');
    }

    await mongoose.connect(this.credentials.connectionString, {
      serverSelectionTimeoutMS: 5000
    });

    const admin = mongoose.connection.db.admin();
    const serverStatus = await admin.serverStatus();

    this.validated = true;
    return {
      success: true,
      version: serverStatus.version,
      host: mongoose.connection.host
    };
  }

  /**
   * Validate Redis credentials
   */
  async validateRedis() {
    const redis = require('redis');
    
    const client = redis.createClient({
      socket: {
        host: this.credentials.host || 'localhost',
        port: this.credentials.port || 6379
      },
      password: this.credentials.password
    });

    await client.connect();
    const pong = await client.ping();
    await client.quit();

    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }

    this.validated = true;
    return {
      success: true,
      response: pong
    };
  }

  /**
   * Validate Elasticsearch/Kibana credentials
   */
  async validateElasticsearch() {
    const axios = require('axios');
    
    if (!this.credentials.url) {
      throw new Error('Elasticsearch credentials missing: url required');
    }

    const auth = this.credentials.username && this.credentials.password
      ? { username: this.credentials.username, password: this.credentials.password }
      : {};

    const response = await axios.get(`${this.credentials.url}/_cluster/health`, {
      auth,
      timeout: 5000
    });

    this.validated = true;
    return {
      success: true,
      clusterName: response.data.cluster_name,
      status: response.data.status
    };
  }

  /**
   * Validate Azure credentials
   */
  async validateAzure() {
    // Azure validation would go here
    // For now, basic check
    if (!this.credentials.subscriptionId || !this.credentials.clientId || !this.credentials.clientSecret) {
      throw new Error('Azure credentials missing: subscriptionId, clientId, and clientSecret required');
    }

    this.validated = true;
    return {
      success: true,
      subscriptionId: this.credentials.subscriptionId
    };
  }

  /**
   * Validate GCP credentials
   */
  async validateGCP() {
    if (!this.credentials.projectId || !this.credentials.keyFile) {
      throw new Error('GCP credentials missing: projectId and keyFile (or credentials JSON) required');
    }

    // GCP validation would go here
    this.validated = true;
    return {
      success: true,
      projectId: this.credentials.projectId
    };
  }

  /**
   * Get Terraform provider configuration for this service
   */
  getTerraformProviderConfig() {
    switch (this.serviceType.toLowerCase()) {
      case 'aws':
        return {
          provider: 'aws',
          config: {
            access_key: this.credentials.accessKeyId,
            secret_key: this.credentials.secretAccessKey,
            region: this.credentials.region || 'us-east-1'
          }
        };
      case 'supabase':
        return {
          provider: 'supabase',
          config: {
            api_url: this.credentials.projectUrl,
            api_key: this.credentials.apiKey
          }
        };
      case 'postgresql':
      case 'postgres':
        return {
          provider: 'postgresql',
          config: {
            host: this.credentials.host,
            port: this.credentials.port || 5432,
            database: this.credentials.database,
            username: this.credentials.user,
            password: this.credentials.password
          }
        };
      case 'mongodb':
      case 'mongo':
        return {
          provider: 'mongodbatlas',
          config: {
            public_key: this.credentials.publicKey,
            private_key: this.credentials.privateKey
          }
        };
      default:
        return null;
    }
  }
}

module.exports = ServiceProvider;

