const githubService = require('./githubService');
const codeAnalysis = require('./codeAnalysis');
const cursorIntegration = require('./cursorIntegration');
const logger = require('../utils/logger');

/**
 * Environment Variable Detector Service
 * Detects required .env variables from codebase
 */
class EnvDetector {
  /**
   * Detect environment variables from local workspace path
   */
  async detectFromWorkspace(deploymentId, workspacePath) {
    try {
      // Ensure workspace path is set in cursorIntegration
      if (!cursorIntegration.getWorkspacePath(deploymentId)) {
        cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
      }

      const detectedVars = {
        fromFiles: [],
        fromCode: [],
        fromExamples: [],
        all: new Set()
      };

      // 1. Read .env.example or .env.template files
      const exampleFiles = ['.env.example', '.env.template', '.env.sample', '.env.local.example'];
      for (const fileName of exampleFiles) {
        try {
          const file = await cursorIntegration.readFile(deploymentId, fileName);
          if (file && file.content) {
            const vars = this.extractFromEnvFile(file.content);
            detectedVars.fromExamples.push(...vars);
            vars.forEach(v => detectedVars.all.add(v));
          }
        } catch (error) {
          // File doesn't exist, continue
        }
      }

      // 2. Read common config files
      const configFiles = ['config.js', 'config.json', 'settings.js', 'app.config.js'];
      for (const fileName of configFiles) {
        try {
          const file = await cursorIntegration.readFile(deploymentId, fileName);
          if (file && file.content) {
            const vars = this.extractFromConfigFile(file.content, fileName);
            detectedVars.fromFiles.push(...vars);
            vars.forEach(v => detectedVars.all.add(v));
          }
        } catch (error) {
          // File doesn't exist, continue
        }
      }

      // 3. Analyze code for environment variable patterns
      const keyFiles = await this.getKeyFilesFromWorkspace(deploymentId);
      for (const [filePath, content] of Object.entries(keyFiles)) {
        const vars = this.extractFromCode(content, filePath);
        detectedVars.fromCode.push(...vars);
        vars.forEach(v => detectedVars.all.add(v));
      }

      // Convert to array and create schema
      const allVars = Array.from(detectedVars.all);
      const schema = this.generateEnvSchema(allVars, detectedVars);

      return {
        variables: allVars,
        schema,
        sources: {
          fromExamples: detectedVars.fromExamples,
          fromFiles: detectedVars.fromFiles,
          fromCode: detectedVars.fromCode
        }
      };
    } catch (error) {
      logger.error('Failed to detect environment variables from workspace:', error);
      throw error;
    }
  }

  /**
   * Get key files from workspace for analysis
   */
  async getKeyFilesFromWorkspace(deploymentId) {
    const keyFiles = {};
    const filesToRead = [
      'package.json',
      'index.js',
      'server.js',
      'app.js',
      'main.js',
      'main.py',
      'app.py',
      'config.js',
      'config.json',
      'src/index.js',
      'src/main.js',
      'src/app.js',
      'backend/server.js',
      'backend/app.js'
    ];

    for (const filePath of filesToRead) {
      try {
        const file = await cursorIntegration.readFile(deploymentId, filePath);
        if (file && file.content) {
          keyFiles[filePath] = file.content;
        }
      } catch (error) {
        // File doesn't exist, continue
      }
    }

    return keyFiles;
  }

  /**
   * Detect environment variables from repository
   */
  async detectFromRepository(repositoryUrl, branch = null) {
    try {
      const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
      const detectedVars = {
        fromFiles: [],
        fromCode: [],
        fromExamples: [],
        all: new Set()
      };
      
      // 1. Read .env.example or .env.template files
      const exampleFiles = ['.env.example', '.env.template', '.env.sample', '.env.local.example'];
      for (const fileName of exampleFiles) {
        try {
          const file = await githubService.readFile(owner, repo, fileName, branch);
          const vars = this.extractFromEnvFile(file.content);
          detectedVars.fromExamples.push(...vars);
          vars.forEach(v => detectedVars.all.add(v));
        } catch (error) {
          // File doesn't exist, continue
        }
      }
      
      // 2. Read common config files
      const configFiles = ['config.js', 'config.json', 'settings.js', 'app.config.js'];
      for (const fileName of configFiles) {
        try {
          const file = await githubService.readFile(owner, repo, fileName, branch);
          const vars = this.extractFromConfigFile(file.content, fileName);
          detectedVars.fromFiles.push(...vars);
          vars.forEach(v => detectedVars.all.add(v));
        } catch (error) {
          // File doesn't exist, continue
        }
      }
      
      // 3. Analyze code for environment variable patterns
      const keyFiles = await this.getKeyFiles(owner, repo, branch);
      for (const [filePath, content] of Object.entries(keyFiles)) {
        const vars = this.extractFromCode(content, filePath);
        detectedVars.fromCode.push(...vars);
        vars.forEach(v => detectedVars.all.add(v));
      }
      
      // Convert to array and create schema
      const allVars = Array.from(detectedVars.all);
      const schema = this.generateEnvSchema(allVars, detectedVars);
      
      return {
        variables: allVars,
        schema,
        sources: {
          fromExamples: detectedVars.fromExamples,
          fromFiles: detectedVars.fromFiles,
          fromCode: detectedVars.fromCode
        }
      };
    } catch (error) {
      logger.error('Failed to detect environment variables:', error);
      throw error;
    }
  }

  /**
   * Extract variables from .env file
   */
  extractFromEnvFile(content) {
    const variables = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
        if (match) {
          variables.push(match[1]);
        }
      }
    }
    
    return variables;
  }

  /**
   * Extract variables from config files
   */
  extractFromConfigFile(content, fileName) {
    const variables = [];
    
    // JavaScript/TypeScript config files
    if (fileName.endsWith('.js')) {
      // Match process.env.VAR_NAME or process.env['VAR_NAME']
      const matches = content.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/gi);
      for (const match of matches) {
        variables.push(match[1]);
      }
      
      // Match process.env['VAR_NAME']
      const bracketMatches = content.matchAll(/process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/gi);
      for (const match of bracketMatches) {
        variables.push(match[1]);
      }
    }
    
    // JSON config files
    if (fileName.endsWith('.json')) {
      try {
        const config = JSON.parse(content);
        this.extractFromObject(config, variables, '');
      } catch (error) {
        // Not valid JSON
      }
    }
    
    return variables;
  }

  /**
   * Extract variables from code
   */
  extractFromCode(content, filePath) {
    const variables = [];
    
    // Common patterns
    const patterns = [
      /process\.env\.([A-Z_][A-Z0-9_]*)/gi,
      /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/gi,
      /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/gi,
      /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]\)/gi,
      /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]\]/gi,
      /env\.get\(['"]([A-Z_][A-Z0-9_]*)['"]\)/gi,
      /\$\{([A-Z_][A-Z0-9_]*)\}/g,
      /([A-Z_][A-Z0-9_]*)_URL/gi,
      /([A-Z_][A-Z0-9_]*)_HOST/gi,
      /([A-Z_][A-Z0-9_]*)_PORT/gi,
      /([A-Z_][A-Z0-9_]*)_DATABASE/gi,
      /([A-Z_][A-Z0-9_]*)_PASSWORD/gi,
      /([A-Z_][A-Z0-9_]*)_KEY/gi,
      /([A-Z_][A-Z0-9_]*)_SECRET/gi,
      /([A-Z_][A-Z0-9_]*)_TOKEN/gi
    ];
    
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const varName = match[1] || match[0];
        if (varName && varName.length > 2 && varName.match(/^[A-Z_][A-Z0-9_]*$/)) {
          variables.push(varName);
        }
      }
    }
    
    return variables;
  }

  /**
   * Extract variables from object (for JSON configs)
   */
  extractFromObject(obj, variables, prefix) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.extractFromObject(value, variables, fullKey.toUpperCase());
      } else if (typeof value === 'string' && value.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/)) {
        const match = value.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
        if (match) {
          variables.push(match[1]);
        }
      }
    }
  }

  /**
   * Get key files for analysis
   */
  async getKeyFiles(owner, repo, branch) {
    const keyFiles = {};
    const filesToRead = [
      'package.json',
      'index.js',
      'server.js',
      'app.js',
      'main.js',
      'main.py',
      'app.py',
      'config.js',
      'config.json'
    ];
    
    for (const filePath of filesToRead) {
      try {
        const file = await githubService.readFile(owner, repo, filePath, branch);
        keyFiles[filePath] = file.content;
      } catch (error) {
        // File doesn't exist, continue
      }
    }
    
    return keyFiles;
  }

  /**
   * Generate environment variable schema
   */
  generateEnvSchema(variables, sources) {
    const schema = {};
    
    for (const varName of variables) {
      schema[varName] = {
        name: varName,
        required: sources.fromExamples.includes(varName) || sources.fromCode.includes(varName),
        description: this.inferDescription(varName),
        defaultValue: null,
        type: this.inferType(varName)
      };
    }
    
    return schema;
  }

  /**
   * Infer description from variable name
   */
  inferDescription(varName) {
    const descriptions = {
      'DATABASE_URL': 'Database connection string',
      'DATABASE_HOST': 'Database host address',
      'DATABASE_PORT': 'Database port number',
      'DATABASE_NAME': 'Database name',
      'DATABASE_USER': 'Database username',
      'DATABASE_PASSWORD': 'Database password',
      'REDIS_URL': 'Redis connection URL',
      'REDIS_HOST': 'Redis host address',
      'REDIS_PORT': 'Redis port number',
      'API_KEY': 'API key for external service',
      'SECRET_KEY': 'Secret key for encryption',
      'JWT_SECRET': 'JWT token secret',
      'NODE_ENV': 'Node.js environment (development, production, etc.)',
      'PORT': 'Application port number'
    };
    
    // Try exact match
    if (descriptions[varName]) {
      return descriptions[varName];
    }
    
    // Try pattern matching
    if (varName.includes('URL')) return `${varName.replace('_URL', '')} service URL`;
    if (varName.includes('HOST')) return `${varName.replace('_HOST', '')} host address`;
    if (varName.includes('PORT')) return `${varName.replace('_PORT', '')} port number`;
    if (varName.includes('PASSWORD')) return `${varName.replace('_PASSWORD', '')} password`;
    if (varName.includes('KEY')) return `${varName.replace('_KEY', '')} API key`;
    if (varName.includes('SECRET')) return `${varName.replace('_SECRET', '')} secret`;
    if (varName.includes('TOKEN')) return `${varName.replace('_TOKEN', '')} authentication token`;
    
    return `Environment variable: ${varName}`;
  }

  /**
   * Infer type from variable name
   */
  inferType(varName) {
    if (varName.includes('PORT') || varName === 'PORT') return 'number';
    if (varName.includes('URL') || varName.includes('HOST')) return 'string';
    if (varName.includes('PASSWORD') || varName.includes('SECRET') || varName.includes('KEY') || varName.includes('TOKEN')) return 'password';
    if (varName.includes('ENABLED') || varName.includes('DISABLED')) return 'boolean';
    return 'string';
  }
}

module.exports = new EnvDetector();

