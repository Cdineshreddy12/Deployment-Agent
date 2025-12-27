const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * File Generation Task Schema
 * Tracks the workflow for generating files via Cursor with Claude orchestration
 */
const fileGenerationTaskSchema = new mongoose.Schema({
  taskId: {
    type: String,
    required: true,
    unique: true,
    default: () => `task_${uuidv4().replace(/-/g, '')}`
  },
  deploymentId: {
    type: String,
    required: true,
    index: true
  },
  stageId: {
    type: String,
    required: true
  },
  taskType: {
    type: String,
    enum: ['docker', 'iac', 'config', 'other'],
    required: true,
    default: 'docker'
  },
  status: {
    type: String,
    enum: [
      'initiated',
      'checking_files',
      'readme_generating',
      'readme_generated',
      'readme_approved',
      'awaiting_cursor',
      'ready_to_verify',
      'files_uploaded',
      'verifying',
      'verified',
      'verification_approved',
      'failed',
      'cancelled'
    ],
    default: 'initiated',
    index: true
  },
  readme: {
    content: {
      type: String
    },
    generatedAt: {
      type: Date
    },
    approvedAt: {
      type: Date
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    rejectedAt: {
      type: Date
    },
    rejectionReason: {
      type: String
    }
  },
  uploadedFiles: [{
    path: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    size: {
      type: Number
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  verification: {
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'passed', 'failed', 'warning'],
      default: 'pending'
    },
    report: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    verifiedAt: {
      type: Date
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    errors: {
      type: [{
        file: { type: String },
        type: { type: String },
        message: { type: String },
        severity: {
          type: String,
          enum: ['error', 'warning', 'info'],
          default: 'error'
        },
        suggestion: { type: String }
      }],
      default: []
    },
    warnings: {
      type: [{
        file: { type: String },
        type: { type: String },
        message: { type: String },
        suggestion: { type: String }
      }],
      default: []
    }
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Indexes
fileGenerationTaskSchema.index({ deploymentId: 1, status: 1 });
fileGenerationTaskSchema.index({ deploymentId: 1, stageId: 1 });
fileGenerationTaskSchema.index({ userId: 1, createdAt: -1 });
fileGenerationTaskSchema.index({ taskType: 1, status: 1 });

// Methods
fileGenerationTaskSchema.methods.approveReadme = function(userId) {
  this.readme.approvedAt = new Date();
  this.readme.approvedBy = userId;
  this.status = 'readme_approved';
  return this.save();
};

fileGenerationTaskSchema.methods.rejectReadme = function(userId, reason) {
  this.readme.rejectedAt = new Date();
  this.readme.rejectionReason = reason;
  this.status = 'readme_generating'; // Allow regeneration
  return this.save();
};

fileGenerationTaskSchema.methods.addUploadedFile = function(fileData, userId) {
  this.uploadedFiles.push({
    ...fileData,
    uploadedBy: userId,
    uploadedAt: new Date()
  });
  this.status = 'files_uploaded';
  return this.save();
};

fileGenerationTaskSchema.methods.setVerificationResult = function(result) {
  this.verification.status = result.status;
  this.verification.report = result.report || {};
  
  // Ensure errors and warnings are arrays of objects (not strings)
  const errors = Array.isArray(result.errors) ? result.errors : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  
  // Filter out any non-object items and ensure proper structure
  this.verification.errors = errors
    .filter(err => typeof err === 'object' && err !== null && !Array.isArray(err))
    .map(err => ({
      file: String(err.file || ''),
      type: String(err.type || ''),
      message: String(err.message || ''),
      severity: ['error', 'warning', 'info'].includes(err.severity) ? err.severity : 'error',
      suggestion: String(err.suggestion || '')
    }));
  
  this.verification.warnings = warnings
    .filter(warn => typeof warn === 'object' && warn !== null && !Array.isArray(warn))
    .map(warn => ({
      file: String(warn.file || ''),
      type: String(warn.type || ''),
      message: String(warn.message || ''),
      suggestion: String(warn.suggestion || '')
    }));
  
  this.verification.verifiedAt = new Date();
  this.status = result.status === 'passed' ? 'verified' : 'failed';
  return this.save();
};

fileGenerationTaskSchema.methods.approveVerification = function(userId) {
  this.verification.verifiedBy = userId;
  this.status = 'verification_approved';
  return this.save();
};

const FileGenerationTask = mongoose.model('FileGenerationTask', fileGenerationTaskSchema);

module.exports = FileGenerationTask;

