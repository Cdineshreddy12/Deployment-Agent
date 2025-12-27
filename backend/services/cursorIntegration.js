const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const Deployment = require('../models/Deployment');

/**
 * Cursor Integration Service
 * Reads files directly from Cursor workspace without cloning repositories
 */
class CursorIntegration {
  constructor() {
    this.workspacePaths = new Map(); // deploymentId -> workspacePath (in-memory cache)
  }

  /**
   * Set workspace path for deployment (persists to database)
   */
  async setWorkspacePath(deploymentId, workspacePath) {
    // Store in memory for fast access
    this.workspacePaths.set(deploymentId, workspacePath);
    
    // Persist to database
    try {
      await Deployment.findOneAndUpdate(
        { deploymentId },
        { workspacePath },
        { upsert: false }
      );
      logger.info(`Workspace path set and persisted for deployment ${deploymentId}: ${workspacePath}`);
    } catch (error) {
      logger.error(`Failed to persist workspace path for deployment ${deploymentId}:`, error);
      // Don't throw - memory cache is still set, so operation can continue
    }
  }

  /**
   * Get workspace path for deployment (restores from database if not in memory)
   */
  async getWorkspacePath(deploymentId) {
    // Check memory cache first (for performance)
    if (this.workspacePaths.has(deploymentId)) {
      return this.workspacePaths.get(deploymentId);
    }
    
    // Load from database and cache
    try {
      const deployment = await Deployment.findOne({ deploymentId }).select('workspacePath');
      if (deployment?.workspacePath) {
        // Cache it for future requests
        this.workspacePaths.set(deploymentId, deployment.workspacePath);
        logger.debug(`Workspace path restored from database for deployment ${deploymentId}`);
        return deployment.workspacePath;
      }
    } catch (error) {
      logger.debug(`Failed to load workspace path from database for deployment ${deploymentId}:`, error.message);
    }
    
    return null;
  }

  /**
   * Read file from workspace
   */
  async readFile(deploymentId, filePath) {
    try {
      const workspacePath = await this.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        throw new Error(`No workspace path set for deployment ${deploymentId}`);
      }

      const fullPath = path.resolve(workspacePath, filePath);
      
      // Security check: ensure path is within workspace
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!fullPath.startsWith(resolvedWorkspace)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      if (!(await fs.pathExists(fullPath))) {
        return null;
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const stats = await fs.stat(fullPath);

      return {
        content,
        path: filePath,
        fullPath,
        size: stats.size,
        modified: stats.mtime,
        exists: true
      };
    } catch (error) {
      logger.error(`Failed to read file ${filePath} for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(deploymentId, dirPath = '.') {
    try {
      const workspacePath = await this.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        throw new Error(`No workspace path set for deployment ${deploymentId}`);
      }

      const fullPath = path.resolve(workspacePath, dirPath);
      
      // Security check
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!fullPath.startsWith(resolvedWorkspace)) {
        throw new Error(`Path traversal detected: ${dirPath}`);
      }

      if (!(await fs.pathExists(fullPath))) {
        return [];
      }

      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const result = [];

      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry.name);
        const fullEntryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(fullEntryPath);

        result.push({
          name: entry.name,
          path: entryPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stats.size : null,
          modified: stats.mtime
        });
      }

      return result.sort((a, b) => {
        // Directories first, then files
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      logger.error(`Failed to list directory ${dirPath} for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Get project structure (tree)
   */
  async getStructure(deploymentId, rootPath = '.', maxDepth = 3) {
    try {
      const structure = [];
      
      const buildTree = async (currentPath, depth = 0) => {
        if (depth > maxDepth) return;

        const entries = await this.listDirectory(deploymentId, currentPath);
        
        for (const entry of entries) {
          // Skip node_modules, .git, and other common ignored directories
          if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') {
            continue;
          }
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
            continue;
          }

          const item = {
            name: entry.name,
            path: entry.path,
            type: entry.type,
            children: []
          };

          if (entry.type === 'directory' && depth < maxDepth) {
            item.children = await buildTree(entry.path, depth + 1);
          }

          structure.push(item);
        }
      };

      await buildTree(rootPath);
      return structure;
    } catch (error) {
      logger.error(`Failed to get structure for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Detect project type
   */
  async detectProjectType(deploymentId) {
    try {
      const indicators = {
        nodejs: ['package.json'],
        python: ['requirements.txt', 'setup.py', 'Pipfile', 'pyproject.toml'],
        go: ['go.mod', 'go.sum'],
        java: ['pom.xml', 'build.gradle'],
        rust: ['Cargo.toml'],
        php: ['composer.json'],
        ruby: ['Gemfile'],
        docker: ['Dockerfile', 'docker-compose.yml']
      };

      const detected = [];
      
      for (const [type, files] of Object.entries(indicators)) {
        for (const file of files) {
          const fileData = await this.readFile(deploymentId, file);
          if (fileData && fileData.exists) {
            detected.push(type);
            break;
          }
        }
      }

      // Read package.json to get more details for Node.js projects
      if (detected.includes('nodejs')) {
        try {
          const packageJson = await this.readFile(deploymentId, 'package.json');
          if (packageJson) {
            const pkg = JSON.parse(packageJson.content);
            return {
              type: 'nodejs',
              framework: this.detectFramework(pkg),
              packageManager: this.detectPackageManager(deploymentId),
              scripts: pkg.scripts || {},
              dependencies: Object.keys(pkg.dependencies || {}),
              devDependencies: Object.keys(pkg.devDependencies || {})
            };
          }
        } catch (error) {
          logger.warn('Failed to parse package.json:', error);
        }
      }

      return {
        type: detected[0] || 'unknown',
        detectedTypes: detected
      };
    } catch (error) {
      logger.error(`Failed to detect project type for deployment ${deploymentId}:`, error);
      return { type: 'unknown', error: error.message };
    }
  }

  /**
   * Detect framework from package.json
   */
  detectFramework(pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    
    if (deps.react) return 'react';
    if (deps.vue) return 'vue';
    if (deps.angular) return 'angular';
    if (deps.next) return 'next';
    if (deps['@nestjs/core']) return 'nestjs';
    if (deps.express) return 'express';
    if (deps.koa) return 'koa';
    
    return 'vanilla';
  }

  /**
   * Detect package manager
   */
  async detectPackageManager(deploymentId) {
    const lockFiles = {
      'package-lock.json': 'npm',
      'yarn.lock': 'yarn',
      'pnpm-lock.yaml': 'pnpm'
    };

    for (const [file, manager] of Object.entries(lockFiles)) {
      const lockFile = await this.readFile(deploymentId, file);
      if (lockFile && lockFile.exists) {
        return manager;
      }
    }

    return 'npm'; // default
  }

  /**
   * Read common config files
   */
  async readConfigFiles(deploymentId) {
    const configFiles = {
      packageJson: 'package.json',
      readme: 'README.md',
      envExample: '.env.example',
      env: '.env',
      dockerfile: 'Dockerfile',
      dockerCompose: 'docker-compose.yml',
      requirements: 'requirements.txt',
      goMod: 'go.mod',
      pomXml: 'pom.xml'
    };

    const results = {};
    
    for (const [key, file] of Object.entries(configFiles)) {
      try {
        const fileData = await this.readFile(deploymentId, file);
        if (fileData && fileData.exists) {
          results[key] = fileData;
          
          // Parse JSON files
          if (file.endsWith('.json')) {
            try {
              results[key].parsed = JSON.parse(fileData.content);
            } catch (e) {
              // Not valid JSON, keep as string
            }
          }
        }
      } catch (error) {
        // File doesn't exist or can't be read, skip
      }
    }

    return results;
  }

  /**
   * Write file to workspace
   */
  async writeFile(deploymentId, filePath, content) {
    try {
      const workspacePath = await this.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        throw new Error(`No workspace path set for deployment ${deploymentId}`);
      }

      const fullPath = path.resolve(workspacePath, filePath);
      
      // Security check
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!fullPath.startsWith(resolvedWorkspace)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(fullPath));

      await fs.writeFile(fullPath, content, 'utf-8');
      
      logger.info(`File written: ${filePath} for deployment ${deploymentId}`);
      
      return {
        path: filePath,
        fullPath,
        success: true
      };
    } catch (error) {
      logger.error(`Failed to write file ${filePath} for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(deploymentId, filePath) {
    try {
      const workspacePath = await this.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        return false;
      }

      const fullPath = path.resolve(workspacePath, filePath);
      const resolvedWorkspace = path.resolve(workspacePath);
      
      if (!fullPath.startsWith(resolvedWorkspace)) {
        return false;
      }

      return await fs.pathExists(fullPath);
    } catch (error) {
      return false;
    }
  }
}

module.exports = new CursorIntegration();





