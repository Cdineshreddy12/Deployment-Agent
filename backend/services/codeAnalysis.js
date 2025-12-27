const logger = require('../utils/logger');

/**
 * Code Analysis Service
 * Analyzes application code to detect infrastructure needs
 */
class CodeAnalysisService {
  /**
   * Analyze codebase for infrastructure needs
   */
  async analyzeCodebase(keyFiles) {
    const analysis = {
      databases: [],
      storage: [],
      messaging: [],
      caching: [],
      apis: [],
      environmentVariables: [],
      security: {
        ssl: false,
        encryption: false
      }
    };
    
    // Analyze each file
    for (const [filePath, content] of Object.entries(keyFiles)) {
      if (!content) continue;
      
      // Analyze based on file type
      if (filePath.includes('package.json')) {
        this.analyzePackageJson(content, analysis);
      } else if (filePath.includes('requirements.txt')) {
        this.analyzeRequirementsTxt(content, analysis);
      } else if (filePath.includes('go.mod')) {
        this.analyzeGoMod(content, analysis);
      } else if (filePath.includes('Dockerfile')) {
        this.analyzeDockerfile(content, analysis);
      } else if (filePath.includes('docker-compose')) {
        this.analyzeDockerCompose(content, analysis);
      } else {
        // Analyze code files for patterns
        this.analyzeCodePatterns(content, filePath, analysis);
      }
    }
    
    // Deduplicate results
    analysis.databases = [...new Set(analysis.databases)];
    analysis.storage = [...new Set(analysis.storage)];
    analysis.messaging = [...new Set(analysis.messaging)];
    analysis.caching = [...new Set(analysis.caching)];
    analysis.apis = [...new Set(analysis.apis)];
    analysis.environmentVariables = [...new Set(analysis.environmentVariables)];
    
    return analysis;
  }

  /**
   * Analyze package.json for dependencies
   */
  analyzePackageJson(content, analysis) {
    try {
      const pkg = JSON.parse(content);
      
      // Check dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Database drivers
      if (deps['pg'] || deps['postgres'] || deps['postgresql']) {
        analysis.databases.push('postgresql');
      }
      if (deps['mysql'] || deps['mysql2']) {
        analysis.databases.push('mysql');
      }
      if (deps['mongodb'] || deps['mongoose']) {
        analysis.databases.push('mongodb');
      }
      if (deps['redis'] || deps['ioredis']) {
        analysis.caching.push('redis');
      }
      
      // Storage
      if (deps['aws-sdk'] || deps['@aws-sdk/client-s3']) {
        analysis.storage.push('s3');
      }
      
      // Messaging
      if (deps['amqp'] || deps['amqplib']) {
        analysis.messaging.push('rabbitmq');
      }
      if (deps['@aws-sdk/client-sqs']) {
        analysis.messaging.push('sqs');
      }
      
      // Extract environment variables from scripts or config
      if (pkg.scripts) {
        const scriptsStr = JSON.stringify(pkg.scripts);
        this.extractEnvVars(scriptsStr, analysis);
      }
    } catch (error) {
      logger.warn('Failed to parse package.json:', error.message);
    }
  }

  /**
   * Analyze requirements.txt
   */
  analyzeRequirementsTxt(content, analysis) {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const dep = line.split('==')[0].split('>=')[0].split('<=')[0].trim().toLowerCase();
      
      if (dep.includes('psycopg') || dep.includes('postgres')) {
        analysis.databases.push('postgresql');
      }
      if (dep.includes('mysql') || dep.includes('pymysql')) {
        analysis.databases.push('mysql');
      }
      if (dep.includes('pymongo') || dep.includes('motor')) {
        analysis.databases.push('mongodb');
      }
      if (dep.includes('redis') || dep.includes('redis-py')) {
        analysis.caching.push('redis');
      }
      if (dep.includes('boto') || dep.includes('boto3')) {
        analysis.storage.push('s3');
      }
    }
  }

  /**
   * Analyze go.mod
   */
  analyzeGoMod(content, analysis) {
    // Check for database drivers
    if (content.includes('github.com/lib/pq') || content.includes('postgres')) {
      analysis.databases.push('postgresql');
    }
    if (content.includes('github.com/go-sql-driver/mysql')) {
      analysis.databases.push('mysql');
    }
    if (content.includes('go.mongodb.org/mongo-driver')) {
      analysis.databases.push('mongodb');
    }
    if (content.includes('github.com/go-redis/redis')) {
      analysis.caching.push('redis');
    }
    if (content.includes('github.com/aws/aws-sdk-go')) {
      analysis.storage.push('s3');
    }
  }

  /**
   * Analyze Dockerfile
   */
  analyzeDockerfile(content, analysis) {
    // Check for database connections
    if (content.match(/POSTGRES|postgres/i)) {
      analysis.databases.push('postgresql');
    }
    if (content.match(/MYSQL|mysql/i)) {
      analysis.databases.push('mysql');
    }
    if (content.match(/MONGO|mongo/i)) {
      analysis.databases.push('mongodb');
    }
    if (content.match(/REDIS|redis/i)) {
      analysis.caching.push('redis');
    }
    
    // Extract environment variables
    const envMatches = content.matchAll(/ENV\s+(\w+)=/gi);
    for (const match of envMatches) {
      analysis.environmentVariables.push(match[1]);
    }
  }

  /**
   * Analyze docker-compose.yml
   */
  analyzeDockerCompose(content, analysis) {
    try {
      // Simple YAML parsing (basic)
      if (content.match(/postgres|postgresql/i)) {
        analysis.databases.push('postgresql');
      }
      if (content.match(/mysql|mariadb/i)) {
        analysis.databases.push('mysql');
      }
      if (content.match(/mongo/i)) {
        analysis.databases.push('mongodb');
      }
      if (content.match(/redis/i)) {
        analysis.caching.push('redis');
      }
      if (content.match(/rabbitmq/i)) {
        analysis.messaging.push('rabbitmq');
      }
    } catch (error) {
      logger.warn('Failed to analyze docker-compose:', error.message);
    }
  }

  /**
   * Analyze code patterns for infrastructure needs
   */
  analyzeCodePatterns(content, filePath, analysis) {
    // Database connection patterns
    const dbPatterns = [
      { pattern: /postgresql:\/\//i, type: 'postgresql' },
      { pattern: /mongodb:\/\//i, type: 'mongodb' },
      { pattern: /mysql:\/\//i, type: 'mysql' },
      { pattern: /redis:\/\//i, type: 'redis' }
    ];
    
    for (const { pattern, type } of dbPatterns) {
      if (pattern.test(content)) {
        if (type === 'redis') {
          analysis.caching.push('redis');
        } else {
          analysis.databases.push(type);
        }
      }
    }
    
    // S3 patterns
    if (content.match(/s3:\/\//i) || content.match(/\.amazonaws\.com\/s3/i)) {
      analysis.storage.push('s3');
    }
    
    // API endpoints
    const apiMatches = content.matchAll(/https?:\/\/([^\s"']+)/gi);
    for (const match of apiMatches) {
      const url = match[1];
      if (!url.includes('localhost') && !url.includes('127.0.0.1')) {
        analysis.apis.push(url);
      }
    }
    
    // Environment variables
    this.extractEnvVars(content, analysis);
    
    // Security patterns
    if (content.match(/ssl|tls|certificate/i)) {
      analysis.security.ssl = true;
    }
    if (content.match(/encrypt|cipher|aes/i)) {
      analysis.security.encryption = true;
    }
  }

  /**
   * Extract environment variables from content
   */
  extractEnvVars(content, analysis) {
    // Common patterns: process.env.VAR, ${VAR}, $VAR, VAR=value
    const patterns = [
      /process\.env\.(\w+)/gi,
      /\$\{(\w+)\}/g,
      /\$(\w+)/g,
      /(\w+)_URL/gi,
      /(\w+)_HOST/gi,
      /(\w+)_PORT/gi,
      /(\w+)_DATABASE/gi,
      /(\w+)_PASSWORD/gi,
      /(\w+)_KEY/gi,
      /(\w+)_SECRET/gi
    ];
    
    for (const pattern of patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const varName = match[1] || match[0];
        if (varName && varName.length > 2) {
          analysis.environmentVariables.push(varName.toUpperCase());
        }
      }
    }
  }
}

module.exports = new CodeAnalysisService();

