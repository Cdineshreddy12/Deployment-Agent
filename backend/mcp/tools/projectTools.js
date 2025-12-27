const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const fileTools = require('./fileTools');

/**
 * Project Analysis MCP Tools
 * Analyzes project structure, detects services, frameworks, and missing files
 */

/**
 * Analyze a project directory
 */
async function analyzeProject({ projectPath }) {
  try {
    const absolutePath = path.resolve(projectPath);
    
    // Verify path exists
    if (!fsSync.existsSync(absolutePath)) {
      return {
        success: false,
        error: `Project path not found: ${absolutePath}`
      };
    }
    
    // Get file listing
    const fileList = await fileTools.listFiles({ projectPath: absolutePath, recursive: true });
    if (!fileList.success) {
      return fileList;
    }
    
    // Detect project type and framework
    const projectType = await detectProjectType(absolutePath, fileList.files);
    
    // Detect services (monorepo, microservices, etc.)
    const services = await detectServices({ projectPath: absolutePath });
    
    // Detect missing infrastructure files
    const missingFiles = await detectMissingFiles({ projectPath: absolutePath });
    
    // Parse environment files
    const envStatus = await analyzeEnvFiles(absolutePath);
    
    // Get package info if available
    const packageInfo = await parsePackageJson({ projectPath: absolutePath });
    
    // Detect frameworks
    const framework = await detectFramework({ projectPath: absolutePath });
    
    return {
      success: true,
      projectPath: absolutePath,
      projectType,
      framework: framework.framework,
      services: services.services,
      structure: {
        totalFiles: fileList.totalFiles,
        totalDirectories: fileList.totalDirectories,
        tree: fileList.tree
      },
      envStatus,
      missingFiles: missingFiles.missingFiles,
      packageInfo: packageInfo.success ? packageInfo.packageJson : null,
      recommendations: generateRecommendations(projectType, missingFiles.missingFiles, envStatus),
      analyzedAt: new Date().toISOString()
    };
    
  } catch (error) {
    logger.error('analyzeProject failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Detect project type based on files
 */
async function detectProjectType(projectPath, files) {
  const fileNames = files.map(f => f.name);
  const filePaths = files.map(f => f.path);
  
  const projectType = {
    language: 'unknown',
    runtime: null,
    buildTool: null,
    isMonorepo: false
  };
  
  // Detect by package/config files
  if (fileNames.includes('package.json')) {
    projectType.language = 'javascript';
    projectType.runtime = 'node';
    
    // Check for TypeScript
    if (fileNames.includes('tsconfig.json')) {
      projectType.language = 'typescript';
    }
    
    // Check for build tools
    if (fileNames.includes('vite.config.js') || fileNames.includes('vite.config.ts')) {
      projectType.buildTool = 'vite';
    } else if (fileNames.includes('webpack.config.js')) {
      projectType.buildTool = 'webpack';
    } else if (fileNames.includes('next.config.js') || fileNames.includes('next.config.mjs')) {
      projectType.buildTool = 'next';
    }
  }
  
  if (fileNames.includes('requirements.txt') || fileNames.includes('Pipfile') || fileNames.includes('pyproject.toml')) {
    projectType.language = 'python';
    projectType.runtime = 'python';
  }
  
  if (fileNames.includes('go.mod')) {
    projectType.language = 'go';
    projectType.runtime = 'go';
  }
  
  if (fileNames.includes('pom.xml')) {
    projectType.language = 'java';
    projectType.runtime = 'jvm';
    projectType.buildTool = 'maven';
  }
  
  if (fileNames.includes('build.gradle') || fileNames.includes('build.gradle.kts')) {
    projectType.language = 'java';
    projectType.runtime = 'jvm';
    projectType.buildTool = 'gradle';
  }
  
  if (fileNames.includes('Cargo.toml')) {
    projectType.language = 'rust';
    projectType.runtime = 'rust';
  }
  
  // Check for monorepo patterns
  const hasLernaJson = fileNames.includes('lerna.json');
  const hasPnpmWorkspace = fileNames.includes('pnpm-workspace.yaml');
  const hasWorkspaces = filePaths.some(p => p.includes('packages/') || p.includes('apps/'));
  const hasMultiplePackageJson = filePaths.filter(p => p.endsWith('package.json')).length > 1;
  
  if (hasLernaJson || hasPnpmWorkspace || (hasWorkspaces && hasMultiplePackageJson)) {
    projectType.isMonorepo = true;
  }
  
  return projectType;
}

/**
 * Directories to ignore during recursive scanning
 */
const IGNORE_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'output',
  '.next',
  '.nuxt',
  'coverage',
  '__tests__',
  '__mocks__',
  'test',
  'tests',
  '.cache',
  '.temp',
  '.tmp',
  'vendor',
  'venv',
  '.venv',
  'env',
  '.env',
  '__pycache__',
  '.pytest_cache',
  'target', // Rust/Java
  'bin',
  'obj',
  '.idea',
  '.vscode'
]);

/**
 * Check if a directory should be ignored during scanning
 */
function shouldIgnoreDirectory(dirName) {
  return IGNORE_DIRECTORIES.has(dirName) || dirName.startsWith('.');
}

/**
 * Analyze a single service directory and extract metadata
 */
async function analyzeServiceDirectory(fullPath, relativePath) {
  const service = {
    name: path.basename(relativePath),
    path: relativePath,
    type: 'microservice',
    framework: null,
    port: null,
    hasDockerfile: fsSync.existsSync(path.join(fullPath, 'Dockerfile')),
    hasDockerCompose: fsSync.existsSync(path.join(fullPath, 'docker-compose.yml')) || 
                      fsSync.existsSync(path.join(fullPath, 'docker-compose.yaml')),
    depth: relativePath.split('/').length
  };

  // Check for Node.js service
  const packageJsonPath = path.join(fullPath, 'package.json');
  if (fsSync.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      service.name = pkg.name || service.name;
      
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Detect framework and type
      if (deps['next']) {
        service.framework = 'Next.js';
        service.type = 'fullstack';
        service.port = 3000;
      } else if (deps['nuxt']) {
        service.framework = 'Nuxt.js';
        service.type = 'fullstack';
        service.port = 3000;
      } else if (deps['react'] && !deps['express']) {
        service.framework = 'React';
        service.type = 'frontend';
        service.port = 3000;
      } else if (deps['vue'] && !deps['express']) {
        service.framework = 'Vue';
        service.type = 'frontend';
        service.port = 3000;
      } else if (deps['@angular/core']) {
        service.framework = 'Angular';
        service.type = 'frontend';
        service.port = 4200;
      } else if (deps['svelte']) {
        service.framework = 'Svelte';
        service.type = 'frontend';
        service.port = 5000;
      } else if (deps['express']) {
        service.framework = 'Express';
        service.type = 'backend';
        service.port = 3000;
      } else if (deps['fastify']) {
        service.framework = 'Fastify';
        service.type = 'backend';
        service.port = 3000;
      } else if (deps['koa']) {
        service.framework = 'Koa';
        service.type = 'backend';
        service.port = 3000;
      } else if (deps['nestjs'] || deps['@nestjs/core']) {
        service.framework = 'NestJS';
        service.type = 'backend';
        service.port = 3000;
      } else if (deps['hapi'] || deps['@hapi/hapi']) {
        service.framework = 'Hapi';
        service.type = 'backend';
        service.port = 3000;
      }
      
      // Try to extract port from scripts
      if (pkg.scripts) {
        const scripts = JSON.stringify(pkg.scripts);
        const portMatch = scripts.match(/PORT[=:](\d+)|--port[=\s](\d+)|-p[=\s](\d+)/i);
        if (portMatch) {
          service.port = parseInt(portMatch[1] || portMatch[2] || portMatch[3]);
        }
      }
      
      // Detect package manager
      service.packageManager = fsSync.existsSync(path.join(fullPath, 'pnpm-lock.yaml')) ? 'pnpm' :
                               fsSync.existsSync(path.join(fullPath, 'yarn.lock')) ? 'yarn' : 'npm';
                               
    } catch (e) {
      logger.warn(`Failed to parse package.json at ${fullPath}:`, e.message);
    }
  }
  
  // Check for Python service
  const requirementsPath = path.join(fullPath, 'requirements.txt');
  const pyprojectPath = path.join(fullPath, 'pyproject.toml');
  if (fsSync.existsSync(requirementsPath) || fsSync.existsSync(pyprojectPath)) {
    service.framework = 'Python';
    service.type = 'backend';
    service.port = service.port || 8000;
    
    // Check for common Python frameworks
    try {
      let content = '';
      if (fsSync.existsSync(requirementsPath)) {
        content = await fs.readFile(requirementsPath, 'utf8');
      }
      if (content.includes('flask')) service.framework = 'Flask';
      else if (content.includes('django')) service.framework = 'Django';
      else if (content.includes('fastapi')) service.framework = 'FastAPI';
    } catch (e) {}
  }
  
  // Check for Go service
  const goModPath = path.join(fullPath, 'go.mod');
  if (fsSync.existsSync(goModPath)) {
    service.framework = 'Go';
    service.type = 'backend';
    service.port = service.port || 8080;
  }
  
  // Check for Rust service
  const cargoPath = path.join(fullPath, 'Cargo.toml');
  if (fsSync.existsSync(cargoPath)) {
    service.framework = 'Rust';
    service.type = 'backend';
    service.port = service.port || 8080;
  }
  
  // Check for Java service
  const pomPath = path.join(fullPath, 'pom.xml');
  const gradlePath = path.join(fullPath, 'build.gradle');
  if (fsSync.existsSync(pomPath) || fsSync.existsSync(gradlePath)) {
    service.framework = 'Java';
    service.type = 'backend';
    service.port = service.port || 8080;
  }
  
  // Try to extract port from Dockerfile
  if (service.hasDockerfile && !service.port) {
    try {
      const dockerfileContent = await fs.readFile(path.join(fullPath, 'Dockerfile'), 'utf8');
      const exposeMatch = dockerfileContent.match(/EXPOSE\s+(\d+)/i);
      if (exposeMatch) {
        service.port = parseInt(exposeMatch[1]);
      }
    } catch (e) {}
  }
  
  return service;
}

/**
 * Recursively scan for services at any depth
 */
async function scanForServices(basePath, relativePath = '', depth = 0, maxDepth = 6) {
  const services = [];
  
  if (depth > maxDepth) return services;
  
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (shouldIgnoreDirectory(entry.name)) continue;
      
      const fullPath = path.join(basePath, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      // Check for service indicators
      const hasPackageJson = fsSync.existsSync(path.join(fullPath, 'package.json'));
      const hasRequirements = fsSync.existsSync(path.join(fullPath, 'requirements.txt'));
      const hasPyproject = fsSync.existsSync(path.join(fullPath, 'pyproject.toml'));
      const hasGoMod = fsSync.existsSync(path.join(fullPath, 'go.mod'));
      const hasCargoToml = fsSync.existsSync(path.join(fullPath, 'Cargo.toml'));
      const hasPomXml = fsSync.existsSync(path.join(fullPath, 'pom.xml'));
      const hasBuildGradle = fsSync.existsSync(path.join(fullPath, 'build.gradle'));
      const hasDockerfile = fsSync.existsSync(path.join(fullPath, 'Dockerfile'));
      
      const isService = hasPackageJson || hasRequirements || hasPyproject || hasGoMod || 
                        hasCargoToml || hasPomXml || hasBuildGradle || hasDockerfile;
      
      if (isService) {
        const service = await analyzeServiceDirectory(fullPath, relPath);
        services.push(service);
      }
      
      // Always recurse into subdirectories to find deeply nested services
      const nestedServices = await scanForServices(fullPath, relPath, depth + 1, maxDepth);
      services.push(...nestedServices);
    }
  } catch (error) {
    logger.warn(`Error scanning directory ${basePath}:`, error.message);
  }
  
  return services;
}

/**
 * Detect services in the project (frontend, backend, database, etc.)
 */
async function detectServices({ projectPath }) {
  try {
    const absolutePath = path.resolve(projectPath);
    const services = [];
    
    // Common service directory patterns
    const servicePatterns = [
      { path: 'frontend', type: 'frontend', port: 3000 },
      { path: 'client', type: 'frontend', port: 3000 },
      { path: 'web', type: 'frontend', port: 3000 },
      { path: 'ui', type: 'frontend', port: 3000 },
      { path: 'backend', type: 'backend', port: 5000 },
      { path: 'server', type: 'backend', port: 5000 },
      { path: 'api', type: 'backend', port: 5000 },
      { path: 'services', type: 'microservices', port: null },
      { path: 'packages', type: 'monorepo', port: null },
      { path: 'apps', type: 'monorepo', port: null }
    ];
    
    // Check root level - might be a single service
    const rootPackageJson = path.join(absolutePath, 'package.json');
    const rootRequirements = path.join(absolutePath, 'requirements.txt');
    const rootGoMod = path.join(absolutePath, 'go.mod');
    
    let isRootService = false;
    
    if (fsSync.existsSync(rootPackageJson)) {
      try {
        const pkg = JSON.parse(await fs.readFile(rootPackageJson, 'utf8'));
        const hasStart = pkg.scripts?.start || pkg.scripts?.dev;
        const hasBuild = pkg.scripts?.build;
        
        // Detect framework
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        let framework = null;
        let type = 'backend';
        let defaultPort = 3000;
        
        if (deps['next']) {
          framework = 'Next.js';
          type = 'fullstack';
        } else if (deps['react'] || deps['vue'] || deps['@angular/core'] || deps['svelte']) {
          framework = deps['react'] ? 'React' : deps['vue'] ? 'Vue' : deps['@angular/core'] ? 'Angular' : 'Svelte';
          type = 'frontend';
        } else if (deps['express'] || deps['fastify'] || deps['koa'] || deps['hapi']) {
          framework = deps['express'] ? 'Express' : deps['fastify'] ? 'Fastify' : deps['koa'] ? 'Koa' : 'Hapi';
          type = 'backend';
          defaultPort = 5000;
        }
        
        if (hasStart || hasBuild) {
          isRootService = true;
          services.push({
            name: pkg.name || 'main',
            path: '.',
            type,
            framework,
            port: defaultPort,
            hasDockerfile: fsSync.existsSync(path.join(absolutePath, 'Dockerfile')),
            packageManager: fsSync.existsSync(path.join(absolutePath, 'pnpm-lock.yaml')) ? 'pnpm' :
                           fsSync.existsSync(path.join(absolutePath, 'yarn.lock')) ? 'yarn' : 'npm'
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    if (fsSync.existsSync(rootRequirements) || fsSync.existsSync(path.join(absolutePath, 'app.py'))) {
      isRootService = true;
      services.push({
        name: 'main',
        path: '.',
        type: 'backend',
        framework: 'Python',
        port: 8000,
        hasDockerfile: fsSync.existsSync(path.join(absolutePath, 'Dockerfile'))
      });
    }
    
    if (fsSync.existsSync(rootGoMod)) {
      isRootService = true;
      services.push({
        name: 'main',
        path: '.',
        type: 'backend',
        framework: 'Go',
        port: 8080,
        hasDockerfile: fsSync.existsSync(path.join(absolutePath, 'Dockerfile'))
      });
    }
    
    // Check for service directories
    for (const pattern of servicePatterns) {
      const servicePath = path.join(absolutePath, pattern.path);
      
      if (fsSync.existsSync(servicePath)) {
        const stats = await fs.stat(servicePath);
        if (!stats.isDirectory()) continue;
        
        // Check if it's a service with its own package.json
        const servicePackageJson = path.join(servicePath, 'package.json');
        if (fsSync.existsSync(servicePackageJson)) {
          try {
            const pkg = JSON.parse(await fs.readFile(servicePackageJson, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            
            let framework = null;
            let detectedType = pattern.type;
            
            if (deps['next']) framework = 'Next.js';
            else if (deps['react']) framework = 'React';
            else if (deps['vue']) framework = 'Vue';
            else if (deps['express']) framework = 'Express';
            else if (deps['fastify']) framework = 'Fastify';
            
            services.push({
              name: pkg.name || pattern.path,
              path: pattern.path,
              type: detectedType,
              framework,
              port: pattern.port,
              hasDockerfile: fsSync.existsSync(path.join(servicePath, 'Dockerfile'))
            });
          } catch (e) {
            // Still add the service even if we can't parse package.json
            services.push({
              name: pattern.path,
              path: pattern.path,
              type: pattern.type,
              port: pattern.port,
              hasDockerfile: fsSync.existsSync(path.join(servicePath, 'Dockerfile'))
            });
          }
        }
        
        // Check for Python service
        const serviceRequirements = path.join(servicePath, 'requirements.txt');
        if (fsSync.existsSync(serviceRequirements)) {
          services.push({
            name: pattern.path,
            path: pattern.path,
            type: pattern.type,
            framework: 'Python',
            port: pattern.port || 8000,
            hasDockerfile: fsSync.existsSync(path.join(servicePath, 'Dockerfile'))
          });
        }
      }
    }
    
    // Check for microservices in services/ directory
    const servicesDir = path.join(absolutePath, 'services');
    if (fsSync.existsSync(servicesDir)) {
      const entries = await fs.readdir(servicesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const microservicePath = path.join(servicesDir, entry.name);
          const hasPackageJson = fsSync.existsSync(path.join(microservicePath, 'package.json'));
          const hasDockerfile = fsSync.existsSync(path.join(microservicePath, 'Dockerfile'));
          
          if (hasPackageJson || hasDockerfile) {
            services.push({
              name: entry.name,
              path: `services/${entry.name}`,
              type: 'microservice',
              port: null, // Unknown
              hasDockerfile
            });
          }
        }
      }
    }
    
    // Check docker-compose for database services
    const dockerComposePath = path.join(absolutePath, 'docker-compose.yml');
    const dockerComposeYamlPath = path.join(absolutePath, 'docker-compose.yaml');
    const composeFile = fsSync.existsSync(dockerComposePath) ? dockerComposePath : 
                        fsSync.existsSync(dockerComposeYamlPath) ? dockerComposeYamlPath : null;
    
    if (composeFile) {
      try {
        const composeContent = await fs.readFile(composeFile, 'utf8');
        
        // Simple detection of database services
        if (composeContent.includes('postgres') || composeContent.includes('postgresql')) {
          services.push({ name: 'postgres', path: null, type: 'database', framework: 'PostgreSQL', port: 5432, fromCompose: true });
        }
        if (composeContent.includes('mysql') || composeContent.includes('mariadb')) {
          services.push({ name: 'mysql', path: null, type: 'database', framework: 'MySQL', port: 3306, fromCompose: true });
        }
        if (composeContent.includes('mongo')) {
          services.push({ name: 'mongodb', path: null, type: 'database', framework: 'MongoDB', port: 27017, fromCompose: true });
        }
        if (composeContent.includes('redis')) {
          services.push({ name: 'redis', path: null, type: 'cache', framework: 'Redis', port: 6379, fromCompose: true });
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    
    // Deep scan for microservices at any depth
    logger.info(`Starting deep scan for services in ${absolutePath}`);
    const deepServices = await scanForServices(absolutePath, '', 0, 6);
    
    // Merge deep-scanned services with existing ones, avoiding duplicates
    const existingPaths = new Set(services.map(s => s.path));
    for (const deepService of deepServices) {
      // Skip if we already have this service by path
      if (!existingPaths.has(deepService.path)) {
        services.push(deepService);
        existingPaths.add(deepService.path);
      }
    }
    
    logger.info(`Detected ${services.length} total services (${deepServices.length} from deep scan)`);
    
    // Sort services by depth (root first, then by name)
    services.sort((a, b) => {
      const depthA = a.path ? a.path.split('/').length : 0;
      const depthB = b.path ? b.path.split('/').length : 0;
      if (depthA !== depthB) return depthA - depthB;
      return (a.name || '').localeCompare(b.name || '');
    });
    
    return {
      success: true,
      projectPath: absolutePath,
      serviceCount: services.length,
      services,
      isMonorepo: services.length > 1 && services.some(s => s.path !== '.'),
      hasFrontend: services.some(s => s.type === 'frontend' || s.type === 'fullstack'),
      hasBackend: services.some(s => s.type === 'backend' || s.type === 'fullstack'),
      hasDatabase: services.some(s => s.type === 'database'),
      hasMicroservices: services.some(s => s.type === 'microservice')
    };
    
  } catch (error) {
    logger.error('detectServices failed:', error);
    return {
      success: false,
      error: error.message,
      services: []
    };
  }
}

/**
 * Detect missing infrastructure files
 */
async function detectMissingFiles({ projectPath }) {
  try {
    const absolutePath = path.resolve(projectPath);
    const missingFiles = [];
    
    // Check for Dockerfile
    const hasDockerfile = fsSync.existsSync(path.join(absolutePath, 'Dockerfile'));
    if (!hasDockerfile) {
      missingFiles.push({
        file: 'Dockerfile',
        type: 'docker',
        description: 'Container configuration for building and running the application',
        priority: 'high',
        required: true
      });
    }
    
    // Check for docker-compose
    const hasDockerCompose = fsSync.existsSync(path.join(absolutePath, 'docker-compose.yml')) ||
                            fsSync.existsSync(path.join(absolutePath, 'docker-compose.yaml'));
    if (!hasDockerCompose) {
      missingFiles.push({
        file: 'docker-compose.yml',
        type: 'docker',
        description: 'Multi-container orchestration for local development and deployment',
        priority: 'high',
        required: true
      });
    }
    
    // Check for .dockerignore
    const hasDockerIgnore = fsSync.existsSync(path.join(absolutePath, '.dockerignore'));
    if (!hasDockerIgnore && hasDockerfile) {
      missingFiles.push({
        file: '.dockerignore',
        type: 'docker',
        description: 'Exclude files from Docker build context',
        priority: 'medium',
        required: false
      });
    }
    
    // Check for GitHub Actions workflow
    const hasGitHubWorkflow = fsSync.existsSync(path.join(absolutePath, '.github', 'workflows', 'deploy.yml')) ||
                              fsSync.existsSync(path.join(absolutePath, '.github', 'workflows', 'deploy.yaml')) ||
                              fsSync.existsSync(path.join(absolutePath, '.github', 'workflows', 'main.yml'));
    if (!hasGitHubWorkflow) {
      missingFiles.push({
        file: '.github/workflows/deploy.yml',
        type: 'cicd',
        description: 'GitHub Actions workflow for automated CI/CD',
        priority: 'high',
        required: true
      });
    }
    
    // Check for Terraform
    const hasTerraform = fsSync.existsSync(path.join(absolutePath, 'terraform')) ||
                         fsSync.existsSync(path.join(absolutePath, 'main.tf')) ||
                         fsSync.existsSync(path.join(absolutePath, 'infrastructure'));
    if (!hasTerraform) {
      missingFiles.push({
        file: 'terraform/main.tf',
        type: 'infrastructure',
        description: 'Terraform configuration for AWS infrastructure',
        priority: 'high',
        required: true
      });
    }
    
    // Check for .env.example
    const hasEnvExample = fsSync.existsSync(path.join(absolutePath, '.env.example')) ||
                          fsSync.existsSync(path.join(absolutePath, '.env.template'));
    const hasEnv = fsSync.existsSync(path.join(absolutePath, '.env'));
    if (!hasEnvExample && hasEnv) {
      missingFiles.push({
        file: '.env.example',
        type: 'config',
        description: 'Template for environment variables (safe to commit)',
        priority: 'medium',
        required: false
      });
    }
    
    // Check for deployment scripts
    const hasDeployScript = fsSync.existsSync(path.join(absolutePath, 'deploy.sh')) ||
                           fsSync.existsSync(path.join(absolutePath, 'scripts', 'deploy.sh'));
    if (!hasDeployScript) {
      missingFiles.push({
        file: 'scripts/deploy.sh',
        type: 'scripts',
        description: 'Deployment automation script',
        priority: 'medium',
        required: false
      });
    }
    
    return {
      success: true,
      projectPath: absolutePath,
      hasAllRequired: missingFiles.filter(f => f.required).length === 0,
      missingCount: missingFiles.length,
      missingFiles
    };
    
  } catch (error) {
    logger.error('detectMissingFiles failed:', error);
    return {
      success: false,
      error: error.message,
      missingFiles: []
    };
  }
}

/**
 * Parse package.json
 */
async function parsePackageJson({ projectPath, servicePath = '.' }) {
  try {
    const absolutePath = path.resolve(projectPath, servicePath, 'package.json');
    
    if (!fsSync.existsSync(absolutePath)) {
      return {
        success: false,
        error: 'package.json not found',
        filePath: absolutePath
      };
    }
    
    const content = await fs.readFile(absolutePath, 'utf8');
    const packageJson = JSON.parse(content);
    
    return {
      success: true,
      filePath: absolutePath,
      packageJson: {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        main: packageJson.main,
        scripts: packageJson.scripts || {},
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
        engines: packageJson.engines
      }
    };
    
  } catch (error) {
    logger.error('parsePackageJson failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Parse .env file
 */
async function parseEnvFile({ filePath }) {
  try {
    const absolutePath = path.resolve(filePath);
    
    if (!fsSync.existsSync(absolutePath)) {
      return {
        success: false,
        error: 'File not found',
        filePath: absolutePath
      };
    }
    
    const content = await fs.readFile(absolutePath, 'utf8');
    const variables = [];
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        // Don't expose actual values, just the keys and whether they have values
        variables.push({
          key,
          hasValue: value.length > 0,
          isSecret: /password|secret|key|token|api/i.test(key)
        });
      }
    }
    
    return {
      success: true,
      filePath: absolutePath,
      variableCount: variables.length,
      variables
    };
    
  } catch (error) {
    logger.error('parseEnvFile failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Analyze all environment files in project
 */
async function analyzeEnvFiles(projectPath) {
  const envFiles = ['.env', '.env.example', '.env.template', '.env.local', '.env.development', '.env.production'];
  const status = {
    hasEnv: false,
    hasTemplate: false,
    envFiles: [],
    requiredVariables: [],
    missingVariables: []
  };
  
  for (const envFile of envFiles) {
    const filePath = path.join(projectPath, envFile);
    if (fsSync.existsSync(filePath)) {
      const parsed = await parseEnvFile({ filePath });
      if (parsed.success) {
        status.envFiles.push({
          name: envFile,
          variableCount: parsed.variableCount,
          variables: parsed.variables
        });
        
        if (envFile === '.env') {
          status.hasEnv = true;
        }
        if (envFile === '.env.example' || envFile === '.env.template') {
          status.hasTemplate = true;
          status.requiredVariables = parsed.variables.map(v => v.key);
        }
      }
    }
  }
  
  // Check what's missing
  if (status.hasTemplate && status.hasEnv) {
    const envVars = status.envFiles.find(f => f.name === '.env')?.variables.map(v => v.key) || [];
    status.missingVariables = status.requiredVariables.filter(v => !envVars.includes(v));
  }
  
  return status;
}

/**
 * Detect the framework used in the project
 */
async function detectFramework({ projectPath }) {
  try {
    const absolutePath = path.resolve(projectPath);
    const result = {
      success: true,
      projectPath: absolutePath,
      framework: null,
      version: null,
      features: []
    };
    
    const packageJsonPath = path.join(absolutePath, 'package.json');
    
    if (fsSync.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      
      // Detect framework
      if (deps['next']) {
        result.framework = 'Next.js';
        result.version = deps['next'];
        result.features.push('SSR', 'API Routes');
        if (fsSync.existsSync(path.join(absolutePath, 'app'))) {
          result.features.push('App Router');
        }
      } else if (deps['react']) {
        result.framework = 'React';
        result.version = deps['react'];
        if (deps['react-router'] || deps['react-router-dom']) {
          result.features.push('Router');
        }
        if (deps['redux'] || deps['@reduxjs/toolkit']) {
          result.features.push('Redux');
        }
      } else if (deps['vue']) {
        result.framework = 'Vue';
        result.version = deps['vue'];
        if (deps['vue-router']) result.features.push('Router');
        if (deps['vuex'] || deps['pinia']) result.features.push('State Management');
      } else if (deps['@angular/core']) {
        result.framework = 'Angular';
        result.version = deps['@angular/core'];
      } else if (deps['express']) {
        result.framework = 'Express';
        result.version = deps['express'];
      } else if (deps['fastify']) {
        result.framework = 'Fastify';
        result.version = deps['fastify'];
      } else if (deps['nestjs'] || deps['@nestjs/core']) {
        result.framework = 'NestJS';
        result.version = deps['@nestjs/core'];
      }
      
      // Detect additional features
      if (deps['typescript']) result.features.push('TypeScript');
      if (deps['tailwindcss']) result.features.push('Tailwind CSS');
      if (deps['prisma'] || deps['@prisma/client']) result.features.push('Prisma');
      if (deps['mongoose']) result.features.push('Mongoose');
      if (deps['sequelize']) result.features.push('Sequelize');
    }
    
    // Check for Python frameworks
    const requirementsPath = path.join(absolutePath, 'requirements.txt');
    if (fsSync.existsSync(requirementsPath)) {
      const content = await fs.readFile(requirementsPath, 'utf8');
      
      if (content.includes('django')) {
        result.framework = 'Django';
      } else if (content.includes('flask')) {
        result.framework = 'Flask';
      } else if (content.includes('fastapi')) {
        result.framework = 'FastAPI';
      }
    }
    
    return result;
    
  } catch (error) {
    logger.error('detectFramework failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate recommendations based on analysis
 */
function generateRecommendations(projectType, missingFiles, envStatus) {
  const recommendations = [];
  
  // Missing files recommendations
  for (const file of missingFiles) {
    if (file.required) {
      recommendations.push({
        type: 'critical',
        message: `Create ${file.file}: ${file.description}`,
        action: `generate_${file.type}`
      });
    }
  }
  
  // Environment recommendations
  if (!envStatus.hasEnv && envStatus.hasTemplate) {
    recommendations.push({
      type: 'warning',
      message: 'Create .env file from template - required for local development',
      action: 'create_env'
    });
  }
  
  if (envStatus.missingVariables.length > 0) {
    recommendations.push({
      type: 'warning',
      message: `Missing environment variables: ${envStatus.missingVariables.join(', ')}`,
      action: 'update_env'
    });
  }
  
  if (!envStatus.hasTemplate && envStatus.hasEnv) {
    recommendations.push({
      type: 'info',
      message: 'Create .env.example to document required environment variables',
      action: 'create_env_template'
    });
  }
  
  return recommendations;
}

/**
 * Get MCP tool definitions
 */
function getTools() {
  return [
    {
      name: 'analyzeProject',
      description: 'Perform comprehensive analysis of a project directory - structure, services, missing files, environment status',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory to analyze'
          }
        },
        required: ['projectPath']
      },
      handler: analyzeProject
    },
    {
      name: 'detectServices',
      description: 'Detect services in a project (frontend, backend, database, microservices)',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory'
          }
        },
        required: ['projectPath']
      },
      handler: detectServices
    },
    {
      name: 'detectMissingFiles',
      description: 'Detect missing infrastructure files (Dockerfile, docker-compose, Terraform, CI/CD)',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory'
          }
        },
        required: ['projectPath']
      },
      handler: detectMissingFiles
    },
    {
      name: 'parsePackageJson',
      description: 'Parse and extract information from package.json',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory'
          },
          servicePath: {
            type: 'string',
            description: 'Relative path to the service (for monorepos)',
            default: '.'
          }
        },
        required: ['projectPath']
      },
      handler: parsePackageJson
    },
    {
      name: 'parseEnvFile',
      description: 'Parse a .env file and extract variable names (not values)',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Path to the .env file'
          }
        },
        required: ['filePath']
      },
      handler: parseEnvFile
    },
    {
      name: 'detectFramework',
      description: 'Detect the framework and features used in a project',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description: 'Path to the project directory'
          }
        },
        required: ['projectPath']
      },
      handler: detectFramework
    }
  ];
}

module.exports = {
  getTools,
  analyzeProject,
  detectServices,
  detectMissingFiles,
  parsePackageJson,
  parseEnvFile,
  detectFramework
};

