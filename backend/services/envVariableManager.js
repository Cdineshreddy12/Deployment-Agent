const DeploymentEnv = require('../models/DeploymentEnv');
const Deployment = require('../models/Deployment');
const logger = require('../utils/logger');
const deploymentEnvService = require('./deploymentEnvService');

/**
 * Environment Variable Manager
 * Enhanced env variable management with reuse capabilities
 */
class EnvVariableManager {
  /**
   * Store env variables for deployment
   */
  async storeEnvVariables(deploymentId, variables, options = {}) {
    try {
      const deployment = await Deployment.findOne({ deploymentId });
      if (!deployment) {
        throw new Error('Deployment not found');
      }

      const userId = deployment.userId;
      
      // Get project type from deployment
      const projectType = options.projectType || 
                         deployment.requirements?.projectType || 
                         null;

      // Update deployment env
      await deploymentEnvService.update(deploymentId, variables, userId);

      // Update reuse metadata
      const deploymentEnv = await deploymentEnvService.get(deploymentId);
      if (deploymentEnv) {
        deploymentEnv.projectType = projectType;
        deploymentEnv.templateName = options.templateName || null;
        deploymentEnv.isReusable = options.isReusable !== false;
        await deploymentEnv.save();
      }

      logger.info('Env variables stored', {
        deploymentId,
        variableCount: Object.keys(variables).length,
        projectType
      });

      return {
        success: true,
        variableCount: Object.keys(variables).length
      };
    } catch (error) {
      logger.error('Failed to store env variables:', error);
      throw error;
    }
  }

  /**
   * Get env variables for deployment
   */
  async getEnvVariables(deploymentId) {
    try {
      const envVars = await deploymentEnvService.getAsObject(deploymentId);
      return envVars;
    } catch (error) {
      logger.error('Failed to get env variables:', error);
      return {};
    }
  }

  /**
   * Find reusable env variables for user/project
   */
  async reuseEnvVariables(userId, projectType = null) {
    try {
      const query = {
        isReusable: true
      };

      // Find deployments by same user
      const userDeployments = await Deployment.find({ userId })
        .select('deploymentId requirements')
        .lean();

      const deploymentIds = userDeployments.map(d => d.deploymentId);

      if (projectType) {
        // Try to match by project type
        const matchingDeployments = userDeployments.filter(
          d => d.requirements?.projectType === projectType
        );
        
        if (matchingDeployments.length > 0) {
          const matchingIds = matchingDeployments.map(d => d.deploymentId);
          query.deploymentId = { $in: matchingIds };
        } else {
          query.deploymentId = { $in: deploymentIds };
        }
      } else {
        query.deploymentId = { $in: deploymentIds };
      }

      const reusableEnvs = await DeploymentEnv.find(query)
        .sort({ updatedAt: -1 })
        .limit(10)
        .lean();

      const results = [];
      for (const env of reusableEnvs) {
        try {
          const variables = await deploymentEnvService.getAsObject(env.deploymentId);
          const deployment = await Deployment.findOne({ deploymentId: env.deploymentId })
            .select('name description environment')
            .lean();

          results.push({
            deploymentId: env.deploymentId,
            deploymentName: deployment?.name || 'Unknown',
            environment: deployment?.environment || 'unknown',
            projectType: env.projectType,
            variableCount: Object.keys(variables).length,
            variables: Object.keys(variables), // Only keys, not values
            lastUsed: env.updatedAt
          });
        } catch (error) {
          logger.warn('Failed to get variables for reusable env', {
            deploymentId: env.deploymentId,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to find reusable env variables:', error);
      return [];
    }
  }

  /**
   * Validate env variables against schema
   */
  validateEnvVariables(variables, schema = null) {
    const errors = [];
    const warnings = [];

    if (!schema) {
      // Basic validation: check for empty values
      for (const [key, value] of Object.entries(variables)) {
        if (!value || value.trim() === '') {
          warnings.push(`Variable ${key} is empty`);
        }
      }
      return { valid: true, errors, warnings };
    }

    // Schema-based validation
    for (const [key, value] of Object.entries(variables)) {
      const fieldSchema = schema[key];
      if (!fieldSchema) {
        warnings.push(`Variable ${key} not in schema`);
        continue;
      }

      // Type validation
      if (fieldSchema.type === 'number' && isNaN(Number(value))) {
        errors.push(`Variable ${key} must be a number`);
      }

      // Required validation
      if (fieldSchema.required && (!value || value.trim() === '')) {
        errors.push(`Variable ${key} is required`);
      }

      // Pattern validation
      if (fieldSchema.pattern && !new RegExp(fieldSchema.pattern).test(value)) {
        errors.push(`Variable ${key} does not match required pattern`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Merge existing and new env variables
   */
  async mergeEnvVariables(deploymentId, newVariables, options = {}) {
    try {
      const existing = await this.getEnvVariables(deploymentId);
      
      // Merge strategy: newVariables override existing
      const merged = {
        ...existing,
        ...newVariables
      };

      // If keepExisting option is set, don't override
      if (options.keepExisting) {
        Object.keys(existing).forEach(key => {
          if (existing[key]) {
            merged[key] = existing[key];
          }
        });
      }

      // Store merged variables
      await this.storeEnvVariables(deploymentId, merged, options);

      return {
        success: true,
        merged,
        added: Object.keys(newVariables).length,
        total: Object.keys(merged).length
      };
    } catch (error) {
      logger.error('Failed to merge env variables:', error);
      throw error;
    }
  }

  /**
   * Reuse env variables from another deployment
   */
  async reuseFromDeployment(targetDeploymentId, sourceDeploymentId, userId) {
    try {
      const sourceVars = await this.getEnvVariables(sourceDeploymentId);
      
      if (Object.keys(sourceVars).length === 0) {
        throw new Error('Source deployment has no env variables');
      }

      // Get source deployment env record
      const sourceEnv = await deploymentEnvService.get(sourceDeploymentId);
      
      // Store in target deployment with reuse metadata
      await this.storeEnvVariables(targetDeploymentId, sourceVars, {
        reusedFrom: sourceDeploymentId,
        projectType: sourceEnv?.projectType || null,
        templateName: sourceEnv?.templateName || null
      });

      logger.info('Env variables reused', {
        targetDeploymentId,
        sourceDeploymentId,
        variableCount: Object.keys(sourceVars).length
      });

      return {
        success: true,
        variableCount: Object.keys(sourceVars).length,
        reusedFrom: sourceDeploymentId
      };
    } catch (error) {
      logger.error('Failed to reuse env variables:', error);
      throw error;
    }
  }
}

// Singleton instance
const envVariableManager = new EnvVariableManager();

module.exports = envVariableManager;

