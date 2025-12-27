const Cost = require('../models/Cost');
const Deployment = require('../models/Deployment');
const awsService = require('./aws');
const logger = require('../utils/logger');

/**
 * Cost Service
 * Handles cost estimation, tracking, and optimization
 */
class CostService {
  /**
   * Estimate cost before deployment
   */
  async estimateCost(deploymentId, terraformPlan) {
    try {
      const estimate = await awsService.estimateCost(terraformPlan);
      
      // Update deployment with cost estimate
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          estimatedMonthlyCost: estimate.totalMonthlyCost,
          costBreakdown: estimate.breakdown
        }
      );
      
      return estimate;
      
    } catch (error) {
      logger.error('Cost estimation error:', error);
      throw error;
    }
  }

  /**
   * Track actual costs for a deployment
   */
  async trackCosts(deploymentId, startDate, endDate) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }
      
      const costData = await awsService.getActualCost(deploymentId, startDate, endDate);
      
      // Save cost record
      const cost = new Cost({
        deploymentId,
        date: new Date(),
        totalCost: costData.totalCost,
        breakdown: costData.breakdown,
        services: costData.services,
        estimatedCost: deployment.estimatedMonthlyCost
      });
      
      await cost.save();
      
      // Update deployment
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          actualMonthlyCost: costData.totalCost
        }
      );
      
      // Check budget alerts
      if (deployment.budget && deployment.budget.monthly) {
        const budgetThreshold = deployment.budget.monthly * deployment.budget.alertThreshold;
        if (costData.totalCost > budgetThreshold) {
          await this.sendBudgetAlert(deployment, costData.totalCost);
        }
      }
      
      return cost;
      
    } catch (error) {
      logger.error('Cost tracking error:', error);
      throw error;
    }
  }

  /**
   * Get cost breakdown for a deployment
   */
  async getCostBreakdown(deploymentId, startDate, endDate) {
    try {
      const costs = await Cost.find({
        deploymentId,
        date: { $gte: startDate, $lte: endDate }
      }).sort({ date: -1 });
      
      const totalCost = costs.reduce((sum, cost) => sum + cost.totalCost, 0);
      
      const breakdown = {
        compute: 0,
        database: 0,
        networking: 0,
        storage: 0,
        other: 0
      };
      
      costs.forEach(cost => {
        breakdown.compute += cost.breakdown.compute || 0;
        breakdown.database += cost.breakdown.database || 0;
        breakdown.networking += cost.breakdown.networking || 0;
        breakdown.storage += cost.breakdown.storage || 0;
        breakdown.other += cost.breakdown.other || 0;
      });
      
      return {
        totalCost,
        breakdown,
        costs,
        period: { startDate, endDate }
      };
      
    } catch (error) {
      logger.error('Get cost breakdown error:', error);
      throw error;
    }
  }

  /**
   * Get optimization recommendations
   */
  async getOptimizationRecommendations(deploymentId) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }
      
      const recommendations = [];
      
      // Check for right-sizing opportunities
      const rightSizingRecs = await this.analyzeRightSizing(deployment);
      recommendations.push(...rightSizingRecs);
      
      // Check for Reserved Instance opportunities
      const riRecs = await this.analyzeReservedInstances(deployment);
      recommendations.push(...riRecs);
      
      // Check for idle resources
      const idleRecs = await this.analyzeIdleResources(deployment);
      recommendations.push(...idleRecs);
      
      // Update cost record with recommendations
      const latestCost = await Cost.findOne({ deploymentId }).sort({ date: -1 });
      if (latestCost) {
        latestCost.recommendations = recommendations;
        await latestCost.save();
      }
      
      return recommendations;
      
    } catch (error) {
      logger.error('Get optimization recommendations error:', error);
      throw error;
    }
  }

  /**
   * Analyze right-sizing opportunities
   */
  async analyzeRightSizing(deployment) {
    const recommendations = [];
    
    // In production, analyze CloudWatch metrics to determine if instances are over-provisioned
    // For now, return mock recommendations
    
    if (deployment.resources && deployment.resources.length > 0) {
      deployment.resources.forEach(resource => {
        if (resource.type === 'aws_instance' && resource.name.includes('medium')) {
          recommendations.push({
            type: 'right_sizing',
            resource: resource.identifier,
            currentType: 't3.medium',
            recommendedType: 't3.small',
            potentialSavings: 30.42,
            description: 'Instance appears over-provisioned based on usage metrics'
          });
        }
      });
    }
    
    return recommendations;
  }

  /**
   * Analyze Reserved Instance opportunities
   */
  async analyzeReservedInstances(deployment) {
    const recommendations = [];
    
    // Check if deployment has consistent usage that would benefit from RIs
    if (deployment.environment === 'production' && deployment.estimatedMonthlyCost > 100) {
      recommendations.push({
        type: 'reserved_instances',
        resource: 'all',
        currentType: 'On-Demand',
        recommendedType: '1-Year Reserved Instance',
        potentialSavings: deployment.estimatedMonthlyCost * 0.33 * 12,
        description: 'Purchase Reserved Instances for predictable workloads'
      });
    }
    
    return recommendations;
  }

  /**
   * Analyze idle resources
   */
  async analyzeIdleResources(deployment) {
    const recommendations = [];
    
    // In production, check CloudWatch metrics for idle resources
    // For now, return empty array
    
    return recommendations;
  }

  /**
   * Send budget alert
   */
  async sendBudgetAlert(deployment, actualCost) {
    try {
      const notificationService = require('./notification');
      
      await notificationService.sendBudgetAlert({
        deploymentId: deployment.deploymentId,
        deploymentName: deployment.name,
        actualCost,
        budget: deployment.budget.monthly,
        threshold: deployment.budget.alertThreshold
      });
      
      logger.warn('Budget alert sent', {
        deploymentId: deployment.deploymentId,
        actualCost,
        budget: deployment.budget.monthly
      });
      
    } catch (error) {
      logger.error('Send budget alert error:', error);
    }
  }

  /**
   * Set budget for a deployment
   */
  async setBudget(deploymentId, monthlyBudget, alertThreshold = 0.8) {
    try {
      await Deployment.findOneAndUpdate(
        { deploymentId },
        {
          budget: {
            monthly: monthlyBudget,
            alertThreshold
          }
        }
      );
      
      return { success: true };
      
    } catch (error) {
      logger.error('Set budget error:', error);
      throw error;
    }
  }

  /**
   * Get cost forecast
   */
  async getCostForecast(deploymentId) {
    try {
      const costs = await Cost.find({ deploymentId })
        .sort({ date: -1 })
        .limit(30);
      
      if (costs.length < 7) {
        return {
          nextMonthEstimate: null,
          confidence: 0,
          message: 'Insufficient data for forecasting'
        };
      }
      
      // Simple linear regression for forecasting
      const dailyAverage = costs.reduce((sum, c) => sum + c.totalCost, 0) / costs.length;
      const nextMonthEstimate = dailyAverage * 30;
      
      return {
        nextMonthEstimate,
        confidence: Math.min(costs.length / 30, 1),
        trend: 'stable'
      };
      
    } catch (error) {
      logger.error('Get cost forecast error:', error);
      throw error;
    }
  }
}

// Singleton instance
const costService = new CostService();

module.exports = costService;

