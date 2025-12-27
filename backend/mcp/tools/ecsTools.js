const logger = require('../../utils/logger');

/**
 * ECS (Elastic Container Service) MCP Tools
 * These tools enable Claude to deploy and manage containers on AWS ECS
 * Supports both Fargate (serverless) and EC2 launch types
 */

// Lazy load AWS SDK v3 modules
let ECSClient, CreateClusterCommand, DescribeClustersCommand, DeleteClusterCommand,
    RegisterTaskDefinitionCommand, DescribeTaskDefinitionCommand, ListTaskDefinitionsCommand,
    CreateServiceCommand, UpdateServiceCommand, DescribeServicesCommand, DeleteServiceCommand,
    RunTaskCommand, StopTaskCommand, DescribeTasksCommand, ListTasksCommand,
    ListServicesCommand, ListClustersCommand, DeregisterTaskDefinitionCommand;

async function getECSClient() {
  if (!ECSClient) {
    const sdk = await import('@aws-sdk/client-ecs');
    ECSClient = sdk.ECSClient;
    CreateClusterCommand = sdk.CreateClusterCommand;
    DescribeClustersCommand = sdk.DescribeClustersCommand;
    DeleteClusterCommand = sdk.DeleteClusterCommand;
    RegisterTaskDefinitionCommand = sdk.RegisterTaskDefinitionCommand;
    DescribeTaskDefinitionCommand = sdk.DescribeTaskDefinitionCommand;
    ListTaskDefinitionsCommand = sdk.ListTaskDefinitionsCommand;
    CreateServiceCommand = sdk.CreateServiceCommand;
    UpdateServiceCommand = sdk.UpdateServiceCommand;
    DescribeServicesCommand = sdk.DescribeServicesCommand;
    DeleteServiceCommand = sdk.DeleteServiceCommand;
    RunTaskCommand = sdk.RunTaskCommand;
    StopTaskCommand = sdk.StopTaskCommand;
    DescribeTasksCommand = sdk.DescribeTasksCommand;
    ListTasksCommand = sdk.ListTasksCommand;
    ListServicesCommand = sdk.ListServicesCommand;
    ListClustersCommand = sdk.ListClustersCommand;
    DeregisterTaskDefinitionCommand = sdk.DeregisterTaskDefinitionCommand;
  }

  return new ECSClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined
  });
}

/**
 * Wait for service to reach stable state
 */
async function waitForServiceStable(client, clusterName, serviceName, maxWait = 300) {
  const startTime = Date.now();
  const checkInterval = 10000; // 10 seconds

  while (Date.now() - startTime < maxWait * 1000) {
    const result = await client.send(new DescribeServicesCommand({
      cluster: clusterName,
      services: [serviceName]
    }));

    const service = result.services?.[0];
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    // Check if service is stable
    const runningCount = service.runningCount || 0;
    const desiredCount = service.desiredCount || 0;
    const pendingCount = service.pendingCount || 0;

    if (runningCount === desiredCount && pendingCount === 0) {
      return {
        stable: true,
        runningCount,
        desiredCount,
        status: service.status
      };
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  return { stable: false, timeout: true };
}

const tools = [
  {
    name: 'ecs_create_cluster',
    description: 'Create an ECS cluster for running containers',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'Name for the ECS cluster'
        },
        capacityProviders: {
          type: 'array',
          items: { type: 'string' },
          description: 'Capacity providers (e.g., ["FARGATE", "FARGATE_SPOT"])',
          default: ['FARGATE', 'FARGATE_SPOT']
        },
        containerInsights: {
          type: 'boolean',
          description: 'Enable CloudWatch Container Insights',
          default: true
        },
        tags: {
          type: 'object',
          description: 'Tags for the cluster'
        }
      },
      required: ['clusterName']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const createParams = {
          clusterName: args.clusterName,
          capacityProviders: args.capacityProviders || ['FARGATE', 'FARGATE_SPOT'],
          defaultCapacityProviderStrategy: [
            { capacityProvider: 'FARGATE', weight: 1, base: 1 },
            { capacityProvider: 'FARGATE_SPOT', weight: 4 }
          ],
          settings: [
            {
              name: 'containerInsights',
              value: args.containerInsights !== false ? 'enabled' : 'disabled'
            }
          ],
          tags: Object.entries(args.tags || {}).map(([key, value]) => ({
            key,
            value: String(value)
          }))
        };

        createParams.tags.push(
          { key: 'ManagedBy', value: 'deployment-agent' },
          { key: 'CreatedAt', value: new Date().toISOString() }
        );

        const result = await client.send(new CreateClusterCommand(createParams));
        const cluster = result.cluster;

        logger.info(`ECS cluster created: ${cluster.clusterArn}`);

        return {
          success: true,
          clusterName: cluster.clusterName,
          clusterArn: cluster.clusterArn,
          status: cluster.status,
          capacityProviders: cluster.capacityProviders,
          containerInsightsEnabled: args.containerInsights !== false,
          message: `Cluster ${cluster.clusterName} created successfully`
        };
      } catch (error) {
        logger.error('ECS create cluster failed:', error);
        throw new Error(`ECS create cluster failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_register_task_definition',
    description: 'Register a task definition (container configuration) for ECS',
    inputSchema: {
      type: 'object',
      properties: {
        family: {
          type: 'string',
          description: 'Task definition family name'
        },
        containerDefinitions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              image: { type: 'string' },
              cpu: { type: 'number' },
              memory: { type: 'number' },
              portMappings: { type: 'array' },
              environment: { type: 'array' },
              essential: { type: 'boolean' }
            }
          },
          description: 'Container definitions'
        },
        cpu: {
          type: 'string',
          description: 'Task CPU (e.g., "256", "512", "1024")',
          default: '256'
        },
        memory: {
          type: 'string',
          description: 'Task memory (e.g., "512", "1024", "2048")',
          default: '512'
        },
        networkMode: {
          type: 'string',
          enum: ['awsvpc', 'bridge', 'host', 'none'],
          description: 'Network mode',
          default: 'awsvpc'
        },
        executionRoleArn: {
          type: 'string',
          description: 'Execution role ARN (for pulling images, logging)'
        },
        taskRoleArn: {
          type: 'string',
          description: 'Task role ARN (for container AWS access)'
        }
      },
      required: ['family', 'containerDefinitions']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        // Build container definitions with defaults
        const containerDefinitions = args.containerDefinitions.map(container => ({
          name: container.name,
          image: container.image,
          cpu: container.cpu || 256,
          memory: container.memory || 512,
          essential: container.essential !== false,
          portMappings: (container.portMappings || []).map(pm => ({
            containerPort: pm.containerPort || pm,
            hostPort: pm.hostPort || pm.containerPort || pm,
            protocol: pm.protocol || 'tcp'
          })),
          environment: (container.environment || []).map(env => {
            if (typeof env === 'string') {
              const [name, ...valueParts] = env.split('=');
              return { name, value: valueParts.join('=') };
            }
            return env;
          }),
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': `/ecs/${args.family}`,
              'awslogs-region': process.env.AWS_REGION || 'us-east-1',
              'awslogs-stream-prefix': container.name,
              'awslogs-create-group': 'true'
            }
          }
        }));

        const registerParams = {
          family: args.family,
          containerDefinitions,
          networkMode: args.networkMode || 'awsvpc',
          requiresCompatibilities: ['FARGATE'],
          cpu: args.cpu || '256',
          memory: args.memory || '512',
          runtimePlatform: {
            cpuArchitecture: 'X86_64',
            operatingSystemFamily: 'LINUX'
          }
        };

        if (args.executionRoleArn) {
          registerParams.executionRoleArn = args.executionRoleArn;
        }

        if (args.taskRoleArn) {
          registerParams.taskRoleArn = args.taskRoleArn;
        }

        const result = await client.send(new RegisterTaskDefinitionCommand(registerParams));
        const taskDef = result.taskDefinition;

        logger.info(`Task definition registered: ${taskDef.taskDefinitionArn}`);

        return {
          success: true,
          family: taskDef.family,
          revision: taskDef.revision,
          taskDefinitionArn: taskDef.taskDefinitionArn,
          status: taskDef.status,
          containerCount: taskDef.containerDefinitions.length,
          cpu: taskDef.cpu,
          memory: taskDef.memory,
          message: `Task definition ${taskDef.family}:${taskDef.revision} registered`
        };
      } catch (error) {
        logger.error('ECS register task definition failed:', error);
        throw new Error(`ECS register task definition failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_create_service',
    description: 'Create an ECS service to run and maintain containers',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceName: {
          type: 'string',
          description: 'Service name'
        },
        taskDefinition: {
          type: 'string',
          description: 'Task definition family:revision or ARN'
        },
        desiredCount: {
          type: 'number',
          description: 'Number of tasks to run',
          default: 1
        },
        subnets: {
          type: 'array',
          items: { type: 'string' },
          description: 'VPC subnet IDs'
        },
        securityGroups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Security group IDs'
        },
        assignPublicIp: {
          type: 'boolean',
          description: 'Assign public IP to tasks',
          default: true
        },
        loadBalancerTargetGroupArn: {
          type: 'string',
          description: 'ALB target group ARN (optional)'
        },
        containerName: {
          type: 'string',
          description: 'Container name for load balancer (required if using LB)'
        },
        containerPort: {
          type: 'number',
          description: 'Container port for load balancer'
        },
        enableExecuteCommand: {
          type: 'boolean',
          description: 'Enable ECS Exec for debugging',
          default: true
        }
      },
      required: ['clusterName', 'serviceName', 'taskDefinition', 'subnets']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const createParams = {
          cluster: args.clusterName,
          serviceName: args.serviceName,
          taskDefinition: args.taskDefinition,
          desiredCount: args.desiredCount || 1,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: args.subnets,
              securityGroups: args.securityGroups || [],
              assignPublicIp: args.assignPublicIp !== false ? 'ENABLED' : 'DISABLED'
            }
          },
          enableExecuteCommand: args.enableExecuteCommand !== false,
          deploymentConfiguration: {
            maximumPercent: 200,
            minimumHealthyPercent: 100,
            deploymentCircuitBreaker: {
              enable: true,
              rollback: true
            }
          },
          propagateTags: 'SERVICE'
        };

        // Add load balancer if specified
        if (args.loadBalancerTargetGroupArn && args.containerName && args.containerPort) {
          createParams.loadBalancers = [{
            targetGroupArn: args.loadBalancerTargetGroupArn,
            containerName: args.containerName,
            containerPort: args.containerPort
          }];
          createParams.healthCheckGracePeriodSeconds = 60;
        }

        const result = await client.send(new CreateServiceCommand(createParams));
        const service = result.service;

        logger.info(`ECS service created: ${service.serviceArn}`);

        return {
          success: true,
          serviceName: service.serviceName,
          serviceArn: service.serviceArn,
          clusterArn: service.clusterArn,
          status: service.status,
          desiredCount: service.desiredCount,
          runningCount: service.runningCount,
          taskDefinition: service.taskDefinition,
          message: `Service ${service.serviceName} created. Waiting for tasks to start...`
        };
      } catch (error) {
        logger.error('ECS create service failed:', error);
        throw new Error(`ECS create service failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_update_service',
    description: 'Update an ECS service (deploy new version, scale, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceName: {
          type: 'string',
          description: 'Service name to update'
        },
        taskDefinition: {
          type: 'string',
          description: 'New task definition (for deployment)'
        },
        desiredCount: {
          type: 'number',
          description: 'New desired count (for scaling)'
        },
        forceNewDeployment: {
          type: 'boolean',
          description: 'Force new deployment even without changes',
          default: false
        },
        waitForStable: {
          type: 'boolean',
          description: 'Wait for service to reach stable state',
          default: true
        }
      },
      required: ['clusterName', 'serviceName']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const updateParams = {
          cluster: args.clusterName,
          service: args.serviceName,
          forceNewDeployment: args.forceNewDeployment || false
        };

        if (args.taskDefinition) {
          updateParams.taskDefinition = args.taskDefinition;
        }

        if (args.desiredCount !== undefined) {
          updateParams.desiredCount = args.desiredCount;
        }

        const result = await client.send(new UpdateServiceCommand(updateParams));
        const service = result.service;

        logger.info(`ECS service updated: ${service.serviceArn}`);

        let stableStatus = null;
        if (args.waitForStable !== false) {
          stableStatus = await waitForServiceStable(
            client,
            args.clusterName,
            args.serviceName,
            300
          );
        }

        return {
          success: true,
          serviceName: service.serviceName,
          serviceArn: service.serviceArn,
          status: service.status,
          desiredCount: service.desiredCount,
          runningCount: service.runningCount,
          pendingCount: service.pendingCount,
          taskDefinition: service.taskDefinition,
          stable: stableStatus?.stable,
          message: stableStatus?.stable 
            ? `Service ${service.serviceName} updated and stable`
            : `Service ${service.serviceName} updated, stabilizing...`
        };
      } catch (error) {
        logger.error('ECS update service failed:', error);
        throw new Error(`ECS update service failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_describe_services',
    description: 'Get detailed information about ECS services',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Service names to describe'
        }
      },
      required: ['clusterName', 'serviceNames']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const result = await client.send(new DescribeServicesCommand({
          cluster: args.clusterName,
          services: args.serviceNames
        }));

        const services = (result.services || []).map(svc => ({
          serviceName: svc.serviceName,
          serviceArn: svc.serviceArn,
          status: svc.status,
          desiredCount: svc.desiredCount,
          runningCount: svc.runningCount,
          pendingCount: svc.pendingCount,
          taskDefinition: svc.taskDefinition,
          launchType: svc.launchType,
          createdAt: svc.createdAt,
          deployments: svc.deployments?.map(d => ({
            id: d.id,
            status: d.status,
            taskDefinition: d.taskDefinition,
            desiredCount: d.desiredCount,
            runningCount: d.runningCount,
            rolloutState: d.rolloutState
          })),
          events: svc.events?.slice(0, 5).map(e => ({
            message: e.message,
            createdAt: e.createdAt
          }))
        }));

        return {
          success: true,
          clusterName: args.clusterName,
          services,
          failures: result.failures?.map(f => ({
            arn: f.arn,
            reason: f.reason
          }))
        };
      } catch (error) {
        logger.error('ECS describe services failed:', error);
        throw new Error(`ECS describe services failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_delete_service',
    description: 'Delete an ECS service',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceName: {
          type: 'string',
          description: 'Service name to delete'
        },
        force: {
          type: 'boolean',
          description: 'Force delete even if tasks are running',
          default: false
        }
      },
      required: ['clusterName', 'serviceName']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        // First scale to 0 if not forcing
        if (!args.force) {
          await client.send(new UpdateServiceCommand({
            cluster: args.clusterName,
            service: args.serviceName,
            desiredCount: 0
          }));

          // Wait briefly for tasks to drain
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        await client.send(new DeleteServiceCommand({
          cluster: args.clusterName,
          service: args.serviceName,
          force: args.force || false
        }));

        logger.info(`ECS service deleted: ${args.serviceName}`);

        return {
          success: true,
          clusterName: args.clusterName,
          serviceName: args.serviceName,
          message: `Service ${args.serviceName} deleted`
        };
      } catch (error) {
        logger.error('ECS delete service failed:', error);
        throw new Error(`ECS delete service failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_list_tasks',
    description: 'List tasks running in an ECS cluster/service',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceName: {
          type: 'string',
          description: 'Filter by service name'
        },
        desiredStatus: {
          type: 'string',
          enum: ['RUNNING', 'PENDING', 'STOPPED'],
          description: 'Filter by task status',
          default: 'RUNNING'
        }
      },
      required: ['clusterName']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const listParams = {
          cluster: args.clusterName,
          desiredStatus: args.desiredStatus || 'RUNNING'
        };

        if (args.serviceName) {
          listParams.serviceName = args.serviceName;
        }

        const listResult = await client.send(new ListTasksCommand(listParams));
        
        if (!listResult.taskArns || listResult.taskArns.length === 0) {
          return {
            success: true,
            clusterName: args.clusterName,
            tasks: [],
            count: 0
          };
        }

        const describeResult = await client.send(new DescribeTasksCommand({
          cluster: args.clusterName,
          tasks: listResult.taskArns
        }));

        const tasks = (describeResult.tasks || []).map(task => ({
          taskArn: task.taskArn,
          taskDefinitionArn: task.taskDefinitionArn,
          lastStatus: task.lastStatus,
          desiredStatus: task.desiredStatus,
          cpu: task.cpu,
          memory: task.memory,
          startedAt: task.startedAt,
          containers: task.containers?.map(c => ({
            name: c.name,
            lastStatus: c.lastStatus,
            exitCode: c.exitCode,
            reason: c.reason
          })),
          connectivity: task.connectivity
        }));

        return {
          success: true,
          clusterName: args.clusterName,
          serviceName: args.serviceName,
          count: tasks.length,
          tasks
        };
      } catch (error) {
        logger.error('ECS list tasks failed:', error);
        throw new Error(`ECS list tasks failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_run_task',
    description: 'Run a one-off task (for migrations, scripts, etc.)',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        taskDefinition: {
          type: 'string',
          description: 'Task definition to run'
        },
        subnets: {
          type: 'array',
          items: { type: 'string' },
          description: 'VPC subnet IDs'
        },
        securityGroups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Security group IDs'
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Override container command'
        },
        containerName: {
          type: 'string',
          description: 'Container name for command override'
        },
        environment: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' }
            }
          },
          description: 'Environment variable overrides'
        }
      },
      required: ['clusterName', 'taskDefinition', 'subnets']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const runParams = {
          cluster: args.clusterName,
          taskDefinition: args.taskDefinition,
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: args.subnets,
              securityGroups: args.securityGroups || [],
              assignPublicIp: 'ENABLED'
            }
          },
          enableExecuteCommand: true
        };

        // Add command/env overrides if specified
        if (args.command || args.environment) {
          runParams.overrides = {
            containerOverrides: [{
              name: args.containerName || 'app',
              command: args.command,
              environment: args.environment
            }]
          };
        }

        const result = await client.send(new RunTaskCommand(runParams));

        if (result.failures?.length > 0) {
          return {
            success: false,
            failures: result.failures.map(f => ({
              arn: f.arn,
              reason: f.reason
            }))
          };
        }

        const task = result.tasks[0];

        logger.info(`ECS task started: ${task.taskArn}`);

        return {
          success: true,
          taskArn: task.taskArn,
          taskDefinitionArn: task.taskDefinitionArn,
          lastStatus: task.lastStatus,
          clusterArn: task.clusterArn,
          message: `Task started: ${task.taskArn.split('/').pop()}`
        };
      } catch (error) {
        logger.error('ECS run task failed:', error);
        throw new Error(`ECS run task failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_stop_task',
    description: 'Stop a running ECS task',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        taskArn: {
          type: 'string',
          description: 'Task ARN to stop'
        },
        reason: {
          type: 'string',
          description: 'Reason for stopping'
        }
      },
      required: ['clusterName', 'taskArn']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        await client.send(new StopTaskCommand({
          cluster: args.clusterName,
          task: args.taskArn,
          reason: args.reason || 'Stopped via deployment agent'
        }));

        logger.info(`ECS task stopped: ${args.taskArn}`);

        return {
          success: true,
          taskArn: args.taskArn,
          message: `Task stopped: ${args.taskArn.split('/').pop()}`
        };
      } catch (error) {
        logger.error('ECS stop task failed:', error);
        throw new Error(`ECS stop task failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_deploy',
    description: 'High-level tool to deploy an application to ECS. Handles ECR push, task definition, and service update.',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        serviceName: {
          type: 'string',
          description: 'Service name'
        },
        imageUri: {
          type: 'string',
          description: 'Full ECR image URI (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:v1)'
        },
        containerPort: {
          type: 'number',
          description: 'Container port',
          default: 3000
        },
        cpu: {
          type: 'string',
          description: 'Task CPU',
          default: '256'
        },
        memory: {
          type: 'string',
          description: 'Task memory',
          default: '512'
        },
        environment: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' }
            }
          },
          description: 'Environment variables'
        },
        subnets: {
          type: 'array',
          items: { type: 'string' },
          description: 'VPC subnet IDs'
        },
        securityGroups: {
          type: 'array',
          items: { type: 'string' },
          description: 'Security group IDs'
        },
        desiredCount: {
          type: 'number',
          description: 'Number of tasks',
          default: 1
        }
      },
      required: ['clusterName', 'serviceName', 'imageUri', 'subnets']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();
        const family = `${args.serviceName}-task`;

        logger.info(`Deploying ${args.serviceName} to ECS...`);

        // Step 1: Register new task definition
        const containerName = args.serviceName.replace(/[^a-zA-Z0-9-]/g, '-');
        const taskDefParams = {
          family,
          containerDefinitions: [{
            name: containerName,
            image: args.imageUri,
            cpu: parseInt(args.cpu) || 256,
            memory: parseInt(args.memory) || 512,
            essential: true,
            portMappings: [{
              containerPort: args.containerPort || 3000,
              hostPort: args.containerPort || 3000,
              protocol: 'tcp'
            }],
            environment: args.environment || [],
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': `/ecs/${family}`,
                'awslogs-region': process.env.AWS_REGION || 'us-east-1',
                'awslogs-stream-prefix': containerName,
                'awslogs-create-group': 'true'
              }
            }
          }],
          networkMode: 'awsvpc',
          requiresCompatibilities: ['FARGATE'],
          cpu: args.cpu || '256',
          memory: args.memory || '512'
        };

        const taskDefResult = await client.send(new RegisterTaskDefinitionCommand(taskDefParams));
        const taskDefArn = taskDefResult.taskDefinition.taskDefinitionArn;
        const revision = taskDefResult.taskDefinition.revision;

        logger.info(`Task definition registered: ${family}:${revision}`);

        // Step 2: Check if service exists
        let serviceExists = false;
        try {
          const describeResult = await client.send(new DescribeServicesCommand({
            cluster: args.clusterName,
            services: [args.serviceName]
          }));
          serviceExists = describeResult.services?.some(s => s.status === 'ACTIVE');
        } catch {
          serviceExists = false;
        }

        let serviceResult;
        if (serviceExists) {
          // Update existing service
          serviceResult = await client.send(new UpdateServiceCommand({
            cluster: args.clusterName,
            service: args.serviceName,
            taskDefinition: taskDefArn,
            desiredCount: args.desiredCount || 1,
            forceNewDeployment: true
          }));
          logger.info(`Service updated: ${args.serviceName}`);
        } else {
          // Create new service
          serviceResult = await client.send(new CreateServiceCommand({
            cluster: args.clusterName,
            serviceName: args.serviceName,
            taskDefinition: taskDefArn,
            desiredCount: args.desiredCount || 1,
            launchType: 'FARGATE',
            networkConfiguration: {
              awsvpcConfiguration: {
                subnets: args.subnets,
                securityGroups: args.securityGroups || [],
                assignPublicIp: 'ENABLED'
              }
            },
            enableExecuteCommand: true,
            deploymentConfiguration: {
              maximumPercent: 200,
              minimumHealthyPercent: 100,
              deploymentCircuitBreaker: {
                enable: true,
                rollback: true
              }
            }
          }));
          logger.info(`Service created: ${args.serviceName}`);
        }

        // Step 3: Wait for stability
        const stableStatus = await waitForServiceStable(
          client,
          args.clusterName,
          args.serviceName,
          300
        );

        return {
          success: stableStatus.stable,
          clusterName: args.clusterName,
          serviceName: args.serviceName,
          taskDefinition: `${family}:${revision}`,
          imageUri: args.imageUri,
          desiredCount: args.desiredCount || 1,
          runningCount: stableStatus.runningCount,
          stable: stableStatus.stable,
          created: !serviceExists,
          message: stableStatus.stable
            ? `Deployment successful! ${args.serviceName} is running with ${stableStatus.runningCount} task(s)`
            : `Deployment initiated but not yet stable. Check ECS console for details.`
        };
      } catch (error) {
        logger.error('ECS deploy failed:', error);
        throw new Error(`ECS deploy failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_list_clusters',
    description: 'List all ECS clusters',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      try {
        const client = await getECSClient();

        const listResult = await client.send(new ListClustersCommand({}));
        
        if (!listResult.clusterArns || listResult.clusterArns.length === 0) {
          return { success: true, clusters: [], count: 0 };
        }

        const describeResult = await client.send(new DescribeClustersCommand({
          clusters: listResult.clusterArns
        }));

        const clusters = (describeResult.clusters || []).map(c => ({
          clusterName: c.clusterName,
          clusterArn: c.clusterArn,
          status: c.status,
          runningTasksCount: c.runningTasksCount,
          pendingTasksCount: c.pendingTasksCount,
          activeServicesCount: c.activeServicesCount,
          registeredContainerInstancesCount: c.registeredContainerInstancesCount
        }));

        return {
          success: true,
          count: clusters.length,
          clusters
        };
      } catch (error) {
        logger.error('ECS list clusters failed:', error);
        throw new Error(`ECS list clusters failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ecs_list_services',
    description: 'List services in an ECS cluster',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        }
      },
      required: ['clusterName']
    },
    handler: async (args) => {
      try {
        const client = await getECSClient();

        const listResult = await client.send(new ListServicesCommand({
          cluster: args.clusterName
        }));

        if (!listResult.serviceArns || listResult.serviceArns.length === 0) {
          return { success: true, clusterName: args.clusterName, services: [], count: 0 };
        }

        const describeResult = await client.send(new DescribeServicesCommand({
          cluster: args.clusterName,
          services: listResult.serviceArns
        }));

        const services = (describeResult.services || []).map(s => ({
          serviceName: s.serviceName,
          status: s.status,
          desiredCount: s.desiredCount,
          runningCount: s.runningCount,
          pendingCount: s.pendingCount,
          taskDefinition: s.taskDefinition?.split('/').pop()
        }));

        return {
          success: true,
          clusterName: args.clusterName,
          count: services.length,
          services
        };
      } catch (error) {
        logger.error('ECS list services failed:', error);
        throw new Error(`ECS list services failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all ECS tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};


