const CredentialRequest = require('../models/CredentialRequest');
const credentialManager = require('./credentialManager');
const logger = require('../utils/logger');
const { encrypt } = require('../utils/encryption');

/**
 * Credential Approval Service
 * Popup-based credential collection with user approval
 */
class CredentialApprovalService {
  /**
   * Request credentials via popup
   */
  async requestCredentials(deploymentId, serviceType, schema, userId) {
    try {
      // Check if there's already a pending request
      const existingRequest = await CredentialRequest.findOne({
        deploymentId,
        serviceType,
        status: 'pending'
      });

      if (existingRequest && !existingRequest.isExpired()) {
        return {
          requestId: existingRequest.requestId,
          status: 'pending',
          message: 'Credential request already pending'
        };
      }

      // Create new credential request
      const request = new CredentialRequest({
        deploymentId,
        userId,
        serviceType,
        schema,
        status: 'pending'
      });

      await request.save();

      logger.info('Credential request created', {
        deploymentId,
        serviceType,
        requestId: request.requestId
      });

      return {
        requestId: request.requestId,
        status: 'pending',
        serviceType,
        schema,
        expiresAt: request.expiresAt
      };
    } catch (error) {
      logger.error('Failed to create credential request:', error);
      throw error;
    }
  }

  /**
   * Wait for credential approval
   */
  async waitForCredentialApproval(requestId, timeout = 300000, interval = 2000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const request = await CredentialRequest.findOne({ requestId });
      
      if (!request) {
        throw new Error('Credential request not found');
      }

      if (request.isExpired()) {
        request.status = 'expired';
        await request.save();
        return {
          approved: false,
          reason: 'Request expired'
        };
      }

      if (request.status === 'approved') {
        return {
          approved: true,
          credentials: request.credentials,
          requestId
        };
      }

      if (request.status === 'rejected') {
        return {
          approved: false,
          reason: request.metadata.rejectionReason || 'Request rejected'
        };
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    return {
      approved: false,
      reason: 'Timeout waiting for approval'
    };
  }

  /**
   * Approve credentials
   */
  async approveCredentials(requestId, credentials, userId) {
    try {
      const request = await CredentialRequest.findOne({ requestId });
      
      if (!request) {
        throw new Error('Credential request not found');
      }

      if (request.userId.toString() !== userId.toString()) {
        throw new Error('Unauthorized: User does not own this request');
      }

      if (request.status !== 'pending') {
        throw new Error(`Request already ${request.status}`);
      }

      if (request.isExpired()) {
        request.status = 'expired';
        await request.save();
        throw new Error('Request expired');
      }

      // Validate credentials against schema
      const validation = this.validateCredentials(credentials, request.schema);
      if (!validation.valid) {
        throw new Error(`Invalid credentials: ${validation.errors.join(', ')}`);
      }

      // Store credentials securely via credentialManager
      await credentialManager.storeCredential(
        userId,
        request.serviceType,
        `${request.serviceType}_${request.deploymentId}`,
        credentials,
        {
          description: `Credentials for ${request.serviceType} (deployment: ${request.deploymentId})`,
          reusable: true
        }
      );

      // Mark request as approved
      await request.approve(credentials);

      logger.info('Credentials approved', {
        requestId,
        serviceType: request.serviceType,
        deploymentId: request.deploymentId
      });

      return {
        success: true,
        requestId,
        serviceType: request.serviceType
      };
    } catch (error) {
      logger.error('Failed to approve credentials:', error);
      throw error;
    }
  }

  /**
   * Reject credential request
   */
  async rejectCredentials(requestId, reason, userId) {
    try {
      const request = await CredentialRequest.findOne({ requestId });
      
      if (!request) {
        throw new Error('Credential request not found');
      }

      if (request.userId.toString() !== userId.toString()) {
        throw new Error('Unauthorized');
      }

      await request.reject(reason);

      return {
        success: true,
        requestId
      };
    } catch (error) {
      logger.error('Failed to reject credentials:', error);
      throw error;
    }
  }

  /**
   * Get pending credential requests
   */
  async getPendingCredentialRequests(deploymentId) {
    try {
      const requests = await CredentialRequest.find({
        deploymentId,
        status: 'pending'
      })
      .sort({ requestedAt: 1 })
      .lean();

      // Filter out expired requests
      const validRequests = requests.filter(req => {
        const expiresAt = req.expiresAt ? new Date(req.expiresAt) : null;
        return !expiresAt || expiresAt > new Date();
      });

      // Mark expired requests
      const expiredIds = requests
        .filter(req => {
          const expiresAt = req.expiresAt ? new Date(req.expiresAt) : null;
          return expiresAt && expiresAt <= new Date();
        })
        .map(req => req._id);

      if (expiredIds.length > 0) {
        await CredentialRequest.updateMany(
          { _id: { $in: expiredIds } },
          { status: 'expired' }
        );
      }

      return validRequests.map(req => ({
        requestId: req.requestId,
        serviceType: req.serviceType,
        schema: req.schema,
        requestedAt: req.requestedAt,
        expiresAt: req.expiresAt
      }));
    } catch (error) {
      logger.error('Failed to get pending requests:', error);
      return [];
    }
  }

  /**
   * Validate credentials against schema
   */
  validateCredentials(credentials, schema) {
    const errors = [];

    if (!schema || !schema.fields) {
      return {
        valid: true,
        errors: []
      };
    }

    for (const field of schema.fields) {
      const fieldName = field.name || field.key;
      const value = credentials[fieldName];

      // Check required fields
      if (field.required && (!value || value.trim() === '')) {
        errors.push(`${fieldName} is required`);
      }

      // Check type
      if (value && field.type) {
        if (field.type === 'number' && isNaN(Number(value))) {
          errors.push(`${fieldName} must be a number`);
        }
        if (field.type === 'boolean' && value !== 'true' && value !== 'false' && value !== true && value !== false) {
          errors.push(`${fieldName} must be a boolean`);
        }
      }

      // Check pattern
      if (value && field.pattern && !new RegExp(field.pattern).test(value)) {
        errors.push(`${fieldName} does not match required pattern`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Singleton instance
const credentialApprovalService = new CredentialApprovalService();

module.exports = credentialApprovalService;

