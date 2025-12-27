const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const simpleGit = require('simple-git');
const logger = require('../utils/logger');
const DeploymentLog = require('../models/DeploymentLog');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * CLI Executor Service
 * Executes CLI operations server-side for deployments
 */
class CLIExecutor {
  constructor() {
    this.activeExecutions = new Map(); // deploymentId -> { process, ws }
    this.tempDirs = new Map(); // deploymentId -> tempDir
  }

  /**
   * Get or create temp directory for deployment
   */
  async getTempDir(deploymentId) {
    if (this.tempDirs.has(deploymentId)) {
      return this.tempDirs.get(deploymentId);
    }

    const tempDir = path.join(os.tmpdir(), 'deployment-agent', deploymentId);
    await fs.ensureDir(tempDir);
    this.tempDirs.set(deploymentId, tempDir);
    return tempDir;
  }

  /**
   * Clone repository to temp directory
   */
  async cloneRepository(deploymentId, repoUrl, branch = 'main', githubToken = null) {
    const tempDir = await this.getTempDir(deploymentId);
    const repoDir = path.join(tempDir, 'repo');

    try {
      await this.log(deploymentId, 'info', `Cloning repository ${repoUrl} (branch: ${branch})...`);

      // Remove existing repo directory if it exists
      if (await fs.pathExists(repoDir)) {
        await fs.remove(repoDir);
      }

      const git = simpleGit();
      
      // Clone with token if provided
      let cloneUrl = repoUrl;
      if (githubToken && repoUrl.includes('github.com')) {
        // Insert token into URL
        cloneUrl = repoUrl.replace('https://', `https://${githubToken}@`);
      }

      await git.clone(cloneUrl, repoDir, ['--branch', branch, '--depth', '1']);

      await this.log(deploymentId, 'info', `Repository cloned successfully to ${repoDir}`);

      return {
        success: true,
        repoPath: repoDir,
        branch
      };
    } catch (error) {
      await this.log(deploymentId, 'error', `Failed to clone repository: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate deployment files (Terraform, Dockerfiles, etc.)
   */
  async generateDeploymentFiles(deploymentId, repoPath, terraformCode = null) {
    try {
      await this.log(deploymentId, 'info', 'Generating deployment files...');

      const terraformDir = path.join(repoPath, 'terraform');
      await fs.ensureDir(terraformDir);

      // If terraform code provided, write it
      if (terraformCode) {
        if (terraformCode.main) {
          await fs.writeFile(path.join(terraformDir, 'main.tf'), terraformCode.main);
        }
        if (terraformCode.variables) {
          await fs.writeFile(path.join(terraformDir, 'variables.tf'), terraformCode.variables);
        }
        if (terraformCode.outputs) {
          await fs.writeFile(path.join(terraformDir, 'outputs.tf'), terraformCode.outputs);
        }
        if (terraformCode.providers) {
          await fs.writeFile(path.join(terraformDir, 'providers.tf'), terraformCode.providers);
        }
        
        // Format Terraform code using terraform fmt
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          
          await execAsync('terraform fmt -recursive', {
            cwd: terraformDir,
            env: process.env
          });
          await this.log(deploymentId, 'info', 'Terraform code formatted successfully');
        } catch (fmtError) {
          // Don't fail if formatting fails - terraform might not be installed or files might be fine
          await this.log(deploymentId, 'warn', `Terraform formatting skipped: ${fmtError.message}`);
        }
      }

      // Generate .gitignore if it doesn't exist
      const gitignorePath = path.join(repoPath, '.gitignore');
      if (!(await fs.pathExists(gitignorePath))) {
        await fs.writeFile(gitignorePath, '*.tfstate\n*.tfstate.*\n.terraform/\n.terraform.lock.hcl\n');
      }

      await this.log(deploymentId, 'info', 'Deployment files generated successfully');

      return {
        success: true,
        terraformDir,
        files: await this.listFiles(terraformDir)
      };
    } catch (error) {
      await this.log(deploymentId, 'error', `Failed to generate deployment files: ${error.message}`);
      throw error;
    }
  }

  /**
   * List files in directory
   */
  async listFiles(dir) {
    const files = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...(await this.listFiles(fullPath)));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      logger.error('Error listing files:', error);
    }
    return files;
  }

  /**
   * Execute deployment command
   */
  async executeDeployment(deploymentId, command, options = {}) {
    const { cwd, env = {}, timeout = 300000 } = options;
    
    // Check if workspace path is set (Cursor integration)
    const cursorIntegration = require('./cursorIntegration');
    const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
    
    // Use workspace path if available, otherwise use temp dir
    const workDir = cwd || workspacePath || await this.getTempDir(deploymentId);

    await this.log(deploymentId, 'info', `Executing: ${command}`);

    // Log command to history service
    const commandHistoryService = require('./commandHistoryService');
    const startTime = Date.now();
    let commandRecord = null;

    return new Promise(async (resolve, reject) => {
      // Get the user's shell with proper fallback
      // Check if shells exist before using them
      const fs = require('fs-extra');
      let shell = '/bin/sh'; // Ultimate fallback
      
      const shellCandidates = [
        process.env.SHELL,
        process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
        '/bin/bash',
        '/bin/sh'
      ].filter(Boolean);
      
      for (const candidate of shellCandidates) {
        try {
          if (await fs.pathExists(candidate)) {
            shell = candidate;
            break;
          }
        } catch (e) {
          // Continue to next candidate
        }
      }
      
      // Build environment with proper PATH
      // Include common PATH locations for AWS CLI and other tools
      const commonPaths = [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/opt/homebrew/bin', // Homebrew on Apple Silicon
        '/usr/local/opt', // Homebrew on Intel
        process.env.HOME ? `${process.env.HOME}/.local/bin` : null,
        process.env.HOME ? `${process.env.HOME}/.cargo/bin` : null,
        // AWS CLI common installation locations
        '/usr/local/aws-cli/v2/current/bin', // AWS CLI v2 default location
        '/usr/local/aws-cli/bin', // AWS CLI v1 default location
      ].filter(Boolean);
      
      // Try to find AWS CLI location if not in PATH
      try {
        const { execSync } = require('child_process');
        // Try to find AWS CLI using which
        try {
          const whichResult = execSync('which aws', { encoding: 'utf8', env: process.env, timeout: 1000 }).trim();
          if (whichResult) {
            const awsCliPath = path.dirname(whichResult);
            if (!commonPaths.includes(awsCliPath)) {
              commonPaths.push(awsCliPath);
            }
          }
        } catch (e) {
          // AWS CLI not found via which, that's okay
        }
      } catch (error) {
        logger.debug('Could not find AWS CLI location', { error: error.message });
      }
      
      // Merge PATHs - ensure common paths are included
      const existingPath = process.env.PATH || '';
      const pathArray = existingPath.split(path.delimiter);
      const mergedPath = [...new Set([...pathArray, ...commonPaths])].join(path.delimiter);
      
      // Create environment with proper PATH
      const commandEnv = {
        ...process.env,
        PATH: mergedPath,
        ...env
      };

      // Use shell with -l flag to load login shell environment (includes .zshrc, .bash_profile, etc.)
      // This ensures AWS CLI and other tools in PATH are available
      // The -l flag makes the shell a login shell, which sources profile files
      const shellArgs = shell.includes('zsh') 
        ? ['-l', '-c', command]
        : shell.includes('bash')
        ? ['-l', '-c', command]
        : ['-c', command];

      const childProcess = spawn(shell, shellArgs, {
        cwd: workDir,
        env: commandEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        this.streamLog(deploymentId, 'info', output);
      });

      childProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        this.streamLog(deploymentId, 'error', output);
      });

      const timeoutId = setTimeout(() => {
        childProcess.kill();
        this.log(deploymentId, 'error', 'Command execution timeout');
        reject(new Error('Command execution timeout'));
      }, timeout);

      childProcess.on('close', async (code) => {
        clearTimeout(timeoutId);
        
        // Log command to history service
        try {
          const commandHistoryService = require('./commandHistoryService');
          const Deployment = require('../models/Deployment');
          const deployment = await Deployment.findOne({ deploymentId });
          
          if (deployment) {
            await commandHistoryService.logCommand(
              deploymentId,
              command,
              {
                success: code === 0,
                code,
                stdout,
                stderr
              },
              deployment.status, // Use current deployment status as step
              {
                cwd: workDir,
                env: Object.keys(commandEnv).length > 0 ? 'set' : 'none'
              }
            );
          }
        } catch (error) {
          logger.warn('Failed to log command history:', error);
        }
        
        if (code === 0) {
          await this.log(deploymentId, 'info', 'Command executed successfully');
          
          // Check if step should be automatically marked as complete
          try {
            await this.checkAndMarkStepComplete(deploymentId, command, deployment?.status);
          } catch (error) {
            // Don't fail command execution if step completion check fails
            logger.debug('Step completion check failed (non-critical):', error.message);
          }
          
          resolve({
            success: true,
            code,
            stdout,
            stderr
          });
        } else {
          await this.log(deploymentId, 'error', `Command failed with code ${code}`);
          reject(new Error(`Command failed with exit code ${code}: ${stderr}`));
        }
      });

      childProcess.on('error', async (error) => {
        clearTimeout(timeoutId);
        await this.log(deploymentId, 'error', `Command execution error: ${error.message}`);
        reject(error);
      });

      // Store active execution
      this.activeExecutions.set(deploymentId, { process: childProcess });
    });
  }

  /**
   * Set broadcast function (called from server.js)
   */
  setBroadcastFunction(broadcastFn) {
    this.broadcastCLILog = broadcastFn;
  }

  /**
   * Stream logs to WebSocket clients
   */
  streamLog(deploymentId, level, message) {
    // Broadcast to WebSocket clients if broadcast function is set
    if (this.broadcastCLILog) {
      this.broadcastCLILog(deploymentId, level, message);
    }
    
    // Store log for later retrieval
    this.log(deploymentId, level, message).catch(err => {
      logger.error('Failed to store log:', err);
    });
  }

  /**
   * Store log in database
   */
  async log(deploymentId, level, message, source = 'cli') {
    try {
      await DeploymentLog.create({
        deploymentId,
        level,
        message: message.trim(),
        source,
        timestamp: new Date()
      });
    } catch (error) {
      logger.error('Failed to store log:', error);
    }
  }

  /**
   * Get logs for deployment
   */
  async getLogs(deploymentId, options = {}) {
    const { level, limit = 100, offset = 0 } = options;
    
    const query = { deploymentId };
    if (level) {
      query.level = level;
    }

    const logs = await DeploymentLog.find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(offset)
      .lean();

    return logs.reverse(); // Return in chronological order
  }

  /**
   * Cleanup temp directory for deployment
   */
  async cleanup(deploymentId) {
    try {
      const tempDir = this.tempDirs.get(deploymentId);
      if (tempDir && await fs.pathExists(tempDir)) {
        await fs.remove(tempDir);
        this.tempDirs.delete(deploymentId);
        await this.log(deploymentId, 'info', 'Temporary files cleaned up');
      }

      // Kill any active processes
      const execution = this.activeExecutions.get(deploymentId);
      if (execution && execution.process) {
        execution.process.kill();
        this.activeExecutions.delete(deploymentId);
      }
    } catch (error) {
      logger.error(`Failed to cleanup deployment ${deploymentId}:`, error);
    }
  }

  /**
   * Run terraform commands
   */
  async runTerraform(deploymentId, command, terraformDir) {
    const commands = {
      init: 'terraform init',
      plan: 'terraform plan',
      apply: 'terraform apply -auto-approve',
      destroy: 'terraform destroy -auto-approve',
      validate: 'terraform validate',
      fmt: 'terraform fmt -check'
    };

    const terraformCommand = commands[command] || command;
    return this.executeDeployment(deploymentId, terraformCommand, {
      cwd: terraformDir,
      timeout: 600000 // 10 minutes for terraform operations
    });
  }

  /**
   * Execute command with streaming callbacks for SSE
   * @param {string} deploymentId - Deployment ID
   * @param {string} command - Command to execute
   * @param {Object} options - Options including onStdout, onStderr callbacks
   * @returns {Promise} - Resolves with exit code and output
   */
  async executeWithStream(deploymentId, command, options = {}) {
    const { cwd, env = {}, timeout = 300000, onStdout, onStderr } = options;
    
    // Check if workspace path is set (Cursor integration)
    let workDir = cwd;
    if (!workDir && deploymentId !== 'temp') {
      try {
        const cursorIntegration = require('./cursorIntegration');
        workDir = cursorIntegration.getWorkspacePath(deploymentId);
      } catch (e) {}
    }
    if (!workDir) {
      workDir = await this.getTempDir(deploymentId);
    }

    await this.log(deploymentId, 'info', `Executing (stream): ${command}`);

    return new Promise(async (resolve, reject) => {
      // Get the user's shell
      let shell = '/bin/sh';
      const shellCandidates = [
        process.env.SHELL,
        process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
        '/bin/bash',
        '/bin/sh'
      ].filter(Boolean);
      
      for (const candidate of shellCandidates) {
        try {
          if (await fs.pathExists(candidate)) {
            shell = candidate;
            break;
          }
        } catch (e) {}
      }
      
      // Build environment with proper PATH
      const commonPaths = [
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/opt/homebrew/bin',
        path.join(process.env.HOME || '', '.local/bin'),
        path.join(process.env.HOME || '', 'bin'),
        '/usr/local/opt/awscli/bin'
      ];
      
      const pathEnv = [
        ...new Set([
          ...commonPaths,
          ...(process.env.PATH || '').split(':')
        ])
      ].join(':');
      
      const execEnv = {
        ...process.env,
        ...env,
        PATH: pathEnv
      };

      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn(shell, ['-c', command], {
        cwd: workDir,
        env: execEnv,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Set timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        if (onStderr) onStderr(`\nCommand timed out after ${timeout}ms\n`);
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onStdout) onStdout(text);
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (onStderr) onStderr(text);
      });

      proc.on('close', async (code) => {
        clearTimeout(timeoutId);
        
        if (killed) return;

        await this.log(deploymentId, code === 0 ? 'info' : 'error', 
          `Command completed with exit code ${code}`);

        resolve({
          success: code === 0,
          code,
          stdout,
          stderr
        });
      });

      proc.on('error', async (error) => {
        clearTimeout(timeoutId);
        await this.log(deploymentId, 'error', `Command error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * Check if step should be marked as complete after successful command
   */
  async checkAndMarkStepComplete(deploymentId, command, currentStatus) {
    try {
      const stepCompletionGate = require('./stepCompletionGate');
      const Deployment = require('../models/Deployment');
      const deployment = await Deployment.findOne({ deploymentId });
      
      if (!deployment) {
        return;
      }

      // Use the deployment status passed in, or get from deployment
      const status = currentStatus || deployment.status;

      // Map deployment status to step name
      const statusToStepMap = {
        'GENERATE_README': 'FILE_GENERATION',
        'AWAIT_CURSOR_GENERATION': 'FILE_GENERATION',
        'VERIFY_FILES': 'FILE_GENERATION',
        'FILES_VERIFIED': 'FILE_GENERATION',
        'PLANNING': 'TERRAFORM_GENERATION',
        'VALIDATING': 'TERRAFORM_GENERATION'
      };

      // Determine which step to check based on command type or deployment status
      let stepToCheck = null;
      
      // Check by command type
      const cmdLower = command.toLowerCase().trim();
      if (cmdLower.includes('terraform') && (cmdLower.includes('validate') || cmdLower.includes('fmt'))) {
        stepToCheck = 'TERRAFORM_GENERATION';
      } else if (cmdLower.includes('docker') && (cmdLower.includes('build') || cmdLower.includes('compose'))) {
        stepToCheck = 'FILE_GENERATION';
      } else if (status && statusToStepMap[status]) {
        stepToCheck = statusToStepMap[status];
      }

      if (!stepToCheck) {
        return; // No step to check for this command
      }

      // Check if step is already complete
      if (deployment.stepStatus?.[stepToCheck]?.complete) {
        return; // Already marked complete
      }

      // Check if step completion criteria are met
      const completionStatus = await stepCompletionGate.checkStepCompletion(deploymentId, stepToCheck);
      
      if (completionStatus.complete) {
        // Automatically mark step as complete
        await stepCompletionGate.markStepComplete(deploymentId, stepToCheck, {
          autoCompleted: true,
          triggerCommand: command,
          completedBy: 'system'
        });
        
        logger.info('Step automatically marked as complete', {
          deploymentId,
          step: stepToCheck,
          triggerCommand: command.substring(0, 50)
        });
      }
    } catch (error) {
      logger.debug('Failed to check/mark step complete (non-critical):', {
        deploymentId,
        error: error.message
      });
      // Don't throw - this is a non-critical operation
    }
  }
}

module.exports = new CLIExecutor();

