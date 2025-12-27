const Deployment = require('../../models/Deployment');
const Sandbox = require('../../models/Sandbox');
const sandboxService = require('../../services/sandbox');
const logger = require('../../utils/logger');

/**
 * Sandbox-related MCP tools
 * These tools expose sandbox operations for Cursor AI integration
 */

const tools = [
  {
    name: 'create_sandbox',
    description: 'Create a sandbox environment for testing infrastructure',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to create sandbox for'
        },
        durationHours: {
          type: 'number',
          description: 'Duration in hours before sandbox auto-expires (default: 4)'
        },
        isolationLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Isolation level for the sandbox (default: medium)'
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

        const sandbox = await sandboxService.createSandbox({
          deploymentId: args.deploymentId,
          durationHours: args.durationHours || 4,
          isolationLevel: args.isolationLevel || 'medium',
          terraformCode: deployment.terraformCode
        });

        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          deploymentId: args.deploymentId,
          status: sandbox.status,
          expiresAt: sandbox.expiresAt,
          message: 'Sandbox created successfully'
        };
      } catch (error) {
        logger.error('Failed to create sandbox via MCP:', error);
        throw new Error(`Failed to create sandbox: ${error.message}`);
      }
    }
  },

  {
    name: 'deploy_to_sandbox',
    description: 'Deploy infrastructure to a sandbox environment for testing',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to deploy to sandbox'
        },
        durationHours: {
          type: 'number',
          description: 'Duration in hours (default: 4)'
        },
        runTests: {
          type: 'boolean',
          description: 'Run automated tests after deployment (default: true)'
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

        if (!deployment.terraformCode?.main) {
          throw new Error('No Terraform code found for this deployment');
        }

        const result = await sandboxService.deployToSandbox({
          deploymentId: args.deploymentId,
          durationHours: args.durationHours || 4,
          runTests: args.runTests !== false,
          terraformCode: deployment.terraformCode
        });

        return {
          success: true,
          sandboxId: result.sandboxId,
          deploymentId: args.deploymentId,
          status: result.status,
          resources: result.resources,
          testResults: result.testResults,
          message: 'Deployed to sandbox successfully'
        };
      } catch (error) {
        logger.error('Failed to deploy to sandbox via MCP:', error);
        throw new Error(`Failed to deploy to sandbox: ${error.message}`);
      }
    }
  },

  {
    name: 'get_sandbox_status',
    description: 'Get the status of a sandbox environment',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'Sandbox ID to check'
        },
        deploymentId: {
          type: 'string',
          description: 'Or deployment ID to find sandbox for'
        }
      }
    },
    handler: async (args) => {
      try {
        let sandbox;

        if (args.sandboxId) {
          sandbox = await Sandbox.findOne({ sandboxId: args.sandboxId });
        } else if (args.deploymentId) {
          sandbox = await Sandbox.findOne({ deploymentId: args.deploymentId })
            .sort({ createdAt: -1 });
        }

        if (!sandbox) {
          throw new Error('Sandbox not found');
        }

        return {
          sandboxId: sandbox.sandboxId,
          deploymentId: sandbox.deploymentId,
          status: sandbox.status,
          createdAt: sandbox.createdAt,
          expiresAt: sandbox.expiresAt,
          resources: sandbox.resources,
          testResults: sandbox.testResults,
          outputs: sandbox.outputs
        };
      } catch (error) {
        logger.error('Failed to get sandbox status via MCP:', error);
        throw new Error(`Failed to get sandbox status: ${error.message}`);
      }
    }
  },

  {
    name: 'run_sandbox_tests',
    description: 'Run tests on a sandbox environment',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'Sandbox ID to run tests on'
        },
        testTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Types of tests to run (e.g., health, connectivity, security)'
        }
      },
      required: ['sandboxId']
    },
    handler: async (args) => {
      try {
        const sandbox = await Sandbox.findOne({ sandboxId: args.sandboxId });
        if (!sandbox) {
          throw new Error(`Sandbox not found: ${args.sandboxId}`);
        }

        if (sandbox.status !== 'DEPLOYED') {
          throw new Error(`Sandbox is not deployed. Current status: ${sandbox.status}`);
        }

        const testResults = await sandboxService.runTests({
          sandboxId: args.sandboxId,
          testTypes: args.testTypes || ['health', 'connectivity']
        });

        return {
          success: true,
          sandboxId: args.sandboxId,
          testResults: {
            passed: testResults.passed,
            failed: testResults.failed,
            total: testResults.total,
            details: testResults.details
          }
        };
      } catch (error) {
        logger.error('Failed to run sandbox tests via MCP:', error);
        throw new Error(`Failed to run sandbox tests: ${error.message}`);
      }
    }
  },

  {
    name: 'destroy_sandbox',
    description: 'Destroy a sandbox environment and clean up resources',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'Sandbox ID to destroy'
        },
        force: {
          type: 'boolean',
          description: 'Force destruction even if tests are running (default: false)'
        }
      },
      required: ['sandboxId']
    },
    handler: async (args) => {
      try {
        const sandbox = await Sandbox.findOne({ sandboxId: args.sandboxId });
        if (!sandbox) {
          throw new Error(`Sandbox not found: ${args.sandboxId}`);
        }

        if (sandbox.status === 'TESTING' && !args.force) {
          throw new Error('Sandbox has tests running. Set force=true to destroy anyway.');
        }

        await sandboxService.destroySandbox({
          sandboxId: args.sandboxId,
          force: args.force
        });

        return {
          success: true,
          sandboxId: args.sandboxId,
          message: 'Sandbox destroyed successfully'
        };
      } catch (error) {
        logger.error('Failed to destroy sandbox via MCP:', error);
        throw new Error(`Failed to destroy sandbox: ${error.message}`);
      }
    }
  },

  {
    name: 'promote_sandbox',
    description: 'Promote a validated sandbox to production deployment',
    inputSchema: {
      type: 'object',
      properties: {
        sandboxId: {
          type: 'string',
          description: 'Sandbox ID to promote'
        },
        requireApproval: {
          type: 'boolean',
          description: 'Require approval before production deployment (default: true)'
        }
      },
      required: ['sandboxId']
    },
    handler: async (args) => {
      try {
        const sandbox = await Sandbox.findOne({ sandboxId: args.sandboxId });
        if (!sandbox) {
          throw new Error(`Sandbox not found: ${args.sandboxId}`);
        }

        if (sandbox.status !== 'VALIDATED') {
          throw new Error(`Sandbox is not validated. Current status: ${sandbox.status}. Run tests first.`);
        }

        const deployment = await Deployment.findOne({ deploymentId: sandbox.deploymentId });
        if (!deployment) {
          throw new Error(`Parent deployment not found: ${sandbox.deploymentId}`);
        }

        const deploymentOrchestrator = require('../../services/deploymentOrchestrator');

        if (args.requireApproval !== false) {
          await deploymentOrchestrator.transitionState(
            deployment.deploymentId,
            'PENDING_APPROVAL',
            { promotedFromSandbox: args.sandboxId }
          );

          return {
            success: true,
            deploymentId: deployment.deploymentId,
            status: 'PENDING_APPROVAL',
            message: 'Sandbox promoted. Awaiting approval for production deployment.'
          };
        } else {
          await deploymentOrchestrator.transitionState(
            deployment.deploymentId,
            'APPROVED',
            { promotedFromSandbox: args.sandboxId }
          );

          return {
            success: true,
            deploymentId: deployment.deploymentId,
            status: 'APPROVED',
            message: 'Sandbox promoted. Proceeding with production deployment.'
          };
        }
      } catch (error) {
        logger.error('Failed to promote sandbox via MCP:', error);
        throw new Error(`Failed to promote sandbox: ${error.message}`);
      }
    }
  },

  {
    name: 'list_sandboxes',
    description: 'List all sandboxes with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Filter by deployment ID'
        },
        status: {
          type: 'string',
          description: 'Filter by sandbox status'
        },
        includeExpired: {
          type: 'boolean',
          description: 'Include expired sandboxes (default: false)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of sandboxes to return (default: 20)'
        }
      }
    },
    handler: async (args) => {
      try {
        const query = {};

        if (args.deploymentId) {
          query.deploymentId = args.deploymentId;
        }
        if (args.status) {
          query.status = args.status;
        }
        if (!args.includeExpired) {
          query.$or = [
            { expiresAt: { $gt: new Date() } },
            { status: { $in: ['ACTIVE', 'DEPLOYED', 'TESTING'] } }
          ];
        }

        const sandboxes = await Sandbox.find(query)
          .sort({ createdAt: -1 })
          .limit(args.limit || 20)
          .select('sandboxId deploymentId status createdAt expiresAt');

        return {
          count: sandboxes.length,
          sandboxes: sandboxes.map(s => ({
            sandboxId: s.sandboxId,
            deploymentId: s.deploymentId,
            status: s.status,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt
          }))
        };
      } catch (error) {
        logger.error('Failed to list sandboxes via MCP:', error);
        throw new Error(`Failed to list sandboxes: ${error.message}`);
      }
    }
  }
];

/**
 * Get all sandbox tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};





