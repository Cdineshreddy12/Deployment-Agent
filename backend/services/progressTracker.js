const EventEmitter = require('events');
const logger = require('../utils/logger');

/**
 * Progress Tracker Service
 * Tracks and broadcasts real-time deployment progress via WebSocket
 */
class ProgressTracker extends EventEmitter {
  constructor() {
    super();
    this.deploymentStreams = new Map(); // deploymentId -> Set<WebSocket>
    this.progressHistory = new Map(); // deploymentId -> Array<progressEvents>
    this.maxHistorySize = 100;
  }

  /**
   * Register WebSocket connection for deployment progress
   */
  registerConnection(deploymentId, ws) {
    if (!this.deploymentStreams.has(deploymentId)) {
      this.deploymentStreams.set(deploymentId, new Set());
    }

    this.deploymentStreams.get(deploymentId).add(ws);

    logger.debug('Progress tracker connection registered', {
      deploymentId,
      totalConnections: this.deploymentStreams.get(deploymentId).size
    });

    // Send any existing progress history
    const history = this.progressHistory.get(deploymentId);
    if (history && history.length > 0) {
      // Send last few events to catch up
      const recentHistory = history.slice(-10);
      recentHistory.forEach(event => {
        this.sendToConnection(ws, event);
      });
    }

    // Handle connection close
    ws.on('close', () => {
      this.unregisterConnection(deploymentId, ws);
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error in progress tracker', {
        deploymentId,
        error: error.message
      });
      this.unregisterConnection(deploymentId, ws);
    });
  }

  /**
   * Unregister WebSocket connection
   */
  unregisterConnection(deploymentId, ws) {
    const streams = this.deploymentStreams.get(deploymentId);
    if (streams) {
      streams.delete(ws);
      if (streams.size === 0) {
        this.deploymentStreams.delete(deploymentId);
      }
    }
  }

  /**
   * Track and broadcast progress event
   */
  trackProgress(deploymentId, progressData) {
    const progressEvent = {
      type: 'deployment_progress',
      deploymentId,
      ...progressData,
      timestamp: new Date().toISOString()
    };

    // Store in history
    if (!this.progressHistory.has(deploymentId)) {
      this.progressHistory.set(deploymentId, []);
    }

    const history = this.progressHistory.get(deploymentId);
    history.push(progressEvent);

    // Limit history size
    if (history.length > this.maxHistorySize) {
      history.shift();
    }

    // Broadcast to all connected clients
    this.broadcast(deploymentId, progressEvent);

    // Emit event for other listeners
    this.emit('progress', progressEvent);

    logger.debug('Progress tracked', {
      deploymentId,
      phase: progressData.phase,
      progress: progressData.progress,
      connections: this.deploymentStreams.get(deploymentId)?.size || 0
    });
  }

  /**
   * Broadcast progress event to all connections for a deployment
   */
  broadcast(deploymentId, event) {
    const streams = this.deploymentStreams.get(deploymentId);
    if (!streams || streams.size === 0) {
      return;
    }

    const message = JSON.stringify(event);
    let sentCount = 0;
    let failedCount = 0;

    streams.forEach(ws => {
      try {
        if (ws.readyState === 1) { // WebSocket.OPEN
          ws.send(message);
          sentCount++;
        } else {
          // Connection not open, remove it
          streams.delete(ws);
          failedCount++;
        }
      } catch (error) {
        logger.error('Failed to send progress event', {
          deploymentId,
          error: error.message
        });
        streams.delete(ws);
        failedCount++;
      }
    });

    if (failedCount > 0) {
      logger.warn('Some progress events failed to send', {
        deploymentId,
        failedCount,
        sentCount
      });
    }
  }

  /**
   * Send event to a specific connection
   */
  sendToConnection(ws, event) {
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(event));
      }
    } catch (error) {
      logger.error('Failed to send event to connection', {
        error: error.message
      });
    }
  }

  /**
   * Get progress history for a deployment
   */
  getHistory(deploymentId, limit = 50) {
    const history = this.progressHistory.get(deploymentId) || [];
    return history.slice(-limit);
  }

  /**
   * Get current progress for a deployment
   */
  getCurrentProgress(deploymentId) {
    const history = this.progressHistory.get(deploymentId);
    if (!history || history.length === 0) {
      return null;
    }

    return history[history.length - 1];
  }

  /**
   * Clear history for a deployment
   */
  clearHistory(deploymentId) {
    this.progressHistory.delete(deploymentId);
  }

  /**
   * Get active connections count
   */
  getConnectionCount(deploymentId) {
    const streams = this.deploymentStreams.get(deploymentId);
    return streams ? streams.size : 0;
  }

  /**
   * Emit standard progress events
   */
  emitDeploymentStarted(deploymentId, jobId) {
    this.trackProgress(deploymentId, {
      phase: 'initialization',
      status: 'started',
      progress: 0,
      message: 'Deployment workflow started',
      jobId
    });
  }

  emitFilesWritten(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'writing_files',
      status: 'completed',
      progress: 20,
      message: 'Terraform files written successfully'
    });
  }

  emitTerraformInitStarted(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'initializing',
      status: 'in_progress',
      progress: 20,
      message: 'Initializing Terraform...'
    });
  }

  emitTerraformInitCompleted(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'initializing',
      status: 'completed',
      progress: 30,
      message: 'Terraform initialized successfully'
    });
  }

  emitTerraformPlanStarted(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'planning',
      status: 'in_progress',
      progress: 30,
      message: 'Running Terraform plan...'
    });
  }

  emitTerraformPlanCompleted(deploymentId, changes) {
    this.trackProgress(deploymentId, {
      phase: 'planning',
      status: 'completed',
      progress: 50,
      message: `Terraform plan completed: ${changes?.add || 0} to add, ${changes?.change || 0} to change`,
      changes
    });
  }

  emitTerraformApplyStarted(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'applying',
      status: 'in_progress',
      progress: 50,
      message: 'Applying Terraform configuration...'
    });
  }

  emitTerraformApplyProgress(deploymentId, progress) {
    this.trackProgress(deploymentId, {
      phase: 'applying',
      status: 'in_progress',
      progress: Math.min(50 + (progress * 0.3), 80), // 50-80% range
      message: 'Applying Terraform resources...'
    });
  }

  emitTerraformApplyCompleted(deploymentId, resources) {
    this.trackProgress(deploymentId, {
      phase: 'applying',
      status: 'completed',
      progress: 85,
      message: `Terraform apply completed: ${resources?.length || 0} resources created`,
      resources
    });
  }

  emitVerificationStarted(deploymentId) {
    this.trackProgress(deploymentId, {
      phase: 'verifying',
      status: 'in_progress',
      progress: 85,
      message: 'Verifying deployed resources...'
    });
  }

  emitVerificationCompleted(deploymentId, verification) {
    this.trackProgress(deploymentId, {
      phase: 'verifying',
      status: 'completed',
      progress: 95,
      message: `Resource verification completed: ${verification?.verified || 0}/${verification?.total || 0} verified`,
      verification
    });
  }

  emitDeploymentCompleted(deploymentId, result) {
    this.trackProgress(deploymentId, {
      phase: 'completed',
      status: 'success',
      progress: 100,
      message: 'Deployment completed successfully',
      result
    });
  }

  emitDeploymentFailed(deploymentId, error, phase) {
    this.trackProgress(deploymentId, {
      phase: phase || 'unknown',
      status: 'failed',
      progress: this.getCurrentProgress(deploymentId)?.progress || 0,
      message: `Deployment failed: ${error.message}`,
      error: error.message
    });
  }
}

// Singleton instance
const progressTracker = new ProgressTracker();

module.exports = progressTracker;





