const Deployment = require('../models/Deployment');
const awsService = require('./aws');
const terraformService = require('./terraform');
const logger = require('../utils/logger');

/**
 * Infrastructure Drift Detector
 * Compares actual infrastructure state with desired Terraform state
 */
class DriftDetector {
  constructor() {
    this.driftHistory = [];
    this.scheduledChecks = new Map();
  }

  /**
   * Detect drift for a deployment
   * @param {string} deploymentId - Deployment ID to check
   * @returns {Promise<Object>} - Drift report
   */
  async detectDrift(deploymentId) {
    const startTime = Date.now();

    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }

      if (deployment.status !== 'DEPLOYED') {
        return {
          deploymentId,
          hasDrift: false,
          message: `Deployment is not deployed. Current status: ${deployment.status}`,
          checkedAt: new Date()
        };
      }

      // Get desired state from Terraform
      const desiredState = await this.getDesiredState(deployment);

      // Get actual state from AWS
      const actualState = await this.getActualState(deployment);

      // Compare states
      const drifts = this.compareStates(desiredState, actualState);

      const duration = Date.now() - startTime;
      const report = {
        deploymentId,
        hasDrift: drifts.length > 0,
        driftCount: drifts.length,
        drifts,
        desiredResourceCount: Object.keys(desiredState).length,
        actualResourceCount: Object.keys(actualState).length,
        checkedAt: new Date(),
        duration,
        severity: this.calculateSeverity(drifts)
      };

      // Store in history
      this.driftHistory.push(report);
      if (this.driftHistory.length > 100) {
        this.driftHistory = this.driftHistory.slice(-100);
      }

      // Update deployment with drift status
      deployment.driftStatus = {
        hasDrift: report.hasDrift,
        lastChecked: new Date(),
        driftCount: drifts.length,
        severity: report.severity
      };
      await deployment.save();

      logger.info(`Drift detection completed for ${deploymentId}`, {
        hasDrift: report.hasDrift,
        driftCount: drifts.length,
        duration
      });

      return report;

    } catch (error) {
      logger.error('Drift detection failed:', error);
      throw error;
    }
  }

  /**
   * Get desired state from Terraform
   */
  async getDesiredState(deployment) {
    const state = {};

    try {
      // Get Terraform state if available
      const tfState = await terraformService.getState(deployment.deploymentId);
      
      if (tfState && tfState.resources) {
        for (const resource of tfState.resources) {
          const key = `${resource.type}.${resource.name}`;
          state[key] = {
            type: resource.type,
            name: resource.name,
            attributes: resource.instances?.[0]?.attributes || {}
          };
        }
      }
    } catch (error) {
      logger.warn('Could not get Terraform state:', error.message);
      
      // Fallback: Parse Terraform code for expected resources
      if (deployment.terraformCode?.main) {
        const resources = this.parseResourcesFromCode(deployment.terraformCode.main);
        for (const resource of resources) {
          const key = `${resource.type}.${resource.name}`;
          state[key] = resource;
        }
      }
    }

    return state;
  }

  /**
   * Parse resources from Terraform code
   */
  parseResourcesFromCode(code) {
    const resources = [];
    const resourceRegex = /resource\s+"(\w+)"\s+"(\w+)"\s+\{/g;
    
    let match;
    while ((match = resourceRegex.exec(code)) !== null) {
      resources.push({
        type: match[1],
        name: match[2],
        attributes: {}
      });
    }

    return resources;
  }

  /**
   * Get actual state from AWS
   */
  async getActualState(deployment) {
    const state = {};

    if (!deployment.resources || deployment.resources.length === 0) {
      return state;
    }

    try {
      for (const resource of deployment.resources) {
        const actualResource = await this.getResourceState(resource);
        if (actualResource) {
          const key = `${resource.type}.${resource.name}`;
          state[key] = actualResource;
        }
      }
    } catch (error) {
      logger.error('Failed to get actual state:', error);
    }

    return state;
  }

  /**
   * Get state for a specific resource
   */
  async getResourceState(resource) {
    try {
      switch (resource.type) {
        case 'aws_instance':
        case 'aws_ec2_instance':
          return await this.getEC2State(resource);
        case 'aws_s3_bucket':
          return await this.getS3State(resource);
        case 'aws_rds_instance':
        case 'aws_db_instance':
          return await this.getRDSState(resource);
        case 'aws_security_group':
          return await this.getSecurityGroupState(resource);
        default:
          return { type: resource.type, name: resource.name, exists: true };
      }
    } catch (error) {
      // Resource might not exist
      return null;
    }
  }

  /**
   * Get EC2 instance state
   */
  async getEC2State(resource) {
    const instanceId = resource.id || resource.attributes?.id;
    if (!instanceId) return null;

    const ec2 = awsService.getEC2Client();
    const response = await ec2.describeInstances({
      InstanceIds: [instanceId]
    }).promise();

    if (response.Reservations?.[0]?.Instances?.[0]) {
      const instance = response.Reservations[0].Instances[0];
      return {
        type: 'aws_instance',
        name: resource.name,
        exists: true,
        attributes: {
          id: instance.InstanceId,
          instance_type: instance.InstanceType,
          ami: instance.ImageId,
          availability_zone: instance.Placement?.AvailabilityZone,
          state: instance.State?.Name,
          vpc_id: instance.VpcId,
          subnet_id: instance.SubnetId
        }
      };
    }

    return null;
  }

  /**
   * Get S3 bucket state
   */
  async getS3State(resource) {
    const bucketName = resource.id || resource.attributes?.bucket;
    if (!bucketName) return null;

    const s3 = awsService.getS3Client();
    
    try {
      await s3.headBucket({ Bucket: bucketName }).promise();
      
      const versioning = await s3.getBucketVersioning({ Bucket: bucketName }).promise();
      
      return {
        type: 'aws_s3_bucket',
        name: resource.name,
        exists: true,
        attributes: {
          bucket: bucketName,
          versioning_enabled: versioning.Status === 'Enabled'
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get RDS instance state
   */
  async getRDSState(resource) {
    const dbId = resource.id || resource.attributes?.identifier;
    if (!dbId) return null;

    const rds = awsService.getRDSClient();
    
    try {
      const response = await rds.describeDBInstances({
        DBInstanceIdentifier: dbId
      }).promise();

      if (response.DBInstances?.[0]) {
        const db = response.DBInstances[0];
        return {
          type: 'aws_db_instance',
          name: resource.name,
          exists: true,
          attributes: {
            identifier: db.DBInstanceIdentifier,
            instance_class: db.DBInstanceClass,
            engine: db.Engine,
            engine_version: db.EngineVersion,
            status: db.DBInstanceStatus,
            allocated_storage: db.AllocatedStorage
          }
        };
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  /**
   * Get Security Group state
   */
  async getSecurityGroupState(resource) {
    const sgId = resource.id || resource.attributes?.id;
    if (!sgId) return null;

    const ec2 = awsService.getEC2Client();
    
    try {
      const response = await ec2.describeSecurityGroups({
        GroupIds: [sgId]
      }).promise();

      if (response.SecurityGroups?.[0]) {
        const sg = response.SecurityGroups[0];
        return {
          type: 'aws_security_group',
          name: resource.name,
          exists: true,
          attributes: {
            id: sg.GroupId,
            name: sg.GroupName,
            description: sg.Description,
            vpc_id: sg.VpcId,
            ingress_rules: sg.IpPermissions?.length || 0,
            egress_rules: sg.IpPermissionsEgress?.length || 0
          }
        };
      }
    } catch (error) {
      return null;
    }

    return null;
  }

  /**
   * Compare desired and actual states
   */
  compareStates(desired, actual) {
    const drifts = [];

    // Check for missing resources
    for (const [key, desiredResource] of Object.entries(desired)) {
      if (!actual[key]) {
        drifts.push({
          resourceKey: key,
          type: 'missing',
          severity: 'high',
          description: `Resource ${key} exists in Terraform but not in AWS`,
          desired: desiredResource,
          actual: null
        });
        continue;
      }

      // Compare attributes
      const actualResource = actual[key];
      const attributeDrifts = this.compareAttributes(
        desiredResource.attributes,
        actualResource.attributes
      );

      if (attributeDrifts.length > 0) {
        drifts.push({
          resourceKey: key,
          type: 'modified',
          severity: 'medium',
          description: `Resource ${key} has drifted attributes`,
          attributeDrifts
        });
      }
    }

    // Check for extra resources (in AWS but not in Terraform)
    for (const [key, actualResource] of Object.entries(actual)) {
      if (!desired[key]) {
        drifts.push({
          resourceKey: key,
          type: 'extra',
          severity: 'low',
          description: `Resource ${key} exists in AWS but not in Terraform`,
          desired: null,
          actual: actualResource
        });
      }
    }

    return drifts;
  }

  /**
   * Compare resource attributes
   */
  compareAttributes(desired, actual) {
    const drifts = [];

    if (!desired || !actual) return drifts;

    // Compare important attributes
    const importantAttributes = [
      'instance_type', 'ami', 'instance_class', 'engine_version',
      'allocated_storage', 'vpc_id', 'subnet_id'
    ];

    for (const attr of importantAttributes) {
      if (desired[attr] && actual[attr] && desired[attr] !== actual[attr]) {
        drifts.push({
          attribute: attr,
          desired: desired[attr],
          actual: actual[attr]
        });
      }
    }

    return drifts;
  }

  /**
   * Calculate drift severity
   */
  calculateSeverity(drifts) {
    if (drifts.length === 0) return 'none';
    
    if (drifts.some(d => d.severity === 'high')) return 'high';
    if (drifts.some(d => d.severity === 'medium')) return 'medium';
    return 'low';
  }

  /**
   * Get remediation steps for drifts
   */
  getRemediationSteps(drifts) {
    return drifts.map(drift => {
      switch (drift.type) {
        case 'missing':
          return {
            drift: drift.resourceKey,
            action: 'recreate',
            steps: [
              `Run 'terraform apply' to recreate ${drift.resourceKey}`,
              'Verify the resource configuration is correct',
              'Check for any dependencies that may have been affected'
            ]
          };
        case 'modified':
          return {
            drift: drift.resourceKey,
            action: 'update',
            steps: [
              `Review changes to ${drift.resourceKey}`,
              `Option 1: Run 'terraform apply' to restore desired state`,
              `Option 2: Update Terraform code to match current state`
            ]
          };
        case 'extra':
          return {
            drift: drift.resourceKey,
            action: 'import_or_remove',
            steps: [
              `Resource ${drift.resourceKey} was created outside Terraform`,
              `Option 1: Import into Terraform state with 'terraform import'`,
              `Option 2: Manually remove the resource if not needed`
            ]
          };
        default:
          return { drift: drift.resourceKey, action: 'review', steps: ['Review manually'] };
      }
    });
  }

  /**
   * Schedule periodic drift checks
   */
  scheduleCheck(deploymentId, intervalHours = 24) {
    if (this.scheduledChecks.has(deploymentId)) {
      clearInterval(this.scheduledChecks.get(deploymentId));
    }

    const interval = setInterval(
      () => this.detectDrift(deploymentId).catch(err => 
        logger.error(`Scheduled drift check failed for ${deploymentId}:`, err)
      ),
      intervalHours * 60 * 60 * 1000
    );

    this.scheduledChecks.set(deploymentId, interval);
    logger.info(`Scheduled drift check for ${deploymentId} every ${intervalHours} hours`);
  }

  /**
   * Cancel scheduled checks
   */
  cancelScheduledCheck(deploymentId) {
    if (this.scheduledChecks.has(deploymentId)) {
      clearInterval(this.scheduledChecks.get(deploymentId));
      this.scheduledChecks.delete(deploymentId);
      logger.info(`Cancelled scheduled drift check for ${deploymentId}`);
    }
  }

  /**
   * Get drift history
   */
  getHistory(deploymentId = null, limit = 20) {
    let history = this.driftHistory;
    
    if (deploymentId) {
      history = history.filter(h => h.deploymentId === deploymentId);
    }

    return history.slice(-limit);
  }
}

// Singleton instance
const driftDetector = new DriftDetector();

module.exports = driftDetector;





