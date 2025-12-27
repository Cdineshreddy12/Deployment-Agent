const claudeService = require('./claude');
const logger = require('../utils/logger');
const githubService = require('./githubService');

/**
 * Infrastructure Generator Service
 * Generates missing infrastructure files (Dockerfile, CI/CD, Terraform, deployment scripts)
 */
class InfrastructureGenerator {
  /**
   * Generate Dockerfile based on application analysis
   */
  async generateDockerfile(deploymentId, analysis, dependencies) {
    try {
      const language = analysis.repository.language?.toLowerCase() || 
                      dependencies.runtime?.language || 
                      'nodejs';
      
      const prompt = `Generate a production-ready Dockerfile for a ${language} application.

Repository Analysis:
- Language: ${language}
- Runtime: ${JSON.stringify(dependencies.runtime || {})}
- Dependencies: ${dependencies.dependencies?.count || 0} packages
- Entry Point: ${this.detectEntryPoint(analysis)}

Requirements:
1. Use multi-stage build for smaller image size
2. Follow security best practices (non-root user, minimal base image)
3. Optimize layer caching
4. Set proper working directory
5. Expose appropriate ports
6. Include health check
7. Use .dockerignore appropriately

Generate ONLY the Dockerfile content, no explanations.`;

      const userId = analysis.userId || null;
      if (!userId) {
        logger.warn('No userId provided for Dockerfile generation', { deploymentId });
      }
      const response = await claudeService.chat(deploymentId, prompt, {
        userId: userId
      });

      return this.extractCode(response.message, 'dockerfile');
    } catch (error) {
      logger.error('Failed to generate Dockerfile:', error);
      throw error;
    }
  }

  /**
   * Generate docker-compose.yml for local development
   */
  async generateDockerCompose(deploymentId, analysis, codeAnalysis) {
    try {
      const prompt = `Generate a docker-compose.yml file for local development.

Application Requirements:
- Language: ${analysis.repository.language}
- Databases: ${codeAnalysis.databases?.join(', ') || 'None'}
- Caching: ${codeAnalysis.caching?.join(', ') || 'None'}
- Storage: ${codeAnalysis.storage?.join(', ') || 'None'}

Requirements:
1. Include application service
2. Include all required services (databases, cache, etc.)
3. Set up proper networking between services
4. Include volume mounts for development
5. Set environment variables
6. Include health checks

Generate ONLY the docker-compose.yml content, no explanations.`;

      const userId = analysis.userId || null;
      if (!userId) {
        logger.warn('No userId provided for Dockerfile generation', { deploymentId });
      }
      const response = await claudeService.chat(deploymentId, prompt, {
        userId: userId
      });

      return this.extractCode(response.message, 'yaml');
    } catch (error) {
      logger.error('Failed to generate docker-compose.yml:', error);
      throw error;
    }
  }

  /**
   * Generate CI/CD pipeline (GitHub Actions)
   */
  async generateCICDPipeline(deploymentId, analysis, missingInfra) {
    try {
      const cicdType = missingInfra.cicdType || 'github-actions';
      const language = analysis.repository.language?.toLowerCase() || 'nodejs';
      
      const prompt = `Generate a ${cicdType} CI/CD pipeline for automated deployments.

Repository: ${analysis.repository.url}
Language: ${language}
Branch: ${analysis.repository.defaultBranch || 'main'}

Pipeline Requirements:
1. Build and test on pull requests
2. Build Docker image on push to main branch
3. Run tests and linting
4. Deploy to staging environment
5. Include deployment to production with approval
6. Use secrets for sensitive data
7. Cache dependencies for faster builds
8. Include rollback capability

Generate ONLY the workflow YAML file content (e.g., .github/workflows/deploy.yml), no explanations.`;

      const userId = analysis.userId || null;
      if (!userId) {
        logger.warn('No userId provided for Dockerfile generation', { deploymentId });
      }
      const response = await claudeService.chat(deploymentId, prompt, {
        userId: userId
      });

      return this.extractCode(response.message, 'yaml');
    } catch (error) {
      logger.error('Failed to generate CI/CD pipeline:', error);
      throw error;
    }
  }

  /**
   * Generate deployment scripts
   */
  async generateDeploymentScripts(deploymentId, analysis) {
    try {
      const prompt = `Generate deployment and rollback scripts for the application.

Repository: ${analysis.repository.url}
Language: ${analysis.repository.language}

Generate the following scripts:
1. deploy.sh - Main deployment script
   - Build Docker image
   - Push to registry
   - Deploy to infrastructure
   - Run health checks
   - Update deployment status

2. rollback.sh - Rollback script
   - Revert to previous version
   - Update infrastructure
   - Verify rollback success

3. health-check.sh - Health check script
   - Check application health
   - Verify all services are running
   - Return exit code 0 if healthy, 1 if unhealthy

Requirements:
- Use bash scripting
- Include error handling
- Include logging
- Make scripts executable
- Use environment variables for configuration

Generate ONLY the script contents, one per code block, labeled clearly.`;

      const userId = analysis.userId || null;
      if (!userId) {
        logger.warn('No userId provided for Dockerfile generation', { deploymentId });
      }
      const response = await claudeService.chat(deploymentId, prompt, {
        userId: userId
      });

      return {
        deploy: this.extractCode(response.message, 'bash', 'deploy'),
        rollback: this.extractCode(response.message, 'bash', 'rollback'),
        healthCheck: this.extractCode(response.message, 'bash', 'health')
      };
    } catch (error) {
      logger.error('Failed to generate deployment scripts:', error);
      throw error;
    }
  }

  /**
   * Generate all missing infrastructure files
   */
  async generateMissingInfrastructure(deploymentId, analysis, missingInfra, userId = null) {
    const generated = {
      dockerfile: null,
      dockerCompose: null,
      cicdPipeline: null,
      deploymentScripts: null
    };

    try {
      // Ensure userId is available in analysis for all generation methods
      const analysisWithUserId = {
        ...analysis,
        userId: userId || analysis.userId || null
      };

      // Generate Dockerfile if missing
      if (missingInfra.dockerfile) {
        logger.info('Generating Dockerfile', { deploymentId });
        generated.dockerfile = await this.generateDockerfile(
          deploymentId,
          analysisWithUserId,
          analysis.dependencies || {}
        );
      }

      // Generate docker-compose.yml if missing
      if (missingInfra.dockerCompose) {
        logger.info('Generating docker-compose.yml', { deploymentId });
        generated.dockerCompose = await this.generateDockerCompose(
          deploymentId,
          analysisWithUserId,
          analysis.codeAnalysis || {}
        );
      }

      // Generate CI/CD pipeline if missing
      if (missingInfra.cicdPipeline) {
        logger.info('Generating CI/CD pipeline', { deploymentId });
        generated.cicdPipeline = await this.generateCICDPipeline(
          deploymentId,
          analysisWithUserId,
          missingInfra
        );
      }

      // Always generate deployment scripts
      if (missingInfra.deploymentScripts) {
        logger.info('Generating deployment scripts', { deploymentId });
        generated.deploymentScripts = await this.generateDeploymentScripts(
          deploymentId,
          analysisWithUserId
        );
      }

      return generated;
    } catch (error) {
      logger.error('Failed to generate missing infrastructure:', error);
      throw error;
    }
  }

  /**
   * Commit generated files to repository
   */
  async commitGeneratedFiles(deploymentId, repositoryUrl, branch, generatedFiles, githubToken) {
    try {
      const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
      const commitBranch = `deployment-setup-${deploymentId}`;
      
      // Create a new branch
      await githubService.createBranch(owner, repo, branch, commitBranch, githubToken);
      
      const filesToCommit = [];
      
      // Add Dockerfile
      if (generatedFiles.dockerfile) {
        filesToCommit.push({
          path: 'Dockerfile',
          content: Buffer.from(generatedFiles.dockerfile).toString('base64'),
          mode: '100644'
        });
      }
      
      // Add docker-compose.yml
      if (generatedFiles.dockerCompose) {
        filesToCommit.push({
          path: 'docker-compose.yml',
          content: Buffer.from(generatedFiles.dockerCompose).toString('base64'),
          mode: '100644'
        });
      }
      
      // Add CI/CD pipeline
      if (generatedFiles.cicdPipeline) {
        filesToCommit.push({
          path: '.github/workflows/deploy.yml',
          content: Buffer.from(generatedFiles.cicdPipeline).toString('base64'),
          mode: '100644'
        });
      }
      
      // Add deployment scripts
      if (generatedFiles.deploymentScripts) {
        if (generatedFiles.deploymentScripts.deploy) {
          filesToCommit.push({
            path: 'scripts/deploy.sh',
            content: Buffer.from(generatedFiles.deploymentScripts.deploy).toString('base64'),
            mode: '100755' // Executable
          });
        }
        if (generatedFiles.deploymentScripts.rollback) {
          filesToCommit.push({
            path: 'scripts/rollback.sh',
            content: Buffer.from(generatedFiles.deploymentScripts.rollback).toString('base64'),
            mode: '100755'
          });
        }
        if (generatedFiles.deploymentScripts.healthCheck) {
          filesToCommit.push({
            path: 'scripts/health-check.sh',
            content: Buffer.from(generatedFiles.deploymentScripts.healthCheck).toString('base64'),
            mode: '100755'
          });
        }
      }
      
      if (filesToCommit.length === 0) {
        return null;
      }
      
      // Create commit
      const commitMessage = `chore: Add deployment infrastructure files\n\nGenerated by Deployment Agent:\n- Dockerfile\n- docker-compose.yml\n- CI/CD pipeline\n- Deployment scripts`;
      
      const commit = await githubService.createCommit(
        owner,
        repo,
        commitBranch,
        filesToCommit,
        commitMessage,
        null, // author
        githubToken
      );
      
      // Create pull request
      const pr = await githubService.createPullRequest(
        owner,
        repo,
        'Add Deployment Infrastructure Files',
        commitBranch,
        branch,
        'This PR adds automatically generated deployment infrastructure files including Dockerfile, CI/CD pipeline, and deployment scripts.',
        githubToken
      );
      
      return {
        branch: commitBranch,
        commit: commit.sha,
        pullRequest: pr.number,
        files: filesToCommit.map(f => f.path)
      };
    } catch (error) {
      logger.error('Failed to commit generated files:', error);
      throw error;
    }
  }

  /**
   * Helper: Detect application entry point
   */
  detectEntryPoint(analysis) {
    const keyFiles = analysis.structure?.fileTypes || {};
    if (keyFiles.js || keyFiles.ts) {
      return 'index.js or server.js';
    }
    if (keyFiles.py) {
      return 'main.py or app.py';
    }
    if (keyFiles.go) {
      return 'main.go';
    }
    return 'index.js';
  }

  /**
   * Helper: Extract code from AI response
   */
  extractCode(text, language, label = null) {
    // Look for code blocks
    const codeBlockRegex = label 
      ? new RegExp(`(?:${label}|${label}\\.sh)[\\s\\S]*?\\\`\\\`\\\`${language}([\\s\\S]*?)\\\`\\\`\\\``, 'i')
      : new RegExp(`\\\`\\\`\\\`${language}([\\s\\S]*?)\\\`\\\`\\\``, 'i');
    
    const match = text.match(codeBlockRegex);
    if (match) {
      return match[1].trim();
    }
    
    // Fallback: return text between first and last code block
    const blocks = text.match(/```[\s\S]*?```/g);
    if (blocks && blocks.length > 0) {
      return blocks[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim();
    }
    
    // Last resort: return the text itself
    return text.trim();
  }
}

module.exports = new InfrastructureGenerator();

