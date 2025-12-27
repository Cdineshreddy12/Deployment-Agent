const dockerMCPService = require('./dockerMCP');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Docker Service
 * High-level Docker operations for deployment workflows
 */
class DockerService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Initialize Docker service
   */
  async initialize() {
    if (this.initialized) return true;

    const connected = await dockerMCPService.initialize();
    this.initialized = connected;
    
    return connected;
  }

  /**
   * Check if Docker is available
   */
  isAvailable() {
    return dockerMCPService.isAvailable();
  }

  /**
   * Detect if a repository has Docker configuration
   * @param {string} repoPath - Path to repository
   * @returns {Promise<Object>} - Detection result
   */
  async detectDockerConfig(repoPath) {
    const result = {
      hasDockerfile: false,
      hasDockerCompose: false,
      dockerfiles: [],
      composeFiles: [],
      detectedServices: []
    };

    try {
      const files = await fs.readdir(repoPath);

      // Check for Dockerfiles
      for (const file of files) {
        if (file === 'Dockerfile' || file.startsWith('Dockerfile.')) {
          result.hasDockerfile = true;
          result.dockerfiles.push(file);
        }
        if (file === 'docker-compose.yml' || file === 'docker-compose.yaml' || file.startsWith('docker-compose.')) {
          result.hasDockerCompose = true;
          result.composeFiles.push(file);
        }
      }

      // Parse docker-compose to detect services
      if (result.hasDockerCompose) {
        const composePath = path.join(repoPath, result.composeFiles[0]);
        const composeContent = await fs.readFile(composePath, 'utf8');
        result.detectedServices = this.parseComposeServices(composeContent);
      }

      return result;

    } catch (error) {
      logger.error('Docker detection failed:', error);
      return result;
    }
  }

  /**
   * Parse docker-compose file for services
   */
  parseComposeServices(content) {
    const services = [];
    const serviceMatch = content.match(/services:\s*([\s\S]*?)(?:^[a-z]|\Z)/m);
    
    if (serviceMatch) {
      const servicesSection = serviceMatch[1];
      const serviceNames = servicesSection.match(/^\s{2}(\w+):/gm);
      
      if (serviceNames) {
        serviceNames.forEach(match => {
          const name = match.trim().replace(':', '');
          services.push(name);
        });
      }
    }

    return services;
  }

  /**
   * Generate Dockerfile for a project
   * @param {Object} options - Generation options
   * @returns {Promise<string>} - Generated Dockerfile content
   */
  async generateDockerfile(options) {
    const { projectType, framework, nodeVersion = '18', pythonVersion = '3.11' } = options;

    let dockerfile = '';

    switch (projectType) {
      case 'nodejs':
        dockerfile = this.generateNodeDockerfile(options);
        break;
      case 'python':
        dockerfile = this.generatePythonDockerfile(options);
        break;
      case 'golang':
        dockerfile = this.generateGoDockerfile(options);
        break;
      case 'java':
        dockerfile = this.generateJavaDockerfile(options);
        break;
      default:
        dockerfile = this.generateGenericDockerfile(options);
    }

    return dockerfile;
  }

  /**
   * Generate Node.js Dockerfile
   */
  generateNodeDockerfile(options) {
    const { nodeVersion = '18', framework, port = 3000 } = options;
    
    return `# Node.js Dockerfile
FROM node:${nodeVersion}-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build if needed
${framework === 'Next.js' ? 'RUN npm run build' : ''}

# Production image
FROM node:${nodeVersion}-alpine

WORKDIR /app

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Set environment
ENV NODE_ENV=production
ENV PORT=${port}

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -qO- http://localhost:${port}/health || exit 1

# Start application
CMD ["npm", "start"]
`;
  }

  /**
   * Generate Python Dockerfile
   */
  generatePythonDockerfile(options) {
    const { pythonVersion = '3.11', framework, port = 8000 } = options;
    const isFlask = framework === 'Flask';
    const isDjango = framework === 'Django';
    const isFastAPI = framework === 'FastAPI';

    return `# Python Dockerfile
FROM python:${pythonVersion}-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Production image
FROM python:${pythonVersion}-slim

WORKDIR /app

# Copy from builder
COPY --from=builder /usr/local/lib/python${pythonVersion}/site-packages /usr/local/lib/python${pythonVersion}/site-packages
COPY . .

# Set environment
ENV PYTHONUNBUFFERED=1
ENV PORT=${port}

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:${port}/health || exit 1

# Start application
${isFastAPI ? `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${port}"]` : ''}
${isFlask ? `CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:${port}", "app:app"]` : ''}
${isDjango ? `CMD ["gunicorn", "-w", "4", "-b", "0.0.0.0:${port}", "config.wsgi"]` : ''}
${!isFastAPI && !isFlask && !isDjango ? `CMD ["python", "app.py"]` : ''}
`;
  }

  /**
   * Generate Go Dockerfile
   */
  generateGoDockerfile(options) {
    const { goVersion = '1.21', port = 8080 } = options;

    return `# Go Dockerfile
FROM golang:${goVersion}-alpine AS builder

WORKDIR /app

# Install dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Production image
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy binary from builder
COPY --from=builder /app/main .

# Set environment
ENV PORT=${port}

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -qO- http://localhost:${port}/health || exit 1

# Start application
CMD ["./main"]
`;
  }

  /**
   * Generate Java Dockerfile
   */
  generateJavaDockerfile(options) {
    const { javaVersion = '17', port = 8080 } = options;

    return `# Java Dockerfile
FROM maven:3.9-eclipse-temurin-${javaVersion} AS builder

WORKDIR /app

# Copy pom.xml and download dependencies
COPY pom.xml .
RUN mvn dependency:go-offline

# Copy source code and build
COPY src ./src
RUN mvn package -DskipTests

# Production image
FROM eclipse-temurin:${javaVersion}-jre-alpine

WORKDIR /app

# Copy JAR from builder
COPY --from=builder /app/target/*.jar app.jar

# Set environment
ENV JAVA_OPTS=""
ENV PORT=${port}

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}/actuator/health || exit 1

# Start application
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
`;
  }

  /**
   * Generate generic Dockerfile
   */
  generateGenericDockerfile(options) {
    const { port = 8080 } = options;

    return `# Generic Dockerfile
FROM alpine:latest

WORKDIR /app

# Copy source code
COPY . .

# Install required packages (customize as needed)
RUN apk add --no-cache bash curl

# Set environment
ENV PORT=${port}

# Expose port
EXPOSE ${port}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:${port}/health || exit 1

# Start application (customize as needed)
CMD ["./start.sh"]
`;
  }

  /**
   * Generate docker-compose.yml for multi-service deployment
   * @param {Object} options - Generation options
   * @returns {Promise<string>} - Generated docker-compose content
   */
  async generateDockerCompose(options) {
    const { services, projectName, network = 'app-network' } = options;

    let compose = `version: '3.8'

services:
`;

    for (const service of services) {
      compose += this.generateComposeService(service);
    }

    compose += `
networks:
  ${network}:
    driver: bridge
`;

    // Add volumes section if any service needs volumes
    const volumeServices = services.filter(s => s.volumes && s.volumes.length > 0);
    if (volumeServices.length > 0) {
      compose += `
volumes:
`;
      volumeServices.forEach(s => {
        s.volumes.forEach(v => {
          if (v.named) {
            compose += `  ${v.name}:\n`;
          }
        });
      });
    }

    return compose;
  }

  /**
   * Generate compose service configuration
   */
  generateComposeService(service) {
    const {
      name,
      image,
      build,
      ports = [],
      environment = {},
      volumes = [],
      depends_on = [],
      healthcheck,
      restart = 'unless-stopped'
    } = service;

    let config = `  ${name}:
`;

    if (build) {
      config += `    build:
      context: ${build.context || '.'}
      dockerfile: ${build.dockerfile || 'Dockerfile'}
`;
    } else if (image) {
      config += `    image: ${image}
`;
    }

    if (ports.length > 0) {
      config += `    ports:
`;
      ports.forEach(p => {
        config += `      - "${p}"
`;
      });
    }

    if (Object.keys(environment).length > 0) {
      config += `    environment:
`;
      Object.entries(environment).forEach(([key, value]) => {
        config += `      ${key}: "${value}"
`;
      });
    }

    if (volumes.length > 0) {
      config += `    volumes:
`;
      volumes.forEach(v => {
        config += `      - ${v}
`;
      });
    }

    if (depends_on.length > 0) {
      config += `    depends_on:
`;
      depends_on.forEach(d => {
        config += `      - ${d}
`;
      });
    }

    config += `    restart: ${restart}
    networks:
      - app-network
`;

    if (healthcheck) {
      config += `    healthcheck:
      test: ${JSON.stringify(healthcheck.test)}
      interval: ${healthcheck.interval || '30s'}
      timeout: ${healthcheck.timeout || '10s'}
      retries: ${healthcheck.retries || 3}
`;
    }

    return config;
  }

  /**
   * Build and deploy using Docker
   * @param {Object} options - Deployment options
   * @returns {Promise<Object>} - Deployment result
   */
  async buildAndDeploy(options) {
    const { projectPath, projectName, environment = 'development' } = options;

    await this.initialize();

    if (!this.isAvailable()) {
      throw new Error('Docker is not available');
    }

    try {
      // Detect Docker configuration
      const dockerConfig = await this.detectDockerConfig(projectPath);

      if (dockerConfig.hasDockerCompose) {
        // Use docker-compose
        logger.info('Deploying with docker-compose');
        
        await dockerMCPService.composeDown({
          projectPath,
          projectName,
          removeVolumes: false
        }).catch(() => {}); // Ignore if nothing to stop

        const result = await dockerMCPService.composeUp({
          projectPath,
          projectName,
          detach: true,
          build: true
        });

        return {
          success: true,
          method: 'docker-compose',
          services: dockerConfig.detectedServices,
          ...result
        };

      } else if (dockerConfig.hasDockerfile) {
        // Build and run single container
        logger.info('Deploying with Dockerfile');
        
        const imageName = `${projectName}:${environment}`;
        
        const buildResult = await dockerMCPService.buildImage({
          contextPath: projectPath,
          dockerfile: dockerConfig.dockerfiles[0],
          tags: [imageName]
        });

        // Stop existing container if running
        await dockerMCPService.stopContainer(projectName).catch(() => {});
        await dockerMCPService.removeContainer(projectName).catch(() => {});

        const runResult = await dockerMCPService.runContainer({
          image: imageName,
          name: projectName,
          ports: { 8080: 8080 }, // Default port mapping
          detach: true
        });

        return {
          success: true,
          method: 'dockerfile',
          imageId: buildResult.imageId,
          containerId: runResult.containerId,
          ...runResult
        };

      } else {
        throw new Error('No Docker configuration found in repository');
      }

    } catch (error) {
      logger.error('Docker build and deploy failed:', error);
      throw error;
    }
  }

  /**
   * Get container health status
   * @param {string} containerIdOrName - Container ID or name
   * @returns {Promise<Object>} - Health status
   */
  async getContainerHealth(containerIdOrName) {
    await this.initialize();

    if (!this.isAvailable()) {
      return { available: false };
    }

    try {
      const info = await dockerMCPService.inspectContainer(containerIdOrName);
      
      return {
        available: true,
        id: info.id,
        name: info.name,
        running: info.state.Running,
        healthy: info.state.Health?.Status === 'healthy',
        status: info.state.Status,
        startedAt: info.state.StartedAt,
        restartCount: info.RestartCount
      };

    } catch (error) {
      return {
        available: true,
        error: error.message
      };
    }
  }

  /**
   * Clean up unused Docker resources
   * @param {Object} options - Cleanup options
   * @returns {Promise<Object>} - Cleanup result
   */
  async cleanup(options = {}) {
    const { images = true, containers = true, volumes = false } = options;
    
    await this.initialize();

    if (!this.isAvailable()) {
      throw new Error('Docker is not available');
    }

    const result = {
      removedContainers: 0,
      removedImages: 0,
      removedVolumes: 0
    };

    try {
      // Remove stopped containers
      if (containers) {
        const allContainers = await dockerMCPService.listContainers({ all: true });
        const stoppedContainers = allContainers.filter(c => c.state === 'exited');
        
        for (const container of stoppedContainers) {
          await dockerMCPService.removeContainer(container.id).catch(() => {});
          result.removedContainers++;
        }
      }

      // Remove dangling images
      if (images) {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync('docker image prune -f').catch(() => {});
      }

      logger.info('Docker cleanup completed', result);
      return result;

    } catch (error) {
      logger.error('Docker cleanup failed:', error);
      throw error;
    }
  }
}

// Singleton instance
const dockerService = new DockerService();

module.exports = dockerService;





