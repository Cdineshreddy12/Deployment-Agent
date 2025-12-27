const cursorIntegration = require('./cursorIntegration');
const cliExecutor = require('./cliExecutor');
const VerificationRule = require('../models/VerificationRule');
const readmeParser = require('./readmeParser');
const fileDetectionService = require('./fileDetectionService');
const envFileDetector = require('./envFileDetector');
const logger = require('../utils/logger');

/**
 * File Verification Service
 * Verifies generated files using Cursor file reading and commands (no LLM calls)
 */
class FileVerificationService {
  constructor() {
    this.ruleCache = new Map();
  }

  /**
   * Verify Docker files from README (new method - uses terminal commands)
   */
  async verifyDockerFilesFromReadme(deploymentId, readmeContent) {
    try {
      const verificationResults = {
        status: 'passed',
        errors: [],
        warnings: [],
        details: {},
        detectedFiles: {
          existing: [],
          missing: []
        }
      };

      // 1. Parse README to extract expected files and configurations
      const requirements = readmeParser.parseAllRequirements(readmeContent);
      let expectedFiles = requirements.expectedFiles;
      const serviceConfigs = requirements.serviceConfigs;

      // 2. Detect .env files and add them to expected files
      const envFiles = await envFileDetector.detectEnvFiles(deploymentId);
      const envVars = await envFileDetector.getEnvVariables(deploymentId);
      
      // Add .env files to expected files if not already present
      for (const envFile of envFiles) {
        if (!expectedFiles.find(f => f.path === envFile.path)) {
          expectedFiles.push({
            path: envFile.path,
            type: 'env',
            service: null
          });
        }
      }

      logger.info('Parsed README requirements', {
        deploymentId,
        expectedFilesCount: expectedFiles.length,
        servicesCount: Object.keys(serviceConfigs).length,
        envFilesCount: envFiles.length,
        envVarsCount: envVars.count
      });

      // 2. Detect which files actually exist using terminal commands
      const detectedFiles = await fileDetectionService.detectGeneratedFiles(deploymentId, expectedFiles);
      verificationResults.detectedFiles = detectedFiles;

      // 3. Check for missing files
      for (const missing of detectedFiles.missing) {
        verificationResults.errors.push({
          file: missing.path,
          type: 'file_not_found',
          message: `Expected file not found: ${missing.path}`,
          severity: 'error',
          suggestion: `Please generate ${missing.path} in Cursor using the README instructions`
        });
        verificationResults.status = 'failed';
      }

      // 4. Read file contents using terminal commands
      const existingFilePaths = detectedFiles.existing.map(f => f.path);
      const fileContents = await fileDetectionService.readFileContents(deploymentId, existingFilePaths);

      // 5. Verify each existing file
      for (const filePath of existingFilePaths) {
        const fileContent = fileContents[filePath];
        if (!fileContent || !fileContent.content) {
          verificationResults.warnings.push({
            file: filePath,
            type: 'read_error',
            message: `Could not read file content: ${filePath}`,
            suggestion: 'Check file permissions'
          });
          continue;
        }

        const expected = expectedFiles.find(f => f.path === filePath);
        const serviceConfig = expected?.service ? serviceConfigs[expected.service] : null;

        const fileResult = await this.verifyFileContent(
          deploymentId,
          filePath,
          fileContent.content,
          expected,
          serviceConfig
        );

        verificationResults.details[filePath] = fileResult;

        if (fileResult.errors && fileResult.errors.length > 0) {
          verificationResults.status = 'failed';
          verificationResults.errors.push(...fileResult.errors);
        }

        if (fileResult.warnings && fileResult.warnings.length > 0) {
          verificationResults.warnings.push(...fileResult.warnings);
        }
      }

      // 6. Run verification commands (docker-compose config, etc.)
      const composeFile = existingFilePaths.find(p => p.includes('docker-compose'));
      if (composeFile) {
        const commandResults = await this.runVerificationCommandsForFile(deploymentId, composeFile);
        verificationResults.commandResults = commandResults;

        if (commandResults.failed && commandResults.failed.length > 0) {
          verificationResults.status = 'failed';
          verificationResults.errors.push(...commandResults.failed.map(cmd => ({
            file: composeFile,
            type: 'command_execution',
            message: cmd.error,
            severity: 'error'
          })));
        }
      }

      logger.info('Docker files verification completed (README-based)', {
        deploymentId,
        status: verificationResults.status,
        expectedFiles: expectedFiles.length,
        existingFiles: detectedFiles.existing.length,
        missingFiles: detectedFiles.missing.length,
        errors: verificationResults.errors.length,
        warnings: verificationResults.warnings.length
      });

      return verificationResults;
    } catch (error) {
      logger.error('Failed to verify Docker files from README:', error);
      throw error;
    }
  }

  /**
   * Verify Docker files for a deployment (legacy method with uploaded files)
   */
  async verifyDockerFiles(deploymentId, readmeContent, uploadedFiles) {
    try {
      const verificationResults = {
        status: 'passed',
        errors: [],
        warnings: [],
        details: {}
      };

      // Verify each uploaded file
      for (const file of uploadedFiles) {
        const fileResult = await this.verifyFile(deploymentId, file.path, file.content, readmeContent);
        
        verificationResults.details[file.path] = fileResult;
        
        if (fileResult.errors && fileResult.errors.length > 0) {
          verificationResults.status = 'failed';
          verificationResults.errors.push(...fileResult.errors);
        }
        
        if (fileResult.warnings && fileResult.warnings.length > 0) {
          verificationResults.warnings.push(...fileResult.warnings);
        }
      }

      // Run verification commands
      const commandResults = await this.runVerificationCommands(deploymentId, uploadedFiles);
      verificationResults.commandResults = commandResults;

      // Update status based on command results
      if (commandResults.failed && commandResults.failed.length > 0) {
        verificationResults.status = 'failed';
        verificationResults.errors.push(...commandResults.failed.map(cmd => ({
          file: 'command',
          type: 'command_execution',
          message: cmd.error,
          severity: 'error'
        })));
      }

      logger.info('Docker files verification completed', {
        deploymentId,
        status: verificationResults.status,
        errors: verificationResults.errors.length,
        warnings: verificationResults.warnings.length
      });

      return verificationResults;
    } catch (error) {
      logger.error('Failed to verify Docker files:', error);
      throw error;
    }
  }

  /**
   * Verify a single file
   */
  async verifyFile(deploymentId, filePath, fileContent, readmeContent) {
    const result = {
      file: filePath,
      status: 'passed',
      errors: [],
      warnings: [],
      checks: []
    };

    try {
      // Determine file type
      const fileType = this.detectFileType(filePath);
      
      // Get verification rules for this file type
      const rules = await this.getVerificationRules(fileType);
      
      // Apply rules
      for (const rule of rules) {
        if (!rule.enabled) continue;
        
        const checkResult = await this.applyRule(rule, fileContent, filePath, deploymentId);
        result.checks.push({
          rule: rule.name,
          passed: checkResult.passed,
          message: checkResult.message
        });
        
        if (!checkResult.passed) {
          if (rule.severity === 'error') {
            result.status = 'failed';
            result.errors.push({
              file: filePath,
              type: rule.ruleType,
              message: checkResult.message,
              severity: rule.severity,
              suggestion: rule.fixSuggestion
            });
          } else {
            result.warnings.push({
              file: filePath,
              type: rule.ruleType,
              message: checkResult.message,
              suggestion: rule.fixSuggestion
            });
          }
        }
        
        // Increment rule usage
        await rule.incrementUsage();
      }

      // Verify against README requirements
      const readmeCheck = await this.verifyAgainstReadme(filePath, fileContent, readmeContent);
      if (!readmeCheck.passed) {
        result.status = 'failed';
        result.errors.push(...readmeCheck.errors);
      }
      result.warnings.push(...readmeCheck.warnings);

    } catch (error) {
      logger.error(`Failed to verify file ${filePath}:`, error);
      result.status = 'failed';
      result.errors.push({
        file: filePath,
        type: 'verification_error',
        message: `Verification failed: ${error.message}`,
        severity: 'error'
      });
    }

    return result;
  }

  /**
   * Verify Dockerfile
   */
  async verifyDockerfile(deploymentId, filePath, expectedConfig) {
    const result = {
      file: filePath,
      status: 'passed',
      errors: [],
      warnings: []
    };

    // Read file using Cursor (no LLM call)
    const file = await cursorIntegration.readFile(deploymentId, filePath);
    if (!file || !file.exists) {
      result.status = 'failed';
      result.errors.push({
        file: filePath,
        type: 'file_not_found',
        message: 'Dockerfile not found',
        severity: 'error'
      });
      return result;
    }

    const content = file.content;

    // Check entry point
    if (expectedConfig.entryPoint) {
      const entryPointMatch = content.includes(expectedConfig.entryPoint) || 
                              content.includes(`CMD ["node", "${expectedConfig.entryPoint}"]`) ||
                              content.includes(`CMD node ${expectedConfig.entryPoint}`);
      if (!entryPointMatch) {
        result.errors.push({
          file: filePath,
          type: 'entry_point_mismatch',
          message: `Entry point mismatch. Expected: ${expectedConfig.entryPoint}`,
          severity: 'error',
          suggestion: `Update CMD to use: ${expectedConfig.entryPoint}`
        });
        result.status = 'failed';
      }
    }

    // Check port
    if (expectedConfig.port) {
      const portMatch = content.includes(`EXPOSE ${expectedConfig.port}`) ||
                        content.includes(`PORT=${expectedConfig.port}`);
      if (!portMatch) {
        result.warnings.push({
          file: filePath,
          type: 'port_mismatch',
          message: `Port ${expectedConfig.port} not found in EXPOSE directive`,
          suggestion: `Add: EXPOSE ${expectedConfig.port}`
        });
      }
    }

    // Check for common issues
    if (content.includes('RUN npm install') && !content.includes('--only=production')) {
      result.warnings.push({
        file: filePath,
        type: 'best_practice',
        message: 'Consider using npm ci --only=production for production builds',
        suggestion: 'Replace npm install with npm ci --only=production'
      });
    }

    return result;
  }

  /**
   * Verify docker-compose.yml
   */
  async verifyDockerCompose(deploymentId, filePath, expectedServices) {
    const result = {
      file: filePath,
      status: 'passed',
      errors: [],
      warnings: []
    };

    // Read file using Cursor
    const file = await cursorIntegration.readFile(deploymentId, filePath);
    if (!file || !file.exists) {
      result.status = 'failed';
      result.errors.push({
        file: filePath,
        type: 'file_not_found',
        message: 'docker-compose.yml not found',
        severity: 'error'
      });
      return result;
    }

    const content = file.content;

    // Check for correct build contexts
    for (const service of expectedServices) {
      const serviceName = service.name;
      const expectedContext = service.buildContext || `./${serviceName}`;
      
      // Check if service is defined
      if (!content.includes(`${serviceName}:`)) {
        result.errors.push({
          file: filePath,
          type: 'service_missing',
          message: `Service ${serviceName} not found in docker-compose.yml`,
          severity: 'error'
        });
        result.status = 'failed';
        continue;
      }

      // Check build context
      const contextPattern = new RegExp(`${serviceName}:\\s*[\\s\\S]*?context:\\s*([^\\n]+)`, 'i');
      const match = content.match(contextPattern);
      if (match) {
        const actualContext = match[1].trim().replace(/['"]/g, '');
        if (actualContext !== expectedContext) {
          result.errors.push({
            file: filePath,
            type: 'build_context_mismatch',
            message: `Service ${serviceName} has incorrect build context. Expected: ${expectedContext}, Found: ${actualContext}`,
            severity: 'error',
            suggestion: `Update build context to: ${expectedContext}`
          });
          result.status = 'failed';
        }
      }
    }

    return result;
  }

  /**
   * Run verification commands
   */
  async runVerificationCommands(deploymentId, uploadedFiles) {
    const results = {
      passed: [],
      failed: [],
      warnings: []
    };

    try {
      // Check for docker-compose.yml
      const composeFile = uploadedFiles.find(f => 
        f.path.includes('docker-compose.yml') || f.path.includes('docker-compose.yaml')
      );

      if (composeFile) {
        // Validate docker-compose syntax
        try {
          const commandResult = await cliExecutor.executeDeployment(
            deploymentId,
            `docker-compose -f ${composeFile.path} config`,
            { timeout: 30000 }
          );

          if (commandResult.exitCode === 0) {
            results.passed.push({
              command: 'docker-compose config',
              message: 'docker-compose.yml syntax is valid'
            });
          } else {
            results.failed.push({
              command: 'docker-compose config',
              error: commandResult.stderr || 'Syntax validation failed',
              output: commandResult.stdout
            });
          }
        } catch (error) {
          results.warnings.push({
            command: 'docker-compose config',
            message: `Could not validate docker-compose.yml: ${error.message}`
          });
        }
      }

      // Check Dockerfiles (if filePath is a Dockerfile)
      if (filePath.includes('Dockerfile')) {
        try {
          // Read file content to check syntax
          const fileContent = await fileDetectionService.readFileContent(deploymentId, filePath, 100);
          const content = fileContent.content;
          
          if (!content.includes('FROM')) {
            results.failed.push({
              command: 'dockerfile-lint',
              file: filePath,
              error: 'Dockerfile missing FROM directive'
            });
          }

          if (content.includes('RUN npm install') && !content.includes('--only=production')) {
            results.warnings.push({
              command: 'dockerfile-lint',
              file: filePath,
              message: 'Consider using npm ci --only=production for production builds'
            });
          }
        } catch (error) {
          results.warnings.push({
            command: 'dockerfile-lint',
            file: filePath,
            message: `Could not read Dockerfile for linting: ${error.message}`
          });
        }
      }

    } catch (error) {
      logger.error('Failed to run verification commands:', error);
      results.warnings.push({
        command: 'verification',
        message: `Verification commands failed: ${error.message}`
      });
    }

    return results;
  }

  /**
   * Run verification commands (legacy method with uploaded files)
   */
  async runVerificationCommands(deploymentId, uploadedFiles) {
    const results = {
      passed: [],
      failed: [],
      warnings: []
    };

    try {
      // Check for docker-compose.yml
      const composeFile = uploadedFiles.find(f => 
        f.path.includes('docker-compose.yml') || f.path.includes('docker-compose.yaml')
      );

      if (composeFile) {
        // Use terminal command to verify
        const commandResults = await this.runVerificationCommandsForFile(deploymentId, composeFile.path);
        results.passed.push(...commandResults.passed);
        results.failed.push(...commandResults.failed);
        results.warnings.push(...commandResults.warnings);
      }

      // Check Dockerfiles
      const dockerfiles = uploadedFiles.filter(f => 
        f.path.includes('Dockerfile')
      );

      for (const dockerfile of dockerfiles) {
        // Basic syntax check - look for common issues
        const content = dockerfile.content;
        
        if (!content.includes('FROM')) {
          results.failed.push({
            command: 'dockerfile-lint',
            file: dockerfile.path,
            error: 'Dockerfile missing FROM directive'
          });
        }

        if (content.includes('RUN npm install') && !content.includes('--only=production')) {
          results.warnings.push({
            command: 'dockerfile-lint',
            file: dockerfile.path,
            message: 'Consider using npm ci --only=production for production builds'
          });
        }
      }
    } catch (error) {
      logger.error('Failed to run verification commands:', error);
      results.warnings.push({
        command: 'verification',
        message: `Verification commands failed: ${error.message}`
      });
    }

    return results;
  }

  /**
   * Verify file against README requirements
   */
  async verifyAgainstReadme(filePath, fileContent, readmeContent) {
    const result = {
      passed: true,
      errors: [],
      warnings: []
    };

    // Extract requirements from README
    const requirements = this.extractRequirementsFromReadme(readmeContent, filePath);
    
    // Verify each requirement
    for (const requirement of requirements) {
      const check = this.checkRequirement(fileContent, requirement);
      if (!check.passed) {
        result.passed = false;
        result.errors.push({
          file: filePath,
          type: 'readme_requirement',
          message: check.message,
          severity: 'error',
          requirement: requirement.description
        });
      }
    }

    return result;
  }

  /**
   * Extract requirements from README for a specific file
   */
  extractRequirementsFromReadme(readmeContent, filePath) {
    const requirements = [];
    
    // Simple extraction - look for file-specific sections
    const fileType = this.detectFileType(filePath);
    const lines = readmeContent.split('\n');
    
    let inFileSection = false;
    let currentRequirement = null;
    
    for (const line of lines) {
      if (line.includes(fileType) || line.includes(filePath)) {
        inFileSection = true;
        continue;
      }
      
      if (inFileSection) {
        if (line.match(/^###?\s+/)) {
          // New section, save previous requirement
          if (currentRequirement) {
            requirements.push(currentRequirement);
          }
          currentRequirement = {
            type: line.replace(/^###?\s+/, '').toLowerCase(),
            description: line,
            checks: []
          };
        } else if (line.match(/^-\s+/) && currentRequirement) {
          currentRequirement.checks.push(line.replace(/^-\s+/, ''));
        }
      }
    }
    
    if (currentRequirement) {
      requirements.push(currentRequirement);
    }
    
    return requirements;
  }

  /**
   * Check if file content meets a requirement
   */
  checkRequirement(content, requirement) {
    // Simple pattern matching
    for (const check of requirement.checks || []) {
      if (check.includes('port')) {
        const portMatch = check.match(/(\d+)/);
        if (portMatch && !content.includes(portMatch[1])) {
          return {
            passed: false,
            message: `Requirement not met: ${check}`
          };
        }
      }
      
      if (check.includes('entry point') || check.includes('entrypoint')) {
        // Check for CMD or ENTRYPOINT
        if (!content.includes('CMD') && !content.includes('ENTRYPOINT')) {
          return {
            passed: false,
            message: `Requirement not met: ${check}`
          };
        }
      }
    }
    
    return { passed: true };
  }

  /**
   * Detect file type from path
   */
  detectFileType(filePath) {
    if (filePath.includes('Dockerfile')) {
      return 'dockerfile';
    }
    if (filePath.includes('docker-compose')) {
      return 'docker-compose';
    }
    return 'other';
  }

  /**
   * Get verification rules for file type
   */
  async getVerificationRules(fileType) {
    const cacheKey = fileType;
    
    if (this.ruleCache.has(cacheKey)) {
      return this.ruleCache.get(cacheKey);
    }
    
    const rules = await VerificationRule.find({
      fileType,
      enabled: true
    }).sort({ severity: 1 }); // Errors first
    
    this.ruleCache.set(cacheKey, rules);
    return rules;
  }

  /**
   * Apply a verification rule
   */
  async applyRule(rule, content, filePath, deploymentId) {
    if (rule.command) {
      // Command-based verification
      try {
        const result = await cliExecutor.executeDeployment(
          deploymentId,
          rule.command.replace('{file}', filePath),
          { timeout: 30000 }
        );
        
        if (rule.expectedResult) {
          const matches = this.compareResult(result.stdout, rule.expectedResult);
          return {
            passed: matches,
            message: matches ? 'Rule passed' : 'Rule failed'
          };
        }
        
        return {
          passed: result.exitCode === 0,
          message: result.exitCode === 0 ? 'Command passed' : result.stderr
        };
      } catch (error) {
        return {
          passed: false,
          message: `Command execution failed: ${error.message}`
        };
      }
    } else {
      // Pattern-based verification
      const matches = rule.matches(content);
      return {
        passed: matches,
        message: matches ? 'Pattern matched' : 'Pattern not found'
      };
    }
  }

  /**
   * Compare command result with expected result
   */
  compareResult(actual, expected) {
    if (typeof expected === 'string') {
      return actual.includes(expected);
    }
    if (expected instanceof RegExp) {
      return expected.test(actual);
    }
    return false;
  }

  /**
   * Generate verification report
   */
  generateVerificationReport(verificationResults) {
    const report = {
      summary: {
        status: verificationResults.status,
        totalFiles: Object.keys(verificationResults.details || {}).length,
        errors: verificationResults.errors.length,
        warnings: verificationResults.warnings.length,
        passed: verificationResults.status === 'passed'
      },
      files: verificationResults.details || {},
      errors: verificationResults.errors,
      warnings: verificationResults.warnings,
      commandResults: verificationResults.commandResults
    };

    return report;
  }
}

module.exports = new FileVerificationService();

