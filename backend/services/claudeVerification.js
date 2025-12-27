const logger = require('../utils/logger');
const claudeService = require('./claude');
const { STAGES } = require('./pipelineOrchestrator');

/**
 * Claude Verification Service
 * Uses Claude AI to verify each deployment stage before proceeding
 */

class ClaudeVerificationService {
  constructor() {
    this.verificationPrompts = this.initializePrompts();
  }

  /**
   * Initialize stage-specific verification prompts
   */
  initializePrompts() {
    return {
      [STAGES.ANALYZE]: {
        systemPrompt: `You are a deployment verification assistant. Analyze the project analysis results and determine if the project is ready for deployment.

Check for:
1. Is the project type correctly detected?
2. Are all services identified?
3. Are critical files missing that would block deployment?
4. Is environment configuration available or needed?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "summary": string }`,
        userPromptTemplate: (data) => `
Project Analysis Results:
- Project Type: ${JSON.stringify(data.projectType)}
- Framework: ${data.framework}
- Services Detected: ${JSON.stringify(data.services)}
- Missing Files: ${JSON.stringify(data.missingFiles)}
- Environment Status: ${JSON.stringify(data.envStatus)}

Should we proceed to collect environment variables and generate infrastructure files?`
      },

      [STAGES.COLLECT_ENV]: {
        systemPrompt: `You are verifying environment variable configuration for deployment.

Check for:
1. Are all required variables present?
2. Are there any obvious security issues (exposed secrets, weak values)?
3. Are database connections properly configured?
4. Are API keys and tokens present for required services?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "summary": string }`,
        userPromptTemplate: (data) => `
Environment Status:
- Source: ${data.source}
- Variable Count: ${data.variableCount}
- Variables: ${JSON.stringify(data.variables?.map(v => ({ key: v.key, hasValue: v.hasValue, isSecret: v.isSecret })))}

Is the environment configuration sufficient to proceed with file generation?`
      },

      [STAGES.GENERATE_FILES]: {
        systemPrompt: `You are reviewing auto-generated infrastructure files before they are written to disk.

For each file, check:
1. Dockerfile: Correct base image? Proper build steps? Security best practices?
2. docker-compose.yml: Services properly defined? Networks/volumes correct?
3. GitHub workflow: Proper build and deploy steps?
4. Terraform: Valid configuration? Correct resources?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "fileReviews": [{ "file": string, "approved": boolean, "comments": string }], "summary": string }`,
        userPromptTemplate: (data) => `
Generated Files for Review:

${data.files.map(f => `
=== ${f.path} (${f.type}) ===
${f.isNew ? '(New File)' : '(Existing - Will Modify)'}

Preview:
${f.preview}
`).join('\n')}

Should these files be written to disk?`
      },

      [STAGES.VERIFY_GENERATION]: {
        systemPrompt: `You are confirming that generated files were successfully written to disk.

Check:
1. Were all files written successfully?
2. Were any errors encountered?
3. Are backups created for modified files?

Respond with JSON: { "approved": boolean, "issues": [], "summary": string }`,
        userPromptTemplate: (data) => `
File Write Results:
${JSON.stringify(data.writtenFiles, null, 2)}

Were all files written successfully? Can we proceed to build?`
      },

      [STAGES.LOCAL_BUILD]: {
        systemPrompt: `You are analyzing Docker build results to determine if builds succeeded.

Check:
1. Did all service builds complete successfully?
2. Are there any build errors or warnings?
3. Were images created with correct tags?
4. Any performance concerns (large image sizes)?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "summary": string }`,
        userPromptTemplate: (data) => `
Build Results:
${data.builds.map(b => `
Service: ${b.service}
Success: ${b.success}
Image ID: ${b.imageId || 'N/A'}
Has Errors: ${b.hasErrors}
`).join('\n')}

Are the builds successful enough to proceed to local testing?`
      },

      [STAGES.LOCAL_TEST]: {
        systemPrompt: `You are verifying local Docker test results.

Check:
1. Are all containers running?
2. Are health checks passing?
3. Are services communicating correctly?
4. Any startup errors or warnings?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "summary": string }`,
        userPromptTemplate: (data) => `
Local Test Results:

Health Checks:
${JSON.stringify(data.healthChecks, null, 2)}

Compose Logs (truncated):
${data.composeLogs}

Are services running correctly for log analysis?`
      },

      [STAGES.ANALYZE_LOGS]: {
        systemPrompt: `You are the final log analyst before production deployment.

Carefully check:
1. Are there any ERROR or FATAL level logs?
2. Are there connection failures to databases or services?
3. Are there unhandled exceptions or crashes?
4. Are there resource exhaustion warnings (memory, connections)?

IMPORTANT: Only approve if logs show healthy operation. Any critical errors should block deployment.

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "blockingIssues": [], "summary": string }`,
        userPromptTemplate: (data) => `
Log Analysis Results:

${data.analyses.map(a => `
Type: ${a.type}
Service: ${a.service || 'N/A'}
Has Errors: ${a.hasErrors}
Has Critical: ${a.hasCritical}
Can Proceed: ${a.canProceed}
Summary: ${a.summary}
Errors: ${JSON.stringify(a.errors?.slice(0, 5))}
`).join('\n')}

Based on these logs, is it safe to proceed to production infrastructure provisioning?`
      },

      [STAGES.PROVISION_INFRA]: {
        systemPrompt: `You are verifying Terraform infrastructure provisioning results.

Check:
1. Were all resources created successfully?
2. Are security groups properly configured?
3. Is the instance accessible (has public IP)?
4. Are there any infrastructure warnings?

Respond with JSON: { "approved": boolean, "issues": [], "suggestions": [], "summary": string }`,
        userPromptTemplate: (data) => `
Infrastructure Provisioning Results:

Resources:
${JSON.stringify(data.resources, null, 2)}

Outputs:
${JSON.stringify(data.outputs, null, 2)}

Is the infrastructure ready for deployment?`
      },

      [STAGES.DEPLOY_PRODUCTION]: {
        systemPrompt: `You are verifying production deployment results.

Check:
1. Were all services deployed successfully?
2. Is the application accessible at the deployment URL?
3. Are all expected services running?

Respond with JSON: { "approved": boolean, "issues": [], "summary": string }`,
        userPromptTemplate: (data) => `
Deployment Results:

Services Deployed:
${JSON.stringify(data.services, null, 2)}

Deployment URL: ${data.url}

Is the deployment successful? Should we proceed to health checks?`
      },

      [STAGES.HEALTH_CHECK]: {
        systemPrompt: `You are performing final production health verification.

Check:
1. Is the main application responding?
2. Are all services healthy?
3. Is response time acceptable?

Respond with JSON: { "approved": boolean, "issues": [], "summary": string }`,
        userPromptTemplate: (data) => `
Production Health Check Results:

URL: ${data.url}
Overall Status: ${data.status}
Response Time: ${data.responseTime}ms

Service Health:
${JSON.stringify(data.checks, null, 2)}

Is the deployment healthy and complete?`
      }
    };
  }

  /**
   * Verify a stage result using Claude
   */
  async verifyStageResult(stage, stageResult, options = {}) {
    const promptConfig = this.verificationPrompts[stage];
    
    if (!promptConfig) {
      logger.warn(`No verification prompt for stage: ${stage}`);
      return {
        approved: true,
        issues: [],
        suggestions: [],
        summary: 'No verification configured for this stage',
        autoApproved: true
      };
    }

    try {
      const userPrompt = promptConfig.userPromptTemplate(stageResult.data || stageResult);

      logger.info(`Requesting Claude verification for stage: ${stage}`);

      const response = await claudeService.chat([
        { role: 'user', content: userPrompt }
      ], {
        systemPrompt: promptConfig.systemPrompt,
        maxTokens: 1024
      });

      // Parse Claude's JSON response
      const verification = this.parseVerificationResponse(response);
      
      logger.info(`Claude verification for ${stage}:`, { approved: verification.approved });

      return {
        ...verification,
        stage,
        verifiedAt: new Date().toISOString(),
        rawResponse: response
      };

    } catch (error) {
      logger.error(`Claude verification failed for ${stage}:`, error);
      
      // On API failure, return a cautious response
      return {
        approved: false,
        issues: [`Verification failed: ${error.message}`],
        suggestions: ['Manual review required'],
        summary: 'Claude verification failed - manual approval needed',
        error: error.message,
        stage
      };
    }
  }

  /**
   * Parse Claude's verification response
   */
  parseVerificationResponse(response) {
    try {
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          approved: parsed.approved === true,
          issues: parsed.issues || [],
          suggestions: parsed.suggestions || [],
          blockingIssues: parsed.blockingIssues || [],
          fileReviews: parsed.fileReviews || [],
          summary: parsed.summary || ''
        };
      }
    } catch (parseError) {
      logger.warn('Failed to parse JSON from Claude response:', parseError);
    }

    // Fallback: analyze text response
    const lowerResponse = response.toLowerCase();
    const approved = lowerResponse.includes('approved') && !lowerResponse.includes('not approved');
    
    return {
      approved,
      issues: [],
      suggestions: [],
      summary: response.substring(0, 200),
      parseWarning: 'Response was not valid JSON'
    };
  }

  /**
   * Get verification summary for a deployment
   */
  async generateDeploymentSummary(deploymentId, pipelineContext) {
    const prompt = `
Generate a deployment summary for the following deployment:

Deployment ID: ${deploymentId}
Services: ${JSON.stringify(pipelineContext.services)}
Environment: ${pipelineContext.envStatus?.collected ? 'Configured' : 'Missing'}
Files Generated: ${pipelineContext.generatedFiles?.length || 0}
Build Status: ${pipelineContext.buildResults?.every(b => b.success) ? 'All Passed' : 'Some Failed'}
Infrastructure: ${pipelineContext.infrastructure?.success ? 'Provisioned' : 'Not Provisioned'}
Deployment URL: ${pipelineContext.deploymentResult?.url || 'N/A'}

Provide a brief summary of:
1. What was deployed
2. Current status
3. Any recommendations

Keep it concise (2-3 sentences).
`;

    try {
      const summary = await claudeService.chat([
        { role: 'user', content: prompt }
      ], {
        maxTokens: 256
      });

      return summary;
    } catch (error) {
      logger.error('Failed to generate deployment summary:', error);
      return 'Deployment summary unavailable.';
    }
  }

  /**
   * Analyze error and suggest fixes
   */
  async analyzeErrorAndSuggestFix(stage, error, context) {
    const prompt = `
A deployment error occurred. Please analyze and suggest fixes.

Stage: ${stage}
Error: ${error}

Context:
${JSON.stringify(context, null, 2)}

Provide:
1. Root cause analysis
2. Specific fix suggestions
3. Commands or code changes if applicable

Respond with JSON: { "rootCause": string, "fixes": [{ "description": string, "command": string?, "codeChange": string? }], "severity": "low"|"medium"|"high"|"critical" }
`;

    try {
      const response = await claudeService.chat([
        { role: 'user', content: prompt }
      ], {
        maxTokens: 1024
      });

      return this.parseVerificationResponse(response);
    } catch (err) {
      logger.error('Failed to analyze error:', err);
      return {
        rootCause: 'Unable to analyze error',
        fixes: [],
        severity: 'unknown'
      };
    }
  }

  /**
   * Ask Claude to generate a specific file
   */
  async generateFile(fileType, projectContext) {
    const prompts = {
      dockerfile: `Generate a production-ready Dockerfile for this project:
${JSON.stringify(projectContext)}

Requirements:
- Multi-stage build if applicable
- Security best practices
- Minimal image size
- Health check if possible

Return ONLY the Dockerfile content, no explanations.`,

      'docker-compose': `Generate a docker-compose.yml for this project:
${JSON.stringify(projectContext)}

Requirements:
- All detected services
- Proper networking
- Volume mounts for persistence
- Environment variable substitution

Return ONLY the docker-compose.yml content, no explanations.`,

      workflow: `Generate a GitHub Actions workflow for CI/CD:
${JSON.stringify(projectContext)}

Requirements:
- Build and test on push
- Deploy on main branch merge
- Use secrets for sensitive data

Return ONLY the workflow YAML content, no explanations.`
    };

    const prompt = prompts[fileType];
    if (!prompt) {
      throw new Error(`Unknown file type: ${fileType}`);
    }

    try {
      const content = await claudeService.chat([
        { role: 'user', content: prompt }
      ], {
        maxTokens: 4096
      });

      // Clean up the response (remove markdown code blocks if present)
      let cleanContent = content;
      if (content.includes('```')) {
        const match = content.match(/```(?:dockerfile|yaml|yml)?\n?([\s\S]*?)```/);
        if (match) {
          cleanContent = match[1].trim();
        }
      }

      return cleanContent;
    } catch (error) {
      logger.error(`Failed to generate ${fileType}:`, error);
      throw error;
    }
  }

  /**
   * Interactive clarification - ask user specific questions
   */
  async generateClarificationQuestions(stage, context) {
    const prompt = `
Based on the current deployment stage and context, generate clarification questions for the user.

Stage: ${stage}
Context: ${JSON.stringify(context)}

Generate 1-3 specific questions that would help proceed with the deployment.
Questions should be yes/no or short answer format.

Respond with JSON: { "questions": [{ "id": string, "question": string, "type": "yes_no"|"choice"|"text", "options": string[]? }] }
`;

    try {
      const response = await claudeService.chat([
        { role: 'user', content: prompt }
      ], {
        maxTokens: 512
      });

      return this.parseVerificationResponse(response);
    } catch (error) {
      logger.error('Failed to generate clarification questions:', error);
      return { questions: [] };
    }
  }
}

// Export singleton
const claudeVerification = new ClaudeVerificationService();

module.exports = {
  claudeVerification,
  ClaudeVerificationService
};


