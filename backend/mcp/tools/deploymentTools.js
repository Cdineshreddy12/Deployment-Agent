const Deployment = require('../../models/Deployment');
const deploymentOrchestrator = require('../../services/deploymentOrchestrator');
const logger = require('../../utils/logger');

/**
 * Deployment-related MCP tools
 * These tools expose deployment operations for Cursor AI integration
 */

const tools = [
  {
    name: 'create_deployment',
    description: 'Create a new deployment from a GitHub repository or infrastructure requirements',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the deployment'
        },
        description: {
          type: 'string',
          description: 'Description of what is being deployed'
        },
        environment: {
          type: 'string',
          enum: ['development', 'staging', 'production'],
          description: 'Target environment for deployment'
        },
        region: {
          type: 'string',
          description: 'AWS region for deployment (default: us-east-1)'
        },
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL to deploy'
        },
        repositoryBranch: {
          type: 'string',
          description: 'Branch to deploy (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub personal access token for private repositories'
        }
      },
      required: ['name', 'environment']
    },
    handler: async (args) => {
      try {
        const deployment = new Deployment({
          name: args.name,
          description: args.description || '',
          environment: args.environment,
          region: args.region || 'us-east-1',
          repositoryUrl: args.repositoryUrl,
          repositoryBranch: args.repositoryBranch || 'main',
          githubToken: args.githubToken,
          // Use system user for MCP-created deployments
          userId: process.env.MCP_SYSTEM_USER_ID || '000000000000000000000000',
          userName: 'MCP System',
          userEmail: 'mcp@deployment-agent.local',
          status: 'INITIATED',
          tags: {
            Environment: args.environment,
            CreatedBy: 'MCP',
            ManagedBy: 'deployment-platform'
          }
        });

        await deployment.save();

        // Start deployment process
        setTimeout(() => {
          deploymentOrchestrator.processDeployment(deployment.deploymentId).catch(err => {
            logger.error('Deployment processing error:', err);
          });
        }, 100);

        return {
          success: true,
          deploymentId: deployment.deploymentId,
          status: deployment.status,
          message: `Deployment "${args.name}" created successfully. Deployment ID: ${deployment.deploymentId}`
        };
      } catch (error) {
        logger.error('Failed to create deployment via MCP:', error);
        throw new Error(`Failed to create deployment: ${error.message}`);
      }
    }
  },

  {
    name: 'get_deployment_status',
    description: 'Get the current status and details of a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID to check'
        }
      },
      required: ['deploymentId']
    },
    handler: async (args) => {
      try {
        const deployment = await Deployment.findOne({ deploymentId: args.deploymentId });
        
        if (!deployment) {
          throw new Error(`Deployment not found: ${args.deploymentId}`);
        }

        return {
          deploymentId: deployment.deploymentId,
          name: deployment.name,
          status: deployment.status,
          previousStatus: deployment.previousStatus,
          environment: deployment.environment,
          region: deployment.region,
          repositoryUrl: deployment.repositoryUrl,
          createdAt: deployment.createdAt,
          updatedAt: deployment.updatedAt,
          statusHistory: deployment.statusHistory?.slice(-5) || [],
          estimatedCost: deployment.estimatedCost,
          resources: deployment.resources
        };
      } catch (error) {
        logger.error('Failed to get deployment status via MCP:', error);
        throw new Error(`Failed to get deployment status: ${error.message}`);
      }
    }
  },

  {
    name: 'list_deployments',
    description: 'List all deployments with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by deployment status'
        },
        environment: {
          type: 'string',
          enum: ['development', 'staging', 'production'],
          description: 'Filter by environment'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of deployments to return (default: 20)'
        }
      }
    },
    handler: async (args) => {
      try {
        const query = {};
        
        if (args.status) {
          query.status = args.status;
        }
        if (args.environment) {
          query.environment = args.environment;
        }

        const deployments = await Deployment.find(query)
          .sort({ createdAt: -1 })
          .limit(args.limit || 20)
          .select('deploymentId name status environment region createdAt updatedAt');

        return {
          count: deployments.length,
          deployments: deployments.map(d => ({
            deploymentId: d.deploymentId,
            name: d.name,
            status: d.status,
            environment: d.environment,
            region: d.region,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt
          }))
        };
      } catch (error) {
        logger.error('Failed to list deployments via MCP:', error);
        throw new Error(`Failed to list deployments: ${error.message}`);
      }
    }
  },

  {
    name: 'update_deployment',
    description: 'Update deployment configuration or settings',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID to update'
        },
        name: {
          type: 'string',
          description: 'New name for the deployment'
        },
        description: {
          type: 'string',
          description: 'New description'
        },
        region: {
          type: 'string',
          description: 'New AWS region'
        }
      },
      required: ['deploymentId']
    },
    handler: async (args) => {
      try {
        const deployment = await Deployment.findOne({ deploymentId: args.deploymentId });
        
        if (!deployment) {
          throw new Error(`Deployment not found: ${args.deploymentId}`);
        }

        // Only allow updates in certain states
        const allowedStates = ['INITIATED', 'GATHERING', 'PLANNING', 'ENV_COLLECTION'];
        if (!allowedStates.includes(deployment.status)) {
          throw new Error(`Cannot update deployment in ${deployment.status} state`);
        }

        if (args.name) deployment.name = args.name;
        if (args.description) deployment.description = args.description;
        if (args.region) deployment.region = args.region;

        await deployment.save();

        return {
          success: true,
          deploymentId: deployment.deploymentId,
          message: 'Deployment updated successfully'
        };
      } catch (error) {
        logger.error('Failed to update deployment via MCP:', error);
        throw new Error(`Failed to update deployment: ${error.message}`);
      }
    }
  },

  {
    name: 'cancel_deployment',
    description: 'Cancel a running or pending deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID to cancel'
        },
        reason: {
          type: 'string',
          description: 'Reason for cancellation'
        }
      },
      required: ['deploymentId']
    },
    handler: async (args) => {
      try {
        const deployment = await Deployment.findOne({ deploymentId: args.deploymentId });
        
        if (!deployment) {
          throw new Error(`Deployment not found: ${args.deploymentId}`);
        }

        const terminalStates = ['DEPLOYED', 'DESTROYED', 'CANCELLED', 'ROLLED_BACK'];
        if (terminalStates.includes(deployment.status)) {
          throw new Error(`Cannot cancel deployment in ${deployment.status} state`);
        }

        await deploymentOrchestrator.transitionState(
          args.deploymentId, 
          'CANCELLED', 
          { reason: args.reason || 'Cancelled via MCP' }
        );

        return {
          success: true,
          deploymentId: args.deploymentId,
          previousStatus: deployment.status,
          message: `Deployment cancelled. Previous status was: ${deployment.status}`
        };
      } catch (error) {
        logger.error('Failed to cancel deployment via MCP:', error);
        throw new Error(`Failed to cancel deployment: ${error.message}`);
      }
    }
  },

  {
    name: 'rollback_deployment',
    description: 'Rollback a deployment to a previous version',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID to rollback'
        },
        targetVersion: {
          type: 'string',
          description: 'Target version to rollback to (optional, defaults to previous version)'
        }
      },
      required: ['deploymentId']
    },
    handler: async (args) => {
      try {
        const deployment = await Deployment.findOne({ deploymentId: args.deploymentId });
        
        if (!deployment) {
          throw new Error(`Deployment not found: ${args.deploymentId}`);
        }

        if (deployment.status !== 'DEPLOYED' && deployment.status !== 'DEPLOYMENT_FAILED') {
          throw new Error(`Cannot rollback deployment in ${deployment.status} state. Must be DEPLOYED or DEPLOYMENT_FAILED.`);
        }

        // Check if there are previous versions
        if (!deployment.previousVersions || deployment.previousVersions.length === 0) {
          throw new Error('No previous versions available for rollback');
        }

        await deploymentOrchestrator.transitionState(
          args.deploymentId, 
          'ROLLING_BACK',
          { targetVersion: args.targetVersion }
        );

        return {
          success: true,
          deploymentId: args.deploymentId,
          message: 'Rollback initiated. Monitor status for progress.',
          availableVersions: deployment.previousVersions?.map(v => v.version) || []
        };
      } catch (error) {
        logger.error('Failed to rollback deployment via MCP:', error);
        throw new Error(`Failed to rollback deployment: ${error.message}`);
      }
    }
  },

  {
    name: 'analyze_repository',
    description: 'Analyze a GitHub repository to determine deployment requirements and suggest infrastructure',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL to analyze'
        },
        branch: {
          type: 'string',
          description: 'Branch to analyze (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token for private repositories'
        }
      },
      required: ['repositoryUrl']
    },
    handler: async (args) => {
      try {
        const githubAnalysis = require('../../services/githubAnalysis');
        
        const analysis = await githubAnalysis.analyzeRepository(
          args.repositoryUrl,
          args.branch || 'main',
          args.githubToken
        );

        return {
          success: true,
          repositoryUrl: args.repositoryUrl,
          analysis: {
            projectType: analysis.projectType,
            framework: analysis.framework,
            language: analysis.language,
            hasDocker: analysis.hasDocker,
            hasTerraform: analysis.hasTerraform,
            dependencies: analysis.dependencies,
            suggestedInfrastructure: analysis.suggestedInfrastructure,
            environmentVariables: analysis.detectedEnvVars
          }
        };
      } catch (error) {
        logger.error('Failed to analyze repository via MCP:', error);
        throw new Error(`Failed to analyze repository: ${error.message}`);
      }
    }
  },

  {
    name: 'get_deployment_logs',
    description: 'Retrieve logs for a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'The deployment ID'
        },
        level: {
          type: 'string',
          enum: ['info', 'warn', 'error', 'debug'],
          description: 'Filter by log level'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of log entries (default: 50)'
        }
      },
      required: ['deploymentId']
    },
    handler: async (args) => {
      try {
        const DeploymentLog = require('../../models/DeploymentLog');
        
        const query = { deploymentId: args.deploymentId };
        if (args.level) {
          query.level = args.level;
        }

        const logs = await DeploymentLog.find(query)
          .sort({ timestamp: -1 })
          .limit(args.limit || 50);

        return {
          deploymentId: args.deploymentId,
          count: logs.length,
          logs: logs.map(log => ({
            level: log.level,
            message: log.message,
            timestamp: log.timestamp,
            metadata: log.metadata
          }))
        };
      } catch (error) {
        logger.error('Failed to get deployment logs via MCP:', error);
        throw new Error(`Failed to get deployment logs: ${error.message}`);
      }
    }
  }
];

/**
 * Get all deployment tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};





