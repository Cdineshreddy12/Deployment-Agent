const FileGenerationTask = require('../models/FileGenerationTask');
const readmeGenerator = require('./readmeGenerator');
const fileVerificationService = require('./fileVerificationService');
const wizardOrchestrator = require('./wizardOrchestrator');
const logger = require('../utils/logger');

/**
 * File Generation Orchestrator
 * Orchestrates the Cursor-assisted file generation workflow
 */
class FileGenerationOrchestrator {
  constructor() {
    this.stateMachine = {
      initiated: ['checking_files'],
      checking_files: ['readme_generating', 'failed'],
      readme_generating: ['readme_generated', 'failed'],
      readme_generated: ['readme_approved', 'readme_generating'], // Can regenerate
      readme_approved: ['awaiting_cursor'],
      awaiting_cursor: ['ready_to_verify', 'files_uploaded'], // Can verify directly or upload files (legacy)
      ready_to_verify: ['verifying'],
      files_uploaded: ['verifying'], // Legacy path
      verifying: ['verified', 'failed'],
      verified: ['verification_approved', 'verifying'], // Can re-verify
      verification_approved: ['completed'],
      failed: ['checking_files', 'readme_generating', 'verifying'], // Can retry from various points
      cancelled: []
    };
  }

  /**
   * Initiate file generation task
   */
  async initiateFileGeneration(deploymentId, stageId, taskType, userId) {
    try {
      const task = new FileGenerationTask({
        deploymentId,
        stageId,
        taskType,
        status: 'initiated',
        userId
      });

      await task.save();

      logger.info('File generation task initiated', {
        taskId: task.taskId,
        deploymentId,
        stageId,
        taskType
      });

      return task;
    } catch (error) {
      logger.error('Failed to initiate file generation:', error);
      throw error;
    }
  }

  /**
   * Check files without creating a task
   * Used to check for existing files before initiating a task
   */
  async checkFilesWithoutTask(deploymentId) {
    try {
      const filePreCheckService = require('./filePreCheckService');
      const fileStatus = await filePreCheckService.checkExistingFiles(deploymentId);

      logger.info('File check completed (no task)', {
        deploymentId,
        existingFiles: fileStatus.existing.length,
        missingFiles: fileStatus.missing.length,
        envFiles: fileStatus.envFiles.length
      });

      return fileStatus;
    } catch (error) {
      logger.error('Failed to check files without task:', error);
      throw error;
    }
  }

  /**
   * Pre-check files before README generation
   */
  async preCheckFiles(taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Update status
      task.status = 'checking_files';
      await task.save();

      const filePreCheckService = require('./filePreCheckService');
      const fileStatus = await filePreCheckService.checkExistingFiles(task.deploymentId);

      // Store file status in metadata
      task.metadata.fileStatus = fileStatus;
      await task.save();

      logger.info('File pre-check completed', {
        taskId,
        deploymentId: task.deploymentId,
        existingFiles: fileStatus.existing.length,
        missingFiles: fileStatus.missing.length,
        envFiles: fileStatus.envFiles.length
      });

      return {
        success: true,
        fileStatus
      };
    } catch (error) {
      logger.error('Failed to pre-check files:', error);
      
      // Update task status
      const task = await FileGenerationTask.findOne({ taskId });
      if (task) {
        task.status = 'failed';
        task.metadata.lastError = error.message;
        await task.save();
      }
      
      throw error;
    }
  }

  /**
   * Generate README for file generation
   */
  async generateReadme(deploymentId, taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Update status
      task.status = 'readme_generating';
      await task.save();

      // Get context from wizard
      const fullContext = await wizardOrchestrator.buildFullContext(deploymentId);
      
      // Generate README
      const readmeResult = await readmeGenerator.generateDockerReadme(
        deploymentId,
        task.stageId,
        fullContext
      );

      if (!readmeResult.success) {
        task.status = 'failed';
        await task.save();
        throw new Error('Failed to generate README');
      }

      // Save README
      task.readme.content = readmeResult.content;
      task.readme.generatedAt = new Date();
      task.status = 'readme_generated';
      task.metadata.readmeMetadata = readmeResult.metadata;
      await task.save();

      logger.info('README generated successfully', {
        taskId,
        deploymentId,
        contentLength: readmeResult.content.length
      });

      return {
        success: true,
        task,
        readme: readmeResult.content
      };
    } catch (error) {
      logger.error('Failed to generate README:', error);
      
      // Update task status
      const task = await FileGenerationTask.findOne({ taskId });
      if (task) {
        task.status = 'failed';
        task.metadata.lastError = error.message;
        await task.save();
      }
      
      throw error;
    }
  }

  /**
   * Approve README
   */
  async approveReadme(taskId, userId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (task.status !== 'readme_generated') {
        throw new Error(`Cannot approve README in status: ${task.status}`);
      }

      await task.approveReadme(userId);
      task.status = 'awaiting_cursor';
      // Set ready_to_verify status so user can verify directly
      task.metadata.readyToVerify = true;
      await task.save();

      logger.info('README approved', { taskId, userId });

      return {
        success: true,
        task
      };
    } catch (error) {
      logger.error('Failed to approve README:', error);
      throw error;
    }
  }

  /**
   * Reject README
   */
  async rejectReadme(taskId, userId, reason) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      await task.rejectReadme(userId, reason);
      await task.save();

      logger.info('README rejected', { taskId, userId, reason });

      return {
        success: true,
        task
      };
    } catch (error) {
      logger.error('Failed to reject README:', error);
      throw error;
    }
  }

  /**
   * Upload generated files
   */
  async uploadFiles(taskId, files, userId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (task.status !== 'awaiting_cursor' && task.status !== 'readme_approved') {
        throw new Error(`Cannot upload files in status: ${task.status}`);
      }

      // Validate files
      for (const file of files) {
        if (!file.path || !file.content) {
          throw new Error('File must have path and content');
        }
      }

      // Add files
      for (const file of files) {
        await task.addUploadedFile({
          path: file.path,
          content: file.content,
          size: Buffer.byteLength(file.content, 'utf8')
        }, userId);
      }

      task.status = 'files_uploaded';
      await task.save();

      logger.info('Files uploaded', {
        taskId,
        fileCount: files.length,
        files: files.map(f => f.path)
      });

      return {
        success: true,
        task
      };
    } catch (error) {
      logger.error('Failed to upload files:', error);
      throw error;
    }
  }

  /**
   * Verify files from README (new method - uses terminal commands)
   */
  async verifyFilesFromReadme(taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Allow retry from failed status
      if (task.status === 'failed') {
        // Reset to ready_to_verify to allow retry
        task.status = 'ready_to_verify';
        task.metadata.lastError = null; // Clear previous error
        await task.save();
        logger.info('Task status reset from failed to ready_to_verify for retry', { taskId });
      } else if (task.status !== 'awaiting_cursor' && task.status !== 'ready_to_verify' && task.status !== 'files_uploaded') {
        throw new Error(`Cannot verify files in status: ${task.status}`);
      }

      if (!task.readme.content) {
        throw new Error('README not found. Please generate README first.');
      }

      task.status = 'verifying';
      await task.save();

      // Verify files using README-based verification
      const verificationResults = await fileVerificationService.verifyDockerFilesFromReadme(
        task.deploymentId,
        task.readme.content
      );

      // Generate report
      const report = fileVerificationService.generateVerificationReport(verificationResults);

      // Update task with verification results
      // Ensure errors and warnings are proper arrays
      const errors = Array.isArray(verificationResults.errors) 
        ? verificationResults.errors.filter(err => typeof err === 'object' && err !== null)
        : [];
      const warnings = Array.isArray(verificationResults.warnings) 
        ? verificationResults.warnings.filter(warn => typeof warn === 'object' && warn !== null)
        : [];
      
      await task.setVerificationResult({
        status: verificationResults.status === 'passed' ? 'passed' : 'failed',
        report,
        errors: errors,
        warnings: warnings
      });

      // Store detected files info
      task.metadata.detectedFiles = verificationResults.detectedFiles;
      await task.save();

      logger.info('Files verified from README', {
        taskId,
        status: verificationResults.status,
        expectedFiles: (verificationResults.detectedFiles?.existing?.length || 0) + (verificationResults.detectedFiles?.missing?.length || 0),
        existingFiles: verificationResults.detectedFiles?.existing?.length || 0,
        missingFiles: verificationResults.detectedFiles?.missing?.length || 0,
        errors: verificationResults.errors.length,
        warnings: verificationResults.warnings.length
      });

      return {
        success: true,
        task,
        verification: report
      };
    } catch (error) {
      logger.error('Failed to verify files from README:', error);
      
      // Update task status
      const task = await FileGenerationTask.findOne({ taskId });
      if (task) {
        task.status = 'failed';
        task.metadata.lastError = error.message;
        await task.save();
      }
      
      throw error;
    }
  }

  /**
   * Verify uploaded files (legacy method)
   */
  async verifyFiles(taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (task.status !== 'files_uploaded') {
        // Try README-based verification instead
        return this.verifyFilesFromReadme(taskId);
      }

      task.status = 'verifying';
      await task.save();

      // Verify files using legacy method
      const verificationResults = await fileVerificationService.verifyDockerFiles(
        task.deploymentId,
        task.readme.content,
        task.uploadedFiles
      );

      // Generate report
      const report = fileVerificationService.generateVerificationReport(verificationResults);

      // Update task with verification results
      // Ensure errors and warnings are proper arrays
      const errors = Array.isArray(verificationResults.errors) 
        ? verificationResults.errors.filter(err => typeof err === 'object' && err !== null)
        : [];
      const warnings = Array.isArray(verificationResults.warnings) 
        ? verificationResults.warnings.filter(warn => typeof warn === 'object' && warn !== null)
        : [];
      
      await task.setVerificationResult({
        status: verificationResults.status === 'passed' ? 'passed' : 'failed',
        report,
        errors: errors,
        warnings: warnings
      });

      logger.info('Files verified', {
        taskId,
        status: verificationResults.status,
        errors: errors.length,
        warnings: warnings.length
      });

      return {
        success: true,
        task,
        verification: report
      };
    } catch (error) {
      logger.error('Failed to verify files:', error);
      
      // Update task status
      const task = await FileGenerationTask.findOne({ taskId });
      if (task) {
        task.status = 'failed';
        task.metadata.lastError = error.message;
        await task.save();
      }
      
      throw error;
    }
  }

  /**
   * Approve verification
   */
  async approveVerification(taskId, userId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (task.status !== 'verified') {
        throw new Error(`Cannot approve verification in status: ${task.status}`);
      }

      await task.approveVerification(userId);
      task.status = 'verification_approved';
      await task.save();

      logger.info('Verification approved', { taskId, userId });

      return {
        success: true,
        task
      };
    } catch (error) {
      logger.error('Failed to approve verification:', error);
      throw error;
    }
  }

  /**
   * Get task status
   */
  async getTaskStatus(taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId })
        .populate('userId', 'name email')
        .populate('readme.approvedBy', 'name email')
        .populate('verification.verifiedBy', 'name email');

      if (!task) {
        return null;
      }

      return {
        taskId: task.taskId,
        deploymentId: task.deploymentId,
        stageId: task.stageId,
        taskType: task.taskType,
        status: task.status,
        readme: {
          generated: !!task.readme.content,
          generatedAt: task.readme.generatedAt,
          approved: !!task.readme.approvedAt,
          approvedAt: task.readme.approvedAt,
          approvedBy: task.readme.approvedBy
        },
        uploadedFiles: task.uploadedFiles.map(f => ({
          path: f.path,
          size: f.size,
          uploadedAt: f.uploadedAt
        })),
        verification: {
          status: task.verification.status,
          verifiedAt: task.verification.verifiedAt,
          errors: task.verification.errors?.length || 0,
          warnings: task.verification.warnings?.length || 0
        },
        metadata: {
          fileStatus: task.metadata?.fileStatus || null,
          readmeMetadata: task.metadata?.readmeMetadata || null,
          detectedFiles: task.metadata?.detectedFiles || null,
          lastError: task.metadata?.lastError || null
        },
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
      };
    } catch (error) {
      logger.error('Failed to get task status:', error);
      throw error;
    }
  }

  /**
   * Get task by deployment and stage
   */
  async getTaskByDeployment(deploymentId, stageId) {
    try {
      const task = await FileGenerationTask.findOne({
        deploymentId,
        stageId
      }).sort({ createdAt: -1 });

      return task;
    } catch (error) {
      logger.error('Failed to get task by deployment:', error);
      throw error;
    }
  }

  /**
   * Check if can proceed to next step
   */
  canProceedToNextStep(currentStatus, nextStatus) {
    const validTransitions = this.stateMachine[currentStatus] || [];
    return validTransitions.includes(nextStatus);
  }

  /**
   * Proceed to next step in workflow
   */
  async proceedToNextStep(deploymentId, taskId) {
    try {
      const task = await FileGenerationTask.findOne({ taskId });
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      // Determine next status based on current status
      let nextStatus = null;
      
      switch (task.status) {
        case 'verification_approved':
          // Move to next wizard stage
          await wizardOrchestrator.advanceStage(task.deploymentId);
          return {
            success: true,
            message: 'Workflow completed, advancing to next stage'
          };
        default:
          throw new Error(`Cannot proceed from status: ${task.status}`);
      }
    } catch (error) {
      logger.error('Failed to proceed to next step:', error);
      throw error;
    }
  }
}

module.exports = new FileGenerationOrchestrator();

