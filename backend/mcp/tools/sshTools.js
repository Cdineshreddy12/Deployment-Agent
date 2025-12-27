const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const logger = require('../../utils/logger');

/**
 * SSH-related MCP tools
 * These tools enable Claude to execute commands on remote EC2 instances
 * for installation, deployment, and error remediation
 */

/**
 * Execute SSH command with streaming output
 */
async function executeSSHCommand({ host, username, privateKeyPath, command, timeout = 60000 }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'BatchMode=yes',
      '-i', privateKeyPath,
      `${username}@${host}`,
      command
    ];

    const proc = spawn('ssh', args);
    const stdout = [];
    const stderr = [];
    
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`SSH command timed out after ${timeout}ms`));
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout.push(data.toString());
    });

    proc.stderr.on('data', (data) => {
      stderr.push(data.toString());
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        command
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Copy file to remote server via SCP
 */
async function scpFile({ host, username, privateKeyPath, localPath, remotePath }) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-i', privateKeyPath,
      localPath,
      `${username}@${host}:${remotePath}`
    ];

    const proc = spawn('scp', args);
    const output = [];

    proc.stdout.on('data', (data) => output.push(data.toString()));
    proc.stderr.on('data', (data) => output.push(data.toString()));

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        output: output.join('')
      });
    });

    proc.on('error', reject);
  });
}

/**
 * Parse command output for common error patterns
 */
function analyzeCommandOutput(output, command) {
  const analysis = {
    hasErrors: false,
    errors: [],
    suggestions: [],
    canRetry: false
  };

  const errorPatterns = [
    { pattern: /command not found/i, suggestion: 'Install the required package', retryable: false },
    { pattern: /permission denied/i, suggestion: 'Run with sudo or check file permissions', retryable: true },
    { pattern: /connection refused/i, suggestion: 'Check if the service is running', retryable: true },
    { pattern: /no such file or directory/i, suggestion: 'Verify the file path exists', retryable: false },
    { pattern: /unable to locate package/i, suggestion: 'Update apt cache with: sudo apt update', retryable: true },
    { pattern: /E: Could not get lock/i, suggestion: 'Wait for other apt process or kill it', retryable: true },
    { pattern: /connection timed out/i, suggestion: 'Check network connectivity and security groups', retryable: true },
    { pattern: /Name or service not known/i, suggestion: 'Check DNS resolution or use IP address', retryable: false },
    { pattern: /docker daemon is not running/i, suggestion: 'Start Docker: sudo systemctl start docker', retryable: true },
    { pattern: /nginx.*failed/i, suggestion: 'Check nginx config: sudo nginx -t', retryable: true }
  ];

  for (const { pattern, suggestion, retryable } of errorPatterns) {
    if (pattern.test(output)) {
      analysis.hasErrors = true;
      analysis.errors.push({
        pattern: pattern.source,
        suggestion
      });
      if (retryable) analysis.canRetry = true;
    }
  }

  return analysis;
}

/**
 * Generate remediation command for common errors
 */
function generateRemediationCommand(error, originalCommand, context = {}) {
  // Permission denied - try with sudo
  if (/permission denied/i.test(error)) {
    if (!originalCommand.startsWith('sudo ')) {
      return `sudo ${originalCommand}`;
    }
  }

  // Package not found - update cache first
  if (/unable to locate package/i.test(error)) {
    return `sudo apt update && ${originalCommand}`;
  }

  // Apt lock - wait and retry
  if (/Could not get lock/i.test(error)) {
    return `sleep 30 && ${originalCommand}`;
  }

  // Docker not running - start it
  if (/docker daemon is not running/i.test(error)) {
    return `sudo systemctl start docker && ${originalCommand}`;
  }

  return null;
}

const tools = [
  {
    name: 'ssh_execute',
    description: 'Execute a command on a remote EC2 instance via SSH. Claude uses this to install packages, configure services, and deploy applications.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username (typically ec2-user, ubuntu, or admin)',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        command: {
          type: 'string',
          description: 'Command to execute on the remote server'
        },
        timeout: {
          type: 'number',
          description: 'Command timeout in milliseconds',
          default: 60000
        },
        autoRetry: {
          type: 'boolean',
          description: 'Automatically retry with remediation if command fails',
          default: false
        }
      },
      required: ['host', 'command']
    },
    handler: async (args) => {
      try {
        // Resolve private key path
        let keyPath = args.privateKeyPath;
        if (!keyPath) {
          // Try default locations
          const defaultPaths = [
            path.join(os.homedir(), '.ssh', 'id_rsa'),
            path.join(os.homedir(), '.ssh', 'ec2-key.pem'),
            process.env.SSH_KEY_PATH
          ].filter(Boolean);

          for (const p of defaultPaths) {
            try {
              await fs.access(p);
              keyPath = p;
              break;
            } catch {}
          }

          if (!keyPath) {
            throw new Error('No SSH private key found. Provide privateKeyPath or set SSH_KEY_PATH env var.');
          }
        }

        const result = await executeSSHCommand({
          host: args.host,
          username: args.username || 'ubuntu',
          privateKeyPath: keyPath,
          command: args.command,
          timeout: args.timeout || 60000
        });

        // Analyze output for errors
        const analysis = analyzeCommandOutput(
          result.stdout + result.stderr,
          args.command
        );

        // Auto-retry with remediation if enabled
        if (!result.success && args.autoRetry && analysis.canRetry) {
          const remediation = generateRemediationCommand(
            result.stderr,
            args.command
          );

          if (remediation) {
            logger.info(`Auto-retrying with remediation: ${remediation}`);
            const retryResult = await executeSSHCommand({
              host: args.host,
              username: args.username || 'ubuntu',
              privateKeyPath: keyPath,
              command: remediation,
              timeout: args.timeout || 60000
            });

            return {
              success: retryResult.success,
              originalCommand: args.command,
              remediationCommand: remediation,
              exitCode: retryResult.exitCode,
              stdout: retryResult.stdout,
              stderr: retryResult.stderr,
              analysis: analyzeCommandOutput(retryResult.stdout + retryResult.stderr, remediation),
              retried: true
            };
          }
        }

        return {
          success: result.success,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          analysis,
          host: args.host
        };
      } catch (error) {
        logger.error('SSH execute failed:', error);
        throw new Error(`SSH execute failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_install_package',
    description: 'Install a package on a remote EC2 instance. Automatically detects package manager (apt, yum, dnf).',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of packages to install'
        },
        packageManager: {
          type: 'string',
          enum: ['apt', 'yum', 'dnf', 'auto'],
          description: 'Package manager to use (auto-detect if not specified)',
          default: 'auto'
        }
      },
      required: ['host', 'packages']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';
        const packages = args.packages.join(' ');

        // Detect package manager if auto
        let pm = args.packageManager;
        if (pm === 'auto' || !pm) {
          const detectResult = await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: 'which apt-get yum dnf 2>/dev/null | head -1',
            timeout: 10000
          });

          if (detectResult.stdout.includes('apt')) pm = 'apt';
          else if (detectResult.stdout.includes('yum')) pm = 'yum';
          else if (detectResult.stdout.includes('dnf')) pm = 'dnf';
          else pm = 'apt'; // Default
        }

        // Build install command
        let installCmd;
        switch (pm) {
          case 'apt':
            installCmd = `sudo DEBIAN_FRONTEND=noninteractive apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages}`;
            break;
          case 'yum':
            installCmd = `sudo yum install -y ${packages}`;
            break;
          case 'dnf':
            installCmd = `sudo dnf install -y ${packages}`;
            break;
        }

        const result = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: installCmd,
          timeout: 300000 // 5 minutes for package install
        });

        return {
          success: result.success,
          packages: args.packages,
          packageManager: pm,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          analysis: analyzeCommandOutput(result.stdout + result.stderr, installCmd)
        };
      } catch (error) {
        logger.error('SSH install package failed:', error);
        throw new Error(`Package installation failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_setup_docker',
    description: 'Install and configure Docker on a remote EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        addUserToDockerGroup: {
          type: 'boolean',
          description: 'Add current user to docker group',
          default: true
        }
      },
      required: ['host']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';

        // Docker installation script
        const dockerInstallScript = `
          set -e
          
          # Remove old versions
          sudo apt-get remove -y docker docker-engine docker.io containerd runc || true
          
          # Install prerequisites
          sudo apt-get update
          sudo apt-get install -y ca-certificates curl gnupg lsb-release
          
          # Add Docker GPG key
          sudo mkdir -p /etc/apt/keyrings
          curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg --yes
          
          # Add Docker repository
          echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
          
          # Install Docker
          sudo apt-get update
          sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
          
          # Start Docker
          sudo systemctl start docker
          sudo systemctl enable docker
          
          ${args.addUserToDockerGroup !== false ? `sudo usermod -aG docker ${username}` : ''}
          
          # Verify installation
          docker --version
        `;

        const result = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: dockerInstallScript,
          timeout: 600000 // 10 minutes
        });

        // Check Docker version
        const versionResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: 'docker --version',
          timeout: 10000
        });

        return {
          success: result.success,
          dockerInstalled: result.success,
          dockerVersion: versionResult.success ? versionResult.stdout.trim() : null,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          note: args.addUserToDockerGroup !== false 
            ? 'User added to docker group. Reconnect SSH for changes to take effect.'
            : null
        };
      } catch (error) {
        logger.error('SSH Docker setup failed:', error);
        throw new Error(`Docker setup failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_setup_nginx',
    description: 'Install and configure Nginx on a remote EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        serverConfig: {
          type: 'object',
          properties: {
            serverName: { type: 'string' },
            proxyPass: { type: 'string' },
            port: { type: 'number' }
          },
          description: 'Optional Nginx server configuration'
        }
      },
      required: ['host']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';

        // Install Nginx
        const installResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: 'sudo apt-get update && sudo apt-get install -y nginx',
          timeout: 120000
        });

        if (!installResult.success) {
          return {
            success: false,
            stage: 'install',
            exitCode: installResult.exitCode,
            stderr: installResult.stderr
          };
        }

        // Configure if server config provided
        if (args.serverConfig) {
          const { serverName = '_', proxyPass, port = 80 } = args.serverConfig;
          
          const nginxConfig = `
server {
    listen ${port};
    server_name ${serverName};

    location / {
        ${proxyPass ? `proxy_pass ${proxyPass};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;` : 'root /var/www/html;'}
    }
}`;

          await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: `echo '${nginxConfig.replace(/'/g, "'\\''")}' | sudo tee /etc/nginx/sites-available/app`,
            timeout: 10000
          });

          await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: 'sudo ln -sf /etc/nginx/sites-available/app /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default',
            timeout: 10000
          });

          // Test config
          const testResult = await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: 'sudo nginx -t',
            timeout: 10000
          });

          if (!testResult.success) {
            return {
              success: false,
              stage: 'config',
              error: 'Nginx config test failed',
              stderr: testResult.stderr
            };
          }
        }

        // Start Nginx
        const startResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: 'sudo systemctl restart nginx && sudo systemctl enable nginx',
          timeout: 30000
        });

        // Get status
        const statusResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: 'systemctl is-active nginx && nginx -v',
          timeout: 10000
        });

        return {
          success: startResult.success,
          nginxInstalled: true,
          nginxRunning: statusResult.stdout.includes('active'),
          nginxVersion: statusResult.stderr.match(/nginx\/[\d.]+/)?.[0] || null,
          configApplied: !!args.serverConfig
        };
      } catch (error) {
        logger.error('SSH Nginx setup failed:', error);
        throw new Error(`Nginx setup failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_deploy_docker_app',
    description: 'Deploy a Docker application to a remote EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        image: {
          type: 'string',
          description: 'Docker image to deploy (e.g., nginx:latest, myapp:v1)'
        },
        containerName: {
          type: 'string',
          description: 'Name for the container'
        },
        ports: {
          type: 'object',
          description: 'Port mappings {hostPort: containerPort}'
        },
        env: {
          type: 'array',
          items: { type: 'string' },
          description: 'Environment variables (e.g., ["NODE_ENV=production"])'
        },
        volumes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Volume mounts (e.g., ["/host/path:/container/path"])'
        },
        stopExisting: {
          type: 'boolean',
          description: 'Stop and remove existing container with same name',
          default: true
        }
      },
      required: ['host', 'image']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';
        const containerName = args.containerName || `app-${Date.now()}`;

        // Stop existing container if requested
        if (args.stopExisting) {
          await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`,
            timeout: 30000
          });
        }

        // Pull image
        const pullResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker pull ${args.image}`,
          timeout: 300000 // 5 min for pull
        });

        if (!pullResult.success && !pullResult.stderr.includes('up to date')) {
          // Image might be local or private, continue anyway
          logger.warn(`Image pull may have failed: ${pullResult.stderr}`);
        }

        // Build run command
        let runCmd = `docker run -d --name ${containerName} --restart unless-stopped`;

        // Add ports
        if (args.ports) {
          for (const [host, container] of Object.entries(args.ports)) {
            runCmd += ` -p ${host}:${container}`;
          }
        }

        // Add env vars
        if (args.env) {
          for (const e of args.env) {
            runCmd += ` -e "${e}"`;
          }
        }

        // Add volumes
        if (args.volumes) {
          for (const v of args.volumes) {
            runCmd += ` -v ${v}`;
          }
        }

        runCmd += ` ${args.image}`;

        // Run container
        const runResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: runCmd,
          timeout: 60000
        });

        if (!runResult.success) {
          return {
            success: false,
            stage: 'run',
            exitCode: runResult.exitCode,
            stderr: runResult.stderr,
            command: runCmd,
            analysis: analyzeCommandOutput(runResult.stderr, runCmd)
          };
        }

        // Get container status
        const statusResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker ps --filter name=${containerName} --format "{{.Status}}"`,
          timeout: 10000
        });

        // Get container logs (last 20 lines)
        const logsResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker logs --tail 20 ${containerName} 2>&1`,
          timeout: 10000
        });

        return {
          success: true,
          containerId: runResult.stdout.trim().substring(0, 12),
          containerName,
          image: args.image,
          status: statusResult.stdout.trim(),
          recentLogs: logsResult.stdout,
          host: args.host,
          ports: args.ports
        };
      } catch (error) {
        logger.error('SSH Docker deploy failed:', error);
        throw new Error(`Docker deployment failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_rollback_docker',
    description: 'Rollback a Docker deployment to a previous image version',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        containerName: {
          type: 'string',
          description: 'Name of the container to rollback'
        },
        targetImage: {
          type: 'string',
          description: 'Image:tag to rollback to'
        }
      },
      required: ['host', 'containerName', 'targetImage']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';

        // Get current container config
        const inspectResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker inspect ${args.containerName} --format '{{json .}}'`,
          timeout: 10000
        });

        let currentConfig = {};
        try {
          currentConfig = JSON.parse(inspectResult.stdout);
        } catch {}

        // Stop and remove current container
        await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker stop ${args.containerName} && docker rm ${args.containerName}`,
          timeout: 60000
        });

        // Pull rollback image
        await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: `docker pull ${args.targetImage}`,
          timeout: 300000
        });

        // Reconstruct run command from config
        let runCmd = `docker run -d --name ${args.containerName} --restart unless-stopped`;

        // Add ports from old config
        const ports = currentConfig?.HostConfig?.PortBindings || {};
        for (const [container, bindings] of Object.entries(ports)) {
          const hostPort = bindings?.[0]?.HostPort;
          if (hostPort) {
            runCmd += ` -p ${hostPort}:${container.split('/')[0]}`;
          }
        }

        // Add env vars from old config
        const envVars = currentConfig?.Config?.Env || [];
        for (const e of envVars) {
          if (!e.startsWith('PATH=')) { // Skip PATH
            runCmd += ` -e "${e}"`;
          }
        }

        runCmd += ` ${args.targetImage}`;

        // Run rollback container
        const runResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: runCmd,
          timeout: 60000
        });

        return {
          success: runResult.success,
          containerName: args.containerName,
          rolledBackTo: args.targetImage,
          containerId: runResult.stdout.trim().substring(0, 12),
          exitCode: runResult.exitCode,
          message: runResult.success 
            ? `Successfully rolled back to ${args.targetImage}`
            : `Rollback failed: ${runResult.stderr}`
        };
      } catch (error) {
        logger.error('SSH Docker rollback failed:', error);
        throw new Error(`Docker rollback failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_check_service_health',
    description: 'Check the health status of services running on EC2',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        services: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of services to check (e.g., docker, nginx, node)'
        },
        checkPorts: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ports to check if listening'
        }
      },
      required: ['host']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';

        const results = {
          services: {},
          ports: {},
          containers: [],
          diskSpace: null,
          memory: null
        };

        // Check services
        const servicesToCheck = args.services || ['docker', 'nginx'];
        for (const service of servicesToCheck) {
          const statusResult = await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: `systemctl is-active ${service} 2>/dev/null || echo inactive`,
            timeout: 5000
          });
          results.services[service] = statusResult.stdout.trim();
        }

        // Check ports
        if (args.checkPorts?.length > 0) {
          const portsResult = await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: `ss -tlnp | grep -E '${args.checkPorts.join('|')}'`,
            timeout: 5000
          });
          for (const port of args.checkPorts) {
            results.ports[port] = portsResult.stdout.includes(`:${port}`);
          }
        }

        // Check Docker containers
        const containersResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: 'docker ps --format "{{.Names}}:{{.Status}}" 2>/dev/null || echo "docker not available"',
          timeout: 10000
        });
        if (!containersResult.stdout.includes('docker not available')) {
          results.containers = containersResult.stdout.trim().split('\n')
            .filter(Boolean)
            .map(line => {
              const [name, ...status] = line.split(':');
              return { name, status: status.join(':') };
            });
        }

        // Check disk space
        const diskResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: "df -h / | tail -1 | awk '{print $5}'",
          timeout: 5000
        });
        results.diskSpace = diskResult.stdout.trim();

        // Check memory
        const memResult = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: "free -m | awk '/Mem:/ {printf \"%.1f%%\", $3/$2*100}'",
          timeout: 5000
        });
        results.memory = memResult.stdout.trim();

        // Overall health assessment
        const allServicesHealthy = Object.values(results.services).every(s => s === 'active');
        const allPortsOpen = Object.values(results.ports).every(p => p === true);
        const containersRunning = results.containers.every(c => c.status.includes('Up'));

        results.healthy = allServicesHealthy && allPortsOpen && containersRunning;
        results.host = args.host;

        return results;
      } catch (error) {
        logger.error('SSH health check failed:', error);
        throw new Error(`Health check failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_get_logs',
    description: 'Get logs from services or applications running on EC2',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        source: {
          type: 'string',
          enum: ['docker', 'systemd', 'file'],
          description: 'Log source type'
        },
        target: {
          type: 'string',
          description: 'Container name (for docker), service name (for systemd), or file path'
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to retrieve',
          default: 100
        }
      },
      required: ['host', 'source', 'target']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';
        const lines = args.lines || 100;

        let logCommand;
        switch (args.source) {
          case 'docker':
            logCommand = `docker logs --tail ${lines} ${args.target} 2>&1`;
            break;
          case 'systemd':
            logCommand = `journalctl -u ${args.target} -n ${lines} --no-pager`;
            break;
          case 'file':
            logCommand = `tail -n ${lines} ${args.target}`;
            break;
        }

        const result = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: logCommand,
          timeout: 30000
        });

        // Analyze logs for errors
        const analysis = analyzeCommandOutput(result.stdout + result.stderr, logCommand);

        return {
          success: result.success,
          source: args.source,
          target: args.target,
          logs: result.stdout,
          lineCount: result.stdout.split('\n').length,
          analysis,
          host: args.host
        };
      } catch (error) {
        logger.error('SSH get logs failed:', error);
        throw new Error(`Get logs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_copy_file',
    description: 'Copy a file to a remote EC2 instance via SCP',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        localPath: {
          type: 'string',
          description: 'Local file path to copy'
        },
        remotePath: {
          type: 'string',
          description: 'Destination path on remote server'
        }
      },
      required: ['host', 'localPath', 'remotePath']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        
        const result = await scpFile({
          host: args.host,
          username: args.username || 'ubuntu',
          privateKeyPath: keyPath,
          localPath: args.localPath,
          remotePath: args.remotePath
        });

        return {
          success: result.success,
          localPath: args.localPath,
          remotePath: args.remotePath,
          host: args.host,
          exitCode: result.exitCode
        };
      } catch (error) {
        logger.error('SSH copy file failed:', error);
        throw new Error(`File copy failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ssh_analyze_and_fix_error',
    description: 'Claude uses this to analyze an error and attempt automatic remediation. It analyzes the error output and runs a suggested fix command.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'EC2 instance public IP or hostname'
        },
        username: {
          type: 'string',
          description: 'SSH username',
          default: 'ubuntu'
        },
        privateKeyPath: {
          type: 'string',
          description: 'Path to SSH private key file'
        },
        errorOutput: {
          type: 'string',
          description: 'The error output to analyze'
        },
        failedCommand: {
          type: 'string',
          description: 'The command that originally failed'
        },
        context: {
          type: 'object',
          description: 'Additional context (e.g., what we were trying to do)'
        }
      },
      required: ['host', 'errorOutput', 'failedCommand']
    },
    handler: async (args) => {
      try {
        const keyPath = args.privateKeyPath || process.env.SSH_KEY_PATH;
        const username = args.username || 'ubuntu';

        // Analyze the error
        const analysis = analyzeCommandOutput(args.errorOutput, args.failedCommand);

        // Generate remediation command
        const remediation = generateRemediationCommand(
          args.errorOutput,
          args.failedCommand,
          args.context || {}
        );

        if (!remediation) {
          return {
            success: false,
            analyzed: true,
            analysis,
            message: 'No automatic remediation available for this error',
            suggestions: analysis.suggestions
          };
        }

        logger.info(`Attempting remediation: ${remediation}`);

        // Execute remediation
        const result = await executeSSHCommand({
          host: args.host,
          username,
          privateKeyPath: keyPath,
          command: remediation,
          timeout: 120000
        });

        // If remediation worked, retry original command
        if (result.success) {
          logger.info('Remediation successful, retrying original command');
          
          const retryResult = await executeSSHCommand({
            host: args.host,
            username,
            privateKeyPath: keyPath,
            command: args.failedCommand,
            timeout: 120000
          });

          return {
            success: retryResult.success,
            remediated: true,
            remediationCommand: remediation,
            retryExitCode: retryResult.exitCode,
            retryOutput: retryResult.stdout,
            analysis
          };
        }

        return {
          success: false,
          remediated: false,
          remediationCommand: remediation,
          remediationFailed: true,
          exitCode: result.exitCode,
          stderr: result.stderr,
          analysis
        };
      } catch (error) {
        logger.error('SSH analyze and fix error failed:', error);
        throw new Error(`Error analysis failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all SSH tools
 */
const getTools = () => tools;

module.exports = {
  getTools,
  executeSSHCommand,
  scpFile,
  analyzeCommandOutput,
  generateRemediationCommand
};


