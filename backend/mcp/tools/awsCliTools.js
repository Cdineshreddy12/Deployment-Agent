const logger = require('../../utils/logger');
const cliExecutor = require('../../services/cliExecutor');

/**
 * AWS CLI MCP Tools
 * Tools for executing AWS CLI commands via the deployment agent
 */

const tools = [
  {
    name: 'aws_check_configuration',
    description: 'Check if AWS CLI is configured and accessible',
    inputSchema: {
      type: 'object',
      properties: {
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      }
    },
    handler: async (args) => {
      try {
        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          'aws sts get-caller-identity',
          { timeout: 30000 }
        );

        if (result.success) {
          const identity = JSON.parse(result.stdout);
          return {
            success: true,
            configured: true,
            account: identity.Account,
            arn: identity.Arn,
            userId: identity.UserId
          };
        } else {
          return {
            success: false,
            configured: false,
            error: result.stderr || 'AWS CLI not configured or credentials expired'
          };
        }
      } catch (error) {
        return {
          success: false,
          configured: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_ec2_list_instances',
    description: 'List EC2 instances with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              Name: { type: 'string' },
              Values: { type: 'array', items: { type: 'string' } }
            }
          },
          description: 'EC2 filters (e.g., instance-state-name, tag:Name)'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      }
    },
    handler: async (args) => {
      try {
        let cmd = 'aws ec2 describe-instances --output json';
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }

        if (args.filters && args.filters.length > 0) {
          const filterStr = args.filters.map(f => 
            `Name=${f.Name},Values=${f.Values.join(',')}`
          ).join(' ');
          cmd += ` --filters ${filterStr}`;
        }

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 60000 }
        );

        if (result.success) {
          const data = JSON.parse(result.stdout);
          const instances = [];

          for (const reservation of data.Reservations || []) {
            for (const instance of reservation.Instances || []) {
              const nameTag = instance.Tags?.find(t => t.Key === 'Name');
              instances.push({
                instanceId: instance.InstanceId,
                name: nameTag?.Value || 'N/A',
                state: instance.State?.Name,
                type: instance.InstanceType,
                publicIp: instance.PublicIpAddress,
                privateIp: instance.PrivateIpAddress,
                launchTime: instance.LaunchTime,
                keyName: instance.KeyName
              });
            }
          }

          return {
            success: true,
            count: instances.length,
            instances
          };
        } else {
          return {
            success: false,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('EC2 list instances failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_ec2_describe_instance',
    description: 'Get detailed information about a specific EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'EC2 instance ID'
        },
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      },
      required: ['instanceId']
    },
    handler: async (args) => {
      try {
        let cmd = `aws ec2 describe-instances --instance-ids ${args.instanceId} --output json`;
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 60000 }
        );

        if (result.success) {
          const data = JSON.parse(result.stdout);
          const instance = data.Reservations?.[0]?.Instances?.[0];

          if (!instance) {
            return {
              success: false,
              error: 'Instance not found'
            };
          }

          return {
            success: true,
            instance: {
              instanceId: instance.InstanceId,
              name: instance.Tags?.find(t => t.Key === 'Name')?.Value,
              state: instance.State?.Name,
              type: instance.InstanceType,
              publicIp: instance.PublicIpAddress,
              privateIp: instance.PrivateIpAddress,
              publicDns: instance.PublicDnsName,
              privateDns: instance.PrivateDnsName,
              launchTime: instance.LaunchTime,
              keyName: instance.KeyName,
              securityGroups: instance.SecurityGroups,
              subnetId: instance.SubnetId,
              vpcId: instance.VpcId,
              architecture: instance.Architecture,
              platform: instance.PlatformDetails,
              tags: instance.Tags
            }
          };
        } else {
          return {
            success: false,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('EC2 describe instance failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_ec2_list_key_pairs',
    description: 'List available EC2 key pairs',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      }
    },
    handler: async (args) => {
      try {
        let cmd = 'aws ec2 describe-key-pairs --output json';
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 30000 }
        );

        if (result.success) {
          const data = JSON.parse(result.stdout);
          const keyPairs = (data.KeyPairs || []).map(kp => ({
            keyName: kp.KeyName,
            keyFingerprint: kp.KeyFingerprint,
            keyType: kp.KeyType,
            createTime: kp.CreateTime
          }));

          return {
            success: true,
            count: keyPairs.length,
            keyPairs
          };
        } else {
          return {
            success: false,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('EC2 list key pairs failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_ec2_list_security_groups',
    description: 'List security groups',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        vpcId: {
          type: 'string',
          description: 'Filter by VPC ID'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      }
    },
    handler: async (args) => {
      try {
        let cmd = 'aws ec2 describe-security-groups --output json';
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }

        if (args.vpcId) {
          cmd += ` --filters Name=vpc-id,Values=${args.vpcId}`;
        }

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 30000 }
        );

        if (result.success) {
          const data = JSON.parse(result.stdout);
          const securityGroups = (data.SecurityGroups || []).map(sg => ({
            groupId: sg.GroupId,
            groupName: sg.GroupName,
            description: sg.Description,
            vpcId: sg.VpcId,
            inboundRules: sg.IpPermissions?.length || 0,
            outboundRules: sg.IpPermissionsEgress?.length || 0
          }));

          return {
            success: true,
            count: securityGroups.length,
            securityGroups
          };
        } else {
          return {
            success: false,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('EC2 list security groups failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_ec2_list_vpcs',
    description: 'List available VPCs',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'AWS region',
          default: 'us-east-1'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      }
    },
    handler: async (args) => {
      try {
        let cmd = 'aws ec2 describe-vpcs --output json';
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 30000 }
        );

        if (result.success) {
          const data = JSON.parse(result.stdout);
          const vpcs = (data.Vpcs || []).map(vpc => ({
            vpcId: vpc.VpcId,
            cidrBlock: vpc.CidrBlock,
            state: vpc.State,
            isDefault: vpc.IsDefault,
            name: vpc.Tags?.find(t => t.Key === 'Name')?.Value
          }));

          return {
            success: true,
            count: vpcs.length,
            vpcs
          };
        } else {
          return {
            success: false,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('EC2 list VPCs failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  },

  {
    name: 'aws_run_command',
    description: 'Run a custom AWS CLI command',
    inputSchema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          description: 'AWS service (e.g., ec2, s3, ecs)'
        },
        subCommand: {
          type: 'string',
          description: 'Sub-command to run (e.g., describe-instances, ls)'
        },
        args: {
          type: 'string',
          description: 'Additional arguments'
        },
        region: {
          type: 'string',
          description: 'AWS region'
        },
        deploymentId: {
          type: 'string',
          description: 'Deployment ID for logging'
        }
      },
      required: ['service', 'subCommand']
    },
    handler: async (args) => {
      try {
        let cmd = `aws ${args.service} ${args.subCommand}`;
        
        if (args.args) {
          cmd += ` ${args.args}`;
        }
        
        if (args.region) {
          cmd += ` --region ${args.region}`;
        }
        
        cmd += ' --output json';

        const result = await cliExecutor.executeWithStream(
          args.deploymentId || 'temp',
          cmd,
          { timeout: 120000 }
        );

        if (result.success) {
          let parsedOutput;
          try {
            parsedOutput = JSON.parse(result.stdout);
          } catch {
            parsedOutput = result.stdout;
          }

          return {
            success: true,
            command: cmd,
            output: parsedOutput
          };
        } else {
          return {
            success: false,
            command: cmd,
            error: result.stderr
          };
        }
      } catch (error) {
        logger.error('AWS run command failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  }
];

/**
 * Get all AWS CLI tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};

