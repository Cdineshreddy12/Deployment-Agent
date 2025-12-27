const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../../utils/logger');

/**
 * File System MCP Tools
 * Provides file operations for the deployment agent
 */

/**
 * Check if a path should be ignored based on .gitignore patterns
 */
function shouldIgnore(filePath, gitignorePatterns) {
  const relativePath = filePath;
  
  // Common patterns to always ignore
  const defaultIgnore = [
    'node_modules',
    '.git',
    '.DS_Store',
    'dist',
    'build',
    '.next',
    '__pycache__',
    '.pytest_cache',
    'venv',
    '.env',
    '*.log'
  ];
  
  const allPatterns = [...defaultIgnore, ...gitignorePatterns];
  
  for (const pattern of allPatterns) {
    if (pattern.startsWith('#') || !pattern.trim()) continue;
    
    // Simple pattern matching
    if (relativePath.includes(pattern.replace('*', ''))) {
      return true;
    }
    if (pattern.endsWith('/') && relativePath.startsWith(pattern.slice(0, -1))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse .gitignore file
 */
async function parseGitignore(projectPath) {
  try {
    const gitignorePath = path.join(projectPath, '.gitignore');
    const content = await fs.readFile(gitignorePath, 'utf8');
    return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * List files in a directory
 */
async function listFiles({ projectPath, recursive = true, respectGitignore = true, maxDepth = 10 }) {
  try {
    const absolutePath = path.resolve(projectPath);
    
    // Verify path exists
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${absolutePath}`);
    }
    
    const gitignorePatterns = respectGitignore ? await parseGitignore(absolutePath) : [];
    const files = [];
    const directories = [];
    
    async function scanDirectory(dirPath, depth = 0) {
      if (depth > maxDepth) return;
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(absolutePath, fullPath);
        
        if (respectGitignore && shouldIgnore(relativePath, gitignorePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          directories.push({
            name: entry.name,
            path: relativePath,
            type: 'directory'
          });
          
          if (recursive) {
            await scanDirectory(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const fileStats = await fs.stat(fullPath);
          files.push({
            name: entry.name,
            path: relativePath,
            type: 'file',
            size: fileStats.size,
            extension: path.extname(entry.name).slice(1) || null,
            modifiedAt: fileStats.mtime
          });
        }
      }
    }
    
    await scanDirectory(absolutePath);
    
    // Build tree structure
    const tree = buildFileTree(files, directories);
    
    return {
      success: true,
      projectPath: absolutePath,
      totalFiles: files.length,
      totalDirectories: directories.length,
      files,
      directories,
      tree
    };
    
  } catch (error) {
    logger.error('listFiles failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Build a tree structure from files and directories
 */
function buildFileTree(files, directories) {
  const tree = {};
  
  // Add directories first
  for (const dir of directories) {
    const parts = dir.path.split(path.sep);
    let current = tree;
    
    for (const part of parts) {
      if (!current[part]) {
        current[part] = { _type: 'directory', _children: {} };
      }
      current = current[part]._children;
    }
  }
  
  // Add files
  for (const file of files) {
    const parts = file.path.split(path.sep);
    let current = tree;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = { _type: 'directory', _children: {} };
      }
      current = current[part]._children;
    }
    
    const fileName = parts[parts.length - 1];
    current[fileName] = { _type: 'file', ...file };
  }
  
  return tree;
}

/**
 * Read a file's contents
 */
async function readFile({ filePath, encoding = 'utf8' }) {
  try {
    const absolutePath = path.resolve(filePath);
    
    // Check if file exists
    const exists = fsSync.existsSync(absolutePath);
    if (!exists) {
      return {
        success: false,
        error: `File not found: ${absolutePath}`
      };
    }
    
    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      return {
        success: false,
        error: `Path is a directory, not a file: ${absolutePath}`
      };
    }
    
    // Check file size (limit to 10MB)
    if (stats.size > 10 * 1024 * 1024) {
      return {
        success: false,
        error: `File too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max 10MB.`
      };
    }
    
    const content = await fs.readFile(absolutePath, encoding);
    
    return {
      success: true,
      filePath: absolutePath,
      content,
      size: stats.size,
      encoding,
      modifiedAt: stats.mtime
    };
    
  } catch (error) {
    logger.error('readFile failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Write content to a file
 */
async function writeFile({ filePath, content, createDirectories = true, backup = true }) {
  try {
    const absolutePath = path.resolve(filePath);
    const directory = path.dirname(absolutePath);
    
    // Create parent directories if needed
    if (createDirectories) {
      await fs.mkdir(directory, { recursive: true });
    }
    
    // Backup existing file if it exists
    let backupPath = null;
    if (backup && fsSync.existsSync(absolutePath)) {
      backupPath = `${absolutePath}.backup.${Date.now()}`;
      await fs.copyFile(absolutePath, backupPath);
    }
    
    // Write the file
    await fs.writeFile(absolutePath, content, 'utf8');
    
    const stats = await fs.stat(absolutePath);
    
    return {
      success: true,
      filePath: absolutePath,
      size: stats.size,
      created: !backupPath,
      backupPath,
      message: `File written successfully: ${absolutePath}`
    };
    
  } catch (error) {
    logger.error('writeFile failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create a directory
 */
async function createDirectory({ dirPath, recursive = true }) {
  try {
    const absolutePath = path.resolve(dirPath);
    
    // Check if already exists
    if (fsSync.existsSync(absolutePath)) {
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        return {
          success: true,
          dirPath: absolutePath,
          created: false,
          message: 'Directory already exists'
        };
      } else {
        return {
          success: false,
          error: 'Path exists but is not a directory'
        };
      }
    }
    
    await fs.mkdir(absolutePath, { recursive });
    
    return {
      success: true,
      dirPath: absolutePath,
      created: true,
      message: `Directory created: ${absolutePath}`
    };
    
  } catch (error) {
    logger.error('createDirectory failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Delete a file
 */
async function deleteFile({ filePath, backup = true }) {
  try {
    const absolutePath = path.resolve(filePath);
    
    if (!fsSync.existsSync(absolutePath)) {
      return {
        success: false,
        error: `File not found: ${absolutePath}`
      };
    }
    
    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      return {
        success: false,
        error: 'Cannot delete directory with deleteFile. Use deleteDirectory instead.'
      };
    }
    
    // Backup before deleting
    let backupPath = null;
    if (backup) {
      backupPath = `${absolutePath}.deleted.${Date.now()}`;
      await fs.copyFile(absolutePath, backupPath);
    }
    
    await fs.unlink(absolutePath);
    
    return {
      success: true,
      filePath: absolutePath,
      backupPath,
      message: `File deleted: ${absolutePath}`
    };
    
  } catch (error) {
    logger.error('deleteFile failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if a file or directory exists
 */
async function fileExists({ filePath }) {
  try {
    const absolutePath = path.resolve(filePath);
    const exists = fsSync.existsSync(absolutePath);
    
    if (!exists) {
      return {
        success: true,
        exists: false,
        filePath: absolutePath
      };
    }
    
    const stats = await fs.stat(absolutePath);
    
    return {
      success: true,
      exists: true,
      filePath: absolutePath,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modifiedAt: stats.mtime
    };
    
  } catch (error) {
    logger.error('fileExists failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get a diff of what would change if we wrote new content
 */
async function getFileDiff({ filePath, newContent }) {
  try {
    const absolutePath = path.resolve(filePath);
    
    if (!fsSync.existsSync(absolutePath)) {
      // File doesn't exist, entire content is new
      const lines = newContent.split('\n');
      return {
        success: true,
        filePath: absolutePath,
        isNewFile: true,
        additions: lines.length,
        deletions: 0,
        diff: lines.map((line, i) => `+ ${i + 1}: ${line}`).join('\n'),
        preview: newContent.substring(0, 1000) + (newContent.length > 1000 ? '\n... (truncated)' : '')
      };
    }
    
    const existingContent = await fs.readFile(absolutePath, 'utf8');
    const existingLines = existingContent.split('\n');
    const newLines = newContent.split('\n');
    
    // Simple diff - show lines that changed
    const changes = [];
    let additions = 0;
    let deletions = 0;
    
    const maxLen = Math.max(existingLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = existingLines[i];
      const newLine = newLines[i];
      
      if (oldLine !== newLine) {
        if (oldLine !== undefined) {
          changes.push(`- ${i + 1}: ${oldLine}`);
          deletions++;
        }
        if (newLine !== undefined) {
          changes.push(`+ ${i + 1}: ${newLine}`);
          additions++;
        }
      }
    }
    
    return {
      success: true,
      filePath: absolutePath,
      isNewFile: false,
      hasChanges: changes.length > 0,
      additions,
      deletions,
      diff: changes.join('\n'),
      preview: changes.slice(0, 50).join('\n') + (changes.length > 50 ? '\n... (more changes)' : '')
    };
    
  } catch (error) {
    logger.error('getFileDiff failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Search for a pattern in files
 */
async function searchInFiles({ projectPath, pattern, fileExtensions = null, maxResults = 100 }) {
  try {
    const absolutePath = path.resolve(projectPath);
    const results = [];
    const gitignorePatterns = await parseGitignore(absolutePath);
    
    async function searchDirectory(dirPath) {
      if (results.length >= maxResults) return;
      
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (results.length >= maxResults) break;
        
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(absolutePath, fullPath);
        
        if (shouldIgnore(relativePath, gitignorePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          await searchDirectory(fullPath);
        } else if (entry.isFile()) {
          // Check file extension filter
          if (fileExtensions) {
            const ext = path.extname(entry.name).slice(1);
            if (!fileExtensions.includes(ext)) continue;
          }
          
          try {
            const content = await fs.readFile(fullPath, 'utf8');
            const regex = new RegExp(pattern, 'gi');
            const matches = [];
            let match;
            
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                matches.push({
                  line: i + 1,
                  content: lines[i].trim().substring(0, 200)
                });
              }
              regex.lastIndex = 0; // Reset regex
            }
            
            if (matches.length > 0) {
              results.push({
                file: relativePath,
                matches
              });
            }
          } catch {
            // Skip binary files or files that can't be read
          }
        }
      }
    }
    
    await searchDirectory(absolutePath);
    
    return {
      success: true,
      projectPath: absolutePath,
      pattern,
      totalResults: results.length,
      results
    };
    
  } catch (error) {
    logger.error('searchInFiles failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Copy a file
 */
async function copyFile({ sourcePath, destinationPath, overwrite = false }) {
  try {
    const absoluteSource = path.resolve(sourcePath);
    const absoluteDest = path.resolve(destinationPath);
    
    if (!fsSync.existsSync(absoluteSource)) {
      return {
        success: false,
        error: `Source file not found: ${absoluteSource}`
      };
    }
    
    if (!overwrite && fsSync.existsSync(absoluteDest)) {
      return {
        success: false,
        error: `Destination file already exists: ${absoluteDest}`
      };
    }
    
    // Create destination directory if needed
    await fs.mkdir(path.dirname(absoluteDest), { recursive: true });
    
    await fs.copyFile(absoluteSource, absoluteDest);
    
    return {
      success: true,
      sourcePath: absoluteSource,
      destinationPath: absoluteDest,
      message: 'File copied successfully'
    };
    
  } catch (error) {
    logger.error('copyFile failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get MCP tool definitions
 */
function getTools() {
  return [
    {
      name: 'listFiles',
      description: 'List all files and directories in a project path. Returns file tree structure.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Absolute or relative path to the project directory'
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to scan subdirectories recursively',
            default: true
          },
          respectGitignore: {
            type: 'boolean',
            description: 'Whether to respect .gitignore patterns',
            default: true
          },
          maxDepth: {
            type: 'number',
            description: 'Maximum directory depth to scan',
            default: 10
          }
        },
        required: ['projectPath']
      },
      handler: listFiles
    },
    {
      name: 'readFile',
      description: 'Read the contents of a file',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to read'
          },
          encoding: {
            type: 'string',
            description: 'File encoding',
            default: 'utf8'
          }
        },
        required: ['filePath']
      },
      handler: readFile
    },
    {
      name: 'writeFile',
      description: 'Write content to a file. Creates parent directories if needed.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to write'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          },
          createDirectories: {
            type: 'boolean',
            description: 'Create parent directories if they don\'t exist',
            default: true
          },
          backup: {
            type: 'boolean',
            description: 'Create backup of existing file before overwriting',
            default: true
          }
        },
        required: ['filePath', 'content']
      },
      handler: writeFile
    },
    {
      name: 'createDirectory',
      description: 'Create a directory (and parent directories if needed)',
      inputSchema: {
        type: 'object',
        properties: {
          dirPath: {
            type: 'string',
            description: 'Path to the directory to create'
          },
          recursive: {
            type: 'boolean',
            description: 'Create parent directories if needed',
            default: true
          }
        },
        required: ['dirPath']
      },
      handler: createDirectory
    },
    {
      name: 'deleteFile',
      description: 'Delete a file (with optional backup)',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file to delete'
          },
          backup: {
            type: 'boolean',
            description: 'Create backup before deleting',
            default: true
          }
        },
        required: ['filePath']
      },
      handler: deleteFile
    },
    {
      name: 'fileExists',
      description: 'Check if a file or directory exists',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to check'
          }
        },
        required: ['filePath']
      },
      handler: fileExists
    },
    {
      name: 'getFileDiff',
      description: 'Get a diff showing what would change if we wrote new content to a file',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the file'
          },
          newContent: {
            type: 'string',
            description: 'New content to compare against existing file'
          }
        },
        required: ['filePath', 'newContent']
      },
      handler: getFileDiff
    },
    {
      name: 'searchInFiles',
      description: 'Search for a pattern in files within a project',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory'
          },
          pattern: {
            type: 'string',
            description: 'Regex pattern to search for'
          },
          fileExtensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of file extensions to search (e.g., ["js", "ts"])'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 100
          }
        },
        required: ['projectPath', 'pattern']
      },
      handler: searchInFiles
    },
    {
      name: 'copyFile',
      description: 'Copy a file from source to destination',
      inputSchema: {
        type: 'object',
        properties: {
          sourcePath: {
            type: 'string',
            description: 'Source file path'
          },
          destinationPath: {
            type: 'string',
            description: 'Destination file path'
          },
          overwrite: {
            type: 'boolean',
            description: 'Overwrite if destination exists',
            default: false
          }
        },
        required: ['sourcePath', 'destinationPath']
      },
      handler: copyFile
    }
  ];
}

module.exports = {
  getTools,
  listFiles,
  readFile,
  writeFile,
  createDirectory,
  deleteFile,
  fileExists,
  getFileDiff,
  searchInFiles,
  copyFile
};


