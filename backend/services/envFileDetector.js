const fileDetectionService = require('./fileDetectionService');
const cursorIntegration = require('./cursorIntegration');
const logger = require('../utils/logger');
const path = require('path');

/**
 * Environment File Detector Service
 * Detects and parses .env files from workspace
 * Cost-optimized: Uses terminal commands, no LLM calls
 */
class EnvFileDetector {
  /**
   * Detect all .env files in workspace
   */
  async detectEnvFiles(deploymentId) {
    try {
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        logger.warn('No workspace path set for .env detection', { deploymentId });
        return [];
      }

      const envFiles = [];
      
      // Common .env file patterns
      const envPatterns = [
        '.env',
        '.env.local',
        '.env.development',
        '.env.production',
        '.env.staging',
        '.env.test',
        'backend/.env',
        'backend/.env.local',
        'frontend/.env',
        'frontend/.env.local'
      ];

      // Check each pattern
      for (const pattern of envPatterns) {
        const checkResult = await fileDetectionService.checkFileExists(deploymentId, pattern);
        if (checkResult.exists) {
          envFiles.push({
            path: pattern,
            exists: true
          });
        }
      }

      // Also search for .env files using find command
      try {
        const findResult = await fileDetectionService.findFiles(deploymentId, '.env*', workspacePath);
        for (const foundPath of findResult) {
          // Avoid duplicates
          if (!envFiles.find(f => f.path === foundPath)) {
            envFiles.push({
              path: foundPath,
              exists: true
            });
          }
        }
      } catch (error) {
        logger.debug('Failed to find .env files using find command', { error: error.message });
      }

      logger.info('Detected .env files', {
        deploymentId,
        count: envFiles.length,
        files: envFiles.map(f => f.path)
      });

      return envFiles;
    } catch (error) {
      logger.error('Failed to detect .env files:', error);
      return [];
    }
  }

  /**
   * Parse .env file content
   */
  async parseEnvFile(deploymentId, filePath) {
    try {
      const content = await fileDetectionService.readFileContent(deploymentId, filePath);
      const lines = content.content.split('\n');
      
      const variables = {};
      const errors = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines and comments
        if (!line || line.startsWith('#')) {
          continue;
        }

        // Handle multi-line values (lines ending with \)
        let fullLine = line;
        if (line.endsWith('\\')) {
          let j = i + 1;
          while (j < lines.length && lines[j].trim().endsWith('\\')) {
            fullLine = fullLine.slice(0, -1) + lines[j].trim().slice(0, -1);
            j++;
          }
          if (j < lines.length) {
            fullLine = fullLine.slice(0, -1) + lines[j].trim();
          }
          i = j;
        }

        // Parse key=value
        const match = fullLine.match(/^([^=#]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          variables[key] = value;
        } else if (fullLine.includes('=')) {
          // Malformed line
          errors.push({
            line: i + 1,
            content: fullLine,
            message: 'Invalid format'
          });
        }
      }

      return {
        filePath,
        variables,
        errors,
        lineCount: lines.length
      };
    } catch (error) {
      logger.error(`Failed to parse .env file ${filePath}:`, error);
      return {
        filePath,
        variables: {},
        errors: [{ message: error.message }],
        lineCount: 0
      };
    }
  }

  /**
   * Get all environment variables from .env files
   * Merges multiple .env files with priority order
   */
  async getEnvVariables(deploymentId) {
    try {
      const envFiles = await this.detectEnvFiles(deploymentId);
      
      // Priority order: .env.local > .env.production > .env.development > .env > others
      const priorityOrder = {
        '.env.local': 1,
        '.env.production': 2,
        '.env.development': 3,
        '.env.staging': 4,
        '.env.test': 5,
        '.env': 6
      };

      // Sort files by priority
      const sortedFiles = envFiles.sort((a, b) => {
        const aPriority = priorityOrder[a.path] || 999;
        const bPriority = priorityOrder[b.path] || 999;
        return aPriority - bPriority;
      });

      const allVariables = {};
      const fileDetails = [];

      // Parse each file and merge variables (later files override earlier ones)
      for (const envFile of sortedFiles) {
        const parsed = await this.parseEnvFile(deploymentId, envFile.path);
        fileDetails.push(parsed);
        
        // Merge variables (later files override)
        Object.assign(allVariables, parsed.variables);
      }

      logger.info('Parsed environment variables from .env files', {
        deploymentId,
        fileCount: envFiles.length,
        variableCount: Object.keys(allVariables).length,
        files: envFiles.map(f => f.path)
      });

      return {
        variables: allVariables,
        files: fileDetails,
        count: Object.keys(allVariables).length
      };
    } catch (error) {
      logger.error('Failed to get environment variables:', error);
      return {
        variables: {},
        files: [],
        count: 0
      };
    }
  }

  /**
   * Merge multiple .env files with priority
   */
  async mergeEnvFiles(deploymentId) {
    return this.getEnvVariables(deploymentId);
  }

  /**
   * Check if .env file exists and is readable
   */
  async checkEnvFile(deploymentId, filePath) {
    try {
      const checkResult = await fileDetectionService.checkFileExists(deploymentId, filePath);
      if (!checkResult.exists) {
        return {
          exists: false,
          path: filePath,
          readable: false
        };
      }

      // Try to read first few lines to verify readability
      try {
        const content = await fileDetectionService.readFileContent(deploymentId, filePath, 5);
        return {
          exists: true,
          path: filePath,
          readable: true,
          preview: content.content.split('\n').slice(0, 5)
        };
      } catch (error) {
        return {
          exists: true,
          path: filePath,
          readable: false,
          error: error.message
        };
      }
    } catch (error) {
      logger.error(`Failed to check .env file ${filePath}:`, error);
      return {
        exists: false,
        path: filePath,
        readable: false,
        error: error.message
      };
    }
  }
}

module.exports = new EnvFileDetector();

