const Deployment = require('../models/Deployment');
const User = require('../models/User');
const notificationService = require('./notification');
const logger = require('../utils/logger');

/**
 * Approval Service
 * Manages deployment approval workflows
 */
class ApprovalService {
  /**
   * Approval rules by environment
   */
  approvalRules = {
    development: {
      required: false,
      autoApprove: true
    },
    staging: {
      required: true,
      approvers: ['tech_lead', 'senior-engineer'],
      minimumApprovals: 1,
      timeoutHours: 24
    },
    production: {
      required: true,
      approvers: ['tech_lead', 'engineering-manager', 'devops'],
      minimumApprovals: 2,
      requiresChangeTicket: false,
      maintenanceWindowOnly: false,
      timeoutHours: 48
    }
  };

  /**
   * Request approval for deployment
   */
  async requestApproval(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const rules = this.approvalRules[deployment.environment];
      if (!rules || !rules.required) {
        return { approved: true, autoApproved: true };
      }

      // Find potential approvers
      const approvers = await User.find({
        role: { $in: rules.approvers }
      });

      // Update deployment
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          approvalRequired: true,
          approvalStatus: 'pending',
          requiredApprovals: rules.minimumApprovals,
          approvalExpiresAt: new Date(Date.now() + rules.timeoutHours * 60 * 60 * 1000)
        }
      );

      // Send notifications to approvers
      await notificationService.requestApproval(deployment, approvers);

      logger.info('Approval requested', {
        deploymentId,
        approvers: approvers.length,
        requiredApprovals: rules.minimumApprovals
      });

      return {
        approved: false,
        approvers: approvers.map(a => ({ id: a._id, email: a.email, role: a.role })),
        requiredApprovals: rules.minimumApprovals
      };
    } catch (error) {
      logger.error('Request approval error:', error);
      throw error;
    }
  }

  /**
   * Approve deployment
   */
  async approve(deploymentId, userId, comment = '') {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      if (deployment.approvalStatus !== 'pending') {
        throw new Error(`Deployment is not pending approval (status: ${deployment.approvalStatus})`);
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user can approve
      const rules = this.approvalRules[deployment.environment];
      if (!rules.approvers.includes(user.role)) {
        throw new Error(`User role ${user.role} cannot approve ${deployment.environment} deployments`);
      }

      // Check if already approved by this user
      const existingApproval = deployment.approvals.find(
        a => a.userId.toString() === userId.toString()
      );
      if (existingApproval) {
        throw new Error('You have already approved this deployment');
      }

      // Add approval
      deployment.approvals.push({
        userId,
        userName: user.name,
        decision: 'approved',
        comment,
        timestamp: new Date()
      });

      // Check if minimum approvals met
      const approvalCount = deployment.approvals.filter(a => a.decision === 'approved').length;
      const isApproved = approvalCount >= deployment.requiredApprovals;

      if (isApproved) {
        deployment.approvalStatus = 'approved';
        
        // Transition to next state
        const deploymentOrchestrator = require('./deploymentOrchestrator');
        
        if (deployment.status === 'PENDING_APPROVAL') {
          await deploymentOrchestrator.transitionState(deploymentId, 'SANDBOX_DEPLOYING');
          await deploymentOrchestrator.processDeployment(deploymentId);
        } else if (deployment.status === 'SANDBOX_VALIDATED') {
          await deploymentOrchestrator.transitionState(deploymentId, 'APPROVED');
          await deploymentOrchestrator.processDeployment(deploymentId);
        }
      }

      await deployment.save();

      // Notify about approval
      await notificationService.approvalReceived(deployment, user, isApproved);

      logger.info('Deployment approved', {
        deploymentId,
        userId,
        approvalCount,
        isApproved
      });

      return {
        approved: isApproved,
        approvalCount,
        requiredApprovals: deployment.requiredApprovals
      };
    } catch (error) {
      logger.error('Approve deployment error:', error);
      throw error;
    }
  }

  /**
   * Reject deployment
   */
  async reject(deploymentId, userId, reason = '') {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      if (deployment.approvalStatus !== 'pending') {
        throw new Error(`Deployment is not pending approval (status: ${deployment.approvalStatus})`);
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user can reject
      const rules = this.approvalRules[deployment.environment];
      if (!rules.approvers.includes(user.role)) {
        throw new Error(`User role ${user.role} cannot reject ${deployment.environment} deployments`);
      }

      // Update deployment
      deployment.approvalStatus = 'rejected';
      deployment.approvals.push({
        userId,
        userName: user.name,
        decision: 'rejected',
        comment: reason,
        timestamp: new Date()
      });

      await deployment.save();

      // Transition to REJECTED state
      const deploymentOrchestrator = require('./deploymentOrchestrator');
      await deploymentOrchestrator.transitionState(deploymentId, 'REJECTED', { reason });

      // Notify about rejection
      await notificationService.deploymentRejected(deployment, user, reason);

      logger.info('Deployment rejected', { deploymentId, userId, reason });

      return { rejected: true };
    } catch (error) {
      logger.error('Reject deployment error:', error);
      throw error;
    }
  }

  /**
   * Get pending approvals for a user
   */
  async getPendingApprovals(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const rules = this.approvalRules;
      const allowedRoles = Object.values(rules)
        .flatMap(r => r.approvers || [])
        .filter((role, index, self) => self.indexOf(role) === index);

      if (!allowedRoles.includes(user.role)) {
        return [];
      }

      const deployments = await Deployment.find({
        approvalStatus: 'pending',
        environment: {
          $in: Object.keys(rules).filter(env => {
            const envRules = rules[env];
            return envRules.required && envRules.approvers.includes(user.role);
          })
        }
      }).sort({ createdAt: -1 });

      return deployments;
    } catch (error) {
      logger.error('Get pending approvals error:', error);
      throw error;
    }
  }
}

// Singleton instance
const approvalService = new ApprovalService();

module.exports = approvalService;

