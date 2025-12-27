const dockerMCPService = require('../../services/dockerMCP');
const dockerService = require('../../services/dockerService');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const logger = require('../../utils/logger');

// Global event emitter for log streaming
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(100);

/**
 * Docker-related MCP tools
 * These tools expose Docker operations for Cursor AI integration
 */

/**
 * Stream logs from a container in real-time
 */
async function streamContainerLogs({ containerId, follow = true, tail = 100, onLog, onError, onEnd }) {
  return new Promise((resolve, reject) => {
    const args = ['logs'];
    if (follow) args.push('-f');
    if (tail) args.push('--tail', String(tail));
    args.push('--timestamps', containerId);
    
    const proc = spawn('docker', args);
    const logs = [];
    
    proc.stdout.on('data', (data) => {
      const logLine = data.toString();
      logs.push(logLine);
      if (onLog) onLog(logLine);
      logEmitter.emit(`logs:${containerId}`, { type: 'stdout', data: logLine });
    });
    
    proc.stderr.on('data', (data) => {
      const logLine = data.toString();
      logs.push(logLine);
      if (onLog) onLog(logLine);
      logEmitter.emit(`logs:${containerId}`, { type: 'stderr', data: logLine });
    });
    
    proc.on('close', (code) => {
      if (onEnd) onEnd(code);
      logEmitter.emit(`logs:${containerId}:end`, { code, logs: logs.join('') });
      resolve({ success: true, logs: logs.join(''), exitCode: code });
    });
    
    proc.on('error', (error) => {
      if (onError) onError(error);
      reject(error);
    });
    
    // Return process so caller can kill it if needed
    return proc;
  });
}

/**
 * Build image with streaming logs
 */
async function dockerBuildWithStreaming({ contextPath, dockerfile, tag, buildArgs = {}, onLog }) {
  return new Promise((resolve, reject) => {
    const args = ['build', '-t', tag, '-f', dockerfile || 'Dockerfile'];
    
    // Add build args
    for (const [key, value] of Object.entries(buildArgs)) {
      args.push('--build-arg', `${key}=${value}`);
    }
    
    args.push(contextPath);
    
    const proc = spawn('docker', args);
    const logs = [];
    let imageId = null;
    
    proc.stdout.on('data', (data) => {
      const logLine = data.toString();
      logs.push(logLine);
      if (onLog) onLog(logLine);
      
      // Try to extract image ID
      const match = logLine.match(/Successfully built ([a-f0-9]+)/);
      if (match) imageId = match[1];
      
      logEmitter.emit(`build:${tag}`, { type: 'stdout', data: logLine });
    });
    
    proc.stderr.on('data', (data) => {
      const logLine = data.toString();
      logs.push(logLine);
      if (onLog) onLog(logLine);
      logEmitter.emit(`build:${tag}`, { type: 'stderr', data: logLine });
    });
    
    proc.on('close', (code) => {
      logEmitter.emit(`build:${tag}:end`, { code, logs: logs.join(''), imageId });
      
      if (code === 0) {
        resolve({ 
          success: true, 
          logs: logs.join(''), 
          imageId,
          tag,
          exitCode: code 
        });
      } else {
        resolve({ 
          success: false, 
          logs: logs.join(''), 
          error: `Build failed with exit code ${code}`,
          exitCode: code 
        });
      }
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Run container with streaming logs
 */
async function dockerRunWithStreaming({ image, name, ports = {}, env = [], detach = true, command, onLog }) {
  return new Promise((resolve, reject) => {
    const args = ['run'];
    
    if (name) args.push('--name', name);
    if (detach) args.push('-d');
    
    // Add port mappings
    for (const [hostPort, containerPort] of Object.entries(ports)) {
      args.push('-p', `${hostPort}:${containerPort}`);
    }
    
    // Add environment variables
    for (const e of env) {
      args.push('-e', e);
    }
    
    args.push(image);
    
    if (command) {
      args.push(...command.split(' '));
    }
    
    const proc = spawn('docker', args);
    const logs = [];
    let containerId = null;
    
    proc.stdout.on('data', (data) => {
      const output = data.toString().trim();
      logs.push(output);
      if (onLog) onLog(output);
      
      // Container ID is usually the first output
      if (!containerId && output.match(/^[a-f0-9]{12,64}$/)) {
        containerId = output;
      }
    });
    
    proc.stderr.on('data', (data) => {
      const output = data.toString();
      logs.push(output);
      if (onLog) onLog(output);
    });
    
    proc.on('close', (code) => {
      if (code === 0 && containerId) {
        resolve({ 
          success: true, 
          containerId,
          name,
          logs: logs.join('\n'),
          exitCode: code 
        });
      } else {
        resolve({ 
          success: false, 
          logs: logs.join('\n'),
          error: `Run failed with exit code ${code}`,
          exitCode: code 
        });
      }
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Compose up with streaming logs
 */
async function dockerComposeUpWithStreaming({ projectPath, detach = true, build = false, onLog }) {
  return new Promise((resolve, reject) => {
    const args = ['compose', 'up'];
    if (detach) args.push('-d');
    if (build) args.push('--build');
    
    const proc = spawn('docker', args, { cwd: projectPath });
    const logs = [];
    
    proc.stdout.on('data', (data) => {
      const output = data.toString();
      logs.push(output);
      if (onLog) onLog(output);
      logEmitter.emit(`compose:${projectPath}`, { type: 'stdout', data: output });
    });
    
    proc.stderr.on('data', (data) => {
      const output = data.toString();
      logs.push(output);
      if (onLog) onLog(output);
      logEmitter.emit(`compose:${projectPath}`, { type: 'stderr', data: output });
    });
    
    proc.on('close', (code) => {
      logEmitter.emit(`compose:${projectPath}:end`, { code, logs: logs.join('') });
      
      resolve({ 
        success: code === 0, 
        logs: logs.join(''),
        exitCode: code,
        error: code !== 0 ? `Docker Compose failed with exit code ${code}` : null
      });
    });
    
    proc.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Check container health
 */
async function checkContainerHealth({ containerId }) {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['inspect', '--format', '{{.State.Health.Status}}', containerId]);
    let output = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.on('close', async (code) => {
      const healthStatus = output.trim();
      
      // If no health check defined, check if running
      if (!healthStatus || healthStatus === '<no value>') {
        const stateProc = spawn('docker', ['inspect', '--format', '{{.State.Running}}', containerId]);
        let stateOutput = '';
        
        stateProc.stdout.on('data', (data) => {
          stateOutput += data.toString();
        });
        
        stateProc.on('close', () => {
          const isRunning = stateOutput.trim() === 'true';
          resolve({
            success: true,
            containerId,
            hasHealthCheck: false,
            isRunning,
            status: isRunning ? 'running' : 'stopped',
            healthy: isRunning
          });
        });
      } else {
        resolve({
          success: true,
          containerId,
          hasHealthCheck: true,
          status: healthStatus,
          healthy: healthStatus === 'healthy',
          isRunning: healthStatus !== 'exited'
        });
      }
    });
    
    proc.on('error', (error) => {
      resolve({
        success: false,
        containerId,
        error: error.message
      });
    });
  });
}

/**
 * Analyze logs for errors and issues
 */
function analyzeLogsForErrors({ logs, projectType = 'generic' }) {
  const analysis = {
    hasErrors: false,
    hasCritical: false,
    hasWarnings: false,
    errors: [],
    warnings: [],
    suggestions: [],
    summary: ''
  };
  
  const lines = logs.split('\n');
  
  // Common error patterns
  const errorPatterns = [
    { pattern: /error:/i, type: 'error', message: 'General error detected' },
    { pattern: /Error:/i, type: 'error', message: 'Error detected' },
    { pattern: /FATAL/i, type: 'critical', message: 'Fatal error' },
    { pattern: /ECONNREFUSED/i, type: 'error', message: 'Connection refused - service unavailable' },
    { pattern: /ENOTFOUND/i, type: 'error', message: 'DNS resolution failed' },
    { pattern: /ETIMEDOUT/i, type: 'error', message: 'Connection timeout' },
    { pattern: /Cannot find module/i, type: 'error', message: 'Missing Node.js module' },
    { pattern: /ModuleNotFoundError/i, type: 'error', message: 'Missing Python module' },
    { pattern: /permission denied/i, type: 'error', message: 'Permission denied' },
    { pattern: /out of memory/i, type: 'critical', message: 'Out of memory' },
    { pattern: /killed/i, type: 'critical', message: 'Process killed' },
    { pattern: /segmentation fault/i, type: 'critical', message: 'Segmentation fault' },
    { pattern: /npm ERR!/i, type: 'error', message: 'NPM error' },
    { pattern: /failed to build/i, type: 'error', message: 'Build failed' },
    { pattern: /exited with code [1-9]/i, type: 'error', message: 'Process exited with error code' }
  ];
  
  const warningPatterns = [
    { pattern: /warning:/i, type: 'warning', message: 'Warning' },
    { pattern: /deprecated/i, type: 'warning', message: 'Deprecated feature' },
    { pattern: /WARN/i, type: 'warning', message: 'Warning' }
  ];
  
  // Analyze each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const { pattern, type, message } of errorPatterns) {
      if (pattern.test(line)) {
        if (type === 'critical') {
          analysis.hasCritical = true;
        }
        analysis.hasErrors = true;
        analysis.errors.push({
          line: i + 1,
          type,
          message,
          content: line.substring(0, 200)
        });
        break;
      }
    }
    
    for (const { pattern, message } of warningPatterns) {
      if (pattern.test(line)) {
        analysis.hasWarnings = true;
        analysis.warnings.push({
          line: i + 1,
          message,
          content: line.substring(0, 200)
        });
        break;
      }
    }
  }
  
  // Generate suggestions based on errors
  if (analysis.errors.some(e => e.content.includes('ECONNREFUSED'))) {
    analysis.suggestions.push('Check if the database/service is running and accessible');
  }
  if (analysis.errors.some(e => e.content.includes('Cannot find module'))) {
    analysis.suggestions.push('Run npm install to install missing dependencies');
  }
  if (analysis.errors.some(e => e.content.includes('permission denied'))) {
    analysis.suggestions.push('Check file permissions or run with appropriate privileges');
  }
  if (analysis.errors.some(e => e.content.includes('out of memory'))) {
    analysis.suggestions.push('Increase container memory limits or optimize application');
  }
  
  // Generate summary
  if (analysis.hasCritical) {
    analysis.summary = `Critical errors found (${analysis.errors.filter(e => e.type === 'critical').length}). Deployment should not proceed.`;
  } else if (analysis.hasErrors) {
    analysis.summary = `${analysis.errors.length} error(s) found. Review and fix before proceeding.`;
  } else if (analysis.hasWarnings) {
    analysis.summary = `${analysis.warnings.length} warning(s) found. Generally safe to proceed.`;
  } else {
    analysis.summary = 'No errors or warnings detected. Safe to proceed.';
  }
  
  return {
    success: true,
    ...analysis,
    totalLines: lines.length,
    canProceed: !analysis.hasErrors
  };
}

/**
 * Subscribe to log events
 */
function subscribeToLogs(eventKey, callback) {
  logEmitter.on(eventKey, callback);
  return () => logEmitter.off(eventKey, callback);
}

const tools = [
  {
    name: 'docker_build',
    description: 'Build a Docker image from a Dockerfile',
    inputSchema: {
      type: 'object',
      properties: {
        contextPath: {
          type: 'string',
          description: 'Path to the build context (directory containing Dockerfile)'
        },
        dockerfile: {
          type: 'string',
          description: 'Name of the Dockerfile (default: Dockerfile)'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for the built image (e.g., ["myapp:latest", "myapp:v1.0"])'
        },
        buildArgs: {
          type: 'object',
          description: 'Build arguments to pass to Docker'
        }
      },
      required: ['contextPath']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.buildImage({
          contextPath: args.contextPath,
          dockerfile: args.dockerfile || 'Dockerfile',
          tags: args.tags || [],
          buildArgs: args.buildArgs || {}
        });

        return {
          success: true,
          imageId: result.imageId,
          tags: args.tags,
          duration: result.duration,
          message: `Docker image built successfully: ${result.imageId}`
        };
      } catch (error) {
        logger.error('Docker build failed via MCP:', error);
        throw new Error(`Docker build failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_run',
    description: 'Run a Docker container from an image',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Image name to run'
        },
        name: {
          type: 'string',
          description: 'Name for the container'
        },
        ports: {
          type: 'object',
          description: 'Port mappings (e.g., {"3000": "3000", "5432": "5432"})'
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variables (e.g., ["NODE_ENV=production"])'
        },
        volumes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Volume mounts (e.g., ["/host/path:/container/path"])'
        },
        network: {
          type: 'string',
          description: 'Docker network to connect to'
        },
        command: {
          type: 'string',
          description: 'Command to run in the container'
        },
        detach: {
          type: 'boolean',
          description: 'Run in detached mode (default: true)'
        }
      },
      required: ['image']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.runContainer({
          image: args.image,
          name: args.name,
          ports: args.ports || {},
          env: args.env || [],
          volumes: args.volumes || [],
          network: args.network,
          command: args.command,
          detach: args.detach !== false
        });

        return {
          success: true,
          containerId: result.containerId,
          name: result.name,
          state: result.state,
          ports: result.ports,
          message: `Container started: ${result.containerId}`
        };
      } catch (error) {
        logger.error('Docker run failed via MCP:', error);
        throw new Error(`Docker run failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_compose_up',
    description: 'Start services defined in docker-compose.yml',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to directory containing docker-compose.yml'
        },
        projectName: {
          type: 'string',
          description: 'Project name for docker-compose'
        },
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific services to start (default: all)'
        },
        build: {
          type: 'boolean',
          description: 'Build images before starting (default: false)'
        },
        detach: {
          type: 'boolean',
          description: 'Run in detached mode (default: true)'
        }
      },
      required: ['projectPath']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.composeUp({
          projectPath: args.projectPath,
          projectName: args.projectName,
          services: args.services || [],
          build: args.build || false,
          detach: args.detach !== false
        });

        return {
          success: true,
          output: result.output,
          warnings: result.warnings,
          duration: result.duration,
          message: 'Docker Compose services started'
        };
      } catch (error) {
        logger.error('Docker compose up failed via MCP:', error);
        throw new Error(`Docker compose up failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_compose_down',
    description: 'Stop and remove docker-compose services',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to directory containing docker-compose.yml'
        },
        projectName: {
          type: 'string',
          description: 'Project name for docker-compose'
        },
        removeVolumes: {
          type: 'boolean',
          description: 'Remove named volumes (default: false)'
        },
        removeImages: {
          type: 'boolean',
          description: 'Remove images (default: false)'
        }
      },
      required: ['projectPath']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.composeDown({
          projectPath: args.projectPath,
          projectName: args.projectName,
          removeVolumes: args.removeVolumes || false,
          removeImages: args.removeImages || false
        });

        return {
          success: true,
          output: result.output,
          duration: result.duration,
          message: 'Docker Compose services stopped'
        };
      } catch (error) {
        logger.error('Docker compose down failed via MCP:', error);
        throw new Error(`Docker compose down failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_ps',
    description: 'List Docker containers',
    inputSchema: {
      type: 'object',
      properties: {
        all: {
          type: 'boolean',
          description: 'Show all containers (default: only running)'
        },
        filters: {
          type: 'object',
          description: 'Filters to apply (e.g., {"name": ["myapp"]})'
        }
      }
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const containers = await dockerMCPService.listContainers({
          all: args.all || false,
          filters: args.filters || {}
        });

        return {
          success: true,
          count: containers.length,
          containers
        };
      } catch (error) {
        logger.error('Docker ps failed via MCP:', error);
        throw new Error(`Docker ps failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_logs',
    description: 'Get logs from a Docker container',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        },
        tail: {
          type: 'number',
          description: 'Number of lines to show from the end (default: 100)'
        },
        timestamps: {
          type: 'boolean',
          description: 'Show timestamps (default: true)'
        },
        since: {
          type: 'string',
          description: 'Show logs since timestamp (ISO format)'
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const logs = await dockerMCPService.getContainerLogs(args.containerId, {
          tail: args.tail || 100,
          timestamps: args.timestamps !== false,
          since: args.since
        });

        return {
          success: true,
          containerId: args.containerId,
          logs
        };
      } catch (error) {
        logger.error('Docker logs failed via MCP:', error);
        throw new Error(`Docker logs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_inspect',
    description: 'Inspect a Docker container',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const info = await dockerMCPService.inspectContainer(args.containerId);

        return {
          success: true,
          container: info
        };
      } catch (error) {
        logger.error('Docker inspect failed via MCP:', error);
        throw new Error(`Docker inspect failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_stop',
    description: 'Stop a running Docker container',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        },
        timeout: {
          type: 'number',
          description: 'Seconds to wait before killing (default: 10)'
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.stopContainer(args.containerId, {
          timeout: args.timeout || 10
        });

        return {
          success: true,
          containerId: args.containerId,
          message: 'Container stopped'
        };
      } catch (error) {
        logger.error('Docker stop failed via MCP:', error);
        throw new Error(`Docker stop failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_remove',
    description: 'Remove a Docker container',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        },
        force: {
          type: 'boolean',
          description: 'Force removal of running container (default: false)'
        },
        removeVolumes: {
          type: 'boolean',
          description: 'Remove associated volumes (default: false)'
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.removeContainer(args.containerId, {
          force: args.force || false,
          removeVolumes: args.removeVolumes || false
        });

        return {
          success: true,
          containerId: args.containerId,
          message: 'Container removed'
        };
      } catch (error) {
        logger.error('Docker remove failed via MCP:', error);
        throw new Error(`Docker remove failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_images',
    description: 'List Docker images',
    inputSchema: {
      type: 'object',
      properties: {
        filters: {
          type: 'object',
          description: 'Filters to apply'
        }
      }
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const images = await dockerMCPService.listImages({
          filters: args.filters || {}
        });

        return {
          success: true,
          count: images.length,
          images
        };
      } catch (error) {
        logger.error('Docker images failed via MCP:', error);
        throw new Error(`Docker images failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_pull',
    description: 'Pull a Docker image from a registry',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Image name with tag (e.g., "nginx:latest")'
        }
      },
      required: ['image']
    },
    handler: async (args) => {
      try {
        await dockerMCPService.initialize();
        
        if (!dockerMCPService.isAvailable()) {
          throw new Error('Docker is not available on this system');
        }

        const result = await dockerMCPService.pullImage(args.image);

        return {
          success: true,
          image: args.image,
          duration: result.duration,
          message: `Image pulled: ${args.image}`
        };
      } catch (error) {
        logger.error('Docker pull failed via MCP:', error);
        throw new Error(`Docker pull failed: ${error.message}`);
      }
    }
  },

  {
    name: 'generate_dockerfile',
    description: 'Generate a Dockerfile for a project',
    inputSchema: {
      type: 'object',
      properties: {
        projectType: {
          type: 'string',
          enum: ['nodejs', 'python', 'golang', 'java', 'generic'],
          description: 'Type of project'
        },
        framework: {
          type: 'string',
          description: 'Framework used (e.g., React, Express, FastAPI, Django)'
        },
        port: {
          type: 'number',
          description: 'Port the application listens on'
        }
      },
      required: ['projectType']
    },
    handler: async (args) => {
      try {
        const dockerfile = await dockerService.generateDockerfile({
          projectType: args.projectType,
          framework: args.framework,
          port: args.port || 8080
        });

        return {
          success: true,
          dockerfile,
          message: `Dockerfile generated for ${args.projectType} project`
        };
      } catch (error) {
        logger.error('Dockerfile generation failed via MCP:', error);
        throw new Error(`Dockerfile generation failed: ${error.message}`);
      }
    }
  },

  {
    name: 'generate_docker_compose',
    description: 'Generate a docker-compose.yml for multi-service deployment',
    inputSchema: {
      type: 'object',
      properties: {
        projectName: {
          type: 'string',
          description: 'Name of the project'
        },
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              image: { type: 'string' },
              ports: { type: 'array' },
              environment: { type: 'object' },
              volumes: { type: 'array' },
              depends_on: { type: 'array' }
            }
          },
          description: 'Service definitions'
        }
      },
      required: ['projectName', 'services']
    },
    handler: async (args) => {
      try {
        const compose = await dockerService.generateDockerCompose({
          projectName: args.projectName,
          services: args.services
        });

        return {
          success: true,
          dockerCompose: compose,
          message: `docker-compose.yml generated for ${args.projectName}`
        };
      } catch (error) {
        logger.error('Docker Compose generation failed via MCP:', error);
        throw new Error(`Docker Compose generation failed: ${error.message}`);
      }
    }
  },

  // New streaming and health check tools
  {
    name: 'docker_build_with_logs',
    description: 'Build a Docker image with streaming logs. Returns when build completes.',
    inputSchema: {
      type: 'object',
      properties: {
        contextPath: {
          type: 'string',
          description: 'Path to the build context'
        },
        dockerfile: {
          type: 'string',
          description: 'Dockerfile name (default: Dockerfile)'
        },
        tag: {
          type: 'string',
          description: 'Image tag (e.g., myapp:latest)'
        },
        buildArgs: {
          type: 'object',
          description: 'Build arguments'
        }
      },
      required: ['contextPath', 'tag']
    },
    handler: async (args) => {
      try {
        const result = await dockerBuildWithStreaming({
          contextPath: args.contextPath,
          dockerfile: args.dockerfile || 'Dockerfile',
          tag: args.tag,
          buildArgs: args.buildArgs || {}
        });
        
        // Analyze logs for errors
        const logAnalysis = analyzeLogsForErrors({ logs: result.logs });
        
        return {
          ...result,
          analysis: logAnalysis
        };
      } catch (error) {
        logger.error('Docker build with logs failed:', error);
        throw new Error(`Docker build failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_run_with_logs',
    description: 'Run a Docker container with streaming logs',
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Image name to run'
        },
        name: {
          type: 'string',
          description: 'Container name'
        },
        ports: {
          type: 'object',
          description: 'Port mappings {hostPort: containerPort}'
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variables'
        },
        detach: {
          type: 'boolean',
          description: 'Run in detached mode',
          default: true
        },
        command: {
          type: 'string',
          description: 'Command to run'
        }
      },
      required: ['image']
    },
    handler: async (args) => {
      try {
        const result = await dockerRunWithStreaming({
          image: args.image,
          name: args.name,
          ports: args.ports || {},
          env: args.env || [],
          detach: args.detach !== false,
          command: args.command
        });
        
        return result;
      } catch (error) {
        logger.error('Docker run with logs failed:', error);
        throw new Error(`Docker run failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_compose_up_with_logs',
    description: 'Start Docker Compose services with streaming logs',
    inputSchema: {
      type: 'object',
      properties: {
        projectPath: {
          type: 'string',
          description: 'Path to docker-compose.yml directory'
        },
        detach: {
          type: 'boolean',
          description: 'Run in detached mode',
          default: true
        },
        build: {
          type: 'boolean',
          description: 'Build images before starting',
          default: false
        }
      },
      required: ['projectPath']
    },
    handler: async (args) => {
      try {
        const result = await dockerComposeUpWithStreaming({
          projectPath: args.projectPath,
          detach: args.detach !== false,
          build: args.build || false
        });
        
        const logAnalysis = analyzeLogsForErrors({ logs: result.logs });
        
        return {
          ...result,
          analysis: logAnalysis
        };
      } catch (error) {
        logger.error('Docker Compose up with logs failed:', error);
        throw new Error(`Docker Compose up failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_health_check',
    description: 'Check the health status of a Docker container',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        const result = await checkContainerHealth({ containerId: args.containerId });
        return result;
      } catch (error) {
        logger.error('Docker health check failed:', error);
        throw new Error(`Health check failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_stream_logs',
    description: 'Get container logs with optional following. Returns collected logs.',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        },
        follow: {
          type: 'boolean',
          description: 'Follow log output (will timeout after 30s)',
          default: false
        },
        tail: {
          type: 'number',
          description: 'Number of lines from end',
          default: 100
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        // For MCP, we can't truly follow indefinitely
        // Collect logs for a short period
        const result = await streamContainerLogs({
          containerId: args.containerId,
          follow: false, // Don't follow in MCP context
          tail: args.tail || 100
        });
        
        const logAnalysis = analyzeLogsForErrors({ logs: result.logs });
        
        return {
          ...result,
          analysis: logAnalysis
        };
      } catch (error) {
        logger.error('Docker stream logs failed:', error);
        throw new Error(`Stream logs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'analyze_docker_logs',
    description: 'Analyze Docker logs for errors, warnings, and issues. Claude uses this to verify builds/deployments.',
    inputSchema: {
      type: 'object',
      properties: {
        logs: {
          type: 'string',
          description: 'Log content to analyze'
        },
        projectType: {
          type: 'string',
          enum: ['nodejs', 'python', 'go', 'java', 'generic'],
          description: 'Type of project for better analysis',
          default: 'generic'
        }
      },
      required: ['logs']
    },
    handler: async (args) => {
      try {
        const result = analyzeLogsForErrors({
          logs: args.logs,
          projectType: args.projectType || 'generic'
        });
        return result;
      } catch (error) {
        logger.error('Analyze docker logs failed:', error);
        throw new Error(`Log analysis failed: ${error.message}`);
      }
    }
  },

  {
    name: 'docker_wait_healthy',
    description: 'Wait for a container to become healthy (with timeout)',
    inputSchema: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name'
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds',
          default: 60
        },
        interval: {
          type: 'number',
          description: 'Check interval in seconds',
          default: 5
        }
      },
      required: ['containerId']
    },
    handler: async (args) => {
      try {
        const { containerId, timeout = 60, interval = 5 } = args;
        const startTime = Date.now();
        const maxTime = startTime + (timeout * 1000);
        
        while (Date.now() < maxTime) {
          const health = await checkContainerHealth({ containerId });
          
          if (health.healthy) {
            return {
              success: true,
              containerId,
              healthy: true,
              status: health.status,
              waitTime: Math.round((Date.now() - startTime) / 1000),
              message: 'Container is healthy'
            };
          }
          
          if (!health.isRunning) {
            return {
              success: false,
              containerId,
              healthy: false,
              status: 'stopped',
              waitTime: Math.round((Date.now() - startTime) / 1000),
              message: 'Container stopped before becoming healthy'
            };
          }
          
          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
        }
        
        return {
          success: false,
          containerId,
          healthy: false,
          timeout: true,
          waitTime: timeout,
          message: `Container did not become healthy within ${timeout}s`
        };
      } catch (error) {
        logger.error('Docker wait healthy failed:', error);
        throw new Error(`Wait healthy failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all Docker tools
 */
const getTools = () => tools;

module.exports = {
  getTools,
  // Export utility functions for use by other services
  streamContainerLogs,
  dockerBuildWithStreaming,
  dockerRunWithStreaming,
  dockerComposeUpWithStreaming,
  checkContainerHealth,
  analyzeLogsForErrors,
  subscribeToLogs,
  logEmitter
};




