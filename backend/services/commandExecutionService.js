const { EventEmitter } = require('events');
const cliExecutor = require('./cliExecutor');
const commandValidator = require('./commandValidator');
const CommandHistory = require('../models/CommandHistory');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Command Execution Service
 * Centralized command execution with queue management and status tracking
 */
class CommandExecutionService extends EventEmitter {
  constructor() {
    super();
    this.executionQueue = new Map(); // deploymentId -> queue
    this.activeExecutions = new Map(); // commandId -> execution info
    this.broadcastFunction = null;
  }

  /**
   * Set broadcast function for WebSocket streaming
   */
  setBroadcastFunction(fn) {
    this.broadcastFunction = fn;
  }

  /**
   * Get or create queue for deployment
   */
  getQueue(deploymentId) {
    if (!this.executionQueue.has(deploymentId)) {
      this.executionQueue.set(deploymentId, []);
    }
    return this.executionQueue.get(deploymentId);
  }

  /**
   * Execute command with queue management
   */
  async executeCommand(deploymentId, command, options = {}) {
    const {
      userId,
      type = 'shell',
      workingDirectory,
      environmentVariables = {},
      timeout = 300000,
      validate = true
    } = options;

    // Validate command if requested
    if (validate) {
      const validation = await commandValidator.validateCommand(command, {
        deploymentId,
        userId,
        type
      });
      
      if (!validation.allowed) {
        throw new Error(`Command validation failed: ${validation.reason}`);
      }
    }

    // Create command history record
    const commandHistory = new CommandHistory({
      deploymentId,
      command,
      type,
      status: 'pending',
      userId,
      workingDirectory,
      environmentVariables
    });

    await commandHistory.save();
    const commandId = commandHistory.commandId;

    // Check if there's already an active execution for this deployment
    const activeExecution = Array.from(this.activeExecutions.values())
      .find(exec => exec.deploymentId === deploymentId && exec.status === 'running');

    if (activeExecution) {
      // Add to queue
      const queue = this.getQueue(deploymentId);
      queue.push({
        commandId,
        command,
        options,
        commandHistory
      });

      this.broadcastCommandEvent(deploymentId, {
        type: 'command_queued',
        commandId,
        command,
        position: queue.length
      });

      return {
        commandId,
        status: 'queued',
        position: queue.length
      };
    }

    // Execute immediately
    return this._executeCommand(commandId, deploymentId, command, {
      ...options,
      commandHistory
    });
  }

  /**
   * Internal method to execute command
   */
  async _executeCommand(commandId, deploymentId, command, options) {
    const { commandHistory, workingDirectory, environmentVariables, timeout, type } = options;

    // Mark as running
    commandHistory.status = 'running';
    commandHistory.startedAt = new Date();
    await commandHistory.save();

    // Store active execution
    this.activeExecutions.set(commandId, {
      commandId,
      deploymentId,
      command,
      status: 'running',
      process: null,
      startTime: Date.now()
    });

    // Broadcast start event
    this.broadcastCommandEvent(deploymentId, {
      type: 'command_started',
      commandId,
      command
    });

    try {
      let result;

      // Execute based on type
      if (type === 'terraform') {
        const tempDir = await cliExecutor.getTempDir(deploymentId);
        const terraformDir = workingDirectory || require('path').join(tempDir, 'repo', 'terraform');
        result = await cliExecutor.runTerraform(deploymentId, command, terraformDir);
      } else {
        // Shell command
        const tempDir = await cliExecutor.getTempDir(deploymentId);
        const cwd = workingDirectory || tempDir;
        
        result = await cliExecutor.executeDeployment(deploymentId, command, {
          cwd,
          env: environmentVariables,
          timeout
        });
      }

      // Mark as completed
      commandHistory.markCompleted(
        result.code || 0,
        result.stdout || '',
        result.stderr || ''
      );
      await commandHistory.save();

      // Remove from active executions
      this.activeExecutions.delete(commandId);

      // Broadcast completion event
      this.broadcastCommandEvent(deploymentId, {
        type: 'command_completed',
        commandId,
        exitCode: result.code || 0,
        success: result.success !== false
      });

      // Process next command in queue
      await this._processNextInQueue(deploymentId);

      return {
        commandId,
        status: 'completed',
        exitCode: result.code || 0,
        output: result.stdout || '',
        error: result.stderr || '',
        duration: commandHistory.duration
      };

    } catch (error) {
      // Mark as failed
      commandHistory.markCompleted(
        1,
        '',
        error.message
      );
      await commandHistory.save();

      // Remove from active executions
      this.activeExecutions.delete(commandId);

      // Broadcast failure event
      this.broadcastCommandEvent(deploymentId, {
        type: 'command_failed',
        commandId,
        error: error.message
      });

      // Process next command in queue
      await this._processNextInQueue(deploymentId);

      throw error;
    }
  }

  /**
   * Process next command in queue for deployment
   */
  async _processNextInQueue(deploymentId) {
    const queue = this.getQueue(deploymentId);
    
    if (queue.length === 0) {
      return;
    }

    const next = queue.shift();
    const { commandId, command, options, commandHistory } = next;

    // Execute next command
    try {
      await this._executeCommand(commandId, deploymentId, command, {
        ...options,
        commandHistory
      });
    } catch (error) {
      logger.error(`Failed to execute queued command ${commandId}:`, error);
    }
  }

  /**
   * Cancel running command
   */
  async cancelCommand(commandId) {
    const execution = this.activeExecutions.get(commandId);
    
    if (!execution) {
      throw new Error(`Command ${commandId} not found or not running`);
    }

    if (execution.status !== 'running') {
      throw new Error(`Command ${commandId} is not running`);
    }

    // Kill process if exists
    if (execution.process) {
      execution.process.kill();
    }

    // Update command history
    const commandHistory = await CommandHistory.findOne({ commandId });
    if (commandHistory) {
      commandHistory.markCancelled();
      await commandHistory.save();
    }

    // Remove from active executions
    this.activeExecutions.delete(commandId);

    // Broadcast cancellation event
    this.broadcastCommandEvent(execution.deploymentId, {
      type: 'command_cancelled',
      commandId
    });

    // Process next command in queue
    await this._processNextInQueue(execution.deploymentId);

    return { success: true, commandId };
  }

  /**
   * Get command execution status
   */
  async getCommandStatus(commandId) {
    const execution = this.activeExecutions.get(commandId);
    
    if (execution) {
      return {
        commandId,
        status: execution.status,
        command: execution.command,
        deploymentId: execution.deploymentId
      };
    }

    const commandHistory = await CommandHistory.findOne({ commandId });
    if (!commandHistory) {
      throw new Error(`Command ${commandId} not found`);
    }

    return {
      commandId,
      status: commandHistory.status,
      command: commandHistory.command,
      deploymentId: commandHistory.deploymentId,
      exitCode: commandHistory.exitCode,
      duration: commandHistory.duration,
      startedAt: commandHistory.startedAt,
      completedAt: commandHistory.completedAt
    };
  }

  /**
   * Get active command for deployment
   */
  getActiveCommand(deploymentId) {
    const activeExecution = Array.from(this.activeExecutions.values())
      .find(exec => exec.deploymentId === deploymentId && exec.status === 'running');
    
    if (activeExecution) {
      return {
        commandId: activeExecution.commandId,
        command: activeExecution.command,
        status: activeExecution.status
      };
    }

    return null;
  }

  /**
   * Broadcast command event via WebSocket
   */
  broadcastCommandEvent(deploymentId, event) {
    if (this.broadcastFunction) {
      this.broadcastFunction(deploymentId, event.type || 'command_event', event);
    }
    this.emit('command_event', { deploymentId, ...event });
  }

  /**
   * Get command history for deployment
   */
  async getCommandHistory(deploymentId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      type,
      status,
      userId
    } = options;

    const query = { deploymentId };
    
    if (type) query.type = type;
    if (status) query.status = status;
    if (userId) query.userId = userId;

    const commands = await CommandHistory.find(query)
      .sort({ startedAt: -1 })
      .limit(limit)
      .skip(offset)
      .populate('userId', 'name email')
      .lean();

    const total = await CommandHistory.countDocuments(query);

    return {
      commands,
      total,
      limit,
      offset
    };
  }

  /**
   * Get command details
   */
  async getCommandDetails(commandId) {
    const command = await CommandHistory.findOne({ commandId })
      .populate('userId', 'name email')
      .lean();

    if (!command) {
      throw new Error(`Command ${commandId} not found`);
    }

    return command;
  }
}

// Export singleton instance
module.exports = new CommandExecutionService();

