const Deployment = require('../models/Deployment');
const awsService = require('./aws');
const logger = require('../utils/logger');

/**
 * Cost Optimization Engine
 * Analyzes infrastructure and suggests cost optimizations
 */
class CostOptimizer {
  constructor() {
    this.optimizationHistory = [];
    this.pricingCache = new Map();
  }

  /**
   * Analyze deployment for cost optimization opportunities
   * @param {string} deploymentId - Deployment to analyze
   * @returns {Promise<Object>} - Optimization recommendations
   */
  async analyze(deploymentId) {
    const startTime = Date.now();

    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error(`Deployment not found: ${deploymentId}`);
      }

      const recommendations = [];

      // Analyze EC2 instances
      const ec2Recommendations = await this.analyzeEC2(deployment);
      recommendations.push(...ec2Recommendations);

      // Analyze RDS instances
      const rdsRecommendations = await this.analyzeRDS(deployment);
      recommendations.push(...rdsRecommendations);

      // Analyze storage
      const storageRecommendations = await this.analyzeStorage(deployment);
      recommendations.push(...storageRecommendations);

      // Analyze networking
      const networkRecommendations = await this.analyzeNetworking(deployment);
      recommendations.push(...networkRecommendations);

      // Analyze reserved capacity opportunities
      const reservedRecommendations = await this.analyzeReservedCapacity(deployment);
      recommendations.push(...reservedRecommendations);

      // Calculate total potential savings
      const totalSavings = recommendations.reduce((sum, r) => sum + (r.estimatedMonthlySavings || 0), 0);

      const result = {
        deploymentId,
        analyzedAt: new Date(),
        duration: Date.now() - startTime,
        currentMonthlyCost: deployment.estimatedCost?.monthlyTotal || 0,
        potentialMonthlySavings: totalSavings,
        savingsPercentage: deployment.estimatedCost?.monthlyTotal 
          ? Math.round((totalSavings / deployment.estimatedCost.monthlyTotal) * 100) 
          : 0,
        recommendations: recommendations.sort((a, b) => 
          (b.estimatedMonthlySavings || 0) - (a.estimatedMonthlySavings || 0)
        ),
        priorityActions: recommendations.filter(r => r.priority === 'high').slice(0, 5)
      };

      // Store in history
      this.optimizationHistory.push(result);

      return result;

    } catch (error) {
      logger.error('Cost optimization analysis failed:', error);
      throw error;
    }
  }

  /**
   * Analyze EC2 instances for optimization
   */
  async analyzeEC2(deployment) {
    const recommendations = [];
    const ec2Resources = (deployment.resources || []).filter(r => 
      r.type === 'aws_instance' || r.type === 'aws_ec2_instance'
    );

    for (const resource of ec2Resources) {
      // Right-sizing recommendation
      const rightSizing = await this.checkRightSizing(resource);
      if (rightSizing) {
        recommendations.push(rightSizing);
      }

      // Spot instance recommendation for non-production
      if (deployment.environment !== 'production') {
        recommendations.push({
          type: 'spot_instance',
          resourceId: resource.id,
          resourceType: 'EC2',
          priority: 'high',
          title: 'Consider Spot Instances',
          description: `Instance ${resource.name} could use Spot Instances for up to 90% savings`,
          currentCost: this.getEC2Cost(resource.attributes?.instance_type),
          estimatedMonthlySavings: this.getEC2Cost(resource.attributes?.instance_type) * 0.7,
          implementation: 'Use Spot Fleet or Spot Instance in Auto Scaling Group',
          risk: 'Instances can be interrupted with 2-minute warning'
        });
      }

      // Savings Plans recommendation
      if (deployment.environment === 'production') {
        recommendations.push({
          type: 'savings_plan',
          resourceId: resource.id,
          resourceType: 'EC2',
          priority: 'medium',
          title: 'Compute Savings Plans',
          description: `Consider 1-year Compute Savings Plan for consistent workloads`,
          estimatedMonthlySavings: this.getEC2Cost(resource.attributes?.instance_type) * 0.3,
          implementation: 'Purchase Compute Savings Plan in AWS Console',
          risk: 'Committed spend for 1-3 years'
        });
      }
    }

    return recommendations;
  }

  /**
   * Check if EC2 instance is right-sized
   */
  async checkRightSizing(resource) {
    const instanceType = resource.attributes?.instance_type;
    if (!instanceType) return null;

    // Simulate right-sizing analysis (would use CloudWatch metrics in production)
    const oversizedTypes = ['m5.xlarge', 'm5.2xlarge', 'r5.large', 'r5.xlarge'];
    const recommendations = {
      'm5.xlarge': { suggested: 'm5.large', savings: 50 },
      'm5.2xlarge': { suggested: 'm5.xlarge', savings: 100 },
      'r5.large': { suggested: 't3.large', savings: 30 },
      'r5.xlarge': { suggested: 'r5.large', savings: 60 }
    };

    if (oversizedTypes.includes(instanceType)) {
      const rec = recommendations[instanceType];
      return {
        type: 'rightsizing',
        resourceId: resource.id,
        resourceType: 'EC2',
        priority: 'high',
        title: 'Right-size Instance',
        description: `Instance ${resource.name} may be oversized. Consider ${rec.suggested}`,
        currentInstanceType: instanceType,
        suggestedInstanceType: rec.suggested,
        estimatedMonthlySavings: rec.savings,
        implementation: `Change instance type from ${instanceType} to ${rec.suggested}`,
        risk: 'Ensure application can run on smaller instance'
      };
    }

    return null;
  }

  /**
   * Analyze RDS instances for optimization
   */
  async analyzeRDS(deployment) {
    const recommendations = [];
    const rdsResources = (deployment.resources || []).filter(r => 
      r.type === 'aws_db_instance' || r.type === 'aws_rds_instance'
    );

    for (const resource of rdsResources) {
      // Reserved instance recommendation for production
      if (deployment.environment === 'production') {
        const monthlyCost = this.getRDSCost(resource.attributes?.instance_class);
        recommendations.push({
          type: 'reserved_instance',
          resourceId: resource.id,
          resourceType: 'RDS',
          priority: 'high',
          title: 'Reserved RDS Instance',
          description: `Reserve ${resource.name} for up to 72% savings`,
          currentMonthlyCost: monthlyCost,
          estimatedMonthlySavings: monthlyCost * 0.5,
          implementation: 'Purchase Reserved DB Instance in RDS Console',
          risk: 'Committed spend for 1-3 years'
        });
      }

      // Aurora Serverless recommendation for variable workloads
      if (deployment.environment === 'development') {
        recommendations.push({
          type: 'aurora_serverless',
          resourceId: resource.id,
          resourceType: 'RDS',
          priority: 'medium',
          title: 'Consider Aurora Serverless',
          description: 'Aurora Serverless v2 can scale to zero for dev environments',
          estimatedMonthlySavings: 50,
          implementation: 'Migrate to Aurora Serverless v2',
          risk: 'Migration effort required'
        });
      }

      // Storage optimization
      if (resource.attributes?.allocated_storage > 100) {
        recommendations.push({
          type: 'storage_optimization',
          resourceId: resource.id,
          resourceType: 'RDS',
          priority: 'low',
          title: 'Optimize RDS Storage',
          description: 'Review if allocated storage matches actual usage',
          estimatedMonthlySavings: 20,
          implementation: 'Monitor storage usage and adjust allocation',
          risk: 'None if properly monitored'
        });
      }
    }

    return recommendations;
  }

  /**
   * Analyze storage for optimization
   */
  async analyzeStorage(deployment) {
    const recommendations = [];
    const s3Resources = (deployment.resources || []).filter(r => r.type === 'aws_s3_bucket');

    for (const resource of s3Resources) {
      // Lifecycle policy recommendation
      recommendations.push({
        type: 'lifecycle_policy',
        resourceId: resource.id,
        resourceType: 'S3',
        priority: 'medium',
        title: 'Add S3 Lifecycle Policy',
        description: 'Transition old objects to cheaper storage classes',
        estimatedMonthlySavings: 15,
        implementation: 'Add lifecycle policy to transition to S3-IA after 30 days, Glacier after 90 days',
        risk: 'Ensure access patterns support delayed retrieval'
      });

      // Intelligent-Tiering recommendation
      recommendations.push({
        type: 'intelligent_tiering',
        resourceId: resource.id,
        resourceType: 'S3',
        priority: 'low',
        title: 'Enable Intelligent-Tiering',
        description: 'Automatic cost optimization for unknown access patterns',
        estimatedMonthlySavings: 10,
        implementation: 'Enable S3 Intelligent-Tiering storage class',
        risk: 'Small monitoring fee per object'
      });
    }

    return recommendations;
  }

  /**
   * Analyze networking for optimization
   */
  async analyzeNetworking(deployment) {
    const recommendations = [];
    const resources = deployment.resources || [];

    // Check for unused Elastic IPs
    const eips = resources.filter(r => r.type === 'aws_eip');
    if (eips.length > 0) {
      recommendations.push({
        type: 'unused_eip',
        resourceType: 'VPC',
        priority: 'low',
        title: 'Review Elastic IPs',
        description: 'Unused Elastic IPs incur charges',
        estimatedMonthlySavings: eips.length * 3.6,
        implementation: 'Release any unused Elastic IPs',
        risk: 'Ensure IPs are not needed before release'
      });
    }

    // NAT Gateway optimization
    const natGateways = resources.filter(r => r.type === 'aws_nat_gateway');
    if (natGateways.length > 1) {
      recommendations.push({
        type: 'nat_gateway',
        resourceType: 'VPC',
        priority: 'medium',
        title: 'Review NAT Gateway Usage',
        description: 'Multiple NAT Gateways increase costs. Consider NAT instances for non-production',
        estimatedMonthlySavings: 45 * (natGateways.length - 1),
        implementation: 'Use single NAT Gateway or NAT instances for dev/staging',
        risk: 'Single point of failure if reduced to one NAT Gateway'
      });
    }

    return recommendations;
  }

  /**
   * Analyze reserved capacity opportunities
   */
  async analyzeReservedCapacity(deployment) {
    const recommendations = [];

    if (deployment.environment === 'production') {
      recommendations.push({
        type: 'compute_savings_plan',
        resourceType: 'General',
        priority: 'high',
        title: 'Compute Savings Plans',
        description: 'Commit to consistent compute usage across EC2, Lambda, and Fargate',
        estimatedMonthlySavings: (deployment.estimatedCost?.monthlyTotal || 0) * 0.2,
        implementation: 'Purchase Compute Savings Plan matching baseline usage',
        risk: 'Committed spend for 1-3 years'
      });
    }

    return recommendations;
  }

  /**
   * Get estimated EC2 cost (simplified)
   */
  getEC2Cost(instanceType) {
    const costs = {
      't3.micro': 7.6,
      't3.small': 15.2,
      't3.medium': 30.4,
      't3.large': 60.7,
      'm5.large': 70,
      'm5.xlarge': 140,
      'm5.2xlarge': 280,
      'r5.large': 91,
      'r5.xlarge': 182
    };
    return costs[instanceType] || 100;
  }

  /**
   * Get estimated RDS cost (simplified)
   */
  getRDSCost(instanceClass) {
    const costs = {
      'db.t3.micro': 12.4,
      'db.t3.small': 24.8,
      'db.t3.medium': 49.6,
      'db.m5.large': 125,
      'db.m5.xlarge': 250,
      'db.r5.large': 175,
      'db.r5.xlarge': 350
    };
    return costs[instanceClass] || 100;
  }

  /**
   * Generate cost report
   */
  async generateReport(deploymentId) {
    const analysis = await this.analyze(deploymentId);
    
    return {
      title: 'Cost Optimization Report',
      generatedAt: new Date(),
      deployment: deploymentId,
      summary: {
        currentMonthlyCost: analysis.currentMonthlyCost,
        potentialSavings: analysis.potentialMonthlySavings,
        savingsPercentage: analysis.savingsPercentage,
        recommendationCount: analysis.recommendations.length
      },
      priorityActions: analysis.priorityActions,
      allRecommendations: analysis.recommendations,
      implementationPlan: this.generateImplementationPlan(analysis.recommendations)
    };
  }

  /**
   * Generate implementation plan
   */
  generateImplementationPlan(recommendations) {
    const phases = {
      immediate: [],
      shortTerm: [],
      longTerm: []
    };

    for (const rec of recommendations) {
      if (rec.priority === 'high' && rec.risk === 'None' || rec.risk?.includes('None')) {
        phases.immediate.push(rec);
      } else if (rec.priority === 'high' || rec.priority === 'medium') {
        phases.shortTerm.push(rec);
      } else {
        phases.longTerm.push(rec);
      }
    }

    return phases;
  }

  /**
   * Get optimization history
   */
  getHistory(deploymentId = null, limit = 10) {
    let history = this.optimizationHistory;
    
    if (deploymentId) {
      history = history.filter(h => h.deploymentId === deploymentId);
    }

    return history.slice(-limit);
  }
}

// Singleton instance
const costOptimizer = new CostOptimizer();

module.exports = costOptimizer;





