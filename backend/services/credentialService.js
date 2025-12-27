const DeploymentCredential = require('../models/DeploymentCredential');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const logger = require('../utils/logger');

/**
 * Credential Service
 * Manages retrieval and usage of stored deployment credentials
 */
class CredentialService {
  /**
   * Get AWS credentials for a user
   */
  static async getAWSCredentials(userId, credentialName = null) {
    const query = {
      userId,
      platform: 'aws',
      type: 'aws-credentials',
      active: true
    };

    if (credentialName) {
      query.name = credentialName;
    }

    const credential = await DeploymentCredential.findOne(query).sort({ lastUsed: -1 });

    if (!credential) {
      return null;
    }

    await credential.markAsUsed();
    return credential.getDecryptedData();
  }

  /**
   * Get SSH key for a user
   */
  static async getSSHKey(userId, credentialName = null) {
    const query = {
      userId,
      platform: 'ssh',
      type: 'ssh-key',
      active: true
    };

    if (credentialName) {
      query.name = credentialName;
    }

    const credential = await DeploymentCredential.findOne(query).sort({ lastUsed: -1 });

    if (!credential) {
      return null;
    }

    await credential.markAsUsed();
    const decrypted = credential.decryptData();
    
    // Save to temp file for use with SSH
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-key-'));
    const keyPath = path.join(tempDir, 'key.pem');
    await fs.writeFile(keyPath, decrypted.key, { mode: 0o600 });
    
    return {
      keyPath,
      keyContent: decrypted.key,
      tempDir // For cleanup later
    };
  }

  /**
   * Get .env file credentials
   */
  static async getEnvCredentials(userId, credentialName = null) {
    const query = {
      userId,
      type: 'env-file',
      active: true
    };

    if (credentialName) {
      query.name = credentialName;
    }

    const credential = await DeploymentCredential.findOne(query).sort({ lastUsed: -1 });

    if (!credential) {
      return null;
    }

    await credential.markAsUsed();
    return credential.getDecryptedData();
  }

  /**
   * Get all environment variables from stored .env files
   */
  static async getAllEnvVars(userId) {
    const credentials = await DeploymentCredential.find({
      userId,
      type: 'env-file',
      active: true
    });

    const allVars = {};
    for (const cred of credentials) {
      const vars = cred.getDecryptedData();
      Object.assign(allVars, vars);
    }

    return allVars;
  }

  /**
   * Set AWS credentials as environment variables for a process
   */
  static async setAWSEnvForProcess(userId, credentialName = null) {
    const creds = await this.getAWSCredentials(userId, credentialName);
    
    if (!creds) {
      return {};
    }

    return {
      AWS_ACCESS_KEY_ID: creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
      AWS_SESSION_TOKEN: creds.sessionToken,
      AWS_REGION: creds.region || 'us-east-1'
    };
  }

  /**
   * Get ECS cluster configuration from credentials
   */
  static async getECSConfig(userId) {
    const envVars = await this.getAllEnvVars(userId);
    
    return {
      clusterName: envVars.ECS_CLUSTER_NAME || process.env.ECS_CLUSTER_NAME,
      subnets: envVars.ECS_SUBNETS?.split(',') || process.env.ECS_SUBNETS?.split(','),
      securityGroups: envVars.ECS_SECURITY_GROUPS?.split(',') || process.env.ECS_SECURITY_GROUPS?.split(','),
      region: envVars.AWS_REGION || process.env.AWS_REGION || 'us-east-1'
    };
  }

  /**
   * Get EC2 configuration from credentials
   */
  static async getEC2Config(userId) {
    const envVars = await this.getAllEnvVars(userId);
    const sshKey = await this.getSSHKey(userId);
    
    return {
      host: envVars.EC2_HOST || process.env.EC2_HOST,
      username: envVars.EC2_USERNAME || 'ubuntu',
      sshKeyPath: sshKey?.keyPath || process.env.SSH_KEY_PATH,
      region: envVars.AWS_REGION || process.env.AWS_REGION || 'us-east-1'
    };
  }

  /**
   * Get Kubernetes configuration
   */
  static async getK8sConfig(userId) {
    const envVars = await this.getAllEnvVars(userId);
    
    return {
      context: envVars.KUBE_CONTEXT || process.env.KUBE_CONTEXT,
      namespace: envVars.KUBE_NAMESPACE || 'default',
      kubeconfig: envVars.KUBECONFIG || process.env.KUBECONFIG
    };
  }
}

module.exports = CredentialService;


