const logger = require('../utils/logger');

/**
 * README Parser Service
 * Parses README content to extract expected files and configurations
 * Uses pattern matching (no LLM calls) for cost optimization
 */
class ReadmeParser {
  /**
   * Parse README to extract expected files
   */
  parseExpectedFiles(readmeContent) {
    const expectedFiles = [];
    const lines = readmeContent.split('\n');
    
    // Patterns to detect file paths
    const filePatterns = [
      // Dockerfile patterns
      /Dockerfile/i,
      /dockerfile/i,
      /\.dockerfile/i,
      // docker-compose patterns
      /docker-compose\.ya?ml/i,
      /docker-compose/i,
      // .dockerignore
      /\.dockerignore/i,
      // Service-specific Dockerfiles
      /([a-zA-Z0-9_-]+)\/Dockerfile/gi,
      /([a-zA-Z0-9_-]+)\/dockerfile/gi
    ];
    
    // Extract file paths from README
    const foundPaths = new Set();
    
    // Look for explicit file mentions
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Check for Dockerfile mentions
      if (/Dockerfile/i.test(line)) {
        // Try to extract path from context
        const pathMatch = line.match(/([a-zA-Z0-9_\-./]+Dockerfile[^,\s]*)/i);
        if (pathMatch) {
          let path = pathMatch[1].trim();
          // Clean up path
          path = path.replace(/[`'"]/g, '').replace(/^\.\//, '');
          if (!foundPaths.has(path)) {
            foundPaths.add(path);
            expectedFiles.push({
              path,
              type: 'dockerfile',
              service: this.extractServiceName(path, lines, i)
            });
          }
        } else {
          // Default Dockerfile locations
          const defaultPaths = ['Dockerfile', 'backend/Dockerfile', 'frontend/Dockerfile'];
          for (const defaultPath of defaultPaths) {
            if (!foundPaths.has(defaultPath)) {
              foundPaths.add(defaultPath);
              expectedFiles.push({
                path: defaultPath,
                type: 'dockerfile',
                service: this.extractServiceName(defaultPath, lines, i)
              });
            }
          }
        }
      }
      
      // Check for docker-compose mentions
      if (/docker-compose/i.test(line)) {
        const composeMatch = line.match(/(docker-compose\.ya?ml)/i);
        if (composeMatch) {
          const path = composeMatch[1];
          if (!foundPaths.has(path)) {
            foundPaths.add(path);
            expectedFiles.push({
              path,
              type: 'docker-compose',
              service: null
            });
          }
        }
      }
      
      // Check for .dockerignore
      if (/\.dockerignore/i.test(line)) {
        const path = '.dockerignore';
        if (!foundPaths.has(path)) {
          foundPaths.add(path);
          expectedFiles.push({
            path,
            type: 'dockerignore',
            service: null
          });
        }
      }
      
      // Check for .env file mentions
      if (/\.env/i.test(line)) {
        const envMatch = line.match(/(\.env[^\s"'`]*)/i);
        if (envMatch) {
          let envPath = envMatch[1].trim();
          // Clean up path (remove quotes, trailing punctuation)
          envPath = envPath.replace(/[`'"]/g, '').replace(/[.,;:!?]+$/, '');
          if (!foundPaths.has(envPath)) {
            foundPaths.add(envPath);
            expectedFiles.push({
              path: envPath,
              type: 'env',
              service: null
            });
          }
        } else {
          // Default .env files if mentioned but no specific path
          const defaultEnvFiles = ['.env', '.env.local', '.env.production'];
          for (const defaultPath of defaultEnvFiles) {
            if (!foundPaths.has(defaultPath)) {
              foundPaths.add(defaultPath);
              expectedFiles.push({
                path: defaultPath,
                type: 'env',
                service: null
              });
            }
          }
        }
      }
    }
    
    // Look for service-specific sections
    const serviceSections = this.extractServiceSections(readmeContent);
    for (const service of serviceSections) {
      // Check if service has Dockerfile mentioned
      if (service.dockerfile) {
        const path = service.dockerfile;
        if (!foundPaths.has(path)) {
          foundPaths.add(path);
          expectedFiles.push({
            path,
            type: 'dockerfile',
            service: service.name
          });
        }
      }
    }
    
    logger.info('Parsed expected files from README', {
      fileCount: expectedFiles.length,
      files: expectedFiles.map(f => f.path)
    });
    
    return expectedFiles;
  }

  /**
   * Parse service configurations from README
   */
  parseServiceConfigurations(readmeContent) {
    const serviceConfigs = {};
    const lines = readmeContent.split('\n');
    
    // Extract service sections
    const serviceSections = this.extractServiceSections(readmeContent);
    
    for (const service of serviceSections) {
      const config = {
        name: service.name,
        entryPoint: null,
        port: null,
        buildContext: null,
        dockerfile: null
      };
      
      // Extract entry point
      const entryPointPatterns = [
        /entry\s+point[:\s]+([^\n]+)/i,
        /entrypoint[:\s]+([^\n]+)/i,
        /CMD\s+\[?["']?([^"'\]]+)["']?\]?/i,
        /main[:\s]+([^\n]+)/i,
        /start[:\s]+([^\n]+)/i
      ];
      
      for (const pattern of entryPointPatterns) {
        const match = service.content.match(pattern);
        if (match) {
          config.entryPoint = match[1].trim().replace(/['"]/g, '');
          break;
        }
      }
      
      // Extract port
      const portPatterns = [
        /port[:\s]+(\d+)/i,
        /PORT[:\s]+(\d+)/i,
        /EXPOSE\s+(\d+)/i,
        /:\s*(\d+)/i
      ];
      
      for (const pattern of portPatterns) {
        const match = service.content.match(pattern);
        if (match) {
          config.port = parseInt(match[1], 10);
          break;
        }
      }
      
      // Extract build context
      const contextPatterns = [
        /build\s+context[:\s]+([^\n]+)/i,
        /context[:\s]+([^\n]+)/i,
        /directory[:\s]+([^\n]+)/i
      ];
      
      for (const pattern of contextPatterns) {
        const match = service.content.match(pattern);
        if (match) {
          let context = match[1].trim().replace(/['"]/g, '');
          // Normalize context path
          if (!context.startsWith('./')) {
            context = `./${context}`;
          }
          config.buildContext = context;
          break;
        }
      }
      
      // Extract Dockerfile path
      const dockerfileMatch = service.content.match(/([a-zA-Z0-9_\-./]+Dockerfile[^,\s]*)/i);
      if (dockerfileMatch) {
        config.dockerfile = dockerfileMatch[1].trim().replace(/[`'"]/g, '');
      }
      
      serviceConfigs[service.name] = config;
    }
    
    logger.info('Parsed service configurations from README', {
      serviceCount: Object.keys(serviceConfigs).length,
      services: Object.keys(serviceConfigs)
    });
    
    return serviceConfigs;
  }

  /**
   * Parse Docker Compose requirements
   */
  parseDockerComposeRequirements(readmeContent) {
    const requirements = {
      services: [],
      networks: [],
      volumes: [],
      dependencies: []
    };
    
    // Extract service names from docker-compose section
    const composeSection = this.extractSection(readmeContent, /docker\s*compose/i);
    if (composeSection) {
      // Look for service names
      const serviceMatches = composeSection.match(/(?:service|services)[:\s]+([^\n]+)/gi);
      if (serviceMatches) {
        for (const match of serviceMatches) {
          const services = match.split(/[,:]/).map(s => s.trim()).filter(s => s);
          requirements.services.push(...services);
        }
      }
      
      // Look for network mentions
      const networkMatches = composeSection.match(/(?:network|networks)[:\s]+([^\n]+)/gi);
      if (networkMatches) {
        for (const match of networkMatches) {
          const networks = match.split(/[,:]/).map(s => s.trim()).filter(s => s);
          requirements.networks.push(...networks);
        }
      }
      
      // Look for volume mentions
      const volumeMatches = composeSection.match(/(?:volume|volumes)[:\s]+([^\n]+)/gi);
      if (volumeMatches) {
        for (const match of volumeMatches) {
          const volumes = match.split(/[,:]/).map(s => s.trim()).filter(s => s);
          requirements.volumes.push(...volumes);
        }
      }
      
      // Look for dependencies
      const depMatches = composeSection.match(/(?:depend|depends\s+on)[:\s]+([^\n]+)/gi);
      if (depMatches) {
        for (const match of depMatches) {
          const deps = match.split(/[,:]/).map(s => s.trim()).filter(s => s);
          requirements.dependencies.push(...deps);
        }
      }
    }
    
    return requirements;
  }

  /**
   * Extract service sections from README
   */
  extractServiceSections(readmeContent) {
    const services = [];
    const lines = readmeContent.split('\n');
    
    let currentService = null;
    let inServiceSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Detect service section headers
      const serviceHeaderMatch = line.match(/^##?\s+Service[:\s]+([^\n]+)/i) ||
                                 line.match(/^##?\s+([a-zA-Z0-9_-]+)\s*$/);
      
      if (serviceHeaderMatch) {
        // Save previous service
        if (currentService) {
          services.push(currentService);
        }
        
        // Start new service
        const serviceName = serviceHeaderMatch[1].trim();
        currentService = {
          name: serviceName,
          content: '',
          startLine: i
        };
        inServiceSection = true;
        continue;
      }
      
      // Detect end of service section (next ## header or end of file)
      if (inServiceSection && line.match(/^##/)) {
        if (currentService) {
          services.push(currentService);
          currentService = null;
        }
        inServiceSection = false;
        continue;
      }
      
      // Add content to current service
      if (inServiceSection && currentService) {
        currentService.content += line + '\n';
      }
    }
    
    // Add last service
    if (currentService) {
      services.push(currentService);
    }
    
    return services;
  }

  /**
   * Extract section from README
   */
  extractSection(readmeContent, pattern) {
    const lines = readmeContent.split('\n');
    let inSection = false;
    let sectionContent = '';
    
    for (const line of lines) {
      if (pattern.test(line)) {
        inSection = true;
        continue;
      }
      
      if (inSection) {
        // Stop at next major section
        if (line.match(/^##\s/)) {
          break;
        }
        sectionContent += line + '\n';
      }
    }
    
    return sectionContent.trim();
  }

  /**
   * Extract service name from path or context
   */
  extractServiceName(path, lines, lineIndex) {
    // Try to extract from path
    const pathMatch = path.match(/([a-zA-Z0-9_-]+)\/Dockerfile/i);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    // Try to extract from surrounding context
    const contextStart = Math.max(0, lineIndex - 5);
    const contextEnd = Math.min(lines.length, lineIndex + 5);
    const context = lines.slice(contextStart, contextEnd).join('\n');
    
    const serviceMatch = context.match(/(?:service|Service)[:\s]+([a-zA-Z0-9_-]+)/i);
    if (serviceMatch) {
      return serviceMatch[1];
    }
    
    return null;
  }

  /**
   * Parse all requirements from README
   */
  parseAllRequirements(readmeContent) {
    return {
      expectedFiles: this.parseExpectedFiles(readmeContent),
      serviceConfigs: this.parseServiceConfigurations(readmeContent),
      dockerComposeRequirements: this.parseDockerComposeRequirements(readmeContent)
    };
  }
}

module.exports = new ReadmeParser();

