const cursorIntegration = require('./cursorIntegration');
const architectureAnalyzer = require('./architectureAnalyzer');
const mcpArchitectureAnalyzer = require('./mcpArchitectureAnalyzer');
const logger = require('../utils/logger');

/**
 * Deployment Planner Service
 * Creates step-by-step deployment plans based on project analysis
 */
class DeploymentPlanner {
  /**
   * Generate a complete deployment plan
   */
  async generatePlan(deploymentId, options = {}) {
    try {
      logger.info(`Generating deployment plan for ${deploymentId}`);
      
      // Get architecture analysis
      const analysis = options.analysis || await architectureAnalyzer.analyzeProject(deploymentId);
      
      // Generate steps based on analysis
      const steps = await this.generateSteps(deploymentId, analysis);
      
      // Generate rollback plan
      const rollbackPlan = this.generateRollbackPlan(steps);
      
      // Estimate time
      const estimatedTime = this.estimateTotalTime(steps);
      
      // Identify potential issues
      const potentialIssues = this.identifyPotentialIssues(analysis);
      
      return {
        deploymentId,
        generatedAt: new Date().toISOString(),
        projectInfo: {
          type: analysis.projectType?.type,
          framework: analysis.projectType?.framework,
          architecture: analysis.architecturePattern?.primary
        },
        steps,
        rollbackPlan,
        estimatedTime,
        potentialIssues,
        validation: await this.validatePlan(deploymentId, steps, analysis)
      };
    } catch (error) {
      logger.error(`Failed to generate deployment plan for ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Generate deployment steps
   */
  async generateSteps(deploymentId, analysis) {
    const steps = [];
    let stepId = 1;
    
    // Step 1: Validate prerequisites
    steps.push({
      id: stepId++,
      name: 'Validate Prerequisites',
      type: 'validation',
      description: 'Check that all required files and configurations exist',
      command: null,
      prerequisites: [],
      validation: async () => {
        return await this.validatePrerequisites(deploymentId, analysis);
      },
      estimatedTime: '30 seconds',
      canSkip: false,
      rollbackCommand: null
    });
    
    // Step 2: Install dependencies (if package.json exists)
    if (analysis.configFiles?.packageJson) {
      const installCmd = this.getInstallCommand(analysis.dependencies?.packageManager || 'npm');
      steps.push({
        id: stepId++,
        name: 'Install Dependencies',
        type: 'command',
        description: 'Install project dependencies',
        command: installCmd,
        prerequisites: ['package.json exists'],
        validation: async () => {
          return await cursorIntegration.fileExists(deploymentId, 'node_modules');
        },
        estimatedTime: '2-5 minutes',
        canSkip: false,
        rollbackCommand: 'rm -rf node_modules'
      });
    }
    
    // Step 3: Build application (only if build script exists)
    if (analysis.dependencies?.hasBuildScript) {
      const buildCmd = this.getBuildCommand(analysis.dependencies?.packageManager || 'npm');
      steps.push({
        id: stepId++,
        name: 'Build Application',
        type: 'command',
        description: 'Build the application for production',
        command: buildCmd,
        prerequisites: ['dependencies installed', 'build script exists'],
        validation: async () => {
          return await this.checkBuildOutput(deploymentId);
        },
        estimatedTime: '1-3 minutes',
        canSkip: false,
        rollbackCommand: 'rm -rf dist build .next'
      });
    } else {
      // Add a note about missing build script
      steps.push({
        id: stepId++,
        name: 'Build Application (Skipped)',
        type: 'info',
        description: 'No build script detected in package.json. Skipping build step.',
        command: null,
        prerequisites: [],
        validation: null,
        estimatedTime: '0 seconds',
        canSkip: true,
        skipped: true,
        reason: 'No build script in package.json'
      });
    }
    
    // Step 4: Run tests (optional, if test script exists)
    if (analysis.dependencies?.hasTestScript) {
      steps.push({
        id: stepId++,
        name: 'Run Tests',
        type: 'command',
        description: 'Run the test suite',
        command: 'npm test',
        prerequisites: ['dependencies installed'],
        validation: async () => true, // Tests validate themselves
        estimatedTime: '1-5 minutes',
        canSkip: true,
        rollbackCommand: null
      });
    }
    
    // Step 5: Build Docker image (if Dockerfile exists)
    if (analysis.configFiles?.dockerfile) {
      const projectName = analysis.configFiles?.packageJson?.parsed?.name || 'app';
      steps.push({
        id: stepId++,
        name: 'Build Docker Image',
        type: 'command',
        description: 'Build Docker container image',
        command: `docker build -t ${projectName}:latest .`,
        prerequisites: ['Dockerfile exists', 'Docker installed'],
        validation: async () => {
          return await this.checkDockerImage(projectName);
        },
        estimatedTime: '2-10 minutes',
        canSkip: false,
        rollbackCommand: `docker rmi ${projectName}:latest`
      });
    }
    
    // Step 6: Docker Compose (if docker-compose.yml exists)
    if (analysis.configFiles?.dockerCompose) {
      steps.push({
        id: stepId++,
        name: 'Start Docker Compose',
        type: 'command',
        description: 'Start services with Docker Compose',
        command: 'docker-compose up -d',
        prerequisites: ['docker-compose.yml exists', 'Docker installed'],
        validation: async () => {
          return await this.checkDockerComposeRunning();
        },
        estimatedTime: '1-3 minutes',
        canSkip: false,
        rollbackCommand: 'docker-compose down'
      });
    }
    
    // Step 7: Generate Terraform code (if AWS deployment)
    steps.push({
      id: stepId++,
      name: 'Generate Terraform Configuration',
      type: 'terraform',
      description: 'Generate Terraform infrastructure code',
      command: 'Generate via AI',
      prerequisites: ['AWS credentials configured'],
      validation: async () => {
        const terraformDir = `terraform/${deploymentId}`;
        return await cursorIntegration.fileExists(deploymentId, `${terraformDir}/main.tf`);
      },
      estimatedTime: '30 seconds - 1 minute',
      canSkip: false,
      rollbackCommand: null
    });
    
    // Step 8: Terraform Init
    steps.push({
      id: stepId++,
      name: 'Terraform Init',
      type: 'terraform',
      description: 'Initialize Terraform working directory',
      command: 'terraform init',
      prerequisites: ['Terraform configuration generated'],
      validation: async () => true,
      estimatedTime: '30 seconds - 1 minute',
      canSkip: false,
      rollbackCommand: null
    });
    
    // Step 9: Terraform Plan
    steps.push({
      id: stepId++,
      name: 'Terraform Plan',
      type: 'terraform',
      description: 'Preview infrastructure changes',
      command: 'terraform plan',
      prerequisites: ['Terraform initialized'],
      validation: async () => true,
      estimatedTime: '30 seconds - 1 minute',
      canSkip: false,
      rollbackCommand: null
    });
    
    // Step 10: Terraform Apply (requires approval)
    steps.push({
      id: stepId++,
      name: 'Terraform Apply',
      type: 'terraform',
      description: 'Apply infrastructure changes',
      command: 'terraform apply -auto-approve',
      prerequisites: ['Terraform plan reviewed', 'Cost approved'],
      validation: async () => true,
      estimatedTime: '5-15 minutes',
      canSkip: false,
      requiresApproval: true,
      rollbackCommand: 'terraform destroy -auto-approve'
    });
    
    // Step 11: Verify Deployment
    steps.push({
      id: stepId++,
      name: 'Verify Deployment',
      type: 'validation',
      description: 'Verify the deployment is successful',
      command: null,
      prerequisites: ['Infrastructure deployed'],
      validation: async () => {
        return await this.verifyDeployment(deploymentId);
      },
      estimatedTime: '1-2 minutes',
      canSkip: false,
      rollbackCommand: null
    });
    
    return steps;
  }

  /**
   * Generate rollback plan
   */
  generateRollbackPlan(steps) {
    const rollbackSteps = [];
    
    // Reverse the steps and include only those with rollback commands
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i];
      if (step.rollbackCommand) {
        rollbackSteps.push({
          originalStepId: step.id,
          name: `Rollback: ${step.name}`,
          command: step.rollbackCommand,
          description: `Undo ${step.name}`
        });
      }
    }
    
    return rollbackSteps;
  }

  /**
   * Estimate total deployment time
   */
  estimateTotalTime(steps) {
    // Simple estimation based on step count
    const activeSteps = steps.filter(s => !s.skipped);
    const minMinutes = activeSteps.length * 1;
    const maxMinutes = activeSteps.length * 5;
    
    return `${minMinutes}-${maxMinutes} minutes`;
  }

  /**
   * Identify potential issues
   */
  identifyPotentialIssues(analysis) {
    const issues = [];
    
    // Check for missing build script
    if (!analysis.dependencies?.hasBuildScript) {
      issues.push({
        severity: 'warning',
        message: 'No build script detected. Generated scripts may assume npm run build exists.',
        recommendation: 'Add a build script to package.json or skip build step.'
      });
    }
    
    // Check for missing start script
    if (!analysis.dependencies?.hasStartScript) {
      issues.push({
        severity: 'warning',
        message: 'No start script detected. Deployment may fail to start the application.',
        recommendation: 'Add a start script to package.json.'
      });
    }
    
    // Check for environment variables
    if (analysis.deploymentRequirements?.environmentVariables?.length > 0) {
      const requiredVars = analysis.deploymentRequirements.environmentVariables.filter(v => v.required);
      if (requiredVars.length > 0) {
        issues.push({
          severity: 'info',
          message: `${requiredVars.length} environment variable(s) need to be configured.`,
          recommendation: 'Set environment variables before deployment.'
        });
      }
    }
    
    // Check for Dockerfile existence for containerized apps
    if (!analysis.configFiles?.dockerfile && analysis.architecturePattern?.all?.includes('containerized')) {
      issues.push({
        severity: 'warning',
        message: 'Containerized architecture detected but no Dockerfile found.',
        recommendation: 'A Dockerfile will be generated.'
      });
    }
    
    return issues;
  }

  /**
   * Validate the generated plan
   */
  async validatePlan(deploymentId, steps, analysis) {
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    // Check if package.json exists for Node.js projects
    if (analysis.projectType?.type === 'nodejs') {
      const hasPackageJson = await cursorIntegration.fileExists(deploymentId, 'package.json');
      if (!hasPackageJson) {
        validation.valid = false;
        validation.errors.push('package.json not found');
      }
    }
    
    // Check for duplicate step IDs
    const stepIds = steps.map(s => s.id);
    if (new Set(stepIds).size !== stepIds.length) {
      validation.valid = false;
      validation.errors.push('Duplicate step IDs found');
    }
    
    return validation;
  }

  /**
   * Validate prerequisites for a step
   */
  async validatePrerequisites(deploymentId, analysis) {
    const results = {
      valid: true,
      checks: []
    };
    
    // Check package.json
    const hasPackageJson = await cursorIntegration.fileExists(deploymentId, 'package.json');
    results.checks.push({
      name: 'package.json exists',
      passed: hasPackageJson
    });
    if (!hasPackageJson) results.valid = false;
    
    // Check Dockerfile if Docker deployment
    if (analysis.architecturePattern?.all?.includes('containerized')) {
      const hasDockerfile = await cursorIntegration.fileExists(deploymentId, 'Dockerfile');
      results.checks.push({
        name: 'Dockerfile exists',
        passed: hasDockerfile
      });
    }
    
    return results;
  }

  // Helper methods
  
  getInstallCommand(packageManager) {
    switch (packageManager) {
      case 'yarn': return 'yarn install';
      case 'pnpm': return 'pnpm install';
      default: return 'npm install';
    }
  }

  getBuildCommand(packageManager) {
    switch (packageManager) {
      case 'yarn': return 'yarn build';
      case 'pnpm': return 'pnpm build';
      default: return 'npm run build';
    }
  }

  async checkBuildOutput(deploymentId) {
    const buildDirs = ['dist', 'build', '.next', 'out'];
    for (const dir of buildDirs) {
      if (await cursorIntegration.fileExists(deploymentId, dir)) {
        return true;
      }
    }
    return false;
  }

  async checkDockerImage(imageName) {
    // This would need to execute docker images command
    // For now, return true as we can't directly check
    return true;
  }

  async checkDockerComposeRunning() {
    // This would need to execute docker-compose ps
    // For now, return true
    return true;
  }

  async verifyDeployment(deploymentId) {
    // This would check if the deployment is accessible
    // For now, return true
    return true;
  }
}

module.exports = new DeploymentPlanner();




