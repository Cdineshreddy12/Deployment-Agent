const Deployment = require('../../models/Deployment');
const DeploymentLog = require('../../models/DeploymentLog');
const Cost = require('../../models/Cost');
const logger = require('../../utils/logger');

/**
 * Monitoring-related MCP tools
 * These tools expose monitoring and observability operations for Cursor AI integration
 */

const tools = [
  {
    name: 'get_deployment_health',
    description: 'Get health status of a deployed infrastructure',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to check health for'
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

        if (deployment.status !== 'DEPLOYED') {
          return {
            deploymentId: args.deploymentId,
            status: deployment.status,
            healthy: false,
            message: `Deployment is not in DEPLOYED state. Current status: ${deployment.status}`
          };
        }

        // Get health metrics from AWS or monitoring service
        const awsService = require('../../services/aws');
        const healthMetrics = await awsService.getResourceHealth(deployment.resources);

        return {
          deploymentId: args.deploymentId,
          status: deployment.status,
          healthy: healthMetrics.allHealthy,
          metrics: {
            totalResources: healthMetrics.total,
            healthyResources: healthMetrics.healthy,
            unhealthyResources: healthMetrics.unhealthy,
            unknown: healthMetrics.unknown
          },
          resources: healthMetrics.details,
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        logger.error('Failed to get deployment health via MCP:', error);
        throw new Error(`Failed to get deployment health: ${error.message}`);
      }
    }
  },

  {
    name: 'get_cost_report',
    description: 'Get cost analysis and breakdown for a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to get costs for'
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'monthly'],
          description: 'Cost reporting period (default: monthly)'
        },
        startDate: {
          type: 'string',
          description: 'Start date for cost report (ISO format)'
        },
        endDate: {
          type: 'string',
          description: 'End date for cost report (ISO format)'
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

        const costService = require('../../services/cost');
        const costReport = await costService.getCostReport({
          deploymentId: args.deploymentId,
          period: args.period || 'monthly',
          startDate: args.startDate,
          endDate: args.endDate
        });

        return {
          deploymentId: args.deploymentId,
          period: args.period || 'monthly',
          costs: {
            total: costReport.total,
            currency: 'USD',
            breakdown: costReport.breakdown,
            trend: costReport.trend,
            forecast: costReport.forecast
          },
          recommendations: costReport.recommendations
        };
      } catch (error) {
        logger.error('Failed to get cost report via MCP:', error);
        throw new Error(`Failed to get cost report: ${error.message}`);
      }
    }
  },

  {
    name: 'get_metrics',
    description: 'Get performance metrics for deployed resources',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to get metrics for'
        },
        resourceType: {
          type: 'string',
          enum: ['ec2', 'rds', 'lambda', 'ecs', 'all'],
          description: 'Type of resources to get metrics for (default: all)'
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific metrics to retrieve (e.g., CPUUtilization, MemoryUtilization)'
        },
        period: {
          type: 'string',
          enum: ['1h', '6h', '24h', '7d', '30d'],
          description: 'Time period for metrics (default: 24h)'
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

        if (deployment.status !== 'DEPLOYED') {
          throw new Error(`Deployment is not deployed. Current status: ${deployment.status}`);
        }

        const awsService = require('../../services/aws');
        const metrics = await awsService.getCloudWatchMetrics({
          resources: deployment.resources,
          resourceType: args.resourceType || 'all',
          metrics: args.metrics,
          period: args.period || '24h'
        });

        return {
          deploymentId: args.deploymentId,
          period: args.period || '24h',
          metrics: metrics.data,
          summary: metrics.summary
        };
      } catch (error) {
        logger.error('Failed to get metrics via MCP:', error);
        throw new Error(`Failed to get metrics: ${error.message}`);
      }
    }
  },

  {
    name: 'get_alerts',
    description: 'Get active alerts and alarms for a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to get alerts for'
        },
        severity: {
          type: 'string',
          enum: ['critical', 'warning', 'info', 'all'],
          description: 'Filter by severity (default: all)'
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

        const awsService = require('../../services/aws');
        const alerts = await awsService.getAlerts({
          resources: deployment.resources,
          severity: args.severity
        });

        return {
          deploymentId: args.deploymentId,
          alerts: {
            critical: alerts.critical || [],
            warning: alerts.warning || [],
            info: alerts.info || []
          },
          totalCount: alerts.total,
          activeCount: alerts.active
        };
      } catch (error) {
        logger.error('Failed to get alerts via MCP:', error);
        throw new Error(`Failed to get alerts: ${error.message}`);
      }
    }
  },

  {
    name: 'create_alert',
    description: 'Create a monitoring alert for a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to create alert for'
        },
        name: {
          type: 'string',
          description: 'Name of the alert'
        },
        metric: {
          type: 'string',
          description: 'Metric to monitor (e.g., CPUUtilization)'
        },
        threshold: {
          type: 'number',
          description: 'Threshold value to trigger alert'
        },
        comparison: {
          type: 'string',
          enum: ['GreaterThan', 'LessThan', 'GreaterThanOrEqual', 'LessThanOrEqual'],
          description: 'Comparison operator'
        },
        severity: {
          type: 'string',
          enum: ['critical', 'warning', 'info'],
          description: 'Alert severity'
        }
      },
      required: ['deploymentId', 'name', 'metric', 'threshold', 'comparison']
    },
    handler: async (args) => {
      try {
        const deployment = await Deployment.findOne({ deploymentId: args.deploymentId });
        if (!deployment) {
          throw new Error(`Deployment not found: ${args.deploymentId}`);
        }

        const awsService = require('../../services/aws');
        const alert = await awsService.createAlert({
          deploymentId: args.deploymentId,
          name: args.name,
          metric: args.metric,
          threshold: args.threshold,
          comparison: args.comparison,
          severity: args.severity || 'warning',
          resources: deployment.resources
        });

        return {
          success: true,
          alertId: alert.alertId,
          deploymentId: args.deploymentId,
          message: `Alert "${args.name}" created successfully`
        };
      } catch (error) {
        logger.error('Failed to create alert via MCP:', error);
        throw new Error(`Failed to create alert: ${error.message}`);
      }
    }
  },

  {
    name: 'get_audit_logs',
    description: 'Get audit logs for deployment actions',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Filter by deployment ID'
        },
        action: {
          type: 'string',
          description: 'Filter by action type (e.g., create, update, deploy)'
        },
        startDate: {
          type: 'string',
          description: 'Start date for logs (ISO format)'
        },
        endDate: {
          type: 'string',
          description: 'End date for logs (ISO format)'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of logs to return (default: 50)'
        }
      }
    },
    handler: async (args) => {
      try {
        const AuditLog = require('../../models/AuditLog');
        
        const query = {};
        if (args.deploymentId) query.deploymentId = args.deploymentId;
        if (args.action) query.action = args.action;
        if (args.startDate || args.endDate) {
          query.timestamp = {};
          if (args.startDate) query.timestamp.$gte = new Date(args.startDate);
          if (args.endDate) query.timestamp.$lte = new Date(args.endDate);
        }

        const logs = await AuditLog.find(query)
          .sort({ timestamp: -1 })
          .limit(args.limit || 50);

        return {
          count: logs.length,
          logs: logs.map(log => ({
            id: log._id,
            deploymentId: log.deploymentId,
            action: log.action,
            actor: log.actor,
            details: log.details,
            timestamp: log.timestamp
          }))
        };
      } catch (error) {
        logger.error('Failed to get audit logs via MCP:', error);
        throw new Error(`Failed to get audit logs: ${error.message}`);
      }
    }
  },

  {
    name: 'get_resource_inventory',
    description: 'Get inventory of all resources in a deployment',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID to get inventory for'
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

        const resources = deployment.resources || [];
        
        // Group resources by type
        const inventory = resources.reduce((acc, resource) => {
          const type = resource.type || 'unknown';
          if (!acc[type]) {
            acc[type] = [];
          }
          acc[type].push({
            id: resource.id,
            name: resource.name,
            status: resource.status,
            region: resource.region,
            tags: resource.tags
          });
          return acc;
        }, {});

        return {
          deploymentId: args.deploymentId,
          totalResources: resources.length,
          inventory,
          resourceTypes: Object.keys(inventory),
          lastUpdated: deployment.updatedAt
        };
      } catch (error) {
        logger.error('Failed to get resource inventory via MCP:', error);
        throw new Error(`Failed to get resource inventory: ${error.message}`);
      }
    }
  },

  {
    name: 'compare_deployments',
    description: 'Compare two deployments to identify differences',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId1: {
          type: 'string',
          description: 'First deployment ID'
        },
        deploymentId2: {
          type: 'string',
          description: 'Second deployment ID'
        }
      },
      required: ['deploymentId1', 'deploymentId2']
    },
    handler: async (args) => {
      try {
        const deployment1 = await Deployment.findOne({ deploymentId: args.deploymentId1 });
        const deployment2 = await Deployment.findOne({ deploymentId: args.deploymentId2 });

        if (!deployment1) {
          throw new Error(`Deployment not found: ${args.deploymentId1}`);
        }
        if (!deployment2) {
          throw new Error(`Deployment not found: ${args.deploymentId2}`);
        }

        // Compare key attributes
        const comparison = {
          status: {
            deployment1: deployment1.status,
            deployment2: deployment2.status,
            different: deployment1.status !== deployment2.status
          },
          environment: {
            deployment1: deployment1.environment,
            deployment2: deployment2.environment,
            different: deployment1.environment !== deployment2.environment
          },
          region: {
            deployment1: deployment1.region,
            deployment2: deployment2.region,
            different: deployment1.region !== deployment2.region
          },
          resourceCount: {
            deployment1: deployment1.resources?.length || 0,
            deployment2: deployment2.resources?.length || 0,
            different: (deployment1.resources?.length || 0) !== (deployment2.resources?.length || 0)
          },
          estimatedCost: {
            deployment1: deployment1.estimatedCost?.monthlyTotal,
            deployment2: deployment2.estimatedCost?.monthlyTotal,
            different: deployment1.estimatedCost?.monthlyTotal !== deployment2.estimatedCost?.monthlyTotal
          }
        };

        const differences = Object.entries(comparison)
          .filter(([_, v]) => v.different)
          .map(([k, _]) => k);

        return {
          deployment1: args.deploymentId1,
          deployment2: args.deploymentId2,
          comparison,
          differencesCount: differences.length,
          differences
        };
      } catch (error) {
        logger.error('Failed to compare deployments via MCP:', error);
        throw new Error(`Failed to compare deployments: ${error.message}`);
      }
    }
  }
];

/**
 * Get all monitoring tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};





