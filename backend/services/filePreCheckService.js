const fileDetectionService = require('./fileDetectionService');
const envFileDetector = require('./envFileDetector');
const cursorIntegration = require('./cursorIntegration');
const cliExecutor = require('./cliExecutor');
const logger = require('../utils/logger');

/**
 * File Pre-Check Service
 * Checks for existing files before README generation
 * Cost-optimized: Uses terminal commands, no LLM calls
 */
class FilePreCheckService {
  /**
   * Check for existing Docker and .env files
   */
  async checkExistingFiles(deploymentId) {
    try {
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        logger.warn('No workspace path set for file pre-check', { deploymentId });
        return {
          existing: [],
          missing: [],
          envFiles: [],
          workspacePath: null
        };
      }

      // Use find command to discover Docker files in workspace
      let discoveredFiles = [];
      try {
        // Find all Docker-related files recursively
        const findCommand = `find . -type f \\( -name "Dockerfile*" -o -name "docker-compose*.yml" -o -name "docker-compose*.yaml" -o -name ".dockerignore" \\) 2>/dev/null | head -20`;
        
        logger.info('Searching for Docker files', {
          deploymentId,
          workspacePath,
          command: findCommand
        });
        
        const findResult = await cliExecutor.executeDeployment(deploymentId, findCommand, {
          cwd: workspacePath,
          timeout: 10000
        });
        
        logger.debug('Find command result', {
          deploymentId,
          exitCode: findResult.code || findResult.exitCode,
          stdout: findResult.stdout?.substring(0, 500),
          stderr: findResult.stderr?.substring(0, 500)
        });
        
        const exitCode = findResult.code !== undefined ? findResult.code : findResult.exitCode;
        if (exitCode === 0 && findResult.stdout) {
          const foundPaths = findResult.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .map(line => {
              // Handle both ./path and path formats
              if (line.startsWith('./')) {
                return line.replace(/^\.\//, '');
              }
              return line;
            });
          
          discoveredFiles = foundPaths.map(filePath => ({
            path: filePath,
            type: this.getFileType(filePath),
            exists: true,
            discovered: true
          }));
          
          logger.info('Discovered Docker files', {
            deploymentId,
            workspacePath,
            fileCount: discoveredFiles.length,
            files: discoveredFiles.map(f => f.path)
          });
        } else {
          const exitCode = findResult.code !== undefined ? findResult.code : findResult.exitCode;
          logger.warn('Find command returned no results or failed', {
            deploymentId,
            workspacePath,
            exitCode: exitCode,
            stdout: findResult.stdout,
            stderr: findResult.stderr
          });
        }
      } catch (error) {
        logger.warn('Failed to discover files with find command, falling back to explicit checks', {
          error: error.message,
          stack: error.stack,
          deploymentId,
          workspacePath
        });
      }

      // Also check common locations explicitly
      const dockerFilesToCheck = [
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
        '.dockerignore',
        'backend/Dockerfile',
        'frontend/Dockerfile',
        'backend/docker-compose.yml',
        'frontend/docker-compose.yml',
        'docker-compose.prod.yml',
        'docker-compose.dev.yml'
      ];

      const existingFiles = [...discoveredFiles];
      const checkedPaths = new Set(discoveredFiles.map(f => f.path));
      const missingFiles = [];

      // Check each Docker file that wasn't already discovered
      for (const file of dockerFilesToCheck) {
        if (checkedPaths.has(file)) {
          continue; // Already found via find command
        }
        
        try {
          const check = await fileDetectionService.checkFileExists(deploymentId, file);
          if (check.exists) {
            existingFiles.push({
              path: file,
              type: this.getFileType(file),
              exists: true,
              discovered: false
            });
            checkedPaths.add(file);
          } else {
            missingFiles.push({
              path: file,
              type: this.getFileType(file),
              exists: false
            });
          }
        } catch (error) {
          logger.debug(`Error checking file ${file}:`, error.message);
          // Treat as missing if check fails
          missingFiles.push({
            path: file,
            type: this.getFileType(file),
            exists: false,
            error: error.message
          });
        }
      }

      // Check for .env files
      const envFiles = await envFileDetector.detectEnvFiles(deploymentId);
      const envVars = await envFileDetector.getEnvVariables(deploymentId);

      logger.info('File pre-check completed', {
        deploymentId,
        existingFiles: existingFiles.length,
        missingFiles: missingFiles.length,
        envFiles: envFiles.length,
        envVars: envVars.count
      });

      return {
        existing: existingFiles,
        missing: missingFiles,
        envFiles: envFiles,
        envVars: envVars,
        workspacePath: workspacePath,
        checkedAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to check existing files:', error);
      // Return empty status on error - don't block workflow
      return {
        existing: [],
        missing: [],
        envFiles: [],
        envVars: { variables: {}, count: 0 },
        workspacePath: null,
        error: error.message
      };
    }
  }

  /**
   * Get comprehensive file status report
   */
  async getFileStatus(deploymentId) {
    const fileStatus = await this.checkExistingFiles(deploymentId);
    
    return {
      ...fileStatus,
      summary: {
        totalChecked: fileStatus.existing.length + fileStatus.missing.length,
        existingCount: fileStatus.existing.length,
        missingCount: fileStatus.missing.length,
        envFilesCount: fileStatus.envFiles.length,
        envVarsCount: fileStatus.envVars.count
      }
    };
  }

  /**
   * Identify missing files by comparing existing vs required
   */
  async identifyMissingFiles(deploymentId, requiredFiles) {
    const fileStatus = await this.checkExistingFiles(deploymentId);
    const existingPaths = new Set(fileStatus.existing.map(f => f.path));
    
    const missing = requiredFiles.filter(req => !existingPaths.has(req.path));
    const existing = requiredFiles.filter(req => existingPaths.has(req.path));
    
    return {
      missing,
      existing,
      allRequired: requiredFiles
    };
  }

  /**
   * Determine file type from path
   */
  getFileType(filePath) {
    if (filePath.includes('Dockerfile')) {
      return 'dockerfile';
    } else if (filePath.includes('docker-compose')) {
      return 'docker-compose';
    } else if (filePath.includes('.dockerignore')) {
      return 'dockerignore';
    } else if (filePath.includes('.env')) {
      return 'env';
    }
    return 'other';
  }

  /**
   * Check if specific file exists
   */
  async checkFile(deploymentId, filePath) {
    try {
      const check = await fileDetectionService.checkFileExists(deploymentId, filePath);
      return {
        path: filePath,
        exists: check.exists,
        type: this.getFileType(filePath),
        error: check.error
      };
    } catch (error) {
      logger.error(`Failed to check file ${filePath}:`, error);
      return {
        path: filePath,
        exists: false,
        type: this.getFileType(filePath),
        error: error.message
      };
    }
  }
}

module.exports = new FilePreCheckService();

