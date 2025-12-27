const CommandHistory = require('../models/CommandHistory');
const logger = require('../utils/logger');

/**
 * Command History Service
 * Tracks all executed commands with context for LLM awareness
 */
class CommandHistoryService {
  /**
   * Log a command execution
   */
  async logCommand(deploymentId, command, result, step = null, metadata = {}) {
    try {
      const Deployment = require('../models/Deployment');
      const deployment = await Deployment.findOne({ deploymentId });
      
      if (!deployment) {
        logger.warn('Deployment not found for command logging', { deploymentId });
        return null;
      }

      const userId = deployment.userId;
      
      // Determine command type
      const commandType = this.detectCommandType(command);
      
      // Extract result details
      const stdout = result?.stdout || result?.output || '';
      const stderr = result?.stderr || result?.error || '';
      const exitCode = result?.code !== undefined ? result.code : (result?.exitCode !== undefined ? result.exitCode : (result?.success === false ? 1 : 0));
      
      const commandRecord = new CommandHistory({
        deploymentId,
        userId,
        command,
        type: commandType,
        status: exitCode === 0 ? 'completed' : 'failed',
        exitCode,
        output: stdout,
        error: stderr,
        workingDirectory: metadata.cwd || metadata.workingDirectory,
        environmentVariables: metadata.env || {},
        metadata: {
          step,
          phase: metadata.phase || step,
          ...metadata
        }
      });

      await commandRecord.save();

      logger.debug('Command logged', {
        deploymentId,
        command: command.substring(0, 50),
        step,
        exitCode
      });

      return commandRecord;
    } catch (error) {
      logger.error('Failed to log command:', error);
      // Don't throw - logging failure shouldn't break execution
      return null;
    }
  }

  /**
   * Detect command type from command string
   */
  detectCommandType(command) {
    const cmd = command.toLowerCase().trim();
    
    if (cmd.startsWith('terraform')) return 'terraform';
    if (cmd.startsWith('aws ') || cmd.startsWith('aws-')) return 'aws';
    if (cmd.startsWith('docker')) return 'docker';
    if (cmd.startsWith('kubectl') || cmd.startsWith('kubectl')) return 'kubectl';
    
    return 'shell';
  }

  /**
   * Get command history for a specific step
   */
  async getCommandHistory(deploymentId, step) {
    try {
      const commands = await CommandHistory.find({
        deploymentId,
        'metadata.step': step
      }).sort({ startedAt: 1 });

      return commands;
    } catch (error) {
      logger.error('Failed to get command history:', error);
      return [];
    }
  }

  /**
   * Get recent commands for context
   */
  async getRecentCommands(deploymentId, limit = 10) {
    try {
      const commands = await CommandHistory.find({
        deploymentId
      })
      .sort({ startedAt: -1 })
      .limit(limit)
      .select('command type status exitCode output error metadata step startedAt');

      return commands.reverse(); // Return in chronological order
    } catch (error) {
      logger.error('Failed to get recent commands:', error);
      return [];
    }
  }

  /**
   * Build command summary for LLM context
   */
  async buildCommandSummary(deploymentId, maxCommands = 10) {
    try {
      const commands = await this.getRecentCommands(deploymentId, maxCommands);
      
      if (commands.length === 0) {
        return '';
      }

      const summary = ['**Recent Command History:**'];
      
      commands.forEach((cmd, index) => {
        const status = cmd.status === 'completed' ? '✅' : '❌';
        const step = cmd.metadata?.step ? ` [${cmd.metadata.step}]` : '';
        summary.push(`${index + 1}. ${status} ${cmd.command}${step}`);
        
        if (cmd.exitCode !== 0 && cmd.error) {
          summary.push(`   Error: ${cmd.error.substring(0, 100)}${cmd.error.length > 100 ? '...' : ''}`);
        } else if (cmd.output && cmd.output.length < 200) {
          summary.push(`   Output: ${cmd.output.substring(0, 200)}`);
        }
      });

      return summary.join('\n');
    } catch (error) {
      logger.error('Failed to build command summary:', error);
      return '';
    }
  }

  /**
   * Get commands by type
   */
  async getCommandsByType(deploymentId, type, limit = 10) {
    try {
      const commands = await CommandHistory.find({
        deploymentId,
        type
      })
      .sort({ startedAt: -1 })
      .limit(limit);

      return commands.reverse();
    } catch (error) {
      logger.error('Failed to get commands by type:', error);
      return [];
    }
  }

  /**
   * Get step completion status based on commands
   */
  async getStepCommandStatus(deploymentId, step) {
    try {
      const commands = await this.getCommandHistory(deploymentId, step);
      
      if (commands.length === 0) {
        return {
          hasCommands: false,
          allSuccessful: false,
          hasFailures: false,
          lastCommand: null
        };
      }

      const successful = commands.filter(c => c.status === 'completed');
      const failed = commands.filter(c => c.status === 'failed');

      return {
        hasCommands: true,
        allSuccessful: failed.length === 0,
        hasFailures: failed.length > 0,
        totalCommands: commands.length,
        successfulCount: successful.length,
        failedCount: failed.length,
        lastCommand: commands[commands.length - 1]
      };
    } catch (error) {
      logger.error('Failed to get step command status:', error);
      return {
        hasCommands: false,
        allSuccessful: false,
        hasFailures: false,
        lastCommand: null
      };
    }
  }
}

// Singleton instance
const commandHistoryService = new CommandHistoryService();

module.exports = commandHistoryService;

