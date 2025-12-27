const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { mcpServerConfig, getServerCapabilities, validateConfig } = require('../config/mcpServer');
const logger = require('../utils/logger');

// Import tool handlers
const deploymentTools = require('./tools/deploymentTools');
const terraformTools = require('./tools/terraformTools');
const sandboxTools = require('./tools/sandboxTools');
const monitoringTools = require('./tools/monitoringTools');
const dockerTools = require('./tools/dockerTools');
const githubTools = require('./tools/githubTools');
const fileTools = require('./tools/fileTools');
const projectTools = require('./tools/projectTools');
const envTools = require('./tools/envTools');
const sshTools = require('./tools/sshTools');
const ec2Tools = require('./tools/ec2Tools');
const ecrTools = require('./tools/ecrTools');
const ecsTools = require('./tools/ecsTools');
const kubernetesTools = require('./tools/kubernetesTools');
const containerOrchestrationTools = require('./tools/containerOrchestrationTools');

/**
 * MCP Server for Deployment Agent
 * Exposes deployment operations as MCP tools for Cursor AI integration
 */
class DeploymentMCPServer {
  constructor() {
    this.server = null;
    this.tools = new Map();
    this.resources = new Map();
    this.prompts = new Map();
  }

  /**
   * Initialize the MCP server
   */
  async initialize() {
    logger.info('Initializing Deployment Agent MCP Server...');

    // Validate configuration
    if (!validateConfig()) {
      logger.warn('MCP Server configuration has issues, continuing with defaults');
    }

    // Create MCP server instance
    this.server = new Server(
      {
        name: mcpServerConfig.name,
        version: mcpServerConfig.version
      },
      {
        capabilities: getServerCapabilities()
      }
    );

    // Register all tools
    await this.registerTools();

    // Register resources
    await this.registerResources();

    // Register prompts
    await this.registerPrompts();

    // Set up request handlers
    this.setupRequestHandlers();

    // Set up error handling
    this.setupErrorHandling();

    logger.info('MCP Server initialized successfully');
  }

  /**
   * Register all available tools
   */
  async registerTools() {
    logger.info('Registering MCP tools...');

    // Register deployment tools
    deploymentTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Terraform tools
    terraformTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register sandbox tools
    sandboxTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register monitoring tools
    monitoringTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Docker tools
    dockerTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register GitHub tools
    githubTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register File System tools
    fileTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Project Analysis tools
    projectTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Environment Management tools
    envTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register SSH/Remote Execution tools
    sshTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register EC2 Provisioning tools
    ec2Tools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register ECR (Container Registry) tools
    ecrTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register ECS (Container Orchestration) tools
    ecsTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Kubernetes tools
    kubernetesTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    // Register Unified Container Orchestration tools (platform-agnostic)
    containerOrchestrationTools.getTools().forEach(tool => {
      this.tools.set(tool.name, tool);
    });

    logger.info(`Registered ${this.tools.size} MCP tools`);
  }

  /**
   * Register resources for MCP protocol
   */
  async registerResources() {
    logger.info('Registering MCP resources...');

    // Deployment resources
    this.resources.set('deployments://list', {
      uri: 'deployments://list',
      name: 'All Deployments',
      description: 'List of all deployments in the system',
      mimeType: 'application/json'
    });

    this.resources.set('deployments://active', {
      uri: 'deployments://active',
      name: 'Active Deployments',
      description: 'List of currently active deployments',
      mimeType: 'application/json'
    });

    logger.info(`Registered ${this.resources.size} MCP resources`);
  }

  /**
   * Register prompt templates
   */
  async registerPrompts() {
    logger.info('Registering MCP prompts...');

    // Deployment prompts
    this.prompts.set('deploy-application', {
      name: 'deploy-application',
      description: 'Guide through deploying an application',
      arguments: [
        {
          name: 'repositoryUrl',
          description: 'GitHub repository URL',
          required: true
        },
        {
          name: 'environment',
          description: 'Target environment (development, staging, production)',
          required: true
        }
      ]
    });

    this.prompts.set('troubleshoot-deployment', {
      name: 'troubleshoot-deployment',
      description: 'Help troubleshoot a failed deployment',
      arguments: [
        {
          name: 'deploymentId',
          description: 'ID of the deployment to troubleshoot',
          required: true
        }
      ]
    });

    this.prompts.set('optimize-infrastructure', {
      name: 'optimize-infrastructure',
      description: 'Suggest infrastructure optimizations',
      arguments: [
        {
          name: 'deploymentId',
          description: 'ID of the deployment to optimize',
          required: false
        }
      ]
    });

    logger.info(`Registered ${this.prompts.size} MCP prompts`);
  }

  /**
   * Set up request handlers for MCP protocol
   */
  setupRequestHandlers() {
    // Handle list tools request
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      }));

      return { tools };
    });

    // Handle call tool request
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }

      logger.info(`Executing MCP tool: ${name}`, { args });

      try {
        const result = await tool.handler(args);
        
        logger.info(`MCP tool ${name} executed successfully`);

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error(`MCP tool ${name} failed:`, error);
        
        return {
          content: [
            {
              type: 'text',
              text: `Error executing ${name}: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // Handle list resources request
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.resources.values()).map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType
      }));

      return { resources };
    });

    // Handle read resource request
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      logger.info(`Reading MCP resource: ${uri}`);

      try {
        const content = await this.readResource(uri);
        
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(content, null, 2)
            }
          ]
        };
      } catch (error) {
        logger.error(`Failed to read resource ${uri}:`, error);
        throw error;
      }
    });

    // Handle list prompts request
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const prompts = Array.from(this.prompts.values()).map(prompt => ({
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments
      }));

      return { prompts };
    });

    // Handle get prompt request
    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const prompt = this.prompts.get(name);
      if (!prompt) {
        throw new Error(`Unknown prompt: ${name}`);
      }

      const messages = await this.generatePromptMessages(name, args);

      return { messages };
    });
  }

  /**
   * Read a resource by URI
   */
  async readResource(uri) {
    const Deployment = require('../models/Deployment');

    if (uri === 'deployments://list') {
      const deployments = await Deployment.find().sort({ createdAt: -1 }).limit(50);
      return deployments.map(d => ({
        deploymentId: d.deploymentId,
        name: d.name,
        status: d.status,
        environment: d.environment,
        createdAt: d.createdAt
      }));
    }

    if (uri === 'deployments://active') {
      const activeStatuses = ['INITIATED', 'ANALYZING', 'PLANNING', 'VALIDATING', 'DEPLOYING', 'SANDBOX_DEPLOYING'];
      const deployments = await Deployment.find({ status: { $in: activeStatuses } });
      return deployments.map(d => ({
        deploymentId: d.deploymentId,
        name: d.name,
        status: d.status,
        environment: d.environment,
        createdAt: d.createdAt
      }));
    }

    // Handle deployment-specific resources
    const deploymentMatch = uri.match(/^deployments:\/\/(.+)$/);
    if (deploymentMatch) {
      const deploymentId = deploymentMatch[1];
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }
      return deployment.toObject();
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  /**
   * Generate prompt messages based on template
   */
  async generatePromptMessages(name, args) {
    switch (name) {
      case 'deploy-application':
        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I want to deploy an application from ${args.repositoryUrl || 'a GitHub repository'} to the ${args.environment || 'development'} environment. Please help me through the deployment process step by step.`
            }
          }
        ];

      case 'troubleshoot-deployment':
        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `I need help troubleshooting deployment ${args.deploymentId}. Please analyze the deployment logs and help me identify and fix any issues.`
            }
          }
        ];

      case 'optimize-infrastructure':
        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: args.deploymentId
                ? `Please analyze deployment ${args.deploymentId} and suggest infrastructure optimizations for cost and performance.`
                : 'Please help me optimize my infrastructure for better cost efficiency and performance.'
            }
          }
        ];

      default:
        return [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Help me with: ${name}`
            }
          }
        ];
    }
  }

  /**
   * Set up error handling
   */
  setupErrorHandling() {
    this.server.onerror = (error) => {
      logger.error('MCP Server error:', error);
    };

    process.on('SIGINT', async () => {
      logger.info('Shutting down MCP Server...');
      await this.stop();
      process.exit(0);
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async startStdio() {
    logger.info('Starting MCP Server with stdio transport...');

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('MCP Server running with stdio transport');
  }

  /**
   * Stop the MCP server
   */
  async stop() {
    if (this.server) {
      await this.server.close();
      logger.info('MCP Server stopped');
    }
  }
}

// Create singleton instance
const mcpServer = new DeploymentMCPServer();

module.exports = mcpServer;

