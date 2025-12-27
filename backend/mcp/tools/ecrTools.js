const { spawn } = require('child_process');
const logger = require('../../utils/logger');

/**
 * ECR (Elastic Container Registry) MCP Tools
 * These tools enable Claude to push Docker images to AWS ECR
 * and manage container registries for deployments
 */

// Lazy load AWS SDK v3 modules
let ECRClient, CreateRepositoryCommand, DescribeRepositoriesCommand,
    DeleteRepositoryCommand, GetAuthorizationTokenCommand,
    DescribeImagesCommand, BatchDeleteImageCommand, ListImagesCommand,
    PutLifecyclePolicyCommand, GetRepositoryPolicyCommand,
    SetRepositoryPolicyCommand;

async function getECRClient() {
  if (!ECRClient) {
    const sdk = await import('@aws-sdk/client-ecr');
    ECRClient = sdk.ECRClient;
    CreateRepositoryCommand = sdk.CreateRepositoryCommand;
    DescribeRepositoriesCommand = sdk.DescribeRepositoriesCommand;
    DeleteRepositoryCommand = sdk.DeleteRepositoryCommand;
    GetAuthorizationTokenCommand = sdk.GetAuthorizationTokenCommand;
    DescribeImagesCommand = sdk.DescribeImagesCommand;
    BatchDeleteImageCommand = sdk.BatchDeleteImageCommand;
    ListImagesCommand = sdk.ListImagesCommand;
    PutLifecyclePolicyCommand = sdk.PutLifecyclePolicyCommand;
    GetRepositoryPolicyCommand = sdk.GetRepositoryPolicyCommand;
    SetRepositoryPolicyCommand = sdk.SetRepositoryPolicyCommand;
  }

  return new ECRClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
  });
}

/**
 * Execute Docker command with streaming output
 */
function execDockerCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', args, options);
    const stdout = [];
    const stderr = [];

    proc.stdout.on('data', (data) => stdout.push(data.toString()));
    proc.stderr.on('data', (data) => stderr.push(data.toString()));

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.join(''),
        stderr: stderr.join('')
      });
    });

    proc.on('error', reject);
  });
}

const tools = [
  {
    name: 'ecr_create_repository',
    description: 'Create a new ECR repository for storing Docker images',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryName: {
          type: 'string',
          description: 'Name for the ECR repository (e.g., myapp, myapp/frontend)'
        },
        imageScanOnPush: {
          type: 'boolean',
          description: 'Enable image scanning on push',
          default: true
        },
        imageTagMutability: {
          type: 'string',
          enum: ['MUTABLE', 'IMMUTABLE'],
          description: 'Whether tags can be overwritten',
          default: 'MUTABLE'
        },
        encryptionType: {
          type: 'string',
          enum: ['AES256', 'KMS'],
          description: 'Encryption type for images',
          default: 'AES256'
        },
        lifecyclePolicy: {
          type: 'object',
          properties: {
            maxImageCount: { type: 'number' },
            maxImageAge: { type: 'number' }
          },
          description: 'Lifecycle policy to auto-delete old images'
        }
      },
      required: ['repositoryName']
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();

        const createParams = {
          repositoryName: args.repositoryName,
          imageScanningConfiguration: {
            scanOnPush: args.imageScanOnPush !== false
          },
          imageTagMutability: args.imageTagMutability || 'MUTABLE',
          encryptionConfiguration: {
            encryptionType: args.encryptionType || 'AES256'
          }
        };

        const result = await client.send(new CreateRepositoryCommand(createParams));
        const repo = result.repository;

        logger.info(`ECR repository created: ${repo.repositoryUri}`);

        // Apply lifecycle policy if specified
        if (args.lifecyclePolicy) {
          const policyRules = [];
          
          if (args.lifecyclePolicy.maxImageCount) {
            policyRules.push({
              rulePriority: 1,
              description: 'Keep only last N images',
              selection: {
                tagStatus: 'any',
                countType: 'imageCountMoreThan',
                countNumber: args.lifecyclePolicy.maxImageCount
              },
              action: { type: 'expire' }
            });
          }

          if (args.lifecyclePolicy.maxImageAge) {
            policyRules.push({
              rulePriority: 2,
              description: 'Expire images older than N days',
              selection: {
                tagStatus: 'untagged',
                countType: 'sinceImagePushed',
                countUnit: 'days',
                countNumber: args.lifecyclePolicy.maxImageAge
              },
              action: { type: 'expire' }
            });
          }

          if (policyRules.length > 0) {
            await client.send(new PutLifecyclePolicyCommand({
              repositoryName: args.repositoryName,
              lifecyclePolicyText: JSON.stringify({ rules: policyRules })
            }));
          }
        }

        return {
          success: true,
          repositoryName: repo.repositoryName,
          repositoryUri: repo.repositoryUri,
          repositoryArn: repo.repositoryArn,
          registryId: repo.registryId,
          createdAt: repo.createdAt,
          message: `Repository created: ${repo.repositoryUri}`
        };
      } catch (error) {
        if (error.name === 'RepositoryAlreadyExistsException') {
          // Get existing repo info
          const client = await getECRClient();
          const describeResult = await client.send(new DescribeRepositoriesCommand({
            repositoryNames: [args.repositoryName]
          }));
          const repo = describeResult.repositories[0];
          
          return {
            success: true,
            alreadyExists: true,
            repositoryName: repo.repositoryName,
            repositoryUri: repo.repositoryUri,
            message: `Repository already exists: ${repo.repositoryUri}`
          };
        }
        logger.error('ECR create repository failed:', error);
        throw new Error(`ECR create repository failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_get_login',
    description: 'Get ECR login credentials and authenticate Docker client',
    inputSchema: {
      type: 'object',
      properties: {
        loginDocker: {
          type: 'boolean',
          description: 'Automatically run docker login command',
          default: true
        }
      }
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();
        const region = process.env.AWS_REGION || 'us-east-1';

        const result = await client.send(new GetAuthorizationTokenCommand({}));
        const authData = result.authorizationData[0];
        
        // Decode auth token (base64 encoded username:password)
        const token = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
        const [username, password] = token.split(':');
        const proxyEndpoint = authData.proxyEndpoint;

        // Run docker login if requested
        if (args.loginDocker !== false) {
          const loginResult = await execDockerCommand([
            'login',
            '--username', username,
            '--password-stdin',
            proxyEndpoint
          ], {
            input: password
          });

          // Use password via stdin for security
          const proc = spawn('docker', [
            'login',
            '--username', username,
            '--password-stdin',
            proxyEndpoint
          ]);

          proc.stdin.write(password);
          proc.stdin.end();

          await new Promise((resolve, reject) => {
            proc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Docker login failed with code ${code}`));
            });
            proc.on('error', reject);
          });

          logger.info(`Docker logged in to ECR: ${proxyEndpoint}`);
        }

        return {
          success: true,
          registryUrl: proxyEndpoint,
          expiresAt: authData.expiresAt,
          region,
          dockerLoggedIn: args.loginDocker !== false,
          message: `ECR authentication successful. Registry: ${proxyEndpoint}`
        };
      } catch (error) {
        logger.error('ECR get login failed:', error);
        throw new Error(`ECR get login failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_push_image',
    description: 'Build, tag, and push a Docker image to ECR. This is a high-level tool that handles the full workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryName: {
          type: 'string',
          description: 'ECR repository name'
        },
        localImage: {
          type: 'string',
          description: 'Local image name to push (e.g., myapp:latest)'
        },
        tag: {
          type: 'string',
          description: 'Tag for the ECR image',
          default: 'latest'
        },
        buildContext: {
          type: 'string',
          description: 'Path to build context (if building before push)'
        },
        dockerfile: {
          type: 'string',
          description: 'Dockerfile path (if building)',
          default: 'Dockerfile'
        },
        createRepoIfNotExists: {
          type: 'boolean',
          description: 'Create repository if it does not exist',
          default: true
        }
      },
      required: ['repositoryName']
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();
        const region = process.env.AWS_REGION || 'us-east-1';

        // Step 1: Ensure repository exists
        let repoUri;
        try {
          const describeResult = await client.send(new DescribeRepositoriesCommand({
            repositoryNames: [args.repositoryName]
          }));
          repoUri = describeResult.repositories[0].repositoryUri;
        } catch (error) {
          if (error.name === 'RepositoryNotFoundException' && args.createRepoIfNotExists !== false) {
            const createResult = await client.send(new CreateRepositoryCommand({
              repositoryName: args.repositoryName,
              imageScanningConfiguration: { scanOnPush: true }
            }));
            repoUri = createResult.repository.repositoryUri;
            logger.info(`Created ECR repository: ${repoUri}`);
          } else {
            throw error;
          }
        }

        // Step 2: Get ECR login
        const authResult = await client.send(new GetAuthorizationTokenCommand({}));
        const authData = authResult.authorizationData[0];
        const token = Buffer.from(authData.authorizationToken, 'base64').toString('utf-8');
        const [username, password] = token.split(':');
        const registryUrl = authData.proxyEndpoint;

        // Docker login
        const loginProc = spawn('docker', ['login', '--username', username, '--password-stdin', registryUrl]);
        loginProc.stdin.write(password);
        loginProc.stdin.end();
        await new Promise((resolve, reject) => {
          loginProc.on('close', (code) => code === 0 ? resolve() : reject(new Error('Docker login failed')));
          loginProc.on('error', reject);
        });

        // Step 3: Build if context provided
        const tag = args.tag || 'latest';
        const fullImageUri = `${repoUri}:${tag}`;
        let localImage = args.localImage;

        if (args.buildContext) {
          const buildArgs = ['build', '-t', fullImageUri];
          if (args.dockerfile) {
            buildArgs.push('-f', args.dockerfile);
          }
          buildArgs.push(args.buildContext);

          logger.info(`Building image: ${fullImageUri}`);
          const buildResult = await execDockerCommand(buildArgs);
          
          if (!buildResult.success) {
            return {
              success: false,
              stage: 'build',
              error: buildResult.stderr,
              exitCode: buildResult.exitCode
            };
          }
          localImage = fullImageUri;
        } else if (localImage) {
          // Tag existing image
          const tagResult = await execDockerCommand(['tag', localImage, fullImageUri]);
          if (!tagResult.success) {
            return {
              success: false,
              stage: 'tag',
              error: tagResult.stderr
            };
          }
        }

        // Step 4: Push to ECR
        logger.info(`Pushing image to ECR: ${fullImageUri}`);
        const pushResult = await execDockerCommand(['push', fullImageUri]);

        if (!pushResult.success) {
          return {
            success: false,
            stage: 'push',
            error: pushResult.stderr,
            exitCode: pushResult.exitCode
          };
        }

        // Step 5: Get image digest
        const imagesResult = await client.send(new DescribeImagesCommand({
          repositoryName: args.repositoryName,
          imageIds: [{ imageTag: tag }]
        }));
        const imageDigest = imagesResult.imageDetails?.[0]?.imageDigest;

        return {
          success: true,
          repositoryName: args.repositoryName,
          imageUri: fullImageUri,
          imageDigest,
          tag,
          registryUrl: repoUri.split('/')[0],
          pushedAt: new Date().toISOString(),
          message: `Image pushed successfully: ${fullImageUri}`
        };
      } catch (error) {
        logger.error('ECR push image failed:', error);
        throw new Error(`ECR push image failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_list_images',
    description: 'List images in an ECR repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryName: {
          type: 'string',
          description: 'ECR repository name'
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of images to return',
          default: 20
        }
      },
      required: ['repositoryName']
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();

        const result = await client.send(new DescribeImagesCommand({
          repositoryName: args.repositoryName,
          maxResults: args.maxResults || 20
        }));

        const images = (result.imageDetails || [])
          .sort((a, b) => new Date(b.imagePushedAt) - new Date(a.imagePushedAt))
          .map(img => ({
            tags: img.imageTags || [],
            digest: img.imageDigest,
            pushedAt: img.imagePushedAt,
            sizeBytes: img.imageSizeInBytes,
            sizeMB: Math.round(img.imageSizeInBytes / 1024 / 1024 * 10) / 10,
            scanStatus: img.imageScanStatus?.status,
            vulnerabilities: img.imageScanFindingsSummary?.findingSeverityCounts
          }));

        return {
          success: true,
          repositoryName: args.repositoryName,
          imageCount: images.length,
          images
        };
      } catch (error) {
        logger.error('ECR list images failed:', error);
        throw new Error(`ECR list images failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_delete_images',
    description: 'Delete images from an ECR repository',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryName: {
          type: 'string',
          description: 'ECR repository name'
        },
        imageTags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Image tags to delete'
        },
        imageDigests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Image digests to delete'
        }
      },
      required: ['repositoryName']
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();

        const imageIds = [];
        
        if (args.imageTags) {
          imageIds.push(...args.imageTags.map(tag => ({ imageTag: tag })));
        }
        
        if (args.imageDigests) {
          imageIds.push(...args.imageDigests.map(digest => ({ imageDigest: digest })));
        }

        if (imageIds.length === 0) {
          return {
            success: false,
            error: 'No image tags or digests specified'
          };
        }

        const result = await client.send(new BatchDeleteImageCommand({
          repositoryName: args.repositoryName,
          imageIds
        }));

        return {
          success: true,
          repositoryName: args.repositoryName,
          deletedCount: result.imageIds?.length || 0,
          failures: result.failures?.map(f => ({
            imageId: f.imageId,
            reason: f.failureReason
          })) || []
        };
      } catch (error) {
        logger.error('ECR delete images failed:', error);
        throw new Error(`ECR delete images failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_describe_repositories',
    description: 'List and describe ECR repositories',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific repository names to describe (omit for all)'
        }
      }
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();

        const params = {};
        if (args.repositoryNames?.length > 0) {
          params.repositoryNames = args.repositoryNames;
        }

        const result = await client.send(new DescribeRepositoriesCommand(params));

        const repositories = (result.repositories || []).map(repo => ({
          repositoryName: repo.repositoryName,
          repositoryUri: repo.repositoryUri,
          repositoryArn: repo.repositoryArn,
          createdAt: repo.createdAt,
          imageTagMutability: repo.imageTagMutability,
          scanOnPush: repo.imageScanningConfiguration?.scanOnPush
        }));

        return {
          success: true,
          count: repositories.length,
          repositories
        };
      } catch (error) {
        logger.error('ECR describe repositories failed:', error);
        throw new Error(`ECR describe repositories failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecr_get_image_uri',
    description: 'Get the full URI for an ECR image (useful for ECS/EKS deployments)',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryName: {
          type: 'string',
          description: 'ECR repository name'
        },
        tag: {
          type: 'string',
          description: 'Image tag',
          default: 'latest'
        }
      },
      required: ['repositoryName']
    },
    handler: async (args) => {
      try {
        const client = await getECRClient();

        const result = await client.send(new DescribeRepositoriesCommand({
          repositoryNames: [args.repositoryName]
        }));

        const repo = result.repositories[0];
        const tag = args.tag || 'latest';
        const imageUri = `${repo.repositoryUri}:${tag}`;

        return {
          success: true,
          repositoryName: args.repositoryName,
          repositoryUri: repo.repositoryUri,
          tag,
          imageUri,
          message: `Use this URI for deployments: ${imageUri}`
        };
      } catch (error) {
        logger.error('ECR get image URI failed:', error);
        throw new Error(`ECR get image URI failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all ECR tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};


