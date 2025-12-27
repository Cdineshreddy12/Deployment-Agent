const logger = require('../utils/logger');
const cursorIntegration = require('./cursorIntegration');

/**
 * Requirement Parser Service
 * Analyzes README and config files to understand deployment requirements
 */
class RequirementParser {
  /**
   * Parse README for deployment instructions
   */
  parseREADME(readmeContent) {
    if (!readmeContent) {
      return {
        deploymentInstructions: [],
        environmentVariables: [],
        dependencies: [],
        buildCommands: [],
        runCommands: []
      };
    }

    const requirements = {
      deploymentInstructions: [],
      environmentVariables: [],
      dependencies: [],
      buildCommands: [],
      runCommands: [],
      databaseRequirements: [],
      infrastructureNeeds: []
    };

    const lowerContent = readmeContent.toLowerCase();

    // Extract environment variables mentioned in README
    const envVarPatterns = [
      /env\s*[=:]\s*([a-z_][a-z0-9_]*)/gi,
      /process\.env\.([a-z_][a-z0-9_]*)/gi,
      /\.env\s+([a-z_][a-z0-9_]*)/gi,
      /environment\s+variable[s]?\s*:?\s*([a-z_][a-z0-9_]*)/gi
    ];

    for (const pattern of envVarPatterns) {
      let match;
      while ((match = pattern.exec(readmeContent)) !== null) {
        const varName = match[1].toUpperCase();
        if (!requirements.environmentVariables.includes(varName)) {
          requirements.environmentVariables.push(varName);
        }
      }
    }

    // Extract build commands
    const buildPatterns = [
      /npm\s+run\s+build/gi,
      /yarn\s+build/gi,
      /pnpm\s+build/gi,
      /docker\s+build/gi,
      /make\s+build/gi
    ];

    for (const pattern of buildPatterns) {
      if (pattern.test(readmeContent)) {
        const match = readmeContent.match(pattern);
        if (match) {
          requirements.buildCommands.push(match[0]);
        }
      }
    }

    // Extract run commands
    const runPatterns = [
      /npm\s+start/gi,
      /npm\s+run\s+dev/gi,
      /yarn\s+start/gi,
      /docker\s+run/gi,
      /node\s+.*\.js/gi
    ];

    for (const pattern of runPatterns) {
      if (pattern.test(readmeContent)) {
        const match = readmeContent.match(pattern);
        if (match) {
          requirements.runCommands.push(match[0]);
        }
      }
    }

    // Detect database requirements
    const dbKeywords = ['postgresql', 'postgres', 'mysql', 'mongodb', 'redis', 'database', 'db'];
    for (const keyword of dbKeywords) {
      if (lowerContent.includes(keyword)) {
        requirements.databaseRequirements.push(keyword);
      }
    }

    // Detect infrastructure needs
    if (lowerContent.includes('aws') || lowerContent.includes('ec2') || lowerContent.includes('lambda')) {
      requirements.infrastructureNeeds.push('aws');
    }
    if (lowerContent.includes('docker') || lowerContent.includes('container')) {
      requirements.infrastructureNeeds.push('docker');
    }
    if (lowerContent.includes('kubernetes') || lowerContent.includes('k8s')) {
      requirements.infrastructureNeeds.push('kubernetes');
    }

    return requirements;
  }

  /**
   * Parse package.json with enhanced script detection
   */
  parsePackageJson(packageJsonContent) {
    if (!packageJsonContent) {
      return null;
    }

    try {
      const pkg = typeof packageJsonContent === 'string' 
        ? JSON.parse(packageJsonContent) 
        : packageJsonContent;

      const scripts = pkg.scripts || {};
      
      const requirements = {
        name: pkg.name,
        version: pkg.version,
        dependencies: Object.keys(pkg.dependencies || {}),
        devDependencies: Object.keys(pkg.devDependencies || {}),
        scripts: scripts,
        engines: pkg.engines || {},
        main: pkg.main || null,
        // Enhanced script detection
        availableScripts: {
          build: !!scripts.build,
          start: !!scripts.start,
          dev: !!scripts.dev,
          test: !!scripts.test,
          lint: !!scripts.lint,
          typecheck: !!scripts.typecheck || !!scripts['type-check'],
          serve: !!scripts.serve,
          preview: !!scripts.preview
        },
        // Actual script contents for inspection
        scriptContents: {
          build: scripts.build || null,
          start: scripts.start || null,
          dev: scripts.dev || null,
          test: scripts.test || null
        },
        buildCommand: null,
        startCommand: null,
        devCommand: null,
        testCommand: null,
        // Script validation results
        scriptValidation: {
          hasBuildScript: !!scripts.build,
          hasStartScript: !!scripts.start,
          hasDevScript: !!scripts.dev,
          hasTestScript: !!scripts.test,
          buildScriptContent: scripts.build || 'NOT DEFINED',
          startScriptContent: scripts.start || 'NOT DEFINED',
          warnings: []
        }
      };

      // Detect package manager from lock files (will be enhanced by caller)
      requirements.packageManager = 'npm'; // Default, can be overridden

      // Only set commands if scripts actually exist
      if (scripts.build) {
        requirements.buildCommand = `npm run build`;
        requirements.scriptValidation.buildIsValid = true;
      } else {
        requirements.scriptValidation.warnings.push('No "build" script in package.json - build step will be skipped');
      }
      
      if (scripts.start) {
        requirements.startCommand = `npm start`;
        requirements.scriptValidation.startIsValid = true;
      } else {
        requirements.scriptValidation.warnings.push('No "start" script in package.json - application startup may fail');
      }
      
      if (scripts.dev) {
        requirements.devCommand = `npm run dev`;
      }

      if (scripts.test) {
        requirements.testCommand = `npm test`;
      }

      // Detect framework from dependencies
      const allDeps = [...requirements.dependencies, ...requirements.devDependencies];
      requirements.framework = this.detectFramework(allDeps);
      
      // Detect runtime requirements
      requirements.runtimeRequirements = this.detectRuntimeRequirements(pkg, allDeps);

      return requirements;
    } catch (error) {
      logger.error('Failed to parse package.json:', error);
      return null;
    }
  }

  /**
   * Detect framework from dependencies
   */
  detectFramework(allDeps) {
    const frameworkPriority = [
      { name: 'next', framework: 'next' },
      { name: 'nuxt', framework: 'nuxt' },
      { name: '@angular/core', framework: 'angular' },
      { name: 'vue', framework: 'vue' },
      { name: 'react', framework: 'react' },
      { name: '@sveltejs/kit', framework: 'sveltekit' },
      { name: 'svelte', framework: 'svelte' },
      { name: '@nestjs/core', framework: 'nestjs' },
      { name: 'fastify', framework: 'fastify' },
      { name: 'express', framework: 'express' },
      { name: 'koa', framework: 'koa' },
      { name: 'hono', framework: 'hono' }
    ];

    for (const { name, framework } of frameworkPriority) {
      if (allDeps.includes(name)) {
        return framework;
      }
    }

    return 'vanilla';
  }

  /**
   * Detect runtime requirements from package.json
   */
  detectRuntimeRequirements(pkg, allDeps) {
    const requirements = {
      nodeVersion: pkg.engines?.node || '18',
      needsTypeScript: allDeps.includes('typescript'),
      needsPrisma: allDeps.includes('prisma') || allDeps.includes('@prisma/client'),
      needsDocker: false,
      databases: [],
      services: []
    };

    // Detect database requirements
    const dbMap = {
      'pg': 'postgresql',
      'mysql': 'mysql',
      'mysql2': 'mysql',
      'mongodb': 'mongodb',
      'mongoose': 'mongodb',
      'redis': 'redis',
      'ioredis': 'redis',
      '@prisma/client': 'database'
    };

    for (const [dep, db] of Object.entries(dbMap)) {
      if (allDeps.includes(dep) && !requirements.databases.includes(db)) {
        requirements.databases.push(db);
      }
    }

    // Detect service requirements
    const serviceMap = {
      'aws-sdk': 'aws',
      '@aws-sdk/client-s3': 'aws-s3',
      'stripe': 'stripe',
      'inngest': 'inngest',
      'firebase': 'firebase',
      'firebase-admin': 'firebase'
    };

    for (const [dep, service] of Object.entries(serviceMap)) {
      if (allDeps.includes(dep) && !requirements.services.includes(service)) {
        requirements.services.push(service);
      }
    }

    return requirements;
  }

  /**
   * Parse requirements.txt (Python)
   */
  parseRequirementsTxt(requirementsContent) {
    if (!requirementsContent) {
      return [];
    }

    const dependencies = [];
    const lines = requirementsContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        // Extract package name (before == or >= or <=)
        const match = trimmed.match(/^([a-zA-Z0-9_-]+)/);
        if (match) {
          dependencies.push(match[1]);
        }
      }
    }

    return dependencies;
  }

  /**
   * Parse .env.example or .env file
   */
  parseEnvFile(envContent) {
    if (!envContent) {
      return [];
    }

    const variables = [];
    const lines = envContent.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
        if (match) {
          variables.push({
            name: match[1],
            required: !trimmed.includes('=') || trimmed.split('=')[1].trim() === '',
            defaultValue: trimmed.includes('=') ? trimmed.split('=')[1].trim() : null
          });
        }
      }
    }

    return variables;
  }

  /**
   * Analyze all config files for a deployment
   */
  async analyzeDeployment(deploymentId) {
    try {
      const configFiles = await cursorIntegration.readConfigFiles(deploymentId);
      
      const analysis = {
        projectType: null,
        requirements: {
          environmentVariables: [],
          dependencies: [],
          buildCommands: [],
          runCommands: [],
          databaseRequirements: [],
          infrastructureNeeds: []
        },
        configFiles: {}
      };

      // Detect project type
      const projectType = await cursorIntegration.detectProjectType(deploymentId);
      analysis.projectType = projectType;

      // Parse README
      if (configFiles.readme) {
        const readmeAnalysis = this.parseREADME(configFiles.readme.content);
        analysis.requirements = { ...analysis.requirements, ...readmeAnalysis };
        analysis.configFiles.readme = {
          exists: true,
          analysis: readmeAnalysis
        };
      }

      // Parse package.json
      if (configFiles.packageJson) {
        const pkgAnalysis = this.parsePackageJson(configFiles.packageJson.content);
        if (pkgAnalysis) {
          analysis.requirements.dependencies = [
            ...analysis.requirements.dependencies,
            ...pkgAnalysis.dependencies
          ];
          if (pkgAnalysis.buildCommand) {
            analysis.requirements.buildCommands.push(pkgAnalysis.buildCommand);
          }
          if (pkgAnalysis.startCommand) {
            analysis.requirements.runCommands.push(pkgAnalysis.startCommand);
          }
          analysis.configFiles.packageJson = {
            exists: true,
            analysis: pkgAnalysis
          };
        }
      }

      // Parse requirements.txt
      if (configFiles.requirements) {
        const reqs = this.parseRequirementsTxt(configFiles.requirements.content);
        analysis.requirements.dependencies = [
          ...analysis.requirements.dependencies,
          ...reqs
        ];
        analysis.configFiles.requirements = {
          exists: true,
          dependencies: reqs
        };
      }

      // Parse .env.example or .env
      if (configFiles.envExample) {
        const envVars = this.parseEnvFile(configFiles.envExample.content);
        analysis.requirements.environmentVariables = [
          ...analysis.requirements.environmentVariables,
          ...envVars.map(v => v.name)
        ];
        analysis.configFiles.envExample = {
          exists: true,
          variables: envVars
        };
      } else if (configFiles.env) {
        const envVars = this.parseEnvFile(configFiles.env.content);
        analysis.requirements.environmentVariables = [
          ...analysis.requirements.environmentVariables,
          ...envVars.map(v => v.name)
        ];
        analysis.configFiles.env = {
          exists: true,
          variables: envVars
        };
      }

      // Check for Dockerfile
      if (configFiles.dockerfile) {
        analysis.configFiles.dockerfile = { exists: true };
        analysis.requirements.infrastructureNeeds.push('docker');
      }

      // Check for docker-compose.yml
      if (configFiles.dockerCompose) {
        analysis.configFiles.dockerCompose = { exists: true };
        analysis.requirements.infrastructureNeeds.push('docker');
      }

      return analysis;
    } catch (error) {
      logger.error(`Failed to analyze deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Generate deployment questions based on analysis
   */
  generateQuestions(analysis) {
    const questions = [];

    // Cloud provider question
    if (!analysis.requirements.infrastructureNeeds.includes('aws') &&
        !analysis.requirements.infrastructureNeeds.includes('azure') &&
        !analysis.requirements.infrastructureNeeds.includes('gcp')) {
      questions.push({
        type: 'choice',
        question: 'Which cloud provider would you like to use?',
        options: ['AWS', 'Azure', 'GCP', 'Other'],
        key: 'cloudProvider'
      });
    }

    // Infrastructure type question
    if (analysis.projectType.type === 'nodejs' || analysis.projectType.type === 'python') {
      questions.push({
        type: 'choice',
        question: 'What infrastructure type do you prefer?',
        options: ['EC2/VM', 'ECS/Fargate (Container)', 'Lambda (Serverless)', 'Elastic Beanstalk'],
        key: 'infrastructureType'
      });
    }

    // Database question
    if (analysis.requirements.databaseRequirements.length > 0) {
      questions.push({
        type: 'choice',
        question: 'Which database do you need?',
        options: ['PostgreSQL (RDS)', 'MySQL (RDS)', 'MongoDB', 'Redis', 'None'],
        key: 'database'
      });
    }

    // Environment variables question
    if (analysis.requirements.environmentVariables.length > 0) {
      questions.push({
        type: 'info',
        question: `I found ${analysis.requirements.environmentVariables.length} environment variables. Please provide values for them.`,
        key: 'environmentVariables',
        variables: analysis.requirements.environmentVariables
      });
    }

    return questions;
  }
}

module.exports = new RequirementParser();


