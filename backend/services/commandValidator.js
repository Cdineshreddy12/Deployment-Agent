const logger = require('../utils/logger');

/**
 * Command Validator Service
 * Validates commands for safety and security
 */
class CommandValidator {
  constructor() {
    // Dangerous command patterns
    this.dangerousPatterns = [
      /rm\s+-rf\s+\//, // rm -rf /
      /rm\s+-rf\s+.*\/\.\./, // rm -rf with parent directory
      /format\s+[a-z]:/i, // Format disk
      /mkfs\./, // Make filesystem
      /dd\s+if=.*of=/, // Disk dump
      /shutdown\s+-/, // Shutdown
      /reboot/i, // Reboot
      /halt/i, // Halt
      /poweroff/i, // Poweroff
      />.*\/dev\/sd/, // Write to disk device
      /chmod\s+777/, // Dangerous permissions
      /chown\s+.*root/, // Change ownership to root
      /sudo\s+rm\s+-rf/, // Sudo rm -rf
      /sudo\s+.*format/, // Sudo format
    ];

    // Commands that require confirmation
    this.confirmationRequired = [
      /terraform\s+destroy/i,
      /terraform\s+apply.*-destroy/i,
      /rm\s+-rf/i,
      /docker\s+rm\s+-f/i,
      /kubectl\s+delete/i,
    ];

    // Allowed command types per user role
    this.rolePermissions = {
      admin: ['*'], // All commands
      devops: ['shell', 'terraform', 'aws', 'docker', 'kubectl'],
      tech_lead: ['shell', 'terraform', 'aws'],
      developer: ['shell', 'terraform'],
      viewer: [] // No execution permissions
    };
  }

  /**
   * Validate command
   */
  async validateCommand(command, context = {}) {
    const { deploymentId, userId, type = 'shell' } = context;

    // Check for dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: 'Command contains dangerous patterns',
          requiresConfirmation: false
        };
      }
    }

    // Check if confirmation is required
    let requiresConfirmation = false;
    for (const pattern of this.confirmationRequired) {
      if (pattern.test(command)) {
        requiresConfirmation = true;
        break;
      }
    }

    // Check user permissions (if userId provided)
    if (userId && context.userRole) {
      const allowedTypes = this.rolePermissions[context.userRole] || [];
      
      if (!allowedTypes.includes('*') && !allowedTypes.includes(type)) {
        return {
          allowed: false,
          reason: `User role '${context.userRole}' does not have permission to execute ${type} commands`,
          requiresConfirmation: false
        };
      }
    }

    // Check command length
    if (command.length > 10000) {
      return {
        allowed: false,
        reason: 'Command too long (max 10000 characters)',
        requiresConfirmation: false
      };
    }

    // Check for command injection attempts
    if (this._detectCommandInjection(command)) {
      return {
        allowed: false,
        reason: 'Potential command injection detected',
        requiresConfirmation: false
      };
    }

    return {
      allowed: true,
      requiresConfirmation
    };
  }

  /**
   * Detect command injection attempts
   */
  _detectCommandInjection(command) {
    const injectionPatterns = [
      /;\s*rm\s+-rf/i,
      /;\s*shutdown/i,
      /&&\s*rm\s+-rf/i,
      /\|\s*rm\s+-rf/i,
      /`.*rm\s+-rf/i,
      /\$\(.*rm\s+-rf/i,
      /<\(.*rm\s+-rf/i,
      />\(.*rm\s+-rf/i,
    ];

    return injectionPatterns.some(pattern => pattern.test(command));
  }

  /**
   * Sanitize command (remove dangerous parts)
   */
  sanitizeCommand(command) {
    let sanitized = command;

    // Remove dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    // Remove command injection attempts
    sanitized = sanitized.replace(/[;&|`$()<>]/g, (match) => {
      // Allow in quoted strings
      const before = sanitized.substring(0, sanitized.indexOf(match));
      const quotes = (before.match(/"/g) || []).length;
      if (quotes % 2 === 1) {
        return match; // Inside quotes, allow
      }
      return ' '; // Replace with space
    });

    return sanitized.trim();
  }

  /**
   * Check if command type is allowed for user role
   */
  isCommandTypeAllowed(type, userRole) {
    const allowedTypes = this.rolePermissions[userRole] || [];
    return allowedTypes.includes('*') || allowedTypes.includes(type);
  }

  /**
   * Get command type from command string
   */
  detectCommandType(command) {
    const lowerCommand = command.toLowerCase().trim();

    if (lowerCommand.startsWith('terraform')) {
      return 'terraform';
    }
    if (lowerCommand.startsWith('aws')) {
      return 'aws';
    }
    if (lowerCommand.startsWith('docker')) {
      return 'docker';
    }
    if (lowerCommand.startsWith('kubectl')) {
      return 'kubectl';
    }

    return 'shell';
  }
}

module.exports = new CommandValidator();





