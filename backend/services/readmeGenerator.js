const claudeService = require('./claude');
const ReadmeTemplate = require('../models/ReadmeTemplate');
const envFileDetector = require('./envFileDetector');
const logger = require('../utils/logger');

/**
 * README Generator Service
 * Generates structured README files for Docker file generation via Cursor
 * Cost-optimized: Generates README (~500-1000 tokens) instead of full Docker files (~2000-5000 tokens)
 */
class ReadmeGenerator {
  constructor() {
    this.templateCache = new Map();
  }

  /**
   * Generate Docker README for all services
   */
  async generateDockerReadme(deploymentId, stageId, context) {
    try {
      const { serviceTopology, dockerFiles, envVars } = context;
      
      // Get existing and missing files from context (from pre-check)
      const existingFiles = context.existingFiles || [];
      const missingFiles = context.missingFiles || [];
      const contextEnvFiles = context.envFiles || [];
      
      // Detect .env files and get environment variables (if not already in context)
      let envFiles = contextEnvFiles;
      let envVarsFromFiles = context.envVars || { variables: {}, count: 0 };
      
      if (!envFiles || envFiles.length === 0) {
        envFiles = await envFileDetector.detectEnvFiles(deploymentId);
        envVarsFromFiles = await envFileDetector.getEnvVariables(deploymentId);
      }
      
      // Merge env vars from context and .env files
      const mergedEnvVars = {
        ...(envVars || {}),
        fromEnvFiles: envVarsFromFiles.variables || {},
        envFiles: envFiles.map(f => f.path || f),
        totalCount: (envVars?.variableCount || 0) + (envVarsFromFiles.count || 0)
      };
      
      // Build prompt for Claude with file status and .env information
      const prompt = this.buildDockerReadmePrompt(
        serviceTopology, 
        dockerFiles, 
        mergedEnvVars, 
        envFiles,
        existingFiles,
        missingFiles
      );
      
      // Call Claude to generate README
      const response = await claudeService.chat(deploymentId, prompt, {
        maxTokens: 2048,
        systemPrompt: this.getReadmeGenerationSystemPrompt(),
        operationType: 'readme_generation'
      });
      
      const readmeContent = response.message || response.content || '';
      
      logger.info('Generated Docker README', {
        deploymentId,
        stageId,
        contentLength: readmeContent.length,
        envFilesCount: envFiles.length,
        envVarsCount: envVarsFromFiles.count
      });
      
      return {
        success: true,
        content: readmeContent,
        metadata: {
          services: serviceTopology?.services?.length || 0,
          existingDockerFiles: dockerFiles?.files?.length || 0,
          envVarCount: mergedEnvVars.totalCount,
          envFilesCount: envFiles.length
        }
      };
    } catch (error) {
      logger.error('Failed to generate Docker README:', error);
      throw error;
    }
  }

  /**
   * Generate Dockerfile-specific README
   */
  async generateDockerfileReadme(serviceInfo, requirements) {
    try {
      // Check for cached template first
      const template = await this.getTemplate('dockerfile', serviceInfo.type || 'nodejs');
      if (template) {
        const rendered = template.render({
          serviceName: serviceInfo.name,
          entryPoint: requirements.entryPoint,
          port: requirements.port,
          dependencies: requirements.dependencies?.join(', ') || 'none',
          envVars: requirements.envVars?.join(', ') || 'none'
        });
        
        // Increment usage
        await template.incrementUsage();
        
        return {
          success: true,
          content: rendered,
          fromCache: true
        };
      }
      
      // Generate using Claude if no template
      const prompt = this.buildDockerfileReadmePrompt(serviceInfo, requirements);
      const response = await claudeService.chat(null, prompt, {
        maxTokens: 1024,
        systemPrompt: this.getReadmeGenerationSystemPrompt(),
        operationType: 'readme_generation'
      });
      
      return {
        success: true,
        content: response.message || response.content || '',
        fromCache: false
      };
    } catch (error) {
      logger.error('Failed to generate Dockerfile README:', error);
      throw error;
    }
  }

  /**
   * Generate docker-compose.yml README
   */
  async generateDockerComposeReadme(services, dependencies) {
    try {
      // Check for cached template first
      const template = await this.getTemplate('docker-compose', 'multi-service');
      if (template) {
        const rendered = template.render({
          services: services.map(s => s.name).join(', '),
          dependencies: dependencies?.join(', ') || 'none',
          serviceCount: services.length
        });
        
        await template.incrementUsage();
        
        return {
          success: true,
          content: rendered,
          fromCache: true
        };
      }
      
      // Generate using Claude if no template
      const prompt = this.buildDockerComposeReadmePrompt(services, dependencies);
      const response = await claudeService.chat(null, prompt, {
        maxTokens: 1536,
        systemPrompt: this.getReadmeGenerationSystemPrompt(),
        operationType: 'readme_generation'
      });
      
      return {
        success: true,
        content: response.message || response.content || '',
        fromCache: false
      };
    } catch (error) {
      logger.error('Failed to generate docker-compose README:', error);
      throw error;
    }
  }

  /**
   * Build prompt for Docker README generation
   */
  buildDockerReadmePrompt(serviceTopology, dockerFiles, envVars, envFiles = [], existingFiles = [], missingFiles = []) {
    const services = serviceTopology?.services || [];
    const existingDockerFiles = dockerFiles?.files || [];
    
    // Build existing files section
    let existingFilesSection = '';
    if (existingFiles && existingFiles.length > 0) {
      existingFilesSection = `\n\n### Existing Files Detected\nThe following files already exist in the workspace:\n${existingFiles.map(f => `- ${f.path} (${f.type})`).join('\n')}\n\n**IMPORTANT**: These files will be verified but do NOT need to be regenerated. Please reference them in your Docker configuration but focus on generating only the missing files listed below.`;
    }

    // Build missing files section
    let missingFilesSection = '';
    if (missingFiles && missingFiles.length > 0) {
      missingFilesSection = `\n\n### Files to Generate\nThe following files need to be generated:\n${missingFiles.map(f => `- ${f.path} (${f.type})`).join('\n')}\n\n**ACTION REQUIRED**: Please generate these files according to the requirements specified below.`;
    } else if (existingFiles && existingFiles.length > 0) {
      missingFilesSection = `\n\n### Files Status\nAll required Docker files already exist. Please verify and update them if needed according to the requirements below.`;
    }

    // Build .env files section
    let envFilesSection = '';
    if (envFiles && envFiles.length > 0) {
      envFilesSection = `\n\n### Environment Files Detected\nThe following .env files have been detected in the workspace:\n${envFiles.map(f => `- ${f.path}`).join('\n')}\n\nPlease ensure these files are properly referenced in your Docker configuration.`;
    }

    // Build environment variables section
    let envVarsSection = '';
    const allEnvVars = envVars?.fromEnvFiles || envVars?.variables || {};
    const envVarCount = envVars?.totalCount || Object.keys(allEnvVars).length || 0;
    
    if (envVarCount > 0) {
      const envVarKeys = Object.keys(allEnvVars).slice(0, 20); // Show first 20
      envVarsSection = `\n\n### Environment Variables${envVars?.fromEnvFiles ? ' from .env Files' : ''}\nFound ${envVarCount} environment variable(s):\n${envVarKeys.map(k => `- ${k}`).join('\n')}${envVarCount > 20 ? `\n... and ${envVarCount - 20} more` : ''}\n\nThese should be included in your Docker Compose environment configuration.`;
    } else {
      envVarsSection = '\n\n### Environment Variables\nNo environment variables detected.';
    }
    
    return `Generate a comprehensive README file for Docker configuration generation. This README will be used by a developer in Cursor to generate Docker files.${existingFilesSection}${missingFilesSection}${envFilesSection}${envVarsSection}

## Project Context

### Services Detected
${services.map(s => `- **${s.name}** (${s.type}): ${s.path || 'root'}`).join('\n')}

### Existing Docker Files (from previous analysis)
${existingDockerFiles.length > 0 
  ? existingDockerFiles.map(f => `- ${f.path}`).join('\n')
  : 'No Docker files found in previous analysis'}

## Requirements

Generate a README file that includes:

1. **Overview**: Brief description of what Docker files need to be generated
2. **For each service**, provide:
   - Service name and type
   - Entry point (check package.json main field or similar)
   - Port configuration (check code for PORT env var or default)
   - Dependencies (from package.json, requirements.txt, etc.)
   - Environment variables needed
   - Directory structure requirements
   - Specific instructions for generating the Dockerfile

3. **Docker Compose Requirements**:
   - Services to include
   - Network configuration
   - Volume mounts
   - Environment variable files
   - Health checks
   - Dependencies between services

4. **Verification Checklist**: What will be checked after generation:
   - Correct entry points
   - Correct ports
   - Correct directory paths
   - Environment variable usage
   - Health check configuration

## Critical Instructions

- **DO NOT generate actual Docker files** - only generate a README with requirements
- **Verify actual paths** - check package.json, source code for correct paths
- **Check port configurations** - look for PORT env vars or default ports in code
- **Include all dependencies** - database services (PostgreSQL, Redis), etc.
- **Be specific** - provide exact paths, ports, and configurations
- **Format for Cursor** - make it easy for Cursor to understand and generate files

Generate the README now:`;
  }

  /**
   * Build prompt for Dockerfile-specific README
   */
  buildDockerfileReadmePrompt(serviceInfo, requirements) {
    return `Generate a README section for Dockerfile generation for service: ${serviceInfo.name}

## Service Information
- Type: ${serviceInfo.type}
- Path: ${serviceInfo.path || 'root'}
- Entry Point: ${requirements.entryPoint || 'TBD - check package.json'}
- Port: ${requirements.port || 'TBD - check code'}
- Dependencies: ${requirements.dependencies?.join(', ') || 'none'}

## Requirements
Generate a README section that includes:
1. Exact entry point path
2. Port configuration
3. Build steps
4. Runtime requirements
5. Environment variables
6. Health check configuration

Format it so Cursor can easily generate the Dockerfile.`;
  }

  /**
   * Build prompt for docker-compose README
   */
  buildDockerComposeReadmePrompt(services, dependencies) {
    return `Generate a README section for docker-compose.yml generation.

## Services
${services.map(s => `- ${s.name}: ${s.type}`).join('\n')}

## Dependencies
${dependencies?.join(', ') || 'None detected'}

## Requirements
Generate a README section that includes:
1. Service definitions
2. Network configuration
3. Volume mounts
4. Environment variable files
5. Health checks
6. Service dependencies

Format it so Cursor can easily generate docker-compose.yml.`;
  }

  /**
   * Get README template from cache or database
   */
  async getTemplate(category, name) {
    const cacheKey = `${category}:${name}`;
    
    // Check memory cache
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey);
    }
    
    // Check database
    const template = await ReadmeTemplate.findOne({
      category,
      name
    });
    
    if (template) {
      this.templateCache.set(cacheKey, template);
      return template;
    }
    
    return null;
  }

  /**
   * Initialize default templates
   */
  async initializeDefaultTemplates() {
    try {
      const templates = [
        {
          name: 'nodejs',
          category: 'dockerfile',
          template: `# Dockerfile Generation Requirements for {{serviceName}}

## Service Information
- **Service Name**: {{serviceName}}
- **Type**: Node.js Application
- **Entry Point**: {{entryPoint}}
- **Port**: {{port}}

## Requirements

### Base Image
- Use \`node:20-alpine\` for production
- Use \`node:20\` for development

### Build Steps
1. Copy package.json and package-lock.json
2. Run \`npm ci --only=production\` for production
3. Copy application source code
4. Set working directory

### Runtime Configuration
- Expose port: {{port}}
- Set NODE_ENV=production
- Use non-root user (node user)

### Environment Variables
Required environment variables:
{{envVars}}

### Health Check
- Endpoint: /health
- Interval: 30s
- Timeout: 3s
- Retries: 3

## Verification Checklist
- [ ] Entry point matches package.json main field
- [ ] Port matches application configuration
- [ ] All dependencies installed
- [ ] Non-root user configured
- [ ] Health check configured
- [ ] Environment variables documented`,
          variables: [
            { name: 'serviceName', description: 'Name of the service', required: true },
            { name: 'entryPoint', description: 'Application entry point', required: true },
            { name: 'port', description: 'Port number', required: true },
            { name: 'envVars', description: 'Environment variables list', required: false, defaultValue: 'None specified' }
          ]
        },
        {
          name: 'multi-service',
          category: 'docker-compose',
          template: `# Docker Compose Configuration Requirements

## Services
{{services}}

## Total Services
{{serviceCount}} service(s) to configure

## Requirements

### Network Configuration
- Create a bridge network: \`app-network\`
- All services should connect to this network

### Service Definitions
For each service:
- Build context: Use correct directory paths (./backend, ./frontend, etc.)
- Port mapping: Map container ports to host ports
- Environment variables: Use .env files
- Health checks: Configure appropriate health checks
- Dependencies: Define service dependencies

### Dependencies
{{dependencies}}

### Volumes
- Database data volumes (if applicable)
- Log volumes for services

### Environment Files
- .env (shared)
- .env.backend (backend-specific)
- .env.frontend (frontend-specific)

## Verification Checklist
- [ ] All service build contexts use correct paths
- [ ] Port mappings are correct
- [ ] Service dependencies are defined
- [ ] Health checks are configured
- [ ] Environment variables are properly referenced
- [ ] Network configuration is correct`,
          variables: [
            { name: 'services', description: 'List of service names', required: true },
            { name: 'serviceCount', description: 'Number of services', required: true },
            { name: 'dependencies', description: 'External dependencies', required: false, defaultValue: 'None' }
          ]
        }
      ];

      for (const templateData of templates) {
        const existing = await ReadmeTemplate.findOne({
          category: templateData.category,
          name: templateData.name
        });

        if (!existing) {
          await ReadmeTemplate.create(templateData);
          logger.info(`Created default template: ${templateData.category}/${templateData.name}`);
        }
      }
    } catch (error) {
      logger.error('Failed to initialize default templates:', error);
    }
  }

  /**
   * Get system prompt for README generation
   */
  getReadmeGenerationSystemPrompt() {
    return `You are an expert DevOps engineer generating README files for Docker configuration.

Your task is to generate structured README files that developers can use in Cursor to generate Docker files.

CRITICAL RULES:
1. **DO NOT generate actual Docker files** - only generate README with requirements
2. **Be specific** - provide exact paths, ports, configurations
3. **Verify information** - check package.json, source code for correct values
4. **Format clearly** - use markdown with clear sections
5. **Include verification checklist** - what will be checked after generation

The README should be comprehensive but concise (~500-1000 tokens).`;
  }
}

module.exports = new ReadmeGenerator();

