const cursorIntegration = require('./cursorIntegration');
const logger = require('../utils/logger');

/**
 * Architecture Analyzer Service
 * Systematically analyzes project architecture to understand deployment requirements
 */
class ArchitectureAnalyzer {
  /**
   * Full project analysis
   */
  async analyzeProject(deploymentId) {
    try {
      logger.info(`Starting full architecture analysis for deployment ${deploymentId}`);
      
      // Step 1: Analyze project structure
      const structure = await this.analyzeProjectStructure(deploymentId);
      
      // Step 2: Discover config files
      const configFiles = await this.discoverConfigFiles(deploymentId);
      
      // Step 3: Detect project type and framework
      const projectType = await cursorIntegration.detectProjectType(deploymentId);
      
      // Step 4: Analyze dependencies and scripts
      const dependencies = await this.analyzeDependencies(deploymentId, configFiles);
      
      // Step 5: Detect entry points
      const entryPoints = await this.detectEntryPoints(deploymentId, configFiles, projectType);
      
      // Step 6: Identify architecture pattern
      const architecturePattern = this.identifyArchitecturePattern(structure, configFiles);
      
      // Step 7: Determine deployment requirements
      const deploymentRequirements = this.determineDeploymentRequirements(
        projectType,
        configFiles,
        dependencies,
        architecturePattern
      );
      
      return {
        deploymentId,
        structure,
        configFiles,
        projectType,
        dependencies,
        entryPoints,
        architecturePattern,
        deploymentRequirements,
        analyzedAt: new Date().toISOString()
      };
    } catch (error) {
      logger.error(`Architecture analysis failed for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Step 1: Analyze project structure
   */
  async analyzeProjectStructure(deploymentId) {
    try {
      const structure = await cursorIntegration.getStructure(deploymentId, '.', 5);
      
      // Identify key directories
      const keyDirectories = this.identifyKeyDirectories(structure);
      
      // Detect patterns
      const patterns = this.detectStructurePatterns(structure);
      
      return {
        tree: structure,
        keyDirectories,
        patterns,
        isMonorepo: this.isMonorepo(structure),
        hasDocker: this.hasDockerFiles(structure),
        hasCICD: this.hasCICDFiles(structure),
        hasTests: this.hasTestDirectory(structure)
      };
    } catch (error) {
      logger.error(`Failed to analyze project structure:`, error);
      return {
        tree: [],
        keyDirectories: [],
        patterns: [],
        isMonorepo: false,
        hasDocker: false,
        hasCICD: false,
        hasTests: false
      };
    }
  }

  /**
   * Step 2: Discover all config files
   */
  async discoverConfigFiles(deploymentId) {
    try {
      // Get standard config files
      const standardConfigs = await cursorIntegration.readConfigFiles(deploymentId);
      
      // Search for additional config files
      const additionalConfigs = await this.findAdditionalConfigs(deploymentId);
      
      // Parse and enhance config data
      const enhanced = {
        ...standardConfigs,
        ...additionalConfigs
      };
      
      // Parse each config file
      if (enhanced.packageJson?.content) {
        try {
          enhanced.packageJson.parsed = JSON.parse(enhanced.packageJson.content);
        } catch (e) {
          logger.warn('Failed to parse package.json');
        }
      }
      
      if (enhanced.dockerCompose?.content) {
        enhanced.dockerCompose.parsed = this.parseYaml(enhanced.dockerCompose.content);
      }
      
      return enhanced;
    } catch (error) {
      logger.error(`Failed to discover config files:`, error);
      return {};
    }
  }

  /**
   * Find additional config files beyond standard ones
   */
  async findAdditionalConfigs(deploymentId) {
    const additionalFiles = [
      'tsconfig.json',
      'webpack.config.js',
      'vite.config.js',
      'next.config.js',
      'nuxt.config.js',
      'angular.json',
      '.dockerignore',
      '.gitignore',
      'Makefile',
      'Procfile',
      'app.yaml',
      'serverless.yml',
      'netlify.toml',
      'vercel.json',
      'fly.toml',
      'render.yaml'
    ];
    
    const found = {};
    
    for (const file of additionalFiles) {
      try {
        const content = await cursorIntegration.readFile(deploymentId, file);
        if (content && content.exists) {
          const key = file.replace(/[.\-]/g, '_');
          found[key] = content;
        }
      } catch (e) {
        // File doesn't exist, continue
      }
    }
    
    return found;
  }

  /**
   * Step 4: Analyze dependencies and npm scripts
   */
  async analyzeDependencies(deploymentId, configFiles) {
    const result = {
      packageManager: 'npm',
      dependencies: [],
      devDependencies: [],
      scripts: {},
      hasLockFile: false,
      hasBuildScript: false,
      hasStartScript: false,
      hasTestScript: false,
      hasDevScript: false,
      detectedFrameworks: [],
      detectedDatabases: [],
      detectedServices: []
    };
    
    // Check for lock files to determine package manager
    const lockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
    for (const lockFile of lockFiles) {
      const exists = await cursorIntegration.fileExists(deploymentId, lockFile);
      if (exists) {
        result.hasLockFile = true;
        if (lockFile === 'yarn.lock') result.packageManager = 'yarn';
        if (lockFile === 'pnpm-lock.yaml') result.packageManager = 'pnpm';
        break;
      }
    }
    
    // Parse package.json
    if (configFiles.packageJson?.parsed) {
      const pkg = configFiles.packageJson.parsed;
      
      result.dependencies = Object.keys(pkg.dependencies || {});
      result.devDependencies = Object.keys(pkg.devDependencies || {});
      result.scripts = pkg.scripts || {};
      
      // Check for specific scripts
      result.hasBuildScript = !!result.scripts.build;
      result.hasStartScript = !!result.scripts.start;
      result.hasTestScript = !!result.scripts.test;
      result.hasDevScript = !!result.scripts.dev;
      
      // Detect frameworks
      const allDeps = [...result.dependencies, ...result.devDependencies];
      result.detectedFrameworks = this.detectFrameworks(allDeps);
      result.detectedDatabases = this.detectDatabases(allDeps);
      result.detectedServices = this.detectServices(allDeps);
    }
    
    return result;
  }

  /**
   * Step 5: Detect application entry points
   */
  async detectEntryPoints(deploymentId, configFiles, projectType) {
    const entryPoints = [];
    
    // Check package.json main field
    if (configFiles.packageJson?.parsed?.main) {
      entryPoints.push({
        type: 'main',
        file: configFiles.packageJson.parsed.main,
        source: 'package.json'
      });
    }
    
    // Check for common entry point files
    const commonEntryPoints = [
      'index.js', 'index.ts', 'main.js', 'main.ts',
      'app.js', 'app.ts', 'server.js', 'server.ts',
      'src/index.js', 'src/index.ts', 'src/main.js', 'src/main.ts',
      'src/app.js', 'src/app.ts', 'src/server.js', 'src/server.ts'
    ];
    
    for (const file of commonEntryPoints) {
      const exists = await cursorIntegration.fileExists(deploymentId, file);
      if (exists) {
        entryPoints.push({
          type: 'detected',
          file,
          source: 'file-scan'
        });
      }
    }
    
    // Check scripts for entry points
    if (configFiles.packageJson?.parsed?.scripts) {
      const scripts = configFiles.packageJson.parsed.scripts;
      
      // Parse start script for entry point
      if (scripts.start) {
        const match = scripts.start.match(/node\s+(\S+\.js)/);
        if (match) {
          entryPoints.push({
            type: 'start-script',
            file: match[1],
            source: 'package.json scripts.start'
          });
        }
      }
    }
    
    return entryPoints;
  }

  /**
   * Step 6: Identify architecture pattern
   */
  identifyArchitecturePattern(structure, configFiles) {
    const patterns = [];
    
    // Check for monorepo
    if (structure.isMonorepo) {
      patterns.push('monorepo');
    }
    
    // Check for microservices
    if (this.hasMicroservicesPattern(structure)) {
      patterns.push('microservices');
    }
    
    // Check for serverless
    if (configFiles.serverless_yml || configFiles.app_yaml) {
      patterns.push('serverless');
    }
    
    // Check for containerized
    if (structure.hasDocker) {
      patterns.push('containerized');
    }
    
    // Check for static site
    if (this.isStaticSite(configFiles)) {
      patterns.push('static-site');
    }
    
    // Default to standard if no pattern detected
    if (patterns.length === 0) {
      patterns.push('standard');
    }
    
    return {
      primary: patterns[0],
      all: patterns
    };
  }

  /**
   * Step 7: Determine deployment requirements
   */
  determineDeploymentRequirements(projectType, configFiles, dependencies, architecturePattern) {
    const requirements = {
      runtime: this.determineRuntime(projectType),
      buildRequired: dependencies.hasBuildScript,
      buildCommand: dependencies.hasBuildScript ? this.getBuildCommand(dependencies) : null,
      startCommand: dependencies.hasStartScript ? this.getStartCommand(dependencies) : null,
      installCommand: this.getInstallCommand(dependencies.packageManager),
      environmentVariables: [],
      ports: this.detectPorts(configFiles),
      volumes: [],
      services: dependencies.detectedServices,
      databases: dependencies.detectedDatabases,
      dockerRequired: architecturePattern.all.includes('containerized'),
      kubernetesSupport: this.hasKubernetesSupport(configFiles),
      cicdIntegration: this.detectCICDIntegration(configFiles),
      healthCheck: this.detectHealthCheck(configFiles)
    };
    
    // Detect environment variables from config
    if (configFiles.envExample?.content || configFiles.env?.content) {
      requirements.environmentVariables = this.parseEnvVars(
        configFiles.envExample?.content || configFiles.env?.content
      );
    }
    
    return requirements;
  }

  // Helper methods
  
  identifyKeyDirectories(structure) {
    const keyDirs = [];
    const importantDirs = ['src', 'lib', 'app', 'pages', 'components', 'services', 'api', 'public', 'static', 'assets'];
    
    const findDirs = (items, path = '') => {
      for (const item of items) {
        if (item.type === 'directory') {
          if (importantDirs.includes(item.name)) {
            keyDirs.push({ name: item.name, path: item.path });
          }
          if (item.children) {
            findDirs(item.children, item.path);
          }
        }
      }
    };
    
    findDirs(structure);
    return keyDirs;
  }

  detectStructurePatterns(structure) {
    const patterns = [];
    
    const hasDir = (name) => structure.some(item => item.type === 'directory' && item.name === name);
    
    if (hasDir('src')) patterns.push('src-layout');
    if (hasDir('packages')) patterns.push('monorepo');
    if (hasDir('apps')) patterns.push('monorepo');
    if (hasDir('services')) patterns.push('microservices');
    if (hasDir('functions')) patterns.push('serverless');
    if (hasDir('pages')) patterns.push('nextjs-or-nuxt');
    if (hasDir('components')) patterns.push('component-based');
    
    return patterns;
  }

  isMonorepo(structure) {
    return structure.tree?.some(item => 
      item.type === 'directory' && 
      (item.name === 'packages' || item.name === 'apps' || item.name === 'libs')
    ) || false;
  }

  hasDockerFiles(structure) {
    const hasDockerfile = (items) => {
      for (const item of items) {
        if (item.type === 'file' && (item.name === 'Dockerfile' || item.name === 'docker-compose.yml')) {
          return true;
        }
        if (item.type === 'directory' && item.children) {
          if (hasDockerfile(item.children)) return true;
        }
      }
      return false;
    };
    
    return hasDockerfile(structure.tree || structure);
  }

  hasCICDFiles(structure) {
    const cicdDirs = ['.github', '.gitlab-ci.yml', '.circleci', 'Jenkinsfile'];
    return structure.tree?.some(item => cicdDirs.includes(item.name)) || false;
  }

  hasTestDirectory(structure) {
    const testDirs = ['test', 'tests', '__tests__', 'spec', 'specs'];
    return structure.tree?.some(item => 
      item.type === 'directory' && testDirs.includes(item.name)
    ) || false;
  }

  hasMicroservicesPattern(structure) {
    return structure.tree?.some(item => 
      item.type === 'directory' && item.name === 'services' && 
      item.children && item.children.length > 1
    ) || false;
  }

  isStaticSite(configFiles) {
    return !!(configFiles.netlify_toml || configFiles.vercel_json || 
              configFiles.packageJson?.parsed?.dependencies?.['gatsby'] ||
              configFiles.packageJson?.parsed?.dependencies?.['@11ty/eleventy']);
  }

  detectFrameworks(deps) {
    const frameworks = [];
    const frameworkMap = {
      'react': 'React',
      'vue': 'Vue',
      'angular': 'Angular',
      '@angular/core': 'Angular',
      'next': 'Next.js',
      'nuxt': 'Nuxt',
      'express': 'Express',
      'fastify': 'Fastify',
      'koa': 'Koa',
      'nestjs': 'NestJS',
      '@nestjs/core': 'NestJS',
      'hono': 'Hono',
      'svelte': 'Svelte',
      '@sveltejs/kit': 'SvelteKit'
    };
    
    for (const dep of deps) {
      if (frameworkMap[dep]) {
        frameworks.push(frameworkMap[dep]);
      }
    }
    
    return frameworks;
  }

  detectDatabases(deps) {
    const databases = [];
    const dbMap = {
      'pg': 'PostgreSQL',
      'mysql': 'MySQL',
      'mysql2': 'MySQL',
      'mongodb': 'MongoDB',
      'mongoose': 'MongoDB',
      'redis': 'Redis',
      'ioredis': 'Redis',
      'sqlite3': 'SQLite',
      'better-sqlite3': 'SQLite',
      'prisma': 'Prisma ORM',
      '@prisma/client': 'Prisma ORM',
      'typeorm': 'TypeORM',
      'sequelize': 'Sequelize',
      'drizzle-orm': 'Drizzle ORM'
    };
    
    for (const dep of deps) {
      if (dbMap[dep]) {
        databases.push(dbMap[dep]);
      }
    }
    
    return databases;
  }

  detectServices(deps) {
    const services = [];
    const serviceMap = {
      'aws-sdk': 'AWS',
      '@aws-sdk/client-s3': 'AWS S3',
      '@aws-sdk/client-dynamodb': 'AWS DynamoDB',
      'firebase': 'Firebase',
      'firebase-admin': 'Firebase',
      'stripe': 'Stripe',
      'twilio': 'Twilio',
      'sendgrid': 'SendGrid',
      '@sendgrid/mail': 'SendGrid',
      'nodemailer': 'SMTP Email',
      'inngest': 'Inngest'
    };
    
    for (const dep of deps) {
      if (serviceMap[dep]) {
        services.push(serviceMap[dep]);
      }
    }
    
    return services;
  }

  determineRuntime(projectType) {
    const type = projectType.type || 'nodejs';
    
    switch (type) {
      case 'nodejs':
        return { name: 'Node.js', version: '18' };
      case 'python':
        return { name: 'Python', version: '3.11' };
      case 'go':
        return { name: 'Go', version: '1.21' };
      default:
        return { name: type, version: 'latest' };
    }
  }

  getBuildCommand(dependencies) {
    if (dependencies.scripts.build) {
      const pm = dependencies.packageManager;
      return pm === 'npm' ? 'npm run build' : `${pm} build`;
    }
    return null;
  }

  getStartCommand(dependencies) {
    if (dependencies.scripts.start) {
      const pm = dependencies.packageManager;
      return pm === 'npm' ? 'npm start' : `${pm} start`;
    }
    return null;
  }

  getInstallCommand(packageManager) {
    switch (packageManager) {
      case 'yarn':
        return 'yarn install';
      case 'pnpm':
        return 'pnpm install';
      default:
        return 'npm install';
    }
  }

  detectPorts(configFiles) {
    const ports = [];
    
    // Check docker-compose
    if (configFiles.dockerCompose?.parsed?.services) {
      for (const service of Object.values(configFiles.dockerCompose.parsed.services)) {
        if (service.ports) {
          for (const port of service.ports) {
            const match = port.toString().match(/(\d+):/);
            if (match) ports.push(parseInt(match[1]));
          }
        }
      }
    }
    
    // Default ports based on frameworks
    if (ports.length === 0) {
      ports.push(3000); // Default Node.js port
    }
    
    return [...new Set(ports)];
  }

  hasKubernetesSupport(configFiles) {
    return !!(configFiles.kubernetes_yml || configFiles.k8s_yml || 
              configFiles.helm_yaml || configFiles.chart_yaml);
  }

  detectCICDIntegration(configFiles) {
    const integrations = [];
    
    if (configFiles['.github']) integrations.push('GitHub Actions');
    if (configFiles['.gitlab-ci_yml']) integrations.push('GitLab CI');
    if (configFiles['.circleci']) integrations.push('CircleCI');
    if (configFiles['Jenkinsfile']) integrations.push('Jenkins');
    
    return integrations;
  }

  detectHealthCheck(configFiles) {
    // Check if Dockerfile has HEALTHCHECK
    if (configFiles.dockerfile?.content) {
      return configFiles.dockerfile.content.includes('HEALTHCHECK');
    }
    return false;
  }

  parseEnvVars(envContent) {
    if (!envContent) return [];
    
    const vars = [];
    const lines = envContent.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
        if (match) {
          vars.push({
            name: match[1],
            required: !trimmed.includes('=') || trimmed.split('=')[1].trim() === ''
          });
        }
      }
    }
    
    return vars;
  }

  parseYaml(content) {
    try {
      // Simple YAML parser for docker-compose
      // For production, use a proper YAML parser
      return { raw: content };
    } catch (e) {
      return null;
    }
  }
}

module.exports = new ArchitectureAnalyzer();




