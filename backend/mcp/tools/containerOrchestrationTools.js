const logger = require('../../utils/logger');

/**
 * Unified Container Orchestration Tools
 * 
 * DESIGN PHILOSOPHY FOR FUTURE SCALABILITY:
 * ==========================================
 * 
 * This abstraction layer provides platform-agnostic container deployment tools.
 * Claude uses these high-level tools and the system routes to the appropriate
 * backend (Docker, ECS, EKS, GKE, AKS, etc.) based on configuration.
 * 
 * SUPPORTED PLATFORMS:
 * - local-docker: Docker on local machine
 * - ec2-docker: Docker on EC2 via SSH
 * - ecs-fargate: AWS ECS with Fargate
 * - eks: AWS Elastic Kubernetes Service
 * - gke: Google Kubernetes Engine (future)
 * - aks: Azure Kubernetes Service (future)
 * - k8s: Generic Kubernetes cluster
 * 
 * ADDING NEW PLATFORMS:
 * 1. Create new tools file (e.g., gkeTools.js, aksTools.js)
 * 2. Register in server.js
 * 3. Add platform handler in this file
 * 
 * This design ensures:
 * - Claude doesn't need to know implementation details
 * - Same prompts work across all platforms
 * - Easy to add new cloud providers
 * - Consistent deployment experience
 */

// Lazy load platform-specific tools
const platformHandlers = {};

async function getHandler(platform) {
  if (!platformHandlers[platform]) {
    switch (platform) {
      case 'local-docker':
      case 'docker':
        platformHandlers[platform] = require('./dockerTools');
        break;
      case 'ec2-docker':
      case 'ec2':
        platformHandlers[platform] = {
          ssh: require('./sshTools'),
          ec2: require('./ec2Tools')
        };
        break;
      case 'ecs':
      case 'ecs-fargate':
        platformHandlers[platform] = {
          ecs: require('./ecsTools'),
          ecr: require('./ecrTools')
        };
        break;
      case 'eks':
      case 'kubernetes':
      case 'k8s':
        platformHandlers[platform] = require('./kubernetesTools');
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }
  return platformHandlers[platform];
}

/**
 * Detect the current deployment target from environment/configuration
 */
function detectPlatform() {
  // Check environment variables
  if (process.env.DEPLOYMENT_PLATFORM) {
    return process.env.DEPLOYMENT_PLATFORM;
  }
  
  // Check for EKS cluster
  if (process.env.EKS_CLUSTER_NAME) {
    return 'eks';
  }
  
  // Check for ECS cluster
  if (process.env.ECS_CLUSTER_NAME) {
    return 'ecs-fargate';
  }
  
  // Check for kubeconfig
  if (process.env.KUBECONFIG) {
    return 'kubernetes';
  }
  
  // Default to local Docker
  return 'local-docker';
}

const tools = [
  {
    name: 'container_deploy',
    description: 'Deploy a containerized application to any supported platform. Automatically routes to the correct backend (Docker, ECS, Kubernetes) based on configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application name'
        },
        image: {
          type: 'string',
          description: 'Container image (e.g., nginx:latest, 123456.dkr.ecr.us-east-1.amazonaws.com/myapp:v1)'
        },
        platform: {
          type: 'string',
          enum: ['auto', 'local-docker', 'ec2-docker', 'ecs-fargate', 'eks', 'kubernetes'],
          description: 'Target platform (auto-detect if not specified)',
          default: 'auto'
        },
        port: {
          type: 'number',
          description: 'Container port',
          default: 3000
        },
        replicas: {
          type: 'number',
          description: 'Number of instances/replicas',
          default: 1
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variables (e.g., ["NODE_ENV=production"])'
        },
        resources: {
          type: 'object',
          properties: {
            cpu: { type: 'string', description: 'CPU (e.g., "256", "0.5", "500m")' },
            memory: { type: 'string', description: 'Memory (e.g., "512", "1Gi")' }
          },
          description: 'Resource limits'
        },
        expose: {
          type: 'boolean',
          description: 'Expose to external traffic',
          default: true
        },
        // Platform-specific options
        platformOptions: {
          type: 'object',
          description: 'Platform-specific configuration (passed to underlying handler)'
        }
      },
      required: ['name', 'image']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;
        
        logger.info(`Container deploy: ${args.name} to ${platform}`);

        switch (platform) {
          case 'local-docker':
          case 'docker': {
            const handler = await getHandler('local-docker');
            const dockerTools = handler.getTools();
            const runTool = dockerTools.find(t => t.name === 'docker_run');
            
            const ports = {};
            if (args.port) {
              ports[args.port] = args.port;
            }
            
            return await runTool.handler({
              image: args.image,
              name: args.name,
              ports,
              env: args.env || [],
              detach: true
            });
          }

          case 'ec2-docker':
          case 'ec2': {
            const handler = await getHandler('ec2-docker');
            const sshTools = handler.ssh.getTools();
            const deployTool = sshTools.find(t => t.name === 'ssh_deploy_docker_app');
            
            const host = args.platformOptions?.host || process.env.EC2_HOST;
            if (!host) {
              throw new Error('EC2 host not specified. Set EC2_HOST env var or platformOptions.host');
            }
            
            const ports = {};
            if (args.port) {
              ports[args.port] = args.port;
            }
            
            return await deployTool.handler({
              host,
              image: args.image,
              containerName: args.name,
              ports,
              env: args.env || [],
              username: args.platformOptions?.username || 'ubuntu',
              privateKeyPath: args.platformOptions?.privateKeyPath
            });
          }

          case 'ecs':
          case 'ecs-fargate': {
            const handler = await getHandler('ecs-fargate');
            const ecsTools = handler.ecs.getTools();
            const deployTool = ecsTools.find(t => t.name === 'ecs_deploy');
            
            const clusterName = args.platformOptions?.clusterName || process.env.ECS_CLUSTER_NAME;
            const subnets = args.platformOptions?.subnets || process.env.ECS_SUBNETS?.split(',');
            
            if (!clusterName) {
              throw new Error('ECS cluster not specified. Set ECS_CLUSTER_NAME env var or platformOptions.clusterName');
            }
            if (!subnets || subnets.length === 0) {
              throw new Error('ECS subnets not specified. Set ECS_SUBNETS env var or platformOptions.subnets');
            }
            
            // Convert env array to ECS format
            const environment = (args.env || []).map(e => {
              const [name, ...valueParts] = e.split('=');
              return { name, value: valueParts.join('=') };
            });
            
            return await deployTool.handler({
              clusterName,
              serviceName: args.name,
              imageUri: args.image,
              containerPort: args.port || 3000,
              cpu: args.resources?.cpu || '256',
              memory: args.resources?.memory || '512',
              environment,
              subnets,
              securityGroups: args.platformOptions?.securityGroups,
              desiredCount: args.replicas || 1
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            const deployTool = k8sTools.find(t => t.name === 'k8s_deploy');
            
            return await deployTool.handler({
              name: args.name,
              image: args.image,
              namespace: args.platformOptions?.namespace || 'default',
              replicas: args.replicas || 1,
              port: args.port || 3000,
              env: args.env || [],
              serviceType: args.expose ? 'LoadBalancer' : 'ClusterIP',
              resources: args.resources,
              ingressHost: args.platformOptions?.ingressHost,
              context: args.platformOptions?.context
            });
          }

          default:
            throw new Error(`Unsupported platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container deploy failed:', error);
        throw new Error(`Container deploy failed: ${error.message}`);
      }
    }
  },

  {
    name: 'container_scale',
    description: 'Scale a containerized application (change replica count)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application/service name'
        },
        replicas: {
          type: 'number',
          description: 'Desired number of replicas'
        },
        platform: {
          type: 'string',
          enum: ['auto', 'ecs-fargate', 'eks', 'kubernetes'],
          description: 'Target platform',
          default: 'auto'
        },
        platformOptions: {
          type: 'object',
          description: 'Platform-specific options'
        }
      },
      required: ['name', 'replicas']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;

        // Local Docker doesn't support scaling
        if (platform === 'local-docker' || platform === 'ec2-docker') {
          return {
            success: false,
            error: 'Scaling not supported for single Docker containers. Use ECS or Kubernetes for scaling.'
          };
        }

        switch (platform) {
          case 'ecs':
          case 'ecs-fargate': {
            const handler = await getHandler('ecs-fargate');
            const ecsTools = handler.ecs.getTools();
            const updateTool = ecsTools.find(t => t.name === 'ecs_update_service');
            
            return await updateTool.handler({
              clusterName: args.platformOptions?.clusterName || process.env.ECS_CLUSTER_NAME,
              serviceName: args.name,
              desiredCount: args.replicas
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            const scaleTool = k8sTools.find(t => t.name === 'k8s_scale');
            
            return await scaleTool.handler({
              name: args.name,
              replicas: args.replicas,
              namespace: args.platformOptions?.namespace || 'default',
              context: args.platformOptions?.context
            });
          }

          default:
            throw new Error(`Scaling not supported for platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container scale failed:', error);
        throw new Error(`Container scale failed: ${error.message}`);
      }
    }
  },

  {
    name: 'container_rollback',
    description: 'Rollback a containerized application to a previous version',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application/service name'
        },
        targetImage: {
          type: 'string',
          description: 'Image to rollback to (for Docker/ECS)'
        },
        revision: {
          type: 'number',
          description: 'Revision number to rollback to (for Kubernetes)'
        },
        platform: {
          type: 'string',
          enum: ['auto', 'ec2-docker', 'ecs-fargate', 'eks', 'kubernetes'],
          description: 'Target platform',
          default: 'auto'
        },
        platformOptions: {
          type: 'object',
          description: 'Platform-specific options'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;

        switch (platform) {
          case 'local-docker': {
            // For local docker, we need to stop current and start with previous image
            if (!args.targetImage) {
              return {
                success: false,
                error: 'targetImage is required for Docker rollback'
              };
            }
            
            const handler = await getHandler('local-docker');
            const dockerTools = handler.getTools();
            
            // Stop current
            const stopTool = dockerTools.find(t => t.name === 'docker_stop');
            await stopTool.handler({ containerId: args.name }).catch(() => {});
            
            // Remove current
            const removeTool = dockerTools.find(t => t.name === 'docker_remove');
            await removeTool.handler({ containerId: args.name, force: true }).catch(() => {});
            
            // Run previous image
            const runTool = dockerTools.find(t => t.name === 'docker_run');
            return await runTool.handler({
              image: args.targetImage,
              name: args.name,
              detach: true
            });
          }

          case 'ec2-docker':
          case 'ec2': {
            if (!args.targetImage) {
              return {
                success: false,
                error: 'targetImage is required for EC2 Docker rollback'
              };
            }
            
            const handler = await getHandler('ec2-docker');
            const sshTools = handler.ssh.getTools();
            const rollbackTool = sshTools.find(t => t.name === 'ssh_rollback_docker');
            
            return await rollbackTool.handler({
              host: args.platformOptions?.host || process.env.EC2_HOST,
              containerName: args.name,
              targetImage: args.targetImage,
              username: args.platformOptions?.username || 'ubuntu'
            });
          }

          case 'ecs':
          case 'ecs-fargate': {
            // For ECS, we update the service with the previous task definition or image
            if (!args.targetImage) {
              return {
                success: false,
                error: 'targetImage is required for ECS rollback'
              };
            }
            
            // Re-deploy with old image
            const handler = await getHandler('ecs-fargate');
            const ecsTools = handler.ecs.getTools();
            const deployTool = ecsTools.find(t => t.name === 'ecs_deploy');
            
            return await deployTool.handler({
              clusterName: args.platformOptions?.clusterName || process.env.ECS_CLUSTER_NAME,
              serviceName: args.name,
              imageUri: args.targetImage,
              subnets: args.platformOptions?.subnets || process.env.ECS_SUBNETS?.split(',')
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            const rollbackTool = k8sTools.find(t => t.name === 'k8s_rollback');
            
            return await rollbackTool.handler({
              name: args.name,
              revision: args.revision,
              namespace: args.platformOptions?.namespace || 'default',
              context: args.platformOptions?.context
            });
          }

          default:
            throw new Error(`Rollback not supported for platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container rollback failed:', error);
        throw new Error(`Container rollback failed: ${error.message}`);
      }
    }
  },

  {
    name: 'container_status',
    description: 'Get the status of a containerized application across any platform',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application/service name'
        },
        platform: {
          type: 'string',
          enum: ['auto', 'local-docker', 'ec2-docker', 'ecs-fargate', 'eks', 'kubernetes'],
          description: 'Target platform',
          default: 'auto'
        },
        platformOptions: {
          type: 'object',
          description: 'Platform-specific options'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;

        switch (platform) {
          case 'local-docker':
          case 'docker': {
            const handler = await getHandler('local-docker');
            const dockerTools = handler.getTools();
            const inspectTool = dockerTools.find(t => t.name === 'docker_inspect');
            const healthTool = dockerTools.find(t => t.name === 'docker_health_check');
            
            const [inspectResult, healthResult] = await Promise.all([
              inspectTool.handler({ containerId: args.name }).catch(() => null),
              healthTool.handler({ containerId: args.name }).catch(() => null)
            ]);
            
            return {
              success: true,
              platform,
              name: args.name,
              running: healthResult?.isRunning || false,
              healthy: healthResult?.healthy || false,
              status: healthResult?.status || 'unknown',
              container: inspectResult?.container
            };
          }

          case 'ec2-docker':
          case 'ec2': {
            const handler = await getHandler('ec2-docker');
            const sshTools = handler.ssh.getTools();
            const healthTool = sshTools.find(t => t.name === 'ssh_check_service_health');
            
            return await healthTool.handler({
              host: args.platformOptions?.host || process.env.EC2_HOST,
              username: args.platformOptions?.username || 'ubuntu'
            });
          }

          case 'ecs':
          case 'ecs-fargate': {
            const handler = await getHandler('ecs-fargate');
            const ecsTools = handler.ecs.getTools();
            const describeTool = ecsTools.find(t => t.name === 'ecs_describe_services');
            
            return await describeTool.handler({
              clusterName: args.platformOptions?.clusterName || process.env.ECS_CLUSTER_NAME,
              serviceNames: [args.name]
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            
            const deploymentsTool = k8sTools.find(t => t.name === 'k8s_get_deployments');
            const podsTool = k8sTools.find(t => t.name === 'k8s_get_pods');
            
            const [deploymentsResult, podsResult] = await Promise.all([
              deploymentsTool.handler({
                namespace: args.platformOptions?.namespace || 'default',
                context: args.platformOptions?.context
              }),
              podsTool.handler({
                namespace: args.platformOptions?.namespace || 'default',
                selector: `app=${args.name}`,
                context: args.platformOptions?.context
              })
            ]);
            
            const deployment = deploymentsResult.deployments?.find(d => d.name === args.name);
            
            return {
              success: true,
              platform,
              name: args.name,
              deployment,
              pods: podsResult.pods,
              healthy: deployment?.ready === deployment?.replicas
            };
          }

          default:
            throw new Error(`Status not supported for platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container status failed:', error);
        throw new Error(`Container status failed: ${error.message}`);
      }
    }
  },

  {
    name: 'container_logs',
    description: 'Get logs from a containerized application across any platform',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application/container/pod name'
        },
        tail: {
          type: 'number',
          description: 'Number of log lines to retrieve',
          default: 100
        },
        platform: {
          type: 'string',
          enum: ['auto', 'local-docker', 'ec2-docker', 'eks', 'kubernetes'],
          description: 'Target platform',
          default: 'auto'
        },
        platformOptions: {
          type: 'object',
          description: 'Platform-specific options'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;

        switch (platform) {
          case 'local-docker':
          case 'docker': {
            const handler = await getHandler('local-docker');
            const dockerTools = handler.getTools();
            const logsTool = dockerTools.find(t => t.name === 'docker_stream_logs');
            
            return await logsTool.handler({
              containerId: args.name,
              tail: args.tail || 100
            });
          }

          case 'ec2-docker':
          case 'ec2': {
            const handler = await getHandler('ec2-docker');
            const sshTools = handler.ssh.getTools();
            const logsTool = sshTools.find(t => t.name === 'ssh_get_logs');
            
            return await logsTool.handler({
              host: args.platformOptions?.host || process.env.EC2_HOST,
              source: 'docker',
              target: args.name,
              lines: args.tail || 100
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            const logsTool = k8sTools.find(t => t.name === 'k8s_logs');
            
            // For K8s, we need to get pod name from deployment
            const podsTool = k8sTools.find(t => t.name === 'k8s_get_pods');
            const podsResult = await podsTool.handler({
              namespace: args.platformOptions?.namespace || 'default',
              selector: `app=${args.name}`,
              context: args.platformOptions?.context
            });
            
            if (!podsResult.pods || podsResult.pods.length === 0) {
              return {
                success: false,
                error: `No pods found for ${args.name}`
              };
            }
            
            // Get logs from first pod
            return await logsTool.handler({
              podName: podsResult.pods[0].name,
              namespace: args.platformOptions?.namespace || 'default',
              tail: args.tail || 100,
              context: args.platformOptions?.context
            });
          }

          default:
            throw new Error(`Logs not supported for platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container logs failed:', error);
        throw new Error(`Container logs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'container_delete',
    description: 'Delete/remove a containerized application',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Application/service name'
        },
        platform: {
          type: 'string',
          enum: ['auto', 'local-docker', 'ec2-docker', 'ecs-fargate', 'eks', 'kubernetes'],
          description: 'Target platform',
          default: 'auto'
        },
        platformOptions: {
          type: 'object',
          description: 'Platform-specific options'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const platform = args.platform === 'auto' ? detectPlatform() : args.platform;

        switch (platform) {
          case 'local-docker':
          case 'docker': {
            const handler = await getHandler('local-docker');
            const dockerTools = handler.getTools();
            
            const stopTool = dockerTools.find(t => t.name === 'docker_stop');
            await stopTool.handler({ containerId: args.name }).catch(() => {});
            
            const removeTool = dockerTools.find(t => t.name === 'docker_remove');
            return await removeTool.handler({ containerId: args.name, force: true });
          }

          case 'ec2-docker':
          case 'ec2': {
            const handler = await getHandler('ec2-docker');
            const sshTools = handler.ssh.getTools();
            const execTool = sshTools.find(t => t.name === 'ssh_execute');
            
            return await execTool.handler({
              host: args.platformOptions?.host || process.env.EC2_HOST,
              command: `docker stop ${args.name} && docker rm ${args.name}`,
              username: args.platformOptions?.username || 'ubuntu'
            });
          }

          case 'ecs':
          case 'ecs-fargate': {
            const handler = await getHandler('ecs-fargate');
            const ecsTools = handler.ecs.getTools();
            const deleteTool = ecsTools.find(t => t.name === 'ecs_delete_service');
            
            return await deleteTool.handler({
              clusterName: args.platformOptions?.clusterName || process.env.ECS_CLUSTER_NAME,
              serviceName: args.name,
              force: true
            });
          }

          case 'eks':
          case 'kubernetes':
          case 'k8s': {
            const handler = await getHandler('kubernetes');
            const k8sTools = handler.getTools();
            const deleteTool = k8sTools.find(t => t.name === 'k8s_delete');
            
            // Delete deployment and service
            await deleteTool.handler({
              resourceType: 'service',
              name: args.name,
              namespace: args.platformOptions?.namespace || 'default',
              context: args.platformOptions?.context
            }).catch(() => {});
            
            return await deleteTool.handler({
              resourceType: 'deployment',
              name: args.name,
              namespace: args.platformOptions?.namespace || 'default',
              context: args.platformOptions?.context
            });
          }

          default:
            throw new Error(`Delete not supported for platform: ${platform}`);
        }
      } catch (error) {
        logger.error('Container delete failed:', error);
        throw new Error(`Container delete failed: ${error.message}`);
      }
    }
  },

  {
    name: 'list_platforms',
    description: 'List available container platforms and their status',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      const platforms = [];
      
      // Check local Docker
      try {
        const { spawn } = require('child_process');
        const proc = spawn('docker', ['version', '--format', '{{.Server.Version}}']);
        let version = '';
        proc.stdout.on('data', (d) => { version += d.toString(); });
        await new Promise((resolve) => proc.on('close', resolve));
        
        platforms.push({
          name: 'local-docker',
          available: !!version.trim(),
          version: version.trim() || null,
          description: 'Docker on local machine'
        });
      } catch {
        platforms.push({
          name: 'local-docker',
          available: false,
          description: 'Docker on local machine'
        });
      }
      
      // Check kubectl
      try {
        const { spawn } = require('child_process');
        const proc = spawn('kubectl', ['version', '--client', '-o', 'json']);
        let output = '';
        proc.stdout.on('data', (d) => { output += d.toString(); });
        await new Promise((resolve) => proc.on('close', resolve));
        
        const version = output ? JSON.parse(output).clientVersion?.gitVersion : null;
        platforms.push({
          name: 'kubernetes',
          available: !!version,
          version,
          description: 'Kubernetes cluster (via kubectl)'
        });
      } catch {
        platforms.push({
          name: 'kubernetes',
          available: false,
          description: 'Kubernetes cluster (via kubectl)'
        });
      }
      
      // Check AWS credentials for ECS
      platforms.push({
        name: 'ecs-fargate',
        available: !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE),
        configured: !!process.env.ECS_CLUSTER_NAME,
        description: 'AWS ECS with Fargate'
      });
      
      // Check EC2
      platforms.push({
        name: 'ec2-docker',
        available: !!(process.env.EC2_HOST || process.env.SSH_KEY_PATH),
        configured: !!process.env.EC2_HOST,
        description: 'Docker on EC2 via SSH'
      });
      
      return {
        success: true,
        currentPlatform: detectPlatform(),
        platforms
      };
    }
  }
];

/**
 * Get all unified container orchestration tools
 */
const getTools = () => tools;

module.exports = {
  getTools,
  detectPlatform
};


