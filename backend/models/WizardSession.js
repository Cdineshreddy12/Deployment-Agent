const mongoose = require('mongoose');

/**
 * Sub-schema for generated commands
 */
const generatedCommandSchema = new mongoose.Schema({
  command: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['shell', 'docker', 'docker-compose', 'aws', 'terraform', 'ssh', 'http', 'other'],
    default: 'shell'
  },
  reason: {
    type: String
  },
  expectedResult: {
    type: String
  },
  isFixCommand: {
    type: Boolean,
    default: false
  },
  isRetryCommand: {
    type: Boolean,
    default: false
  }
}, { _id: false });

/**
 * Sub-schema for command queue items
 */
const commandQueueItemSchema = new mongoose.Schema({
  command: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['shell', 'docker', 'docker-compose', 'aws', 'terraform', 'ssh', 'http', 'other'],
    default: 'shell'
  },
  reason: {
    type: String
  },
  expectedResult: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'success', 'failed', 'skipped'],
    default: 'pending'
  },
  order: {
    type: Number,
    default: 0
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  exitCode: {
    type: Number
  },
  output: {
    type: String,
    maxlength: 50000
  },
  isFixCommand: {
    type: Boolean,
    default: false
  },
  isRetryCommand: {
    type: Boolean,
    default: false
  }
}, { _id: false });

/**
 * Sub-schema for blocking error
 */
const blockingErrorSchema = new mongoose.Schema({
  command: {
    type: String,
    required: true
  },
  exitCode: {
    type: Number
  },
  errorOutput: {
    type: String,
    maxlength: 50000
  },
  analysis: {
    type: String
  },
  fixAttempts: {
    type: Number,
    default: 0
  }
}, { _id: false });

/**
 * Sub-schema for command log entry
 */
const commandLogSchema = new mongoose.Schema({
  command: {
    type: String
  },
  log: {
    type: String,
    maxlength: 10000
  },
  type: {
    type: String,
    enum: ['stdout', 'stderr', 'info', 'error'],
    default: 'stdout'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

/**
 * Sub-schema for execution results
 */
const executionResultSchema = new mongoose.Schema({
  command: {
    type: String,
    required: true
  },
  result: {
    success: Boolean,
    exitCode: Number,
    error: String
  },
  output: {
    type: String,
    maxlength: 100000 // Truncate very long outputs
  },
  exitCode: {
    type: Number
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  commandHistoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CommandHistory'
  }
}, { _id: false });

/**
 * Sub-schema for error analyses
 */
const errorAnalysisSchema = new mongoose.Schema({
  command: {
    type: String,
    required: true
  },
  errorOutput: {
    type: String
  },
  exitCode: {
    type: Number
  },
  analysis: {
    type: String,
    required: true
  },
  fixCommands: [generatedCommandSchema],
  retryCommands: [generatedCommandSchema],
  analyzedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

/**
 * Sub-schema for verification results
 */
const verificationResultSchema = new mongoose.Schema({
  passed: {
    type: Boolean,
    required: true
  },
  allCommandsExecuted: {
    type: Boolean,
    default: false
  },
  analysis: {
    type: String
  },
  shouldAdvance: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

/**
 * Sub-schema for stage history
 */
const stageHistorySchema = new mongoose.Schema({
  stageId: {
    type: String,
    required: true
  },
  stageName: {
    type: String,
    required: true
  },
  stageDescription: {
    type: String
  },
  success: {
    type: Boolean
  },
  notes: {
    type: String
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  claudeInstructions: {
    type: String // Full instructions from Claude
  },
  claudeAnalysis: {
    type: String // Verification analysis from Claude
  },
  generatedCommands: [generatedCommandSchema],
  executionResults: [executionResultSchema],
  terminalLogs: {
    type: String, // Full terminal output for this stage
    maxlength: 500000 // 500KB max
  },
  errorAnalyses: [errorAnalysisSchema],
  verificationResult: verificationResultSchema
}, { _id: false });

/**
 * Helper function to normalize generatedFiles
 * Must be defined before schema so setter can use it
 */
function normalizeGeneratedFiles(generatedFiles) {
  if (!generatedFiles) {
    return [];
  }
  
  // If it's a string that looks like JavaScript code (contains string concatenation patterns)
  if (typeof generatedFiles === 'string') {
    const logger = require('../utils/logger');
    const preview = generatedFiles.substring(0, 500);
    
    // More robust JavaScript code pattern detection
    // Check for patterns like: "[\n' +\n  '  {\n" or similar variations
    const isJavaScriptCode = 
      generatedFiles.includes("' +\n") || 
      generatedFiles.includes('" +\n') || 
      generatedFiles.includes("' +\\n") || 
      generatedFiles.includes('" +\\n') ||
      generatedFiles.trim().startsWith("[\n' +") || 
      generatedFiles.trim().startsWith('[\n" +') ||
      generatedFiles.includes("' +\n  '") ||  // Pattern: ' +\n  '
      generatedFiles.includes('" +\n  "') ||  // Pattern: " +\n  "
      /^\s*\[\s*['"]\s*\+\s*\\?n/.test(generatedFiles) ||  // Matches "[\n' +" or "[\n\" +"
      /^\s*\[\s*['"]\s*\+\s*\n/.test(generatedFiles) ||  // Matches with actual newline
      /^\s*\[\s*['"]\s*\+\s*\\?n\s*['"]/.test(generatedFiles);  // More flexible regex
    
    if (isJavaScriptCode) {
      logger.error('Detected malformed generatedFiles (JavaScript code string), returning empty array');
      logger.error('Pattern detected - first 500 chars:', preview);
      logger.error('Pattern type:', {
        hasSingleQuoteConcat: generatedFiles.includes("' +\n"),
        hasDoubleQuoteConcat: generatedFiles.includes('" +\n'),
        startsWithArrayConcat: /^\s*\[\s*['"]\s*\+\s*\\?n/.test(generatedFiles),
        hasSpacedConcat: generatedFiles.includes("' +\n  '") || generatedFiles.includes('" +\n  "')
      });
      return [];
    }
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(generatedFiles);
      if (Array.isArray(parsed)) {
        return normalizeGeneratedFiles(parsed);
      }
    } catch (e) {
      // Not valid JSON, return empty array
      return [];
    }
  }
  
  // If it's already an array
  if (Array.isArray(generatedFiles)) {
    return generatedFiles
      .filter(f => {
        // Filter out invalid entries
        if (f === null || f === undefined) {
          return false;
        }
        
        // Handle Mongoose documents/subdocuments
        // Check if it's a Mongoose document (has _doc or toObject method)
        const isMongooseDoc = f && (f._doc || typeof f.toObject === 'function');
        if (isMongooseDoc) {
          // Mongoose document - convert to plain object
          f = f.toObject ? f.toObject() : f._doc;
        }
        
        // After conversion, check if it's a valid object
        if (typeof f !== 'object') {
          return false;
        }
        
        // If it's a string (malformed data), skip it
        if (typeof f === 'string') {
          return false;
        }
        
        return true;
      })
      .map(f => {
        // Handle Mongoose documents - convert to plain object if needed
        if (f && (f._doc || typeof f.toObject === 'function')) {
          f = f.toObject ? f.toObject() : f._doc;
        }
        
        // Ensure proper structure
        return {
          path: f.path || '',
          content: typeof f.content === 'string' ? f.content : String(f.content || ''),
          type: f.type || 'unknown',
          service: f.service || '',
          generatedAt: f.generatedAt ? (f.generatedAt instanceof Date ? f.generatedAt : new Date(f.generatedAt)) : new Date(),
          writtenToDisk: f.writtenToDisk || false
        };
      });
  }
  
  return [];
}

/**
 * Main WizardSession schema
 */
const wizardSessionSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  currentStage: {
    type: String,
    required: true
  },
  currentStageIndex: {
    type: Number,
    default: 0
  },
  projectContext: {
    projectPath: String,
    projectType: mongoose.Schema.Types.Mixed, // Can be string or object with language, runtime, etc.
    framework: String,
    services: [mongoose.Schema.Types.Mixed],
    generatedFiles: {
      type: [{
        path: String,
        content: String,
        type: String,
        service: String,
        generatedAt: Date,
        writtenToDisk: Boolean
      }],
      default: [],
      set: function(value) {
        const logger = require('../utils/logger');
        
        // CRITICAL: This setter MUST always return an array, never a string
        // Mongoose validates during construction, so this must be bulletproof
        
        logger.debug('Schema setter: Setting generatedFiles', {
          type: typeof value,
          isArray: Array.isArray(value),
          preview: typeof value === 'string' 
            ? value.substring(0, 200)
            : Array.isArray(value)
              ? `Array with ${value.length} items`
              : String(value).substring(0, 200)
        });
        
        // Normalize when setting - ensure it's always an array of objects
        if (!value || value === null || value === undefined) {
          logger.debug('Schema setter: Value is null/undefined, returning empty array');
          return [];
        }
        
        // CRITICAL: If it's a string (especially JavaScript code string), handle immediately
        if (typeof value === 'string') {
          logger.warn('Schema setter: Value is a string, attempting to normalize');
          logger.warn('String preview:', value.substring(0, 300));
          
          // Check for JavaScript code patterns (enhanced detection)
          const isJavaScriptCode = 
            value.includes("' +\n") || 
            value.includes('" +\n') || 
            value.includes("' +\\n") || 
            value.includes('" +\\n') ||
            value.trim().startsWith("[\n' +") || 
            value.trim().startsWith('[\n" +') ||
            value.trim().startsWith("[\n\' +") ||
            value.trim().startsWith("[\n\" +") ||
            value.includes("' +\n  '") ||
            value.includes('" +\n  "') ||
            value.includes("' +\n    '") ||
            value.includes('" +\n    "') ||
            value.includes("path: '") && value.includes("' +\n") ||
            value.includes('path: "') && value.includes('" +\n') ||
            /^\s*\[\s*['"]\s*\+\s*\\?n/.test(value) ||
            /^\s*\[\s*['"]\s*\+\s*\n/.test(value) ||
            /\s*\+\s*['"]\s*\\?n/.test(value) ||
            /['"]\s*\+\s*['"]\s*\\?n/.test(value);
          
          if (isJavaScriptCode) {
            logger.error('Schema setter: Detected JavaScript code string! Returning empty array.');
            logger.error('String preview:', value.substring(0, 500));
            logger.error('Pattern detection details:', {
              hasSingleQuoteConcat: value.includes("' +\n"),
              hasDoubleQuoteConcat: value.includes('" +\n'),
              startsWithArrayConcat: /^\s*\[\s*['"]\s*\+\s*\\?n/.test(value),
              hasSpacedConcat: value.includes("' +\n  '") || value.includes('" +\n  "'),
              hasPathPattern: value.includes("path: '") || value.includes('path: "'),
              stringLength: value.length
            });
            return [];
          }
          
          // Try to parse as JSON
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              const normalized = normalizeGeneratedFiles(parsed);
              logger.debug('Schema setter: Parsed JSON array, normalized to:', normalized.length, 'items');
              return normalized;
            } else {
              logger.warn('Schema setter: Parsed JSON is not an array, returning empty array');
              return [];
            }
          } catch (e) {
            logger.error('Schema setter: Failed to parse string as JSON:', e.message);
            return [];
          }
        }
        
        // If it's an array, normalize it
        if (Array.isArray(value)) {
          const normalized = normalizeGeneratedFiles(value);
          // CRITICAL: Double-check normalization returned an array
          if (typeof normalized === 'string' || !Array.isArray(normalized)) {
            logger.error('Schema setter: normalizeGeneratedFiles returned invalid type! Returning empty array.');
            logger.error('Returned type:', typeof normalized);
            return [];
          }
          logger.debug('Schema setter: Normalized array to:', normalized.length, 'items');
          return normalized;
        }
        
        // Fallback: return empty array for any other type
        logger.warn('Schema setter: Value is neither string nor array, returning empty array. Type:', typeof value);
        return [];
      }
    },
    repositoryUrl: String,
    branch: String,
    // Additional context that might be useful
    environmentVariables: mongoose.Schema.Types.Mixed,
    dependencies: mongoose.Schema.Types.Mixed,
    // Allow any additional fields
    language: String,
    runtime: String,
    buildTool: String,
    isMonorepo: Boolean
  },
  stageHistory: [stageHistorySchema],
  // Current stage working data (in-progress data)
  currentStageData: {
    claudeInstructions: String,
    generatedCommands: [generatedCommandSchema],
    executionResults: [executionResultSchema],
    terminalLogs: {
      type: String,
      maxlength: 500000
    },
    errorAnalyses: [errorAnalysisSchema],
    verificationResult: verificationResultSchema,
    startedAt: {
      type: Date,
      default: Date.now
    },
    // Command queue for sequential execution
    commandQueue: [commandQueueItemSchema],
    currentCommandIndex: {
      type: Number,
      default: 0
    },
    // Error blocking state
    isBlocked: {
      type: Boolean,
      default: false
    },
    blockingError: blockingErrorSchema,
    // Structured command logs
    commandLogs: [commandLogSchema]
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'paused', 'failed', 'cancelled'],
    default: 'active',
    index: true
  },
  totalStages: {
    type: Number,
    default: 9
  },
  completedStages: {
    type: Number,
    default: 0
  },
  progress: {
    type: Number, // 0-100
    default: 0
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  // Metadata for analytics
  metadata: {
    totalCommandsExecuted: {
      type: Number,
      default: 0
    },
    successfulCommands: {
      type: Number,
      default: 0
    },
    failedCommands: {
      type: Number,
      default: 0
    },
    totalErrorAnalyses: {
      type: Number,
      default: 0
    },
    resumeCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
wizardSessionSchema.index({ userId: 1, status: 1 });
wizardSessionSchema.index({ status: 1, lastUpdatedAt: -1 });
wizardSessionSchema.index({ createdAt: -1 });

// Pre-validate hook - normalize generatedFiles BEFORE validation
wizardSessionSchema.pre('validate', function(next) {
  // Normalize generatedFiles if it exists - this runs BEFORE Mongoose validation
  if (this.projectContext && this.projectContext.generatedFiles !== undefined) {
    const original = this.projectContext.generatedFiles;
    const logger = require('../utils/logger');
    
    logger.debug('Pre-validate hook: Processing generatedFiles', {
      type: typeof original,
      isArray: Array.isArray(original),
      preview: typeof original === 'string' 
        ? original.substring(0, 200)
        : Array.isArray(original)
          ? `Array with ${original.length} items`
          : String(original).substring(0, 200)
    });
    
    // CRITICAL: If it's a string (especially JavaScript code string), normalize immediately
    if (typeof original === 'string') {
      logger.warn('Pre-validate: generatedFiles is a string, normalizing immediately');
      logger.warn('String preview:', original.substring(0, 300));
      const normalized = normalizeGeneratedFiles(original);
      // Double-check normalization returned an array
      if (typeof normalized === 'string' || !Array.isArray(normalized)) {
        logger.error('CRITICAL: normalizeGeneratedFiles returned invalid type in pre-validate! Forcing to empty array.');
        this.projectContext.generatedFiles = [];
      } else {
        this.projectContext.generatedFiles = normalized;
      }
      return next();
    }
    
    // Check if data is already valid (array of objects or Mongoose subdocuments)
    let needsNormalization = false;
    
    if (Array.isArray(original)) {
      // Check if array contains invalid entries
      for (const item of original) {
        if (item === null || item === undefined) {
          needsNormalization = true;
          break;
        }
        // Mongoose documents are valid - don't normalize them unnecessarily
        if (typeof item === 'string') {
          needsNormalization = true;
          break;
        }
        // If it's a plain object or Mongoose document, it's fine
        if (typeof item === 'object' && (item._doc || typeof item.toObject === 'function' || item.path || item.content)) {
          // Valid - continue checking
          continue;
        }
        if (typeof item !== 'object') {
          needsNormalization = true;
          break;
        }
      }
    } else if (original !== null && original !== undefined) {
      // Not an array and not null - needs normalization
      needsNormalization = true;
    }
    
    if (needsNormalization) {
      const normalized = normalizeGeneratedFiles(original);
      logger.info('Pre-validate: Normalized generatedFiles', {
        originalType: typeof original,
        originalIsArray: Array.isArray(original),
        originalLength: Array.isArray(original) ? original.length : 'N/A',
        normalizedLength: normalized.length,
        normalizedType: typeof normalized,
        normalizedIsArray: Array.isArray(normalized)
      });
      
      // Final safety check
      if (typeof normalized === 'string' || !Array.isArray(normalized)) {
        logger.error('CRITICAL: normalizeGeneratedFiles returned invalid type! Forcing to empty array.');
        this.projectContext.generatedFiles = [];
      } else {
        this.projectContext.generatedFiles = normalized;
      }
    }
  }
  next();
});

// Update lastUpdatedAt on every save and normalize generatedFiles
wizardSessionSchema.pre('save', function(next) {
  this.lastUpdatedAt = new Date();
  
  // Normalize generatedFiles if it exists (double-check)
  if (this.projectContext && this.projectContext.generatedFiles !== undefined) {
    this.projectContext.generatedFiles = normalizeGeneratedFiles(this.projectContext.generatedFiles);
  }
  
  // Calculate progress
  if (this.totalStages > 0) {
    this.progress = Math.round((this.completedStages / this.totalStages) * 100);
  }
  
  // Update metadata counts
  if (this.stageHistory) {
    let totalCommands = 0;
    let successfulCommands = 0;
    let failedCommands = 0;
    let totalErrorAnalyses = 0;
    
    for (const stage of this.stageHistory) {
      if (stage.executionResults) {
        totalCommands += stage.executionResults.length;
        for (const result of stage.executionResults) {
          if (result.result?.success) {
            successfulCommands++;
          } else {
            failedCommands++;
          }
        }
      }
      if (stage.errorAnalyses) {
        totalErrorAnalyses += stage.errorAnalyses.length;
      }
    }
    
    // Include current stage data
    if (this.currentStageData?.executionResults) {
      totalCommands += this.currentStageData.executionResults.length;
      for (const result of this.currentStageData.executionResults) {
        if (result.result?.success) {
          successfulCommands++;
        } else {
          failedCommands++;
        }
      }
    }
    if (this.currentStageData?.errorAnalyses) {
      totalErrorAnalyses += this.currentStageData.errorAnalyses.length;
    }
    
    this.metadata.totalCommandsExecuted = totalCommands;
    this.metadata.successfulCommands = successfulCommands;
    this.metadata.failedCommands = failedCommands;
    this.metadata.totalErrorAnalyses = totalErrorAnalyses;
  }
  
  next();
});

// Method to add execution result to current stage
wizardSessionSchema.methods.addExecutionResult = function(command, result, output, exitCode, commandHistoryId) {
  if (!this.currentStageData) {
    this.currentStageData = {};
  }
  if (!this.currentStageData.executionResults) {
    this.currentStageData.executionResults = [];
  }
  
  this.currentStageData.executionResults.push({
    command,
    result,
    output: output?.substring(0, 100000) || '', // Truncate if too long
    exitCode,
    timestamp: new Date(),
    commandHistoryId
  });
};

// Method to add error analysis to current stage
wizardSessionSchema.methods.addErrorAnalysis = function(command, errorOutput, exitCode, analysis, fixCommands, retryCommands) {
  if (!this.currentStageData) {
    this.currentStageData = {};
  }
  if (!this.currentStageData.errorAnalyses) {
    this.currentStageData.errorAnalyses = [];
  }
  
  this.currentStageData.errorAnalyses.push({
    command,
    errorOutput,
    exitCode,
    analysis,
    fixCommands: fixCommands || [],
    retryCommands: retryCommands || [],
    analyzedAt: new Date()
  });
};

// Method to complete current stage and move to history
wizardSessionSchema.methods.completeCurrentStage = function(success, notes, stageName, stageDescription) {
  const stageEntry = {
    stageId: this.currentStage,
    stageName: stageName || this.currentStage,
    stageDescription: stageDescription || '',
    success,
    notes,
    startedAt: this.currentStageData?.startedAt || new Date(),
    completedAt: new Date(),
    claudeInstructions: this.currentStageData?.claudeInstructions || '',
    claudeAnalysis: this.currentStageData?.verificationResult?.analysis || '',
    generatedCommands: this.currentStageData?.generatedCommands || [],
    executionResults: this.currentStageData?.executionResults || [],
    terminalLogs: this.currentStageData?.terminalLogs || '',
    errorAnalyses: this.currentStageData?.errorAnalyses || [],
    verificationResult: this.currentStageData?.verificationResult
  };
  
  this.stageHistory.push(stageEntry);
  
  if (success) {
    this.completedStages++;
  }
  
  // Clear current stage data
  this.currentStageData = {
    startedAt: new Date()
  };
};

// Method to get summary for API response
wizardSessionSchema.methods.getSummary = function() {
  return {
    deploymentId: this.deploymentId,
    currentStage: this.currentStage,
    currentStageIndex: this.currentStageIndex,
    totalStages: this.totalStages,
    completedStages: this.completedStages,
    progress: this.progress,
    status: this.status,
    startedAt: this.startedAt,
    lastUpdatedAt: this.lastUpdatedAt,
    metadata: this.metadata
  };
};

// Static method to find active session for deployment
wizardSessionSchema.statics.findActiveSession = function(deploymentId) {
  return this.findOne({ 
    deploymentId, 
    status: { $in: ['active', 'paused'] } 
  });
};

// Static method to find or create session
wizardSessionSchema.statics.findOrCreate = async function(deploymentId, userId, initialData = {}) {
  let session = await this.findOne({ deploymentId });
  
  if (!session) {
    session = new this({
      deploymentId,
      userId,
      currentStage: initialData.currentStage || 'ANALYZE',
      currentStageIndex: initialData.currentStageIndex || 0,
      projectContext: initialData.projectContext || {},
      status: 'active',
      currentStageData: {
        startedAt: new Date()
      }
    });
    await session.save();
  }
  
  return session;
};

// Delete existing model if it exists to force schema reload
if (mongoose.models.WizardSession) {
  delete mongoose.models.WizardSession;
}

module.exports = mongoose.model('WizardSession', wizardSessionSchema);

