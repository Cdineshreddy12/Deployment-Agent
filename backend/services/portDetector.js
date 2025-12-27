const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

/**
 * Port Detector Service
 * Detects application ports from various project files
 */
class PortDetector {
  constructor() {
    this.defaultPorts = {
      frontend: 3000,
      backend: 5000,
      api: 8080,
      database: {
        postgres: 5432,
        postgresql: 5432,
        mysql: 3306,
        mariadb: 3306,
        mongodb: 27017,
        mongo: 27017,
        redis: 6379,
        elasticsearch: 9200,
        cassandra: 9042
      }
    };
  }

  /**
   * Detect ports from a project directory
   * @param {string} projectPath - Path to the project
   * @returns {Object} - Detected ports by service
   */
  async detectPorts(projectPath) {
    const ports = {};
    
    try {
      // Check package.json scripts
      const packageJsonPorts = await this.parsePackageJson(projectPath);
      Object.assign(ports, packageJsonPorts);
      
      // Check Dockerfile EXPOSE directives
      const dockerPorts = await this.parseDockerfile(projectPath);
      Object.assign(ports, dockerPorts);
      
      // Check docker-compose.yml port mappings
      const composePorts = await this.parseDockerCompose(projectPath);
      Object.assign(ports, composePorts);
      
      // Check .env files for PORT variables
      const envPorts = await this.parseEnvFiles(projectPath);
      Object.assign(ports, envPorts);
      
      // Check common config files
      const configPorts = await this.parseConfigFiles(projectPath);
      Object.assign(ports, configPorts);
      
    } catch (error) {
      logger.warn('Port detection error:', error);
    }
    
    return ports;
  }

  /**
   * Parse package.json for port information
   */
  async parsePackageJson(projectPath) {
    const ports = {};
    
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);
      
      // Check scripts for port patterns
      if (pkg.scripts) {
        for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
          const detectedPort = this.extractPortFromString(scriptCmd);
          if (detectedPort) {
            const serviceType = this.guessServiceType(scriptName, pkg);
            ports[serviceType] = detectedPort;
          }
        }
      }
      
      // Check for PORT in config
      if (pkg.config?.port) {
        ports.main = parseInt(pkg.config.port, 10);
      }
      
      // Check engines/dependencies for framework-specific defaults
      if (pkg.dependencies) {
        if (pkg.dependencies.next) {
          ports.frontend = ports.frontend || 3000;
        }
        if (pkg.dependencies.nuxt || pkg.dependencies['@nuxt/core']) {
          ports.frontend = ports.frontend || 3000;
        }
        if (pkg.dependencies.vite) {
          ports.frontend = ports.frontend || 5173;
        }
        if (pkg.dependencies.gatsby) {
          ports.frontend = ports.frontend || 8000;
        }
        if (pkg.dependencies.express || pkg.dependencies.fastify || pkg.dependencies['@nestjs/core']) {
          ports.backend = ports.backend || 3000;
        }
      }
      
    } catch (error) {
      // File doesn't exist or parse error - skip
    }
    
    return ports;
  }

  /**
   * Parse Dockerfile for EXPOSE directives
   */
  async parseDockerfile(projectPath) {
    const ports = {};
    const dockerFiles = ['Dockerfile', 'Dockerfile.dev', 'Dockerfile.prod'];
    
    for (const dockerFile of dockerFiles) {
      try {
        const dockerPath = path.join(projectPath, dockerFile);
        const content = await fs.readFile(dockerPath, 'utf-8');
        
        // Match EXPOSE directives
        const exposeMatches = content.matchAll(/EXPOSE\s+(\d+)(?:\/(?:tcp|udp))?/gi);
        for (const match of exposeMatches) {
          const port = parseInt(match[1], 10);
          if (port) {
            // Use filename suffix to determine service type
            const suffix = dockerFile.replace('Dockerfile', '').replace('.', '');
            const serviceType = suffix || 'main';
            ports[serviceType] = port;
          }
        }
        
        // Also check for ENV PORT=
        const envPortMatch = content.match(/ENV\s+PORT[=\s]+(\d+)/i);
        if (envPortMatch) {
          ports.main = parseInt(envPortMatch[1], 10);
        }
        
      } catch (error) {
        // File doesn't exist - skip
      }
    }
    
    return ports;
  }

  /**
   * Parse docker-compose.yml for port mappings
   */
  async parseDockerCompose(projectPath) {
    const ports = {};
    const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
    
    for (const composeFile of composeFiles) {
      try {
        const composePath = path.join(projectPath, composeFile);
        const content = await fs.readFile(composePath, 'utf-8');
        
        // Simple YAML parsing for ports
        // Match patterns like "- 3000:3000" or "- '8080:80'"
        const lines = content.split('\n');
        let currentService = null;
        
        for (const line of lines) {
          // Detect service names
          const serviceMatch = line.match(/^  (\w[\w-]*):$/);
          if (serviceMatch) {
            currentService = serviceMatch[1];
            continue;
          }
          
          // Detect port mappings
          const portMatch = line.match(/["']?(\d+):(\d+)["']?/);
          if (portMatch && currentService) {
            const hostPort = parseInt(portMatch[1], 10);
            const containerPort = parseInt(portMatch[2], 10);
            
            ports[currentService] = {
              host: hostPort,
              container: containerPort,
              port: hostPort // Use host port as the accessible port
            };
          }
        }
        
      } catch (error) {
        // File doesn't exist - skip
      }
    }
    
    return ports;
  }

  /**
   * Parse .env files for PORT variables
   */
  async parseEnvFiles(projectPath) {
    const ports = {};
    const envFiles = ['.env', '.env.local', '.env.development', '.env.example', 'env.template'];
    
    for (const envFile of envFiles) {
      try {
        const envPath = path.join(projectPath, envFile);
        const content = await fs.readFile(envPath, 'utf-8');
        
        // Match PORT=number patterns
        const portMatch = content.match(/^PORT[=:]?\s*(\d+)/m);
        if (portMatch) {
          ports.main = parseInt(portMatch[1], 10);
        }
        
        // Match service-specific ports
        const servicePortMatches = content.matchAll(/^(\w+)_PORT[=:]?\s*(\d+)/gm);
        for (const match of servicePortMatches) {
          const serviceName = match[1].toLowerCase();
          const port = parseInt(match[2], 10);
          ports[serviceName] = port;
        }
        
        // Match common port variables
        const commonPortVars = ['API_PORT', 'SERVER_PORT', 'APP_PORT', 'HTTP_PORT', 'BACKEND_PORT', 'FRONTEND_PORT'];
        for (const varName of commonPortVars) {
          const regex = new RegExp(`^${varName}[=:]?\\s*(\\d+)`, 'm');
          const match = content.match(regex);
          if (match) {
            const serviceName = varName.replace('_PORT', '').toLowerCase();
            ports[serviceName] = parseInt(match[1], 10);
          }
        }
        
      } catch (error) {
        // File doesn't exist - skip
      }
    }
    
    return ports;
  }

  /**
   * Parse common config files for port settings
   */
  async parseConfigFiles(projectPath) {
    const ports = {};
    
    // Check vite.config.js
    try {
      const vitePath = path.join(projectPath, 'vite.config.js');
      const content = await fs.readFile(vitePath, 'utf-8');
      const portMatch = content.match(/port\s*:\s*(\d+)/);
      if (portMatch) {
        ports.frontend = parseInt(portMatch[1], 10);
      }
    } catch (error) {}
    
    // Check next.config.js
    try {
      const nextPath = path.join(projectPath, 'next.config.js');
      const content = await fs.readFile(nextPath, 'utf-8');
      const portMatch = content.match(/port\s*:\s*(\d+)/);
      if (portMatch) {
        ports.frontend = parseInt(portMatch[1], 10);
      }
    } catch (error) {}
    
    // Check angular.json
    try {
      const angularPath = path.join(projectPath, 'angular.json');
      const content = await fs.readFile(angularPath, 'utf-8');
      const config = JSON.parse(content);
      const port = config?.projects?.[Object.keys(config.projects)[0]]?.architect?.serve?.options?.port;
      if (port) {
        ports.frontend = port;
      }
    } catch (error) {}
    
    // Check server config files
    const serverConfigs = ['server.js', 'app.js', 'index.js', 'src/index.js', 'src/server.js', 'src/app.js'];
    for (const configFile of serverConfigs) {
      try {
        const configPath = path.join(projectPath, configFile);
        const content = await fs.readFile(configPath, 'utf-8');
        
        // Match common port patterns
        const patterns = [
          /\.listen\s*\(\s*(\d+)/,
          /port\s*[=:]\s*(\d+)/i,
          /PORT\s*\|\|\s*(\d+)/,
          /process\.env\.PORT\s*\|\|\s*(\d+)/
        ];
        
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match) {
            ports.backend = parseInt(match[1], 10);
            break;
          }
        }
      } catch (error) {}
    }
    
    return ports;
  }

  /**
   * Extract port from a command string
   */
  extractPortFromString(str) {
    // Match patterns like: --port 3000, -p 3000, PORT=3000, :3000
    const patterns = [
      /--port[=\s]+(\d+)/i,
      /-p[=\s]+(\d+)/,
      /PORT[=:]+(\d+)/i,
      /:(\d{4,5})(?:\s|$|")/,
      /localhost:(\d+)/
    ];
    
    for (const pattern of patterns) {
      const match = str.match(pattern);
      if (match) {
        return parseInt(match[1], 10);
      }
    }
    
    return null;
  }

  /**
   * Guess service type from script name and package info
   */
  guessServiceType(scriptName, pkg) {
    const name = scriptName.toLowerCase();
    
    if (name.includes('frontend') || name.includes('client') || name.includes('web')) {
      return 'frontend';
    }
    if (name.includes('backend') || name.includes('server') || name.includes('api')) {
      return 'backend';
    }
    if (name === 'start' || name === 'dev' || name === 'serve') {
      // Check package type
      if (pkg.dependencies?.react || pkg.dependencies?.vue || pkg.dependencies?.['@angular/core']) {
        return 'frontend';
      }
      if (pkg.dependencies?.express || pkg.dependencies?.fastify) {
        return 'backend';
      }
    }
    
    return 'main';
  }

  /**
   * Detect ports from file contents (for GitHub repos)
   * @param {Object} files - Map of filePath to content
   * @returns {Object} - Detected ports by service
   */
  async detectPortsFromContent(files) {
    const ports = {};
    
    // Process package.json
    if (files['package.json']) {
      try {
        const pkg = JSON.parse(files['package.json']);
        if (pkg.scripts) {
          for (const [scriptName, scriptCmd] of Object.entries(pkg.scripts)) {
            const detectedPort = this.extractPortFromString(scriptCmd);
            if (detectedPort) {
              const serviceType = this.guessServiceType(scriptName, pkg);
              ports[serviceType] = detectedPort;
            }
          }
        }
      } catch (error) {}
    }
    
    // Process Dockerfile
    if (files['Dockerfile']) {
      const content = files['Dockerfile'];
      const exposeMatches = content.matchAll(/EXPOSE\s+(\d+)/gi);
      for (const match of exposeMatches) {
        ports.main = parseInt(match[1], 10);
      }
    }
    
    // Process docker-compose.yml
    const composeContent = files['docker-compose.yml'] || files['docker-compose.yaml'];
    if (composeContent) {
      const lines = composeContent.split('\n');
      let currentService = null;
      
      for (const line of lines) {
        const serviceMatch = line.match(/^  (\w[\w-]*):$/);
        if (serviceMatch) {
          currentService = serviceMatch[1];
          continue;
        }
        
        const portMatch = line.match(/["']?(\d+):(\d+)["']?/);
        if (portMatch && currentService) {
          ports[currentService] = parseInt(portMatch[1], 10);
        }
      }
    }
    
    // Process .env
    const envContent = files['.env'] || files['.env.example'];
    if (envContent) {
      const portMatch = envContent.match(/^PORT[=:]?\s*(\d+)/m);
      if (portMatch) {
        ports.main = parseInt(portMatch[1], 10);
      }
    }
    
    return ports;
  }
}

module.exports = new PortDetector();

