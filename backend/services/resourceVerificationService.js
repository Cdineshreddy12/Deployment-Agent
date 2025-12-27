const awsService = require('./aws');
const logger = require('../utils/logger');
const { ECS, EC2, S3, RDS, Lambda, CloudWatch } = require('aws-sdk');

/**
 * Resource Verification Service
 * Verifies AWS resources after deployment
 */
class ResourceVerificationService {
  constructor() {
    // Initialize AWS SDK clients
    this.ecs = new ECS({ region: process.env.AWS_REGION || 'us-east-1' });
    this.ec2 = new EC2({ region: process.env.AWS_REGION || 'us-east-1' });
    this.s3 = new S3({ region: process.env.AWS_REGION || 'us-east-1' });
    this.rds = new RDS({ region: process.env.AWS_REGION || 'us-east-1' });
    this.lambda = new Lambda({ region: process.env.AWS_REGION || 'us-east-1' });
    this.cloudwatch = new CloudWatch({ region: process.env.AWS_REGION || 'us-east-1' });
  }

  /**
   * Verify resources after deployment
   */
  async verifyResources(deploymentId, resources) {
    if (!resources || resources.length === 0) {
      logger.warn('No resources to verify', { deploymentId });
      return {
        verified: 0,
        total: 0,
        resources: [],
        errors: []
      };
    }

    const verificationResults = [];
    const errors = [];

    logger.info('Starting resource verification', {
      deploymentId,
      resourceCount: resources.length
    });

    // Group resources by type for efficient verification
    const resourcesByType = this.groupResourcesByType(resources);

    // Verify each resource type
    for (const [resourceType, resourceList] of Object.entries(resourcesByType)) {
      try {
        const typeResults = await this.verifyResourceType(resourceType, resourceList);
        verificationResults.push(...typeResults);
      } catch (error) {
        logger.error(`Failed to verify resources of type ${resourceType}`, {
          deploymentId,
          resourceType,
          error: error.message
        });
        errors.push({
          resourceType,
          error: error.message
        });

        // Mark all resources of this type as verification failed
        resourceList.forEach(resource => {
          verificationResults.push({
            resource,
            verified: false,
            error: error.message
          });
        });
      }
    }

    const verified = verificationResults.filter(r => r.verified).length;
    const total = resources.length;

    logger.info('Resource verification completed', {
      deploymentId,
      verified,
      total,
      errors: errors.length
    });

    return {
      verified,
      total,
      resources: verificationResults,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Group resources by type
   */
  groupResourcesByType(resources) {
    const grouped = {};

    for (const resource of resources) {
      const type = resource.type || 'unknown';
      if (!grouped[type]) {
        grouped[type] = [];
      }
      grouped[type].push(resource);
    }

    return grouped;
  }

  /**
   * Verify resources of a specific type
   */
  async verifyResourceType(resourceType, resources) {
    const results = [];

    // Route to appropriate verification method based on resource type
    if (resourceType.startsWith('aws_ecs')) {
      return await this.verifyECSResources(resources);
    } else if (resourceType.startsWith('aws_ec2')) {
      return await this.verifyEC2Resources(resources);
    } else if (resourceType.startsWith('aws_s3')) {
      return await this.verifyS3Resources(resources);
    } else if (resourceType.startsWith('aws_rds')) {
      return await this.verifyRDSResources(resources);
    } else if (resourceType.startsWith('aws_lambda')) {
      return await this.verifyLambdaResources(resources);
    } else {
      // Generic verification - just check if resource exists via AWS API
      return await this.verifyGenericResources(resourceType, resources);
    }
  }

  /**
   * Verify ECS resources
   */
  async verifyECSResources(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        if (resource.type === 'aws_ecs_cluster') {
          // Verify ECS cluster
          const clusterName = resource.identifier || resource.name;
          const response = await this.ecs.describeClusters({
            clusters: [clusterName]
          }).promise();

          const cluster = response.clusters?.[0];
          const verified = cluster && cluster.status === 'ACTIVE';

          results.push({
            resource,
            verified,
            status: cluster?.status,
            details: cluster
          });
        } else if (resource.type === 'aws_ecs_service') {
          // Verify ECS service
          const serviceName = resource.identifier || resource.name;
          const clusterName = resource.cluster || this.extractClusterName(resource);
          
          if (clusterName) {
            const response = await this.ecs.describeServices({
              cluster: clusterName,
              services: [serviceName]
            }).promise();

            const service = response.services?.[0];
            const verified = service && service.status === 'ACTIVE';

            results.push({
              resource,
              verified,
              status: service?.status,
              runningCount: service?.runningCount,
              desiredCount: service?.desiredCount,
              details: service
            });
          } else {
            results.push({
              resource,
              verified: false,
              error: 'Cluster name not found'
            });
          }
        } else if (resource.type === 'aws_ecs_task_definition') {
          // Verify task definition
          const taskFamily = resource.identifier || resource.name;
          const response = await this.ecs.describeTaskDefinition({
            taskDefinition: taskFamily
          }).promise();

          const verified = !!response.taskDefinition;

          results.push({
            resource,
            verified,
            revision: response.taskDefinition?.revision,
            details: response.taskDefinition
          });
        } else {
          // Unknown ECS resource type
          results.push({
            resource,
            verified: false,
            error: `Unknown ECS resource type: ${resource.type}`
          });
        }
      } catch (error) {
        if (error.code === 'ClusterNotFoundException' || error.code === 'ServiceNotFoundException') {
          results.push({
            resource,
            verified: false,
            error: error.message
          });
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Verify EC2 resources
   */
  async verifyEC2Resources(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        if (resource.type === 'aws_instance') {
          // Verify EC2 instance
          const instanceId = resource.identifier || resource.name;
          const response = await this.ec2.describeInstances({
            InstanceIds: [instanceId]
          }).promise();

          const instance = response.Reservations?.[0]?.Instances?.[0];
          const verified = instance && ['running', 'pending'].includes(instance.State?.Name);

          results.push({
            resource,
            verified,
            state: instance?.State?.Name,
            instanceType: instance?.InstanceType,
            details: instance
          });
        } else if (resource.type === 'aws_security_group') {
          // Verify security group
          const sgId = resource.identifier || resource.name;
          const response = await this.ec2.describeSecurityGroups({
            GroupIds: [sgId]
          }).promise();

          const sg = response.SecurityGroups?.[0];
          const verified = !!sg;

          results.push({
            resource,
            verified,
            groupName: sg?.GroupName,
            details: sg
          });
        } else {
          results.push({
            resource,
            verified: false,
            error: `EC2 resource verification not implemented for: ${resource.type}`
          });
        }
      } catch (error) {
        if (error.code === 'InvalidInstanceID.NotFound' || error.code === 'InvalidGroup.NotFound') {
          results.push({
            resource,
            verified: false,
            error: error.message
          });
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Verify S3 resources
   */
  async verifyS3Resources(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        const bucketName = resource.identifier || resource.name;
        const response = await this.s3.headBucket({
          Bucket: bucketName
        }).promise();

        results.push({
          resource,
          verified: true,
          details: response
        });
      } catch (error) {
        if (error.code === 'NotFound' || error.statusCode === 404) {
          results.push({
            resource,
            verified: false,
            error: 'Bucket not found'
          });
        } else {
          results.push({
            resource,
            verified: false,
            error: error.message
          });
        }
      }
    }

    return results;
  }

  /**
   * Verify RDS resources
   */
  async verifyRDSResources(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        const dbIdentifier = resource.identifier || resource.name;
        const response = await this.rds.describeDBInstances({
          DBInstanceIdentifier: dbIdentifier
        }).promise();

        const dbInstance = response.DBInstances?.[0];
        const verified = dbInstance && ['available', 'backing-up'].includes(dbInstance.DBInstanceStatus);

        results.push({
          resource,
          verified,
          status: dbInstance?.DBInstanceStatus,
          engine: dbInstance?.Engine,
          details: dbInstance
        });
      } catch (error) {
        if (error.code === 'DBInstanceNotFoundFault') {
          results.push({
            resource,
            verified: false,
            error: 'DB instance not found'
          });
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Verify Lambda resources
   */
  async verifyLambdaResources(resources) {
    const results = [];

    for (const resource of resources) {
      try {
        const functionName = resource.identifier || resource.name;
        const response = await this.lambda.getFunction({
          FunctionName: functionName
        }).promise();

        const verified = response.Configuration && response.Configuration.State === 'Active';

        results.push({
          resource,
          verified,
          state: response.Configuration?.State,
          runtime: response.Configuration?.Runtime,
          details: response.Configuration
        });
      } catch (error) {
        if (error.code === 'ResourceNotFoundException') {
          results.push({
            resource,
            verified: false,
            error: 'Lambda function not found'
          });
        } else {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Generic resource verification (fallback)
   */
  async verifyGenericResources(resourceType, resources) {
    // For unknown resource types, we can't verify them directly
    // Return as "unknown" status
    return resources.map(resource => ({
      resource,
      verified: null,
      status: 'unknown',
      message: `Verification not implemented for resource type: ${resourceType}`
    }));
  }

  /**
   * Extract cluster name from resource
   */
  extractClusterName(resource) {
    // Try to extract from identifier or name
    if (resource.cluster) {
      return resource.cluster;
    }

    // Try common patterns
    if (resource.identifier && resource.identifier.includes('cluster')) {
      return resource.identifier;
    }

    return null;
  }

  /**
   * Health check for a specific resource
   */
  async healthCheck(resource) {
    try {
      const verification = await this.verifyResourceType(resource.type, [resource]);
      return verification[0] || { resource, verified: false };
    } catch (error) {
      logger.error('Health check failed', {
        resource: resource.type,
        error: error.message
      });
      return {
        resource,
        verified: false,
        error: error.message
      };
    }
  }
}

// Singleton instance
const resourceVerificationService = new ResourceVerificationService();

module.exports = resourceVerificationService;





