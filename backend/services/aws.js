const {
  s3,
  dynamodb,
  pricing,
  cloudwatch,
  ec2,
  rds,
  lambda,
  iam,
  terraformStateConfig
} = require('../config/aws');
const logger = require('../utils/logger');

/**
 * AWS Service
 * Wrapper around AWS SDK for common operations
 */
class AWSService {
  /**
   * Estimate cost from Terraform plan
   */
  async estimateCost(terraformPlan) {
    try {
      // Parse Terraform plan to extract resources
      const resources = this.parseTerraformPlan(terraformPlan);
      
      let totalMonthlyCost = 0;
      const breakdown = {
        compute: 0,
        database: 0,
        networking: 0,
        storage: 0,
        other: 0
      };
      
      // Estimate cost for each resource
      for (const resource of resources) {
        const cost = await this.estimateResourceCost(resource);
        totalMonthlyCost += cost.monthly;
        
        // Categorize cost
        if (resource.type.includes('instance') || resource.type.includes('ecs')) {
          breakdown.compute += cost.monthly;
        } else if (resource.type.includes('db') || resource.type.includes('rds')) {
          breakdown.database += cost.monthly;
        } else if (resource.type.includes('lb') || resource.type.includes('nat')) {
          breakdown.networking += cost.monthly;
        } else if (resource.type.includes('s3') || resource.type.includes('ebs')) {
          breakdown.storage += cost.monthly;
        } else {
          breakdown.other += cost.monthly;
        }
      }
      
      return {
        totalMonthlyCost,
        totalYearlyCost: totalMonthlyCost * 12,
        breakdown,
        resources: resources.map(r => ({
          type: r.type,
          name: r.name,
          estimatedMonthlyCost: r.estimatedCost || 0
        }))
      };
      
    } catch (error) {
      logger.error('Cost estimation error:', error);
      throw error;
    }
  }

  /**
   * Parse Terraform plan to extract resources
   */
  parseTerraformPlan(plan) {
    // This is a simplified parser - in production, use terraform-exec to parse plan JSON
    const resources = [];
    
    // Extract resource patterns from plan text
    const resourcePattern = /will be created[\s\S]*?aws_(\w+)/gi;
    let match;
    
    while ((match = resourcePattern.exec(plan)) !== null) {
      resources.push({
        type: `aws_${match[1]}`,
        name: match[1],
        estimatedCost: 0
      });
    }
    
    return resources;
  }

  /**
   * Estimate cost for a single resource
   */
  async estimateResourceCost(resource) {
    try {
      // Simplified cost estimation - in production, use AWS Pricing API
      const costMap = {
        'aws_instance': { hourly: 0.0832, monthly: 60.74 }, // t3.medium
        'aws_db_instance': { hourly: 0.189, monthly: 138.00 }, // db.t3.medium
        'aws_lb': { hourly: 0.0225, monthly: 16.43 },
        'aws_nat_gateway': { hourly: 0.045, monthly: 32.85 },
        'aws_s3_bucket': { hourly: 0.023, monthly: 16.79 }
      };
      
      const defaultCost = costMap[resource.type] || { hourly: 0.01, monthly: 7.30 };
      
      return {
        hourly: defaultCost.hourly,
        monthly: defaultCost.monthly
      };
      
    } catch (error) {
      logger.error('Resource cost estimation error:', error);
      return { hourly: 0, monthly: 0 };
    }
  }

  /**
   * Get actual cost for a deployment
   */
  async getActualCost(deploymentId, startDate, endDate) {
    try {
      // In production, use AWS Cost Explorer API
      // For now, return mock data
      return {
        totalCost: 245.30,
        breakdown: {
          compute: 121.48,
          database: 138.00,
          networking: 30.00,
          storage: 20.00,
          other: 19.26
        },
        services: {
          'Amazon EC2': 121.48,
          'Amazon RDS': 138.00,
          'Amazon CloudWatch': 15.00,
          'Amazon S3': 20.00,
          'Amazon VPC': 30.00
        }
      };
    } catch (error) {
      logger.error('Get actual cost error:', error);
      throw error;
    }
  }

  /**
   * Check service quotas
   */
  async checkServiceQuotas(region = 'us-east-1') {
    try {
      // In production, use Service Quotas API
      return {
        'ec2-instances': { limit: 20, used: 5, available: 15 },
        'rds-instances': { limit: 10, used: 2, available: 8 },
        'vpc': { limit: 5, used: 2, available: 3 }
      };
    } catch (error) {
      logger.error('Check quotas error:', error);
      throw error;
    }
  }

  /**
   * Tag resources
   */
  async tagResources(resourceIds, tags, resourceType = 'ec2') {
    try {
      const tagArray = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
      
      if (resourceType === 'ec2') {
        await ec2.createTags({
          Resources: resourceIds,
          Tags: tagArray
        }).promise();
      } else if (resourceType === 'rds') {
        await rds.addTagsToResource({
          ResourceName: resourceIds[0],
          Tags: tagArray
        }).promise();
      }
      
      logger.info('Resources tagged', { resourceIds, tags });
      return { success: true };
      
    } catch (error) {
      logger.error('Tag resources error:', error);
      throw error;
    }
  }

  /**
   * Get CloudWatch metrics
   */
  async getMetrics(resourceId, metricName, startTime, endTime) {
    try {
      const params = {
        Namespace: 'AWS/EC2',
        MetricName: metricName,
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: resourceId
          }
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 3600, // 1 hour
        Statistics: ['Average', 'Maximum']
      };
      
      const result = await cloudwatch.getMetricStatistics(params).promise();
      return result.Datapoints;
      
    } catch (error) {
      logger.error('Get metrics error:', error);
      throw error;
    }
  }

  /**
   * Create budget
   */
  async createBudget(deploymentId, monthlyBudget) {
    try {
      // In production, use AWS Budgets API
      logger.info('Budget created', { deploymentId, monthlyBudget });
      return { success: true };
    } catch (error) {
      logger.error('Create budget error:', error);
      throw error;
    }
  }

  /**
   * Get Terraform state from S3
   */
  async getTerraformState(deploymentId) {
    try {
      const key = `deployments/${deploymentId}/terraform.tfstate`;
      
      const result = await s3.getObject({
        Bucket: terraformStateConfig.bucket,
        Key: key
      }).promise();
      
      return JSON.parse(result.Body.toString());
      
    } catch (error) {
      if (error.code === 'NoSuchKey') {
        return null;
      }
      logger.error('Get Terraform state error:', error);
      throw error;
    }
  }

  /**
   * Save Terraform state to S3
   */
  async saveTerraformState(deploymentId, state) {
    try {
      const key = `deployments/${deploymentId}/terraform.tfstate`;
      
      await s3.putObject({
        Bucket: terraformStateConfig.bucket,
        Key: key,
        Body: JSON.stringify(state, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256'
      }).promise();
      
      logger.info('Terraform state saved', { deploymentId, key });
      return { success: true, key };
      
    } catch (error) {
      logger.error('Save Terraform state error:', error);
      throw error;
    }
  }

  /**
   * Lock Terraform state
   */
  async lockTerraformState(deploymentId, lockId) {
    try {
      const lockKey = `deployments/${deploymentId}/terraform.tfstate-md5`;
      
      await dynamodb.putItem({
        TableName: terraformStateConfig.table,
        Item: {
          LockID: lockKey,
          Info: JSON.stringify({
            ID: lockId,
            Operation: 'OperationTypeApply',
            Who: 'deployment-service',
            Version: '1.6.0',
            Created: new Date().toISOString(),
            Path: `deployments/${deploymentId}/terraform.tfstate`
          })
        },
        ConditionExpression: 'attribute_not_exists(LockID)'
      }).promise();
      
      return { success: true };
      
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        throw new Error('State is locked by another operation');
      }
      logger.error('Lock Terraform state error:', error);
      throw error;
    }
  }

  /**
   * Unlock Terraform state
   */
  async unlockTerraformState(deploymentId) {
    try {
      const lockKey = `deployments/${deploymentId}/terraform.tfstate-md5`;
      
      await dynamodb.deleteItem({
        TableName: terraformStateConfig.table,
        Key: {
          LockID: lockKey
        }
      }).promise();
      
      return { success: true };
      
    } catch (error) {
      logger.error('Unlock Terraform state error:', error);
      throw error;
    }
  }
}

// Singleton instance
const awsService = new AWSService();

module.exports = awsService;

