const path = require('path');
const cliExecutor = require('./cliExecutor');
const logger = require('../utils/logger');
const cursorIntegration = require('./cursorIntegration');

/**
 * File Check Service
 * Checks file existence before creation using terminal commands
 */
class FileCheckService {
  /**
   * Check if file exists using terminal command
   */
  async checkFileExists(deploymentId, filePath) {
    try {
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      const fullPath = workspacePath 
        ? path.resolve(workspacePath, filePath)
        : filePath;

      // Use test -f command to check file existence
      const command = `test -f "${fullPath}" && echo "exists" || echo "not_exists"`;
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: workspacePath || undefined
      });

      // Handle both promise resolve and error cases
      const exists = result?.stdout?.trim() === 'exists' || result?.success === true;
      
      logger.debug('File existence checked', {
        deploymentId,
        filePath,
        exists
      });

      return {
        exists,
        path: fullPath
      };
    } catch (error) {
      logger.error('Failed to check file existence:', error);
      // If check fails, assume file doesn't exist to be safe
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * List files in directory
   */
  async listFiles(deploymentId, directory = '.') {
    try {
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      const fullPath = workspacePath 
        ? path.resolve(workspacePath, directory)
        : directory;

      const command = `ls -la "${fullPath}"`;
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: workspacePath || undefined
      });

      // Parse ls output
      const lines = (result?.stdout || result?.output || '').split('\n').filter(l => l.trim()) || [];
      const files = lines
        .filter(line => !line.startsWith('total'))
        .map(line => {
          const parts = line.trim().split(/\s+/);
          const name = parts[parts.length - 1];
          const isDir = line.startsWith('d');
          return {
            name,
            isDirectory: isDir,
            path: path.join(fullPath, name)
          };
        });

      return {
        files,
        directory: fullPath
      };
    } catch (error) {
      logger.error('Failed to list files:', error);
      return {
        files: [],
        error: error.message
      };
    }
  }

  /**
   * Get file metadata (size, modified date, etc.)
   */
  async getFileInfo(deploymentId, filePath) {
    try {
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      const fullPath = workspacePath 
        ? path.resolve(workspacePath, filePath)
        : filePath;

      // Use stat command to get file info
      const command = `stat -f "%z %Sm %N" "${fullPath}" 2>/dev/null || stat -c "%s %y %n" "${fullPath}" 2>/dev/null || echo "not_found"`;
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: workspacePath || undefined
      });

      const stdout = result?.stdout || result?.output || '';
      if (stdout.includes('not_found') || result?.stderr || result?.error) {
        return {
          exists: false,
          path: fullPath
        };
      }

      // Parse stat output
      const parts = stdout.trim().split(/\s+/);
      const size = parseInt(parts[0]);
      const modifiedDate = parts.slice(1, -1).join(' ');
      const name = parts[parts.length - 1];

      return {
        exists: true,
        path: fullPath,
        size,
        modifiedDate,
        name
      };
    } catch (error) {
      logger.error('Failed to get file info:', error);
      return {
        exists: false,
        error: error.message
      };
    }
  }

  /**
   * Check if file should be overwritten
   * Returns decision based on file existence and user preferences
   */
  async shouldOverwrite(deploymentId, filePath, options = {}) {
    try {
      const fileInfo = await this.getFileInfo(deploymentId, filePath);
      
      if (!fileInfo.exists) {
        return {
          shouldOverwrite: false,
          reason: 'File does not exist',
          fileInfo: null
        };
      }

      // If force option is set, allow overwrite
      if (options.force) {
        return {
          shouldOverwrite: true,
          reason: 'Force overwrite requested',
          fileInfo
        };
      }

      // If file exists and no force flag, require confirmation
      return {
        shouldOverwrite: false,
        reason: 'File exists and requires confirmation',
        fileInfo,
        requiresConfirmation: true
      };
    } catch (error) {
      logger.error('Failed to check overwrite status:', error);
      return {
        shouldOverwrite: false,
        reason: 'Error checking file status',
        error: error.message
      };
    }
  }

  /**
   * Batch check multiple files
   */
  async batchCheckFiles(deploymentId, filePaths) {
    try {
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      
      // Build command to check all files
      const checks = filePaths.map(filePath => {
        const fullPath = workspacePath 
          ? path.resolve(workspacePath, filePath)
          : filePath;
        return `test -f "${fullPath}" && echo "${filePath}:exists" || echo "${filePath}:not_exists"`;
      }).join(' && ');

      const command = checks;
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: workspacePath || undefined
      });

      // Parse results
      const results = {};
      const stdout = result?.stdout || result?.output || '';
      const lines = stdout.split('\n').filter(l => l.trim()) || [];
      
      lines.forEach(line => {
        const [filePath, status] = line.split(':');
        if (filePath && status) {
          results[filePath] = {
            exists: status === 'exists',
            path: workspacePath ? path.resolve(workspacePath, filePath) : filePath
          };
        }
      });

      // Fill in missing files as not existing
      filePaths.forEach(filePath => {
        if (!results[filePath]) {
          results[filePath] = {
            exists: false,
            path: workspacePath ? path.resolve(workspacePath, filePath) : filePath
          };
        }
      });

      return results;
    } catch (error) {
      logger.error('Failed to batch check files:', error);
      // Return all as not existing on error
      const results = {};
      filePaths.forEach(filePath => {
        results[filePath] = {
          exists: false,
          error: error.message
        };
      });
      return results;
    }
  }
}

// Singleton instance
const fileCheckService = new FileCheckService();

module.exports = fileCheckService;

