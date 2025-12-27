const nodemailer = require('nodemailer');
const { WebClient } = require('@slack/web-api');
const logger = require('../utils/logger');

/**
 * Notification Service
 * Handles notifications via Slack, Email, and WebSocket
 */
class NotificationService {
  constructor() {
    // Email transporter
    this.emailTransporter = null;
    if (process.env.SMTP_HOST) {
      this.emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
    }

    // Slack client
    this.slackClient = null;
    if (process.env.SLACK_WEBHOOK_URL) {
      // Using webhook for simplicity - can be upgraded to WebClient for more features
      this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    }
  }

  /**
   * Send Slack notification
   */
  async sendSlack(message, options = {}) {
    try {
      if (!this.slackWebhookUrl) {
        logger.warn('Slack webhook URL not configured');
        return;
      }

      const https = require('https');
      const url = require('url');

      const payload = {
        text: message,
        ...options
      };

      const parsedUrl = url.parse(this.slackWebhookUrl);
      const postData = JSON.stringify(payload);

      const options_https = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      return new Promise((resolve, reject) => {
        const req = https.request(options_https, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Slack API error: ${res.statusCode}`));
          }
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    } catch (error) {
      logger.error('Send Slack notification error:', error);
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(to, subject, text, html = null) {
    try {
      if (!this.emailTransporter) {
        logger.warn('Email transporter not configured');
        return;
      }

      const mailOptions = {
        from: process.env.SMTP_USER,
        to,
        subject,
        text,
        html: html || text
      };

      await this.emailTransporter.sendMail(mailOptions);
      logger.info('Email sent', { to, subject });
    } catch (error) {
      logger.error('Send email error:', error);
      throw error;
    }
  }

  /**
   * Request approval notification
   */
  async requestApproval(deployment, approvers) {
    const message = `🚀 Deployment Approval Requested\n\n` +
      `*Deployment:* ${deployment.name}\n` +
      `*Environment:* ${deployment.environment}\n` +
      `*Requested by:* ${deployment.userName}\n` +
      `*Estimated Cost:* $${deployment.estimatedMonthlyCost}/month\n` +
      `*Required Approvals:* ${deployment.requiredApprovals}\n\n` +
      `Please review and approve: ${process.env.FRONTEND_URL}/deployments/${deployment.deploymentId}`;

    // Send Slack notification
    await this.sendSlack(message, {
      channel: '#deployments',
      attachments: [{
        color: 'warning',
        fields: [
          { title: 'Deployment ID', value: deployment.deploymentId, short: true },
          { title: 'Environment', value: deployment.environment, short: true }
        ]
      }]
    });

    // Send email to approvers
    for (const approver of approvers) {
      if (approver.preferences?.notifications?.email) {
        await this.sendEmail(
          approver.email,
          `Deployment Approval Requested: ${deployment.name}`,
          message
        );
      }
    }
  }

  /**
   * Approval received notification
   */
  async approvalReceived(deployment, approver, isApproved) {
    const message = isApproved
      ? `✅ Deployment Approved\n\n` +
        `*Deployment:* ${deployment.name}\n` +
        `*Approved by:* ${approver.name}\n` +
        `*Status:* Ready for deployment`
      : `👍 Approval Received\n\n` +
        `*Deployment:* ${deployment.name}\n` +
        `*Approved by:* ${approver.name}\n` +
        `*Approvals:* ${deployment.approvals.filter(a => a.decision === 'approved').length}/${deployment.requiredApprovals}`;

    await this.sendSlack(message, {
      channel: '#deployments'
    });
  }

  /**
   * Deployment rejected notification
   */
  async deploymentRejected(deployment, approver, reason) {
    const message = `❌ Deployment Rejected\n\n` +
      `*Deployment:* ${deployment.name}\n` +
      `*Rejected by:* ${approver.name}\n` +
      `*Reason:* ${reason}`;

    await this.sendSlack(message, {
      channel: '#deployments'
    });

    // Notify requester
    const requester = await require('../models/User').findById(deployment.userId);
    if (requester && requester.preferences?.notifications?.email) {
      await this.sendEmail(
        requester.email,
        `Deployment Rejected: ${deployment.name}`,
        message
      );
    }
  }

  /**
   * Deployment success notification
   */
  async deploymentSuccess(deployment) {
    const message = `✅ Deployment Successful\n\n` +
      `*Deployment:* ${deployment.name}\n` +
      `*Environment:* ${deployment.environment}\n` +
      `*Resources Created:* ${deployment.resourceCount}\n` +
      `*Status:* ${deployment.status}`;

    await this.sendSlack(message, {
      channel: '#deployments',
      attachments: [{
        color: 'good',
        fields: [
          { title: 'Deployment ID', value: deployment.deploymentId, short: true },
          { title: 'Environment', value: deployment.environment, short: true }
        ]
      }]
    });
  }

  /**
   * Deployment error notification
   */
  async deploymentError(deployment, error) {
    const message = `❌ Deployment Failed\n\n` +
      `*Deployment:* ${deployment.name}\n` +
      `*Environment:* ${deployment.environment}\n` +
      `*Error:* ${error.message}`;

    await this.sendSlack(message, {
      channel: '#deployments',
      attachments: [{
        color: 'danger',
        fields: [
          { title: 'Deployment ID', value: deployment.deploymentId, short: true },
          { title: 'Error', value: error.message, short: false }
        ]
      }]
    });
  }

  /**
   * Budget alert notification
   */
  async sendBudgetAlert({ deploymentId, deploymentName, actualCost, budget, threshold }) {
    const message = `💰 Budget Alert\n\n` +
      `*Deployment:* ${deploymentName}\n` +
      `*Actual Cost:* $${actualCost}\n` +
      `*Budget:* $${budget}\n` +
      `*Threshold:* ${threshold * 100}%`;

    await this.sendSlack(message, {
      channel: '#costs',
      attachments: [{
        color: 'warning',
        fields: [
          { title: 'Deployment ID', value: deploymentId, short: true },
          { title: 'Actual Cost', value: `$${actualCost}`, short: true },
          { title: 'Budget', value: `$${budget}`, short: true }
        ]
      }]
    });
  }

  /**
   * Send WebSocket notification
   */
  async sendWebSocket(clientId, event, data) {
    // This will be handled by WebSocket service in server.js
    logger.debug('WebSocket notification', { clientId, event });
  }
}

// Singleton instance
const notificationService = new NotificationService();

module.exports = notificationService;

