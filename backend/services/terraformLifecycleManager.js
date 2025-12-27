const terraformService = require('./terraform');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Terraform Lifecycle Manager
 * Enhanced Terraform management with atomic operations, validation, and progress tracking
 */
class TerraformLifecycleManager {
  constructor() {
    this.initCache = new Map(); // Track initialized deployments
  }

  /**
   * Pre-flight checks: Validate Terraform code before writing
   */
  async validateTerraformCode(terraformCode) {
    const issues = [];

    // Check for required files
    if (!terraformCode.main || terraformCode.main.trim().length < 50) {
      issues.push('main.tf is missing or too short');
    }

    // Check for basic Terraform syntax indicators
    if (terraformCode.main && !terraformCode.main.includes('terraform') && !terraformCode.main.includes('provider')) {
      issues.push('main.tf does not appear to contain valid Terraform code');
    }

    // Check for provider configuration
    const hasProvider = terraformCode.providers && terraformCode.providers.trim().length > 0;
    const mainHasProvider = terraformCode.main && (
      terraformCode.main.includes('provider "aws"') ||
      terraformCode.main.includes('provider "azure"') ||
      terraformCode.main.includes('provider "gcp"')
    );

    if (!hasProvider && !mainHasProvider) {
      issues.push('No provider configuration found');
    }

    // Check for resource definitions
    if (terraformCode.main && !terraformCode.main.match(/resource\s+"[\w_]+"/i)) {
      issues.push('No resource definitions found in main.tf');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  /**
   * Write Terraform files atomically (all or nothing)
   */
  async writeFilesAtomically(deploymentId, terraformCode) {
    const dir = terraformService.getWorkingDir(deploymentId);
    await terraformService.ensureWorkingDir(deploymentId);

    // Validate before writing
    const validation = await this.validateTerraformCode(terraformCode);
    if (!validation.valid) {
      throw new Error(`Terraform code validation failed: ${validation.issues.join(', ')}`);
    }

    const files = {
      'main.tf': terraformCode.main || '',
      'variables.tf': terraformCode.variables || '',
      'outputs.tf': terraformCode.outputs || '',
      'providers.tf': terraformCode.providers || '',
      'backend.tf': terraformService.generateBackendConfig(deploymentId)
    };

    const tempDir = `${dir}.tmp`;
    const writtenFiles = [];

    try {
      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true });

      // Write all files to temp directory first
      for (const [filename, content] of Object.entries(files)) {
        if (content && content.trim().length > 0) {
          const filePath = path.join(tempDir, filename);
          await fs.writeFile(filePath, content, 'utf8');
          writtenFiles.push(filename);
        }
      }

      // If all files written successfully, move temp directory to final location
      // Remove existing directory if it exists
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (error) {
        // Directory might not exist, that's okay
      }

      // Move temp directory to final location
      await fs.rename(tempDir, dir);

      logger.info('Terraform files written atomically', {
        deploymentId,
        files: writtenFiles
      });

      // Format Terraform code
      try {
        await terraformService.formatTerraformCode(deploymentId);
      } catch (error) {
        logger.warn('Failed to format Terraform code', {
          deploymentId,
          error: error.message
        });
        // Don't throw - formatting is not critical
      }

      return {
        success: true,
        files: writtenFiles,
        directory: dir
      };

    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logger.warn('Failed to cleanup temp directory', {
          deploymentId,
          error: cleanupError.message
        });
      }

      logger.error('Failed to write Terraform files atomically', {
        deploymentId,
        error: error.message
      });

      throw new Error(`Failed to write Terraform files: ${error.message}`);
    }
  }

  /**
   * Smart Terraform initialization (skip if already initialized)
   */
  async initialize(deploymentId, force = false) {
    // Check cache first
    if (!force && this.initCache.has(deploymentId)) {
      logger.debug('Terraform already initialized (cached)', { deploymentId });
      return {
        success: true,
        cached: true,
        message: 'Terraform already initialized'
      };
    }

    // Check if .terraform directory exists
    const dir = terraformService.getWorkingDir(deploymentId);
    const terraformDir = path.join(dir, '.terraform');

    if (!force) {
      try {
        await fs.access(terraformDir);
        // .terraform exists, assume initialized
        this.initCache.set(deploymentId, true);
        logger.debug('Terraform already initialized (.terraform exists)', { deploymentId });
        return {
          success: true,
          cached: true,
          message: 'Terraform already initialized'
        };
      } catch (error) {
        // .terraform doesn't exist, need to initialize
      }
    }

    try {
      const result = await terraformService.init(deploymentId);
      this.initCache.set(deploymentId, true);

      logger.info('Terraform initialized successfully', { deploymentId });

      return {
        success: true,
        cached: false,
        output: result.output,
        message: 'Terraform initialized successfully'
      };
    } catch (error) {
      logger.error('Terraform initialization failed', {
        deploymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Run Terraform plan with validation
   */
  async plan(deploymentId, options = {}) {
    try {
      // Ensure initialized first
      await this.initialize(deploymentId);

      const planResult = await terraformService.plan(deploymentId, options);

      // Parse and validate plan output
      const parsedPlan = this.parsePlanOutput(planResult.plan || '');

      logger.info('Terraform plan completed', {
        deploymentId,
        changes: parsedPlan.changes
      });

      return {
        success: true,
        plan: planResult.plan,
        changes: parsedPlan.changes,
        resources: parsedPlan.resources,
        planFile: planResult.planFile
      };
    } catch (error) {
      logger.error('Terraform plan failed', {
        deploymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Apply Terraform with progress tracking
   */
  async apply(deploymentId, options = {}) {
    try {
      const { autoApprove = true, progressCallback = null } = options;

      // Ensure initialized
      await this.initialize(deploymentId);

      // Run plan first if plan file doesn't exist
      const dir = terraformService.getWorkingDir(deploymentId);
      const planFile = path.join(dir, 'tfplan');

      try {
        await fs.access(planFile);
      } catch (error) {
        // Plan file doesn't exist, run plan first
        logger.info('Plan file not found, running plan first', { deploymentId });
        await this.plan(deploymentId);
      }

      // Apply Terraform
      const applyResult = await terraformService.apply(deploymentId, { autoApprove });

      // Extract resources from apply output
      const resources = this.extractResources(applyResult.output || '');

      logger.info('Terraform apply completed', {
        deploymentId,
        resourcesCreated: resources.length
      });

      return {
        success: true,
        output: applyResult.output,
        resources,
        state: applyResult.state
      };
    } catch (error) {
      logger.error('Terraform apply failed', {
        deploymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Parse Terraform plan output
   */
  parsePlanOutput(planOutput) {
    const changes = {
      add: 0,
      change: 0,
      destroy: 0
    };

    const resources = [];

    if (!planOutput) {
      return { changes, resources };
    }

    // Extract change counts
    const addMatch = planOutput.match(/(\d+)\s+to add/i);
    const changeMatch = planOutput.match(/(\d+)\s+to change/i);
    const destroyMatch = planOutput.match(/(\d+)\s+to destroy/i);

    if (addMatch) changes.add = parseInt(addMatch[1], 10);
    if (changeMatch) changes.change = parseInt(changeMatch[1], 10);
    if (destroyMatch) changes.destroy = parseInt(destroyMatch[1], 10);

    // Extract resource information
    const resourcePattern = /will be created[\s\S]*?aws_(\w+)\.(\w+)/gi;
    let match;
    while ((match = resourcePattern.exec(planOutput)) !== null) {
      resources.push({
        type: `aws_${match[1]}`,
        name: match[2],
        action: 'create'
      });
    }

    return { changes, resources };
  }

  /**
   * Extract resources from Terraform apply output
   */
  extractResources(applyOutput) {
    const resources = [];

    if (!applyOutput) {
      return resources;
    }

    // Pattern to match created resources
    const createdPattern = /aws_(\w+)\.(\w+)\s+created/i;
    const lines = applyOutput.split('\n');

    for (const line of lines) {
      const match = line.match(createdPattern);
      if (match) {
        resources.push({
          type: `aws_${match[1]}`,
          name: match[2],
          status: 'created',
          identifier: this.extractResourceIdentifier(line, match[1])
        });
      }
    }

    // Also try to extract from "Apply complete!" summary
    const summaryMatch = applyOutput.match(/Apply complete!.*?(\d+)\s+resources? added/i);
    if (summaryMatch) {
      const resourceCount = parseInt(summaryMatch[1], 10);
      if (resources.length < resourceCount) {
        // Some resources might not have been parsed, add placeholders
        for (let i = resources.length; i < resourceCount; i++) {
          resources.push({
            type: 'unknown',
            name: `resource_${i + 1}`,
            status: 'created'
          });
        }
      }
    }

    return resources;
  }

  /**
   * Extract resource identifier from output line
   */
  extractResourceIdentifier(line, resourceType) {
    // Try to extract ARN or ID from the line
    const arnMatch = line.match(/arn:aws:[^:\s]+:[^:\s]+:[^:\s]+:[^:\s]+/i);
    if (arnMatch) {
      return arnMatch[0];
    }

    // Try to extract ID pattern
    const idMatch = line.match(/(?:id|name|arn)\s*[:=]\s*["']?([^"'\s]+)["']?/i);
    if (idMatch) {
      return idMatch[1];
    }

    return null;
  }

  /**
   * Get Terraform state
   */
  async getState(deploymentId) {
    try {
      return await terraformService.getState(deploymentId);
    } catch (error) {
      logger.error('Failed to get Terraform state', {
        deploymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate Terraform syntax
   */
  async validateSyntax(deploymentId) {
    try {
      const validationResult = await terraformService.validate(deploymentId);
      return {
        success: validationResult.overall?.valid || false,
        issues: validationResult.overall?.issues || [],
        details: validationResult
      };
    } catch (error) {
      logger.error('Terraform syntax validation failed', {
        deploymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Clear initialization cache (useful for testing or forced re-init)
   */
  clearInitCache(deploymentId) {
    if (deploymentId) {
      this.initCache.delete(deploymentId);
    } else {
      this.initCache.clear();
    }
  }
}

// Singleton instance
const terraformLifecycleManager = new TerraformLifecycleManager();

module.exports = terraformLifecycleManager;





