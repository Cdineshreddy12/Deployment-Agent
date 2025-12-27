const logger = require('../utils/logger');

/**
 * Dependency Analysis Service
 * Analyzes application dependencies to determine infrastructure requirements
 */
class DependencyAnalysisService {
  /**
   * Analyze dependencies from key files
   */
  async analyzeDependencies(keyFiles) {
    const analysis = {
      runtime: {
        language: null,
        versions: []
      },
      dependencies: {
        count: 0,
        critical: []
      },
      infrastructure: {
        databases: [],
        storage: [],
        messaging: [],
        caching: [],
        compute: null
      },
      recommendations: {
        sizing: null,
        resources: []
      }
    };
    
    // Analyze each file
    for (const [filePath, content] of Object.entries(keyFiles)) {
      if (!content) continue;
      
      if (filePath.includes('package.json')) {
        this.analyzeNodeDependencies(content, analysis);
      } else if (filePath.includes('requirements.txt')) {
        this.analyzePythonDependencies(content, analysis);
      } else if (filePath.includes('go.mod')) {
        this.analyzeGoDependencies(content, analysis);
      } else if (filePath.includes('pom.xml')) {
        this.analyzeJavaDependencies(content, analysis);
      } else if (filePath.includes('Cargo.toml')) {
        this.analyzeRustDependencies(content, analysis);
      } else if (filePath.includes('Dockerfile')) {
        this.analyzeDockerfileDependencies(content, analysis);
      }
    }
    
    // Generate recommendations
    this.generateRecommendations(analysis);
    
    return analysis;
  }

  /**
   * Analyze Node.js dependencies
   */
  analyzeNodeDependencies(content, analysis) {
    try {
      const pkg = JSON.parse(content);
      analysis.runtime.language = 'nodejs';
      
      // Extract Node version
      if (pkg.engines?.node) {
        analysis.runtime.versions.push(`node: ${pkg.engines.node}`);
      }
      
      // Count dependencies
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      analysis.dependencies.count = Object.keys(deps).length;
      
      // Identify critical infrastructure dependencies
      for (const [dep, version] of Object.entries(deps)) {
        const depLower = dep.toLowerCase();
        
        // Databases
        if (depLower.includes('pg') || depLower.includes('postgres')) {
          analysis.infrastructure.databases.push({ type: 'postgresql', driver: dep });
        }
        if (depLower.includes('mysql')) {
          analysis.infrastructure.databases.push({ type: 'mysql', driver: dep });
        }
        if (depLower.includes('mongo')) {
          analysis.infrastructure.databases.push({ type: 'mongodb', driver: dep });
        }
        
        // Caching
        if (depLower.includes('redis')) {
          analysis.infrastructure.caching.push({ type: 'redis', driver: dep });
        }
        
        // Storage
        if (depLower.includes('aws-sdk') || depLower.includes('s3')) {
          analysis.infrastructure.storage.push({ type: 's3', driver: dep });
        }
        
        // Messaging
        if (depLower.includes('amqp') || depLower.includes('rabbitmq')) {
          analysis.infrastructure.messaging.push({ type: 'rabbitmq', driver: dep });
        }
        if (depLower.includes('sqs')) {
          analysis.infrastructure.messaging.push({ type: 'sqs', driver: dep });
        }
        
        // Framework detection for compute recommendations
        if (depLower.includes('express') || depLower.includes('fastify')) {
          analysis.infrastructure.compute = 'serverless-lambda';
        }
        if (depLower.includes('next')) {
          analysis.infrastructure.compute = 'serverless-lambda';
        }
        if (depLower.includes('nestjs')) {
          analysis.infrastructure.compute = 'container-ecs';
        }
      }
    } catch (error) {
      logger.warn('Failed to parse package.json:', error.message);
    }
  }

  /**
   * Analyze Python dependencies
   */
  analyzePythonDependencies(content, analysis) {
    analysis.runtime.language = 'python';
    
    const lines = content.split('\n');
    let depCount = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      depCount++;
      const dep = trimmed.split('==')[0].split('>=')[0].split('<=')[0].trim().toLowerCase();
      
      // Extract Python version if specified
      if (dep.startsWith('python')) {
        analysis.runtime.versions.push(dep);
        continue;
      }
      
      // Database drivers
      if (dep.includes('psycopg') || dep.includes('postgres')) {
        analysis.infrastructure.databases.push({ type: 'postgresql', driver: dep });
      }
      if (dep.includes('mysql') || dep.includes('pymysql')) {
        analysis.infrastructure.databases.push({ type: 'mysql', driver: dep });
      }
      if (dep.includes('pymongo') || dep.includes('motor')) {
        analysis.infrastructure.databases.push({ type: 'mongodb', driver: dep });
      }
      
      // Caching
      if (dep.includes('redis')) {
        analysis.infrastructure.caching.push({ type: 'redis', driver: dep });
      }
      
      // Storage
      if (dep.includes('boto') || dep.includes('boto3')) {
        analysis.infrastructure.storage.push({ type: 's3', driver: dep });
      }
      
      // Framework detection
      if (dep.includes('flask')) {
        analysis.infrastructure.compute = 'container-ecs';
      }
      if (dep.includes('django')) {
        analysis.infrastructure.compute = 'container-ecs';
      }
      if (dep.includes('fastapi')) {
        analysis.infrastructure.compute = 'serverless-lambda';
      }
    }
    
    analysis.dependencies.count = depCount;
  }

  /**
   * Analyze Go dependencies
   */
  analyzeGoDependencies(content, analysis) {
    analysis.runtime.language = 'go';
    
    // Extract Go version
    const goVersionMatch = content.match(/go\s+(\d+\.\d+)/i);
    if (goVersionMatch) {
      analysis.runtime.versions.push(`go: ${goVersionMatch[1]}`);
    }
    
    // Count dependencies
    const depMatches = content.matchAll(/require\s+\(/g);
    let depCount = 0;
    
    // Check for database drivers
    if (content.includes('github.com/lib/pq') || content.includes('postgres')) {
      analysis.infrastructure.databases.push({ type: 'postgresql', driver: 'lib/pq' });
      depCount++;
    }
    if (content.includes('github.com/go-sql-driver/mysql')) {
      analysis.infrastructure.databases.push({ type: 'mysql', driver: 'go-sql-driver/mysql' });
      depCount++;
    }
    if (content.includes('go.mongodb.org/mongo-driver')) {
      analysis.infrastructure.databases.push({ type: 'mongodb', driver: 'mongo-driver' });
      depCount++;
    }
    if (content.includes('github.com/go-redis/redis')) {
      analysis.infrastructure.caching.push({ type: 'redis', driver: 'go-redis/redis' });
      depCount++;
    }
    if (content.includes('github.com/aws/aws-sdk-go')) {
      analysis.infrastructure.storage.push({ type: 's3', driver: 'aws-sdk-go' });
      depCount++;
    }
    
    analysis.dependencies.count = depCount;
  }

  /**
   * Analyze Java dependencies
   */
  analyzeJavaDependencies(content, analysis) {
    analysis.runtime.language = 'java';
    
    // Extract Java version
    const javaVersionMatch = content.match(/<java\.version>(\d+\.\d+)<\/java\.version>/i);
    if (javaVersionMatch) {
      analysis.runtime.versions.push(`java: ${javaVersionMatch[1]}`);
    }
    
    // Check for Spring Boot (common framework)
    if (content.includes('spring-boot')) {
      analysis.infrastructure.compute = 'container-ecs';
    }
    
    // Database drivers
    if (content.includes('postgresql') || content.includes('postgres')) {
      analysis.infrastructure.databases.push({ type: 'postgresql', driver: 'postgresql' });
    }
    if (content.includes('mysql')) {
      analysis.infrastructure.databases.push({ type: 'mysql', driver: 'mysql' });
    }
    if (content.includes('mongodb')) {
      analysis.infrastructure.databases.push({ type: 'mongodb', driver: 'mongodb' });
    }
  }

  /**
   * Analyze Rust dependencies
   */
  analyzeRustDependencies(content, analysis) {
    analysis.runtime.language = 'rust';
    
    // Extract Rust version
    const rustVersionMatch = content.match(/edition\s*=\s*"(\d+)"/i);
    if (rustVersionMatch) {
      analysis.runtime.versions.push(`rust: edition ${rustVersionMatch[1]}`);
    }
    
    // Database drivers
    if (content.includes('postgres') || content.includes('tokio-postgres')) {
      analysis.infrastructure.databases.push({ type: 'postgresql', driver: 'tokio-postgres' });
    }
    if (content.includes('mysql')) {
      analysis.infrastructure.databases.push({ type: 'mysql', driver: 'mysql' });
    }
    if (content.includes('mongodb')) {
      analysis.infrastructure.databases.push({ type: 'mongodb', driver: 'mongodb' });
    }
  }

  /**
   * Analyze Dockerfile for dependencies
   */
  analyzeDockerfileDependencies(content, analysis) {
    // Extract base image to determine runtime
    const baseImageMatch = content.match(/FROM\s+(\S+)/i);
    if (baseImageMatch) {
      const baseImage = baseImageMatch[1].toLowerCase();
      
      if (baseImage.includes('node')) {
        analysis.runtime.language = 'nodejs';
        const versionMatch = baseImage.match(/node:?(\d+\.?\d*)/i);
        if (versionMatch) {
          analysis.runtime.versions.push(`node: ${versionMatch[1]}`);
        }
      } else if (baseImage.includes('python')) {
        analysis.runtime.language = 'python';
        const versionMatch = baseImage.match(/python:?(\d+\.?\d*)/i);
        if (versionMatch) {
          analysis.runtime.versions.push(`python: ${versionMatch[1]}`);
        }
      } else if (baseImage.includes('golang') || baseImage.includes('go')) {
        analysis.runtime.language = 'go';
      } else if (baseImage.includes('openjdk') || baseImage.includes('java')) {
        analysis.runtime.language = 'java';
      } else if (baseImage.includes('rust')) {
        analysis.runtime.language = 'rust';
      }
    }
  }

  /**
   * Generate infrastructure recommendations based on dependencies
   */
  generateRecommendations(analysis) {
    // Compute recommendations
    if (!analysis.infrastructure.compute) {
      // Default based on language
      switch (analysis.runtime.language) {
        case 'nodejs':
          analysis.infrastructure.compute = 'serverless-lambda';
          break;
        case 'python':
          analysis.infrastructure.compute = 'container-ecs';
          break;
        case 'go':
          analysis.infrastructure.compute = 'container-ecs';
          break;
        case 'java':
          analysis.infrastructure.compute = 'container-ecs';
          break;
        default:
          analysis.infrastructure.compute = 'container-ecs';
      }
    }
    
    // Resource sizing recommendations
    const depCount = analysis.dependencies.count;
    if (depCount < 10) {
      analysis.recommendations.sizing = 'small';
      analysis.recommendations.resources.push('t3.small');
    } else if (depCount < 50) {
      analysis.recommendations.sizing = 'medium';
      analysis.recommendations.resources.push('t3.medium');
    } else {
      analysis.recommendations.sizing = 'large';
      analysis.recommendations.resources.push('t3.large');
    }
    
    // Add database recommendations
    if (analysis.infrastructure.databases.length > 0) {
      analysis.recommendations.resources.push('rds-instance');
    }
    
    // Add cache recommendations
    if (analysis.infrastructure.caching.length > 0) {
      analysis.recommendations.resources.push('elasticache-redis');
    }
    
    // Add storage recommendations
    if (analysis.infrastructure.storage.length > 0) {
      analysis.recommendations.resources.push('s3-bucket');
    }
  }
}

module.exports = new DependencyAnalysisService();

