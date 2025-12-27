const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const logger = require('../../utils/logger');
const CredentialService = require('../../services/credentialService');

/**
 * Terraform MCP Tools
 * These tools enable Claude to provision and manage infrastructure using Terraform
 * Uses stored AWS credentials from the credential service
 */

/**
 * Execute Terraform command
 */
function execTerraform(args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('terraform', args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdout = [];
    const stderr = [];

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      stdout.push(line);
      if (options.onOutput) options.onOutput(line);
    });

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      stderr.push(line);
      if (options.onOutput) options.onOutput(line);
    });

    proc.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        output: stdout.join('') + stderr.join('')
      });
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: 'terraform command not found. Please install Terraform.',
          output: 'terraform command not found'
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Generate Terraform configuration for common resources
 */
function generateTerraformConfig(resourceType, options) {
  switch (resourceType) {
    case 'ec2-instance':
      return `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${options.region || 'us-east-1'}"
}

resource "aws_instance" "main" {
  ami           = "${options.amiId || 'ami-0261755bbcb8c4a84'}"
  instance_type = "${options.instanceType || 't2.micro'}"
  key_name      = "${options.keyName || 'default-key'}"

  tags = {
    Name        = "${options.name || 'deployment-instance'}"
    ManagedBy   = "deployment-agent"
    CreatedAt   = "${new Date().toISOString()}"
  }
}

output "instance_id" {
  value = aws_instance.main.id
}

output "public_ip" {
  value = aws_instance.main.public_ip
}

output "private_ip" {
  value = aws_instance.main.private_ip
}
`;

    case 'ecs-cluster':
      return `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${options.region || 'us-east-1'}"
}

resource "aws_ecs_cluster" "main" {
  name = "${options.clusterName || 'deployment-cluster'}"

  setting {
    name  = "containerInsights"
    value = "${options.containerInsights !== false ? 'enabled' : 'disabled'}"
  }

  tags = {
    Name      = "${options.clusterName || 'deployment-cluster'}"
    ManagedBy = "deployment-agent"
  }
}

output "cluster_id" {
  value = aws_ecs_cluster.main.id
}

output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}
`;

    case 'vpc':
      return `
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${options.region || 'us-east-1'}"
}

resource "aws_vpc" "main" {
  cidr_block           = "${options.cidrBlock || '10.0.0.0/16'}"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name      = "${options.name || 'deployment-vpc'}"
    ManagedBy = "deployment-agent"
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${options.name || 'deployment-vpc'}-igw"
  }
}

resource "aws_subnet" "public" {
  count             = ${options.availabilityZones?.length || 2}
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.\${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name = "${options.name || 'deployment-vpc'}-public-\${count.index + 1}"
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "${options.name || 'deployment-vpc'}-public-rt"
  }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "subnet_ids" {
  value = aws_subnet.public[*].id
}
`;

    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }
}

const tools = [
  {
    name: 'terraform_init',
    description: 'Initialize a Terraform working directory',
    inputSchema: {
      type: 'object',
      properties: {
        workingDir: {
          type: 'string',
          description: 'Path to Terraform working directory'
        },
        userId: {
          type: 'string',
          description: 'User ID for credential retrieval'
        }
      },
      required: ['workingDir']
    },
    handler: async (args) => {
      try {
        const env = {};
        
        // Get AWS credentials if userId provided
        if (args.userId) {
          const awsCreds = await CredentialService.setAWSEnvForProcess(args.userId);
          Object.assign(env, awsCreds);
        }

        const result = await execTerraform(['init'], {
          cwd: args.workingDir,
          env
        });

        return {
          success: result.success,
          output: result.output,
          error: result.success ? null : result.stderr
        };
      } catch (error) {
        logger.error('Terraform init failed:', error);
        throw new Error(`Terraform init failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_plan',
    description: 'Generate and show an execution plan',
    inputSchema: {
      type: 'object',
      properties: {
        workingDir: {
          type: 'string',
          description: 'Path to Terraform working directory'
        },
        userId: {
          type: 'string',
          description: 'User ID for credential retrieval'
        },
        out: {
          type: 'string',
          description: 'Path to save plan file'
        }
      },
      required: ['workingDir']
    },
    handler: async (args) => {
      try {
        const env = {};
        if (args.userId) {
          const awsCreds = await CredentialService.setAWSEnvForProcess(args.userId);
          Object.assign(env, awsCreds);
        }

        const tfArgs = ['plan'];
        if (args.out) {
          tfArgs.push('-out', args.out);
        }

        const result = await execTerraform(tfArgs, {
          cwd: args.workingDir,
          env
        });

        return {
          success: result.success,
          output: result.output,
          changesDetected: result.output.includes('will be created') || 
                          result.output.includes('will be updated') ||
                          result.output.includes('will be destroyed'),
          planFile: args.out || null
        };
      } catch (error) {
        logger.error('Terraform plan failed:', error);
        throw new Error(`Terraform plan failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_apply',
    description: 'Build or change infrastructure',
    inputSchema: {
      type: 'object',
      properties: {
        workingDir: {
          type: 'string',
          description: 'Path to Terraform working directory'
        },
        userId: {
          type: 'string',
          description: 'User ID for credential retrieval'
        },
        autoApprove: {
          type: 'boolean',
          description: 'Skip interactive approval',
          default: false
        },
        planFile: {
          type: 'string',
          description: 'Path to plan file (from terraform_plan)'
        }
      },
      required: ['workingDir']
    },
    handler: async (args) => {
      try {
        const env = {};
        if (args.userId) {
          const awsCreds = await CredentialService.setAWSEnvForProcess(args.userId);
          Object.assign(env, awsCreds);
        }

        const tfArgs = ['apply'];
        if (args.autoApprove) {
          tfArgs.push('-auto-approve');
        }
        if (args.planFile) {
          tfArgs.push(args.planFile);
        }

        const result = await execTerraform(tfArgs, {
          cwd: args.workingDir,
          env
        });

        // Parse outputs
        const outputs = {};
        if (result.success) {
          const outputResult = await execTerraform(['output', '-json'], {
            cwd: args.workingDir,
            env
          });
          
          if (outputResult.success) {
            try {
              const parsed = JSON.parse(outputResult.stdout);
              for (const [key, value] of Object.entries(parsed)) {
                outputs[key] = value.value;
              }
            } catch {}
          }
        }

        return {
          success: result.success,
          output: result.output,
          outputs,
          error: result.success ? null : result.stderr
        };
      } catch (error) {
        logger.error('Terraform apply failed:', error);
        throw new Error(`Terraform apply failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_destroy',
    description: 'Destroy Terraform-managed infrastructure',
    inputSchema: {
      type: 'object',
      properties: {
        workingDir: {
          type: 'string',
          description: 'Path to Terraform working directory'
        },
        userId: {
          type: 'string',
          description: 'User ID for credential retrieval'
        },
        autoApprove: {
          type: 'boolean',
          description: 'Skip interactive approval',
          default: false
        }
      },
      required: ['workingDir']
    },
    handler: async (args) => {
      try {
        const env = {};
        if (args.userId) {
          const awsCreds = await CredentialService.setAWSEnvForProcess(args.userId);
          Object.assign(env, awsCreds);
        }

        const tfArgs = ['destroy'];
        if (args.autoApprove) {
          tfArgs.push('-auto-approve');
        }

        const result = await execTerraform(tfArgs, {
          cwd: args.workingDir,
          env
        });

        return {
          success: result.success,
          output: result.output,
          error: result.success ? null : result.stderr
        };
      } catch (error) {
        logger.error('Terraform destroy failed:', error);
        throw new Error(`Terraform destroy failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_output',
    description: 'Read outputs from a Terraform state',
    inputSchema: {
      type: 'object',
      properties: {
        workingDir: {
          type: 'string',
          description: 'Path to Terraform working directory'
        },
        outputName: {
          type: 'string',
          description: 'Specific output name (omit for all)'
        },
        userId: {
          type: 'string',
          description: 'User ID for credential retrieval'
        }
      },
      required: ['workingDir']
    },
    handler: async (args) => {
      try {
        const env = {};
        if (args.userId) {
          const awsCreds = await CredentialService.setAWSEnvForProcess(args.userId);
          Object.assign(env, awsCreds);
        }

        const tfArgs = ['output', '-json'];
        if (args.outputName) {
          tfArgs.push(args.outputName);
        }

        const result = await execTerraform(tfArgs, {
          cwd: args.workingDir,
          env
        });

        if (!result.success) {
          return {
            success: false,
            error: result.stderr
          };
        }

        let outputs = {};
        try {
          const parsed = JSON.parse(result.stdout);
          if (args.outputName) {
            outputs[args.outputName] = parsed.value;
          } else {
            for (const [key, value] of Object.entries(parsed)) {
              outputs[key] = value.value;
            }
          }
        } catch {
          outputs = { raw: result.stdout };
        }

        return {
          success: true,
          outputs
        };
      } catch (error) {
        logger.error('Terraform output failed:', error);
        throw new Error(`Terraform output failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_generate_config',
    description: 'Generate Terraform configuration for common AWS resources',
    inputSchema: {
      type: 'object',
      properties: {
        resourceType: {
          type: 'string',
          enum: ['ec2-instance', 'ecs-cluster', 'vpc'],
          description: 'Type of resource to generate'
        },
        options: {
          type: 'object',
          description: 'Resource-specific options'
        },
        savePath: {
          type: 'string',
          description: 'Path to save the generated .tf file'
        }
      },
      required: ['resourceType']
    },
    handler: async (args) => {
      try {
        const config = generateTerraformConfig(args.resourceType, args.options || {});

        if (args.savePath) {
          await fs.writeFile(args.savePath, config, 'utf8');
        }

        return {
          success: true,
          resourceType: args.resourceType,
          config,
          savedTo: args.savePath || null
        };
      } catch (error) {
        logger.error('Terraform generate config failed:', error);
        throw new Error(`Terraform generate config failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_provision_ec2',
    description: 'High-level tool to provision EC2 instance using Terraform',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Instance name'
        },
        instanceType: {
          type: 'string',
          description: 'EC2 instance type',
          default: 't2.micro'
        },
        amiId: {
          type: 'string',
          description: 'AMI ID (uses Ubuntu 22.04 if not specified)'
        },
        keyName: {
          type: 'string',
          description: 'EC2 key pair name'
        },
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        userId: {
          type: 'string',
          description: 'User ID for AWS credentials'
        },
        workingDir: {
          type: 'string',
          description: 'Terraform working directory (created if not exists)'
        }
      },
      required: ['name', 'userId']
    },
    handler: async (args) => {
      try {
        const workingDir = args.workingDir || path.join(os.tmpdir(), `terraform-${args.name}-${Date.now()}`);
        
        // Create working directory
        await fs.mkdir(workingDir, { recursive: true });

        // Generate Terraform config
        const config = generateTerraformConfig('ec2-instance', {
          name: args.name,
          instanceType: args.instanceType || 't2.micro',
          amiId: args.amiId,
          keyName: args.keyName,
          region: args.region || 'us-east-1'
        });

        const mainTf = path.join(workingDir, 'main.tf');
        await fs.writeFile(mainTf, config, 'utf8');

        // Initialize
        const initResult = await execTerraform(['init'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        if (!initResult.success) {
          return {
            success: false,
            stage: 'init',
            error: initResult.stderr,
            workingDir
          };
        }

        // Plan
        const planResult = await execTerraform(['plan', '-out=tfplan'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        if (!planResult.success) {
          return {
            success: false,
            stage: 'plan',
            error: planResult.stderr,
            workingDir
          };
        }

        // Apply
        const applyResult = await execTerraform(['apply', '-auto-approve', 'tfplan'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        if (!applyResult.success) {
          return {
            success: false,
            stage: 'apply',
            error: applyResult.stderr,
            workingDir
          };
        }

        // Get outputs
        const outputResult = await execTerraform(['output', '-json'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        let outputs = {};
        if (outputResult.success) {
          try {
            const parsed = JSON.parse(outputResult.stdout);
            for (const [key, value] of Object.entries(parsed)) {
              outputs[key] = value.value;
            }
          } catch {}
        }

        return {
          success: true,
          name: args.name,
          workingDir,
          outputs,
          instanceId: outputs.instance_id,
          publicIp: outputs.public_ip,
          privateIp: outputs.private_ip,
          message: `EC2 instance ${outputs.instance_id} provisioned. Public IP: ${outputs.public_ip}`
        };
      } catch (error) {
        logger.error('Terraform provision EC2 failed:', error);
        throw new Error(`Terraform provision EC2 failed: ${error.message}`);
      }
    }
  },

  {
    name: 'terraform_provision_ecs_cluster',
    description: 'High-level tool to provision ECS cluster using Terraform',
    inputSchema: {
      type: 'object',
      properties: {
        clusterName: {
          type: 'string',
          description: 'ECS cluster name'
        },
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        userId: {
          type: 'string',
          description: 'User ID for AWS credentials'
        },
        workingDir: {
          type: 'string',
          description: 'Terraform working directory'
        }
      },
      required: ['clusterName', 'userId']
    },
    handler: async (args) => {
      try {
        const workingDir = args.workingDir || path.join(os.tmpdir(), `terraform-ecs-${args.clusterName}-${Date.now()}`);
        
        await fs.mkdir(workingDir, { recursive: true });

        const config = generateTerraformConfig('ecs-cluster', {
          clusterName: args.clusterName,
          region: args.region || 'us-east-1',
          containerInsights: true
        });

        const mainTf = path.join(workingDir, 'main.tf');
        await fs.writeFile(mainTf, config, 'utf8');

        // Initialize, plan, apply
        const initResult = await execTerraform(['init'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        if (!initResult.success) {
          return { success: false, stage: 'init', error: initResult.stderr };
        }

        const applyResult = await execTerraform(['apply', '-auto-approve'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        if (!applyResult.success) {
          return { success: false, stage: 'apply', error: applyResult.stderr };
        }

        const outputResult = await execTerraform(['output', '-json'], {
          cwd: workingDir,
          env: await CredentialService.setAWSEnvForProcess(args.userId)
        });

        let outputs = {};
        if (outputResult.success) {
          try {
            const parsed = JSON.parse(outputResult.stdout);
            for (const [key, value] of Object.entries(parsed)) {
              outputs[key] = value.value;
            }
          } catch {}
        }

        return {
          success: true,
          clusterName: args.clusterName,
          workingDir,
          outputs,
          clusterArn: outputs.cluster_arn,
          message: `ECS cluster ${args.clusterName} provisioned`
        };
      } catch (error) {
        logger.error('Terraform provision ECS cluster failed:', error);
        throw new Error(`Terraform provision ECS cluster failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all Terraform tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};
