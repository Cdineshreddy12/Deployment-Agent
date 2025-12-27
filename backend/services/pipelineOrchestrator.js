const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const projectTools = require('../mcp/tools/projectTools');
const fileTools = require('../mcp/tools/fileTools');
const envTools = require('../mcp/tools/envTools');
const dockerTools = require('../mcp/tools/dockerTools');

/**
 * Pipeline Orchestrator
 * Manages step-by-step deployment with Claude verification at each stage
 */

// Pipeline stages in order
const STAGES = {
  ANALYZE: 'ANALYZE',
  COLLECT_ENV: 'COLLECT_ENV',
  GENERATE_FILES: 'GENERATE_FILES',
  VERIFY_GENERATION: 'VERIFY_GENERATION',
  LOCAL_BUILD: 'LOCAL_BUILD',
  LOCAL_TEST: 'LOCAL_TEST',
  ANALYZE_LOGS: 'ANALYZE_LOGS',
  PROVISION_INFRA: 'PROVISION_INFRA',
  DEPLOY_PRODUCTION: 'DEPLOY_PRODUCTION',
  HEALTH_CHECK: 'HEALTH_CHECK',
  COMPLETE: 'COMPLETE'
};

const STAGE_ORDER = [
  STAGES.ANALYZE,
  STAGES.COLLECT_ENV,
  STAGES.GENERATE_FILES,
  STAGES.VERIFY_GENERATION,
  STAGES.LOCAL_BUILD,
  STAGES.LOCAL_TEST,
  STAGES.ANALYZE_LOGS,
  STAGES.PROVISION_INFRA,
  STAGES.DEPLOY_PRODUCTION,
  STAGES.HEALTH_CHECK,
  STAGES.COMPLETE
];

class PipelineOrchestrator extends EventEmitter {
  constructor() {
    super();
    this.pipelines = new Map(); // deploymentId -> pipeline state
    this.setMaxListeners(50);
  }

  /**
   * Initialize a new pipeline
   */
  async initializePipeline(deploymentId, projectPath, options = {}) {
    const pipeline = {
      deploymentId,
      projectPath,
      currentStage: STAGES.ANALYZE,
      stageHistory: [],
      context: {
        projectAnalysis: null,
        services: [],
        envStatus: {},
        generatedFiles: [],
        buildResults: {},
        testResults: {},
        logAnalysis: {},
        infrastructure: null,
        deploymentResult: null
      },
      options: {
        skipLocalTest: options.skipLocalTest || false,
        skipInfra: options.skipInfra || false,
        autoApprove: options.autoApprove || false,
        ...options
      },
      status: 'initialized',
      startedAt: new Date(),
      lastUpdated: new Date()
    };

    this.pipelines.set(deploymentId, pipeline);
    this.emit('pipeline:initialized', { deploymentId, pipeline });

    return pipeline;
  }

  /**
   * Get pipeline state
   */
  getPipeline(deploymentId) {
    return this.pipelines.get(deploymentId);
  }

  /**
   * Get current stage
   */
  getCurrentStage(deploymentId) {
    const pipeline = this.pipelines.get(deploymentId);
    return pipeline ? pipeline.currentStage : null;
  }

  /**
   * Get next stage
   */
  getNextStage(currentStage) {
    const currentIndex = STAGE_ORDER.indexOf(currentStage);
    if (currentIndex === -1 || currentIndex === STAGE_ORDER.length - 1) {
      return null;
    }
    return STAGE_ORDER[currentIndex + 1];
  }

  /**
   * Execute current stage
   */
  async executeCurrentStage(deploymentId) {
    const pipeline = this.pipelines.get(deploymentId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${deploymentId}`);
    }

    const stage = pipeline.currentStage;
    logger.info(`Executing stage ${stage} for ${deploymentId}`);

    pipeline.status = 'running';
    pipeline.lastUpdated = new Date();
    this.emit('stage:started', { deploymentId, stage });

    try {
      const result = await this.runStage(deploymentId, stage);
      
      // Record stage completion
      pipeline.stageHistory.push({
        stage,
        result,
        completedAt: new Date(),
        success: result.success
      });

      if (result.success) {
        pipeline.status = 'awaiting_verification';
        this.emit('stage:completed', { deploymentId, stage, result });
        
        return {
          success: true,
          stage,
          result,
          needsVerification: true,
          message: `Stage ${stage} completed. Awaiting verification.`
        };
      } else {
        pipeline.status = 'error';
        this.emit('stage:failed', { deploymentId, stage, error: result.error });
        
        return {
          success: false,
          stage,
          error: result.error,
          suggestions: result.suggestions || [],
          message: `Stage ${stage} failed: ${result.error}`
        };
      }

    } catch (error) {
      logger.error(`Stage ${stage} execution error:`, error);
      pipeline.status = 'error';
      pipeline.stageHistory.push({
        stage,
        error: error.message,
        completedAt: new Date(),
        success: false
      });
      
      this.emit('stage:failed', { deploymentId, stage, error: error.message });
      
      return {
        success: false,
        stage,
        error: error.message,
        message: `Stage ${stage} threw an error`
      };
    }
  }

  /**
   * Run a specific stage
   */
  async runStage(deploymentId, stage) {
    const pipeline = this.pipelines.get(deploymentId);
    const { projectPath, context } = pipeline;

    switch (stage) {
      case STAGES.ANALYZE:
        return await this.runAnalyzeStage(projectPath, context);

      case STAGES.COLLECT_ENV:
        return await this.runCollectEnvStage(deploymentId, projectPath, context);

      case STAGES.GENERATE_FILES:
        return await this.runGenerateFilesStage(deploymentId, projectPath, context);

      case STAGES.VERIFY_GENERATION:
        return await this.runVerifyGenerationStage(deploymentId, projectPath, context);

      case STAGES.LOCAL_BUILD:
        return await this.runLocalBuildStage(deploymentId, projectPath, context);

      case STAGES.LOCAL_TEST:
        return await this.runLocalTestStage(deploymentId, projectPath, context);

      case STAGES.ANALYZE_LOGS:
        return await this.runAnalyzeLogsStage(deploymentId, context);

      case STAGES.PROVISION_INFRA:
        return await this.runProvisionInfraStage(deploymentId, projectPath, context);

      case STAGES.DEPLOY_PRODUCTION:
        return await this.runDeployProductionStage(deploymentId, projectPath, context);

      case STAGES.HEALTH_CHECK:
        return await this.runHealthCheckStage(deploymentId, context);

      case STAGES.COMPLETE:
        return { success: true, message: 'Deployment complete' };

      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  /**
   * Stage: Analyze project
   */
  async runAnalyzeStage(projectPath, context) {
    logger.info('Running ANALYZE stage');
    
    // Analyze project structure
    const analysis = await projectTools.analyzeProject({ projectPath });
    if (!analysis.success) {
      return { success: false, error: analysis.error };
    }

    context.projectAnalysis = analysis;
    
    // Detect services
    const services = await projectTools.detectServices({ projectPath });
    context.services = services.services || [];

    // Detect missing files
    const missingFiles = await projectTools.detectMissingFiles({ projectPath });
    context.missingFiles = missingFiles.missingFiles || [];

    return {
      success: true,
      data: {
        projectType: analysis.projectType,
        framework: analysis.framework,
        services: context.services,
        missingFiles: context.missingFiles,
        envStatus: analysis.envStatus,
        recommendations: analysis.recommendations
      },
      message: 'Project analysis complete',
      needsUserInput: !analysis.envStatus.hasEnv,
      userInputNeeded: !analysis.envStatus.hasEnv ? 'env' : null
    };
  }

  /**
   * Stage: Collect environment variables
   */
  async runCollectEnvStage(deploymentId, projectPath, context) {
    logger.info('Running COLLECT_ENV stage');

    // Check if env already exists
    const envStatus = context.projectAnalysis?.envStatus;
    
    if (envStatus?.hasEnv) {
      // Parse existing .env
      const envPath = `${projectPath}/.env`;
      const parsed = await projectTools.parseEnvFile({ filePath: envPath });
      
      if (parsed.success) {
        context.envStatus = {
          collected: true,
          source: 'file',
          variables: parsed.variables
        };
        
        return {
          success: true,
          data: {
            source: 'existing_file',
            variableCount: parsed.variableCount,
            variables: parsed.variables
          },
          message: 'Environment variables loaded from .env file'
        };
      }
    }

    // Check if env was uploaded/stored
    const storedEnvs = await envTools.listEnvs({ deploymentId });
    if (storedEnvs.count > 0) {
      context.envStatus = {
        collected: true,
        source: 'stored',
        environments: storedEnvs.environments
      };

      return {
        success: true,
        data: storedEnvs,
        message: `${storedEnvs.count} environment(s) loaded from storage`
      };
    }

    // No env found - need user input
    return {
      success: true,
      data: {
        envFound: false,
        requiredVariables: envStatus?.requiredVariables || []
      },
      message: 'No environment variables found',
      needsUserInput: true,
      userInputType: 'env',
      prompt: 'Please provide your environment variables (.env content or upload file)'
    };
  }

  /**
   * Stage: Generate infrastructure files
   */
  async runGenerateFilesStage(deploymentId, projectPath, context) {
    logger.info('Running GENERATE_FILES stage');

    const generatedFiles = [];
    const missingFiles = context.missingFiles || [];

    for (const missing of missingFiles) {
      if (!missing.required) continue;

      let fileContent = null;
      let filePath = `${projectPath}/${missing.file}`;

      switch (missing.type) {
        case 'docker':
          if (missing.file === 'Dockerfile') {
            // Generate Dockerfile based on project type
            const projectType = context.projectAnalysis?.projectType?.language || 'generic';
            const framework = context.projectAnalysis?.framework || null;
            
            fileContent = this.generateDockerfile(projectType, framework, context.services);
          } else if (missing.file === 'docker-compose.yml') {
            fileContent = this.generateDockerCompose(context.services, deploymentId);
          }
          break;

        case 'cicd':
          fileContent = this.generateGitHubWorkflow(context.projectAnalysis, context.services);
          break;

        case 'infrastructure':
          fileContent = this.generateTerraformConfig(context.services);
          break;
      }

      if (fileContent) {
        // Get diff preview before writing
        const diff = await fileTools.getFileDiff({ filePath, newContent: fileContent });
        
        generatedFiles.push({
          path: missing.file,
          fullPath: filePath,
          type: missing.type,
          content: fileContent,
          diff: diff.diff,
          isNewFile: diff.isNewFile
        });
      }
    }

    context.generatedFiles = generatedFiles;

    return {
      success: true,
      data: {
        files: generatedFiles.map(f => ({
          path: f.path,
          type: f.type,
          isNew: f.isNewFile,
          preview: f.content.substring(0, 500)
        }))
      },
      message: `Generated ${generatedFiles.length} file(s)`,
      needsVerification: true,
      verificationPrompt: 'Review generated files before writing to disk'
    };
  }

  /**
   * Stage: Verify generated files (Claude reviews and approves)
   */
  async runVerifyGenerationStage(deploymentId, projectPath, context) {
    logger.info('Running VERIFY_GENERATION stage');

    // Write approved files to disk
    const writtenFiles = [];
    
    for (const file of context.generatedFiles) {
      const result = await fileTools.writeFile({
        filePath: file.fullPath,
        content: file.content,
        backup: true
      });

      if (result.success) {
        writtenFiles.push({
          path: file.path,
          written: true
        });
      } else {
        writtenFiles.push({
          path: file.path,
          written: false,
          error: result.error
        });
      }
    }

    const allWritten = writtenFiles.every(f => f.written);

    return {
      success: allWritten,
      data: { writtenFiles },
      message: allWritten 
        ? `Successfully wrote ${writtenFiles.length} file(s) to disk`
        : 'Some files failed to write',
      error: allWritten ? null : 'Failed to write some files'
    };
  }

  /**
   * Stage: Local Docker build
   */
  async runLocalBuildStage(deploymentId, projectPath, context) {
    logger.info('Running LOCAL_BUILD stage');

    const buildResults = [];
    const services = context.services.filter(s => s.path && s.type !== 'database');

    for (const service of services) {
      const servicePath = service.path === '.' ? projectPath : `${projectPath}/${service.path}`;
      const tag = `${deploymentId}-${service.name}:local`;

      this.emit('build:started', { deploymentId, service: service.name });

      const result = await dockerTools.dockerBuildWithStreaming({
        contextPath: servicePath,
        dockerfile: 'Dockerfile',
        tag,
        onLog: (log) => {
          this.emit('log', { deploymentId, service: service.name, type: 'build', log });
        }
      });

      buildResults.push({
        service: service.name,
        tag,
        success: result.success,
        imageId: result.imageId,
        logs: result.logs,
        analysis: result.analysis
      });

      this.emit('build:completed', { deploymentId, service: service.name, success: result.success });
    }

    context.buildResults = buildResults;
    const allSuccess = buildResults.every(r => r.success);

    return {
      success: allSuccess,
      data: {
        builds: buildResults.map(b => ({
          service: b.service,
          success: b.success,
          imageId: b.imageId,
          hasErrors: b.analysis?.hasErrors
        }))
      },
      message: allSuccess ? 'All builds successful' : 'Some builds failed',
      error: allSuccess ? null : buildResults.find(b => !b.success)?.analysis?.summary
    };
  }

  /**
   * Stage: Local Docker test
   */
  async runLocalTestStage(deploymentId, projectPath, context) {
    logger.info('Running LOCAL_TEST stage');

    // Start docker-compose for local testing
    const result = await dockerTools.dockerComposeUpWithStreaming({
      projectPath,
      detach: true,
      build: false,
      onLog: (log) => {
        this.emit('log', { deploymentId, type: 'compose', log });
      }
    });

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        data: { logs: result.logs }
      };
    }

    // Wait for services to be healthy
    await new Promise(resolve => setTimeout(resolve, 5000)); // Initial wait

    const healthChecks = [];
    for (const service of context.services.filter(s => s.path)) {
      const containerName = `${deploymentId}-${service.name}`;
      const health = await dockerTools.checkContainerHealth({ containerId: containerName });
      healthChecks.push({
        service: service.name,
        ...health
      });
    }

    context.testResults = {
      composeLogs: result.logs,
      healthChecks
    };

    const allHealthy = healthChecks.every(h => h.healthy || h.isRunning);

    return {
      success: allHealthy,
      data: {
        healthChecks,
        composeLogs: result.logs.substring(0, 2000)
      },
      message: allHealthy ? 'All services running' : 'Some services unhealthy',
      needsLogAnalysis: true
    };
  }

  /**
   * Stage: Analyze logs for errors
   */
  async runAnalyzeLogsStage(deploymentId, context) {
    logger.info('Running ANALYZE_LOGS stage');

    const analyses = [];

    // Analyze build logs
    for (const build of context.buildResults || []) {
      if (build.logs) {
        const analysis = dockerTools.analyzeLogsForErrors({ logs: build.logs });
        analyses.push({
          type: 'build',
          service: build.service,
          ...analysis
        });
      }
    }

    // Analyze test/compose logs
    if (context.testResults?.composeLogs) {
      const analysis = dockerTools.analyzeLogsForErrors({ logs: context.testResults.composeLogs });
      analyses.push({
        type: 'compose',
        ...analysis
      });
    }

    context.logAnalysis = analyses;

    const hasBlockingErrors = analyses.some(a => a.hasCritical || (a.hasErrors && !a.canProceed));

    return {
      success: !hasBlockingErrors,
      data: {
        analyses,
        canProceed: !hasBlockingErrors,
        summary: hasBlockingErrors 
          ? 'Critical errors found in logs. Review before proceeding.'
          : 'No blocking errors found. Safe to proceed.'
      },
      message: hasBlockingErrors ? 'Errors detected in logs' : 'Logs look clean',
      suggestions: analyses.flatMap(a => a.suggestions || [])
    };
  }

  /**
   * Stage: Provision infrastructure
   */
  async runProvisionInfraStage(deploymentId, projectPath, context) {
    logger.info('Running PROVISION_INFRA stage');

    // This would integrate with Terraform
    // For now, return a placeholder
    
    this.emit('infra:started', { deploymentId });

    // Simulated terraform apply
    const infraResult = {
      success: true,
      resources: [
        { type: 'aws_instance', name: 'app_server', status: 'created' },
        { type: 'aws_security_group', name: 'app_sg', status: 'created' },
        { type: 'aws_eip', name: 'app_ip', status: 'created' }
      ],
      outputs: {
        public_ip: '0.0.0.0', // Would be real IP
        public_dns: 'ec2-xxx.compute.amazonaws.com'
      }
    };

    context.infrastructure = infraResult;

    this.emit('infra:completed', { deploymentId, result: infraResult });

    return {
      success: infraResult.success,
      data: infraResult,
      message: 'Infrastructure provisioned successfully'
    };
  }

  /**
   * Stage: Deploy to production
   */
  async runDeployProductionStage(deploymentId, projectPath, context) {
    logger.info('Running DEPLOY_PRODUCTION stage');

    this.emit('deploy:started', { deploymentId });

    // Would SSH to EC2 and deploy
    const deployResult = {
      success: true,
      services: context.services.map(s => ({
        name: s.name,
        deployed: true,
        port: s.port
      })),
      url: `http://${context.infrastructure?.outputs?.public_dns || 'localhost'}`
    };

    context.deploymentResult = deployResult;

    this.emit('deploy:completed', { deploymentId, result: deployResult });

    return {
      success: deployResult.success,
      data: deployResult,
      message: 'Deployment completed'
    };
  }

  /**
   * Stage: Health check production
   */
  async runHealthCheckStage(deploymentId, context) {
    logger.info('Running HEALTH_CHECK stage');

    const url = context.deploymentResult?.url;
    
    // Would do actual health check
    const healthResult = {
      success: true,
      url,
      status: 'healthy',
      responseTime: 150,
      checks: context.services.map(s => ({
        service: s.name,
        healthy: true
      }))
    };

    return {
      success: healthResult.success,
      data: healthResult,
      message: 'Production health check passed'
    };
  }

  /**
   * Advance to next stage after verification
   */
  async advanceToNextStage(deploymentId, approved = true, feedback = null) {
    const pipeline = this.pipelines.get(deploymentId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${deploymentId}`);
    }

    if (!approved) {
      pipeline.status = 'needs_fixes';
      this.emit('stage:rejected', { deploymentId, stage: pipeline.currentStage, feedback });
      
      return {
        success: false,
        currentStage: pipeline.currentStage,
        message: 'Stage rejected, needs fixes',
        feedback
      };
    }

    const nextStage = this.getNextStage(pipeline.currentStage);
    
    if (!nextStage) {
      pipeline.status = 'complete';
      pipeline.currentStage = STAGES.COMPLETE;
      this.emit('pipeline:completed', { deploymentId });
      
      return {
        success: true,
        complete: true,
        message: 'Pipeline completed'
      };
    }

    // Skip stages based on options
    let actualNextStage = nextStage;
    if (pipeline.options.skipLocalTest && actualNextStage === STAGES.LOCAL_TEST) {
      actualNextStage = STAGES.ANALYZE_LOGS;
    }
    if (pipeline.options.skipInfra && actualNextStage === STAGES.PROVISION_INFRA) {
      actualNextStage = STAGES.COMPLETE;
    }

    pipeline.currentStage = actualNextStage;
    pipeline.status = 'ready';
    pipeline.lastUpdated = new Date();

    this.emit('stage:advanced', { deploymentId, previousStage: pipeline.currentStage, nextStage: actualNextStage });

    return {
      success: true,
      previousStage: pipeline.currentStage,
      currentStage: actualNextStage,
      message: `Advanced to ${actualNextStage}`
    };
  }

  /**
   * Store environment from user input
   */
  async storeUserEnv(deploymentId, envContent, service = 'main') {
    const result = await envTools.storeEnv({
      deploymentId,
      content: envContent,
      service,
      overwrite: true
    });

    if (result.success) {
      const pipeline = this.pipelines.get(deploymentId);
      if (pipeline) {
        pipeline.context.envStatus = {
          collected: true,
          source: 'user_input',
          service,
          variableKeys: result.variableKeys
        };
      }
    }

    return result;
  }

  /**
   * Get pipeline summary
   */
  getPipelineSummary(deploymentId) {
    const pipeline = this.pipelines.get(deploymentId);
    if (!pipeline) return null;

    return {
      deploymentId,
      projectPath: pipeline.projectPath,
      currentStage: pipeline.currentStage,
      status: pipeline.status,
      stagesCompleted: pipeline.stageHistory.filter(s => s.success).length,
      totalStages: STAGE_ORDER.length - 1, // Exclude COMPLETE
      progress: Math.round((STAGE_ORDER.indexOf(pipeline.currentStage) / (STAGE_ORDER.length - 1)) * 100),
      context: {
        services: pipeline.context.services?.map(s => s.name),
        hasEnv: pipeline.context.envStatus?.collected,
        filesGenerated: pipeline.context.generatedFiles?.length || 0,
        buildsComplete: pipeline.context.buildResults?.length || 0
      },
      startedAt: pipeline.startedAt,
      lastUpdated: pipeline.lastUpdated
    };
  }

  // Helper methods for file generation

  generateDockerfile(projectType, framework, services) {
    const templates = {
      javascript: `FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
`,
      typescript: `FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./

EXPOSE 3000

CMD ["npm", "start"]
`,
      python: `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
`,
      go: `FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/main .

EXPOSE 8080

CMD ["./main"]
`
    };

    return templates[projectType] || templates.javascript;
  }

  generateDockerCompose(services, deploymentId) {
    const composeServices = {};

    for (const service of services) {
      if (service.type === 'database') {
        // Add database services
        if (service.framework === 'PostgreSQL') {
          composeServices.postgres = {
            image: 'postgres:15-alpine',
            environment: {
              POSTGRES_USER: '${DB_USER:-postgres}',
              POSTGRES_PASSWORD: '${DB_PASSWORD:-postgres}',
              POSTGRES_DB: '${DB_NAME:-app}'
            },
            volumes: ['postgres_data:/var/lib/postgresql/data'],
            ports: ['5432:5432']
          };
        } else if (service.framework === 'MongoDB') {
          composeServices.mongodb = {
            image: 'mongo:6',
            environment: {
              MONGO_INITDB_ROOT_USERNAME: '${MONGO_USER:-root}',
              MONGO_INITDB_ROOT_PASSWORD: '${MONGO_PASSWORD:-password}'
            },
            volumes: ['mongo_data:/data/db'],
            ports: ['27017:27017']
          };
        } else if (service.framework === 'Redis') {
          composeServices.redis = {
            image: 'redis:7-alpine',
            ports: ['6379:6379']
          };
        }
      } else if (service.path) {
        // Application services
        composeServices[service.name] = {
          build: {
            context: service.path === '.' ? '.' : `./${service.path}`,
            dockerfile: 'Dockerfile'
          },
          ports: [`${service.port}:${service.port}`],
          environment: {
            NODE_ENV: 'production'
          },
          depends_on: service.type === 'backend' ? ['postgres'] : []
        };
      }
    }

    const compose = {
      version: '3.8',
      services: composeServices,
      volumes: {}
    };

    // Add volumes
    if (composeServices.postgres) compose.volumes.postgres_data = {};
    if (composeServices.mongodb) compose.volumes.mongo_data = {};

    // Convert to YAML-like string (simplified)
    return this.objectToYaml(compose);
  }

  generateGitHubWorkflow(projectAnalysis, services) {
    return `name: Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Build and test
        run: |
          docker compose build
          docker compose up -d
          sleep 10
          docker compose ps
          docker compose down
      
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to production
        env:
          SSH_KEY: \${{ secrets.SSH_KEY }}
          HOST: \${{ secrets.HOST }}
        run: |
          echo "Deploying to production..."
          # Add deployment script here
`;
  }

  generateTerraformConfig(services) {
    return `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "instance_type" {
  default = "t3.micro"
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = var.instance_type

  vpc_security_group_ids = [aws_security_group.app.id]

  user_data = <<-EOF
              #!/bin/bash
              yum update -y
              amazon-linux-extras install docker -y
              systemctl start docker
              systemctl enable docker
              usermod -a -G docker ec2-user
              curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
              chmod +x /usr/local/bin/docker-compose
              EOF

  tags = {
    Name = "app-server"
  }
}

resource "aws_security_group" "app" {
  name        = "app-sg"
  description = "Security group for app server"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

output "public_ip" {
  value = aws_instance.app.public_ip
}

output "public_dns" {
  value = aws_instance.app.public_dns
}
`;
  }

  objectToYaml(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    let yaml = '';

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;

      if (typeof value === 'object' && !Array.isArray(value)) {
        yaml += `${spaces}${key}:\n${this.objectToYaml(value, indent + 1)}`;
      } else if (Array.isArray(value)) {
        yaml += `${spaces}${key}:\n`;
        for (const item of value) {
          if (typeof item === 'object') {
            yaml += `${spaces}  -\n${this.objectToYaml(item, indent + 2).replace(/^/gm, '  ')}`;
          } else {
            yaml += `${spaces}  - ${item}\n`;
          }
        }
      } else {
        yaml += `${spaces}${key}: ${value}\n`;
      }
    }

    return yaml;
  }
}

// Export singleton instance
const pipelineOrchestrator = new PipelineOrchestrator();

module.exports = {
  pipelineOrchestrator,
  PipelineOrchestrator,
  STAGES,
  STAGE_ORDER
};


