const cursorIntegration = require('./cursorIntegration');
const claudeService = require('./claude');
const architectureAnalyzer = require('./architectureAnalyzer');
const logger = require('../utils/logger');

/**
 * MCP Architecture Analyzer Service
 * Uses Claude with MCP tools to understand codebase architecture
 */
class MCPArchitectureAnalyzer {
  /**
   * Analyze architecture using MCP and Claude
   */
  async analyzeWithMCP(deploymentId, options = {}) {
    try {
      logger.info(`Starting MCP-based architecture analysis for deployment ${deploymentId}`);
      
      // Get basic architecture analysis first
      const basicAnalysis = await architectureAnalyzer.analyzeProject(deploymentId);
      
      // Read key files for Claude analysis
      const keyFiles = await this.getKeyFilesContent(deploymentId, basicAnalysis);
      
      // Use Claude to understand architecture
      const claudeAnalysis = await this.analyzeWithClaude(deploymentId, keyFiles, basicAnalysis);
      
      return {
        ...basicAnalysis,
        mcpAnalysis: claudeAnalysis,
        enhancedRequirements: this.enhanceRequirements(basicAnalysis, claudeAnalysis)
      };
    } catch (error) {
      logger.error(`MCP architecture analysis failed for deployment ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Get content of key files for analysis
   */
  async getKeyFilesContent(deploymentId, analysis) {
    const keyFiles = {};
    
    // Always try to read these files
    const filesToRead = [
      'package.json',
      'README.md',
      'Dockerfile',
      'docker-compose.yml',
      '.env.example',
      'tsconfig.json'
    ];
    
    // Add detected entry points
    if (analysis.entryPoints) {
      for (const entry of analysis.entryPoints) {
        if (!filesToRead.includes(entry.file)) {
          filesToRead.push(entry.file);
        }
      }
    }
    
    for (const file of filesToRead) {
      try {
        const content = await cursorIntegration.readFile(deploymentId, file);
        if (content && content.exists) {
          keyFiles[file] = content.content;
        }
      } catch (e) {
        // File doesn't exist, continue
      }
    }
    
    return keyFiles;
  }

  /**
   * Use Claude to analyze architecture
   */
  async analyzeWithClaude(deploymentId, keyFiles, basicAnalysis) {
    try {
      const prompt = this.buildAnalysisPrompt(keyFiles, basicAnalysis);
      
      const response = await claudeService.chat(deploymentId, prompt, {
        systemPrompt: `You are an expert software architect analyzing a codebase. 
Analyze the provided files and return a JSON response with:
1. architectureType: The architecture pattern (monolith, microservices, serverless, etc.)
2. deploymentStrategy: Recommended deployment strategy
3. scalingRecommendations: How to scale this application
4. securityConsiderations: Security issues to address
5. optimizations: Performance optimizations
6. missingComponents: What's missing for production deployment
7. deploymentSteps: Ordered list of deployment steps

Respond ONLY with valid JSON, no markdown.`
      });
      
      // Parse Claude's response
      try {
        const jsonMatch = response.message.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        logger.warn('Failed to parse Claude architecture analysis response');
      }
      
      return {
        raw: response.message,
        parsed: false
      };
    } catch (error) {
      logger.error('Claude architecture analysis failed:', error);
      return null;
    }
  }

  /**
   * Build analysis prompt for Claude
   */
  buildAnalysisPrompt(keyFiles, basicAnalysis) {
    let prompt = `Analyze this project architecture for deployment:\n\n`;
    
    // Add basic analysis summary
    prompt += `## Project Overview\n`;
    prompt += `- Type: ${basicAnalysis.projectType?.type || 'unknown'}\n`;
    prompt += `- Framework: ${basicAnalysis.projectType?.framework || 'unknown'}\n`;
    prompt += `- Architecture Pattern: ${basicAnalysis.architecturePattern?.primary || 'unknown'}\n`;
    prompt += `- Has Docker: ${basicAnalysis.structure?.hasDocker || false}\n`;
    prompt += `- Has CI/CD: ${basicAnalysis.structure?.hasCICD || false}\n\n`;
    
    // Add dependencies
    if (basicAnalysis.dependencies) {
      prompt += `## Dependencies\n`;
      prompt += `- Package Manager: ${basicAnalysis.dependencies.packageManager}\n`;
      prompt += `- Build Script: ${basicAnalysis.dependencies.hasBuildScript ? 'Yes' : 'No'}\n`;
      prompt += `- Start Script: ${basicAnalysis.dependencies.hasStartScript ? 'Yes' : 'No'}\n`;
      prompt += `- Frameworks: ${basicAnalysis.dependencies.detectedFrameworks.join(', ') || 'None detected'}\n`;
      prompt += `- Databases: ${basicAnalysis.dependencies.detectedDatabases.join(', ') || 'None detected'}\n`;
      prompt += `- Services: ${basicAnalysis.dependencies.detectedServices.join(', ') || 'None detected'}\n\n`;
    }
    
    // Add key files content
    prompt += `## Key Files\n\n`;
    for (const [file, content] of Object.entries(keyFiles)) {
      prompt += `### ${file}\n\`\`\`\n${content.substring(0, 2000)}\n\`\`\`\n\n`;
    }
    
    prompt += `\nBased on this analysis, provide deployment recommendations as JSON.`;
    
    return prompt;
  }

  /**
   * Enhance requirements with Claude analysis
   */
  enhanceRequirements(basicAnalysis, claudeAnalysis) {
    if (!claudeAnalysis || !claudeAnalysis.parsed) {
      return basicAnalysis.deploymentRequirements;
    }
    
    return {
      ...basicAnalysis.deploymentRequirements,
      recommendedStrategy: claudeAnalysis.deploymentStrategy,
      scalingRecommendations: claudeAnalysis.scalingRecommendations,
      securityConsiderations: claudeAnalysis.securityConsiderations,
      optimizations: claudeAnalysis.optimizations,
      missingComponents: claudeAnalysis.missingComponents,
      suggestedSteps: claudeAnalysis.deploymentSteps
    };
  }

  /**
   * Detect architecture pattern using MCP
   */
  async detectArchitecturePattern(deploymentId) {
    const analysis = await architectureAnalyzer.analyzeProject(deploymentId);
    return analysis.architecturePattern;
  }

  /**
   * Identify deployment needs based on architecture
   */
  async identifyDeploymentNeeds(deploymentId) {
    const analysis = await this.analyzeWithMCP(deploymentId);
    
    return {
      infrastructure: this.determineInfrastructure(analysis),
      services: this.determineRequiredServices(analysis),
      configuration: this.determineConfiguration(analysis),
      steps: this.generateDeploymentSteps(analysis)
    };
  }

  /**
   * Determine required infrastructure
   */
  determineInfrastructure(analysis) {
    const infra = {
      compute: 'ec2', // Default
      containerization: null,
      database: null,
      cache: null,
      storage: null
    };
    
    // If containerized, recommend ECS or EKS
    if (analysis.architecturePattern?.all?.includes('containerized')) {
      infra.compute = 'ecs';
      infra.containerization = 'docker';
    }
    
    // If serverless pattern detected
    if (analysis.architecturePattern?.all?.includes('serverless')) {
      infra.compute = 'lambda';
    }
    
    // Database recommendations
    const dbs = analysis.dependencies?.detectedDatabases || [];
    if (dbs.includes('PostgreSQL')) {
      infra.database = 'rds-postgresql';
    } else if (dbs.includes('MongoDB')) {
      infra.database = 'documentdb';
    } else if (dbs.includes('MySQL')) {
      infra.database = 'rds-mysql';
    }
    
    // Cache recommendations
    if (dbs.includes('Redis')) {
      infra.cache = 'elasticache-redis';
    }
    
    return infra;
  }

  /**
   * Determine required AWS services
   */
  determineRequiredServices(analysis) {
    const services = ['vpc', 'security-groups'];
    
    const infra = this.determineInfrastructure(analysis);
    
    if (infra.compute === 'ec2') services.push('ec2', 'alb');
    if (infra.compute === 'ecs') services.push('ecs', 'ecr', 'alb');
    if (infra.compute === 'lambda') services.push('lambda', 'api-gateway');
    if (infra.database) services.push(infra.database);
    if (infra.cache) services.push(infra.cache);
    
    return services;
  }

  /**
   * Determine configuration requirements
   */
  determineConfiguration(analysis) {
    return {
      environmentVariables: analysis.deploymentRequirements?.environmentVariables || [],
      ports: analysis.deploymentRequirements?.ports || [3000],
      healthCheckPath: '/health',
      logRetention: 14,
      minInstances: 1,
      maxInstances: 4
    };
  }

  /**
   * Generate deployment steps based on analysis
   */
  generateDeploymentSteps(analysis) {
    const steps = [];
    
    // Step 1: Install dependencies
    if (analysis.dependencies?.packageManager) {
      steps.push({
        id: 1,
        name: 'Install Dependencies',
        command: analysis.deploymentRequirements?.installCommand || 'npm install',
        description: 'Install project dependencies',
        validation: 'Check node_modules directory exists'
      });
    }
    
    // Step 2: Build (if build script exists)
    if (analysis.dependencies?.hasBuildScript) {
      steps.push({
        id: 2,
        name: 'Build Application',
        command: analysis.deploymentRequirements?.buildCommand || 'npm run build',
        description: 'Build the application for production',
        validation: 'Check dist/ or build/ directory exists'
      });
    }
    
    // Step 3: Run tests (if test script exists)
    if (analysis.dependencies?.hasTestScript) {
      steps.push({
        id: 3,
        name: 'Run Tests',
        command: 'npm test',
        description: 'Run test suite',
        validation: 'Tests pass with exit code 0'
      });
    }
    
    // Step 4: Docker build (if Dockerfile exists)
    if (analysis.structure?.hasDocker) {
      steps.push({
        id: 4,
        name: 'Build Docker Image',
        command: 'docker build -t app .',
        description: 'Build Docker container image',
        validation: 'Docker image created successfully'
      });
    }
    
    // Step 5: Infrastructure provisioning
    steps.push({
      id: 5,
      name: 'Provision Infrastructure',
      command: 'terraform apply -auto-approve',
      description: 'Create AWS infrastructure with Terraform',
      validation: 'Terraform apply completes successfully'
    });
    
    // Step 6: Deploy application
    steps.push({
      id: 6,
      name: 'Deploy Application',
      command: 'Deploy to target environment',
      description: 'Deploy the application to the provisioned infrastructure',
      validation: 'Application is accessible at endpoint'
    });
    
    return steps;
  }
}

module.exports = new MCPArchitectureAnalyzer();




