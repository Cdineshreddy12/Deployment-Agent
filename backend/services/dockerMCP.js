const Docker = require('dockerode');
const logger = require('../utils/logger');

/**
 * Docker MCP Client Service
 * Provides Docker operations as MCP tools for Cursor AI integration
 */
class DockerMCPService {
  constructor() {
    this.docker = null;
    this.connected = false;
    this.operationHistory = [];
  }

  /**
   * Initialize Docker client
   */
  async initialize() {
    try {
      this.docker = new Docker({
        socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
      });

      // Test connection
      await this.docker.ping();
      this.connected = true;
      logger.info('Docker MCP client connected successfully');

      return true;
    } catch (error) {
      logger.warn('Docker not available:', error.message);
      this.connected = false;
      return false;
    }
  }

  /**
   * Check if Docker is available
   */
  isAvailable() {
    return this.connected;
  }

  /**
   * Build a Docker image
   * @param {Object} options - Build options
   * @returns {Promise<Object>} - Build result
   */
  async buildImage(options) {
    const { contextPath, dockerfile = 'Dockerfile', tags = [], buildArgs = {} } = options;
    const startTime = Date.now();

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    try {
      logger.info(`Building Docker image from ${contextPath}`);

      const stream = await this.docker.buildImage({
        context: contextPath,
        src: [dockerfile, '.']
      }, {
        t: tags,
        buildargs: buildArgs
      });

      // Wait for build to complete
      const result = await new Promise((resolve, reject) => {
        let output = '';
        let imageId = null;

        stream.on('data', (chunk) => {
          const data = JSON.parse(chunk.toString());
          if (data.stream) {
            output += data.stream;
            // Extract image ID from build output
            const match = data.stream.match(/Successfully built ([a-f0-9]+)/);
            if (match) {
              imageId = match[1];
            }
          }
          if (data.error) {
            reject(new Error(data.error));
          }
        });

        stream.on('end', () => {
          resolve({ output, imageId });
        });

        stream.on('error', reject);
      });

      const duration = Date.now() - startTime;
      this.recordOperation('build', duration, true);

      return {
        success: true,
        imageId: result.imageId,
        tags,
        duration,
        output: result.output
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('build', duration, false);
      logger.error('Docker build failed:', error);
      throw error;
    }
  }

  /**
   * Run a Docker container
   * @param {Object} options - Run options
   * @returns {Promise<Object>} - Container info
   */
  async runContainer(options) {
    const {
      image,
      name,
      ports = {},
      env = [],
      volumes = [],
      network,
      command,
      detach = true
    } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      logger.info(`Running Docker container from image ${image}`);

      // Create port bindings
      const exposedPorts = {};
      const portBindings = {};
      Object.entries(ports).forEach(([containerPort, hostPort]) => {
        exposedPorts[`${containerPort}/tcp`] = {};
        portBindings[`${containerPort}/tcp`] = [{ HostPort: hostPort.toString() }];
      });

      // Create volume bindings
      const binds = volumes.map(v => {
        if (typeof v === 'string') return v;
        return `${v.host}:${v.container}${v.mode ? ':' + v.mode : ''}`;
      });

      // Create container
      const container = await this.docker.createContainer({
        Image: image,
        name,
        Env: env,
        Cmd: command ? command.split(' ') : undefined,
        ExposedPorts: exposedPorts,
        HostConfig: {
          PortBindings: portBindings,
          Binds: binds,
          NetworkMode: network
        }
      });

      // Start container
      await container.start();

      const info = await container.inspect();
      const duration = Date.now() - startTime;
      this.recordOperation('run', duration, true);

      return {
        success: true,
        containerId: container.id,
        name: info.Name,
        state: info.State.Status,
        ports: info.NetworkSettings.Ports,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('run', duration, false);
      logger.error('Docker run failed:', error);
      throw error;
    }
  }

  /**
   * Execute docker-compose up
   * @param {Object} options - Compose options
   * @returns {Promise<Object>} - Result
   */
  async composeUp(options) {
    const { projectPath, projectName, services = [], detach = true, build = false } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      logger.info(`Running docker-compose up in ${projectPath}`);

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let cmd = 'docker-compose';
      if (projectName) cmd += ` -p ${projectName}`;
      cmd += ' up';
      if (detach) cmd += ' -d';
      if (build) cmd += ' --build';
      if (services.length > 0) cmd += ` ${services.join(' ')}`;

      const { stdout, stderr } = await execAsync(cmd, { cwd: projectPath });

      const duration = Date.now() - startTime;
      this.recordOperation('compose_up', duration, true);

      return {
        success: true,
        output: stdout,
        warnings: stderr,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('compose_up', duration, false);
      logger.error('Docker compose up failed:', error);
      throw error;
    }
  }

  /**
   * Execute docker-compose down
   * @param {Object} options - Compose options
   * @returns {Promise<Object>} - Result
   */
  async composeDown(options) {
    const { projectPath, projectName, removeVolumes = false, removeImages = false } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      logger.info(`Running docker-compose down in ${projectPath}`);

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let cmd = 'docker-compose';
      if (projectName) cmd += ` -p ${projectName}`;
      cmd += ' down';
      if (removeVolumes) cmd += ' -v';
      if (removeImages) cmd += ' --rmi all';

      const { stdout, stderr } = await execAsync(cmd, { cwd: projectPath });

      const duration = Date.now() - startTime;
      this.recordOperation('compose_down', duration, true);

      return {
        success: true,
        output: stdout,
        warnings: stderr,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('compose_down', duration, false);
      logger.error('Docker compose down failed:', error);
      throw error;
    }
  }

  /**
   * List running containers
   * @param {Object} options - List options
   * @returns {Promise<Array>} - Container list
   */
  async listContainers(options = {}) {
    const { all = false, filters = {} } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    try {
      const containers = await this.docker.listContainers({ all, filters });

      return containers.map(c => ({
        id: c.Id.substring(0, 12),
        names: c.Names.map(n => n.replace(/^\//, '')),
        image: c.Image,
        state: c.State,
        status: c.Status,
        ports: c.Ports.map(p => `${p.PublicPort || ''}:${p.PrivatePort}/${p.Type}`).filter(Boolean),
        created: new Date(c.Created * 1000).toISOString()
      }));

    } catch (error) {
      logger.error('Docker list containers failed:', error);
      throw error;
    }
  }

  /**
   * Inspect a container
   * @param {string} containerId - Container ID or name
   * @returns {Promise<Object>} - Container details
   */
  async inspectContainer(containerId) {
    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    try {
      const container = this.docker.getContainer(containerId);
      const info = await container.inspect();

      return {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        image: info.Config.Image,
        state: info.State,
        config: {
          env: info.Config.Env,
          cmd: info.Config.Cmd,
          workdir: info.Config.WorkingDir
        },
        network: info.NetworkSettings,
        mounts: info.Mounts
      };

    } catch (error) {
      logger.error('Docker inspect failed:', error);
      throw error;
    }
  }

  /**
   * Get container logs
   * @param {string} containerId - Container ID or name
   * @param {Object} options - Log options
   * @returns {Promise<string>} - Logs
   */
  async getContainerLogs(containerId, options = {}) {
    const { tail = 100, timestamps = true, since } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    try {
      const container = this.docker.getContainer(containerId);
      
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps,
        since: since ? Math.floor(new Date(since).getTime() / 1000) : undefined
      });

      // Convert buffer to string and clean up
      return logs.toString('utf8')
        .split('\n')
        .map(line => line.substring(8)) // Remove docker log prefix
        .filter(line => line.trim())
        .join('\n');

    } catch (error) {
      logger.error('Docker logs failed:', error);
      throw error;
    }
  }

  /**
   * Stop a container
   * @param {string} containerId - Container ID or name
   * @param {Object} options - Stop options
   * @returns {Promise<Object>} - Result
   */
  async stopContainer(containerId, options = {}) {
    const { timeout = 10 } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: timeout });

      const duration = Date.now() - startTime;
      this.recordOperation('stop', duration, true);

      return {
        success: true,
        containerId,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('stop', duration, false);
      logger.error('Docker stop failed:', error);
      throw error;
    }
  }

  /**
   * Remove a container
   * @param {string} containerId - Container ID or name
   * @param {Object} options - Remove options
   * @returns {Promise<Object>} - Result
   */
  async removeContainer(containerId, options = {}) {
    const { force = false, removeVolumes = false } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force, v: removeVolumes });

      const duration = Date.now() - startTime;
      this.recordOperation('remove', duration, true);

      return {
        success: true,
        containerId,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('remove', duration, false);
      logger.error('Docker remove failed:', error);
      throw error;
    }
  }

  /**
   * List Docker images
   * @param {Object} options - List options
   * @returns {Promise<Array>} - Image list
   */
  async listImages(options = {}) {
    const { filters = {} } = options;

    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    try {
      const images = await this.docker.listImages({ filters });

      return images.map(img => ({
        id: img.Id.replace('sha256:', '').substring(0, 12),
        tags: img.RepoTags || [],
        size: Math.round(img.Size / 1024 / 1024) + 'MB',
        created: new Date(img.Created * 1000).toISOString()
      }));

    } catch (error) {
      logger.error('Docker list images failed:', error);
      throw error;
    }
  }

  /**
   * Pull a Docker image
   * @param {string} imageName - Image name with tag
   * @returns {Promise<Object>} - Result
   */
  async pullImage(imageName) {
    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      logger.info(`Pulling Docker image: ${imageName}`);

      const stream = await this.docker.pull(imageName);

      // Wait for pull to complete
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) reject(err);
          else resolve(output);
        });
      });

      const duration = Date.now() - startTime;
      this.recordOperation('pull', duration, true);

      return {
        success: true,
        image: imageName,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('pull', duration, false);
      logger.error('Docker pull failed:', error);
      throw error;
    }
  }

  /**
   * Push a Docker image
   * @param {string} imageName - Image name with tag
   * @param {Object} authConfig - Authentication config
   * @returns {Promise<Object>} - Result
   */
  async pushImage(imageName, authConfig = {}) {
    if (!this.connected) {
      throw new Error('Docker is not available');
    }

    const startTime = Date.now();

    try {
      logger.info(`Pushing Docker image: ${imageName}`);

      const image = this.docker.getImage(imageName);
      const stream = await image.push({ authconfig: authConfig });

      // Wait for push to complete
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) reject(err);
          else resolve(output);
        });
      });

      const duration = Date.now() - startTime;
      this.recordOperation('push', duration, true);

      return {
        success: true,
        image: imageName,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordOperation('push', duration, false);
      logger.error('Docker push failed:', error);
      throw error;
    }
  }

  /**
   * Record operation for metrics
   */
  recordOperation(operation, duration, success) {
    this.operationHistory.push({
      operation,
      duration,
      success,
      timestamp: new Date()
    });

    // Keep only last 100 operations
    if (this.operationHistory.length > 100) {
      this.operationHistory = this.operationHistory.slice(-100);
    }
  }

  /**
   * Get service statistics
   */
  getStats() {
    const operations = {};
    
    this.operationHistory.forEach(op => {
      if (!operations[op.operation]) {
        operations[op.operation] = { total: 0, success: 0, failed: 0, totalDuration: 0 };
      }
      operations[op.operation].total++;
      if (op.success) operations[op.operation].success++;
      else operations[op.operation].failed++;
      operations[op.operation].totalDuration += op.duration;
    });

    Object.keys(operations).forEach(key => {
      operations[key].avgDuration = operations[key].totalDuration / operations[key].total;
    });

    return {
      connected: this.connected,
      operations,
      recentOperations: this.operationHistory.slice(-10)
    };
  }
}

// Singleton instance
const dockerMCPService = new DockerMCPService();

module.exports = dockerMCPService;





