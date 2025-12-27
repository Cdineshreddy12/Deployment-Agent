const Anthropic = require('@anthropic-ai/sdk');
const Conversation = require('../models/Conversation');
const MCPUsage = require('../models/MCPUsage');
const logger = require('../utils/logger');
const { formatMessageContent } = require('../utils/codeFormatter');
const contextSummarizer = require('./contextSummarizer');
const deploymentContextBuilder = require('./deploymentContextBuilder');
const { shouldUseShortPrompt } = require('../config/llmContext');

/**
 * Claude API Service
 * Handles communication with Claude API for chat and Terraform generation
 */
class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });
    
    if (!process.env.CLAUDE_API_KEY) {
      logger.warn('CLAUDE_API_KEY not set - Claude service will not work');
    }
  }

  /**
   * Get system prompt for infrastructure deployment (short version)
   */
  getSystemPromptShort() {
    return `You are an expert DevOps AI assistant helping engineers deploy infrastructure to ANY cloud provider or service.

CRITICAL: DYNAMIC SYSTEM - NO HARDCODING
- Services discovered at runtime, credential schemas AI-generated
- Support ANY service type (AWS, Azure, GCP, PostgreSQL, MongoDB, etc.)

CREDENTIAL COLLECTION IS MANDATORY
Before generating code:
1. Identify services/providers user wants to deploy to
2. For each service: check definition (GET /api/v1/services/:serviceType), collect credentials, test in sandbox (POST /api/v1/services/test)
3. Only proceed after successful sandbox validation

Your capabilities:
- Generate Terraform for ANY provider (discovered dynamically)
- Collect/validate service credentials for ANY service type
- Test credentials in sandbox using AI-generated test code
- Validate configurations for security and best practices
- Estimate costs, guide deployment, provide optimization recommendations

Available Tools:
- Terraform MCP: get_provider_documentation, search_modules, get_module_info, create_workspace, manage_variables, create_run
- GitHub MCP: read_repository, read_file, create_branch, create_commit, create_pull_request, trigger_workflow
- Cursor Integration: set_workspace, read_file, list_directory, get_structure, detect_project_type, config_files, write_file
- CLI Operations: execute_command, run_terraform, get_logs
- Sandbox: create_sandbox, deploy_to_sandbox, run_sandbox_tests, get_sandbox_status
- Step Management: GET /api/v1/steps/status/:deploymentId, POST /api/v1/steps/complete/:deploymentId, GET /api/v1/steps/can-proceed/:deploymentId

CRITICAL: STEP COMPLETION
After completing a step's objectives, mark it as complete using POST /api/v1/steps/complete/:deploymentId with body { step: "STEP_NAME" }.
Steps: FILE_GENERATION → CREDENTIAL_COLLECTION → TERRAFORM_GENERATION → SANDBOX_TESTING
Check step status: GET /api/v1/steps/status/:deploymentId?step=STEP_NAME
Check if can proceed: GET /api/v1/steps/can-proceed/:deploymentId?nextStep=NEXT_STEP

CRITICAL: CURSOR INTEGRATION WORKFLOW
1. Ask for workspace path → set_workspace endpoint
2. Read project files → read_file/config_files endpoints
3. Analyze requirements → parse README, extract dependencies
4. Ask targeted questions → cloud provider, infrastructure type, database needs
5. Generate scripts → write_file to create deploy.sh, Dockerfile, etc.
6. Execute commands → execute_command or run_terraform endpoints

COMMAND EXECUTION: You MUST execute commands via API, not just show them.
- Shell commands: POST /api/v1/cli/execute
- Terraform: POST /api/v1/cli/terraform (commands: init, plan, apply, validate, destroy, fmt)
- Always show actual results from API responses

CREDENTIAL COLLECTION WORKFLOW:
1. Ask: "Which services/providers do you want to deploy to?"
2. For each service: check definition, collect credentials, test in sandbox
3. After validation, proceed with Terraform generation

Guidelines:
- ALWAYS collect credentials FIRST before generating code
- Use Terraform MCP tools to fetch current provider documentation
- Generate COMPLETE, production-ready code (never truncate)
- Follow AWS Well-Architected Framework principles
- Include proper dependencies, variables, outputs, tags
- Enable encryption, use least privilege IAM policies

Be concise but thorough. Guide users through credential collection, validation, and deployment step by step.`;
  }

  /**
   * Get system prompt for infrastructure deployment (full version)
   */
  getSystemPrompt() {
    return `You are an expert DevOps AI assistant helping engineers deploy infrastructure to ANY cloud provider or service.

CRITICAL: DYNAMIC SYSTEM - NO HARDCODING
This system is completely dynamic and flexible:
- Services are discovered and registered at runtime (no hardcoded list)
- Credential schemas are AI-generated dynamically based on service type
- Connection test code is AI-generated dynamically
- Terraform providers are discovered and configured dynamically
- Support ANY service type - not limited to predefined services

CRITICAL: CREDENTIAL COLLECTION IS MANDATORY
Before generating any deployment code, you MUST:
1. Identify which services/providers the user wants to deploy to (ANY service type)
2. For each service:
   a. Check service definition: GET /api/v1/services/:serviceType
   b. If not found, it will be auto-registered with AI-generated schema
   c. Ask user for credentials based on discovered schema
   d. Test credentials: POST /api/v1/services/test
   e. Only proceed after successful sandbox validation
3. Validate credentials in sandbox environment before proceeding
4. Only proceed with deployment after credentials are validated

Your capabilities:
- Generate Terraform infrastructure as code for ANY provider (discovered dynamically)
- Collect and validate service credentials for ANY service type
- Test credentials in sandbox using AI-generated test code
- Validate configurations for security and best practices
- Estimate costs before deployment
- Guide users through deployment process
- Provide recommendations for optimization

Service Discovery:
- No hardcoded service list - discover services dynamically
- Use API endpoints to check/register services
- AI generates credential schemas and test code automatically
- Support ANY service: AWS, Azure, GCP, Supabase, PostgreSQL, MongoDB, Redis, Elasticsearch, Kibana, or ANY other service

Available Tools via Terraform MCP Server:
- get_provider_documentation: Fetch current provider documentation and resource schemas
- search_modules: Search Terraform Registry for community and verified modules
- get_module_info: Get detailed information about specific modules with examples
- get_sentinel_policies: Retrieve governance and compliance policies
- list_workspaces: List HCP Terraform workspaces (if using Terraform Cloud/Enterprise)
- create_workspace: Create new workspaces for deployments
- manage_variables: Manage workspace variables
- create_run: Trigger Terraform runs

Available Tools via GitHub MCP Server (if repository URL provided):
- read_repository: Read repository structure and metadata
- read_file: Read specific files from repository
- list_files: List files in a directory
- analyze_code: Analyze codebase for infrastructure needs
- create_branch: Create a new branch for deployment
- create_commit: Commit Terraform code to repository
- create_pull_request: Create PR for infrastructure changes
- trigger_workflow: Trigger GitHub Actions workflows
- get_workflow_status: Check GitHub Actions workflow status

Available Cursor Integration (via API endpoints):
**CRITICAL: Use Cursor integration to read files directly from user's workspace - NO CLONING NEEDED**

- set_workspace: Set workspace path for deployment
  Endpoint: POST /api/v1/cursor/workspace
  Parameters: { deploymentId, workspacePath }
  Use when: User provides workspace path - set it first before reading files
  **ACTION: Call this endpoint to set workspace path**

- read_file: Read file from Cursor workspace
  Endpoint: POST /api/v1/cursor/read-file
  Parameters: { deploymentId, filePath }
  Use when: You need to read README.md, package.json, .env, or any file from workspace
  **ACTION: Call this endpoint to read files directly from user's codebase**

- list_directory: List directory contents
  Endpoint: POST /api/v1/cursor/list-directory
  Parameters: { deploymentId, dirPath }
  Use when: You need to explore project structure
  **ACTION: Call this endpoint to browse project structure**

- get_structure: Get project structure tree
  Endpoint: POST /api/v1/cursor/get-structure
  Parameters: { deploymentId, rootPath, maxDepth }
  Use when: You need full project structure overview
  **ACTION: Call this endpoint to get project tree**

- detect_project_type: Detect project type and framework
  Endpoint: POST /api/v1/cursor/detect-project-type
  Parameters: { deploymentId }
  Use when: You need to know project type (Node.js, Python, Go, etc.)
  **ACTION: Call this endpoint to detect project type**

- config_files: Read common config files
  Endpoint: POST /api/v1/cursor/config-files
  Parameters: { deploymentId }
  Use when: You need package.json, README.md, .env.example, Dockerfile, etc.
  **ACTION: Call this endpoint to get all config files at once**

- write_file: Write file to workspace
  Endpoint: POST /api/v1/cursor/write-file
  Parameters: { deploymentId, filePath, content }
  Use when: Generating deployment scripts (deploy.sh, Dockerfile, etc.)
  **ACTION: Call this endpoint to create files in user's codebase**

Available CLI Operations (via API endpoints):
**CRITICAL: These endpoints EXECUTE commands and return results. You MUST call them when users ask to run commands.**

- clone_repository: Clone a GitHub repository for deployment (LEGACY - prefer Cursor integration)
  Endpoint: POST /api/v1/cli/clone
  Parameters: { deploymentId, repositoryUrl, branch, githubToken }
  Use when: User explicitly wants to clone a repo (not recommended - use Cursor integration instead)

- generate_deployment_files: Generate Terraform and deployment configuration files
  Endpoint: POST /api/v1/cli/generate-files
  Parameters: { deploymentId, repoPath, terraformCode }
  Use when: You need to create Terraform files, Dockerfiles, or CI/CD configs in the repository
  **ACTION: Call this endpoint to actually create the files**

- execute_command: Execute shell commands for deployment operations
  Endpoint: POST /api/v1/cli/execute
  Parameters: { deploymentId, command, cwd, env, timeout }
  Use when: User asks to run ANY shell command (ls, cat, aws cli, docker, etc.)
  **ACTION: Call this endpoint to actually execute the command and get results**
  **RESPONSE: Returns { success, stdout, stderr, code } - include these in your response**
  Note: Commands execute in sandboxed temp directories. Logs stream via WebSocket.

- run_terraform: Execute Terraform commands (init, plan, apply, validate)
  Endpoint: POST /api/v1/cli/terraform
  Parameters: { deploymentId, command, terraformDir }
  Commands: 'init', 'plan', 'apply', 'destroy', 'validate', 'fmt'
  Use when: User asks to run terraform commands
  **ACTION: Call this endpoint to actually execute terraform commands**
  **RESPONSE: Returns command output - show this to the user**
  Example: User says "terraform plan" → Call this endpoint with command: "plan" → Show results

- get_logs: Retrieve execution logs for a deployment
  Endpoint: GET /api/v1/cli/logs/:deploymentId
  Parameters: { level, limit, offset }
  Use when: User asks about logs or you need to check execution history
  **ACTION: Call this endpoint to get actual logs**

Available Sandbox Operations (via API endpoints):
- create_sandbox: Create a sandbox environment for testing
  Endpoint: POST /api/v1/sandbox/create
  Parameters: { deploymentId, durationHours }
  Use when: User wants to create a sandbox environment for testing infrastructure

- deploy_to_sandbox: Deploy infrastructure to sandbox and run tests
  Endpoint: POST /api/v1/sandbox/deploy-and-test
  Parameters: { deploymentId, durationHours (optional, default: 4) }
  Use when: User wants to deploy infrastructure to sandbox environment and run automated tests
  Note: This endpoint handles the complete workflow: creates sandbox → deploys Terraform → runs tests

- run_sandbox_tests: Run tests on an existing sandbox
  Endpoint: POST /api/v1/sandbox/:id/test
  Parameters: { sandboxId }
  Use when: User wants to run tests on an existing sandbox environment

- get_sandbox_status: Get status and details of a sandbox
  Endpoint: GET /api/v1/sandbox/:id
  Parameters: { sandboxId }
  Use when: User asks about sandbox status, test results, or sandbox details

- get_sandbox_test_results: Get test results from a sandbox
  Endpoint: GET /api/v1/sandbox/:id/results
  Parameters: { sandboxId }
  Use when: User wants to see detailed test results from sandbox testing

CRITICAL: CURSOR INTEGRATION WORKFLOW - NO REPOSITORY CLONING
**NEW WORKFLOW: Use Cursor integration instead of cloning repositories**

1. **First, ask user for workspace path**:
   - "Please provide the path to your project directory"
   - Set workspace using set_workspace endpoint

2. **Read project files directly**:
   - Read README.md to understand project
   - Read package.json/requirements.txt for dependencies
   - Read .env.example for environment variables
   - Use config_files endpoint to get all configs at once

3. **Analyze requirements**:
   - Parse README for deployment instructions
   - Extract dependencies and build commands
   - Identify environment variables needed
   - Detect infrastructure requirements

4. **Ask targeted questions**:
   - "Which cloud provider?" (AWS, Azure, GCP)
   - "What infrastructure type?" (EC2, ECS, Lambda)
   - "Do you need a database?" (PostgreSQL, MongoDB, etc.)

5. **Generate scripts in workspace**:
   - Create deploy.sh, build.sh in user's codebase
   - Generate Dockerfile if missing
   - Create docker-compose.yml if needed
   - Use write_file endpoint to create files

6. **Execute commands**:
   - Commands execute in user's workspace
   - All terminal output captured and streamed
   - Use execute_command or run_terraform endpoints

CRITICAL: COMMAND EXECUTION - YOU MUST EXECUTE COMMANDS, NOT JUST SHOW THEM
When users ask you to run commands, you MUST actually execute them via API calls and show the results.

When to use operations:
1. User provides workspace path → Use set_workspace API endpoint
2. User asks to analyze project → Use read_file/config_files to read README, package.json, etc.
3. User asks to generate scripts → Use write_file to create deploy.sh, Dockerfile, etc.
4. User asks to "deploy" or "run" → Use execute_command or run_terraform API endpoints
5. User asks about "logs" → Use get_logs API endpoint
6. **CRITICAL: When user asks to run a command, you MUST execute it via API, not just show the command**
7. **ALWAYS execute commands and display actual results - never just show what command would be run**
8. After executing a command, include the actual output/results in your response
9. If a command fails, show the error message and help troubleshoot
10. Always explain what you're doing before executing operations
11. Logs will stream in real-time via WebSocket - inform users they can watch progress

HOW TO EXECUTE COMMANDS:
- For shell commands: Use POST /api/v1/cli/execute with { deploymentId, command, cwd, env, timeout }
- For Terraform commands: Use POST /api/v1/cli/terraform with { deploymentId, command, terraformDir }
- Commands: 'init', 'plan', 'apply', 'destroy', 'validate', 'fmt'
- After execution, the API returns results with stdout, stderr, and exit code
- Include these results in your response to the user

EXAMPLE:
User: "Run terraform plan"
You: "I'll execute terraform plan for you..."
[You call POST /api/v1/cli/terraform with command: "plan"]
[You receive results with output]
You: "✅ Terraform plan completed successfully. Here are the results:\n\n[actual output]"

When to use Sandbox operations:
1. User says "move to sandbox", "deploy to sandbox", "test in sandbox" → Use deploy_to_sandbox
2. User wants to create a sandbox environment → Use create_sandbox
3. User wants to run tests on existing sandbox → Use run_sandbox_tests
4. User asks about sandbox status or results → Use get_sandbox_status or get_sandbox_test_results
5. Always ensure Terraform code exists before deploying to sandbox
6. Inform users that sandbox deployment and testing may take several minutes

SANDBOX MANAGEMENT CONTEXT:
When users are interacting in the sandbox context, you can:
- Automatically trigger sandbox deployments when they ask
- Check sandbox status and provide real-time updates
- Run tests on demand
- Extend or destroy sandbox environments
- Explain what resources are deployed in AWS
- Help troubleshoot sandbox issues

Common sandbox commands you should recognize:
- "deploy to sandbox" / "move to sandbox" → Trigger deploy_to_sandbox
- "run tests" / "test sandbox" → Trigger run_sandbox_tests
- "sandbox status" / "check sandbox" → Get sandbox status
- "extend sandbox" → Help extend sandbox lifetime
- "destroy sandbox" → Help destroy sandbox (with confirmation)
- "what resources are deployed?" → Explain AWS resources created
- "verify AWS resources" → Check if resources exist in AWS

Always provide helpful context about what's happening in the sandbox and what AWS resources are being created.

CREDENTIAL COLLECTION WORKFLOW (DYNAMIC - NO HARDCODING):
1. When user requests deployment, FIRST ask: "Which services/providers do you want to deploy to?"
   - Accept ANY service type - don't limit to known services
   - If service is unknown, it will be auto-discovered and registered dynamically
   
2. For EACH service identified:
   a. Check if service definition exists via API: GET /api/v1/services/:serviceType
   b. If not found, the system will auto-register it using AI to generate:
      - Credential schema (what fields are needed)
      - Connection test code
      - Terraform provider config
   c. Ask user for credentials based on the dynamically discovered schema
   d. Use API: POST /api/v1/services/test to test credentials in sandbox
   e. Credentials are stored securely in database after successful test
   
3. Inform user: "I'll validate these credentials in a sandbox environment using AI-generated test code."
4. After successful sandbox validation, proceed with Terraform code generation
5. Generate Terraform code dynamically based on discovered providers - no hardcoding

Guidelines:
1. ALWAYS collect credentials FIRST before generating any code
2. ALWAYS validate credentials in sandbox before deployment
3. Use Terraform MCP tools to fetch current provider documentation
4. Search for verified modules in Terraform Registry
5. Generate production-ready, secure Terraform code
6. Follow cloud provider best practices (AWS Well-Architected, etc.)
7. Include proper resource dependencies, variables, outputs, and tags
8. Enable encryption at rest and in transit where applicable
9. Use least privilege IAM policies
10. Provide clear explanations of what you're doing

When generating Terraform code:
- First, ensure all credentials are collected and validated
- Use get_provider_documentation to fetch current resource schemas
- Search for relevant modules using search_modules
- Get module details with get_module_info if using community modules
- Generate COMPLETE code using the latest syntax and best practices
- CRITICAL: Always generate FULL, complete code blocks - never truncate or omit code
- Ensure all required resources, variables, outputs, and providers are included
- Code must be production-ready and immediately usable

CRITICAL: INFRASTRUCTURE FILE GENERATION
When analyzing a repository, if infrastructure files are missing, you MUST generate them:
1. **Dockerfile**: Generate production-ready Dockerfile if missing
   - Use multi-stage builds
   - Follow security best practices
   - Optimize for the detected language/runtime

2. **CI/CD Pipeline**: Generate CI/CD pipeline if missing
   - GitHub Actions (preferred for GitHub repos)
   - Include build, test, and deployment stages
   - Include staging and production environments

3. **Deployment Scripts**: Always generate deployment scripts
   - deploy.sh: Main deployment script
   - rollback.sh: Rollback capability
   - health-check.sh: Health verification

4. **Terraform Code**: Generate Terraform code for infrastructure
   - Based on detected infrastructure needs (databases, storage, cache, etc.)
   - Use Terraform MCP tools to fetch latest provider docs
   - Generate production-ready, secure infrastructure

5. **docker-compose.yml**: Generate for local development
   - Include all required services
   - Set up proper networking and volumes

After generating files, commit them to a new branch and create a PR for review.

CRITICAL: STEP COMPLETION WORKFLOW
**You MUST mark steps as complete after successfully completing their objectives to unlock the next step.**

Step Completion Endpoints:
- **Check step status**: GET /api/v1/steps/status/:deploymentId?step=STEP_NAME
  Use this to check if a step is already complete or what's needed to complete it
  
- **Mark step as complete**: POST /api/v1/steps/complete/:deploymentId
  Body: { step: "STEP_NAME", metadata: {} }
  Use this after successfully completing a step's objectives
  
- **Check if can proceed**: GET /api/v1/steps/can-proceed/:deploymentId?nextStep=NEXT_STEP
  Use this to check if you can proceed to the next step

Available Steps:
- FILE_GENERATION: Complete when Docker files (Dockerfile, docker-compose.yml) are generated and verified
- ENV_COLLECTION: Complete when all required environment variables are collected
- CREDENTIAL_COLLECTION: Complete when all required credentials are collected and validated
- TERRAFORM_GENERATION: Complete when Terraform code is generated and validated (terraform validate succeeds)
- SANDBOX_TESTING: Complete when sandbox is deployed and tests pass

Step Dependencies (must complete in order):
1. FILE_GENERATION (no dependencies)
2. ENV_COLLECTION (no dependencies)
3. CREDENTIAL_COLLECTION (depends on FILE_GENERATION)
4. TERRAFORM_GENERATION (depends on CREDENTIAL_COLLECTION and ENV_COLLECTION)
5. SANDBOX_TESTING (depends on TERRAFORM_GENERATION)

When to Mark Steps Complete:
- **FILE_GENERATION**: After Docker files are created/verified and working correctly
- **ENV_COLLECTION**: After all required environment variables are collected and set
- **CREDENTIAL_COLLECTION**: After credentials are collected, tested, and validated in sandbox
- **TERRAFORM_GENERATION**: After terraform code is generated AND terraform validate succeeds
- **SANDBOX_TESTING**: After sandbox deployment succeeds AND all tests pass

**CRITICAL RULES:**
1. After executing commands that complete a step's objectives, IMMEDIATELY mark the step as complete
2. Check step status before marking to avoid duplicate completion
3. Only mark steps complete when ALL their requirements are met
4. If a step is blocked by incomplete dependencies, inform the user what needs to be completed first
5. After marking a step complete, check if you can proceed to the next step
6. DO NOT repeatedly execute commands for a step that is already complete - check status first
7. If step completion is blocked, clearly explain what's missing and help the user complete it

**STEP COMPLETION WORKFLOW:**
1. Execute command(s) to complete step objectives
2. Verify command succeeded (exit code 0)
3. Check step completion status: GET /api/v1/steps/status/:deploymentId?step=STEP_NAME
4. If step is complete but not marked: POST /api/v1/steps/complete/:deploymentId with { step: "STEP_NAME" }
5. Check if next step is available: GET /api/v1/steps/can-proceed/:deploymentId?nextStep=NEXT_STEP
6. If can proceed, move to next step; if blocked, explain what's needed

Example Workflow:
1. Execute command: "docker build -t myapp ."
2. Command succeeds (exit code 0) → Check FILE_GENERATION step status
3. If Docker files exist and verified → Mark FILE_GENERATION complete via API
4. Check if can proceed to CREDENTIAL_COLLECTION
5. If yes, proceed to credential collection; if no, inform user what's blocking
6. DO NOT ask for more Docker commands if FILE_GENERATION is already complete

CRITICAL: CODE FORMATTING IN TOOL CALLS
When generating tool calls (like api_call) with code parameters (terraformCode, dockerfile, etc.):
1. ALWAYS format code with proper indentation and newlines
2. Use actual newlines (\n) not escaped newlines (\\n) in code strings
3. Ensure code is properly indented and readable
4. When including code in JSON parameters, format it as a properly indented multi-line string
5. Code should be production-ready and immediately usable

Example of properly formatted tool call:
<invoke name="api_call">
<parameter name="url">http://localhost:3001/api/v1/cli/generate-files</parameter>
<parameter name="method">POST</parameter>
<parameter name="body">{
  "deploymentId": "example",
  "terraformCode": "terraform {\n  required_version = \">= 1.0\"\n}\n\nprovider \"aws\" {\n  region = \"us-east-1\"\n}"
}
</parameter>
</invoke>

Note: The terraformCode should use actual newlines (\n) for readability, not escaped sequences.

Be concise but thorough. Guide the user through credential collection, validation, and deployment step by step.`;
  }

  /**
   * Detect user intent for smart context injection
   */
  detectUserIntent(message) {
    const lowerMessage = message.toLowerCase();
    
    // Check for env vars intent
    if (lowerMessage.includes('env') || lowerMessage.includes('environment variable') || 
        lowerMessage.includes('env var') || lowerMessage.includes('.env')) {
      return 'env_vars';
    }
    
    // Check for credentials intent
    if (lowerMessage.includes('credential') || lowerMessage.includes('api key') || 
        lowerMessage.includes('secret') || lowerMessage.includes('password') ||
        lowerMessage.includes('token') || lowerMessage.includes('access key')) {
      return 'credentials';
    }
    
    // Check for deployment status intent
    if (lowerMessage.includes('status') || lowerMessage.includes('progress') || 
        lowerMessage.includes('where are we') || lowerMessage.includes('what happened') ||
        lowerMessage.includes('current state')) {
      return 'deployment_status';
    }
    
    // Check for sandbox intent
    if (lowerMessage.includes('sandbox') || lowerMessage.includes('test')) {
      return 'sandbox';
    }
    
    return 'general';
  }

  /**
   * Build smart context based on user intent
   */
  async buildSmartContext(deploymentId, userId, intent, deployment) {
    const deploymentEnvService = require('./deploymentEnvService');
    const credentialManager = require('./credentialManager');
    let contextMessage = '';

    // Always include deployment summary (lightweight)
    const deploymentSummary = await deploymentContextBuilder.buildMinimalContext(deploymentId);
    if (deploymentSummary) {
      contextMessage += `\n\n${deploymentSummary}`;
    }

    // Add intent-specific context
    if (intent === 'env_vars' && deployment) {
      const envVars = await deploymentEnvService.getAsObject(deploymentId, userId);
      if (Object.keys(envVars).length > 0) {
        contextMessage += '\n\n**Environment Variables:**\n';
        for (const [key, value] of Object.entries(envVars)) {
          contextMessage += `${key}=${value ? '***' : '(empty)'}\n`;
        }
      }
    }

    if (intent === 'credentials' && deployment) {
      const credentials = await credentialManager.listCredentials(userId);
      if (credentials.length > 0) {
        contextMessage += '\n\n**Available Credentials:**\n';
        for (const cred of credentials.slice(0, 10)) {
          contextMessage += `- ${cred.name} (${cred.serviceType}) - Usage: ${cred.usageCount}x\n`;
        }
      }
    }

    if (intent === 'deployment_status' || intent === 'sandbox') {
      const fullContext = await deploymentContextBuilder.buildContext(deploymentId);
      if (fullContext) {
        contextMessage += '\n\n' + fullContext;
      }
    }

    return contextMessage;
  }

  /**
   * Chat with Claude (non-streaming)
   */
  async chat(deploymentId, message, options = {}) {
    try {
      // Get deployment first to ensure we have userId
      const Deployment = require('../models/Deployment');
      const deployment = await Deployment.findOne({ deploymentId });
      
      // Ensure userId is available
      let userId = options.userId;
      if (!userId && deployment && deployment.userId) {
        userId = deployment.userId.toString();
      }
      if (!userId) {
        logger.error('No userId available for conversation', { deploymentId });
        throw new Error('userId is required for conversation');
      }
      
      // Get or create conversation
      let conversation = await Conversation.findOne({ deploymentId });
      
      if (!conversation) {
        conversation = new Conversation({
          deploymentId,
          userId: userId,
          messages: []
        });
      } else if (!conversation.userId) {
        // Update existing conversation if userId is missing
        conversation.userId = userId;
        await conversation.save();
      }
      
      // Detect user intent for smart context injection
      const intent = this.detectUserIntent(message);
      
      // Build smart context based on intent
      const contextMessage = await this.buildSmartContext(deploymentId, userId, intent, deployment);
      
      // Get compressed messages (recent + summary)
      const compressedContext = await contextSummarizer.getCompressedMessages(
        conversation,
        options.windowSize || conversation.contextWindowSize
      );
      
      // Estimate tokens before compression
      const tokensBeforeEstimate = conversation.messages.length * 200; // Rough estimate
      
      // Build messages array: summary + recent messages
      const messages = [
        ...compressedContext.summaryMessages,
        ...compressedContext.recentMessages
      ];
      
      // Add new user message with smart context
      messages.push({
        role: 'user',
        content: message + contextMessage
      });
      
      // Determine which system prompt to use
      const operationType = options.operationType || 'chat';
      const systemPrompt = shouldUseShortPrompt(operationType) 
        ? this.getSystemPromptShort() 
        : this.getSystemPrompt();
      
      // Build Claude API request options
      const requestOptions = {
        model: options.model || 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens || 4096,
        messages: messages,
        system: systemPrompt
      };
      
      // Estimate tokens after compression
      const tokensAfterEstimate = messages.reduce((sum, msg) => {
        return sum + (msg.content ? msg.content.length / 4 : 0); // Rough token estimate
      }, systemPrompt.length / 4);
      
      // Note: MCP servers are handled through the MCP orchestrator service
      // They are not passed directly to the Claude API
      
      // Call Claude API
      const response = await this.client.messages.create(requestOptions);
      
      // Extract assistant message (with command execution if needed)
      const assistantMessage = await this.processResponse(response, deploymentId);
      
      // Extract MCP tool calls
      const mcpToolCalls = this.extractMCPToolCalls(response);
      
      // Update conversation
      conversation.messages.push({
        role: 'user',
        content: message,
        timestamp: new Date()
      });
      
      // Format message content before saving
      const formattedContent = formatMessageContent(assistantMessage.content);
      
      // Extract commands from response for UI display
      let detectedCommands = [];
      if (deploymentId) {
        const commandExecutor = require('./commandExecutor');
        detectedCommands = commandExecutor.extractCommands(formattedContent);
      }
      
      conversation.messages.push({
        role: 'assistant',
        content: formattedContent,
        timestamp: new Date(),
        toolCalls: mcpToolCalls.length > 0 ? mcpToolCalls : undefined,
        detectedCommands: detectedCommands.length > 0 ? detectedCommands : undefined
      });
      
      // Update MCP tool calls in conversation
      if (mcpToolCalls.length > 0) {
        conversation.mcpToolCalls = conversation.mcpToolCalls || [];
        conversation.mcpToolCalls.push(...mcpToolCalls.map(tc => ({
          tool: tc.name,
          operation: tc.name,
          timestamp: new Date(),
          duration: 0,
          success: true
        })));
      }
      
      // Update token usage
      if (response.usage) {
        conversation.updateTokens(
          response.usage.input_tokens,
          response.usage.output_tokens
        );
        
        // Update compression metrics
        if (tokensBeforeEstimate > 0) {
          await contextSummarizer.updateCompressionMetrics(
            conversation,
            tokensBeforeEstimate,
            response.usage.input_tokens
          );
        }
      }
      
      // Log MCP usage
      if (mcpToolCalls.length > 0) {
        await this.logMCPUsage(deploymentId, mcpToolCalls);
      }
      
      await conversation.save();
      
      return {
        message: formattedContent,
        detectedCommands: detectedCommands.length > 0 ? detectedCommands : undefined,
        tokensUsed: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0,
          total: response.usage?.usage?.total_tokens || 0
        }
      };
      
    } catch (error) {
      logger.error('Claude API error:', error);
      throw error;
    }
  }

  /**
   * Chat with Claude (streaming)
   */
  async *chatStream(deploymentId, message, options = {}) {
    try {
      // Get or create conversation
      // Get deployment first to ensure we have userId
      const Deployment = require('../models/Deployment');
      const deployment = await Deployment.findOne({ deploymentId });
      
      // Ensure userId is available
      let userId = options.userId;
      if (!userId && deployment && deployment.userId) {
        userId = deployment.userId.toString();
      }
      if (!userId) {
        logger.error('No userId available for streaming conversation', { deploymentId });
        throw new Error('userId is required for conversation');
      }
      
      let conversation = await Conversation.findOne({ deploymentId });
      
      if (!conversation) {
        conversation = new Conversation({
          deploymentId,
          userId: userId,
          messages: []
        });
      } else if (!conversation.userId) {
        // Update existing conversation if userId is missing
        conversation.userId = userId;
        await conversation.save();
      }
      
      // Detect user intent for smart context injection
      const intent = this.detectUserIntent(message);
      
      // Build smart context based on intent
      const contextMessage = await this.buildSmartContext(deploymentId, userId, intent, deployment);
      
      // Get compressed messages (recent + summary)
      const compressedContext = await contextSummarizer.getCompressedMessages(
        conversation,
        options.windowSize || conversation.contextWindowSize
      );
      
      // Build messages array: summary + recent messages
      const messages = [
        ...compressedContext.summaryMessages,
        ...compressedContext.recentMessages
      ];
      
      // Add new user message with smart context
      messages.push({
        role: 'user',
        content: message + contextMessage
      });
      
      // Determine which system prompt to use
      const operationType = options.operationType || 'chat';
      const systemPrompt = shouldUseShortPrompt(operationType) 
        ? this.getSystemPromptShort() 
        : this.getSystemPrompt();
      
      // Get MCP servers configuration
      // Build Claude API request options for streaming
      const streamRequestOptions = {
        model: options.model || 'claude-sonnet-4-20250514',
        max_tokens: options.maxTokens || 4096,
        messages: messages,
        system: systemPrompt,
        stream: true
      };
      
      // Note: MCP servers are handled through the MCP orchestrator service
      // They are not passed directly to the Claude API
      
      // Call Claude API with streaming
      const stream = await this.client.messages.create(streamRequestOptions);
      
      let fullResponse = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let mcpToolCalls = [];
      
      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage?.input_tokens || 0;
        }
        
        if (event.type === 'content_block_delta') {
          const delta = event.delta.text;
          fullResponse += delta;
          yield {
            type: 'text',
            content: delta
          };
        }
        
        // Track MCP tool usage
        if (event.type === 'mcp_tool_use') {
          mcpToolCalls.push({
            tool: event.name,
            input: event.input,
            timestamp: new Date()
          });
          yield {
            type: 'mcp_tool',
            toolName: event.name,
            content: `Using ${event.name}...`
          };
        }
        
        if (event.type === 'mcp_tool_result') {
          yield {
            type: 'mcp_result',
            toolName: event.name,
            content: 'Tool execution completed'
          };
        }
        
        if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens || 0;
        }
        
        if (event.type === 'message_stop') {
          // Format response content before saving
          let formattedResponse = formatMessageContent(fullResponse);
          
          // Extract commands from response for UI display
          let detectedCommands = [];
          if (deploymentId) {
            const commandExecutor = require('./commandExecutor');
            detectedCommands = commandExecutor.extractCommands(formattedResponse);
          }
          
          // Detect and execute commands in the response (only if explicitly requested)
          // Note: We don't auto-execute commands anymore - users can click execute buttons
          
          // Save conversation after streaming completes
          conversation.messages.push({
            role: 'user',
            content: message,
            timestamp: new Date()
          });
          
          conversation.messages.push({
            role: 'assistant',
            content: formattedResponse,
            timestamp: new Date(),
            toolCalls: mcpToolCalls.length > 0 ? mcpToolCalls : undefined,
            detectedCommands: detectedCommands.length > 0 ? detectedCommands : undefined
          });
          
          // Update MCP tool calls in conversation
          if (mcpToolCalls.length > 0) {
            conversation.mcpToolCalls = conversation.mcpToolCalls || [];
            conversation.mcpToolCalls.push(...mcpToolCalls);
          }
          
          conversation.updateTokens(inputTokens, outputTokens);
          
          // Update compression metrics (calculate before adding new messages)
          // Note: conversation.messages.length here is before adding the new messages
          // We need to account for the 2 messages we're about to add (user + assistant)
          const messagesBeforeUpdate = conversation.messages.length;
          const tokensBeforeEstimate = messagesBeforeUpdate * 200;
          if (tokensBeforeEstimate > 0) {
            await contextSummarizer.updateCompressionMetrics(
              conversation,
              tokensBeforeEstimate,
              inputTokens
            );
          }
          
          await conversation.save();
        }
      }
      
    } catch (error) {
      logger.error('Claude streaming error:', error);
      throw error;
    }
  }

  /**
   * Generate Terraform code from requirements using Terraform MCP
   */
  async generateTerraform(requirements, deploymentId) {
    try {
      // Get or create conversation
      let conversation = await Conversation.findOne({ deploymentId });
      if (!conversation) {
        conversation = new Conversation({
          deploymentId,
          messages: []
        });
      }
      
      const prompt = this.buildTerraformPrompt(requirements);
      
      // Get compressed messages (recent + summary)
      const compressedContext = await contextSummarizer.getCompressedMessages(
        conversation,
        conversation.contextWindowSize || 15
      );
      
      // Build messages array: summary + recent messages
      const messages = [
        ...compressedContext.summaryMessages,
        ...compressedContext.recentMessages
      ];
      
      messages.push({
        role: 'user',
        content: prompt
      });
      
      // Use full system prompt for Terraform generation (complex operation)
      const systemPrompt = this.getSystemPrompt();
      
      // Build Claude API request options for Terraform generation
      const terraformRequestOptions = {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384, // Increased to ensure complete code generation
        messages: messages,
        system: systemPrompt
      };
      
      // Note: MCP servers are handled through the MCP orchestrator service
      // They are not passed directly to the Claude API
      
      // Call Claude API for Terraform generation
      const response = await this.client.messages.create(terraformRequestOptions);
      
      // Extract Terraform code from response
      const terraformCode = this.extractTerraformCode(response);
      
      // Validate that we have complete code
      if (!terraformCode.main || terraformCode.main.trim().length < 50) {
        logger.error('Terraform code extraction failed or incomplete', {
          deploymentId,
          hasMain: !!terraformCode.main,
          mainLength: terraformCode.main?.length || 0,
          responseLength: response.content?.length || 0
        });
        throw new Error('Failed to extract complete Terraform code. The generated code appears to be incomplete or missing.');
      }
      
      // Extract MCP tool calls for logging
      const mcpToolCalls = this.extractMCPToolCalls(response);
      
      // Log MCP usage
      await this.logMCPUsage(deploymentId, mcpToolCalls);
      
      // Update conversation
      conversation.messages.push({
        role: 'user',
        content: prompt,
        timestamp: new Date()
      });
      
      const processedResponse = await this.processResponse(response, deploymentId);
      conversation.messages.push({
        role: 'assistant',
        content: processedResponse.content,
        timestamp: new Date(),
        toolCalls: mcpToolCalls
      });
      
      if (mcpToolCalls.length > 0) {
        conversation.mcpToolCalls = conversation.mcpToolCalls || [];
        conversation.mcpToolCalls.push(...mcpToolCalls.map(tc => ({
          tool: tc.name,
          operation: tc.name,
          timestamp: new Date(),
          duration: 0,
          success: true
        })));
      }
      
      if (response.usage) {
        conversation.updateTokens(
          response.usage.input_tokens,
          response.usage.output_tokens
        );
        
        // Update compression metrics
        const tokensBeforeEstimate = conversation.messages.length * 200;
        if (tokensBeforeEstimate > 0) {
          await contextSummarizer.updateCompressionMetrics(
            conversation,
            tokensBeforeEstimate,
            response.usage.input_tokens
          );
        }
      }
      
      await conversation.save();
      
      // Write files first to enable validation
      const terraformService = require('./terraform');
      try {
        await terraformService.writeTerraformFiles(deploymentId, terraformCode);
      } catch (writeError) {
        logger.error('Failed to write Terraform files', {
          deploymentId,
          error: writeError.message
        });
        throw new Error(`Failed to write Terraform files: ${writeError.message}`);
      }
      
      // Validate using Terraform service (not MCP, actual terraform validate)
      let validation;
      try {
        validation = await terraformService.validate(deploymentId);
      } catch (validationError) {
        logger.warn('Terraform validation failed', {
          deploymentId,
          error: validationError.message
        });
        // Don't fail the generation if validation fails - return partial validation
        validation = {
          syntax: {
            valid: false,
            issues: [validationError.message]
          },
          overall: {
            valid: false,
            issues: [validationError.message]
          }
        };
      }
      
      return {
        code: terraformCode,
        validation,
        tokensUsed: {
          input: response.usage?.input_tokens || 0,
          output: response.usage?.output_tokens || 0,
          total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        },
        mcpToolsUsed: mcpToolCalls.map(tc => tc.name)
      };
      
    } catch (error) {
      logger.error('Terraform generation error:', error);
      throw error;
    }
  }
  
  /**
   * Get MCP servers configuration for Claude API
   * Only returns servers that have valid URLs configured
   */
  getMCPServers(enableWriteOperations = false) {
    const { mcpConfig } = require('../config/mcp');
    const servers = [];
    
    // Add Terraform MCP Server only if URL is configured
    if (process.env.TERRAFORM_MCP_URL) {
      const terraformConfig = mcpConfig.terraform.getClaudeConfig();
      
      // Configure write operations if needed
      if (enableWriteOperations && process.env.TFE_TOKEN) {
        terraformConfig.env = {
          ...terraformConfig.env,
          ENABLE_TF_OPERATIONS: 'true'
        };
      }
      
      servers.push(terraformConfig);
    }
    
    // Add AWS MCP Server if URL is configured
    if (process.env.AWS_MCP_URL) {
      servers.push({
        type: 'url',
        url: process.env.AWS_MCP_URL,
        name: 'aws-mcp'
      });
    }
    
    // Add GitHub MCP Server if URL is configured
    if (process.env.GITHUB_MCP_URL) {
      const githubConfig = mcpConfig.github.getClaudeConfig();
      servers.push(githubConfig);
    }
    
    // Log MCP server status for debugging
    if (servers.length === 0) {
      logger.debug('No MCP servers configured. Tool calls will use fallback implementations.');
    } else {
      logger.debug(`MCP servers configured: ${servers.map(s => s.name).join(', ')}`);
    }
    
    return servers;
  }
  
  /**
   * Extract MCP tool calls from Claude response
   */
  extractMCPToolCalls(response) {
    const toolCalls = [];
    
    if (!response || !response.content) {
      return toolCalls;
    }
    
    for (const block of response.content) {
      // Handle mcp_tool_use blocks (from Claude API with MCP servers)
      if (block.type === 'mcp_tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          serverName: block.server_name || this.inferServerFromToolName(block.name),
          input: block.input,
          type: 'mcp_tool_use'
        });
      }
      // Handle tool_use blocks (standard Claude tool use)
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          serverName: this.inferServerFromToolName(block.name),
          input: block.input,
          type: 'tool_use'
        });
      }
    }
    
    return toolCalls;
  }

  /**
   * Infer which MCP server a tool belongs to based on its name
   */
  inferServerFromToolName(toolName) {
    const terraformTools = [
      'get_provider_documentation', 'search_modules', 'get_module_info',
      'get_sentinel_policies', 'list_organizations', 'list_workspaces',
      'create_workspace', 'update_workspace', 'delete_workspace',
      'create_run', 'manage_variables', 'manage_tags',
      'terraform_init', 'terraform_plan', 'terraform_apply', 'terraform_validate'
    ];
    
    const awsTools = [
      'describe_resources', 'get_cost_and_usage', 'check_service_quotas',
      'get_cloudwatch_metrics', 'create_budget', 'tag_resources', 'estimate_cost'
    ];
    
    const githubTools = [
      'read_repository', 'list_repositories', 'read_file', 'list_files',
      'create_branch', 'create_commit', 'create_pull_request',
      'trigger_workflow', 'get_workflow_status', 'list_workflows',
      'manage_secrets', 'get_actions_status'
    ];
    
    if (terraformTools.includes(toolName)) return 'terraform';
    if (awsTools.includes(toolName)) return 'aws';
    if (githubTools.includes(toolName)) return 'github';
    
    return 'unknown';
  }

  /**
   * Execute MCP tool calls from Claude response
   * This is called when Claude makes tool calls that need to be executed
   */
  async executeMCPToolCalls(toolCalls, deploymentId) {
    const mcpOrchestrator = require('./mcpOrchestrator');
    const results = [];
    
    for (const toolCall of toolCalls) {
      const startTime = Date.now();
      
      try {
        logger.info(`Executing MCP tool call: ${toolCall.serverName}.${toolCall.name}`, {
          deploymentId,
          toolId: toolCall.id
        });
        
        // Execute the tool via MCP orchestrator
        const result = await mcpOrchestrator.executeTool(
          toolCall.serverName,
          toolCall.name,
          toolCall.input
        );
        
        const duration = Date.now() - startTime;
        
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          serverName: toolCall.serverName,
          success: true,
          result,
          duration
        });
        
        // Log successful execution
        await this.logMCPToolExecution(deploymentId, toolCall, result, duration, true);
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error(`MCP tool call failed: ${toolCall.serverName}.${toolCall.name}`, {
          error: error.message,
          deploymentId,
          toolId: toolCall.id
        });
        
        results.push({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          serverName: toolCall.serverName,
          success: false,
          error: error.message,
          duration
        });
        
        // Log failed execution
        await this.logMCPToolExecution(deploymentId, toolCall, null, duration, false, error.message);
      }
    }
    
    return results;
  }

  /**
   * Log MCP tool execution for analytics and monitoring
   */
  async logMCPToolExecution(deploymentId, toolCall, result, duration, success, errorMessage = null) {
    try {
      await MCPUsage.create({
        deploymentId,
        toolName: toolCall.name,
        serverName: toolCall.serverName,
        input: this.sanitizeForLogging(toolCall.input),
        result: success ? this.sanitizeForLogging(result) : null,
        latency: duration,
        timestamp: new Date(),
        success,
        error: errorMessage
      });
    } catch (error) {
      logger.error('Error logging MCP tool execution:', error);
      // Don't throw - logging failure shouldn't break the flow
    }
  }

  /**
   * Sanitize data for logging (remove sensitive info, truncate large data)
   */
  sanitizeForLogging(data) {
    if (!data) return null;
    
    const str = JSON.stringify(data);
    if (str.length > 2000) {
      return { _truncated: true, _length: str.length };
    }
    
    // Remove sensitive fields
    const sanitized = JSON.parse(str);
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'credential', 'auth', 'apiKey'];
    
    const removeSensitive = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;
      
      for (const key of Object.keys(obj)) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          removeSensitive(obj[key]);
        }
      }
      return obj;
    };
    
    return removeSensitive(sanitized);
  }
  
  /**
   * Log MCP tool usage for analytics (legacy method - kept for backwards compatibility)
   */
  async logMCPUsage(deploymentId, mcpToolCalls) {
    if (!mcpToolCalls || mcpToolCalls.length === 0) {
      return;
    }
    
    logger.info('MCP tools used', {
      deploymentId,
      tools: mcpToolCalls.map(tc => tc.name),
      count: mcpToolCalls.length
    });
    
    // Store MCP usage metrics
    try {
      for (const toolCall of mcpToolCalls) {
        await MCPUsage.create({
          deploymentId,
          toolName: toolCall.name,
          serverName: toolCall.serverName || this.inferServerFromToolName(toolCall.name),
          input: this.sanitizeForLogging(toolCall.input),
          timestamp: new Date(),
          success: true
        });
      }
    } catch (error) {
      logger.error('Error logging MCP usage:', error);
      // Don't throw - logging failure shouldn't break the flow
    }
  }

  /**
   * Build Terraform generation prompt with MCP tool instructions
   */
  buildTerraformPrompt(requirements) {
    return `Generate production-ready Terraform code for the following infrastructure requirements:

${JSON.stringify(requirements, null, 2)}

IMPORTANT: Use the Terraform MCP tools available to you:

1. First, use get_provider_documentation to fetch the latest AWS provider documentation for all resources you'll create
2. Search for relevant verified modules using search_modules (e.g., for VPC, EKS, RDS patterns)
3. If using modules, get detailed information with get_module_info including input variables and examples
4. Check get_sentinel_policies for any compliance requirements

Then generate Terraform code with:

Requirements:
1. Use Terraform 1.6+ syntax and latest AWS provider version
2. Use current resource schemas from the documentation you fetched
3. Follow AWS Well-Architected Framework principles
4. Include proper resource dependencies
5. Use variables for all configurable values (no hardcoded values)
6. Add appropriate tags to all resources (Environment, Project, Owner, ManagedBy)
7. Configure remote state in S3 with DynamoDB locking
8. Include security groups with least privilege access
9. Enable encryption at rest and in transit where applicable
10. Add lifecycle rules for production resources
11. Use verified modules from Terraform Registry where appropriate
12. Include comprehensive outputs for important resource attributes

CRITICAL: Generate COMPLETE code for ALL files. Do not truncate or omit any code blocks.

Generate the following files:
- main.tf (main resource definitions - MUST be complete)
- variables.tf (input variables with descriptions and defaults - MUST be complete)
- outputs.tf (output values - MUST be complete)
- providers.tf (AWS provider configuration - MUST be complete)

Format your response as JSON with the following structure:
{
  "main": "complete terraform code here with all resources",
  "variables": "complete variables.tf code here",
  "outputs": "complete outputs.tf code here",
  "providers": "complete providers.tf code here"
}

IMPORTANT:
- Ensure ALL code blocks are COMPLETE and properly formatted
- Use proper HCL syntax with correct indentation
- Include ALL required resources, variables, and outputs
- Do not truncate code - generate full, working Terraform configuration
- Each file should be production-ready and immediately usable

Ensure all code uses the latest syntax and best practices from the current documentation.`;
  }

  /**
   * Extract Terraform code from Claude response
   * Handles both direct response strings and API response objects
   * Improved to ensure complete code extraction
   */
  extractTerraformCode(response) {
    try {
      // Handle API response object
      let responseText = '';
      if (typeof response === 'object' && response.content) {
        // Extract text from content blocks
        responseText = response.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      } else if (typeof response === 'string') {
        responseText = response;
      } else {
        responseText = JSON.stringify(response);
      }
      
      // Try to parse as JSON first (most reliable)
      // Look for JSON object that might span multiple lines
      const jsonMatch = responseText.match(/\{[\s\S]*"main"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.main || parsed.variables || parsed.outputs || parsed.providers) {
            const extracted = {
              main: parsed.main || '',
              variables: parsed.variables || '',
              outputs: parsed.outputs || '',
              providers: parsed.providers || ''
            };
            
            // Validate that we have at least main.tf
            if (extracted.main && extracted.main.length > 50) {
              logger.info('Successfully extracted Terraform code from JSON', {
                hasMain: !!extracted.main,
                hasVariables: !!extracted.variables,
                hasOutputs: !!extracted.outputs,
                hasProviders: !!extracted.providers,
                mainLength: extracted.main.length
              });
              return extracted;
            }
          }
        } catch (e) {
          logger.warn('Failed to parse JSON, trying code block extraction', { error: e.message });
        }
      }
      
      // Try to extract code blocks by filename with improved regex
      // Match filename followed by code block, handling various formats
      const patterns = {
        main: [
          /(?:main\.tf|main\.tf:)[\s\S]*?```(?:hcl|terraform|json)?\n?([\s\S]*?)```/i,
          /```(?:hcl|terraform)?\n?#\s*main\.tf\s*\n([\s\S]*?)```/i,
          /#\s*main\.tf\s*\n```(?:hcl|terraform)?\n?([\s\S]*?)```/i
        ],
        variables: [
          /(?:variables\.tf|variables\.tf:)[\s\S]*?```(?:hcl|terraform|json)?\n?([\s\S]*?)```/i,
          /```(?:hcl|terraform)?\n?#\s*variables\.tf\s*\n([\s\S]*?)```/i,
          /#\s*variables\.tf\s*\n```(?:hcl|terraform)?\n?([\s\S]*?)```/i
        ],
        outputs: [
          /(?:outputs\.tf|outputs\.tf:)[\s\S]*?```(?:hcl|terraform|json)?\n?([\s\S]*?)```/i,
          /```(?:hcl|terraform)?\n?#\s*outputs\.tf\s*\n([\s\S]*?)```/i,
          /#\s*outputs\.tf\s*\n```(?:hcl|terraform)?\n?([\s\S]*?)```/i
        ],
        providers: [
          /(?:providers\.tf|providers\.tf:)[\s\S]*?```(?:hcl|terraform|json)?\n?([\s\S]*?)```/i,
          /```(?:hcl|terraform)?\n?#\s*providers\.tf\s*\n([\s\S]*?)```/i,
          /#\s*providers\.tf\s*\n```(?:hcl|terraform)?\n?([\s\S]*?)```/i
        ]
      };
      
      const extracted = {
        main: '',
        variables: '',
        outputs: '',
        providers: ''
      };
      
      // Try each pattern for each file type
      for (const [fileType, patternList] of Object.entries(patterns)) {
        for (const pattern of patternList) {
          const match = responseText.match(pattern);
          if (match && match[1] && match[1].trim().length > 10) {
            extracted[fileType] = match[1].trim();
            break;
          }
        }
      }
      
      // If we found at least main.tf, return what we have
      if (extracted.main && extracted.main.length > 50) {
        logger.info('Extracted Terraform code from code blocks', {
          hasMain: !!extracted.main,
          hasVariables: !!extracted.variables,
          hasOutputs: !!extracted.outputs,
          hasProviders: !!extracted.providers,
          mainLength: extracted.main.length
        });
        return extracted;
      }
      
      // Try generic code block extraction (fallback)
      const codeBlocks = responseText.match(/```(?:hcl|terraform|json)?\n?([\s\S]*?)```/g);
      if (codeBlocks && codeBlocks.length >= 1) {
        // Extract code from blocks
        const blocks = codeBlocks.map(block => 
          block.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
        ).filter(block => block.length > 10);
        
        if (blocks.length >= 1) {
          // Assign blocks in order: main, variables, outputs, providers
          extracted.main = blocks[0] || '';
          extracted.variables = blocks[1] || '';
          extracted.outputs = blocks[2] || '';
          extracted.providers = blocks[3] || '';
          
          if (extracted.main && extracted.main.length > 50) {
            logger.info('Extracted Terraform code from generic code blocks', {
              blockCount: blocks.length,
              mainLength: extracted.main.length
            });
            return extracted;
          }
        }
      }
      
      // Last resort: try to find any Terraform-like code in the response
      const terraformPattern = /(?:terraform|provider|resource|variable|output)\s+["\w]+/i;
      if (terraformPattern.test(responseText)) {
        logger.warn('Found Terraform-like code but extraction incomplete, using full response as main');
        return {
          main: responseText.trim(),
          variables: '',
          outputs: '',
          providers: ''
        };
      }
      
      // If nothing found, log warning and return empty
      logger.error('Could not extract Terraform code from response', {
        responseLength: responseText.length,
        first500: responseText.substring(0, 500)
      });
      
      return {
        main: '',
        variables: '',
        outputs: '',
        providers: ''
      };
      
    } catch (error) {
      logger.error('Error extracting Terraform code:', error);
      return {
        main: typeof response === 'string' ? response : JSON.stringify(response),
        variables: '',
        outputs: '',
        providers: ''
      };
    }
  }

  /**
   * Process Claude API response
   */
  processResponse(response) {
    const textBlocks = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    
    // Format message content to ensure code is properly formatted
    const formattedContent = formatMessageContent(textBlocks);
    
    // Extract MCP tool calls if present
    const mcpToolCalls = this.extractMCPToolCalls(response);
    
    return {
      content: formattedContent,
      role: 'assistant',
      mcpToolCalls: mcpToolCalls.length > 0 ? mcpToolCalls : undefined
    };
  }
}

// Singleton instance
const claudeService = new ClaudeService();

module.exports = claudeService;

