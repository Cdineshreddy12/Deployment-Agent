const logger = require('../utils/logger');
const claudeService = require('./claude');
const Deployment = require('../models/Deployment');
const WizardSession = require('../models/WizardSession');
const ServiceConfig = require('../models/ServiceConfig');

/**
 * Wizard Orchestrator Service
 * Manages step-by-step deployment wizard flow with Claude guidance
 * Now with database persistence for sessions
 */

const WIZARD_STAGES = [
  {
    id: 'ANALYZE',
    name: 'Project Analysis',
    description: 'Review project structure, detect services, and identify requirements',
    commands: [],
    verification: 'Check that project structure is understood'
  },
  {
    id: 'CONFIGURE',
    name: 'Configuration',
    description: 'Set up credentials, environment variables, and deployment settings',
    commands: [],
    verification: 'Verify all required credentials are available'
  },
  {
    id: 'GENERATE',
    name: 'Generate Files',
    description: 'Create Dockerfile, docker-compose.yml, and infrastructure code',
    commands: [],
    verification: 'Ensure all deployment files are generated'
  },
  {
    id: 'GENERATE_README',
    name: 'Generate README',
    description: 'Claude generates README with Docker file requirements',
    commands: [],
    verification: 'README generated and approved'
  },
  {
    id: 'AWAIT_CURSOR_GENERATION',
    name: 'Await Cursor Generation',
    description: 'User generates files in Cursor using the README',
    commands: [],
    verification: 'Files generated in Cursor'
  },
  {
    id: 'AWAIT_FILE_UPLOAD',
    name: 'Await File Upload',
    description: 'User uploads generated files',
    commands: [],
    verification: 'Files uploaded successfully'
  },
  {
    id: 'VERIFY_FILES',
    name: 'Verify Files',
    description: 'Claude verifies uploaded files using Cursor and commands',
    commands: [],
    verification: 'Files verified successfully'
  },
  {
    id: 'FILES_VERIFIED',
    name: 'Files Verified',
    description: 'Files have been verified and approved',
    commands: [],
    verification: 'Ready for next stage'
  },
  {
    id: 'VERIFY',
    name: 'Verification',
    description: 'Claude reviews generated files for best practices and security',
    commands: [],
    verification: 'All files pass security and best practices check'
  },
  {
    id: 'LOCAL_BUILD',
    name: 'Local Build',
    description: 'Build Docker images locally to verify they work',
    commands: [
      { cmd: 'docker build -t {serviceName} .', description: 'Build Docker image' }
    ],
    verification: 'Docker images build successfully'
  },
  {
    id: 'LOCAL_TEST',
    name: 'Local Test',
    description: 'Run containers locally and verify health checks',
    commands: [
      { cmd: 'docker compose up -d', description: 'Start containers' },
      { cmd: 'docker compose ps', description: 'Check container status' }
    ],
    verification: 'All containers are running and healthy'
  },
  {
    id: 'PROVISION',
    name: 'Provision Infrastructure',
    description: 'Create AWS resources (EC2, security groups, etc.)',
    commands: [
      { cmd: 'aws ec2 describe-vpcs', description: 'List available VPCs' },
      { cmd: 'aws ec2 describe-key-pairs', description: 'List SSH key pairs' },
      { cmd: 'aws ec2 run-instances ...', description: 'Launch EC2 instance' }
    ],
    verification: 'AWS infrastructure is provisioned'
  },
  {
    id: 'DEPLOY',
    name: 'Deploy',
    description: 'Deploy application to EC2 with credentials',
    commands: [
      { cmd: 'ssh -i key.pem ubuntu@{ip} ...', description: 'Connect and deploy' }
    ],
    verification: 'Application is deployed and running'
  },
  {
    id: 'HEALTH_CHECK',
    name: 'Health Check',
    description: 'Verify deployment is working correctly',
    commands: [
      { cmd: 'curl http://{ip}:{port}/health', description: 'Check health endpoint' }
    ],
    verification: 'Health checks pass'
  }
];

class WizardOrchestrator {
  constructor() {
    // In-memory cache for performance (load on demand, save on change)
    this.sessionCache = new Map(); // deploymentId -> session document
  }

  // ============================================
  // Session Management (Database Persistence)
  // ============================================

  /**
   * Normalize generatedFiles array - ensure it's an array of proper objects
   */
  normalizeGeneratedFiles(generatedFiles) {
    if (!generatedFiles) {
      return [];
    }
    
    // Log what we received for debugging
    logger.debug('Normalizing generatedFiles:', {
      type: typeof generatedFiles,
      isArray: Array.isArray(generatedFiles),
      preview: typeof generatedFiles === 'string' 
        ? generatedFiles.substring(0, 200) 
        : Array.isArray(generatedFiles) 
          ? `Array with ${generatedFiles.length} items` 
          : String(generatedFiles).substring(0, 200)
    });
    
    // If it's a string (shouldn't happen, but handle it)
    if (typeof generatedFiles === 'string') {
      const preview = generatedFiles.substring(0, 200);
      logger.warn('generatedFiles is a string, checking format:', preview);
      
      // More robust JavaScript code pattern detection
      // Check for patterns like: "[\n' +\n  '  {\n" or similar variations
      const isJavaScriptCode = 
        generatedFiles.includes("' +\n") || 
        generatedFiles.includes('" +\n') || 
        generatedFiles.includes("' +\\n") || 
        generatedFiles.includes('" +\\n') ||
        generatedFiles.trim().startsWith("[\n' +") || 
        generatedFiles.trim().startsWith('[\n" +') ||
        generatedFiles.trim().startsWith('[\n\' +') ||
        generatedFiles.trim().startsWith("[\n\" +") ||
        generatedFiles.includes("' +\n  '") ||  // Pattern: ' +\n  '
        generatedFiles.includes('" +\n  "') ||  // Pattern: " +\n  "
        /^\s*\[\s*['"]\s*\+\s*\\?n/.test(generatedFiles) ||  // Matches "[\n' +" or "[\n\" +"
        /^\s*\[\s*['"]\s*\+\s*\n/.test(generatedFiles) ||  // Matches with actual newline
        /^\s*\[\s*['"]\s*\+\s*\\?n\s*['"]/.test(generatedFiles);  // More flexible regex
      
      if (isJavaScriptCode) {
        logger.error('generatedFiles appears to be JavaScript code string (contains string concatenation), returning empty array.');
        logger.error('Preview (first 500 chars):', generatedFiles.substring(0, 500));
        logger.error('Pattern detection details:', {
          hasSingleQuoteConcat: generatedFiles.includes("' +\n"),
          hasDoubleQuoteConcat: generatedFiles.includes('" +\n'),
          startsWithArrayConcat: /^\s*\[\s*['"]\s*\+\s*\\?n/.test(generatedFiles),
          hasSpacedConcat: generatedFiles.includes("' +\n  '") || generatedFiles.includes('" +\n  "'),
          stringLength: generatedFiles.length
        });
        return [];
      }
      
      try {
        // Try to parse as JSON
        const parsed = JSON.parse(generatedFiles);
        if (Array.isArray(parsed)) {
          return this.normalizeGeneratedFiles(parsed);
        }
      } catch (e) {
        logger.error('Failed to parse generatedFiles string as JSON:', e.message);
        logger.error('String preview:', preview);
      }
      return [];
    }
    
    // If it's already an array
    if (Array.isArray(generatedFiles)) {
      return generatedFiles
        .filter(f => {
          // Filter out invalid entries
          if (typeof f !== 'object' || f === null) {
            logger.warn('Skipping non-object entry in generatedFiles:', typeof f);
            return false;
          }
          // If it's a string (malformed data), skip it
          if (typeof f === 'string') {
            logger.warn('Found string in generatedFiles array, skipping:', f.substring(0, 100));
            return false;
          }
          return true;
        })
        .map(f => {
          // Ensure proper structure
          const normalized = {
            path: f.path || '',
            content: typeof f.content === 'string' ? f.content : String(f.content || ''),
            type: f.type || 'unknown',
            service: f.service || '',
            generatedAt: f.generatedAt ? new Date(f.generatedAt) : new Date(),
            writtenToDisk: f.writtenToDisk || false
          };
          
          // Validate content is not malformed (check for JavaScript code patterns)
          if (normalized.content && typeof normalized.content === 'string') {
            if (normalized.content.includes("' +\n") || normalized.content.includes('" +\n') ||
                normalized.content.includes("' +\\n") || normalized.content.includes('" +\\n')) {
              logger.warn('Detected malformed content in generatedFiles, cleaning:', normalized.path);
              // Try to extract actual content if it's wrapped in string concatenation
              normalized.content = normalized.content
                .replace(/' \+\n\s*/g, '\n')
                .replace(/" \+\n\s*/g, '\n')
                .replace(/' \+\\n\s*/g, '\n')
                .replace(/" \+\\n\s*/g, '\n');
            }
          }
          
          return normalized;
        });
    }
    
    logger.warn('generatedFiles is neither array nor string, returning empty array:', typeof generatedFiles);
    return [];
  }

  /**
   * Initialize a wizard session (creates in database)
   */
  async initSession(deploymentId, projectContext = {}, userId = null) {
    try {
      // Check if session already exists
      let session = await WizardSession.findOne({ deploymentId });
      
      if (session) {
        // Resume existing session
        session.status = 'active';
        session.metadata.resumeCount = (session.metadata.resumeCount || 0) + 1;
        session.lastUpdatedAt = new Date();
        
        // Normalize generatedFiles if projectContext is being updated
        if (projectContext && projectContext.generatedFiles !== undefined) {
          const normalizedGeneratedFiles = this.normalizeGeneratedFiles(projectContext.generatedFiles);
          
          // CRITICAL: Ensure normalizedGeneratedFiles is an array before setting
          let safeGeneratedFiles = [];
          if (Array.isArray(normalizedGeneratedFiles)) {
            safeGeneratedFiles = normalizedGeneratedFiles;
          } else if (typeof normalizedGeneratedFiles === 'string') {
            logger.error('CRITICAL: resumeSession: normalizedGeneratedFiles is a string! Forcing to empty array.');
            safeGeneratedFiles = [];
          } else {
            logger.error('CRITICAL: resumeSession: normalizedGeneratedFiles is not an array! Type:', typeof normalizedGeneratedFiles);
            safeGeneratedFiles = [];
          }
          
          if (session.projectContext) {
            session.projectContext.generatedFiles = safeGeneratedFiles;
          } else {
            session.projectContext = { generatedFiles: safeGeneratedFiles };
          }
          session.markModified('projectContext.generatedFiles');
        }
        
        await session.save();
        
        // Cache it
        this.sessionCache.set(deploymentId, session);
        
        logger.info(`Wizard session resumed for ${deploymentId}`);
        return this.sessionToLegacyFormat(session);
      }
      
      // Get userId from deployment if not provided
      if (!userId) {
        const deployment = await Deployment.findOne({ deploymentId });
        if (deployment && deployment.userId) {
          userId = deployment.userId;
        }
      }
      
      if (!userId) {
        throw new Error('userId is required to create wizard session');
      }
      
      // Normalize projectContext - handle projectType as object or string
      let normalizedProjectType = projectContext.projectType || '';
      if (typeof projectContext.projectType === 'object' && projectContext.projectType !== null) {
        // If projectType is an object, extract a string representation or keep as object
        normalizedProjectType = projectContext.projectType;
      }
      
      // Normalize generatedFiles - ensure it's an array of objects, not a string
      // CRITICAL: This MUST happen before creating WizardSession to prevent Mongoose validation errors
      let normalizedGeneratedFiles = [];
      if (projectContext.generatedFiles !== undefined) {
        const rawValue = projectContext.generatedFiles;
        logger.info('Orchestrator: Raw generatedFiles received in initSession', {
          type: typeof rawValue,
          isArray: Array.isArray(rawValue),
          preview: typeof rawValue === 'string' 
            ? rawValue.substring(0, 200) 
            : Array.isArray(rawValue)
              ? `Array with ${rawValue.length} items, first item type: ${typeof rawValue[0]}`
              : String(rawValue).substring(0, 200)
        });
        
        normalizedGeneratedFiles = this.normalizeGeneratedFiles(rawValue);
        
        logger.info('Orchestrator: Normalized generatedFiles result', {
          outputLength: normalizedGeneratedFiles.length,
          outputType: Array.isArray(normalizedGeneratedFiles) ? 'array' : typeof normalizedGeneratedFiles,
          firstItem: normalizedGeneratedFiles.length > 0 ? {
            hasPath: !!normalizedGeneratedFiles[0].path,
            hasContent: !!normalizedGeneratedFiles[0].content,
            contentType: typeof normalizedGeneratedFiles[0].content
          } : 'empty'
        });
      }
      
      // Ensure normalizedGeneratedFiles is definitely an array and contains only valid objects
      if (!Array.isArray(normalizedGeneratedFiles)) {
        logger.error('normalizedGeneratedFiles is not an array after normalization, forcing to empty array');
        normalizedGeneratedFiles = [];
      } else {
        // Double-check: filter out any invalid entries
        normalizedGeneratedFiles = normalizedGeneratedFiles.filter(f => {
          if (typeof f !== 'object' || f === null) {
            logger.warn('Filtering out invalid generatedFiles entry:', typeof f);
            return false;
          }
          if (typeof f === 'string') {
            logger.warn('Filtering out string entry in generatedFiles array');
            return false;
          }
          return true;
        });
      }
      
      // Final safety check: ensure it's a plain array, not a string or other type
      if (typeof normalizedGeneratedFiles === 'string') {
        logger.error('CRITICAL: normalizedGeneratedFiles is still a string after normalization!');
        normalizedGeneratedFiles = [];
      }
      
      logger.info('Orchestrator: Final normalizedGeneratedFiles before creating session', {
        isArray: Array.isArray(normalizedGeneratedFiles),
        length: normalizedGeneratedFiles.length,
        type: typeof normalizedGeneratedFiles
      });
      
      // CRITICAL: Final safety check - ensure generatedFiles is definitely an array
      // Mongoose validation happens during document construction, so we must ensure
      // the data is correct BEFORE passing it to new WizardSession()
      let finalGeneratedFiles = normalizedGeneratedFiles;
      
      // Handle case where it's still a string (shouldn't happen but be defensive)
      if (typeof finalGeneratedFiles === 'string') {
        logger.error('CRITICAL: normalizedGeneratedFiles is still a string! Forcing to empty array.');
        logger.error('String preview:', finalGeneratedFiles.substring(0, 500));
        finalGeneratedFiles = [];
      } else if (!Array.isArray(finalGeneratedFiles)) {
        logger.error('CRITICAL: normalizedGeneratedFiles is not an array! Type:', typeof finalGeneratedFiles);
        finalGeneratedFiles = [];
      } else {
        // CRITICAL: Filter out ANY string elements and ensure all items are valid objects
        const beforeFilter = finalGeneratedFiles.length;
        finalGeneratedFiles = finalGeneratedFiles
          .filter(item => {
            // Filter out null/undefined
            if (item === null || item === undefined) {
              logger.warn('Filtering out null/undefined item from generatedFiles array');
              return false;
            }
            // Filter out strings (including JavaScript code strings)
            if (typeof item === 'string') {
              logger.warn('Filtering out string item from generatedFiles array');
              logger.warn('String item preview:', item.substring(0, 200));
              return false;
            }
            // Only keep objects
            if (typeof item !== 'object') {
              logger.warn('Filtering out non-object item from generatedFiles array. Type:', typeof item);
              return false;
            }
            return true;
          })
          .map(item => {
            // Ensure each item has the required structure
            return {
              path: item.path || '',
              content: typeof item.content === 'string' ? item.content : String(item.content || ''),
              type: item.type || 'unknown',
              service: item.service || '',
              generatedAt: item.generatedAt ? (item.generatedAt instanceof Date ? item.generatedAt : new Date(item.generatedAt)) : new Date(),
              writtenToDisk: item.writtenToDisk || false
            };
          });
        
        if (beforeFilter !== finalGeneratedFiles.length) {
          logger.warn(`Filtered generatedFiles array: ${beforeFilter} -> ${finalGeneratedFiles.length} items`);
        }
      }
      
      // Final verification - ensure it's definitely an array
      if (!Array.isArray(finalGeneratedFiles)) {
        logger.error('CRITICAL: After all checks, finalGeneratedFiles is still not an array! Forcing to empty array.');
        finalGeneratedFiles = [];
      }
      
      // CRITICAL: Ensure finalGeneratedFiles is a clean plain array of plain objects
      // Use JSON.parse/stringify to ensure we have clean plain objects (not Mongoose documents)
      let cleanGeneratedFiles = [];
      try {
        if (Array.isArray(finalGeneratedFiles) && finalGeneratedFiles.length > 0) {
          // Convert to JSON and back to ensure clean plain objects
          const jsonString = JSON.stringify(finalGeneratedFiles);
          cleanGeneratedFiles = JSON.parse(jsonString);
          
          // Verify it's still an array
          if (!Array.isArray(cleanGeneratedFiles)) {
            logger.error('CRITICAL: After JSON round-trip, cleanGeneratedFiles is not an array!');
            cleanGeneratedFiles = [];
          }
        }
      } catch (e) {
        logger.error('CRITICAL: Failed to clean generatedFiles via JSON round-trip:', e.message);
        cleanGeneratedFiles = [];
      }
      
      // Final verification
      if (!Array.isArray(cleanGeneratedFiles)) {
        logger.error('CRITICAL: cleanGeneratedFiles is not an array! Forcing to empty array.');
        cleanGeneratedFiles = [];
      }
      
      logger.info('Orchestrator: Final clean generatedFiles before Mongoose document construction', {
        isArray: Array.isArray(cleanGeneratedFiles),
        length: cleanGeneratedFiles.length,
        type: typeof cleanGeneratedFiles,
        willBeSetAfterConstruction: true
      });
      
      // CRITICAL: ALTERNATIVE APPROACH - Initialize with empty array, then update
      // This ensures Mongoose sees a valid array during construction
      // Ensure it's definitely an array before setting
      if (!Array.isArray(cleanGeneratedFiles)) {
        logger.error('CRITICAL: cleanGeneratedFiles is not an array before creating session! Forcing to empty array.');
        logger.error('Type:', typeof cleanGeneratedFiles);
        cleanGeneratedFiles = [];
      }
      
      // Create session WITH generatedFiles set to empty array first
      // This ensures Mongoose validation passes during construction
      session = new WizardSession({
        deploymentId,
        userId,
        currentStage: WIZARD_STAGES[0].id,
        currentStageIndex: 0,
        projectContext: {
          projectPath: projectContext.projectPath || '',
          projectType: normalizedProjectType,
          framework: projectContext.framework || '',
          services: projectContext.services || [],
          generatedFiles: [], // Initialize with empty array to pass validation
          repositoryUrl: projectContext.repositoryUrl || '',
          branch: projectContext.branch || 'main',
          // Preserve additional fields that might be in projectContext
          language: projectContext.language || projectContext.projectType?.language,
          runtime: projectContext.runtime || projectContext.projectType?.runtime,
          buildTool: projectContext.buildTool || projectContext.projectType?.buildTool,
          isMonorepo: projectContext.isMonorepo !== undefined ? projectContext.isMonorepo : projectContext.projectType?.isMonorepo,
          environmentVariables: projectContext.environmentVariables,
          dependencies: projectContext.dependencies
        },
        totalStages: WIZARD_STAGES.length,
        status: 'active',
        currentStageData: {
          startedAt: new Date()
        }
      });
      
      // Now update generatedFiles after construction using direct assignment
      // CRITICAL: Use try-catch around assignment to catch any validation errors
      try {
        // Double-check cleanGeneratedFiles is an array before assignment
        if (!Array.isArray(cleanGeneratedFiles)) {
          logger.error('CRITICAL: cleanGeneratedFiles is not an array before assignment! Type:', typeof cleanGeneratedFiles);
          cleanGeneratedFiles = [];
        }
        
        // CRITICAL: Final validation - ensure each element is a valid object
        // Filter out any elements that might cause validation issues
        const validatedFiles = cleanGeneratedFiles.filter((item, index) => {
          if (!item || typeof item !== 'object') {
            logger.warn(`Filtering out invalid item at index ${index}:`, typeof item);
            return false;
          }
          // Ensure content is a string, not a JavaScript code string
          if (item.content && typeof item.content === 'string') {
            // Check for JavaScript code patterns in content
            if (item.content.includes("' +\n") || item.content.includes('" +\n') ||
                item.content.includes("' +\\n") || item.content.includes('" +\\n')) {
              logger.warn(`Filtering out item at index ${index} due to JavaScript code pattern in content`);
              return false;
            }
          }
          return true;
        }).map(item => ({
          path: String(item.path || ''),
          content: String(item.content || ''),
          type: String(item.type || 'unknown'),
          service: String(item.service || ''),
          generatedAt: item.generatedAt instanceof Date ? item.generatedAt : new Date(item.generatedAt || Date.now()),
          writtenToDisk: Boolean(item.writtenToDisk || false)
        }));
        
        // Use Mongoose's set method with the validated array
        // This ensures the setter is called and can normalize if needed
        session.set('projectContext.generatedFiles', validatedFiles);
        
        // Mark as modified so Mongoose saves it
        session.markModified('projectContext.generatedFiles');
        
        // Verify it was set correctly - check both the property and _doc
        const actualValue = session.projectContext.generatedFiles;
        if (!Array.isArray(actualValue)) {
          logger.error('CRITICAL: After assignment, generatedFiles is still not an array! Type:', typeof actualValue);
          logger.error('Value preview:', typeof actualValue === 'string' ? actualValue.substring(0, 500) : String(actualValue).substring(0, 500));
          
          // Force to empty array using both methods
          session.set('projectContext.generatedFiles', []);
          if (session._doc && session._doc.projectContext) {
            session._doc.projectContext.generatedFiles = [];
          }
          session.markModified('projectContext.generatedFiles');
        }
      } catch (assignError) {
        // If assignment itself fails (shouldn't happen but be defensive)
        logger.error('CRITICAL: Assignment of generatedFiles failed:', assignError.message);
        logger.error('Error type:', assignError.name);
        logger.error('Error stack:', assignError.stack);
        
        // Force to empty array
        try {
          session.set('projectContext.generatedFiles', []);
          if (session._doc && session._doc.projectContext) {
            session._doc.projectContext.generatedFiles = [];
          }
          session.markModified('projectContext.generatedFiles');
        } catch (forceError) {
          logger.error('CRITICAL: Failed to force empty array:', forceError.message);
          // Continue anyway - empty array is default
        }
      }
      
      logger.info('Orchestrator: Session created with generatedFiles after Mongoose construction', {
        isArray: Array.isArray(session.projectContext.generatedFiles),
        length: session.projectContext.generatedFiles?.length || 0,
        type: typeof session.projectContext.generatedFiles,
        readyToSave: true
      });
      
      // Save - wrap in try-catch to handle any validation errors gracefully
      try {
        await session.save();
      } catch (saveError) {
        // If save fails due to generatedFiles validation, force to empty array and retry
        if (saveError.name === 'ValidationError' && 
            (saveError.message.includes('generatedFiles') || 
             saveError.errors?.['projectContext.generatedFiles'] ||
             saveError.message.includes('Cast to'))) {
          logger.error('Save failed due to generatedFiles validation, forcing to empty array and retrying');
          logger.error('Validation error:', saveError.message);
          logger.error('Error details:', {
            name: saveError.name,
            message: saveError.message,
            errors: saveError.errors ? Object.keys(saveError.errors) : 'none'
          });
          
          // Force to empty array using multiple methods
          session.projectContext.generatedFiles = [];
          if (session._doc && session._doc.projectContext) {
            session._doc.projectContext.generatedFiles = [];
          }
          session.markModified('projectContext.generatedFiles');
          
          // Retry save
          await session.save();
        } else {
          // Re-throw if it's a different error
          throw saveError;
        }
      }
      
      // Cache it
      this.sessionCache.set(deploymentId, session);
      
    logger.info(`Wizard session initialized for ${deploymentId}`);
      return this.sessionToLegacyFormat(session);
      
    } catch (error) {
      logger.error(`Failed to initialize wizard session: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get session (from cache or database)
   */
  async getSession(deploymentId) {
    // Check cache first
    if (this.sessionCache.has(deploymentId)) {
      return this.sessionCache.get(deploymentId);
    }
    
    // Load from database
    const session = await WizardSession.findOne({ deploymentId });
    
    if (session) {
      this.sessionCache.set(deploymentId, session);
    }
    
    return session;
  }

  /**
   * Get session in legacy format (for backward compatibility)
   */
  async getSessionLegacy(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) return null;
    return this.sessionToLegacyFormat(session);
  }

  /**
   * Convert database session to legacy format
   */
  sessionToLegacyFormat(session) {
    // Build executionResults and generatedCommands from stageHistory and currentStageData
    const executionResults = {};
    const generatedCommands = {};
    
    // From completed stages
    for (const stage of session.stageHistory || []) {
      if (stage.executionResults) {
        executionResults[stage.stageId] = stage.executionResults.map(r => ({
          command: r.command,
          result: r.result,
          timestamp: r.timestamp
        }));
      }
      if (stage.generatedCommands) {
        generatedCommands[stage.stageId] = stage.generatedCommands;
      }
    }
    
    // From current stage
    if (session.currentStageData) {
      if (session.currentStageData.executionResults) {
        executionResults[session.currentStage] = session.currentStageData.executionResults.map(r => ({
          command: r.command,
          result: r.result,
          timestamp: r.timestamp
        }));
      }
      if (session.currentStageData.generatedCommands) {
        generatedCommands[session.currentStage] = session.currentStageData.generatedCommands;
      }
    }
    
    // CRITICAL: Clean projectContext.generatedFiles for serialization
    let cleanedProjectContext = session.projectContext;
    if (cleanedProjectContext && cleanedProjectContext.generatedFiles !== undefined) {
      try {
        cleanedProjectContext = { ...cleanedProjectContext };
        const normalized = this.normalizeGeneratedFiles(cleanedProjectContext.generatedFiles);
        // JSON round-trip to ensure clean serialization
        cleanedProjectContext.generatedFiles = JSON.parse(JSON.stringify(normalized));
        
        logger.debug('sessionToLegacyFormat: Cleaned generatedFiles for serialization', {
          length: cleanedProjectContext.generatedFiles.length
        });
      } catch (e) {
        logger.error('sessionToLegacyFormat: Failed to clean generatedFiles:', e.message);
        cleanedProjectContext = { ...cleanedProjectContext, generatedFiles: [] };
      }
    }
    
    return {
      deploymentId: session.deploymentId,
      userId: session.userId?.toString(),
      currentStageIndex: session.currentStageIndex,
      currentStage: session.currentStage,
      stageHistory: session.stageHistory.map(s => ({
        stage: s.stageId,
        success: s.success,
        notes: s.notes,
        completedAt: s.completedAt,
        executionResults: s.executionResults
      })),
      projectContext: cleanedProjectContext,
      generatedCommands,
      executionResults,
      startedAt: session.startedAt,
      lastUpdatedAt: session.lastUpdatedAt,
      // Reference to actual document for saving
      _dbSession: session
    };
  }

  /**
   * Save session changes to database
   */
  async saveSession(deploymentId) {
    const session = this.sessionCache.get(deploymentId);
    if (session && session.save) {
      try {
        await session.save();
        logger.debug(`Wizard session saved for ${deploymentId}`);
      } catch (error) {
        logger.error(`Failed to save wizard session: ${error.message}`);
        throw error;
      }
    }
  }

  /**
   * Get stage information
   */
  getStageInfo(stageId) {
    return WIZARD_STAGES.find(s => s.id === stageId);
  }

  /**
   * Get all stages
   */
  getAllStages() {
    return WIZARD_STAGES;
  }

  // ============================================
  // Stage Instructions Generation
  // ============================================

  /**
   * Get existing credentials for a deployment
   */
  async getExistingCredentials(deploymentId) {
    try {
      const serviceConfigs = await ServiceConfig.find({ deploymentId })
        .select('serviceType serviceName validated sandboxTested');
      
      const credentials = {};
      for (const config of serviceConfigs) {
        credentials[config.serviceType] = {
          serviceType: config.serviceType,
          serviceName: config.serviceName,
          validated: config.validated,
          sandboxTested: config.sandboxTested,
          configured: true
        };
      }
      
      return credentials;
    } catch (error) {
      logger.error(`Failed to get existing credentials: ${error.message}`);
      return {};
    }
  }

  /**
   * Detect cloud provider from existing credentials
   */
  detectCloudProvider(existingCredentials) {
    const cloudProviders = ['aws', 'azure', 'gcp', 'google-cloud'];
    for (const provider of cloudProviders) {
      if (existingCredentials[provider]?.configured) {
        return provider;
      }
    }
    return null;
  }

  /**
   * Detect database from existing credentials
   */
  detectDatabase(existingCredentials) {
    const databases = ['postgresql', 'postgres', 'mongodb', 'mongo', 'redis', 'mysql', 'mariadb'];
    for (const db of databases) {
      if (existingCredentials[db]?.configured) {
        return db;
      }
    }
    return null;
  }

  /**
   * Generate Claude instructions for a stage
   */
  async generateStageInstructions(deploymentId, stageId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stage = this.getStageInfo(stageId);
    if (!stage) {
      throw new Error(`Unknown stage: ${stageId}`);
    }

    // Handle GENERATE_README stage differently - use file generation orchestrator
    if (stageId === 'GENERATE_README') {
      return this.handleGenerateReadmeStage(deploymentId, stageId);
    }

    // Handle other new file generation stages
    if (stageId === 'AWAIT_CURSOR_GENERATION' || stageId === 'AWAIT_FILE_UPLOAD' || 
        stageId === 'VERIFY_FILES' || stageId === 'FILES_VERIFIED') {
      return this.handleFileGenerationStage(deploymentId, stageId);
    }

    // Get existing credentials
    const existingCredentials = await this.getExistingCredentials(deploymentId);
    const detectedCloudProvider = this.detectCloudProvider(existingCredentials);
    const detectedDatabase = this.detectDatabase(existingCredentials);

    // Build full context (service topology, Docker files, .env variables)
    const fullContext = await this.buildFullContext(deploymentId);

    // Build legacy format for prompt building
    const legacySession = this.sessionToLegacyFormat(session);
    const prompt = this.buildStagePrompt(stage, legacySession, {
      existingCredentials,
      detectedCloudProvider,
      detectedDatabase,
      fullContext
    });

    try {
      const userId = session.userId?.toString();
      if (!userId) {
        throw new Error('userId is required - please ensure you are logged in');
      }

      const response = await claudeService.chat(deploymentId, prompt, {
        maxTokens: 16384, // Increased from 4096 default to handle large file generation
        systemPrompt: this.getWizardSystemPrompt(),
        userId: userId
      });

      let content = response.message || response.content || '';
      
      // Check for incomplete responses (truncated api_call tags or incomplete JSON)
      // Look for unclosed <invoke> tags or incomplete JSON in body parameters
      const openInvokeTags = (content.match(/<invoke\s+name=["']api_call["']>/gi) || []).length;
      const closeInvokeTags = (content.match(/<\/invoke>/gi) || []).length;
      const hasIncompleteApiCall = openInvokeTags > closeInvokeTags;
      
      // Also check for incomplete JSON in body parameters (common when content is large)
      const incompleteJsonPattern = /<parameter\s+name=["']body["']>[\s\S]*?\{[\s\S]*?(?!\})$|"content"\s*:\s*"[^"]*$/i;
      const hasIncompleteJson = incompleteJsonPattern.test(content);
      
      // If response is incomplete, request continuation
      if (hasIncompleteApiCall || hasIncompleteJson) {
        logger.info('Detected incomplete response, requesting continuation', { 
          deploymentId, 
          stageId,
          reason: hasIncompleteApiCall ? 'unclosed api_call tag' : 'incomplete JSON'
        });
        try {
          // Extract file path from incomplete api_call if possible
          const filePathMatch = content.match(/<parameter\s+name=["']body["']>[\s\S]*?"filePath"\s*:\s*"([^"]+)"/i);
          const filePath = filePathMatch ? filePathMatch[1] : 'unknown';
          const currentContentLength = content.length;
          const lastCompleteLine = content.split('\n').slice(-3).join('\n');
          
          const continuationPrompt = `Your previous response was truncated while generating file content in an api_call block.

Context:
- File being generated: ${filePath}
- Current content length: ${currentContentLength} characters
- Last complete lines: "${lastCompleteLine.substring(0, 200)}"

Please continue from where you left off:
1. Complete the current api_call block if it's incomplete
2. Ensure the "content" field contains the complete file content
3. Close all JSON structures properly
4. Close all XML/HTML tags properly
5. Include the rest of the file content

Continue generating the file content now.`;
          const continuationResponse = await claudeService.chat(deploymentId, continuationPrompt, {
            maxTokens: 16384, // Use same high limit for continuation
            systemPrompt: this.getWizardSystemPrompt(),
            userId: userId
          });
          
          const continuationContent = continuationResponse.message || continuationResponse.content || '';
          if (continuationContent) {
            content += '\n\n' + continuationContent;
            logger.info('Received continuation response', {
              deploymentId,
              continuationLength: continuationContent.length
            });
          }
        } catch (error) {
          logger.warn('Failed to get continuation response:', error);
          // Continue with partial content - will be handled gracefully
        }
      }
      
      // Parse api_call invocations for write-file
      const apiCalls = this.parseApiCalls(content);
      const writeFileCalls = apiCalls.filter(ac => ac.url && ac.url.includes('/write-file'));
      
      // Also parse files from markdown code blocks (chat-style responses)
      const filesFromMarkdown = this.parseFilesFromMarkdown(content);
      
      // Combine both sources of files
      const allFileDetections = [...writeFileCalls, ...filesFromMarkdown];
      
      // Ensure workspace path is set before creating file proposals
      if (allFileDetections.length > 0) {
        const cursorIntegration = require('./cursorIntegration');
        let workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
        
        if (!workspacePath) {
          // Try to get from session
          if (session && session.projectContext && session.projectContext.projectPath) {
            workspacePath = session.projectContext.projectPath;
            cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
            logger.info('Set workspace path from session projectContext', { deploymentId, workspacePath });
          } else {
            // Try to get from deployment
            const Deployment = require('../models/Deployment');
            const deployment = await Deployment.findOne({ deploymentId });
            if (deployment && deployment.workspacePath) {
              workspacePath = deployment.workspacePath;
              cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
              logger.info('Set workspace path from deployment', { deploymentId, workspacePath });
            } else {
              logger.warn('No workspace path found for deployment - files will be pending approval but may fail to write', {
                deploymentId,
                fileCount: allFileDetections.length
              });
            }
          }
        }
      }
      
      // Store file proposals for user approval instead of writing immediately
      const fileProposals = [];
      
      // Process api_call write-file calls
      for (const apiCall of writeFileCalls) {
        try {
          const proposal = await this.createFileProposal(deploymentId, apiCall);
          if (proposal) {
            fileProposals.push(proposal);
          }
        } catch (error) {
          logger.error(`Failed to create file proposal from api_call: ${error.message}`, {
            deploymentId,
            apiCall: apiCall.url
          });
        }
      }
      
      // Process markdown code block files
      for (const file of filesFromMarkdown) {
        try {
          // Create proposal similar to createFileProposal but from markdown source
          const proposal = {
            id: `${deploymentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            filePath: file.filePath,
            content: file.content,
            preview: file.content.substring(0, 500),
            type: file.type,
            size: file.content.length,
            requiresApproval: true,
            status: 'pending',
            createdAt: new Date(),
            detectedFrom: file.detectedFrom
          };
          fileProposals.push(proposal);
          
          logger.info(`Created file proposal from markdown: ${file.filePath}`, {
            deploymentId,
            filePath: file.filePath,
            proposalId: proposal.id,
            contentLength: file.content.length
          });
        } catch (error) {
          logger.error(`Failed to create file proposal from markdown: ${error.message}`, {
            deploymentId,
            filePath: file.filePath
          });
        }
      }

      // Store pending file proposals in session
      if (fileProposals.length > 0) {
        if (!session.currentStageData) {
          session.currentStageData = {};
        }
        if (!session.currentStageData.pendingFileProposals) {
          session.currentStageData.pendingFileProposals = [];
        }
        session.currentStageData.pendingFileProposals.push(...fileProposals);
        logger.info(`Created ${fileProposals.length} file proposal(s) pending approval`, {
          deploymentId,
          stageId,
          files: fileProposals.map(f => f.filePath)
        });
      }
      
      const commands = this.parseCommandsFromResponse(content);
      
      // Parse user input requests from response
      const inputRequests = this.parseUserInputRequests(content);
      
      // Store in database
      if (!session.currentStageData) {
        session.currentStageData = {};
      }
      session.currentStageData.claudeInstructions = content;
      
      // Store pending input requests
      if (inputRequests.length > 0) {
        if (!session.currentStageData.pendingInputRequests) {
          session.currentStageData.pendingInputRequests = [];
        }
        session.currentStageData.pendingInputRequests.push(...inputRequests);
        logger.info(`Detected ${inputRequests.length} user input request(s)`, {
          deploymentId,
          stageId,
          requests: inputRequests.map(r => r.fields.map(f => f.name).join(', '))
        });
      }
      session.currentStageData.generatedCommands = commands.map(cmd => ({
        command: cmd.command,
        type: cmd.type,
        reason: cmd.reason || '',
        expectedResult: cmd.expectedResult || ''
      }));
      
      // Store file proposals info (files pending approval)
      if (fileProposals.length > 0) {
        session.currentStageData.fileProposals = fileProposals;
      }
      
      // Populate command queue for sequential execution
      session.currentStageData.commandQueue = commands.map((cmd, index) => ({
        command: cmd.command,
        type: cmd.type,
        reason: cmd.reason || '',
        expectedResult: cmd.expectedResult || '',
        status: 'pending',
        order: index,
        isFixCommand: false,
        isRetryCommand: false
      }));
      session.currentStageData.currentCommandIndex = 0;
      session.currentStageData.isBlocked = false;
      session.currentStageData.blockingError = null;
      session.currentStageData.commandLogs = [];
      session.currentStageData.terminalLogs = '';
      session.currentStageData.executionResults = [];
      session.currentStageData.errorAnalyses = [];
      session.currentStageData.verificationResult = null;
      
      session.currentStageData.startedAt = new Date();
      session.lastUpdatedAt = new Date();
      
      await session.save();
      
      logger.info(`Generated ${commands.length} commands for stage ${stageId}`);

      return {
        stage,
        instructions: content,
        commands,
        commandQueue: session.currentStageData.commandQueue,
        verification: stage.verification,
        fileProposals: fileProposals.length > 0 ? fileProposals : undefined,
        apiCallsFound: apiCalls.length,
        filesPendingApproval: fileProposals.length
      };
    } catch (error) {
      logger.error(`Failed to generate stage instructions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format projectType for display (handles string or object)
   */
  formatProjectType(projectContext) {
    if (!projectContext || !projectContext.projectType) {
      return 'Unknown';
    }
    if (typeof projectContext.projectType === 'object') {
      return JSON.stringify(projectContext.projectType, null, 2);
    }
    return projectContext.projectType;
  }

  /**
   * Get service topology from ServiceConfig
   */
  async getServiceTopology(deploymentId) {
    try {
      const serviceConfigs = await ServiceConfig.find({ deploymentId });
      const topology = {
        services: serviceConfigs.map(config => ({
          serviceType: config.serviceType,
          serviceName: config.serviceName,
          validated: config.validated,
          sandboxTested: config.sandboxTested,
          configured: true
        })),
        totalServices: serviceConfigs.length,
        validatedServices: serviceConfigs.filter(c => c.validated).length
      };
      return topology;
    } catch (error) {
      logger.error(`Failed to get service topology: ${error.message}`);
      return { services: [], totalServices: 0, validatedServices: 0 };
    }
  }

  /**
   * Get Docker files info from project
   */
  async getDockerFilesInfo(deploymentId) {
    try {
      const cursorIntegration = require('./cursorIntegration');
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      
      if (!workspacePath) {
        return { files: [], summary: 'No workspace path set' };
      }

      const dockerFiles = [];
      const commonDockerFiles = [
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.yaml',
        'Dockerfile.prod',
        'Dockerfile.dev',
        '.dockerignore'
      ];

      // Check root directory
      for (const fileName of commonDockerFiles) {
        try {
          const file = await cursorIntegration.readFile(deploymentId, fileName);
          if (file && file.exists) {
            dockerFiles.push({
              path: fileName,
              size: file.size,
              modified: file.modified,
              preview: file.content.substring(0, 500)
            });
          }
        } catch (error) {
          // File doesn't exist, continue
        }
      }

      // Check for Dockerfiles in subdirectories (common pattern)
      try {
        const dirs = await cursorIntegration.listDirectory(deploymentId, '.');
        for (const dir of dirs.filter(d => d.isDirectory)) {
          try {
            const dockerfile = await cursorIntegration.readFile(deploymentId, `${dir.path}/Dockerfile`);
            if (dockerfile && dockerfile.exists) {
              dockerFiles.push({
                path: `${dir.path}/Dockerfile`,
                size: dockerfile.size,
                modified: dockerfile.modified,
                preview: dockerfile.content.substring(0, 500)
              });
            }
          } catch (error) {
            // No Dockerfile in this directory
          }
        }
      } catch (error) {
        logger.debug('Could not list directories for Docker files:', error.message);
      }

      return {
        files: dockerFiles,
        summary: `${dockerFiles.length} Docker file(s) found`,
        hasDockerfile: dockerFiles.some(f => f.path.includes('Dockerfile')),
        hasDockerCompose: dockerFiles.some(f => f.path.includes('docker-compose'))
      };
    } catch (error) {
      logger.error(`Failed to get Docker files info: ${error.message}`);
      return { files: [], summary: 'Error reading Docker files' };
    }
  }

  /**
   * Get environment variables from .env files
   */
  async getEnvVariables(deploymentId) {
    try {
      const cursorIntegration = require('./cursorIntegration');
      const workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      
      if (!workspacePath) {
        return { variables: [], files: [] };
      }

      const envFiles = [];
      const envFileNames = ['.env', '.env.local', '.env.production', '.env.development', '.env.example'];
      const variables = {};

      for (const fileName of envFileNames) {
        try {
          const file = await cursorIntegration.readFile(deploymentId, fileName);
          if (file && file.exists) {
            envFiles.push({
              path: fileName,
              size: file.size,
              modified: file.modified
            });

            // Parse .env file content
            const lines = file.content.split('\n');
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const [key, ...valueParts] = trimmed.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                if (key) {
                  variables[key.trim()] = value;
                }
              }
            }
          }
        } catch (error) {
          // File doesn't exist, continue
        }
      }

      return {
        variables,
        files: envFiles,
        variableCount: Object.keys(variables).length,
        summary: `${Object.keys(variables).length} environment variable(s) found in ${envFiles.length} file(s)`
      };
    } catch (error) {
      logger.error(`Failed to get environment variables: ${error.message}`);
      return { variables: {}, files: [], variableCount: 0, summary: 'Error reading .env files' };
    }
  }

  /**
   * Build full context for Claude prompts
   */
  async buildFullContext(deploymentId) {
    const session = await this.getSession(deploymentId);
    const serviceTopology = await this.getServiceTopology(deploymentId);
    const dockerFiles = await this.getDockerFilesInfo(deploymentId);
    const envVars = await this.getEnvVariables(deploymentId);
    
    return {
      serviceTopology,
      dockerFiles,
      envVars,
      previousStages: session?.stageHistory || [],
      generatedFiles: session?.projectContext?.generatedFiles || []
    };
  }

  /**
   * Build prompt for a specific stage
   */
  buildStagePrompt(stage, session, options = {}) {
    const { projectContext } = session;
    const { 
      existingCredentials = {}, 
      detectedCloudProvider = null, 
      detectedDatabase = null,
      fullContext = null
    } = options;
    
    // Build existing credentials summary
    const configuredServices = Object.keys(existingCredentials).filter(
      serviceType => existingCredentials[serviceType]?.configured
    );
    
    let credentialsInfo = '';
    if (configuredServices.length > 0) {
      credentialsInfo = `\n## Existing Credentials (Already Configured)
The following services already have credentials configured:
${configuredServices.map(st => {
  const cred = existingCredentials[st];
  return `- **${st}**: ${cred.serviceName}${cred.validated ? ' (validated)' : ''}${cred.sandboxTested ? ' (sandbox tested)' : ''}`;
}).join('\n')}

**IMPORTANT**: Do NOT ask the user to provide credentials for these services again. Use the existing credentials.`;
      
      if (detectedCloudProvider) {
        credentialsInfo += `\n\n**Detected Cloud Provider**: ${detectedCloudProvider} (already configured)`;
      }
      if (detectedDatabase) {
        credentialsInfo += `\n\n**Detected Database**: ${detectedDatabase} (already configured)`;
      }
    } else {
      credentialsInfo = `\n## Existing Credentials
No credentials are currently configured for this deployment.`;
    }
    
    return `You are guiding the user through stage "${stage.name}" of the deployment wizard.

## Stage: ${stage.name}
${stage.description}

## Project Context
- Project Path: ${projectContext.projectPath || 'Not set'}
- Project Type: ${this.formatProjectType(projectContext)}
- Framework: ${projectContext.framework || 'Unknown'}
- Language: ${projectContext.language || 'Not specified'}
- Runtime: ${projectContext.runtime || 'Not specified'}
- Build Tool: ${projectContext.buildTool || 'Not specified'}
- Services: ${JSON.stringify(projectContext.services || [], null, 2)}
- Generated Files: ${JSON.stringify(projectContext.generatedFiles || [], null, 2)}

${fullContext ? `## Service Topology
${fullContext.serviceTopology.summary}
- Total Services: ${fullContext.serviceTopology.totalServices}
- Validated Services: ${fullContext.serviceTopology.validatedServices}
${fullContext.serviceTopology.services.length > 0 ? `
Configured Services:
${fullContext.serviceTopology.services.map(s => `  - ${s.serviceName} (${s.serviceType})${s.validated ? ' ✓ validated' : ''}${s.sandboxTested ? ' ✓ sandbox tested' : ''}`).join('\n')}
` : ''}

## Docker Files
${fullContext.dockerFiles.summary}
${fullContext.dockerFiles.files.length > 0 ? `
Existing Docker Files:
${fullContext.dockerFiles.files.map(f => `  - ${f.path} (${f.size} bytes, modified: ${f.modified})`).join('\n')}
` : 'No Docker files found in project.'}
${fullContext.dockerFiles.hasDockerfile ? '- ✓ Dockerfile exists' : '- ⚠ No Dockerfile found'}
${fullContext.dockerFiles.hasDockerCompose ? '- ✓ docker-compose.yml exists' : '- ⚠ No docker-compose.yml found'}

## Environment Variables
${fullContext.envVars.summary}
${fullContext.envVars.variableCount > 0 ? `
Detected Environment Variables (from .env files):
${Object.keys(fullContext.envVars.variables).slice(0, 20).map(key => `  - ${key}`).join('\n')}${fullContext.envVars.variableCount > 20 ? `\n  ... and ${fullContext.envVars.variableCount - 20} more` : ''}
` : 'No environment variables found in .env files.'}

## Previous Stages
${fullContext.previousStages.length > 0 ? `
Completed Stages:
${fullContext.previousStages.map(s => `  - ${s.stageId}: ${s.status || 'completed'}`).join('\n')}
` : 'No previous stages completed yet.'}
` : ''}
${credentialsInfo}

## Credential Collection Guidelines
${configuredServices.length > 0 ? `
**CRITICAL**: The following services already have credentials configured: ${configuredServices.join(', ')}
- Do NOT ask the user to provide credentials for these services
- Use the existing credentials automatically
- Only ask for credentials for services that are NOT in the list above
` : `
**CRITICAL**: No credentials are currently configured. You need to collect credentials for required services.
`}

When asking for credentials:
1. **Check existing credentials first** - Only ask for services that are NOT already configured
2. **For cloud provider selection**: ${detectedCloudProvider ? `Use ${detectedCloudProvider} (already configured)` : 'Ask user to select cloud provider (AWS, Azure, GCP) if not already configured'}
3. **For database selection**: ${detectedDatabase ? `Use ${detectedDatabase} (already configured)` : 'Ask user to select database type if needed (PostgreSQL, MongoDB, Redis, etc.)'}
4. **Provide input fields**: When asking for credentials, provide structured input fields with:
   - Field name (e.g., "AWS Access Key ID")
   - Field type (text, password, number, etc.)
   - Required/optional indicator
   - Description/help text
5. **Format as structured form**: Use a clear format like:
   "Please provide the following credentials for [service]:
   - [Field Name] (required): [description]
   - [Field Name] (optional): [description]"

## Previous Stage Results
${JSON.stringify(session.stageHistory.slice(-3), null, 2)}

## Your Task
1. Explain what this stage does and why it's important
2. Provide specific commands the user needs to run WITH EXPLANATIONS
3. Format commands in a way that can be executed
4. Explain what success looks like

## CRITICAL FORMATTING REQUIREMENTS
For EACH command you provide, you MUST include:
1. **Why**: A clear explanation of WHY this command needs to be run
2. **What it does**: What the command will accomplish
3. **The command**: In a \`\`\`bash code block

Use this format for EVERY command:

### Command: [Brief title]
**Why:** [Explain why this command is necessary]
**What it does:** [Explain what the command will do]

\`\`\`bash
[actual command here]
\`\`\`

**Expected result:** [What the user should see if successful]

---

## Response Structure
1. **Stage Overview** (2-3 sentences explaining this stage)
2. **Commands to Run** (each with Why/What/Command/Expected result)
3. **Verification Checklist** (what to check after all commands complete)

Be thorough in explanations but concise in commands.`;
  }

  /**
   * Get wizard-specific system prompt
   */
  getWizardSystemPrompt() {
    return `You are a deployment wizard assistant helping users deploy applications step by step.

Your role:
1. Guide users through each deployment stage
2. Provide specific, executable commands
3. Verify each step before proceeding
4. Handle errors gracefully with clear explanations

CRITICAL: CREDENTIAL MANAGEMENT
- ALWAYS check for existing credentials FIRST before asking the user
- The prompt will include information about already configured services
- If a cloud provider (AWS, Azure, GCP) is already configured, use it automatically - DO NOT ask again
- If a database (PostgreSQL, MongoDB, etc.) is already configured, use it automatically - DO NOT ask again
- Only ask for credentials for services that are NOT already configured
- When asking for missing credentials, provide structured input fields:
  * Field name (e.g., "AWS Access Key ID")
  * Field type (text, password, number, select, etc.)
  * Required/optional indicator
  * Description/help text
- Format credential requests as clear forms with labeled fields

Format your responses clearly:
- Use short explanations
- Put commands in \`\`\`bash code blocks
- Label each command with its purpose
- Provide expected output where helpful
- For credential collection, use structured forms with clear field labels

Available tools:
- Docker CLI (docker build, docker compose, etc.)
- AWS CLI (aws ec2, aws s3, etc.)
- SSH for remote operations

Always verify AWS CLI is configured before AWS commands.`;
  }

  /**
   * Generate infrastructure recommendations based on project context
   */
  async generateInfrastructureRecommendations(deploymentId) {
    try {
      const fullContext = await this.buildFullContext(deploymentId);
      const session = await this.getSession(deploymentId);
      const { projectContext } = session || {};
      
      const recommendations = [];
      
      // Cloud provider recommendations
      const hasCloudProvider = fullContext.serviceTopology.services.some(
        s => ['aws', 'azure', 'gcp', 'google-cloud'].includes(s.serviceType)
      );
      
      if (!hasCloudProvider) {
        recommendations.push({
          id: 'cloud-provider',
          type: 'cloud-provider',
          title: 'Select Cloud Provider',
          description: 'Choose a cloud provider for your deployment',
          options: [
            {
              provider: 'AWS',
              description: 'Amazon Web Services - Most popular, extensive services',
              pros: ['Wide service selection', 'Mature ecosystem', 'Good documentation'],
              cons: ['Can be complex', 'Pricing can be confusing'],
              estimatedCost: '$$$'
            },
            {
              provider: 'Azure',
              description: 'Microsoft Azure - Good for Microsoft stack integration',
              pros: ['Enterprise integration', 'Good for .NET', 'Hybrid cloud support'],
              cons: ['Less popular than AWS', 'Learning curve'],
              estimatedCost: '$$$'
            },
            {
              provider: 'GCP',
              description: 'Google Cloud Platform - Great for data/ML workloads',
              pros: ['Excellent for ML/AI', 'Good pricing', 'Modern platform'],
              cons: ['Smaller ecosystem', 'Less enterprise features'],
              estimatedCost: '$$'
            }
          ],
          priority: 'high'
        });
      }
      
      // Database recommendations
      const hasDatabase = fullContext.serviceTopology.services.some(
        s => ['postgresql', 'mongodb', 'mysql', 'redis'].includes(s.serviceType)
      );
      
      if (!hasDatabase && projectContext.services && projectContext.services.length > 0) {
        recommendations.push({
          id: 'database',
          type: 'database',
          title: 'Database Recommendation',
          description: 'Consider adding a database for data persistence',
          options: [
            {
              database: 'PostgreSQL',
              description: 'Relational database - best for structured data',
              pros: ['ACID compliance', 'SQL support', 'Mature'],
              cons: ['Requires schema design'],
              estimatedCost: '$$'
            },
            {
              database: 'MongoDB',
              description: 'NoSQL database - flexible schema',
              pros: ['Flexible schema', 'Good for JSON', 'Scalable'],
              cons: ['No joins', 'Less mature'],
              estimatedCost: '$$'
            },
            {
              database: 'Redis',
              description: 'In-memory cache - fast key-value store',
              pros: ['Very fast', 'Simple', 'Good for caching'],
              cons: ['Limited data types', 'Memory limits'],
              estimatedCost: '$'
            }
          ],
          priority: 'medium'
        });
      }
      
      // Docker recommendations
      if (!fullContext.dockerFiles.hasDockerfile) {
        recommendations.push({
          id: 'dockerfile',
          type: 'dockerfile',
          title: 'Dockerfile Missing',
          description: 'No Dockerfile found. Consider generating one for containerization.',
          priority: 'high',
          action: 'generate-dockerfile'
        });
      }
      
      // Store recommendations in session
      if (session) {
        if (!session.currentStageData) {
          session.currentStageData = {};
        }
        session.currentStageData.infrastructureRecommendations = recommendations;
        await session.save();
      }
      
      return {
        recommendations,
        count: recommendations.length,
        context: {
          hasCloudProvider,
          hasDatabase,
          hasDockerfile: fullContext.dockerFiles.hasDockerfile
        }
      };
    } catch (error) {
      logger.error(`Failed to generate infrastructure recommendations: ${error.message}`, { deploymentId });
      return {
        recommendations: [],
        count: 0,
        error: error.message
      };
    }
  }

  /**
   * Parse commands from Claude's response
   */
  parseCommandsFromResponse(content) {
    const commands = [];
    
    if (!content || typeof content !== 'string') {
      logger.warn('parseCommandsFromResponse: content is not a string', { 
        type: typeof content,
        hasContent: !!content 
      });
      return commands;
    }
    
    const bashBlocks = content.matchAll(/```(?:bash|shell|sh)?\n([\s\S]*?)```/g);
    
    for (const match of bashBlocks) {
      const block = match[1].trim();
      const lines = block.split('\n').filter(line => 
        line.trim() && !line.trim().startsWith('#')
      );
      
      for (const line of lines) {
        const cleanCmd = line.trim();
        if (cleanCmd && !cleanCmd.startsWith('$')) {
          commands.push({
            command: cleanCmd.replace(/^\$\s*/, ''),
            type: this.classifyCommand(cleanCmd)
          });
        }
      }
    }
    
    return commands;
  }

  /**
   * Parse user input requests from Claude response
   * Returns array of input request objects with fields property
   * Format: [{ fields: [{ name: string, type: string, description: string }] }]
   */
  parseUserInputRequests(content) {
    const inputRequests = [];
    
    if (!content || typeof content !== 'string') {
      logger.warn('parseUserInputRequests: content is not a string', { 
        type: typeof content,
        hasContent: !!content 
      });
      return inputRequests;
    }
    
    // Look for patterns that indicate user input requests
    // Pattern 1: JSON blocks with input request structure
    const jsonBlockPattern = /```(?:json)?\n?([\s\S]*?)```/g;
    const jsonMatches = Array.from(content.matchAll(jsonBlockPattern));
    
    for (const match of jsonMatches) {
      const jsonContent = match[1].trim();
      try {
        const parsed = JSON.parse(jsonContent);
        
        // Check if it's an input request object
        if (parsed && typeof parsed === 'object') {
          // Format 1: Direct input request object with fields array
          if (Array.isArray(parsed.fields) && parsed.fields.length > 0) {
            inputRequests.push({
              fields: parsed.fields.map(field => ({
                name: field.name || field.key || '',
                type: field.type || 'string',
                description: field.description || field.label || '',
                required: field.required !== undefined ? field.required : true
              }))
            });
          }
          // Format 2: Array of input requests
          else if (Array.isArray(parsed) && parsed.length > 0) {
            for (const item of parsed) {
              if (item && typeof item === 'object' && Array.isArray(item.fields)) {
                inputRequests.push({
                  fields: item.fields.map(field => ({
                    name: field.name || field.key || '',
                    type: field.type || 'string',
                    description: field.description || field.label || '',
                    required: field.required !== undefined ? field.required : true
                  }))
                });
              }
            }
          }
        }
      } catch (e) {
        // Not valid JSON, continue
        continue;
      }
    }
    
    // Pattern 2: Look for text patterns that indicate input requests
    // Example: "I need the following information:" followed by field descriptions
    const inputRequestPatterns = [
      /(?:I need|Please provide|I require|Please enter|Please input)[\s\S]*?(?::|\n)/gi,
      /(?:What is|Enter|Provide|Input)[\s\S]*?(?:\?|:)/gi
    ];
    
    // For now, return empty array if no structured JSON found
    // This can be extended later to parse natural language requests
    
    return inputRequests;
  }

  /**
   * Parse api_call invocations from Claude response
   * Returns array of parsed api_call objects
   */
  parseApiCalls(content) {
    const apiCalls = [];
    
    if (!content || typeof content !== 'string') {
      return apiCalls;
    }
    
    // Match <invoke name="api_call"> blocks (including potentially unclosed ones)
    // Use non-greedy match but also handle unclosed tags
    const invokePattern = /<invoke\s+name=["']api_call["']>([\s\S]*?)(?:<\/invoke>|$)/gi;
    const matches = Array.from(content.matchAll(invokePattern));
    
    for (const match of matches) {
      const invokeContent = match[1];
      
      // Extract parameters
      const urlMatch = invokeContent.match(/<parameter\s+name=["']url["']>([\s\S]*?)<\/parameter>/i);
      const methodMatch = invokeContent.match(/<parameter\s+name=["']method["']>([\s\S]*?)<\/parameter>/i);
      const bodyMatch = invokeContent.match(/<parameter\s+name=["']body["']>([\s\S]*?)(?:<\/parameter>|$)/i);
      
      if (urlMatch && methodMatch && bodyMatch) {
        try {
          const url = urlMatch[1].trim();
          const method = methodMatch[1].trim();
          let body;
          
          // Try to parse body as JSON
          let bodyContent = bodyMatch[1].trim();
          
          // Check if body content looks like JSON (starts with { or [)
          if (bodyContent.startsWith('{') || bodyContent.startsWith('[')) {
            try {
              body = JSON.parse(bodyContent);
            } catch (e) {
              // JSON parsing failed - try to fix common issues
              let fixedContent = bodyContent;
              
              // Fix 1: Handle unterminated strings (common when response is truncated)
              // Find the last complete string value and truncate incomplete ones
              const stringValuePattern = /"content"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/g;
              let lastMatch = null;
              let match;
              
              while ((match = stringValuePattern.exec(bodyContent)) !== null) {
                lastMatch = match;
              }
              
              if (lastMatch && lastMatch.index + lastMatch[0].length < bodyContent.length) {
                // There's content after the last complete match - might be incomplete
                const afterMatch = bodyContent.substring(lastMatch.index + lastMatch[0].length);
                // If there's an unterminated string after, truncate it
                if (afterMatch.includes('"') && !afterMatch.match(/^\s*[,}\]]/)) {
                  // Find where the incomplete string starts
                  const incompleteStart = bodyContent.indexOf('"', lastMatch.index + lastMatch[0].length);
                  if (incompleteStart >= 0) {
                    // Truncate at the start of incomplete string and close JSON
                    fixedContent = bodyContent.substring(0, incompleteStart);
                    // Close any open structures
                    const openBraces = (fixedContent.match(/\{/g) || []).length;
                    const closeBraces = (fixedContent.match(/\}/g) || []).length;
                    for (let i = 0; i < openBraces - closeBraces; i++) {
                      fixedContent += '}';
                    }
                  }
                }
              }
              
              // Fix 2: If JSON is incomplete (missing closing braces)
              if (!fixedContent.trim().endsWith('}') && !fixedContent.trim().endsWith(']')) {
                const openBraces = (fixedContent.match(/\{/g) || []).length;
                const closeBraces = (fixedContent.match(/\}/g) || []).length;
                const openBrackets = (fixedContent.match(/\[/g) || []).length;
                const closeBrackets = (fixedContent.match(/\]/g) || []).length;
                
                // Add missing closing braces/brackets
                for (let i = 0; i < openBraces - closeBraces; i++) {
                  fixedContent += '}';
                }
                for (let i = 0; i < openBrackets - closeBrackets; i++) {
                  fixedContent += ']';
                }
              }
              
              // Try parsing again
              try {
                body = JSON.parse(fixedContent);
                logger.info('Fixed incomplete JSON in api_call body', {
                  originalLength: bodyContent.length,
                  fixedLength: fixedContent.length
                });
              } catch (e2) {
                // Still can't parse - try extracting fields manually using more lenient regex
                // First try to find filePath (should be simple string)
                const filePathMatch = bodyContent.match(/"filePath"\s*:\s*"([^"]+)"/);
                
                // For content, handle multi-line strings that might be unterminated
                // Find "content": " and extract everything until the end or a closing quote
                const contentStartMatch = bodyContent.match(/"content"\s*:\s*"/);
                if (contentStartMatch && filePathMatch) {
                  const contentStartIndex = contentStartMatch.index + contentStartMatch[0].length;
                  let contentValue = '';
                  
                  // Extract content character by character, handling escaped characters
                  let i = contentStartIndex;
                  let escaped = false;
                  
                  while (i < bodyContent.length) {
                    const char = bodyContent[i];
                    
                    if (escaped) {
                      contentValue += char;
                      escaped = false;
                    } else if (char === '\\') {
                      contentValue += char;
                      escaped = true;
                    } else if (char === '"') {
                      // Found closing quote - content is complete
                      break;
                    } else {
                      contentValue += char;
                    }
                    i++;
                  }
                  
                  // If we reached the end without finding a closing quote, content is unterminated
                  // Use what we have (it's truncated but better than nothing)
                  if (i >= bodyContent.length) {
                    logger.warn('Content field appears to be truncated, using partial content');
                  }
                  
                  // Unescape the content
                  contentValue = contentValue.replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\r')
                    .replace(/\\t/g, '\t')
                    .replace(/\\"/g, '"')
                    .replace(/\\\\/g, '\\');
                  
                  body = {
                    filePath: filePathMatch[1],
                    content: contentValue
                  };
                  logger.info('Extracted filePath and content manually from malformed JSON', {
                    filePath: filePathMatch[1],
                    contentLength: contentValue.length,
                    wasTruncated: i >= bodyContent.length
                  });
                } else {
                  // Last resort: try to extract from raw invokeContent
                  const rawFilePathMatch = invokeContent.match(/"filePath"\s*:\s*"([^"]+)"/);
                  const rawContentStartMatch = invokeContent.match(/"content"\s*:\s*"/);
                  
                  if (rawContentStartMatch && rawFilePathMatch) {
                    const rawContentStartIndex = rawContentStartMatch.index + rawContentStartMatch[0].length;
                    // Extract until closing quote or end of invokeContent
                    let rawContentValue = invokeContent.substring(rawContentStartIndex);
                    const closingQuoteIndex = rawContentValue.indexOf('"');
                    
                    if (closingQuoteIndex >= 0) {
                      rawContentValue = rawContentValue.substring(0, closingQuoteIndex);
                    }
                    
                    // Unescape
                    rawContentValue = rawContentValue.replace(/\\n/g, '\n')
                      .replace(/\\r/g, '\r')
                      .replace(/\\t/g, '\t')
                      .replace(/\\"/g, '"')
                      .replace(/\\\\/g, '\\');
                    
                    body = {
                      filePath: rawFilePathMatch[1],
                      content: rawContentValue
                    };
                    logger.info('Extracted filePath and content from raw invoke content');
                  } else {
                    logger.warn('Failed to parse or extract JSON from api_call body', {
                      error: e2.message,
                      bodyPreview: bodyContent.substring(0, 300),
                      bodyLength: bodyContent.length,
                      hasFilePath: !!filePathMatch,
                      hasContentStart: !!contentStartMatch
                    });
                    continue; // Skip this api_call
                  }
                }
              }
            }
          } else {
            // Not JSON, treat as string
            body = bodyContent;
          }
          
          apiCalls.push({
            url,
            method,
            body,
            rawContent: invokeContent
          });
        } catch (error) {
          logger.warn('Failed to parse api_call:', error);
        }
      } else {
        // Missing required parameters - log but don't fail
        logger.debug('api_call missing required parameters', {
          hasUrl: !!urlMatch,
          hasMethod: !!methodMatch,
          hasBody: !!bodyMatch
        });
      }
    }
    
    return apiCalls;
  }

  /**
   * Check if bash code block content is a command vs a script file
   * Commands: Short (1-3 lines), no shebang, simple shell commands
   * Scripts: Has shebang, functions, variables, control flow, or explicit file context
   */
  isCommand(code, contextText = '') {
    if (!code || typeof code !== 'string') {
      return false;
    }
    
    const trimmedCode = code.trim();
    const lines = trimmedCode.split('\n').filter(line => line.trim() && !line.trim().startsWith('#'));
    const nonEmptyLines = lines.length;
    
    // Check for shebang - if present, it's definitely a script
    if (trimmedCode.startsWith('#!/bin/bash') || trimmedCode.startsWith('#!/bin/sh') || trimmedCode.startsWith('#!/usr/bin/env')) {
      logger.debug('isCommand: Detected shebang, treating as script file');
      return false;
    }
    
    // Check for script indicators
    const hasFunction = /^\s*(function\s+\w+|^\w+\s*\(\))/m.test(trimmedCode);
    const hasVariableAssignment = /\w+\s*=\s*["'`]/.test(trimmedCode);
    const hasControlFlow = /\b(if|for|while|case|select)\b/.test(trimmedCode);
    const hasComplexLogic = /\b(&&|\|\||;|then|else|fi|done|esac)\b/.test(trimmedCode);
    
    // Check context for explicit file mentions
    const lowerContext = (contextText || '').toLowerCase();
    const hasExplicitFileMention = 
      lowerContext.includes('create') && lowerContext.includes('file') ||
      lowerContext.includes('generate') && lowerContext.includes('file') ||
      lowerContext.includes('script') ||
      lowerContext.includes('deploy.sh') ||
      lowerContext.includes('build.sh') ||
      /(?:here|this|following).*script/i.test(contextText);
    
    // Commands are typically:
    // - 1-3 lines
    // - Simple shell commands (cat, ls, find, grep, etc.)
    // - No functions, variables, or control flow
    // - Context mentions "command" or "run" rather than "file" or "script"
    
    const isSimpleCommand = 
      nonEmptyLines <= 3 &&
      !hasFunction &&
      !hasVariableAssignment &&
      !hasControlFlow &&
      !hasComplexLogic &&
      !hasExplicitFileMention;
    
    // Check if it looks like a simple command pattern
    const simpleCommandPatterns = [
      /^cat\s+/,
      /^ls\s+/,
      /^find\s+/,
      /^grep\s+/,
      /^cd\s+/,
      /^pwd\s*$/,
      /^echo\s+/,
      /^head\s+/,
      /^tail\s+/,
      /^wc\s+/,
      /^stat\s+/,
      /^test\s+/
    ];
    
    const looksLikeSimpleCommand = simpleCommandPatterns.some(pattern => pattern.test(trimmedCode));
    
    if (isSimpleCommand && looksLikeSimpleCommand) {
      logger.debug('isCommand: Detected as command', {
        lines: nonEmptyLines,
        firstLine: lines[0]?.substring(0, 50)
      });
      return true;
    }
    
    // If it has script indicators or explicit file context, it's a script
    if (hasFunction || hasVariableAssignment || hasControlFlow || hasExplicitFileMention) {
      logger.debug('isCommand: Detected as script file', {
        hasFunction,
        hasVariableAssignment,
        hasControlFlow,
        hasExplicitFileMention
      });
      return false;
    }
    
    // Default: if it's longer than 3 lines or has multiple commands, treat as script
    if (nonEmptyLines > 3) {
      logger.debug('isCommand: Multiple lines detected, treating as script file');
      return false;
    }
    
    // Default to command if it's short and simple
    return isSimpleCommand;
  }

  /**
   * Parse files from markdown code blocks in chat responses
   * Extracts file content when Claude generates files in markdown format
   */
  parseFilesFromMarkdown(content) {
    const files = [];
    
    if (!content || typeof content !== 'string') {
      return files;
    }
    
    // Match markdown code blocks with language hints
    // Pattern: ```language\ncode\n```
    const codeBlockPattern = /```(\w+)?\n([\s\S]*?)```/g;
    const matches = Array.from(content.matchAll(codeBlockPattern));
    
    for (const match of matches) {
      const language = match[1] || '';
      const code = match[2].trim();
      
      if (!code) continue;
      
      // Look for file path in text before the code block
      // Get text in a 500 char window before the code block
      const matchIndex = match.index;
      const contextStart = Math.max(0, matchIndex - 500);
      const contextText = content.substring(contextStart, matchIndex);
      
      let filePath = null;
      let fileType = 'text';
      
      // Pattern 1: Explicit file path mentions
      // "Here's your backend/Dockerfile:", "I'll create frontend/package.json", etc.
      const explicitPathPatterns = [
        /(?:Here(?:'s| is)|I(?:'ll|'ve) (?:create|generated?)|Creating|Generated?|File:|Path:)\s+[`"]?([a-zA-Z0-9_\-./]+\.(dockerfile|yml|yaml|json|js|ts|tsx|jsx|sh|conf|config|md|txt|env|gitignore|dockerignore))[`"]?/i,
        /[`"]([a-zA-Z0-9_\-./]+\.(dockerfile|yml|yaml|json|js|ts|tsx|jsx|sh|conf|config|md|txt|env|gitignore|dockerignore))[`"]/i,
        /(?:file|path|save|write):\s*[`"]?([a-zA-Z0-9_\-./]+)[`"]?/i
      ];
      
      for (const pattern of explicitPathPatterns) {
        const pathMatch = contextText.match(pattern);
        if (pathMatch) {
          filePath = pathMatch[1];
          break;
        }
      }
      
      // Pattern 2: Infer from language and context
      if (!filePath) {
        const lowerLang = language.toLowerCase();
        const lowerContext = contextText.toLowerCase();
        
        // Dockerfile detection
        if (lowerLang === 'dockerfile' || lowerContext.includes('dockerfile')) {
          // Try to detect if it's for a specific service
          const serviceMatch = contextText.match(/(?:for|backend|frontend|api|web|service|app)[:\s]+([a-zA-Z0-9_-]+)/i);
          if (serviceMatch && !serviceMatch[1].match(/^(the|your|this|that|dockerfile)$/i)) {
            filePath = `${serviceMatch[1]}/Dockerfile`;
          } else {
            filePath = 'Dockerfile';
          }
          fileType = 'dockerfile';
        }
        // docker-compose.yml detection
        else if ((lowerLang === 'yaml' || lowerLang === 'yml') && lowerContext.includes('docker-compose')) {
          filePath = 'docker-compose.yml';
          fileType = 'docker-compose';
        }
        // .dockerignore detection
        else if (lowerContext.includes('dockerignore')) {
          filePath = '.dockerignore';
          fileType = 'dockerignore';
        }
        // nginx config detection
        else if ((lowerLang === 'nginx' || lowerLang === 'conf') && lowerContext.includes('nginx')) {
          filePath = 'nginx.conf';
          fileType = 'config';
        }
        // Shell script detection
        else if (lowerLang === 'bash' || lowerLang === 'sh') {
          // CRITICAL: Check if this is a command vs a script file
          if (this.isCommand(code, contextText)) {
            // This is a command, not a file - skip it
            // Commands will be picked up by parseCommandsFromResponse
            logger.debug('parseFilesFromMarkdown: Skipping command (not a file)', {
              code: code.substring(0, 100),
              context: contextText.substring(Math.max(0, contextText.length - 100))
            });
            continue; // Skip to next code block
          }
          
          // It's a script file - detect filename
          const scriptMatch = contextText.match(/([a-zA-Z0-9_-]+\.sh)/i);
          if (scriptMatch) {
            filePath = scriptMatch[1];
          } else {
            // Only default to deploy.sh if context suggests it's a file
            const suggestsFile = lowerContext.includes('script') || 
                                 lowerContext.includes('file') ||
                                 lowerContext.includes('create') ||
                                 lowerContext.includes('generate');
            if (suggestsFile) {
              filePath = 'deploy.sh';
            } else {
              // No clear file indication - skip it (likely a command)
              logger.debug('parseFilesFromMarkdown: No clear file indication for bash block, skipping');
              continue;
            }
          }
          fileType = 'script';
        }
        // YAML/JSON config files
        else if (lowerLang === 'yaml' || lowerLang === 'yml') {
          const yamlMatch = contextText.match(/([a-zA-Z0-9_-]+\.ya?ml)/i);
          filePath = yamlMatch ? yamlMatch[1] : 'config.yml';
          fileType = 'yaml';
        }
        else if (lowerLang === 'json') {
          const jsonMatch = contextText.match(/([a-zA-Z0-9_-]+\.json)/i);
          filePath = jsonMatch ? jsonMatch[1] : 'config.json';
          fileType = 'json';
        }
      }
      
      // Only create file if we have a valid path
      if (filePath) {
        files.push({
          filePath,
          content: code,
          type: fileType,
          language,
          detectedFrom: 'markdown'
        });
        
        logger.info(`Detected file in markdown code block: ${filePath}`, {
          language,
          contentLength: code.length,
          fileType
        });
      }
    }
    
    return files;
  }

  /**
   * Execute an api_call invocation
   * Currently handles write-file calls
   */
  /**
   * Create a file proposal (for user approval) instead of writing immediately
   */
  async createFileProposal(deploymentId, apiCall) {
    try {
      if (!apiCall.url || !apiCall.url.includes('/write-file')) {
        return null;
      }

      const { filePath, content } = apiCall.body || {};
      
      if (!filePath || content === undefined) {
        throw new Error('filePath and content are required for write-file');
      }
      
      // Format content
      const formattedContent = this.formatFileContent(content);
      
      // Determine file type from extension
      const getFileType = (path) => {
        const ext = path.split('.').pop().toLowerCase();
        if (['sh', 'bash'].includes(ext)) return 'script';
        if (['yml', 'yaml'].includes(ext)) return 'yaml';
        if (['json'].includes(ext)) return 'json';
        if (['conf', 'config'].includes(ext)) return 'config';
        if (path.includes('Dockerfile')) return 'dockerfile';
        if (path.includes('docker-compose')) return 'docker-compose';
        return 'text';
      };

      const proposal = {
        id: `${deploymentId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        filePath,
        content: formattedContent,
        preview: formattedContent.substring(0, 500),
        type: getFileType(filePath),
        size: formattedContent.length,
        requiresApproval: true,
        status: 'pending',
        createdAt: new Date()
      };

      logger.info(`Created file proposal: ${filePath}`, {
        deploymentId,
        filePath,
        proposalId: proposal.id,
        contentLength: formattedContent.length
      });

      return proposal;
    } catch (error) {
      logger.error(`Failed to create file proposal: ${error.message}`, {
        deploymentId,
        apiCall: apiCall.url
      });
      return null;
    }
  }

  /**
   * Approve and write a file proposal
   */
  async approveFileGeneration(deploymentId, proposalId) {
    try {
      const session = await this.getSession(deploymentId);
      if (!session || !session.currentStageData || !session.currentStageData.pendingFileProposals) {
        throw new Error('No pending file proposals found');
      }

      const proposal = session.currentStageData.pendingFileProposals.find(p => p.id === proposalId);
      if (!proposal) {
        throw new Error(`File proposal ${proposalId} not found`);
      }

      if (proposal.status !== 'pending') {
        throw new Error(`File proposal ${proposalId} is already ${proposal.status}`);
      }

      const cursorIntegration = require('./cursorIntegration');
      
      // Ensure workspace path is set
      let workspacePath = cursorIntegration.getWorkspacePath(deploymentId);
      if (!workspacePath) {
        if (session && session.projectContext && session.projectContext.projectPath) {
          workspacePath = session.projectContext.projectPath;
          cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
        } else {
          const deployment = await Deployment.findOne({ deploymentId });
          if (deployment && deployment.workspacePath) {
            workspacePath = deployment.workspacePath;
            cursorIntegration.setWorkspacePath(deploymentId, workspacePath);
          } else {
            throw new Error(`No workspace path set for deployment ${deploymentId}`);
          }
        }
      }

      // Write file to disk
      const result = await cursorIntegration.writeFile(deploymentId, proposal.filePath, proposal.content);
      
      // Update proposal status
      proposal.status = 'approved';
      proposal.approvedAt = new Date();
      proposal.written = true;

      // Track in generatedFiles
      await this.trackGeneratedFile(deploymentId, proposal.filePath, proposal.content, 'generated');

      await session.save();

      logger.info(`Approved and wrote file: ${proposal.filePath}`, {
        deploymentId,
        proposalId,
        filePath: proposal.filePath
      });

      return {
        success: true,
        proposal,
        result
      };
    } catch (error) {
      logger.error(`Failed to approve file generation: ${error.message}`, {
        deploymentId,
        proposalId
      });
      throw error;
    }
  }

  /**
   * Reject a file proposal
   */
  async rejectFileGeneration(deploymentId, proposalId) {
    try {
      const session = await this.getSession(deploymentId);
      if (!session || !session.currentStageData || !session.currentStageData.pendingFileProposals) {
        throw new Error('No pending file proposals found');
      }

      const proposal = session.currentStageData.pendingFileProposals.find(p => p.id === proposalId);
      if (!proposal) {
        throw new Error(`File proposal ${proposalId} not found`);
      }

      proposal.status = 'rejected';
      proposal.rejectedAt = new Date();

      await session.save();

      logger.info(`Rejected file proposal: ${proposal.filePath}`, {
        deploymentId,
        proposalId,
        filePath: proposal.filePath
      });

      return {
        success: true,
        proposal
      };
    } catch (error) {
      logger.error(`Failed to reject file generation: ${error.message}`, {
        deploymentId,
        proposalId
      });
      throw error;
    }
  }

  /**
   * Get pending file proposals for a deployment
   */
  async getPendingFileProposals(deploymentId) {
    try {
      const session = await this.getSession(deploymentId);
      if (!session || !session.currentStageData || !session.currentStageData.pendingFileProposals) {
        return [];
      }

      return session.currentStageData.pendingFileProposals.filter(p => p.status === 'pending');
    } catch (error) {
      logger.error(`Failed to get pending file proposals: ${error.message}`, { deploymentId });
      return [];
    }
  }

  async executeApiCall(deploymentId, apiCall) {
    try {
      const cursorIntegration = require('./cursorIntegration');
      
      // Handle write-file calls - now returns proposals instead of writing
      if (apiCall.url && apiCall.url.includes('/write-file')) {
        const proposal = await this.createFileProposal(deploymentId, apiCall);
        if (proposal) {
          return {
            success: true,
            proposal,
            requiresApproval: true
          };
        }
        return {
          success: false,
          error: 'Failed to create file proposal'
        };
      }
      
      // Other api_call types can be added here
      logger.warn(`Unhandled api_call type: ${apiCall.url}`);
      return {
        success: false,
        error: `Unhandled api_call type: ${apiCall.url}`
      };
    } catch (error) {
      logger.error(`Failed to execute api_call: ${error.message}`, {
        deploymentId,
        apiCall: apiCall.url
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format file content before writing
   * Ensures proper indentation, newlines, and encoding
   */
  formatFileContent(content) {
    if (typeof content !== 'string') {
      content = String(content || '');
    }
    
    // Replace escaped newlines with actual newlines
    content = content.replace(/\\n/g, '\n');
    content = content.replace(/\\r/g, '\r');
    
    // Normalize line endings to Unix style (\n)
    content = content.replace(/\r\n/g, '\n');
    content = content.replace(/\r/g, '\n');
    
    // Remove trailing whitespace from each line
    content = content.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');
    
    // Ensure file ends with a newline if it has content
    if (content && !content.endsWith('\n')) {
      content += '\n';
    }
    
    return content;
  }

  /**
   * Track a generated file in the session's generatedFiles array
   */
  async trackGeneratedFile(deploymentId, filePath, content, type = 'generated', service = '') {
    try {
      const session = await this.getSession(deploymentId);
      if (!session) {
        logger.warn(`Cannot track file - session not found: ${deploymentId}`);
        return;
      }
      
      // Ensure projectContext exists
      if (!session.projectContext) {
        session.projectContext = {};
      }
      
      // Ensure generatedFiles array exists
      if (!session.projectContext.generatedFiles) {
        session.projectContext.generatedFiles = [];
      }
      
      // Check if file already exists in the array
      const existingIndex = session.projectContext.generatedFiles.findIndex(
        f => f.path === filePath
      );
      
      // Create file entry matching exact schema format
      const fileEntry = {
        path: String(filePath || ''),
        content: typeof content === 'string' ? content : String(content || ''),
        type: String(type || this.detectFileType(filePath) || 'text'),
        service: String(service || this.detectServiceFromPath(filePath) || ''),
        generatedAt: new Date(),
        writtenToDisk: true
      };
      
      // CRITICAL: Ensure we're working with a plain array, not a Mongoose array
      // Get current files and ensure it's a plain JavaScript array
      let currentFiles = [];
      if (session.projectContext.generatedFiles) {
        if (Array.isArray(session.projectContext.generatedFiles)) {
          // Create a deep copy to ensure it's a plain array
          try {
            currentFiles = JSON.parse(JSON.stringify(session.projectContext.generatedFiles));
            // Validate each entry
            currentFiles = currentFiles.filter(f => {
              if (!f || typeof f !== 'object') {
                logger.warn('trackGeneratedFile: Filtering out invalid file entry');
                return false;
              }
              return true;
            });
          } catch (e) {
            logger.error('trackGeneratedFile: Failed to create plain array copy:', e.message);
            currentFiles = [];
          }
        } else {
          logger.warn('trackGeneratedFile: generatedFiles is not an array, resetting to empty array');
          currentFiles = [];
        }
      }
      
      // CRITICAL: Validate fileEntry before adding
      if (!fileEntry || typeof fileEntry !== 'object') {
        logger.error('trackGeneratedFile: Invalid fileEntry, skipping');
        return;
      }
      
      // Ensure fileEntry has required fields
      const validatedFileEntry = {
        path: String(fileEntry.path || ''),
        content: typeof fileEntry.content === 'string' ? fileEntry.content : String(fileEntry.content || ''),
        type: String(fileEntry.type || 'unknown'),
        service: String(fileEntry.service || ''),
        generatedAt: fileEntry.generatedAt instanceof Date ? fileEntry.generatedAt : new Date(fileEntry.generatedAt || Date.now()),
        writtenToDisk: Boolean(fileEntry.writtenToDisk || false)
      };
      
      if (existingIndex >= 0) {
        // Update existing entry
        currentFiles[existingIndex] = validatedFileEntry;
      } else {
        // Add new entry
        currentFiles.push(validatedFileEntry);
      }
      
      // CRITICAL: Ensure currentFiles is definitely a plain array before assignment
      if (!Array.isArray(currentFiles)) {
        logger.error('trackGeneratedFile: currentFiles is not an array after processing!');
        currentFiles = [];
      }
      
      // Assign the new array (this will trigger the setter)
      session.projectContext.generatedFiles = currentFiles;
      
      // Mark the field as modified to ensure Mongoose saves it
      session.markModified('projectContext.generatedFiles');
      
      await session.save();
      
      logger.info(`Tracked generated file: ${filePath}`, {
        deploymentId,
        filePath,
        type,
        totalFiles: session.projectContext.generatedFiles.length
      });
    } catch (error) {
      logger.error(`Failed to track generated file: ${error.message}`, {
        deploymentId,
        filePath
      });
      // Don't throw - file tracking failure shouldn't break file writing
    }
  }

  /**
   * Detect file type from file path
   */
  detectFileType(filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const name = filePath.split('/').pop()?.toLowerCase();
    
    if (name === 'dockerfile' || name === 'dockerfile.prod') {
      return 'dockerfile';
    }
    if (name === 'docker-compose.yml' || name === 'docker-compose.prod.yml') {
      return 'docker-compose';
    }
    if (name === 'nginx.conf' || name === 'nginx.config') {
      return 'nginx-config';
    }
    if (ext === 'sh' || name?.endsWith('.sh')) {
      return 'script';
    }
    if (ext === 'tf' || name?.endsWith('.tf')) {
      return 'terraform';
    }
    if (ext === 'yml' || ext === 'yaml') {
      return 'yaml';
    }
    if (ext === 'json') {
      return 'json';
    }
    
    return 'unknown';
  }

  /**
   * Detect service name from file path
   */
  detectServiceFromPath(filePath) {
    // Check if path contains service directory names
    const parts = filePath.split('/');
    const serviceDirs = ['backend', 'frontend', 'api', 'web', 'app', 'services'];
    
    for (const part of parts) {
      if (serviceDirs.includes(part.toLowerCase())) {
        return part.toLowerCase();
      }
    }
    
    // Check root-level files
    if (filePath.startsWith('backend/')) {
      return 'backend';
    }
    if (filePath.startsWith('frontend/')) {
      return 'frontend';
    }
    
    return '';
  }

  /**
   * Classify a command type
   */
  classifyCommand(cmd) {
    if (cmd.startsWith('docker compose') || cmd.startsWith('docker-compose')) {
      return 'docker-compose';
    }
    if (cmd.startsWith('docker')) {
      return 'docker';
    }
    if (cmd.startsWith('aws')) {
      return 'aws';
    }
    if (cmd.startsWith('terraform')) {
      return 'terraform';
    }
    if (cmd.startsWith('ssh') || cmd.startsWith('scp')) {
      return 'ssh';
    }
    if (cmd.startsWith('curl') || cmd.startsWith('wget')) {
      return 'http';
    }
    return 'shell';
  }

  // ============================================
  // Command Execution Recording
  // ============================================

  /**
   * Record command execution result
   */
  async recordExecution(deploymentId, stageId, command, result) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      logger.warn(`Cannot record execution: session not found for ${deploymentId}`);
      return;
    }

    if (!session.currentStageData) {
      session.currentStageData = {};
    }
    if (!session.currentStageData.executionResults) {
      session.currentStageData.executionResults = [];
    }

    session.currentStageData.executionResults.push({
      command,
      result: {
        success: result.success,
        exitCode: result.exitCode,
        error: result.error
      },
      output: result.output?.substring(0, 100000) || '',
      exitCode: result.exitCode,
      timestamp: new Date()
    });

    session.lastUpdatedAt = new Date();
    
    try {
      await session.save();
    } catch (error) {
      logger.error(`Failed to record execution: ${error.message}`);
    }
  }

  /**
   * Append terminal logs for current stage
   */
  async appendTerminalLogs(deploymentId, logs) {
    const session = await this.getSession(deploymentId);
    if (!session) return;

    if (!session.currentStageData) {
      session.currentStageData = {};
    }
    
    const currentLogs = session.currentStageData.terminalLogs || '';
    const newLogs = currentLogs + logs;
    
    // Truncate if too long
    session.currentStageData.terminalLogs = newLogs.substring(0, 500000);
    session.lastUpdatedAt = new Date();
    
    await session.save();
  }

  /**
   * Save command log entry in real-time (called during command streaming)
   */
  async saveCommandLog(deploymentId, command, logEntry, logType = 'stdout') {
    try {
      const session = await this.getSession(deploymentId);
      if (!session) return;

      if (!session.currentStageData) {
        session.currentStageData = {};
      }
      
      // Append to terminal logs
      const currentLogs = session.currentStageData.terminalLogs || '';
      session.currentStageData.terminalLogs = (currentLogs + logEntry + '\n').substring(0, 500000);
      
      // Also store structured log entry
      if (!session.currentStageData.commandLogs) {
        session.currentStageData.commandLogs = [];
      }
      
      session.currentStageData.commandLogs.push({
      command,
        log: logEntry.substring(0, 10000), // Truncate individual log entries
        type: logType,
      timestamp: new Date()
    });
      
      // Limit number of log entries to prevent memory issues
      if (session.currentStageData.commandLogs.length > 1000) {
        session.currentStageData.commandLogs = session.currentStageData.commandLogs.slice(-500);
      }

    session.lastUpdatedAt = new Date();
      
      await session.save();
    } catch (error) {
      // Don't throw - log saving should not break command execution
      logger.warn(`Failed to save command log: ${error.message}`);
    }
  }

  /**
   * Update command status in the queue
   */
  async updateCommandStatus(deploymentId, command, status) {
    const session = await this.getSession(deploymentId);
    if (!session) return;

    const queue = session.currentStageData?.commandQueue || [];
    const cmdIndex = queue.findIndex(c => c.command === command);
    
    if (cmdIndex !== -1) {
      queue[cmdIndex].status = status;
      if (status === 'running') {
        queue[cmdIndex].startedAt = new Date();
      }
      await session.save();
    }
  }

  // ============================================
  // Stage Completion
  // ============================================

  /**
   * Complete a stage
   */
  async completeStage(deploymentId, stageId, success, notes = '') {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stageIndex = WIZARD_STAGES.findIndex(s => s.id === stageId);
    if (stageIndex === -1) {
      throw new Error(`Unknown stage: ${stageId}`);
    }

    const stage = WIZARD_STAGES[stageIndex];
    
    // Handle file generation workflow stages
    if (stageId === 'GENERATE') {
      // Transition to GENERATE_README instead of next stage
      const generateReadmeIndex = WIZARD_STAGES.findIndex(s => s.id === 'GENERATE_README');
      if (generateReadmeIndex !== -1 && success) {
        session.completeCurrentStage(success, notes, stage.name, stage.description);
        session.currentStageIndex = generateReadmeIndex;
        session.currentStage = 'GENERATE_README';
        session.currentStageData = {
          startedAt: new Date()
        };
        await session.save();
        
        return {
          success: true,
          currentStage: session.currentStage,
          nextStage: WIZARD_STAGES[generateReadmeIndex],
          isComplete: false
        };
      }
    }

    // Handle file generation workflow transitions
    const fileGenerationTransitions = {
      'GENERATE_README': 'AWAIT_CURSOR_GENERATION',
      'AWAIT_CURSOR_GENERATION': 'AWAIT_FILE_UPLOAD',
      'AWAIT_FILE_UPLOAD': 'VERIFY_FILES',
      'VERIFY_FILES': 'FILES_VERIFIED',
      'FILES_VERIFIED': 'VERIFY' // Back to normal workflow
    };

    if (fileGenerationTransitions[stageId] && success) {
      const nextStageId = fileGenerationTransitions[stageId];
      const nextStageIndex = WIZARD_STAGES.findIndex(s => s.id === nextStageId);
      
      if (nextStageIndex !== -1) {
        session.completeCurrentStage(success, notes, stage.name, stage.description);
        session.currentStageIndex = nextStageIndex;
        session.currentStage = nextStageId;
        session.currentStageData = {
          startedAt: new Date()
        };
        await session.save();
        
        return {
          success: true,
          currentStage: session.currentStage,
          nextStage: WIZARD_STAGES[nextStageIndex],
          isComplete: false
        };
      }
    }
    
    // Complete current stage and move to history
    session.completeCurrentStage(success, notes, stage.name, stage.description);

    // Update current stage if successful
    if (success && stageIndex < WIZARD_STAGES.length - 1) {
      session.currentStageIndex = stageIndex + 1;
      session.currentStage = WIZARD_STAGES[stageIndex + 1].id;
      session.currentStageData = {
        startedAt: new Date()
      };
    }
    
    // Check if wizard is complete
    const isComplete = stageIndex === WIZARD_STAGES.length - 1 && success;
    if (isComplete) {
      session.status = 'completed';
      session.completedAt = new Date();
    }

    session.lastUpdatedAt = new Date();
    
    await session.save();
    
    logger.info(`Stage ${stageId} completed: ${success ? 'success' : 'failed'}`);

    return {
      completed: true,
      success,
      nextStage: success && !isComplete ? WIZARD_STAGES[stageIndex + 1] : null,
      isComplete
    };
  }

  // ============================================
  // Error Analysis
  // ============================================

  /**
   * Analyze error from a failed command and suggest fixes
   */
  async analyzeError(deploymentId, stageId, command, errorOutput, exitCode) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stage = this.getStageInfo(stageId);
    const legacySession = this.sessionToLegacyFormat(session);
    
    const prompt = `A command failed during the "${stage.name}" stage of deployment. Analyze the error and provide fix commands.

## Failed Command
\`\`\`bash
${command}
\`\`\`

## Exit Code
${exitCode}

## Error Output
\`\`\`
${errorOutput}
\`\`\`

## Project Context
- Project Path: ${legacySession.projectContext.projectPath || 'Not set'}
- Project Type: ${legacySession.projectContext.projectType || 'Unknown'}
- Framework: ${legacySession.projectContext.framework || 'Unknown'}

## Your Task
1. Explain what went wrong in simple terms
2. Identify the root cause
3. Provide specific commands to fix the issue

## Response Format
### Error Analysis
[Explain what the error means and why it happened]

### Root Cause
[Identify the specific cause]

### Fix Commands
For each fix command, provide:

#### Fix 1: [Brief title]
**Why:** [Why this fix is needed]
**Command:**
\`\`\`bash
[fix command]
\`\`\`

#### Fix 2: [if needed]
...

### After Fixing
[What the user should do after running the fix commands - typically re-run the original failed command]`;

    try {
      const userId = session.userId?.toString();

      const response = await claudeService.chat(deploymentId, prompt, {
        systemPrompt: this.getErrorAnalysisSystemPrompt(),
        userId: userId
      });

      const content = response.message || response.content || '';
      const fixCommands = this.parseCommandsFromResponse(content);

      // Store error analysis in database
      if (!session.currentStageData) {
        session.currentStageData = {};
      }
      if (!session.currentStageData.errorAnalyses) {
        session.currentStageData.errorAnalyses = [];
      }
      
      session.currentStageData.errorAnalyses.push({
        command,
        errorOutput,
        exitCode,
        analysis: content,
        fixCommands: fixCommands.map(cmd => ({
          command: cmd.command,
          type: cmd.type,
          isFixCommand: true
        })),
        retryCommands: [{
          command,
          type: this.classifyCommand(command),
          isRetryCommand: true
        }],
        analyzedAt: new Date()
      });
      
      await session.save();

      return {
        analysis: content,
        fixCommands,
        originalCommand: command,
        originalError: errorOutput,
        exitCode
      };
    } catch (error) {
      logger.error(`Failed to analyze error: ${error.message}`);
      return {
        analysis: `Failed to analyze error: ${error.message}. Please review the error output manually.`,
        fixCommands: [],
        originalCommand: command,
        originalError: errorOutput,
        exitCode
      };
    }
  }

  /**
   * Get error analysis system prompt
   */
  getErrorAnalysisSystemPrompt() {
    return `You are a deployment troubleshooting expert. When analyzing errors:

1. Be specific about what went wrong
2. Identify the exact cause (missing dependency, permission issue, configuration problem, etc.)
3. Provide fix commands that are:
   - Specific and executable
   - In the correct order
   - Safe to run
4. Explain each fix command's purpose
5. Be concise but thorough

Common issues to check for:
- Missing packages/dependencies
- Permission denied errors
- Port conflicts
- Missing environment variables
- Docker daemon not running
- AWS credentials not configured
- Network connectivity issues`;
  }

  /**
   * Generate fix commands for multiple failed commands
   */
  async generateFixCommands(deploymentId, stageId, failedCommands) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stage = this.getStageInfo(stageId);
    const legacySession = this.sessionToLegacyFormat(session);
    
    const failureSummary = failedCommands.map((fc, i) => 
      `### Failure ${i + 1}
Command: \`${fc.command}\`
Exit Code: ${fc.exitCode}
Error Output:
\`\`\`
${fc.errorOutput || 'No error output'}
\`\`\`
`).join('\n');

    const prompt = `Multiple commands failed during the "${stage.name}" stage. Analyze all failures and provide a comprehensive fix plan.

## Failed Commands
${failureSummary}

## Project Context
- Project Path: ${legacySession.projectContext.projectPath || 'Not set'}
- Project Type: ${this.formatProjectType(legacySession.projectContext)}
- Framework: ${legacySession.projectContext.framework || 'Unknown'}

## Your Task
1. Identify if these failures are related or independent
2. Determine the root cause(s)
3. Provide fix commands in the correct order to resolve ALL issues

## Response Format

### Summary
[Brief summary of what went wrong]

### Root Causes
- [Cause 1]
- [Cause 2]

### Fix Plan
Execute these commands in order to fix all issues:

#### Step 1: [Title]
**Why:** [Explanation]
\`\`\`bash
[command]
\`\`\`

#### Step 2: [Title]
...

### Retry Commands
After fixes, re-run these original commands:
1. \`[original command 1]\`
2. \`[original command 2]\``;

    try {
      const userId = session.userId?.toString();

      const response = await claudeService.chat(deploymentId, prompt, {
        systemPrompt: this.getErrorAnalysisSystemPrompt(),
        userId: userId
      });

      const content = response.message || response.content || '';
      const fixCommands = this.parseCommandsFromResponse(content);

      const retryCommands = failedCommands.map(fc => ({
        command: fc.command,
        type: this.classifyCommand(fc.command),
        isRetry: true
      }));

      // Store in database
      if (!session.currentStageData) {
        session.currentStageData = {};
      }
      if (!session.currentStageData.errorAnalyses) {
        session.currentStageData.errorAnalyses = [];
      }
      
      session.currentStageData.errorAnalyses.push({
        command: failedCommands.map(fc => fc.command).join('; '),
        errorOutput: failedCommands.map(fc => fc.errorOutput).join('\n---\n'),
        exitCode: failedCommands[0]?.exitCode,
        analysis: content,
        fixCommands: fixCommands.map(cmd => ({
          command: cmd.command,
          type: cmd.type,
          isFixCommand: true
        })),
        retryCommands: retryCommands.map(cmd => ({
          command: cmd.command,
          type: cmd.type,
          isRetryCommand: true
        })),
        analyzedAt: new Date()
      });
      
      await session.save();

      return {
        analysis: content,
        fixCommands,
        retryCommands,
        failedCommands
      };
    } catch (error) {
      logger.error(`Failed to generate fix commands: ${error.message}`);
      return {
        analysis: `Failed to analyze errors: ${error.message}`,
        fixCommands: [],
        retryCommands: failedCommands.map(fc => ({
          command: fc.command,
          type: this.classifyCommand(fc.command),
          isRetry: true
        })),
        failedCommands
      };
    }
  }

  // ============================================
  // Stage Verification
  // ============================================

  /**
   * Auto-verify a stage and return next action
   */
  async autoVerifyStage(deploymentId, stageId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stage = this.getStageInfo(stageId);
    const execResults = session.currentStageData?.executionResults || [];
    const generatedCommands = session.currentStageData?.generatedCommands || [];

    const executedCommands = new Set(execResults.map(r => r.command));
    const allCommandsExecuted = generatedCommands.every(cmd => 
      executedCommands.has(cmd.command)
    );

    const failedCommands = execResults
      .filter(r => !r.result?.success)
      .map(r => ({
        command: r.command,
        exitCode: r.result?.exitCode || r.exitCode,
        errorOutput: r.output || r.result?.error || ''
      }));

    if (failedCommands.length > 0) {
      logger.info(`Stage ${stageId} has ${failedCommands.length} failed commands, analyzing...`);
      const fixResult = await this.generateFixCommands(deploymentId, stageId, failedCommands);
      
      // Store verification result
      session.currentStageData.verificationResult = {
        passed: false,
        allCommandsExecuted,
        analysis: fixResult.analysis,
        shouldAdvance: false,
        timestamp: new Date()
      };
      await session.save();
      
      return {
        passed: false,
        allCommandsExecuted,
        analysis: fixResult.analysis,
        fixCommands: fixResult.fixCommands,
        retryCommands: fixResult.retryCommands,
        failedCommands,
        shouldAdvance: false
      };
    }

    if (!allCommandsExecuted && generatedCommands.length > 0) {
      const pendingCommands = generatedCommands.filter(cmd => 
        !executedCommands.has(cmd.command)
      );
      return {
        passed: false,
        allCommandsExecuted: false,
        analysis: `Stage not complete. ${pendingCommands.length} command(s) still need to be executed.`,
        pendingCommands,
        shouldAdvance: false
      };
    }

    const verification = await this.verifyStage(deploymentId, stageId);
    
    // Store verification result
    session.currentStageData.verificationResult = {
      passed: verification.success,
      allCommandsExecuted: true,
      analysis: verification.claudeAnalysis || 'Stage verification complete.',
      shouldAdvance: verification.success,
      timestamp: new Date()
    };
    await session.save();
    
    return {
      passed: verification.success,
      allCommandsExecuted: true,
      analysis: verification.claudeAnalysis || 'Stage verification complete.',
      shouldAdvance: verification.success,
      executionResults: verification.executionResults
    };
  }

  /**
   * Verify a stage is complete
   */
  async verifyStage(deploymentId, stageId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stage = this.getStageInfo(stageId);
    const execResults = session.currentStageData?.executionResults || [];

    const allSucceeded = execResults.length > 0 && 
      execResults.every(r => r.result?.success);

    const verificationPrompt = `Verify that stage "${stage.name}" completed successfully.

Execution results:
${JSON.stringify(execResults, null, 2)}

Verification criteria: ${stage.verification}

Did this stage complete successfully? Respond with:
1. SUCCESS or FAILURE
2. Brief explanation
3. Any issues found`;

    try {
      const userId = session.userId?.toString();

      const response = await claudeService.chat(deploymentId, verificationPrompt, {
        userId: userId
      });
      
      const content = response.message || response.content || '';
      
      const isSuccess = content.toLowerCase().includes('success') &&
        !content.toLowerCase().includes('failure');

      return {
        verified: true,
        success: isSuccess && allSucceeded,
        claudeAnalysis: content,
        executionResults: execResults
      };
    } catch (error) {
      return {
        verified: false,
        success: allSucceeded,
        error: error.message,
        executionResults: execResults
      };
    }
  }

  // ============================================
  // Command Queue Management
  // ============================================

  /**
   * Get the next command to execute
   */
  async getNextCommand(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) return null;
    
    // If blocked by error, return null
    if (session.currentStageData?.isBlocked) {
      return null;
    }
    
    const queue = session.currentStageData?.commandQueue || [];
    const currentIndex = session.currentStageData?.currentCommandIndex || 0;
    
    if (currentIndex >= queue.length) {
      return null;
    }
    
    return queue[currentIndex];
  }

  /**
   * Get command queue status
   */
  async getCommandQueueStatus(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      return { queue: [], currentIndex: 0, isBlocked: false };
    }
    
    return {
      queue: session.currentStageData?.commandQueue || [],
      currentIndex: session.currentStageData?.currentCommandIndex || 0,
      isBlocked: session.currentStageData?.isBlocked || false,
      blockingError: session.currentStageData?.blockingError || null,
      progress: {
        completed: session.currentStageData?.currentCommandIndex || 0,
        total: session.currentStageData?.commandQueue?.length || 0
      }
    };
  }

  /**
   * Mark a command as complete (success or failure)
   */
  async markCommandComplete(deploymentId, command, success, exitCode, output) {
    // Use atomic update to avoid parallel save errors
    // First, find the session to get the current state
    const session = await WizardSession.findOne({ deploymentId });
    if (!session) {
      throw new Error('Wizard session not found');
    }
    
    const queue = session.currentStageData?.commandQueue || [];
    const index = queue.findIndex(c => c.command === command);
    
    if (index === -1) {
      logger.warn(`Command not found in queue: ${command}`);
      return { success: false, error: 'Command not found in queue' };
    }
    
    // Prepare update operations using MongoDB atomic operators
    const setOps = {};
    
    // Update command in queue
    setOps[`currentStageData.commandQueue.${index}.status`] = success ? 'success' : 'failed';
    setOps[`currentStageData.commandQueue.${index}.exitCode`] = exitCode;
    setOps[`currentStageData.commandQueue.${index}.completedAt`] = new Date();
    setOps[`currentStageData.commandQueue.${index}.output`] = output?.substring(0, 50000);
    
    if (success) {
      // Advance to next command
      setOps['currentStageData.currentCommandIndex'] = index + 1;
      setOps['currentStageData.isBlocked'] = false;
      
      logger.info(`Command completed successfully: ${command}`);
    } else {
      // Block further execution until error is resolved
      setOps['currentStageData.isBlocked'] = true;
      setOps['currentStageData.blockingError'] = {
        command,
        exitCode,
        errorOutput: output?.substring(0, 50000),
        fixAttempts: 0
      };
      
      logger.info(`Command failed, blocking: ${command}`);
    }
    
    // Add execution result using $push
    const executionResult = {
      command,
      result: { success, exitCode, error: success ? null : output },
      output: output?.substring(0, 100000),
      exitCode,
      timestamp: new Date()
    };
    
    setOps['lastUpdatedAt'] = new Date();
    
    // Use findOneAndUpdate with atomic operators
    // Note: $push will automatically create the array if it doesn't exist
    const updatedSession = await WizardSession.findOneAndUpdate(
      { deploymentId },
      {
        $set: setOps,
        $push: {
          'currentStageData.executionResults': executionResult
        }
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedSession) {
      throw new Error('Failed to update wizard session');
    }
    
    // Invalidate cache to ensure fresh data on next access
    if (this.sessionCache.has(deploymentId)) {
      this.sessionCache.delete(deploymentId);
    }
    
    // Get next command if available
    const nextCommand = success ? await this.getNextCommand(deploymentId) : null;
    
    return {
      success,
      isBlocked: !success,
      nextCommand,
      progress: {
        completed: updatedSession.currentStageData.currentCommandIndex,
        total: updatedSession.currentStageData.commandQueue.length
      }
    };
  }

  /**
   * Resolve a blocking error - analyze with Claude and insert fix commands
   */
  async resolveBlockingError(deploymentId, stageId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }
    
    if (!session.currentStageData?.isBlocked) {
      return { resolved: true, message: 'No blocking error' };
    }
    
    const error = session.currentStageData.blockingError;
    error.fixAttempts = (error.fixAttempts || 0) + 1;
    
    logger.info(`Resolving blocking error for command: ${error.command}, attempt ${error.fixAttempts}`);
    
    // Analyze error with Claude
    const analysis = await this.analyzeError(
      deploymentId,
      stageId,
      error.command,
      error.errorOutput,
      error.exitCode
    );
    
    // Store analysis
    error.analysis = analysis.analysis;
    
    // Get the queue and find the failed command index
    const queue = session.currentStageData.commandQueue || [];
    const failedIndex = queue.findIndex(c => c.command === error.command);
    
    if (failedIndex !== -1 && analysis.fixCommands && analysis.fixCommands.length > 0) {
      // Insert fix commands before the failed command
      for (let i = analysis.fixCommands.length - 1; i >= 0; i--) {
        const fixCmd = analysis.fixCommands[i];
        queue.splice(failedIndex, 0, {
          command: fixCmd.command,
          type: fixCmd.type || this.classifyCommand(fixCmd.command),
          reason: fixCmd.reason || 'Fix command suggested by Claude',
          status: 'pending',
          order: failedIndex + i,
          isFixCommand: true
        });
      }
      
      // Reset the failed command to pending for retry
      const originalCmdIndex = failedIndex + analysis.fixCommands.length;
      if (queue[originalCmdIndex]) {
        queue[originalCmdIndex].status = 'pending';
        queue[originalCmdIndex].isRetryCommand = true;
      }
      
      // Update current index to start from fix commands
      session.currentStageData.currentCommandIndex = failedIndex;
    }
    
    // Unblock
    session.currentStageData.isBlocked = false;
    session.lastUpdatedAt = new Date();
    
    await session.save();
    
    logger.info(`Error resolved, inserted ${analysis.fixCommands?.length || 0} fix commands`);
    
    return {
      resolved: true,
      analysis: analysis.analysis,
      fixCommands: analysis.fixCommands,
      nextCommand: queue[failedIndex] || null,
      progress: {
        completed: session.currentStageData.currentCommandIndex,
        total: queue.length
      }
    };
  }

  /**
   * Skip a failed command and continue with the next one
   */
  async skipBlockedCommand(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }
    
    if (!session.currentStageData?.isBlocked) {
      return { skipped: false, message: 'No blocked command' };
    }
    
    const queue = session.currentStageData.commandQueue || [];
    const currentIndex = session.currentStageData.currentCommandIndex || 0;
    
    // Mark current command as skipped
    if (queue[currentIndex]) {
      queue[currentIndex].status = 'skipped';
    }
    
    // Move to next command
    session.currentStageData.currentCommandIndex = currentIndex + 1;
    session.currentStageData.isBlocked = false;
    session.currentStageData.blockingError = null;
    session.lastUpdatedAt = new Date();
    
    await session.save();
    
    return {
      skipped: true,
      nextCommand: await this.getNextCommand(deploymentId),
      progress: {
        completed: session.currentStageData.currentCommandIndex,
        total: queue.length
      }
    };
  }

  // ============================================
  // Status and History
  // ============================================

  /**
   * Get wizard status
   */
  async getStatus(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      return null;
    }

    return {
      deploymentId,
      currentStage: session.currentStage,
      currentStageIndex: session.currentStageIndex,
      totalStages: WIZARD_STAGES.length,
      completedStages: session.completedStages,
      progress: session.progress,
      status: session.status,
      stageHistory: session.stageHistory.map(s => ({
        stage: s.stageId,
        success: s.success,
        notes: s.notes,
        completedAt: s.completedAt
      })),
      startedAt: session.startedAt,
      lastUpdatedAt: session.lastUpdatedAt,
      metadata: session.metadata,
      allStages: WIZARD_STAGES.map((s, i) => ({
        ...s,
        status: i < session.currentStageIndex ? 'completed' :
                i === session.currentStageIndex ? 'current' : 'pending'
      }))
    };
  }

  /**
   * Get full session data (for API)
   */
  async getFullSession(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      return null;
    }
    
    // Convert to plain object with clean serialization
    const sessionObj = session.toObject ? session.toObject() : session;
    
    // CRITICAL: Ensure generatedFiles is properly serialized as a plain array
    if (sessionObj.projectContext && sessionObj.projectContext.generatedFiles !== undefined) {
      try {
        // Normalize and ensure it's a plain array
        const normalized = this.normalizeGeneratedFiles(sessionObj.projectContext.generatedFiles);
        // JSON round-trip to ensure clean serialization
        sessionObj.projectContext.generatedFiles = JSON.parse(JSON.stringify(normalized));
        
        logger.debug('getFullSession: Cleaned generatedFiles for serialization', {
          length: sessionObj.projectContext.generatedFiles.length,
          isArray: Array.isArray(sessionObj.projectContext.generatedFiles)
        });
      } catch (e) {
        logger.error('getFullSession: Failed to clean generatedFiles:', e.message);
        sessionObj.projectContext.generatedFiles = [];
      }
    }
    
    return sessionObj;
  }

  /**
   * Get stage history with all details
   */
  async getStageHistory(deploymentId, stageId = null) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      return null;
    }

    if (stageId) {
      const stageData = session.stageHistory.find(s => s.stageId === stageId);
      if (!stageData && session.currentStage === stageId) {
        return {
          stageId,
          ...session.currentStageData,
          isCurrentStage: true
        };
      }
      return stageData;
    }

    return session.stageHistory;
  }

  /**
   * Reset wizard to a specific stage
   */
  async resetToStage(deploymentId, stageId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    const stageIndex = WIZARD_STAGES.findIndex(s => s.id === stageId);
    if (stageIndex === -1) {
      throw new Error(`Unknown stage: ${stageId}`);
    }

    // Remove history after this stage
    session.stageHistory = session.stageHistory.filter(h => {
      const idx = WIZARD_STAGES.findIndex(s => s.id === h.stageId);
      return idx < stageIndex;
    });

    session.currentStageIndex = stageIndex;
    session.currentStage = stageId;
    session.completedStages = stageIndex;
    session.currentStageData = {
      startedAt: new Date()
    };
    session.status = 'active';
    session.lastUpdatedAt = new Date();

    await session.save();

    return this.getStatus(deploymentId);
  }

  /**
   * Pause a session
   */
  async pauseSession(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    session.status = 'paused';
    session.lastUpdatedAt = new Date();
    await session.save();

    return { success: true, status: 'paused' };
  }

  /**
   * Resume a paused session
   */
  async resumeSession(deploymentId) {
    const session = await this.getSession(deploymentId);
    if (!session) {
      throw new Error('Wizard session not found');
    }

    session.status = 'active';
    session.metadata.resumeCount = (session.metadata.resumeCount || 0) + 1;
    session.lastUpdatedAt = new Date();
    await session.save();

    return this.getStatus(deploymentId);
  }

  /**
   * Cleanup session from cache (not database)
   */
  cleanupCache(deploymentId) {
    this.sessionCache.delete(deploymentId);
    logger.info(`Wizard session cache cleaned for ${deploymentId}`);
  }

  /**
   * Delete session from database
   */
  async deleteSession(deploymentId) {
    await WizardSession.deleteOne({ deploymentId });
    this.sessionCache.delete(deploymentId);
    logger.info(`Wizard session deleted for ${deploymentId}`);
  }
}

module.exports = new WizardOrchestrator();
