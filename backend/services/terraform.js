const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const Deployment = require('../models/Deployment');
const awsService = require('./aws');
const logger = require('../utils/logger');

const execAsync = promisify(exec);

/**
 * Execute command with proper shell detection
 * Uses spawn with shell: true to automatically use system's default shell
 */
function execCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    // Use spawn with shell: true for automatic shell detection
    // This will use the system's default shell (SHELL env var or system default)
    const child = spawn(command, {
      ...options,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('error', (error) => {
      // If spawn fails, fallback to execAsync for compatibility
      logger.warn('Spawn failed, falling back to exec', { error: error.message, command });
      execAsync(command, options)
        .then(resolve)
        .catch(reject);
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`Command failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Terraform Service
 * Handles Terraform operations: init, plan, apply, destroy, validate
 */
class TerraformService {
  /**
   * Get working directory for a deployment
   */
  getWorkingDir(deploymentId) {
    return path.join(__dirname, '../../terraform', deploymentId);
  }

  /**
   * Ensure working directory exists
   */
  async ensureWorkingDir(deploymentId) {
    const dir = this.getWorkingDir(deploymentId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  /**
   * Write Terraform files to disk
   * Automatically formats code using terraform fmt after writing
   */
  async writeTerraformFiles(deploymentId, terraformCode) {
    const dir = await this.ensureWorkingDir(deploymentId);
    
    // Validate that we have at least main.tf
    if (!terraformCode.main || terraformCode.main.trim().length < 50) {
      logger.warn('Terraform code appears incomplete', {
        deploymentId,
        hasMain: !!terraformCode.main,
        mainLength: terraformCode.main?.length || 0
      });
      throw new Error('Terraform code is incomplete. Main.tf must contain valid Terraform code.');
    }
    
    const files = {
      'main.tf': terraformCode.main || '',
      'variables.tf': terraformCode.variables || '',
      'outputs.tf': terraformCode.outputs || '',
      'providers.tf': terraformCode.providers || '',
      'backend.tf': this.generateBackendConfig(deploymentId)
    };
    
    // Write all files
    for (const [filename, content] of Object.entries(files)) {
      if (content && content.trim().length > 0) {
        await fs.writeFile(path.join(dir, filename), content, 'utf8');
        logger.debug(`Written ${filename}`, { 
          deploymentId, 
          filename, 
          length: content.length 
        });
      }
    }
    
    logger.info('Terraform files written', { 
      deploymentId, 
      files: Object.keys(files).filter(f => files[f] && files[f].trim().length > 0)
    });
    
    // Automatically format Terraform code using terraform fmt
    try {
      await this.formatTerraformCode(deploymentId);
      logger.info('Terraform code formatted successfully', { deploymentId });
    } catch (error) {
      logger.warn('Failed to format Terraform code, continuing anyway', {
        deploymentId,
        error: error.message
      });
      // Don't throw - formatting failure shouldn't break the flow
    }
    
    return dir;
  }

  /**
   * Format Terraform code using terraform fmt
   */
  async formatTerraformCode(deploymentId) {
    try {
      const dir = this.getWorkingDir(deploymentId);
      
      // Run terraform fmt to format all .tf files
      const { stdout, stderr } = await execCommand('terraform fmt -recursive', {
        cwd: dir,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
          AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1'
        }
      });
      
      logger.debug('Terraform fmt completed', { 
        deploymentId, 
        stdout: stdout.substring(0, 200),
        stderr: stderr.substring(0, 200)
      });
      
      return { success: true, output: stdout };
    } catch (error) {
      // terraform fmt returns non-zero exit code if files were changed
      // This is expected behavior, so we check if it's a formatting issue
      if (error.code === 3 || (error.stdout && error.stdout.includes('formatted'))) {
        // Files were formatted successfully
        logger.info('Terraform files were reformatted', { deploymentId });
        return { success: true, output: error.stdout };
      }
      
      // If terraform is not installed or other error, log and rethrow
      logger.error('Terraform fmt error:', error);
      throw error;
    }
  }

  /**
   * Generate backend configuration
   */
  generateBackendConfig(deploymentId) {
    const { terraformStateConfig } = require('../config/aws');
    
    return `
terraform {
  backend "s3" {
    bucket         = "${terraformStateConfig.bucket}"
    key            = "deployments/${deploymentId}/terraform.tfstate"
    region         = "${terraformStateConfig.region}"
    encrypt        = true
    dynamodb_table = "${terraformStateConfig.table}"
  }
}
`;
  }

  /**
   * Initialize Terraform
   */
  async init(deploymentId) {
    try {
      const dir = await this.ensureWorkingDir(deploymentId);
      
      const { stdout, stderr } = await execCommand('terraform init', {
        cwd: dir,
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
          AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1'
        }
      });
      
      logger.info('Terraform initialized', { deploymentId });
      return { success: true, output: stdout };
      
    } catch (error) {
      logger.error('Terraform init error:', error);
      throw new Error(`Terraform init failed: ${error.message}`);
    }
  }

  /**
   * Validate Terraform code
   */
  async validate(deploymentId, options = {}) {
    try {
      const dir = this.getWorkingDir(deploymentId);
      const validationResults = {
        syntax: { valid: false, issues: [] },
        plan: { valid: false, issues: [] },
        security: { valid: false, issues: [] },
        bestPractices: { valid: false, issues: [] },
        overall: { valid: false, issues: [] }
      };
      
      // 1. Syntax validation
      try {
        await execCommand('terraform fmt -check', { cwd: dir });
      } catch (error) {
        // Format if needed
        try {
          await execCommand('terraform fmt', { cwd: dir });
        } catch (fmtError) {
          // Log but don't fail validation if fmt fails
          logger.warn('Terraform fmt failed, continuing validation', { 
            deploymentId, 
            error: fmtError.message 
          });
        }
      }
      
      const { stdout, stderr } = await execCommand('terraform validate', {
        cwd: dir
      });
      
      validationResults.syntax = {
        valid: true,
        output: stdout,
        issues: []
      };
      
      // 2. Plan validation (if requested)
      if (options.includePlan) {
        try {
          const planResult = await this.plan(deploymentId, { checkOnly: true });
          validationResults.plan = {
            valid: planResult.success,
            output: planResult.output,
            issues: planResult.errors || []
          };
        } catch (error) {
          validationResults.plan = {
            valid: false,
            issues: [error.message]
          };
        }
      }
      
      // 3. Security checks (basic)
      const securityIssues = this.checkSecurityIssues(dir);
      validationResults.security = {
        valid: securityIssues.length === 0,
        issues: securityIssues
      };
      
      // 4. Best practices checks
      const bestPracticeIssues = this.checkBestPractices(dir);
      validationResults.bestPractices = {
        valid: bestPracticeIssues.length === 0,
        issues: bestPracticeIssues
      };
      
      // Overall validation
      validationResults.overall = {
        valid: validationResults.syntax.valid && 
               validationResults.security.valid && 
               validationResults.bestPractices.valid,
        issues: [
          ...validationResults.syntax.issues,
          ...validationResults.security.issues,
          ...validationResults.bestPractices.issues
        ]
      };
      
      logger.info('Terraform validation completed', { 
        deploymentId,
        overall: validationResults.overall.valid
      });
      
      return validationResults;
      
    } catch (error) {
      logger.error('Terraform validate error:', error);
      return {
        syntax: {
          valid: false,
          output: error.stdout || error.stderr,
          issues: [error.message]
        },
        overall: {
          valid: false,
          issues: [error.message]
        }
      };
    }
  }

  /**
   * Check for security issues in Terraform code
   */
  checkSecurityIssues(dir) {
    const issues = [];
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Check main.tf
      const mainTfPath = path.join(dir, 'main.tf');
      if (fs.existsSync(mainTfPath)) {
        const content = fs.readFileSync(mainTfPath, 'utf-8');
        
        // Check for hardcoded secrets
        if (content.match(/password\s*=\s*["'][^"']+["']/i)) {
          issues.push('Hardcoded password detected - use variables instead');
        }
        
        // Check for public access without restrictions
        if (content.match(/cidr_blocks\s*=\s*\["0\.0\.0\.0\/0"\]/i)) {
          issues.push('Security group allows access from 0.0.0.0/0 - consider restricting');
        }
        
        // Check for unencrypted storage
        if (content.match(/encrypted\s*=\s*false/i)) {
          issues.push('Unencrypted storage detected - enable encryption');
        }
      }
    } catch (error) {
      logger.warn('Security check error:', error);
    }
    
    return issues;
  }

  /**
   * Check for best practices in Terraform code
   */
  checkBestPractices(dir) {
    const issues = [];
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Check for tags
      const mainTfPath = path.join(dir, 'main.tf');
      if (fs.existsSync(mainTfPath)) {
        const content = fs.readFileSync(mainTfPath, 'utf-8');
        
        // Check if tags are present
        if (!content.match(/tags\s*=/i)) {
          issues.push('No tags found - add tags for resource management');
        }
        
        // Check for variables usage
        if (content.match(/ami\s*=\s*"ami-[a-z0-9]+"/i)) {
          issues.push('Hardcoded AMI ID detected - use variables or data source');
        }
      }
      
      // Check for variables.tf
      const variablesTfPath = path.join(dir, 'variables.tf');
      if (!fs.existsSync(variablesTfPath)) {
        issues.push('variables.tf not found - define variables for configurability');
      }
      
      // Check for outputs.tf
      const outputsTfPath = path.join(dir, 'outputs.tf');
      if (!fs.existsSync(outputsTfPath)) {
        issues.push('outputs.tf not found - define outputs for important values');
      }
    } catch (error) {
      logger.warn('Best practices check error:', error);
    }
    
    return issues;
  }

  /**
   * Run Terraform plan
   */
  async plan(deploymentId, options = {}) {
    try {
      const dir = this.getWorkingDir(deploymentId);
      const lockId = uuidv4();
      
      // Lock state
      try {
        await awsService.lockTerraformState(deploymentId, lockId);
      } catch (error) {
        if (error.message.includes('locked')) {
          throw new Error('Terraform state is locked by another operation');
        }
        throw error;
      }
      
      try {
        const varFile = options.varFile ? `-var-file=${options.varFile}` : '';
        const command = `terraform plan -out=tfplan ${varFile}`;
        
        const { stdout, stderr } = await execCommand(command, {
          cwd: dir,
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
            AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1'
          }
        });
        
        // Parse plan output
        const changes = this.parsePlanOutput(stdout);
        
        logger.info('Terraform plan completed', { deploymentId, changes });
        
        return {
          success: true,
          plan: stdout,
          changes,
          planFile: path.join(dir, 'tfplan')
        };
        
      } finally {
        // Unlock state
        await awsService.unlockTerraformState(deploymentId);
      }
      
    } catch (error) {
      logger.error('Terraform plan error:', error);
      throw error;
    }
  }

  /**
   * Apply Terraform plan
   */
  async apply(deploymentId, options = {}) {
    try {
      const dir = this.getWorkingDir(deploymentId);
      const lockId = uuidv4();
      
      // Lock state
      try {
        await awsService.lockTerraformState(deploymentId, lockId);
      } catch (error) {
        if (error.message.includes('locked')) {
          throw new Error('Terraform state is locked by another operation');
        }
        throw error;
      }
      
      try {
        const command = options.autoApprove 
          ? 'terraform apply -auto-approve tfplan'
          : 'terraform apply tfplan';
        
        const { stdout, stderr } = await execCommand(command, {
          cwd: dir,
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
            AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1'
          }
        });
        
        // Parse apply output to extract created resources
        const resources = this.parseApplyOutput(stdout);
        
        // Get state
        const state = await this.getState(deploymentId);
        
        logger.info('Terraform apply completed', { deploymentId, resourcesCreated: resources.length });
        
        return {
          success: true,
          output: stdout,
          resources,
          state
        };
        
      } finally {
        // Unlock state
        await awsService.unlockTerraformState(deploymentId);
      }
      
    } catch (error) {
      logger.error('Terraform apply error:', error);
      throw error;
    }
  }

  /**
   * Destroy Terraform resources
   */
  async destroy(deploymentId, options = {}) {
    try {
      const dir = this.getWorkingDir(deploymentId);
      const lockId = uuidv4();
      
      // Lock state
      try {
        await awsService.lockTerraformState(deploymentId, lockId);
      } catch (error) {
        if (error.message.includes('locked')) {
          throw new Error('Terraform state is locked by another operation');
        }
        throw error;
      }
      
      try {
        const command = options.autoApprove 
          ? 'terraform destroy -auto-approve'
          : 'terraform destroy';
        
        const { stdout, stderr } = await execCommand(command, {
          cwd: dir,
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
            AWS_DEFAULT_REGION: process.env.AWS_REGION || 'us-east-1'
          }
        });
        
        logger.info('Terraform destroy completed', { deploymentId });
        
        return {
          success: true,
          output: stdout
        };
        
      } finally {
        // Unlock state
        await awsService.unlockTerraformState(deploymentId);
      }
      
    } catch (error) {
      logger.error('Terraform destroy error:', error);
      throw error;
    }
  }

  /**
   * Get Terraform state
   */
  async getState(deploymentId) {
    try {
      return await awsService.getTerraformState(deploymentId);
    } catch (error) {
      logger.error('Get Terraform state error:', error);
      throw error;
    }
  }

  /**
   * Parse plan output to extract changes
   */
  parsePlanOutput(output) {
    const changes = {
      add: 0,
      change: 0,
      destroy: 0
    };
    
    const addMatch = output.match(/(\d+) to add/);
    const changeMatch = output.match(/(\d+) to change/);
    const destroyMatch = output.match(/(\d+) to destroy/);
    
    if (addMatch) changes.add = parseInt(addMatch[1]);
    if (changeMatch) changes.change = parseInt(changeMatch[1]);
    if (destroyMatch) changes.destroy = parseInt(destroyMatch[1]);
    
    return changes;
  }

  /**
   * Parse apply output to extract resources
   */
  parseApplyOutput(output) {
    const resources = [];
    
    // Extract resource patterns
    const resourcePattern = /aws_\w+\.(\w+)\s+created/gi;
    let match;
    
    while ((match = resourcePattern.exec(output)) !== null) {
      resources.push({
        type: match[0].split('.')[0],
        name: match[1],
        status: 'created'
      });
    }
    
    return resources;
  }

  /**
   * Generate Terraform code using Claude with Terraform MCP Server
   * This leverages Terraform MCP to fetch current provider docs and modules
   */
  async generateCode(requirements, deploymentId) {
    const claudeService = require('./claude');
    const result = await claudeService.generateTerraform(requirements, deploymentId);
    
    // Log MCP usage for analytics
    if (result.mcpToolsUsed && result.mcpToolsUsed.length > 0) {
      logger.info('Terraform code generated using MCP tools', {
        deploymentId,
        mcpToolsUsed: result.mcpToolsUsed
      });
    }
    
    return result;
  }
}

// Singleton instance
const terraformService = new TerraformService();

module.exports = terraformService;

