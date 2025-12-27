const Deployment = require('../models/Deployment');
const awsService = require('./aws');
const notificationService = require('./notification');
const logger = require('../utils/logger');

/**
 * Deployment Health Monitor
 * Monitors deployed infrastructure and alerts on anomalies
 */
class HealthMonitor {
  constructor() {
    this.monitoredDeployments = new Map();
    this.healthHistory = [];
    this.alertThresholds = {
      cpu: 80,
      memory: 85,
      disk: 90,
      errorRate: 5,
      latency: 1000
    };
  }

  /**
   * Start monitoring a deployment
   * @param {string} deploymentId - Deployment to monitor
   * @param {Object} options - Monitoring options
   */
  async startMonitoring(deploymentId, options = {}) {
    const { intervalMinutes = 5, alertOnAnomaly = true } = options;

    const deployment = await Deployment.findOne({ deploymentId });
    if (!deployment) {
      throw new Error(`Deployment not found: ${deploymentId}`);
    }

    if (deployment.status !== 'DEPLOYED') {
      throw new Error(`Deployment is not deployed. Current status: ${deployment.status}`);
    }

    // Stop existing monitoring if any
    this.stopMonitoring(deploymentId);

    // Start new monitoring interval
    const intervalId = setInterval(
      () => this.checkHealth(deploymentId, alertOnAnomaly),
      intervalMinutes * 60 * 1000
    );

    this.monitoredDeployments.set(deploymentId, {
      intervalId,
      startedAt: new Date(),
      intervalMinutes,
      alertOnAnomaly,
      lastCheck: null,
      status: 'monitoring'
    });

    // Run initial health check
    await this.checkHealth(deploymentId, alertOnAnomaly);

    logger.info(`Started monitoring deployment ${deploymentId} every ${intervalMinutes} minutes`);

    return {
      deploymentId,
      status: 'monitoring',
      intervalMinutes,
      alertOnAnomaly
    };
  }

  /**
   * Stop monitoring a deployment
   * @param {string} deploymentId - Deployment to stop monitoring
   */
  stopMonitoring(deploymentId) {
    const monitoring = this.monitoredDeployments.get(deploymentId);
    
    if (monitoring) {
      clearInterval(monitoring.intervalId);
      this.monitoredDeployments.delete(deploymentId);
      logger.info(`Stopped monitoring deployment ${deploymentId}`);
      return true;
    }

    return false;
  }

  /**
   * Check health of a deployment
   * @param {string} deploymentId - Deployment to check
   * @param {boolean} alertOnAnomaly - Whether to send alerts
   */
  async checkHealth(deploymentId, alertOnAnomaly = true) {
    const startTime = Date.now();

    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }

      const healthChecks = [];
      const alerts = [];

      // Check each resource
      for (const resource of deployment.resources || []) {
        const check = await this.checkResourceHealth(resource);
        healthChecks.push(check);

        // Generate alerts for issues
        if (check.issues && check.issues.length > 0) {
          alerts.push(...check.issues.map(issue => ({
            resourceId: resource.id,
            resourceType: resource.type,
            ...issue
          })));
        }
      }

      // Calculate overall health
      const overallHealth = this.calculateOverallHealth(healthChecks);

      const result = {
        deploymentId,
        timestamp: new Date(),
        duration: Date.now() - startTime,
        overallHealth,
        resourceChecks: healthChecks,
        alerts,
        metrics: this.aggregateMetrics(healthChecks)
      };

      // Store in history
      this.healthHistory.push(result);
      if (this.healthHistory.length > 1000) {
        this.healthHistory = this.healthHistory.slice(-1000);
      }

      // Update monitoring status
      const monitoring = this.monitoredDeployments.get(deploymentId);
      if (monitoring) {
        monitoring.lastCheck = new Date();
        monitoring.lastHealth = overallHealth;
      }

      // Send alerts if enabled and there are issues
      if (alertOnAnomaly && alerts.length > 0) {
        await this.sendAlerts(deploymentId, alerts);
      }

      // Update deployment health status
      deployment.health = {
        status: overallHealth.status,
        score: overallHealth.score,
        lastChecked: new Date(),
        alertCount: alerts.length
      };
      await deployment.save();

      logger.info(`Health check completed for ${deploymentId}`, {
        status: overallHealth.status,
        score: overallHealth.score,
        alerts: alerts.length
      });

      return result;

    } catch (error) {
      logger.error(`Health check failed for ${deploymentId}:`, error);
      throw error;
    }
  }

  /**
   * Check health of a specific resource
   */
  async checkResourceHealth(resource) {
    const check = {
      resourceId: resource.id,
      resourceType: resource.type,
      name: resource.name,
      healthy: true,
      status: 'healthy',
      metrics: {},
      issues: []
    };

    try {
      switch (resource.type) {
        case 'aws_instance':
        case 'aws_ec2_instance':
          await this.checkEC2Health(resource, check);
          break;
        case 'aws_db_instance':
        case 'aws_rds_instance':
          await this.checkRDSHealth(resource, check);
          break;
        case 'aws_ecs_service':
          await this.checkECSHealth(resource, check);
          break;
        case 'aws_lambda_function':
          await this.checkLambdaHealth(resource, check);
          break;
        case 'aws_lb':
        case 'aws_alb':
          await this.checkALBHealth(resource, check);
          break;
        default:
          check.status = 'unknown';
      }

      // Determine health status based on issues
      if (check.issues.length > 0) {
        const criticalIssues = check.issues.filter(i => i.severity === 'critical');
        if (criticalIssues.length > 0) {
          check.healthy = false;
          check.status = 'critical';
        } else {
          check.status = 'warning';
        }
      }

    } catch (error) {
      check.healthy = false;
      check.status = 'error';
      check.error = error.message;
    }

    return check;
  }

  /**
   * Check EC2 instance health
   */
  async checkEC2Health(resource, check) {
    const instanceId = resource.id || resource.attributes?.id;
    if (!instanceId) return;

    try {
      const ec2 = awsService.getEC2Client();
      
      // Get instance status
      const statusResponse = await ec2.describeInstanceStatus({
        InstanceIds: [instanceId]
      }).promise();

      const instanceStatus = statusResponse.InstanceStatuses?.[0];
      if (!instanceStatus) {
        check.issues.push({
          type: 'instance_not_found',
          severity: 'critical',
          message: 'Instance not found or not running'
        });
        return;
      }

      check.metrics.instanceState = instanceStatus.InstanceState?.Name;
      check.metrics.systemStatus = instanceStatus.SystemStatus?.Status;
      check.metrics.instanceStatus = instanceStatus.InstanceStatus?.Status;

      if (instanceStatus.SystemStatus?.Status !== 'ok') {
        check.issues.push({
          type: 'system_check_failed',
          severity: 'critical',
          message: `System status check: ${instanceStatus.SystemStatus?.Status}`
        });
      }

      if (instanceStatus.InstanceStatus?.Status !== 'ok') {
        check.issues.push({
          type: 'instance_check_failed',
          severity: 'critical',
          message: `Instance status check: ${instanceStatus.InstanceStatus?.Status}`
        });
      }

      // Get CloudWatch metrics (CPU, Memory)
      const cloudwatch = awsService.getCloudWatchClient();
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 5 * 60 * 1000);

      const cpuMetric = await cloudwatch.getMetricStatistics({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: 300,
        Statistics: ['Average']
      }).promise();

      if (cpuMetric.Datapoints?.[0]) {
        const cpuAvg = cpuMetric.Datapoints[0].Average;
        check.metrics.cpuUtilization = cpuAvg;

        if (cpuAvg > this.alertThresholds.cpu) {
          check.issues.push({
            type: 'high_cpu',
            severity: 'warning',
            message: `CPU utilization at ${cpuAvg.toFixed(1)}% (threshold: ${this.alertThresholds.cpu}%)`
          });
        }
      }

    } catch (error) {
      check.issues.push({
        type: 'check_failed',
        severity: 'warning',
        message: `Failed to check EC2 health: ${error.message}`
      });
    }
  }

  /**
   * Check RDS instance health
   */
  async checkRDSHealth(resource, check) {
    const dbId = resource.id || resource.attributes?.identifier;
    if (!dbId) return;

    try {
      const rds = awsService.getRDSClient();
      
      const response = await rds.describeDBInstances({
        DBInstanceIdentifier: dbId
      }).promise();

      const instance = response.DBInstances?.[0];
      if (!instance) {
        check.issues.push({
          type: 'db_not_found',
          severity: 'critical',
          message: 'RDS instance not found'
        });
        return;
      }

      check.metrics.dbStatus = instance.DBInstanceStatus;
      check.metrics.allocatedStorage = instance.AllocatedStorage;
      check.metrics.freeStorageSpace = instance.FreeStorageSpace;

      if (instance.DBInstanceStatus !== 'available') {
        check.issues.push({
          type: 'db_unavailable',
          severity: 'critical',
          message: `RDS instance status: ${instance.DBInstanceStatus}`
        });
      }

      // Check storage space
      if (instance.FreeStorageSpace && instance.AllocatedStorage) {
        const usedPercentage = ((instance.AllocatedStorage - instance.FreeStorageSpace) / instance.AllocatedStorage) * 100;
        check.metrics.storageUsedPercentage = usedPercentage;

        if (usedPercentage > this.alertThresholds.disk) {
          check.issues.push({
            type: 'low_storage',
            severity: 'warning',
            message: `Storage usage at ${usedPercentage.toFixed(1)}% (threshold: ${this.alertThresholds.disk}%)`
          });
        }
      }

    } catch (error) {
      check.issues.push({
        type: 'check_failed',
        severity: 'warning',
        message: `Failed to check RDS health: ${error.message}`
      });
    }
  }

  /**
   * Check ECS service health
   */
  async checkECSHealth(resource, check) {
    try {
      const ecs = awsService.getECSClient();
      
      // This is a simplified check - would need cluster and service ARN
      check.metrics.status = 'check_requires_arn';
      
    } catch (error) {
      check.issues.push({
        type: 'check_failed',
        severity: 'warning',
        message: `Failed to check ECS health: ${error.message}`
      });
    }
  }

  /**
   * Check Lambda function health
   */
  async checkLambdaHealth(resource, check) {
    const functionName = resource.id || resource.attributes?.function_name;
    if (!functionName) return;

    try {
      const lambda = awsService.getLambdaClient();
      
      const response = await lambda.getFunction({
        FunctionName: functionName
      }).promise();

      check.metrics.state = response.Configuration?.State;
      check.metrics.lastModified = response.Configuration?.LastModified;
      check.metrics.memorySize = response.Configuration?.MemorySize;

      if (response.Configuration?.State !== 'Active') {
        check.issues.push({
          type: 'function_not_active',
          severity: 'critical',
          message: `Lambda function state: ${response.Configuration?.State}`
        });
      }

    } catch (error) {
      check.issues.push({
        type: 'check_failed',
        severity: 'warning',
        message: `Failed to check Lambda health: ${error.message}`
      });
    }
  }

  /**
   * Check ALB health
   */
  async checkALBHealth(resource, check) {
    const albArn = resource.id || resource.attributes?.arn;
    if (!albArn) return;

    try {
      const elbv2 = awsService.getELBv2Client();
      
      const response = await elbv2.describeLoadBalancers({
        LoadBalancerArns: [albArn]
      }).promise();

      const lb = response.LoadBalancers?.[0];
      if (!lb) {
        check.issues.push({
          type: 'lb_not_found',
          severity: 'critical',
          message: 'Load balancer not found'
        });
        return;
      }

      check.metrics.state = lb.State?.Code;
      check.metrics.type = lb.Type;

      if (lb.State?.Code !== 'active') {
        check.issues.push({
          type: 'lb_not_active',
          severity: 'critical',
          message: `Load balancer state: ${lb.State?.Code}`
        });
      }

    } catch (error) {
      check.issues.push({
        type: 'check_failed',
        severity: 'warning',
        message: `Failed to check ALB health: ${error.message}`
      });
    }
  }

  /**
   * Calculate overall health from resource checks
   */
  calculateOverallHealth(healthChecks) {
    if (healthChecks.length === 0) {
      return { status: 'unknown', score: 0 };
    }

    const healthyCount = healthChecks.filter(c => c.healthy).length;
    const criticalCount = healthChecks.filter(c => c.status === 'critical').length;
    const warningCount = healthChecks.filter(c => c.status === 'warning').length;

    const score = Math.round((healthyCount / healthChecks.length) * 100);

    let status = 'healthy';
    if (criticalCount > 0) {
      status = 'critical';
    } else if (warningCount > 0) {
      status = 'warning';
    } else if (healthyCount < healthChecks.length) {
      status = 'degraded';
    }

    return {
      status,
      score,
      healthy: healthyCount,
      warning: warningCount,
      critical: criticalCount,
      unknown: healthChecks.filter(c => c.status === 'unknown').length,
      total: healthChecks.length
    };
  }

  /**
   * Aggregate metrics from all checks
   */
  aggregateMetrics(healthChecks) {
    const metrics = {};

    for (const check of healthChecks) {
      if (check.metrics) {
        metrics[check.name || check.resourceId] = check.metrics;
      }
    }

    return metrics;
  }

  /**
   * Send alerts for health issues
   */
  async sendAlerts(deploymentId, alerts) {
    try {
      for (const alert of alerts) {
        await notificationService.sendNotification({
          type: 'health_alert',
          severity: alert.severity,
          deploymentId,
          title: `Health Alert: ${alert.type}`,
          message: alert.message,
          resourceId: alert.resourceId,
          resourceType: alert.resourceType
        });
      }

      logger.info(`Sent ${alerts.length} health alerts for ${deploymentId}`);
    } catch (error) {
      logger.error('Failed to send health alerts:', error);
    }
  }

  /**
   * Get health history
   */
  getHistory(deploymentId = null, limit = 50) {
    let history = this.healthHistory;
    
    if (deploymentId) {
      history = history.filter(h => h.deploymentId === deploymentId);
    }

    return history.slice(-limit);
  }

  /**
   * Get monitored deployments
   */
  getMonitoredDeployments() {
    const deployments = [];
    
    this.monitoredDeployments.forEach((value, key) => {
      deployments.push({
        deploymentId: key,
        ...value,
        intervalId: undefined // Don't expose internal ID
      });
    });

    return deployments;
  }

  /**
   * Get scaling recommendations
   */
  async getScalingRecommendations(deploymentId) {
    const history = this.getHistory(deploymentId, 100);
    
    if (history.length === 0) {
      return { message: 'No health history available for recommendations' };
    }

    const recommendations = [];

    // Analyze CPU trends
    const cpuMetrics = history
      .flatMap(h => Object.values(h.metrics))
      .filter(m => m.cpuUtilization !== undefined)
      .map(m => m.cpuUtilization);

    if (cpuMetrics.length > 0) {
      const avgCpu = cpuMetrics.reduce((a, b) => a + b, 0) / cpuMetrics.length;
      const maxCpu = Math.max(...cpuMetrics);

      if (avgCpu > 70) {
        recommendations.push({
          type: 'scale_up',
          metric: 'cpu',
          message: `Average CPU utilization is ${avgCpu.toFixed(1)}%. Consider scaling up.`,
          suggestion: 'Add more instances or increase instance size'
        });
      } else if (avgCpu < 20 && maxCpu < 40) {
        recommendations.push({
          type: 'scale_down',
          metric: 'cpu',
          message: `Average CPU utilization is ${avgCpu.toFixed(1)}%. Consider scaling down.`,
          suggestion: 'Reduce instance count or use smaller instances'
        });
      }
    }

    return {
      deploymentId,
      analyzedPeriods: history.length,
      recommendations
    };
  }
}

// Singleton instance
const healthMonitor = new HealthMonitor();

module.exports = healthMonitor;





