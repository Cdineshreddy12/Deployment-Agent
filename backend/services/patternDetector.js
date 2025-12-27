const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');

/**
 * Smart Deployment Pattern Detector
 * Analyzes codebases and previous deployments to suggest optimal configurations
 */
class PatternDetector {
  constructor() {
    this.patterns = new Map();
    this.learnedConfigs = [];
  }

  /**
   * Analyze a repository and detect deployment patterns
   * @param {Object} repoAnalysis - Repository analysis data
   * @returns {Promise<Object>} - Detected patterns and suggestions
   */
  async detectPatterns(repoAnalysis) {
    const patterns = {
      projectType: null,
      framework: null,
      deploymentType: null,
      infrastructure: [],
      services: [],
      scaling: null,
      networking: null,
      storage: null,
      monitoring: null,
      security: [],
      confidence: 0
    };

    try {
      // Detect project type and framework
      patterns.projectType = this.detectProjectType(repoAnalysis);
      patterns.framework = this.detectFramework(repoAnalysis);

      // Detect deployment type
      patterns.deploymentType = this.detectDeploymentType(repoAnalysis, patterns);

      // Suggest infrastructure components
      patterns.infrastructure = this.suggestInfrastructure(patterns);

      // Detect required services
      patterns.services = this.detectServices(repoAnalysis);

      // Suggest scaling strategy
      patterns.scaling = this.suggestScaling(patterns, repoAnalysis);

      // Suggest networking configuration
      patterns.networking = this.suggestNetworking(patterns);

      // Suggest storage requirements
      patterns.storage = this.suggestStorage(repoAnalysis, patterns);

      // Suggest monitoring setup
      patterns.monitoring = this.suggestMonitoring(patterns);

      // Suggest security configurations
      patterns.security = this.suggestSecurity(patterns, repoAnalysis);

      // Calculate confidence score
      patterns.confidence = this.calculateConfidence(patterns, repoAnalysis);

      // Learn from this analysis
      this.learn(patterns, repoAnalysis);

      return patterns;

    } catch (error) {
      logger.error('Pattern detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect project type from repository analysis
   */
  detectProjectType(analysis) {
    const indicators = {
      nodejs: ['package.json', 'node_modules', '.nvmrc', 'yarn.lock', 'pnpm-lock.yaml'],
      python: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile', 'poetry.lock'],
      golang: ['go.mod', 'go.sum', 'main.go'],
      java: ['pom.xml', 'build.gradle', 'build.gradle.kts', '.mvn'],
      ruby: ['Gemfile', 'Gemfile.lock', '.ruby-version'],
      rust: ['Cargo.toml', 'Cargo.lock'],
      php: ['composer.json', 'composer.lock'],
      dotnet: ['*.csproj', '*.sln', 'packages.config']
    };

    const files = analysis.files || [];
    const scores = {};

    for (const [type, typeIndicators] of Object.entries(indicators)) {
      scores[type] = 0;
      for (const indicator of typeIndicators) {
        if (files.some(f => f.includes(indicator.replace('*', '')))) {
          scores[type]++;
        }
      }
    }

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore === 0) return 'unknown';

    return Object.entries(scores).find(([_, score]) => score === maxScore)?.[0] || 'unknown';
  }

  /**
   * Detect framework from repository analysis
   */
  detectFramework(analysis) {
    const content = JSON.stringify(analysis).toLowerCase();

    const frameworks = {
      // JavaScript/Node.js
      'nextjs': ['next.config', '"next":', 'pages/', 'app/'],
      'react': ['"react":', 'react-dom', 'jsx', 'tsx'],
      'express': ['"express":', 'app.listen', 'router.'],
      'nestjs': ['@nestjs', 'nest-cli'],
      'vue': ['"vue":', '.vue', 'vue.config'],
      'angular': ['@angular', 'angular.json'],
      'nuxt': ['nuxt.config', '"nuxt"'],
      
      // Python
      'django': ['django', 'wsgi.py', 'manage.py', 'settings.py'],
      'flask': ['flask', 'app.py', '@app.route'],
      'fastapi': ['fastapi', 'uvicorn'],
      
      // Java
      'spring': ['spring-boot', '@SpringBootApplication', 'application.properties'],
      
      // Go
      'gin': ['gin-gonic', 'gin.'],
      'echo': ['labstack/echo'],
      
      // Ruby
      'rails': ['rails', 'config/routes.rb']
    };

    for (const [framework, indicators] of Object.entries(frameworks)) {
      if (indicators.some(i => content.includes(i.toLowerCase()))) {
        return framework;
      }
    }

    return null;
  }

  /**
   * Detect deployment type based on project and framework
   */
  detectDeploymentType(analysis, patterns) {
    const hasDocker = analysis.files?.some(f => 
      f.includes('Dockerfile') || f.includes('docker-compose')
    );
    const hasK8s = analysis.files?.some(f => 
      f.includes('kubernetes') || f.includes('k8s') || f.includes('.yaml')
    );
    const hasServerless = analysis.files?.some(f => 
      f.includes('serverless') || f.includes('lambda') || f.includes('functions')
    );

    if (hasK8s) return 'kubernetes';
    if (hasServerless) return 'serverless';
    if (hasDocker) return 'container';

    // Suggest based on framework
    const serverlessFrameworks = ['nextjs', 'nuxt'];
    if (serverlessFrameworks.includes(patterns.framework)) {
      return 'serverless';
    }

    return 'container';
  }

  /**
   * Suggest infrastructure components
   */
  suggestInfrastructure(patterns) {
    const infrastructure = [];

    switch (patterns.deploymentType) {
      case 'kubernetes':
        infrastructure.push(
          { type: 'eks', description: 'Amazon EKS for Kubernetes orchestration' },
          { type: 'ecr', description: 'ECR for container registry' },
          { type: 'alb', description: 'Application Load Balancer for ingress' }
        );
        break;

      case 'serverless':
        infrastructure.push(
          { type: 'lambda', description: 'AWS Lambda for serverless compute' },
          { type: 'api-gateway', description: 'API Gateway for HTTP endpoints' },
          { type: 'cloudfront', description: 'CloudFront for CDN' }
        );
        break;

      case 'container':
      default:
        infrastructure.push(
          { type: 'ecs', description: 'Amazon ECS for container orchestration' },
          { type: 'ecr', description: 'ECR for container registry' },
          { type: 'alb', description: 'Application Load Balancer' }
        );
    }

    // Add VPC for all types
    infrastructure.unshift({
      type: 'vpc',
      description: 'Virtual Private Cloud for network isolation'
    });

    return infrastructure;
  }

  /**
   * Detect required services from analysis
   */
  detectServices(analysis) {
    const services = [];
    const content = JSON.stringify(analysis).toLowerCase();

    // Database detection
    if (content.includes('postgres') || content.includes('pg')) {
      services.push({ type: 'rds-postgres', description: 'PostgreSQL database' });
    }
    if (content.includes('mysql') || content.includes('mariadb')) {
      services.push({ type: 'rds-mysql', description: 'MySQL database' });
    }
    if (content.includes('mongodb') || content.includes('mongoose')) {
      services.push({ type: 'documentdb', description: 'MongoDB-compatible database' });
    }
    if (content.includes('dynamodb')) {
      services.push({ type: 'dynamodb', description: 'DynamoDB NoSQL database' });
    }

    // Cache detection
    if (content.includes('redis') || content.includes('ioredis')) {
      services.push({ type: 'elasticache-redis', description: 'Redis cache' });
    }
    if (content.includes('memcached')) {
      services.push({ type: 'elasticache-memcached', description: 'Memcached cache' });
    }

    // Queue detection
    if (content.includes('sqs') || content.includes('queue')) {
      services.push({ type: 'sqs', description: 'SQS message queue' });
    }
    if (content.includes('rabbitmq') || content.includes('amqp')) {
      services.push({ type: 'mq', description: 'Amazon MQ for message broker' });
    }

    // Storage detection
    if (content.includes('s3') || content.includes('upload') || content.includes('storage')) {
      services.push({ type: 's3', description: 'S3 for object storage' });
    }

    // Search detection
    if (content.includes('elasticsearch') || content.includes('opensearch')) {
      services.push({ type: 'opensearch', description: 'OpenSearch for search' });
    }

    return services;
  }

  /**
   * Suggest scaling strategy
   */
  suggestScaling(patterns, analysis) {
    const scaling = {
      type: 'auto',
      minInstances: 1,
      maxInstances: 4,
      targetCPU: 70,
      targetMemory: 80,
      scaleDownCooldown: 300,
      scaleUpCooldown: 60
    };

    // Adjust based on deployment type
    if (patterns.deploymentType === 'serverless') {
      scaling.type = 'event-driven';
      scaling.minInstances = 0;
      scaling.maxInstances = 100;
    }

    // Adjust for stateful services
    if (patterns.services.some(s => s.type.includes('rds') || s.type.includes('redis'))) {
      scaling.statefulServices = true;
    }

    return scaling;
  }

  /**
   * Suggest networking configuration
   */
  suggestNetworking(patterns) {
    return {
      vpc: {
        cidr: '10.0.0.0/16',
        publicSubnets: 2,
        privateSubnets: 2,
        natGateways: patterns.deploymentType === 'kubernetes' ? 2 : 1
      },
      dns: {
        useRoute53: true,
        privateZone: true
      },
      loadBalancer: {
        type: 'application',
        internal: false,
        crossZone: true
      },
      security: {
        waf: true,
        shieldAdvanced: false
      }
    };
  }

  /**
   * Suggest storage requirements
   */
  suggestStorage(analysis, patterns) {
    const storage = {
      volumes: [],
      objectStorage: false,
      backup: true
    };

    // Check for file uploads or static content
    const content = JSON.stringify(analysis).toLowerCase();
    if (content.includes('upload') || content.includes('static') || content.includes('media')) {
      storage.objectStorage = true;
      storage.volumes.push({
        type: 's3',
        purpose: 'static-assets',
        versioning: true
      });
    }

    // Check for persistent data
    if (patterns.services.some(s => s.type.includes('rds'))) {
      storage.volumes.push({
        type: 'ebs',
        purpose: 'database',
        size: 100,
        iops: 3000
      });
    }

    return storage;
  }

  /**
   * Suggest monitoring setup
   */
  suggestMonitoring(patterns) {
    return {
      cloudwatch: {
        logs: true,
        metrics: true,
        dashboards: true,
        alarms: [
          { metric: 'CPUUtilization', threshold: 80, comparison: 'GreaterThan' },
          { metric: 'MemoryUtilization', threshold: 80, comparison: 'GreaterThan' },
          { metric: '5xxErrors', threshold: 5, comparison: 'GreaterThan' }
        ]
      },
      xray: patterns.deploymentType !== 'serverless',
      containerInsights: patterns.deploymentType === 'container' || patterns.deploymentType === 'kubernetes'
    };
  }

  /**
   * Suggest security configurations
   */
  suggestSecurity(patterns, analysis) {
    const security = [];

    // Always recommend these
    security.push({ type: 'secrets-manager', description: 'AWS Secrets Manager for credentials' });
    security.push({ type: 'iam-roles', description: 'IAM roles for service permissions' });
    security.push({ type: 'security-groups', description: 'Security groups for network access control' });

    // SSL/TLS
    security.push({ type: 'acm', description: 'ACM for SSL/TLS certificates' });

    // WAF for public-facing
    if (patterns.infrastructure.some(i => i.type === 'alb' || i.type === 'api-gateway')) {
      security.push({ type: 'waf', description: 'WAF for web application firewall' });
    }

    // Encryption at rest
    security.push({ type: 'kms', description: 'KMS for encryption keys' });

    return security;
  }

  /**
   * Calculate confidence score
   */
  calculateConfidence(patterns, analysis) {
    let score = 0;
    const maxScore = 100;

    // Project type detection
    if (patterns.projectType && patterns.projectType !== 'unknown') score += 20;

    // Framework detection
    if (patterns.framework) score += 15;

    // Has enough file analysis
    if (analysis.files && analysis.files.length > 5) score += 10;

    // Services detected
    if (patterns.services.length > 0) score += 15;

    // Infrastructure suggestions
    if (patterns.infrastructure.length > 0) score += 20;

    // Previous similar deployments
    const similar = this.findSimilarDeployments(patterns);
    if (similar.length > 0) score += 20;

    return Math.min(score, maxScore);
  }

  /**
   * Find similar past deployments
   */
  findSimilarDeployments(patterns) {
    return this.learnedConfigs.filter(config => 
      config.projectType === patterns.projectType ||
      config.framework === patterns.framework
    );
  }

  /**
   * Learn from this analysis
   */
  learn(patterns, analysis) {
    this.learnedConfigs.push({
      projectType: patterns.projectType,
      framework: patterns.framework,
      deploymentType: patterns.deploymentType,
      services: patterns.services.map(s => s.type),
      timestamp: new Date()
    });

    // Keep only last 100 configurations
    if (this.learnedConfigs.length > 100) {
      this.learnedConfigs = this.learnedConfigs.slice(-100);
    }
  }

  /**
   * Get optimization suggestions based on patterns
   */
  getOptimizations(patterns) {
    const optimizations = [];

    // Container optimization
    if (patterns.deploymentType === 'container') {
      optimizations.push({
        type: 'spot-instances',
        description: 'Use Spot Instances for non-critical workloads to save up to 90% on compute costs',
        potentialSavings: '60-90%'
      });
    }

    // Serverless optimization
    if (patterns.deploymentType === 'serverless') {
      optimizations.push({
        type: 'provisioned-concurrency',
        description: 'Use Provisioned Concurrency for consistent latency on critical paths',
        potentialSavings: 'Better latency'
      });
    }

    // Database optimization
    if (patterns.services.some(s => s.type.includes('rds'))) {
      optimizations.push({
        type: 'reserved-instances',
        description: 'Use Reserved Instances for RDS to save up to 72% on database costs',
        potentialSavings: '40-72%'
      });
    }

    // Cache optimization
    if (!patterns.services.some(s => s.type.includes('redis'))) {
      optimizations.push({
        type: 'add-caching',
        description: 'Add ElastiCache Redis for improved performance and reduced database load',
        potentialSavings: 'Better performance'
      });
    }

    return optimizations;
  }
}

// Singleton instance
const patternDetector = new PatternDetector();

module.exports = patternDetector;





