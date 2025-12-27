const githubService = require('./githubService');
const codeAnalysis = require('./codeAnalysis');
const dependencyAnalysis = require('./dependencyAnalysis');
const logger = require('../utils/logger');

/**
 * GitHub Repository Analysis Service
 * Analyzes GitHub repositories to understand codebase structure and infrastructure needs
 */
class GitHubAnalysisService {
  /**
   * Analyze a GitHub repository
   * Optimized to only scan key files instead of entire repository tree
   */
  async analyzeRepository(repoUrl, branch = null, token = null) {
    try {
      const { owner, repo } = githubService.parseRepositoryUrl(repoUrl);
      
      logger.info(`Analyzing repository: ${owner}/${repo}`, { branch });
      
      // Get repository info
      const repoInfo = await githubService.getRepository(owner, repo, token);
      const defaultBranch = branch || repoInfo.default_branch;
      
      // OPTIMIZATION: Instead of getting entire tree, directly read key files
      // This is much faster and more efficient for deployment purposes
      const keyFiles = await this.readKeyFilesOptimized(owner, repo, defaultBranch, token);
      
      // Analyze repository structure from key files only
      const structure = this.analyzeStructureFromFiles(keyFiles, repoInfo);
      
      // Analyze code for infrastructure needs
      const codeAnalysisResults = await codeAnalysis.analyzeCodebase(keyFiles);
      
      // Analyze dependencies
      const dependencyResults = await dependencyAnalysis.analyzeDependencies(keyFiles);
      
      // Detect existing infrastructure code
      const existingInfra = this.detectExistingInfrastructure(keyFiles);
      
      // Analyze CI/CD pipelines
      const cicdAnalysis = this.analyzeCICD(keyFiles);
      
      // Identify what needs to be generated (missing infrastructure files)
      const missingInfrastructure = this.identifyMissingInfrastructure(
        existingInfra,
        cicdAnalysis,
        structure,
        codeAnalysisResults,
        dependencyResults
      );
      
      return {
        repository: {
          url: repoUrl,
          owner,
          repo,
          defaultBranch,
          description: repoInfo.description,
          language: repoInfo.language,
          topics: repoInfo.topics || []
        },
        structure,
        codeAnalysis: codeAnalysisResults,
        dependencies: dependencyResults,
        existingInfrastructure: existingInfra,
        cicd: cicdAnalysis,
        missingInfrastructure, // What AI needs to generate
        analyzedAt: new Date()
      };
    } catch (error) {
      logger.error('Failed to analyze repository:', error);
      throw error;
    }
  }

  /**
   * Analyze repository structure
   */
  analyzeStructure(tree) {
    const structure = {
      languages: new Set(),
      hasDocker: false,
      hasTerraform: false,
      hasKubernetes: false,
      hasCI: false,
      fileTypes: {},
      directories: []
    };
    
    for (const item of tree) {
      const path = item.path;
      const parts = path.split('/');
      
      // Detect file types
      const ext = path.split('.').pop()?.toLowerCase();
      if (ext) {
        structure.fileTypes[ext] = (structure.fileTypes[ext] || 0) + 1;
      }
      
      // Detect key files
      if (path.includes('Dockerfile')) structure.hasDocker = true;
      if (path.includes('docker-compose')) structure.hasDocker = true;
      if (path.match(/\.tf$/)) structure.hasTerraform = true;
      if (path.match(/\.tfvars$/)) structure.hasTerraform = true;
      if (path.includes('k8s') || path.includes('kubernetes')) structure.hasKubernetes = true;
      if (path.includes('.github/workflows') || path.includes('.gitlab-ci') || path.includes('Jenkinsfile')) {
        structure.hasCI = true;
      }
      
      // Track directories
      if (item.type === 'tree' && parts.length <= 2) {
        structure.directories.push(parts[0]);
      }
    }
    
    structure.languages = Array.from(structure.languages);
    
    return structure;
  }

  /**
   * Read key files optimized - only reads essential files for deployment
   * This avoids scanning the entire repository tree
   */
  async readKeyFilesOptimized(owner, repo, branch, token = null) {
    const keyFiles = {};
    
    // Essential files for deployment analysis (prioritized list - reduced to avoid rate limits)
    // Only check the most critical files that are likely to exist
    const essentialFiles = [
      // Dependency files (highest priority - most likely to exist)
      'package.json',        // Node.js
      'requirements.txt',    // Python
      'go.mod',              // Go
      'pom.xml',             // Java Maven
      'build.gradle',        // Java Gradle
      'Cargo.toml',          // Rust
      
      // Configuration files (high priority)
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      
      // Environment files
      '.env.example',
      '.env.template',
      
      // Infrastructure as Code (only main files)
      'main.tf',
      'variables.tf',
      
      // CI/CD (only common ones)
      '.github/workflows/deploy.yml',
      '.github/workflows/main.yml',
      '.gitlab-ci.yml',
      'Jenkinsfile',
      
      // Application entry points (only common ones)
      'index.js',
      'server.js',
      'app.js',
      'main.py',
      'app.py',
      'main.go',
      
      // Documentation
      'README.md',
      
      // TypeScript config
      'tsconfig.json',
    ];
    
    // Read files in smaller batches with delays to avoid rate limiting
    const batchSize = 3; // Reduced batch size to avoid rate limits
    const delayBetweenBatches = 200; // 200ms delay between batches
    
    for (let i = 0; i < essentialFiles.length; i += batchSize) {
      const batch = essentialFiles.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (filePath) => {
          try {
            const file = await githubService.readFile(owner, repo, filePath, branch, token);
            keyFiles[filePath] = file.content;
          } catch (error) {
            // File doesn't exist - silently skip (this is expected for most files)
            // Only log non-404 errors, and only at debug level
            if (error.response?.status === 404) {
              // Expected - file doesn't exist, skip silently
              return;
            } else if (error.response?.status === 403) {
              // Rate limit - log warning but don't throw
              logger.warn(`Rate limited while reading ${filePath}, skipping`);
              return;
            } else {
              // Other errors - log at debug level only
              logger.debug(`Error reading ${filePath}: ${error.message}`);
            }
          }
        })
      );
      
      // Add delay between batches to avoid rate limiting (except for last batch)
      if (i + batchSize < essentialFiles.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
    
    return keyFiles;
  }

  /**
   * Read key files for analysis (legacy method - kept for backward compatibility)
   */
  async readKeyFiles(owner, repo, branch, structure, token = null) {
    return this.readKeyFilesOptimized(owner, repo, branch, token);
  }

  /**
   * Analyze structure from key files instead of full tree
   */
  analyzeStructureFromFiles(keyFiles, repoInfo) {
    const structure = {
      languages: [],
      hasDocker: false,
      hasTerraform: false,
      hasKubernetes: false,
      hasCI: false,
      fileTypes: {},
      directories: []
    };
    
    // Detect language from repository info
    if (repoInfo.language) {
      structure.languages.push(repoInfo.language.toLowerCase());
    }
    
    // Detect from file names
    const filePaths = Object.keys(keyFiles);
    
    for (const path of filePaths) {
      // Detect file types
      const ext = path.split('.').pop()?.toLowerCase();
      if (ext && ext.length <= 5) { // Only reasonable extensions
        structure.fileTypes[ext] = (structure.fileTypes[ext] || 0) + 1;
      }
      
      // Detect infrastructure
      if (path.includes('Dockerfile') || path.includes('docker-compose')) {
        structure.hasDocker = true;
      }
      if (path.match(/\.tf$/) || path.match(/\.tfvars$/)) {
        structure.hasTerraform = true;
      }
      if (path.includes('k8s') || path.includes('kubernetes') || path.includes('deployment.yaml')) {
        structure.hasKubernetes = true;
      }
      if (path.includes('.github/workflows') || path.includes('.gitlab-ci') || path.includes('Jenkinsfile') || path.includes('.circleci')) {
        structure.hasCI = true;
      }
      
      // Detect language from package files
      if (path === 'package.json' && keyFiles[path]) {
        try {
          const pkg = JSON.parse(keyFiles[path]);
          if (pkg.type === 'module') structure.languages.push('javascript');
          if (pkg.dependencies?.['typescript'] || pkg.devDependencies?.['typescript']) {
            structure.languages.push('typescript');
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
      if (path === 'requirements.txt') structure.languages.push('python');
      if (path === 'go.mod') structure.languages.push('go');
      if (path === 'Cargo.toml') structure.languages.push('rust');
      if (path === 'pom.xml' || path === 'build.gradle') structure.languages.push('java');
    }
    
    // Remove duplicates
    structure.languages = [...new Set(structure.languages)];
    
    return structure;
  }

  /**
   * Detect existing infrastructure code with improved accuracy
   */
  detectExistingInfrastructure(keyFiles) {
    const infrastructure = {
      terraform: null,
      docker: null,
      kubernetes: null,
      cloudformation: null
    };
    
    const filePaths = Object.keys(keyFiles);
    
    // Check for Terraform - more accurate detection
    const terraformFiles = filePaths.filter(f => 
      f.endsWith('.tf') || f.endsWith('.tfvars') || f.includes('terraform')
    );
    if (terraformFiles.length > 0) {
      // Verify it's actually Terraform by checking content
      const hasTerraformContent = terraformFiles.some(f => {
        const content = keyFiles[f]?.toLowerCase() || '';
        return content.includes('terraform') || 
               content.includes('provider') || 
               content.includes('resource') ||
               content.includes('variable') ||
               content.includes('output');
      });
      
      if (hasTerraformContent) {
        infrastructure.terraform = {
          detected: true,
          files: terraformFiles
        };
      }
    }
    
    // Check for Docker - more accurate detection
    const dockerFiles = filePaths.filter(f => 
      f.includes('Dockerfile') || 
      f.includes('docker-compose') ||
      f === '.dockerignore'
    );
    if (dockerFiles.length > 0) {
      // Verify it's actually Docker by checking content
      const hasDockerContent = dockerFiles.some(f => {
        const content = keyFiles[f]?.toLowerCase() || '';
        return content.includes('from ') || 
               content.includes('run ') ||
               content.includes('copy ') ||
               content.includes('expose ') ||
               content.includes('version:') ||
               content.includes('services:');
      });
      
      if (hasDockerContent) {
        infrastructure.docker = {
          detected: true,
          files: dockerFiles.filter(f => !f.includes('kubernetes') && !f.includes('k8s'))
        };
      }
    }
    
    // Check for Kubernetes - more accurate detection
    // Only count YAML files that actually contain Kubernetes resources
    const k8sCandidateFiles = filePaths.filter(f => {
      const lowerPath = f.toLowerCase();
      return lowerPath.includes('k8s') || 
             lowerPath.includes('kubernetes') ||
             lowerPath.includes('deployment.yaml') ||
             lowerPath.includes('service.yaml') ||
             lowerPath.includes('configmap.yaml') ||
             lowerPath.includes('secret.yaml');
    });
    
    // Also check docker-compose.yml for Kubernetes manifests
    if (keyFiles['docker-compose.yml'] || keyFiles['docker-compose.yaml']) {
      const composeContent = (keyFiles['docker-compose.yml'] || keyFiles['docker-compose.yaml'] || '').toLowerCase();
      // docker-compose is NOT Kubernetes, so don't count it
      // Only count if it's actually a Kubernetes manifest
    }
    
    // Verify Kubernetes files contain actual K8s resources
    const k8sFiles = k8sCandidateFiles.filter(f => {
      const content = keyFiles[f]?.toLowerCase() || '';
      return content.includes('apiVersion') && 
             (content.includes('kind: deployment') ||
              content.includes('kind: service') ||
              content.includes('kind: pod') ||
              content.includes('kind: configmap') ||
              content.includes('kind: secret') ||
              content.includes('kind: ingress'));
    });
    
    if (k8sFiles.length > 0) {
      infrastructure.kubernetes = {
        detected: true,
        files: k8sFiles
      };
    }
    
    // Check for CloudFormation
    const cloudformationFiles = filePaths.filter(f => 
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
    ).filter(f => {
      const content = keyFiles[f]?.toLowerCase() || '';
      return content.includes('awstemplateformatversion') ||
             content.includes('resources:') && content.includes('type: aws::');
    });
    
    if (cloudformationFiles.length > 0) {
      infrastructure.cloudformation = {
        detected: true,
        files: cloudformationFiles
      };
    }
    
    return infrastructure;
  }

  /**
   * Analyze CI/CD pipelines
   */
  analyzeCICD(keyFiles) {
    const cicd = {
      providers: [],
      workflows: []
    };
    
    // Check for GitHub Actions
    if (keyFiles['.github/workflows']) {
      cicd.providers.push('github-actions');
    }
    
    // Check for GitLab CI
    if (keyFiles['.gitlab-ci.yml']) {
      cicd.providers.push('gitlab-ci');
    }
    
    // Check for Jenkins
    if (keyFiles['Jenkinsfile']) {
      cicd.providers.push('jenkins');
    }
    
    return cicd;
  }

  /**
   * Identify missing infrastructure files that need to be generated
   * This is the key function - it tells the AI what to generate
   */
  identifyMissingInfrastructure(existingInfra, cicd, structure, codeAnalysis, dependencies) {
    const missing = {
      dockerfile: !existingInfra.docker,
      dockerCompose: !existingInfra.docker,
      terraform: !existingInfra.terraform,
      cicdPipeline: cicd.providers.length === 0,
      deploymentScripts: true, // Always generate deployment scripts
      kubernetes: false, // Only if user specifically wants K8s
      cloudformation: false, // Only if user specifically wants CloudFormation
      requirements: []
    };

    // Determine what type of CI/CD pipeline to generate
    if (missing.cicdPipeline) {
      // Prefer GitHub Actions if it's a GitHub repo, otherwise suggest others
      missing.cicdType = 'github-actions'; // Default to GitHub Actions
      missing.requirements.push('Generate CI/CD pipeline for automated deployments');
    }

    // Determine if Dockerfile is needed based on application type
    if (missing.dockerfile) {
      const runtime = dependencies.runtime?.language || structure.languages[0] || 'unknown';
      missing.dockerfileType = runtime; // nodejs, python, go, etc.
      missing.requirements.push(`Generate Dockerfile for ${runtime} application`);
      
      // Also suggest docker-compose for local development
      missing.requirements.push('Generate docker-compose.yml for local development');
    }

    // Determine Terraform needs based on detected infrastructure requirements
    if (missing.terraform) {
      const infraNeeds = [];
      
      if (codeAnalysis.databases && codeAnalysis.databases.length > 0) {
        infraNeeds.push(`Database: ${codeAnalysis.databases.join(', ')}`);
      }
      if (codeAnalysis.storage && codeAnalysis.storage.length > 0) {
        infraNeeds.push(`Storage: ${codeAnalysis.storage.join(', ')}`);
      }
      if (codeAnalysis.caching && codeAnalysis.caching.length > 0) {
        infraNeeds.push(`Cache: ${codeAnalysis.caching.join(', ')}`);
      }
      if (codeAnalysis.messaging && codeAnalysis.messaging.length > 0) {
        infraNeeds.push(`Messaging: ${codeAnalysis.messaging.join(', ')}`);
      }
      
      // Always need compute resources
      infraNeeds.push('Compute resources for application hosting');
      
      missing.terraformNeeds = infraNeeds;
      missing.requirements.push(`Generate Terraform code for: ${infraNeeds.join(', ')}`);
    }

    // Generate deployment scripts
    missing.requirements.push('Generate deployment scripts (deploy.sh, rollback.sh)');
    
    // Generate environment setup scripts
    missing.requirements.push('Generate environment setup and configuration scripts');

    return missing;
  }
}

module.exports = new GitHubAnalysisService();

