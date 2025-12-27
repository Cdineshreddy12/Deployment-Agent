const GlobalCredential = require('../models/GlobalCredential');
const logger = require('../utils/logger');

/**
 * Credential Manager Service
 * Manages global credential storage and reuse
 */
class CredentialManager {
  /**
   * Store a credential
   */
  async storeCredential(userId, serviceType, name, credentials, options = {}) {
    try {
      const credential = new GlobalCredential({
        userId,
        serviceType,
        name,
        credentials, // Will be encrypted by pre-save hook
        tags: options.tags || [],
        reusable: options.reusable !== false,
        sharedWith: options.sharedWith || [],
        description: options.description
      });
      
      credential.encryptCredentials(credentials);
      await credential.save();
      
      logger.info('Credential stored', {
        userId,
        serviceType,
        name,
        credentialId: credential._id
      });
      
      return credential;
    } catch (error) {
      logger.error('Failed to store credential:', error);
      throw error;
    }
  }

  /**
   * Get credential by ID
   */
  async getCredential(credentialId, userId) {
    const credential = await GlobalCredential.findOne({
      _id: credentialId,
      $or: [
        { userId },
        { sharedWith: userId }
      ]
    });
    
    if (!credential) {
      throw new Error('Credential not found or access denied');
    }
    
    return credential;
  }

  /**
   * List credentials for a user
   */
  async listCredentials(userId, filters = {}) {
    const query = {
      $or: [
        { userId },
        { sharedWith: userId }
      ]
    };
    
    if (filters.serviceType) {
      query.serviceType = filters.serviceType;
    }
    
    if (filters.reusable !== undefined) {
      query.reusable = filters.reusable;
    }
    
    if (filters.tags && filters.tags.length > 0) {
      query.tags = { $in: filters.tags };
    }
    
    const credentials = await GlobalCredential.find(query).sort({ lastUsedAt: -1, createdAt: -1 });
    
    // Return without decrypted credentials (for listing)
    return credentials.map(cred => ({
      _id: cred._id,
      userId: cred.userId,
      serviceType: cred.serviceType,
      name: cred.name,
      tags: cred.tags,
      reusable: cred.reusable,
      description: cred.description,
      lastUsedAt: cred.lastUsedAt,
      usageCount: cred.usageCount,
      createdAt: cred.createdAt
    }));
  }

  /**
   * Get decrypted credentials
   */
  async getDecryptedCredentials(credentialId, userId) {
    const credential = await this.getCredential(credentialId, userId);
    const decrypted = credential.decryptCredentials();
    
    // Mark as used
    await credential.markUsed();
    
    return {
      ...decrypted,
      credentialId: credential._id,
      serviceType: credential.serviceType,
      name: credential.name
    };
  }

  /**
   * Update credential
   */
  async updateCredential(credentialId, userId, updates) {
    const credential = await this.getCredential(credentialId, userId);
    
    // Check ownership
    if (credential.userId.toString() !== userId.toString()) {
      throw new Error('Only credential owner can update');
    }
    
    if (updates.name) credential.name = updates.name;
    if (updates.description) credential.description = updates.description;
    if (updates.tags) credential.tags = updates.tags;
    if (updates.reusable !== undefined) credential.reusable = updates.reusable;
    if (updates.sharedWith) credential.sharedWith = updates.sharedWith;
    
    if (updates.credentials) {
      credential.encryptCredentials(updates.credentials);
    }
    
    await credential.save();
    return credential;
  }

  /**
   * Delete credential
   */
  async deleteCredential(credentialId, userId) {
    const credential = await this.getCredential(credentialId, userId);
    
    // Check ownership
    if (credential.userId.toString() !== userId.toString()) {
      throw new Error('Only credential owner can delete');
    }
    
    await GlobalCredential.deleteOne({ _id: credentialId });
    logger.info('Credential deleted', { credentialId, userId });
  }

  /**
   * Reuse credential in a deployment
   */
  async reuseCredential(credentialId, deploymentId, userId) {
    const decrypted = await this.getDecryptedCredentials(credentialId, userId);
    
    logger.info('Credential reused', {
      credentialId,
      deploymentId,
      userId,
      serviceType: decrypted.serviceType
    });
    
    return decrypted;
  }

  /**
   * Find credentials by service type
   */
  async findByServiceType(serviceType, userId) {
    return this.listCredentials(userId, { serviceType, reusable: true });
  }

  /**
   * Suggest credentials for a deployment
   */
  async suggestCredentials(deploymentId, requiredServices, userId) {
    const suggestions = {};
    
    for (const serviceType of requiredServices) {
      const credentials = await this.findByServiceType(serviceType, userId);
      if (credentials.length > 0) {
        suggestions[serviceType] = credentials.map(cred => ({
          id: cred._id,
          name: cred.name,
          description: cred.description,
          lastUsedAt: cred.lastUsedAt,
          usageCount: cred.usageCount
        }));
      }
    }
    
    return suggestions;
  }

  /**
   * Get GitHub token for a user
   * Returns the decrypted token from the database
   */
  async getGitHubToken(userId) {
    try {
      const credentials = await GlobalCredential.find({
        userId,
        serviceType: 'github',
        reusable: true
      }).sort({ lastUsedAt: -1, createdAt: -1 });

      if (credentials.length === 0) {
        return null;
      }

      // Get the most recently used credential
      const credential = credentials[0];
      const decrypted = credential.decryptCredentials();
      
      // Mark as used
      await credential.markUsed();
      
      // Return the token (assuming credentials object has a token field)
      return decrypted.token || decrypted.githubToken || null;
    } catch (error) {
      logger.error('Failed to get GitHub token:', error);
      return null;
    }
  }

  /**
   * Store or update GitHub token for a user
   * Uses upsert pattern - updates if exists, creates if not
   */
  async storeGitHubToken(userId, token, options = {}) {
    try {
      // Find existing GitHub credential for this user
      const existing = await GlobalCredential.findOne({
        userId,
        serviceType: 'github',
        name: options.name || 'GitHub Personal Access Token'
      });

      const credentialsData = { token };

      if (existing) {
        // Update existing credential
        existing.encryptCredentials(credentialsData);
        if (options.name) existing.name = options.name;
        if (options.description) existing.description = options.description;
        await existing.save();
        
        logger.info('GitHub token updated', {
          userId,
          credentialId: existing._id
        });
        
        return existing;
      } else {
        // Create new credential
        const credential = await this.storeCredential(
          userId,
          'github',
          options.name || 'GitHub Personal Access Token',
          credentialsData,
          {
            reusable: true,
            description: options.description || 'GitHub Personal Access Token for repository access',
            tags: ['github', 'token', ...(options.tags || [])]
          }
        );
        
        logger.info('GitHub token stored', {
          userId,
          credentialId: credential._id
        });
        
        return credential;
      }
    } catch (error) {
      logger.error('Failed to store GitHub token:', error);
      throw error;
    }
  }

  /**
   * Delete GitHub token for a user
   */
  async deleteGitHubToken(userId) {
    try {
      const result = await GlobalCredential.deleteMany({
        userId,
        serviceType: 'github'
      });
      
      logger.info('GitHub token deleted', {
        userId,
        deletedCount: result.deletedCount
      });
      
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Failed to delete GitHub token:', error);
      throw error;
    }
  }

  /**
   * Check if user has a GitHub token stored
   */
  async hasGitHubToken(userId) {
    try {
      const count = await GlobalCredential.countDocuments({
        userId,
        serviceType: 'github',
        reusable: true
      });
      return count > 0;
    } catch (error) {
      logger.error('Failed to check GitHub token:', error);
      return false;
    }
  }
}

module.exports = new CredentialManager();

