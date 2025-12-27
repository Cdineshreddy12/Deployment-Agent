const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const logger = require('../../utils/logger');

/**
 * Kubernetes MCP Tools
 * These tools enable Claude to deploy and manage containers on Kubernetes
 * Supports: Local Kubernetes (Docker Desktop, minikube), AWS EKS, GKE, AKS, self-hosted
 * 
 * ARCHITECTURE FOR FUTURE SCALABILITY:
 * - Uses kubectl CLI for universal compatibility
 * - Supports kubeconfig switching for multi-cluster
 * - Designed for GitOps integration (ArgoCD, Flux)
 * - Helm support for complex deployments
 */

// Lazy load Kubernetes client
let k8sClient = null;

async function getK8sClient() {
  if (!k8sClient) {
    try {
      const k8s = await import('@kubernetes/client-node');
      const kc = new k8s.KubeConfig();
      
      // Load from default locations
      kc.loadFromDefault();
      
      k8sClient = {
        kc,
        coreV1: kc.makeApiClient(k8s.CoreV1Api),
        appsV1: kc.makeApiClient(k8s.AppsV1Api),
        networkingV1: kc.makeApiClient(k8s.NetworkingV1Api),
        batchV1: kc.makeApiClient(k8s.BatchV1Api),
        currentContext: kc.getCurrentContext(),
        contexts: kc.getContexts().map(c => c.name)
      };
    } catch (error) {
      logger.warn('Kubernetes client not available, using kubectl CLI only');
      k8sClient = { available: false };
    }
  }
  return k8sClient;
}

/**
 * Execute kubectl command
 */
function execKubectl(args, options = {}) {
  return new Promise((resolve, reject) => {
    const kubectlArgs = [...args];
    
    // Add context if specified
    if (options.context) {
      kubectlArgs.unshift('--context', options.context);
    }
    
    // Add namespace if specified
    if (options.namespace) {
      kubectlArgs.push('-n', options.namespace);
    }
    
    // Add kubeconfig if specified
    if (options.kubeconfig) {
      kubectlArgs.unshift('--kubeconfig', options.kubeconfig);
    }

    const proc = spawn('kubectl', kubectlArgs, {
      env: { ...process.env, ...options.env }
    });
    
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

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: 'kubectl not found. Please install kubectl.'
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Execute Helm command
 */
function execHelm(args, options = {}) {
  return new Promise((resolve, reject) => {
    const helmArgs = [...args];
    
    if (options.kubeconfig) {
      helmArgs.unshift('--kubeconfig', options.kubeconfig);
    }
    
    if (options.namespace) {
      helmArgs.push('-n', options.namespace);
    }

    const proc = spawn('helm', helmArgs);
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

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: 'helm not found. Please install helm.'
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Generate Kubernetes Deployment YAML
 */
function generateDeploymentYaml(options) {
  const {
    name,
    image,
    namespace = 'default',
    replicas = 1,
    port = 3000,
    env = [],
    resources = {},
    labels = {}
  } = options;

  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name,
      namespace,
      labels: { app: name, ...labels }
    },
    spec: {
      replicas,
      selector: {
        matchLabels: { app: name }
      },
      template: {
        metadata: {
          labels: { app: name, ...labels }
        },
        spec: {
          containers: [{
            name,
            image,
            ports: [{ containerPort: port }],
            env: env.map(e => {
              if (typeof e === 'string') {
                const [envName, ...valueParts] = e.split('=');
                return { name: envName, value: valueParts.join('=') };
              }
              return e;
            }),
            resources: {
              requests: {
                cpu: resources.cpuRequest || '100m',
                memory: resources.memoryRequest || '128Mi'
              },
              limits: {
                cpu: resources.cpuLimit || '500m',
                memory: resources.memoryLimit || '512Mi'
              }
            },
            livenessProbe: {
              httpGet: { path: '/health', port },
              initialDelaySeconds: 30,
              periodSeconds: 10
            },
            readinessProbe: {
              httpGet: { path: '/health', port },
              initialDelaySeconds: 5,
              periodSeconds: 5
            }
          }]
        }
      }
    }
  };

  return yaml.dump(deployment);
}

/**
 * Generate Kubernetes Service YAML
 */
function generateServiceYaml(options) {
  const {
    name,
    namespace = 'default',
    port = 3000,
    targetPort,
    type = 'ClusterIP',
    labels = {}
  } = options;

  const service = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name,
      namespace,
      labels: { app: name, ...labels }
    },
    spec: {
      type,
      selector: { app: name },
      ports: [{
        port,
        targetPort: targetPort || port,
        protocol: 'TCP'
      }]
    }
  };

  return yaml.dump(service);
}

/**
 * Generate Kubernetes Ingress YAML
 */
function generateIngressYaml(options) {
  const {
    name,
    namespace = 'default',
    host,
    serviceName,
    servicePort = 80,
    tlsSecretName,
    annotations = {}
  } = options;

  const ingress = {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: {
      name,
      namespace,
      annotations: {
        'kubernetes.io/ingress.class': 'nginx',
        ...annotations
      }
    },
    spec: {
      rules: [{
        host,
        http: {
          paths: [{
            path: '/',
            pathType: 'Prefix',
            backend: {
              service: {
                name: serviceName,
                port: { number: servicePort }
              }
            }
          }]
        }
      }]
    }
  };

  if (tlsSecretName) {
    ingress.spec.tls = [{
      hosts: [host],
      secretName: tlsSecretName
    }];
  }

  return yaml.dump(ingress);
}

const tools = [
  {
    name: 'k8s_get_clusters',
    description: 'List available Kubernetes clusters/contexts',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      try {
        const result = await execKubectl(['config', 'get-contexts', '-o', 'name']);
        
        if (!result.success) {
          return {
            success: false,
            error: result.stderr || 'Failed to get clusters'
          };
        }

        const currentResult = await execKubectl(['config', 'current-context']);
        const currentContext = currentResult.stdout.trim();

        const contexts = result.stdout.trim().split('\n').filter(Boolean);

        return {
          success: true,
          currentContext,
          contexts,
          count: contexts.length
        };
      } catch (error) {
        logger.error('K8s get clusters failed:', error);
        throw new Error(`K8s get clusters failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_switch_context',
    description: 'Switch to a different Kubernetes cluster/context',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Context name to switch to'
        }
      },
      required: ['context']
    },
    handler: async (args) => {
      try {
        const result = await execKubectl(['config', 'use-context', args.context]);

        if (!result.success) {
          return {
            success: false,
            error: result.stderr
          };
        }

        return {
          success: true,
          context: args.context,
          message: `Switched to context: ${args.context}`
        };
      } catch (error) {
        logger.error('K8s switch context failed:', error);
        throw new Error(`K8s switch context failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_get_namespaces',
    description: 'List Kubernetes namespaces',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'Kubernetes context (optional, uses current if not specified)'
        }
      }
    },
    handler: async (args) => {
      try {
        const result = await execKubectl(['get', 'namespaces', '-o', 'json'], {
          context: args.context
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        const data = JSON.parse(result.stdout);
        const namespaces = data.items.map(ns => ({
          name: ns.metadata.name,
          status: ns.status.phase,
          createdAt: ns.metadata.creationTimestamp
        }));

        return {
          success: true,
          count: namespaces.length,
          namespaces
        };
      } catch (error) {
        logger.error('K8s get namespaces failed:', error);
        throw new Error(`K8s get namespaces failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_create_namespace',
    description: 'Create a Kubernetes namespace',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Namespace name'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const result = await execKubectl(['create', 'namespace', args.name], {
          context: args.context
        });

        if (!result.success && !result.stderr.includes('already exists')) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          namespace: args.name,
          message: result.stderr.includes('already exists') 
            ? `Namespace ${args.name} already exists`
            : `Namespace ${args.name} created`
        };
      } catch (error) {
        logger.error('K8s create namespace failed:', error);
        throw new Error(`K8s create namespace failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_deploy',
    description: 'Deploy an application to Kubernetes. Creates Deployment, Service, and optionally Ingress.',
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
        namespace: {
          type: 'string',
          description: 'Kubernetes namespace',
          default: 'default'
        },
        replicas: {
          type: 'number',
          description: 'Number of replicas',
          default: 1
        },
        port: {
          type: 'number',
          description: 'Container port',
          default: 3000
        },
        serviceType: {
          type: 'string',
          enum: ['ClusterIP', 'NodePort', 'LoadBalancer'],
          description: 'Service type',
          default: 'ClusterIP'
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variables (e.g., ["NODE_ENV=production"])'
        },
        resources: {
          type: 'object',
          properties: {
            cpuRequest: { type: 'string' },
            cpuLimit: { type: 'string' },
            memoryRequest: { type: 'string' },
            memoryLimit: { type: 'string' }
          },
          description: 'Resource requests and limits'
        },
        ingressHost: {
          type: 'string',
          description: 'Ingress hostname (creates Ingress if specified)'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['name', 'image']
    },
    handler: async (args) => {
      try {
        const namespace = args.namespace || 'default';
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8s-deploy-'));

        // Generate Deployment YAML
        const deploymentYaml = generateDeploymentYaml({
          name: args.name,
          image: args.image,
          namespace,
          replicas: args.replicas || 1,
          port: args.port || 3000,
          env: args.env || [],
          resources: args.resources || {}
        });

        const deploymentFile = path.join(tmpDir, 'deployment.yaml');
        await fs.writeFile(deploymentFile, deploymentYaml);

        // Generate Service YAML
        const serviceYaml = generateServiceYaml({
          name: args.name,
          namespace,
          port: args.port || 3000,
          type: args.serviceType || 'ClusterIP'
        });

        const serviceFile = path.join(tmpDir, 'service.yaml');
        await fs.writeFile(serviceFile, serviceYaml);

        // Apply Deployment
        let deployResult = await execKubectl(['apply', '-f', deploymentFile], {
          context: args.context
        });

        if (!deployResult.success) {
          return {
            success: false,
            stage: 'deployment',
            error: deployResult.stderr
          };
        }

        // Apply Service
        let serviceResult = await execKubectl(['apply', '-f', serviceFile], {
          context: args.context
        });

        if (!serviceResult.success) {
          return {
            success: false,
            stage: 'service',
            error: serviceResult.stderr
          };
        }

        // Create Ingress if host specified
        let ingressCreated = false;
        if (args.ingressHost) {
          const ingressYaml = generateIngressYaml({
            name: `${args.name}-ingress`,
            namespace,
            host: args.ingressHost,
            serviceName: args.name,
            servicePort: args.port || 3000
          });

          const ingressFile = path.join(tmpDir, 'ingress.yaml');
          await fs.writeFile(ingressFile, ingressYaml);

          const ingressResult = await execKubectl(['apply', '-f', ingressFile], {
            context: args.context
          });

          ingressCreated = ingressResult.success;
        }

        // Wait for rollout
        const rolloutResult = await execKubectl([
          'rollout', 'status', `deployment/${args.name}`,
          '--timeout=120s'
        ], {
          context: args.context,
          namespace
        });

        // Cleanup temp files
        await fs.rm(tmpDir, { recursive: true, force: true });

        return {
          success: rolloutResult.success,
          name: args.name,
          namespace,
          image: args.image,
          replicas: args.replicas || 1,
          serviceType: args.serviceType || 'ClusterIP',
          ingressCreated,
          ingressHost: args.ingressHost,
          message: rolloutResult.success
            ? `Deployment ${args.name} rolled out successfully`
            : `Deployment initiated but rollout pending: ${rolloutResult.stderr}`
        };
      } catch (error) {
        logger.error('K8s deploy failed:', error);
        throw new Error(`K8s deploy failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_scale',
    description: 'Scale a Kubernetes deployment',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Deployment name'
        },
        replicas: {
          type: 'number',
          description: 'Desired number of replicas'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['name', 'replicas']
    },
    handler: async (args) => {
      try {
        const result = await execKubectl([
          'scale', `deployment/${args.name}`,
          '--replicas', String(args.replicas)
        ], {
          context: args.context,
          namespace: args.namespace || 'default'
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          name: args.name,
          replicas: args.replicas,
          message: `Scaled ${args.name} to ${args.replicas} replicas`
        };
      } catch (error) {
        logger.error('K8s scale failed:', error);
        throw new Error(`K8s scale failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_update_image',
    description: 'Update the container image of a deployment (rolling update)',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Deployment name'
        },
        containerName: {
          type: 'string',
          description: 'Container name (usually same as deployment name)'
        },
        image: {
          type: 'string',
          description: 'New container image'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['name', 'image']
    },
    handler: async (args) => {
      try {
        const containerName = args.containerName || args.name;

        const result = await execKubectl([
          'set', 'image',
          `deployment/${args.name}`,
          `${containerName}=${args.image}`
        ], {
          context: args.context,
          namespace: args.namespace || 'default'
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        // Wait for rollout
        const rolloutResult = await execKubectl([
          'rollout', 'status', `deployment/${args.name}`,
          '--timeout=120s'
        ], {
          context: args.context,
          namespace: args.namespace || 'default'
        });

        return {
          success: rolloutResult.success,
          name: args.name,
          image: args.image,
          message: rolloutResult.success
            ? `Image updated to ${args.image}`
            : `Update initiated: ${rolloutResult.stderr}`
        };
      } catch (error) {
        logger.error('K8s update image failed:', error);
        throw new Error(`K8s update image failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_rollback',
    description: 'Rollback a deployment to a previous revision',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Deployment name'
        },
        revision: {
          type: 'number',
          description: 'Revision number to rollback to (omit for previous)'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['name']
    },
    handler: async (args) => {
      try {
        const rollbackArgs = ['rollout', 'undo', `deployment/${args.name}`];
        
        if (args.revision) {
          rollbackArgs.push('--to-revision', String(args.revision));
        }

        const result = await execKubectl(rollbackArgs, {
          context: args.context,
          namespace: args.namespace || 'default'
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        // Wait for rollout
        const rolloutResult = await execKubectl([
          'rollout', 'status', `deployment/${args.name}`,
          '--timeout=120s'
        ], {
          context: args.context,
          namespace: args.namespace || 'default'
        });

        return {
          success: rolloutResult.success,
          name: args.name,
          rolledBackTo: args.revision || 'previous',
          message: result.stdout
        };
      } catch (error) {
        logger.error('K8s rollback failed:', error);
        throw new Error(`K8s rollback failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_get_pods',
    description: 'List pods in a namespace',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Namespace (use "all" for all namespaces)',
          default: 'default'
        },
        selector: {
          type: 'string',
          description: 'Label selector (e.g., app=myapp)'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      }
    },
    handler: async (args) => {
      try {
        const kubectlArgs = ['get', 'pods', '-o', 'json'];
        
        if (args.namespace === 'all') {
          kubectlArgs.push('-A');
        }

        if (args.selector) {
          kubectlArgs.push('-l', args.selector);
        }

        const result = await execKubectl(kubectlArgs, {
          context: args.context,
          namespace: args.namespace !== 'all' ? args.namespace : undefined
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        const data = JSON.parse(result.stdout);
        const pods = data.items.map(pod => ({
          name: pod.metadata.name,
          namespace: pod.metadata.namespace,
          status: pod.status.phase,
          ready: pod.status.containerStatuses?.every(c => c.ready) || false,
          restarts: pod.status.containerStatuses?.reduce((sum, c) => sum + c.restartCount, 0) || 0,
          age: pod.metadata.creationTimestamp,
          node: pod.spec.nodeName,
          ip: pod.status.podIP
        }));

        return {
          success: true,
          count: pods.length,
          pods
        };
      } catch (error) {
        logger.error('K8s get pods failed:', error);
        throw new Error(`K8s get pods failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_get_deployments',
    description: 'List deployments in a namespace',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      }
    },
    handler: async (args) => {
      try {
        const result = await execKubectl(['get', 'deployments', '-o', 'json'], {
          context: args.context,
          namespace: args.namespace
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        const data = JSON.parse(result.stdout);
        const deployments = data.items.map(dep => ({
          name: dep.metadata.name,
          namespace: dep.metadata.namespace,
          replicas: dep.spec.replicas,
          ready: dep.status.readyReplicas || 0,
          available: dep.status.availableReplicas || 0,
          image: dep.spec.template.spec.containers[0]?.image,
          age: dep.metadata.creationTimestamp
        }));

        return {
          success: true,
          count: deployments.length,
          deployments
        };
      } catch (error) {
        logger.error('K8s get deployments failed:', error);
        throw new Error(`K8s get deployments failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_get_services',
    description: 'List services in a namespace',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      }
    },
    handler: async (args) => {
      try {
        const result = await execKubectl(['get', 'services', '-o', 'json'], {
          context: args.context,
          namespace: args.namespace
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        const data = JSON.parse(result.stdout);
        const services = data.items.map(svc => ({
          name: svc.metadata.name,
          namespace: svc.metadata.namespace,
          type: svc.spec.type,
          clusterIP: svc.spec.clusterIP,
          externalIP: svc.status.loadBalancer?.ingress?.[0]?.ip || 
                      svc.status.loadBalancer?.ingress?.[0]?.hostname,
          ports: svc.spec.ports?.map(p => `${p.port}:${p.targetPort}/${p.protocol}`)
        }));

        return {
          success: true,
          count: services.length,
          services
        };
      } catch (error) {
        logger.error('K8s get services failed:', error);
        throw new Error(`K8s get services failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_logs',
    description: 'Get logs from a pod',
    inputSchema: {
      type: 'object',
      properties: {
        podName: {
          type: 'string',
          description: 'Pod name (or deployment name with --selector)'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        container: {
          type: 'string',
          description: 'Container name (for multi-container pods)'
        },
        tail: {
          type: 'number',
          description: 'Number of lines to show',
          default: 100
        },
        previous: {
          type: 'boolean',
          description: 'Get logs from previous container instance',
          default: false
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['podName']
    },
    handler: async (args) => {
      try {
        const logArgs = ['logs', args.podName, '--tail', String(args.tail || 100)];
        
        if (args.container) {
          logArgs.push('-c', args.container);
        }
        
        if (args.previous) {
          logArgs.push('--previous');
        }

        const result = await execKubectl(logArgs, {
          context: args.context,
          namespace: args.namespace
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        // Analyze logs for errors
        const logs = result.stdout;
        const lines = logs.split('\n');
        const errorLines = lines.filter(l => 
          /error|exception|fatal|panic|crash/i.test(l)
        );

        return {
          success: true,
          podName: args.podName,
          logs,
          lineCount: lines.length,
          errorCount: errorLines.length,
          errors: errorLines.slice(0, 10)
        };
      } catch (error) {
        logger.error('K8s logs failed:', error);
        throw new Error(`K8s logs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_delete',
    description: 'Delete Kubernetes resources',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: ['deployment', 'service', 'pod', 'ingress', 'configmap', 'secret', 'namespace'],
          description: 'Type of resource to delete'
        },
        name: {
          type: 'string',
          description: 'Resource name'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['resourceType', 'name']
    },
    handler: async (args) => {
      try {
        const result = await execKubectl([
          'delete', args.resourceType, args.name
        ], {
          context: args.context,
          namespace: args.namespace
        });

        if (!result.success && !result.stderr.includes('not found')) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          resourceType: args.resourceType,
          name: args.name,
          message: result.stderr.includes('not found')
            ? `${args.resourceType}/${args.name} not found (already deleted?)`
            : `${args.resourceType}/${args.name} deleted`
        };
      } catch (error) {
        logger.error('K8s delete failed:', error);
        throw new Error(`K8s delete failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_apply_yaml',
    description: 'Apply Kubernetes YAML manifest',
    inputSchema: {
      type: 'object',
      properties: {
        yaml: {
          type: 'string',
          description: 'YAML content to apply'
        },
        filePath: {
          type: 'string',
          description: 'Path to YAML file to apply'
        },
        namespace: {
          type: 'string',
          description: 'Namespace override'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      }
    },
    handler: async (args) => {
      try {
        let filePath = args.filePath;

        // If YAML content provided, write to temp file
        if (args.yaml && !filePath) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'k8s-apply-'));
          filePath = path.join(tmpDir, 'manifest.yaml');
          await fs.writeFile(filePath, args.yaml);
        }

        if (!filePath) {
          return {
            success: false,
            error: 'Either yaml or filePath must be provided'
          };
        }

        const result = await execKubectl(['apply', '-f', filePath], {
          context: args.context,
          namespace: args.namespace
        });

        // Cleanup temp file if created
        if (args.yaml && !args.filePath) {
          await fs.rm(path.dirname(filePath), { recursive: true, force: true });
        }

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          output: result.stdout,
          message: 'YAML applied successfully'
        };
      } catch (error) {
        logger.error('K8s apply YAML failed:', error);
        throw new Error(`K8s apply YAML failed: ${error.message}`);
      }
    }
  },

  {
    name: 'k8s_exec',
    description: 'Execute a command in a pod',
    inputSchema: {
      type: 'object',
      properties: {
        podName: {
          type: 'string',
          description: 'Pod name'
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command to execute'
        },
        container: {
          type: 'string',
          description: 'Container name (for multi-container pods)'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        context: {
          type: 'string',
          description: 'Kubernetes context'
        }
      },
      required: ['podName', 'command']
    },
    handler: async (args) => {
      try {
        const execArgs = ['exec', args.podName, '--'];
        
        if (args.container) {
          execArgs.splice(2, 0, '-c', args.container);
        }
        
        execArgs.push(...args.command);

        const result = await execKubectl(execArgs, {
          context: args.context,
          namespace: args.namespace
        });

        return {
          success: result.success,
          podName: args.podName,
          command: args.command.join(' '),
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode
        };
      } catch (error) {
        logger.error('K8s exec failed:', error);
        throw new Error(`K8s exec failed: ${error.message}`);
      }
    }
  },

  {
    name: 'helm_install',
    description: 'Install a Helm chart',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: {
          type: 'string',
          description: 'Release name'
        },
        chart: {
          type: 'string',
          description: 'Chart name (e.g., bitnami/nginx, ./mychart)'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        values: {
          type: 'object',
          description: 'Values to override'
        },
        createNamespace: {
          type: 'boolean',
          description: 'Create namespace if not exists',
          default: true
        },
        wait: {
          type: 'boolean',
          description: 'Wait for pods to be ready',
          default: true
        }
      },
      required: ['releaseName', 'chart']
    },
    handler: async (args) => {
      try {
        const helmArgs = ['install', args.releaseName, args.chart];
        
        if (args.createNamespace) {
          helmArgs.push('--create-namespace');
        }
        
        if (args.wait) {
          helmArgs.push('--wait', '--timeout', '5m');
        }

        // Write values to temp file if provided
        let valuesFile;
        if (args.values && Object.keys(args.values).length > 0) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'helm-'));
          valuesFile = path.join(tmpDir, 'values.yaml');
          await fs.writeFile(valuesFile, yaml.dump(args.values));
          helmArgs.push('-f', valuesFile);
        }

        const result = await execHelm(helmArgs, {
          namespace: args.namespace
        });

        // Cleanup
        if (valuesFile) {
          await fs.rm(path.dirname(valuesFile), { recursive: true, force: true });
        }

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          releaseName: args.releaseName,
          chart: args.chart,
          namespace: args.namespace,
          message: `Helm release ${args.releaseName} installed`
        };
      } catch (error) {
        logger.error('Helm install failed:', error);
        throw new Error(`Helm install failed: ${error.message}`);
      }
    }
  },

  {
    name: 'helm_upgrade',
    description: 'Upgrade a Helm release',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: {
          type: 'string',
          description: 'Release name'
        },
        chart: {
          type: 'string',
          description: 'Chart name'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        },
        values: {
          type: 'object',
          description: 'Values to override'
        },
        install: {
          type: 'boolean',
          description: 'Install if not exists',
          default: true
        }
      },
      required: ['releaseName', 'chart']
    },
    handler: async (args) => {
      try {
        const helmArgs = ['upgrade', args.releaseName, args.chart, '--wait'];
        
        if (args.install) {
          helmArgs.push('--install');
        }

        let valuesFile;
        if (args.values && Object.keys(args.values).length > 0) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'helm-'));
          valuesFile = path.join(tmpDir, 'values.yaml');
          await fs.writeFile(valuesFile, yaml.dump(args.values));
          helmArgs.push('-f', valuesFile);
        }

        const result = await execHelm(helmArgs, {
          namespace: args.namespace
        });

        if (valuesFile) {
          await fs.rm(path.dirname(valuesFile), { recursive: true, force: true });
        }

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          releaseName: args.releaseName,
          chart: args.chart,
          message: `Helm release ${args.releaseName} upgraded`
        };
      } catch (error) {
        logger.error('Helm upgrade failed:', error);
        throw new Error(`Helm upgrade failed: ${error.message}`);
      }
    }
  },

  {
    name: 'helm_list',
    description: 'List Helm releases',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Namespace (use "all" for all namespaces)'
        }
      }
    },
    handler: async (args) => {
      try {
        const helmArgs = ['list', '-o', 'json'];
        
        if (args.namespace === 'all') {
          helmArgs.push('-A');
        }

        const result = await execHelm(helmArgs, {
          namespace: args.namespace !== 'all' ? args.namespace : undefined
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        const releases = JSON.parse(result.stdout || '[]');

        return {
          success: true,
          count: releases.length,
          releases: releases.map(r => ({
            name: r.name,
            namespace: r.namespace,
            chart: r.chart,
            status: r.status,
            revision: r.revision,
            updated: r.updated
          }))
        };
      } catch (error) {
        logger.error('Helm list failed:', error);
        throw new Error(`Helm list failed: ${error.message}`);
      }
    }
  },

  {
    name: 'helm_rollback',
    description: 'Rollback a Helm release',
    inputSchema: {
      type: 'object',
      properties: {
        releaseName: {
          type: 'string',
          description: 'Release name'
        },
        revision: {
          type: 'number',
          description: 'Revision number to rollback to'
        },
        namespace: {
          type: 'string',
          description: 'Namespace',
          default: 'default'
        }
      },
      required: ['releaseName']
    },
    handler: async (args) => {
      try {
        const helmArgs = ['rollback', args.releaseName];
        
        if (args.revision) {
          helmArgs.push(String(args.revision));
        }

        helmArgs.push('--wait');

        const result = await execHelm(helmArgs, {
          namespace: args.namespace
        });

        if (!result.success) {
          return { success: false, error: result.stderr };
        }

        return {
          success: true,
          releaseName: args.releaseName,
          rolledBackTo: args.revision || 'previous',
          message: result.stdout
        };
      } catch (error) {
        logger.error('Helm rollback failed:', error);
        throw new Error(`Helm rollback failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all Kubernetes tools
 */
const getTools = () => tools;

module.exports = {
  getTools,
  generateDeploymentYaml,
  generateServiceYaml,
  generateIngressYaml
};


