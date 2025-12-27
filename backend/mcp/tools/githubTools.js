const githubService = require('../../services/githubService');
const githubAnalysis = require('../../services/githubAnalysis');
const logger = require('../../utils/logger');

/**
 * GitHub-related MCP tools
 * These tools expose GitHub operations for Cursor AI integration
 */

const tools = [
  {
    name: 'analyze_repository',
    description: 'Analyze a GitHub repository structure and detect deployment requirements',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL (e.g., https://github.com/owner/repo)'
        },
        branch: {
          type: 'string',
          description: 'Branch to analyze (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token for private repositories'
        }
      },
      required: ['repositoryUrl']
    },
    handler: async (args) => {
      try {
        const analysis = await githubAnalysis.analyzeRepository(
          args.repositoryUrl,
          args.branch || 'main',
          args.githubToken
        );

        return {
          success: true,
          repositoryUrl: args.repositoryUrl,
          branch: args.branch || 'main',
          analysis: {
            projectType: analysis.projectType,
            framework: analysis.framework,
            language: analysis.language,
            hasDocker: analysis.hasDocker,
            hasTerraform: analysis.hasTerraform,
            hasGitHubActions: analysis.hasGitHubActions,
            dependencies: analysis.dependencies,
            detectedEnvVars: analysis.detectedEnvVars,
            suggestedInfrastructure: analysis.suggestedInfrastructure,
            files: analysis.files?.slice(0, 20) // Limit to first 20 files
          }
        };
      } catch (error) {
        logger.error('Repository analysis failed via MCP:', error);
        throw new Error(`Repository analysis failed: ${error.message}`);
      }
    }
  },

  {
    name: 'read_repository_file',
    description: 'Read a file from a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        filePath: {
          type: 'string',
          description: 'Path to the file in the repository'
        },
        branch: {
          type: 'string',
          description: 'Branch to read from (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token for private repositories'
        }
      },
      required: ['repositoryUrl', 'filePath']
    },
    handler: async (args) => {
      try {
        const content = await githubService.getFileContent(
          args.repositoryUrl,
          args.filePath,
          args.branch || 'main',
          args.githubToken
        );

        return {
          success: true,
          filePath: args.filePath,
          content: content.substring(0, 10000), // Limit content size
          truncated: content.length > 10000
        };
      } catch (error) {
        logger.error('File read failed via MCP:', error);
        throw new Error(`File read failed: ${error.message}`);
      }
    }
  },

  {
    name: 'list_repository_files',
    description: 'List files in a GitHub repository directory',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        path: {
          type: 'string',
          description: 'Directory path in the repository (default: root)'
        },
        branch: {
          type: 'string',
          description: 'Branch to list from (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token for private repositories'
        }
      },
      required: ['repositoryUrl']
    },
    handler: async (args) => {
      try {
        const files = await githubService.listFiles(
          args.repositoryUrl,
          args.path || '',
          args.branch || 'main',
          args.githubToken
        );

        return {
          success: true,
          path: args.path || '/',
          files: files.map(f => ({
            name: f.name,
            path: f.path,
            type: f.type,
            size: f.size
          }))
        };
      } catch (error) {
        logger.error('List files failed via MCP:', error);
        throw new Error(`List files failed: ${error.message}`);
      }
    }
  },

  {
    name: 'create_branch',
    description: 'Create a new branch in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        branchName: {
          type: 'string',
          description: 'Name for the new branch'
        },
        baseBranch: {
          type: 'string',
          description: 'Branch to create from (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token with repo access'
        }
      },
      required: ['repositoryUrl', 'branchName', 'githubToken']
    },
    handler: async (args) => {
      try {
        const result = await githubService.createBranch(
          args.repositoryUrl,
          args.branchName,
          args.baseBranch || 'main',
          args.githubToken
        );

        return {
          success: true,
          branchName: args.branchName,
          baseBranch: args.baseBranch || 'main',
          ref: result.ref,
          message: `Branch '${args.branchName}' created successfully`
        };
      } catch (error) {
        logger.error('Create branch failed via MCP:', error);
        throw new Error(`Create branch failed: ${error.message}`);
      }
    }
  },

  {
    name: 'commit_files',
    description: 'Commit files to a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        branch: {
          type: 'string',
          description: 'Branch to commit to'
        },
        message: {
          type: 'string',
          description: 'Commit message'
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            }
          },
          description: 'Files to commit (array of {path, content})'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token with repo access'
        }
      },
      required: ['repositoryUrl', 'branch', 'message', 'files', 'githubToken']
    },
    handler: async (args) => {
      try {
        const result = await githubService.commitFiles(
          args.repositoryUrl,
          args.branch,
          args.message,
          args.files,
          args.githubToken
        );

        return {
          success: true,
          commitSha: result.sha,
          branch: args.branch,
          filesCommitted: args.files.length,
          message: `Committed ${args.files.length} files to ${args.branch}`
        };
      } catch (error) {
        logger.error('Commit files failed via MCP:', error);
        throw new Error(`Commit files failed: ${error.message}`);
      }
    }
  },

  {
    name: 'create_pull_request',
    description: 'Create a pull request in a GitHub repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        title: {
          type: 'string',
          description: 'Pull request title'
        },
        body: {
          type: 'string',
          description: 'Pull request description'
        },
        head: {
          type: 'string',
          description: 'Branch with changes'
        },
        base: {
          type: 'string',
          description: 'Branch to merge into (default: main)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token with repo access'
        }
      },
      required: ['repositoryUrl', 'title', 'head', 'githubToken']
    },
    handler: async (args) => {
      try {
        const result = await githubService.createPullRequest(
          args.repositoryUrl,
          args.title,
          args.body || '',
          args.head,
          args.base || 'main',
          args.githubToken
        );

        return {
          success: true,
          prNumber: result.number,
          prUrl: result.html_url,
          title: args.title,
          head: args.head,
          base: args.base || 'main',
          message: `Pull request #${result.number} created successfully`
        };
      } catch (error) {
        logger.error('Create PR failed via MCP:', error);
        throw new Error(`Create PR failed: ${error.message}`);
      }
    }
  },

  {
    name: 'trigger_workflow',
    description: 'Trigger a GitHub Actions workflow',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        workflowId: {
          type: 'string',
          description: 'Workflow ID or file name (e.g., deploy.yml)'
        },
        branch: {
          type: 'string',
          description: 'Branch to run workflow on (default: main)'
        },
        inputs: {
          type: 'object',
          description: 'Workflow inputs (if the workflow accepts inputs)'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token with workflow access'
        }
      },
      required: ['repositoryUrl', 'workflowId', 'githubToken']
    },
    handler: async (args) => {
      try {
        const result = await githubService.triggerWorkflow(
          args.repositoryUrl,
          args.workflowId,
          args.branch || 'main',
          args.inputs || {},
          args.githubToken
        );

        return {
          success: true,
          workflowId: args.workflowId,
          branch: args.branch || 'main',
          runId: result.runId,
          message: `Workflow '${args.workflowId}' triggered successfully`
        };
      } catch (error) {
        logger.error('Trigger workflow failed via MCP:', error);
        throw new Error(`Trigger workflow failed: ${error.message}`);
      }
    }
  },

  {
    name: 'get_workflow_status',
    description: 'Get the status of a GitHub Actions workflow run',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        runId: {
          type: 'number',
          description: 'Workflow run ID'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token'
        }
      },
      required: ['repositoryUrl', 'runId']
    },
    handler: async (args) => {
      try {
        const result = await githubService.getWorkflowRunStatus(
          args.repositoryUrl,
          args.runId,
          args.githubToken
        );

        return {
          success: true,
          runId: args.runId,
          status: result.status,
          conclusion: result.conclusion,
          name: result.name,
          startedAt: result.run_started_at,
          url: result.html_url,
          jobs: result.jobs?.map(j => ({
            name: j.name,
            status: j.status,
            conclusion: j.conclusion
          }))
        };
      } catch (error) {
        logger.error('Get workflow status failed via MCP:', error);
        throw new Error(`Get workflow status failed: ${error.message}`);
      }
    }
  },

  {
    name: 'list_workflows',
    description: 'List GitHub Actions workflows in a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token'
        }
      },
      required: ['repositoryUrl']
    },
    handler: async (args) => {
      try {
        const result = await githubService.listWorkflows(
          args.repositoryUrl,
          args.githubToken
        );

        return {
          success: true,
          workflows: result.workflows?.map(w => ({
            id: w.id,
            name: w.name,
            path: w.path,
            state: w.state
          })) || []
        };
      } catch (error) {
        logger.error('List workflows failed via MCP:', error);
        throw new Error(`List workflows failed: ${error.message}`);
      }
    }
  },

  {
    name: 'manage_repository_secret',
    description: 'Create or update a repository secret for GitHub Actions',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryUrl: {
          type: 'string',
          description: 'GitHub repository URL'
        },
        secretName: {
          type: 'string',
          description: 'Name of the secret'
        },
        secretValue: {
          type: 'string',
          description: 'Value of the secret'
        },
        githubToken: {
          type: 'string',
          description: 'GitHub token with secrets access'
        }
      },
      required: ['repositoryUrl', 'secretName', 'secretValue', 'githubToken']
    },
    handler: async (args) => {
      try {
        await githubService.setRepositorySecret(
          args.repositoryUrl,
          args.secretName,
          args.secretValue,
          args.githubToken
        );

        return {
          success: true,
          secretName: args.secretName,
          message: `Secret '${args.secretName}' set successfully`
        };
      } catch (error) {
        logger.error('Manage secret failed via MCP:', error);
        throw new Error(`Manage secret failed: ${error.message}`);
      }
    }
  },

  {
    name: 'generate_github_actions_workflow',
    description: 'Generate a GitHub Actions workflow file for deployment',
    inputSchema: {
      type: 'object',
      properties: {
        projectType: {
          type: 'string',
          enum: ['nodejs', 'python', 'golang', 'java', 'docker'],
          description: 'Type of project'
        },
        deployTarget: {
          type: 'string',
          enum: ['aws-ecs', 'aws-lambda', 'aws-ec2', 'kubernetes', 'docker'],
          description: 'Deployment target'
        },
        branches: {
          type: 'array',
          items: { type: 'string' },
          description: 'Branches to trigger on (default: [main])'
        },
        includeTests: {
          type: 'boolean',
          description: 'Include test step (default: true)'
        }
      },
      required: ['projectType', 'deployTarget']
    },
    handler: async (args) => {
      try {
        const workflow = generateWorkflow(args);

        return {
          success: true,
          workflow,
          fileName: '.github/workflows/deploy.yml',
          message: 'GitHub Actions workflow generated'
        };
      } catch (error) {
        logger.error('Generate workflow failed via MCP:', error);
        throw new Error(`Generate workflow failed: ${error.message}`);
      }
    }
  }
];

/**
 * Generate GitHub Actions workflow
 */
function generateWorkflow(options) {
  const { projectType, deployTarget, branches = ['main'], includeTests = true } = options;

  let workflow = `name: Deploy

on:
  push:
    branches:
${branches.map(b => `      - ${b}`).join('\n')}
  pull_request:
    branches:
      - main

env:
  AWS_REGION: \${{ secrets.AWS_REGION }}

jobs:
`;

  // Build job
  workflow += generateBuildJob(projectType, includeTests);

  // Deploy job
  workflow += generateDeployJob(projectType, deployTarget);

  return workflow;
}

function generateBuildJob(projectType, includeTests) {
  let job = `  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`;

  switch (projectType) {
    case 'nodejs':
      job += `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci
${includeTests ? `
      - name: Run tests
        run: npm test
` : ''}
      - name: Build
        run: npm run build
`;
      break;

    case 'python':
      job += `
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt
${includeTests ? `
      - name: Run tests
        run: pytest
` : ''}
`;
      break;

    case 'golang':
      job += `
      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Build
        run: go build -v ./...
${includeTests ? `
      - name: Run tests
        run: go test -v ./...
` : ''}
`;
      break;

    case 'docker':
      job += `
      - name: Build Docker image
        run: docker build -t app:latest .
`;
      break;
  }

  return job;
}

function generateDeployJob(projectType, deployTarget) {
  let job = `
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: \${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: \${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: \${{ env.AWS_REGION }}
`;

  switch (deployTarget) {
    case 'aws-ecs':
      job += `
      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push image to Amazon ECR
        env:
          ECR_REGISTRY: \${{ steps.login-ecr.outputs.registry }}
          ECR_REPOSITORY: \${{ secrets.ECR_REPOSITORY }}
          IMAGE_TAG: \${{ github.sha }}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG

      - name: Deploy to ECS
        run: |
          aws ecs update-service --cluster \${{ secrets.ECS_CLUSTER }} --service \${{ secrets.ECS_SERVICE }} --force-new-deployment
`;
      break;

    case 'aws-lambda':
      job += `
      - name: Deploy to Lambda
        run: |
          zip -r function.zip .
          aws lambda update-function-code --function-name \${{ secrets.LAMBDA_FUNCTION }} --zip-file fileb://function.zip
`;
      break;

    case 'aws-ec2':
      job += `
      - name: Deploy to EC2
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: \${{ secrets.EC2_HOST }}
          username: \${{ secrets.EC2_USER }}
          key: \${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /app
            git pull
            npm ci
            pm2 restart all
`;
      break;

    case 'kubernetes':
      job += `
      - name: Set up kubectl
        uses: azure/setup-kubectl@v3

      - name: Configure kubectl
        run: |
          aws eks update-kubeconfig --name \${{ secrets.EKS_CLUSTER }} --region \${{ env.AWS_REGION }}

      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/app app=\${{ steps.login-ecr.outputs.registry }}/\${{ secrets.ECR_REPOSITORY }}:\${{ github.sha }}
          kubectl rollout status deployment/app
`;
      break;
  }

  return job;
}

/**
 * Get all GitHub tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};





