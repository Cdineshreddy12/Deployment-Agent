const cliExecutor = require('./cliExecutor');
const terraformService = require('./terraform');
const logger = require('../utils/logger');
const path = require('path');

/**
 * Command Executor Service
 * Executes commands and returns formatted results for chat display
 */
class CommandExecutor {
  /**
   * Execute a shell command and return formatted results
   */
  async executeCommand(deploymentId, command, options = {}) {
    try {
      logger.info('Executing command via CommandExecutor', { deploymentId, command });

      const startTime = Date.now();
      
      // Execute command via CLI executor
      const result = await cliExecutor.executeDeployment(
        deploymentId,
        command,
        {
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeout || 30000
        }
      );

      const duration = Date.now() - startTime;

      // Get logs for this execution
      const logs = await cliExecutor.getLogs(deploymentId, {
        limit: 100,
        offset: 0
      });

      // Filter logs related to this command
      const commandLogs = logs
        .filter(log => log.message.includes(command) || log.timestamp >= startTime)
        .slice(-20); // Get last 20 relevant logs

      return {
        success: result.success !== false,
        command,
        output: result.stdout || '',
        error: result.stderr || '',
        exitCode: result.code || 0,
        duration,
        logs: commandLogs,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Command execution error:', error);
      return {
        success: false,
        command,
        output: '',
        error: error.message,
        exitCode: 1,
        duration: 0,
        logs: [],
        timestamp: new Date()
      };
    }
  }

  /**
   * Execute a Terraform command and return formatted results
   */
  async executeTerraformCommand(deploymentId, command, terraformDir = null) {
    try {
      logger.info('Executing Terraform command via CommandExecutor', { 
        deploymentId, 
        command,
        terraformDir 
      });

      const startTime = Date.now();

      // Get terraform directory
      if (!terraformDir) {
        const tempDir = await cliExecutor.getTempDir(deploymentId);
        terraformDir = path.join(tempDir, 'repo', 'terraform');
      }

      let result;
      let output = '';
      let error = '';

      switch (command.toLowerCase()) {
        case 'init':
          result = await terraformService.init(deploymentId);
          output = result.output || '';
          break;

        case 'plan':
          result = await terraformService.plan(deploymentId, {});
          output = result.plan || '';
          break;

        case 'apply':
          result = await terraformService.apply(deploymentId, { autoApprove: false });
          output = result.output || '';
          break;

        case 'validate':
          result = await terraformService.validate(deploymentId);
          output = JSON.stringify(result, null, 2);
          break;

        case 'fmt':
          // Format Terraform code
          try {
            await terraformService.formatTerraformCode(deploymentId);
            output = 'Terraform code formatted successfully';
            result = { success: true };
          } catch (fmtError) {
            error = fmtError.message;
            result = { success: false };
          }
          break;

        case 'destroy':
          result = await terraformService.destroy(deploymentId, { autoApprove: false });
          output = result.output || '';
          break;

        default:
          throw new Error(`Unknown Terraform command: ${command}`);
      }

      const duration = Date.now() - startTime;

      return {
        success: result.success !== false,
        command: `terraform ${command}`,
        output,
        error: error || (result.error ? result.error.message : ''),
        exitCode: result.success === false ? 1 : 0,
        duration,
        terraformDir,
        timestamp: new Date(),
        changes: result.changes || null,
        resources: result.resources || null
      };
    } catch (error) {
      logger.error('Terraform command execution error:', error);
      return {
        success: false,
        command: `terraform ${command}`,
        output: '',
        error: error.message,
        exitCode: 1,
        duration: 0,
        timestamp: new Date()
      };
    }
  }

  /**
   * Format command results for display in chat
   */
  formatCommandResults(result) {
    if (!result) {
      return 'Command execution failed - no results returned';
    }

    let formatted = `**Command:** \`${result.command}\`\n\n`;
    
    if (result.success) {
      formatted += `✅ **Status:** Success\n`;
    } else {
      formatted += `❌ **Status:** Failed (exit code: ${result.exitCode})\n`;
    }

    formatted += `⏱️ **Duration:** ${result.duration}ms\n\n`;

    if (result.output) {
      formatted += `**Output:**\n\`\`\`\n${result.output}\n\`\`\`\n\n`;
    }

    if (result.error) {
      formatted += `**Error:**\n\`\`\`\n${result.error}\n\`\`\`\n\n`;
    }

    if (result.changes) {
      formatted += `**Changes:**\n`;
      formatted += `- Add: ${result.changes.add || 0}\n`;
      formatted += `- Change: ${result.changes.change || 0}\n`;
      formatted += `- Destroy: ${result.changes.destroy || 0}\n\n`;
    }

    if (result.resources && result.resources.length > 0) {
      formatted += `**Resources Created:**\n`;
      result.resources.forEach(resource => {
        formatted += `- ${resource.type}.${resource.name}: ${resource.status}\n`;
      });
      formatted += `\n`;
    }

    return formatted;
  }

  /**
   * Detect if a message contains a command execution request
   */
  detectCommandIntent(message) {
    if (!message || typeof message !== 'string') {
      return null;
    }

    const lowerMessage = message.toLowerCase().trim();

    // Terraform commands
    const terraformPatterns = [
      /terraform\s+(init|plan|apply|validate|fmt|destroy)/i,
      /run\s+terraform\s+(init|plan|apply|validate|fmt|destroy)/i,
      /execute\s+terraform\s+(init|plan|apply|validate|fmt|destroy)/i
    ];

    for (const pattern of terraformPatterns) {
      const match = lowerMessage.match(pattern);
      if (match) {
        return {
          type: 'terraform',
          command: match[1].toLowerCase()
        };
      }
    }

    // Shell commands
    const shellPatterns = [
      /run\s+(?:command|cmd)\s+["'](.+?)["']/i,
      /execute\s+(?:command|cmd)\s+["'](.+?)["']/i,
      /run:\s*(.+)/i,
      /execute:\s*(.+)/i
    ];

    for (const pattern of shellPatterns) {
      const match = lowerMessage.match(pattern);
      if (match && match[1]) {
        return {
          type: 'shell',
          command: match[1].trim()
        };
      }
    }

    // AWS CLI commands - capture full command including arguments and command substitution
    if (lowerMessage.includes('aws ')) {
      // Find the position of "aws" in the message
      const awsIndex = message.toLowerCase().indexOf('aws ');
      if (awsIndex !== -1) {
        // Extract everything from "aws" to the end of the line/message
        // Handle command substitution $(...) and all arguments
        let commandStart = awsIndex;
        
        // Extract the rest of the message from "aws"
        let remainingMessage = message.substring(commandStart);
        
        // Find the end of the command (end of line, or before next command-like keyword)
        let commandEnd = remainingMessage.length;
        const nextCommandMatch = remainingMessage.match(/\n\s*(?:run|execute|terraform|aws)\s+/i);
        if (nextCommandMatch) {
          commandEnd = nextCommandMatch.index;
        }
        
        // Extract the full command
        const fullCommand = remainingMessage.substring(0, commandEnd).trim();
        
        // Only return if we found a substantial command (more than just "aws")
        if (fullCommand.length > 4 && fullCommand.startsWith('aws')) {
          return {
            type: 'shell',
            command: fullCommand
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract all commands from a text message
   * Returns array of detected commands
   */
  extractCommands(message) {
    if (!message || typeof message !== 'string') {
      return [];
    }

    const commands = [];
    const lines = message.split('\n');

    // Pattern to match code blocks with commands
    const codeBlockPattern = /```(?:bash|sh|shell|terraform)?\n([\s\S]*?)```/g;
    let match;
    
    while ((match = codeBlockPattern.exec(message)) !== null) {
      const codeBlock = match[1].trim();
      const lines = codeBlock.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const intent = this.detectCommandIntent(trimmed);
          if (intent) {
            commands.push({
              command: intent.type === 'terraform' ? `terraform ${intent.command}` : trimmed,
              type: intent.type,
              original: trimmed
            });
          } else if (trimmed.match(/^(terraform|aws|docker|kubectl)\s+/i)) {
            commands.push({
              command: trimmed,
              type: this.detectCommandType(trimmed),
              original: trimmed
            });
          }
        }
      }
    }

    // Also check for inline commands
    const inlinePatterns = [
      /`([^`]+)`/g, // Backtick code
      /\$ (.+)/g, // Shell prompt style
    ];

    for (const pattern of inlinePatterns) {
      while ((match = pattern.exec(message)) !== null) {
        const cmd = match[1].trim();
        if (cmd.length > 3 && !cmd.startsWith('http')) {
          const intent = this.detectCommandIntent(cmd);
          if (intent) {
            commands.push({
              command: intent.type === 'terraform' ? `terraform ${intent.command}` : cmd,
              type: intent.type,
              original: cmd
            });
          }
        }
      }
    }

    // Remove duplicates
    const uniqueCommands = [];
    const seen = new Set();
    for (const cmd of commands) {
      const key = cmd.command.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCommands.push(cmd);
      }
    }

    return uniqueCommands;
  }

  /**
   * Detect command type from command string
   */
  detectCommandType(command) {
    const lower = command.toLowerCase().trim();
    if (lower.startsWith('terraform')) return 'terraform';
    if (lower.startsWith('aws')) return 'aws';
    if (lower.startsWith('docker')) return 'docker';
    if (lower.startsWith('kubectl')) return 'kubectl';
    return 'shell';
  }
}

// Singleton instance
const commandExecutor = new CommandExecutor();

module.exports = commandExecutor;

