const cliExecutor = require('./cliExecutor');
const cursorIntegration = require('./cursorIntegration');
const path = require('path');
const logger = require('../utils/logger');

/**
 * File Detection Service
 * Uses terminal commands to detect and read files from workspace
 * Cost-optimized: Zero LLM calls, uses free terminal commands
 */
class FileDetectionService {
  /**
   * Check if file exists using terminal command
   */
  async checkFileExists(deploymentId, filePath) {
    try {
      // Get workspace path to ensure we're in the correct directory
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      
      // If workspace path is set, use it as cwd; otherwise use relative path
      let command;
      let cwd;
      
      if (workspacePath) {
        // Use workspace path as cwd and relative file path
        cwd = workspacePath;
        // Ensure filePath is relative to workspace
        const relativePath = path.isAbsolute(filePath) 
          ? path.relative(workspacePath, filePath)
          : filePath;
        command = `test -f "${relativePath}"`;
      } else {
        // Fallback to absolute path or relative path
        command = `test -f "${filePath}"`;
      }
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: cwd,
        timeout: 5000
      });
      
      return {
        exists: result.exitCode === 0,
        path: filePath
      };
    } catch (error) {
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      logger.error(`Failed to check file existence: ${filePath}`, {
        error: error.message,
        deploymentId,
        workspacePath
      });
      return {
        exists: false,
        path: filePath,
        error: error.message
      };
    }
  }

  /**
   * Read file content using terminal command
   */
  async readFileContent(deploymentId, filePath, maxLines = null) {
    try {
      // Get workspace path to ensure we're in the correct directory
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      
      let command;
      let cwd;
      
      if (workspacePath) {
        cwd = workspacePath;
        // Ensure filePath is relative to workspace
        const relativePath = path.isAbsolute(filePath) 
          ? path.relative(workspacePath, filePath)
          : filePath;
        
        if (maxLines) {
          command = `head -n ${maxLines} "${relativePath}"`;
        } else {
          command = `cat "${relativePath}"`;
        }
      } else {
        if (maxLines) {
          command = `head -n ${maxLines} "${filePath}"`;
        } else {
          command = `cat "${filePath}"`;
        }
      }
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: cwd,
        timeout: 30000
      });
      
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to read file');
      }
      
      return {
        content: result.stdout,
        path: filePath,
        truncated: maxLines !== null
      };
    } catch (error) {
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      logger.error(`Failed to read file content: ${filePath}`, {
        error: error.message,
        deploymentId,
        workspacePath
      });
      throw error;
    }
  }

  /**
   * List files in directory using terminal command
   */
  async listFilesInDirectory(deploymentId, dirPath = '.') {
    try {
      // Get workspace path to ensure we're in the correct directory
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      
      let command;
      let cwd;
      
      if (workspacePath) {
        cwd = workspacePath;
        // Ensure dirPath is relative to workspace
        const relativePath = path.isAbsolute(dirPath) 
          ? path.relative(workspacePath, dirPath)
          : dirPath;
        command = `ls -la "${relativePath}"`;
      } else {
        command = `ls -la "${dirPath}"`;
      }
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: cwd,
        timeout: 10000
      });
      
      if (result.exitCode !== 0) {
        return [];
      }
      
      // Parse ls output
      const lines = result.stdout.split('\n').filter(line => line.trim());
      const files = [];
      
      for (const line of lines) {
        // Skip header line
        if (line.startsWith('total')) continue;
        
        // Parse ls -la format: permissions links owner group size date time name
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const name = parts.slice(8).join(' ');
          // Skip . and ..
          if (name === '.' || name === '..') continue;
          
          const isDirectory = line.startsWith('d');
          const fullPath = dirPath === '.' ? name : `${dirPath}/${name}`;
          
          files.push({
            name,
            path: fullPath,
            isDirectory,
            size: parseInt(parts[4], 10) || 0
          });
        }
      }
      
      return files;
    } catch (error) {
      logger.error(`Failed to list directory: ${dirPath}`, error);
      return [];
    }
  }

  /**
   * Detect which expected files actually exist
   */
  async detectGeneratedFiles(deploymentId, expectedFiles) {
    const results = {
      existing: [],
      missing: [],
      errors: []
    };
    
    // Check files in parallel (batch of 10 at a time)
    const batchSize = 10;
    for (let i = 0; i < expectedFiles.length; i += batchSize) {
      const batch = expectedFiles.slice(i, i + batchSize);
      
      const checks = await Promise.all(
        batch.map(async (file) => {
          try {
            const checkResult = await this.checkFileExists(deploymentId, file.path);
            return {
              ...file,
              exists: checkResult.exists,
              error: checkResult.error
            };
          } catch (error) {
            logger.error(`Error checking file ${file.path}:`, error);
            return {
              ...file,
              exists: false,
              error: error.message
            };
          }
        })
      );
      
      // Categorize results
      for (const check of checks) {
        if (check.exists) {
          results.existing.push(check);
        } else if (check.error) {
          results.errors.push(check);
        } else {
          results.missing.push(check);
        }
      }
    }
    
    logger.info('Detected generated files', {
      deploymentId,
      expected: expectedFiles.length,
      existing: results.existing.length,
      missing: results.missing.length,
      errors: results.errors.length
    });
    
    return results;
  }

  /**
   * Read contents of multiple files
   */
  async readFileContents(deploymentId, filePaths, maxLinesPerFile = null) {
    const contents = {};
    
    // Read files in parallel (batch of 5 at a time to avoid overwhelming)
    const batchSize = 5;
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      
      const reads = await Promise.all(
        batch.map(async (filePath) => {
          try {
            const result = await this.readFileContent(deploymentId, filePath, maxLinesPerFile);
            return {
              path: filePath,
              content: result.content,
              truncated: result.truncated
            };
          } catch (error) {
            logger.error(`Failed to read file ${filePath}:`, error);
            return {
              path: filePath,
              content: null,
              error: error.message
            };
          }
        })
      );
      
      for (const read of reads) {
        contents[read.path] = read;
      }
    }
    
    return contents;
  }

  /**
   * Search for pattern in file using grep
   */
  async searchInFile(deploymentId, filePath, pattern) {
    try {
      const command = `grep -n "${pattern}" "${filePath}" || true`;
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        timeout: 10000
      });
      
      return {
        matches: result.stdout.split('\n').filter(line => line.trim()),
        path: filePath
      };
    } catch (error) {
      logger.error(`Failed to search in file ${filePath}:`, error);
      return {
        matches: [],
        path: filePath,
        error: error.message
      };
    }
  }

  /**
   * Get file size using terminal command
   */
  async getFileSize(deploymentId, filePath) {
    try {
      const command = `stat -f%z "${filePath}" 2>/dev/null || stat -c%s "${filePath}" 2>/dev/null || wc -c < "${filePath}"`;
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        timeout: 5000
      });
      
      if (result.exitCode === 0) {
        return parseInt(result.stdout.trim(), 10) || 0;
      }
      
      return 0;
    } catch (error) {
      logger.error(`Failed to get file size: ${filePath}`, error);
      return 0;
    }
  }

  /**
   * Check if directory exists
   */
  async checkDirectoryExists(deploymentId, dirPath) {
    try {
      const command = `test -d "${dirPath}"`;
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        timeout: 5000
      });
      
      return result.exitCode === 0;
    } catch (error) {
      logger.error(`Failed to check directory existence: ${dirPath}`, error);
      return false;
    }
  }

  /**
   * Find files matching pattern using find command
   */
  async findFiles(deploymentId, pattern, searchPath = '.') {
    try {
      // Get workspace path to ensure we're in the correct directory
      const workspacePath = await cursorIntegration.getWorkspacePath(deploymentId);
      
      let command;
      let cwd;
      
      if (workspacePath) {
        cwd = workspacePath;
        // Use workspace path as search path if not specified
        const actualSearchPath = searchPath === '.' ? workspacePath : 
          (path.isAbsolute(searchPath) ? searchPath : path.join(workspacePath, searchPath));
        command = `find "${actualSearchPath}" -name "${pattern}" -type f 2>/dev/null | head -20`;
      } else {
        command = `find "${searchPath}" -name "${pattern}" -type f 2>/dev/null | head -20`;
      }
      
      const result = await cliExecutor.executeDeployment(deploymentId, command, {
        cwd: cwd,
        timeout: 10000
      });
      
      if (result.exitCode !== 0) {
        return [];
      }
      
      const foundFiles = result.stdout
        .split('\n')
        .filter(line => line.trim())
        .map(filePath => {
          // If workspace path is set, make paths relative to workspace
          if (workspacePath && filePath.startsWith(workspacePath)) {
            return path.relative(workspacePath, filePath);
          }
          return filePath.trim();
        });
      
      return foundFiles;
    } catch (error) {
      logger.error(`Failed to find files: ${pattern}`, error);
      return [];
    }
  }
}

module.exports = new FileDetectionService();

