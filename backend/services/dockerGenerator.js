const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

/**
 * Docker Generator Service
 * Uses Claude to generate Dockerfiles and docker-compose.yml files
 * based on project analysis and detected services
 */
class DockerGeneratorService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });
    
    if (!process.env.CLAUDE_API_KEY) {
      logger.warn('CLAUDE_API_KEY not set - Docker generator will not work');
    }
  }

  /**
   * Generate Dockerfile for a specific service
   * @param {Object} options
   * @param {string} options.serviceName - Name of the service (e.g., 'frontend', 'backend')
   * @param {string} options.serviceType - Type of service ('frontend', 'backend', 'fullstack')
   * @param {string} options.framework - Detected framework (e.g., 'React', 'Express', 'Next.js')
   * @param {Object} options.packageJson - Parsed package.json content
   * @param {Array} options.envVariables - List of required environment variables
   * @param {Object} options.projectStructure - Project file structure
   * @param {string} options.servicePath - Path to the service within the project
   */
  async generateDockerfile(options) {
    try {
      const {
        serviceName = 'app',
        serviceType = 'backend',
        framework = null,
        packageJson = {},
        envVariables = [],
        projectStructure = {},
        servicePath = '.'
      } = options;

      const prompt = this.buildDockerfilePrompt(options);
      
      logger.info(`Generating Dockerfile for ${serviceName} (${framework || serviceType})`);

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.content[0]?.text || '';
      const dockerfile = this.extractCodeBlock(content, 'dockerfile');
      const explanation = this.extractExplanation(content);

      return {
        success: true,
        serviceName,
        servicePath,
        filename: 'Dockerfile',
        content: dockerfile,
        explanation,
        metadata: {
          framework,
          serviceType,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to generate Dockerfile:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate docker-compose.yml for the entire project
   * @param {Object} options
   * @param {Array} options.services - Array of detected services
   * @param {Object} options.databases - Detected database requirements
   * @param {Object} options.projectInfo - Project information from package.json
   * @param {Array} options.envVariables - Required environment variables
   */
  async generateDockerCompose(options) {
    try {
      const {
        services = [],
        databases = [],
        projectInfo = {},
        envVariables = [],
        projectStructure = {}
      } = options;

      const prompt = this.buildDockerComposePrompt(options);
      
      logger.info(`Generating docker-compose.yml for ${services.length} services`);

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      const content = response.content[0]?.text || '';
      const dockerCompose = this.extractCodeBlock(content, 'yaml') || this.extractCodeBlock(content, 'yml');
      const explanation = this.extractExplanation(content);

      return {
        success: true,
        filename: 'docker-compose.yml',
        content: dockerCompose,
        explanation,
        services: services.map(s => s.name),
        metadata: {
          serviceCount: services.length,
          databaseCount: databases.length,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to generate docker-compose.yml:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate .dockerignore file
   */
  async generateDockerignore(options) {
    try {
      const { framework, language = 'javascript' } = options;

      const baseIgnore = `
# Dependencies
node_modules
npm-debug.log
yarn-error.log
.pnpm-store

# Build outputs
dist
build
.next
.nuxt
.output

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea
.vscode
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Git
.git
.gitignore

# Tests
coverage
.nyc_output
*.test.js
*.spec.js
__tests__

# Misc
*.log
*.md
!README.md
Dockerfile*
docker-compose*
`;

      const pythonAdditions = `
# Python
__pycache__
*.py[cod]
*$py.class
*.so
.Python
venv
.venv
env
.env
pip-log.txt
pip-delete-this-directory.txt
.tox
.coverage
.coverage.*
htmlcov
.pytest_cache
.mypy_cache
`;

      let content = baseIgnore.trim();
      if (language === 'python' || framework?.toLowerCase().includes('python')) {
        content += '\n' + pythonAdditions.trim();
      }

      return {
        success: true,
        filename: '.dockerignore',
        content
      };
    } catch (error) {
      logger.error('Failed to generate .dockerignore:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Build prompt for Dockerfile generation
   */
  buildDockerfilePrompt(options) {
    const {
      serviceName,
      serviceType,
      framework,
      packageJson,
      envVariables,
      projectStructure,
      servicePath
    } = options;

    const scripts = packageJson?.scripts || {};
    const dependencies = Object.keys(packageJson?.dependencies || {});
    const devDependencies = Object.keys(packageJson?.devDependencies || {});
    const nodeVersion = packageJson?.engines?.node || '20';

    return `Generate a production-ready Dockerfile for the following application:

## Service Information
- **Service Name**: ${serviceName}
- **Service Type**: ${serviceType}
- **Service Path**: ${servicePath}
- **Framework**: ${framework || 'Unknown'}

## Package.json Analysis
- **Node Version**: ${nodeVersion}
- **Available Scripts**: ${JSON.stringify(scripts, null, 2)}
- **Key Dependencies**: ${dependencies.slice(0, 20).join(', ')}
- **Dev Dependencies**: ${devDependencies.slice(0, 10).join(', ')}

## Environment Variables Needed
${envVariables.length > 0 
  ? `The following environment variables were detected from .env files:\n${envVariables.map(v => `- ${v}`).join('\n')}\n\n**Important**: These variables should be available at runtime. Use ARG for build-time variables if needed, and ENV for runtime variables. Consider using .env file or environment variable injection.`
  : '- None detected - but consider common variables like PORT, NODE_ENV, DATABASE_URL, etc.'}

## Project Structure (partial)
${JSON.stringify(projectStructure, null, 2).substring(0, 2000)}

## Requirements
1. Use multi-stage builds for smaller image size
2. Use appropriate base image (node:${nodeVersion}-alpine for Node.js)
3. Install dependencies efficiently (copy package*.json first)
4. Set proper working directory
5. Expose the appropriate port
6. Use non-root user for security
7. Include health check if applicable
8. Handle both development and production builds
9. Optimize for caching layers

## Framework-Specific Considerations
${this.getFrameworkSpecificNotes(framework, serviceType)}

Please generate:
1. A complete, production-ready Dockerfile
2. Brief explanation of key decisions

Format your response with the Dockerfile in a \`\`\`dockerfile code block, followed by an explanation.`;
  }

  /**
   * Build prompt for docker-compose.yml generation
   */
  buildDockerComposePrompt(options) {
    const {
      services,
      databases,
      projectInfo,
      envVariables,
      projectStructure
    } = options;

    const servicesDescription = services.map(s => 
      `- ${s.name}: ${s.type} service using ${s.framework || 'unknown framework'} on port ${s.port || 'unknown'}`
    ).join('\n');

    const databasesDescription = databases.length > 0 
      ? databases.map(d => `- ${d.type}: ${d.name || d.type}`).join('\n')
      : 'None detected';

    return `Generate a production-ready docker-compose.yml for the following project:

## Project Information
- **Name**: ${projectInfo.name || 'app'}
- **Version**: ${projectInfo.version || '1.0.0'}

## Services Detected
${servicesDescription || 'No services detected'}

## Database/Cache Requirements
${databasesDescription}

## Environment Variables Detected
${envVariables.length > 0 ? envVariables.map(v => `- ${v}`).join('\n') : 'None detected'}

## Requirements
1. Use Docker Compose version 3.8 or higher
2. Define proper service dependencies (depends_on)
3. Use named volumes for persistent data
4. Create a custom network for inter-service communication
5. **CRITICAL: Include environment variables from .env files**
   ${envVariables.length > 0 ? `
   - Use \`env_file\` directive to reference .env file: \`env_file: .env\`
   - Include an \`environment\` section with variables from the detected list above
   - Use \${VAR_NAME} syntax for variable substitution where appropriate
   - For services in subdirectories, reference service-specific .env files if they exist
   ` : '- Include environment variable placeholders with sensible defaults'}
6. Add health checks for critical services
7. Use proper port mappings
8. Include restart policies
9. Add volume mounts for development hot-reload where applicable
10. Use build context for services with Dockerfiles

## Database Service Guidelines
- PostgreSQL: Use postgres:15-alpine, set POSTGRES_* env vars
- MySQL: Use mysql:8, set MYSQL_* env vars
- MongoDB: Use mongo:6, set MONGO_* env vars
- Redis: Use redis:7-alpine

## Environment Variable Configuration
${envVariables.length > 0 ? `
The following environment variables were detected from .env files in the project:
${envVariables.map(v => `- ${v}`).join('\n')}

For each service that needs these variables:
1. Add \`env_file: .env\` to load variables from the .env file
2. Optionally add an \`environment\` section with specific variables if needed
3. Use \${VAR_NAME} syntax for variable substitution in docker-compose.yml
` : 'No environment variables were detected. Include sensible defaults or placeholders.'}

Please generate:
1. A complete docker-compose.yml file that properly references .env files
2. Brief explanation of the configuration

Format your response with the docker-compose.yml in a \`\`\`yaml code block, followed by an explanation.`;
  }

  /**
   * Get framework-specific notes for Dockerfile generation
   */
  getFrameworkSpecificNotes(framework, serviceType) {
    const notes = {
      'Next.js': `
- Use standalone output mode for production
- Build with: next build
- Run with: node server.js (if standalone) or next start
- Default port: 3000
- Consider output: 'standalone' in next.config.js`,

      'React': `
- Build with: npm run build
- Serve static files with nginx
- Use nginx:alpine for the final stage
- Copy build output to /usr/share/nginx/html
- Default port: 80 (nginx)`,

      'Vue': `
- Build with: npm run build
- Serve with nginx
- Copy dist folder to nginx html
- Default port: 80`,

      'Express': `
- Run with: node server.js or npm start
- Typically port 3000 or 5000
- No build step usually needed
- Include all source files`,

      'Fastify': `
- Similar to Express
- Run with: node index.js or npm start
- Fast startup, consider smaller base image`,

      'NestJS': `
- Build with: npm run build
- Run with: node dist/main.js
- TypeScript compilation required
- Default port: 3000`,

      'Django': `
- Use python:3.11-slim base
- Install requirements.txt
- Run with gunicorn
- Collect static files
- Default port: 8000`,

      'Flask': `
- Use python:3.11-slim base
- Install requirements.txt
- Run with gunicorn or flask run
- Default port: 5000`,

      'FastAPI': `
- Use python:3.11-slim base
- Install requirements.txt
- Run with uvicorn
- Default port: 8000`
    };

    return notes[framework] || `Standard ${serviceType} configuration. Analyze scripts to determine build and run commands.`;
  }

  /**
   * Extract code block from Claude response
   */
  extractCodeBlock(content, language) {
    // Try specific language first
    const specificRegex = new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``, 'i');
    let match = content.match(specificRegex);
    if (match) {
      return match[1].trim();
    }

    // Try generic code block
    const genericRegex = /```[\w]*\n([\s\S]*?)```/;
    match = content.match(genericRegex);
    if (match) {
      return match[1].trim();
    }

    // Return content as-is if no code block found
    return content;
  }

  /**
   * Extract explanation text from Claude response
   */
  extractExplanation(content) {
    // Remove code blocks and get remaining text
    const withoutCode = content.replace(/```[\s\S]*?```/g, '').trim();
    
    // Clean up and return
    const lines = withoutCode.split('\n').filter(line => line.trim());
    return lines.join('\n').substring(0, 2000); // Limit explanation length
  }
}

module.exports = new DockerGeneratorService();

