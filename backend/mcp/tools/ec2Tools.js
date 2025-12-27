const logger = require('../../utils/logger');

/**
 * EC2 Provisioning MCP Tools
 * These tools enable Claude to provision, manage, and configure EC2 instances
 * Using AWS SDK v3 for modern async operations
 */

// Lazy load AWS SDK v3 modules to avoid startup cost if not used
let EC2Client, RunInstancesCommand, DescribeInstancesCommand, 
    TerminateInstancesCommand, CreateSecurityGroupCommand,
    AuthorizeSecurityGroupIngressCommand, DescribeSecurityGroupsCommand,
    CreateKeyPairCommand, DescribeKeyPairsCommand, 
    WaitUntilInstanceRunning, StopInstancesCommand, StartInstancesCommand,
    DescribeImagesCommand;

async function getEC2Client() {
  if (!EC2Client) {
    const sdk = await import('@aws-sdk/client-ec2');
    EC2Client = sdk.EC2Client;
    RunInstancesCommand = sdk.RunInstancesCommand;
    DescribeInstancesCommand = sdk.DescribeInstancesCommand;
    TerminateInstancesCommand = sdk.TerminateInstancesCommand;
    CreateSecurityGroupCommand = sdk.CreateSecurityGroupCommand;
    AuthorizeSecurityGroupIngressCommand = sdk.AuthorizeSecurityGroupIngressCommand;
    DescribeSecurityGroupsCommand = sdk.DescribeSecurityGroupsCommand;
    CreateKeyPairCommand = sdk.CreateKeyPairCommand;
    DescribeKeyPairsCommand = sdk.DescribeKeyPairsCommand;
    StopInstancesCommand = sdk.StopInstancesCommand;
    StartInstancesCommand = sdk.StartInstancesCommand;
    DescribeImagesCommand = sdk.DescribeImagesCommand;
    
    const { waitUntilInstanceRunning } = await import('@aws-sdk/client-ec2');
    WaitUntilInstanceRunning = waitUntilInstanceRunning;
  }
  
  return new EC2Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    } : undefined // Use default credential chain if not set
  });
}

/**
 * Common AMI IDs for different regions (Ubuntu 22.04 LTS)
 */
const UBUNTU_AMIS = {
  'us-east-1': 'ami-0261755bbcb8c4a84',
  'us-west-2': 'ami-03f65b8614a860c29',
  'eu-west-1': 'ami-01dd271720c1ba44f',
  'ap-south-1': 'ami-03f4878755434977f'
};

const tools = [
  {
    name: 'ec2_launch_instance',
    description: 'Launch a new EC2 instance for deployment. Claude uses this to provision infrastructure.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name tag for the instance'
        },
        instanceType: {
          type: 'string',
          description: 'EC2 instance type (e.g., t2.micro, t3.small, t3.medium)',
          default: 't2.micro'
        },
        amiId: {
          type: 'string',
          description: 'AMI ID to use. If not provided, uses Ubuntu 22.04 LTS'
        },
        keyName: {
          type: 'string',
          description: 'Name of the EC2 key pair for SSH access'
        },
        securityGroupIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Security group IDs to attach'
        },
        subnetId: {
          type: 'string',
          description: 'Subnet ID to launch in (optional, uses default VPC if not specified)'
        },
        userData: {
          type: 'string',
          description: 'User data script to run on instance start (base64 encoded or plain text)'
        },
        tags: {
          type: 'object',
          description: 'Additional tags for the instance'
        },
        waitUntilRunning: {
          type: 'boolean',
          description: 'Wait for instance to be in running state',
          default: true
        }
      },
      required: ['name', 'keyName']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();
        const region = process.env.AWS_REGION || 'us-east-1';

        // Build tags
        const tags = [
          { Key: 'Name', Value: args.name },
          { Key: 'ManagedBy', Value: 'deployment-agent' },
          { Key: 'CreatedAt', Value: new Date().toISOString() },
          ...(Object.entries(args.tags || {}).map(([Key, Value]) => ({ Key, Value: String(Value) })))
        ];

        // Use provided AMI or default Ubuntu
        const amiId = args.amiId || UBUNTU_AMIS[region] || UBUNTU_AMIS['us-east-1'];

        // Prepare user data (encode if not already)
        let userData = args.userData;
        if (userData && !userData.match(/^[A-Za-z0-9+/=]+$/)) {
          userData = Buffer.from(userData).toString('base64');
        }

        const runParams = {
          ImageId: amiId,
          InstanceType: args.instanceType || 't2.micro',
          KeyName: args.keyName,
          MinCount: 1,
          MaxCount: 1,
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: tags
          }]
        };

        if (args.securityGroupIds?.length > 0) {
          runParams.SecurityGroupIds = args.securityGroupIds;
        }

        if (args.subnetId) {
          runParams.SubnetId = args.subnetId;
        }

        if (userData) {
          runParams.UserData = userData;
        }

        logger.info('Launching EC2 instance', { name: args.name, type: args.instanceType, ami: amiId });

        const runResult = await client.send(new RunInstancesCommand(runParams));
        const instance = runResult.Instances[0];
        const instanceId = instance.InstanceId;

        logger.info(`EC2 instance launched: ${instanceId}`);

        // Wait for instance to be running if requested
        let publicIp = null;
        if (args.waitUntilRunning !== false) {
          await WaitUntilInstanceRunning(
            { client, maxWaitTime: 300 },
            { InstanceIds: [instanceId] }
          );

          // Get public IP
          const describeResult = await client.send(new DescribeInstancesCommand({
            InstanceIds: [instanceId]
          }));
          publicIp = describeResult.Reservations[0]?.Instances[0]?.PublicIpAddress;
        }

        return {
          success: true,
          instanceId,
          name: args.name,
          instanceType: args.instanceType || 't2.micro',
          amiId,
          publicIp,
          privateIp: instance.PrivateIpAddress,
          state: 'running',
          keyName: args.keyName,
          region,
          message: `Instance ${instanceId} launched successfully${publicIp ? `. SSH: ssh -i key.pem ubuntu@${publicIp}` : ''}`
        };
      } catch (error) {
        logger.error('EC2 launch failed:', error);
        throw new Error(`EC2 launch failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_describe_instances',
    description: 'Get information about EC2 instances',
    inputSchema: {
      type: 'object',
      properties: {
        instanceIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific instance IDs to describe'
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
          description: 'Filters to apply (e.g., [{"Name": "tag:Name", "Values": ["myapp-*"]}])'
        },
        includeTerminated: {
          type: 'boolean',
          description: 'Include terminated instances',
          default: false
        }
      }
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        const params = {};
        if (args.instanceIds?.length > 0) {
          params.InstanceIds = args.instanceIds;
        }

        const filters = args.filters || [];
        if (!args.includeTerminated) {
          filters.push({
            Name: 'instance-state-name',
            Values: ['pending', 'running', 'stopping', 'stopped']
          });
        }
        if (filters.length > 0) {
          params.Filters = filters;
        }

        const result = await client.send(new DescribeInstancesCommand(params));

        const instances = [];
        for (const reservation of result.Reservations || []) {
          for (const instance of reservation.Instances || []) {
            instances.push({
              instanceId: instance.InstanceId,
              name: instance.Tags?.find(t => t.Key === 'Name')?.Value,
              state: instance.State?.Name,
              instanceType: instance.InstanceType,
              publicIp: instance.PublicIpAddress,
              privateIp: instance.PrivateIpAddress,
              keyName: instance.KeyName,
              launchTime: instance.LaunchTime,
              availabilityZone: instance.Placement?.AvailabilityZone,
              securityGroups: instance.SecurityGroups?.map(sg => sg.GroupId),
              tags: Object.fromEntries(
                (instance.Tags || []).map(t => [t.Key, t.Value])
              )
            });
          }
        }

        return {
          success: true,
          count: instances.length,
          instances
        };
      } catch (error) {
        logger.error('EC2 describe failed:', error);
        throw new Error(`EC2 describe failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_terminate_instance',
    description: 'Terminate an EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance ID to terminate'
        },
        force: {
          type: 'boolean',
          description: 'Skip confirmation checks',
          default: false
        }
      },
      required: ['instanceId']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        // Get instance details first
        const describeResult = await client.send(new DescribeInstancesCommand({
          InstanceIds: [args.instanceId]
        }));

        const instance = describeResult.Reservations?.[0]?.Instances?.[0];
        if (!instance) {
          throw new Error(`Instance ${args.instanceId} not found`);
        }

        const instanceName = instance.Tags?.find(t => t.Key === 'Name')?.Value;

        // Check for termination protection
        if (!args.force && instance.Tags?.find(t => t.Key === 'TerminationProtection')?.Value === 'true') {
          return {
            success: false,
            instanceId: args.instanceId,
            message: 'Instance has termination protection. Use force=true to override.'
          };
        }

        await client.send(new TerminateInstancesCommand({
          InstanceIds: [args.instanceId]
        }));

        logger.info(`EC2 instance terminated: ${args.instanceId}`);

        return {
          success: true,
          instanceId: args.instanceId,
          name: instanceName,
          previousState: instance.State?.Name,
          message: `Instance ${args.instanceId} (${instanceName}) termination initiated`
        };
      } catch (error) {
        logger.error('EC2 terminate failed:', error);
        throw new Error(`EC2 terminate failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_stop_instance',
    description: 'Stop a running EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance ID to stop'
        }
      },
      required: ['instanceId']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        await client.send(new StopInstancesCommand({
          InstanceIds: [args.instanceId]
        }));

        return {
          success: true,
          instanceId: args.instanceId,
          message: `Instance ${args.instanceId} stop initiated`
        };
      } catch (error) {
        logger.error('EC2 stop failed:', error);
        throw new Error(`EC2 stop failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_start_instance',
    description: 'Start a stopped EC2 instance',
    inputSchema: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'Instance ID to start'
        },
        waitUntilRunning: {
          type: 'boolean',
          description: 'Wait for instance to be running',
          default: true
        }
      },
      required: ['instanceId']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        await client.send(new StartInstancesCommand({
          InstanceIds: [args.instanceId]
        }));

        if (args.waitUntilRunning !== false) {
          await WaitUntilInstanceRunning(
            { client, maxWaitTime: 300 },
            { InstanceIds: [args.instanceId] }
          );
        }

        // Get public IP
        const describeResult = await client.send(new DescribeInstancesCommand({
          InstanceIds: [args.instanceId]
        }));
        const publicIp = describeResult.Reservations?.[0]?.Instances?.[0]?.PublicIpAddress;

        return {
          success: true,
          instanceId: args.instanceId,
          publicIp,
          message: `Instance ${args.instanceId} started${publicIp ? `. IP: ${publicIp}` : ''}`
        };
      } catch (error) {
        logger.error('EC2 start failed:', error);
        throw new Error(`EC2 start failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_create_security_group',
    description: 'Create a security group with specified ingress rules',
    inputSchema: {
      type: 'object',
      properties: {
        groupName: {
          type: 'string',
          description: 'Name for the security group'
        },
        description: {
          type: 'string',
          description: 'Description of the security group'
        },
        vpcId: {
          type: 'string',
          description: 'VPC ID (uses default VPC if not specified)'
        },
        ingressRules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              protocol: { type: 'string', description: 'Protocol (tcp, udp, icmp, -1 for all)' },
              port: { type: 'number', description: 'Port number (or -1 for all)' },
              cidr: { type: 'string', description: 'CIDR block (e.g., 0.0.0.0/0)' },
              description: { type: 'string' }
            }
          },
          description: 'Ingress rules to add'
        }
      },
      required: ['groupName', 'description']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        // Create the security group
        const createParams = {
          GroupName: args.groupName,
          Description: args.description
        };

        if (args.vpcId) {
          createParams.VpcId = args.vpcId;
        }

        const createResult = await client.send(new CreateSecurityGroupCommand(createParams));
        const groupId = createResult.GroupId;

        logger.info(`Security group created: ${groupId}`);

        // Add ingress rules if specified
        if (args.ingressRules?.length > 0) {
          const ipPermissions = args.ingressRules.map(rule => ({
            IpProtocol: rule.protocol || 'tcp',
            FromPort: rule.port === -1 ? undefined : (rule.port || 22),
            ToPort: rule.port === -1 ? undefined : (rule.port || 22),
            IpRanges: [{
              CidrIp: rule.cidr || '0.0.0.0/0',
              Description: rule.description
            }]
          }));

          await client.send(new AuthorizeSecurityGroupIngressCommand({
            GroupId: groupId,
            IpPermissions: ipPermissions
          }));

          logger.info(`Added ${args.ingressRules.length} ingress rules to ${groupId}`);
        }

        return {
          success: true,
          groupId,
          groupName: args.groupName,
          rulesAdded: args.ingressRules?.length || 0,
          message: `Security group ${groupId} created with ${args.ingressRules?.length || 0} rules`
        };
      } catch (error) {
        logger.error('Security group creation failed:', error);
        throw new Error(`Security group creation failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_create_key_pair',
    description: 'Create an EC2 key pair for SSH access. Returns the private key (save it immediately!).',
    inputSchema: {
      type: 'object',
      properties: {
        keyName: {
          type: 'string',
          description: 'Name for the key pair'
        },
        savePath: {
          type: 'string',
          description: 'Local path to save the private key (optional)'
        }
      },
      required: ['keyName']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        const result = await client.send(new CreateKeyPairCommand({
          KeyName: args.keyName
        }));

        const privateKey = result.KeyMaterial;
        const keyFingerprint = result.KeyFingerprint;

        // Save to file if path provided
        if (args.savePath) {
          const fs = require('fs').promises;
          const path = require('path');
          const keyPath = path.resolve(args.savePath);
          await fs.writeFile(keyPath, privateKey, { mode: 0o400 });
          logger.info(`Key pair saved to ${keyPath}`);
        }

        return {
          success: true,
          keyName: args.keyName,
          keyFingerprint,
          privateKey: args.savePath ? `Saved to ${args.savePath}` : privateKey,
          savedTo: args.savePath || null,
          message: `Key pair ${args.keyName} created. ${args.savePath ? `Saved to ${args.savePath}` : 'SAVE THE PRIVATE KEY NOW - it cannot be retrieved later!'}`
        };
      } catch (error) {
        if (error.name === 'InvalidKeyPair.Duplicate') {
          return {
            success: false,
            error: 'Key pair already exists',
            keyName: args.keyName,
            message: `Key pair ${args.keyName} already exists. Use a different name or delete the existing one.`
          };
        }
        logger.error('Key pair creation failed:', error);
        throw new Error(`Key pair creation failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_list_key_pairs',
    description: 'List all EC2 key pairs in the account',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: async () => {
      try {
        const client = await getEC2Client();

        const result = await client.send(new DescribeKeyPairsCommand({}));

        const keyPairs = (result.KeyPairs || []).map(kp => ({
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
      } catch (error) {
        logger.error('List key pairs failed:', error);
        throw new Error(`List key pairs failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_find_latest_ami',
    description: 'Find the latest AMI for a given OS',
    inputSchema: {
      type: 'object',
      properties: {
        os: {
          type: 'string',
          enum: ['ubuntu', 'amazon-linux', 'debian'],
          description: 'Operating system',
          default: 'ubuntu'
        },
        architecture: {
          type: 'string',
          enum: ['x86_64', 'arm64'],
          description: 'Architecture',
          default: 'x86_64'
        }
      }
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();

        const os = args.os || 'ubuntu';
        const arch = args.architecture || 'x86_64';

        let filters = [];
        let owners = [];

        switch (os) {
          case 'ubuntu':
            filters = [
              { Name: 'name', Values: ['ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-*'] },
              { Name: 'architecture', Values: [arch] },
              { Name: 'state', Values: ['available'] }
            ];
            owners = ['099720109477']; // Canonical
            break;
          case 'amazon-linux':
            filters = [
              { Name: 'name', Values: ['amzn2-ami-hvm-*'] },
              { Name: 'architecture', Values: [arch] },
              { Name: 'state', Values: ['available'] }
            ];
            owners = ['amazon'];
            break;
          case 'debian':
            filters = [
              { Name: 'name', Values: ['debian-12-*'] },
              { Name: 'architecture', Values: [arch] },
              { Name: 'state', Values: ['available'] }
            ];
            owners = ['136693071363']; // Debian
            break;
        }

        const result = await client.send(new DescribeImagesCommand({
          Filters: filters,
          Owners: owners
        }));

        // Sort by creation date and get the latest
        const images = (result.Images || [])
          .sort((a, b) => new Date(b.CreationDate) - new Date(a.CreationDate));

        if (images.length === 0) {
          return {
            success: false,
            message: `No AMI found for ${os} ${arch}`
          };
        }

        const latest = images[0];

        return {
          success: true,
          amiId: latest.ImageId,
          name: latest.Name,
          description: latest.Description,
          architecture: latest.Architecture,
          creationDate: latest.CreationDate,
          os,
          totalFound: images.length
        };
      } catch (error) {
        logger.error('Find AMI failed:', error);
        throw new Error(`Find AMI failed: ${error.message}`);
      }
    }
  },

  {
    name: 'ec2_provision_deployment_instance',
    description: 'High-level tool to provision a complete EC2 instance ready for deployment. Creates security group, launches instance, and waits for SSH access.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the deployment'
        },
        instanceType: {
          type: 'string',
          description: 'Instance type',
          default: 't3.small'
        },
        keyName: {
          type: 'string',
          description: 'Existing key pair name (or createNewKey to auto-create)'
        },
        openPorts: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ports to open in security group',
          default: [22, 80, 443]
        },
        installDocker: {
          type: 'boolean',
          description: 'Install Docker via user data script',
          default: true
        },
        installNginx: {
          type: 'boolean',
          description: 'Install Nginx via user data script',
          default: false
        }
      },
      required: ['name', 'keyName']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();
        const region = process.env.AWS_REGION || 'us-east-1';

        logger.info(`Provisioning deployment instance: ${args.name}`);

        // Create security group
        const sgName = `${args.name}-sg-${Date.now()}`;
        const ingressRules = (args.openPorts || [22, 80, 443]).map(port => ({
          protocol: 'tcp',
          port,
          cidr: '0.0.0.0/0',
          description: `Allow ${port}`
        }));

        let sgResult;
        try {
          const createSgResult = await client.send(new CreateSecurityGroupCommand({
            GroupName: sgName,
            Description: `Security group for ${args.name}`
          }));

          const sgId = createSgResult.GroupId;

          // Add ingress rules
          await client.send(new AuthorizeSecurityGroupIngressCommand({
            GroupId: sgId,
            IpPermissions: ingressRules.map(rule => ({
              IpProtocol: rule.protocol,
              FromPort: rule.port,
              ToPort: rule.port,
              IpRanges: [{ CidrIp: rule.cidr }]
            }))
          }));

          sgResult = { success: true, groupId: sgId };
        } catch (sgError) {
          logger.warn('Security group creation error:', sgError);
          sgResult = { success: false, error: sgError.message };
        }

        // Build user data script
        let userDataScript = '#!/bin/bash\nset -e\n';
        
        if (args.installDocker) {
          userDataScript += `
# Install Docker
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
usermod -aG docker ubuntu
`;
        }

        if (args.installNginx) {
          userDataScript += `
# Install Nginx
apt-get install -y nginx
systemctl enable nginx
systemctl start nginx
`;
        }

        userDataScript += '\necho "Deployment instance setup complete" > /tmp/setup-complete\n';

        // Launch instance
        const amiId = UBUNTU_AMIS[region] || UBUNTU_AMIS['us-east-1'];
        
        const runParams = {
          ImageId: amiId,
          InstanceType: args.instanceType || 't3.small',
          KeyName: args.keyName,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(userDataScript).toString('base64'),
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: args.name },
              { Key: 'ManagedBy', Value: 'deployment-agent' },
              { Key: 'CreatedAt', Value: new Date().toISOString() }
            ]
          }]
        };

        if (sgResult?.success && sgResult.groupId) {
          runParams.SecurityGroupIds = [sgResult.groupId];
        }

        const runResult = await client.send(new RunInstancesCommand(runParams));
        const instanceId = runResult.Instances[0].InstanceId;

        // Wait for running state
        await WaitUntilInstanceRunning(
          { client, maxWaitTime: 300 },
          { InstanceIds: [instanceId] }
        );

        // Get instance details
        const describeResult = await client.send(new DescribeInstancesCommand({
          InstanceIds: [instanceId]
        }));
        const instance = describeResult.Reservations[0]?.Instances[0];

        return {
          success: true,
          instanceId,
          name: args.name,
          publicIp: instance.PublicIpAddress,
          privateIp: instance.PrivateIpAddress,
          instanceType: args.instanceType || 't3.small',
          keyName: args.keyName,
          securityGroupId: sgResult?.groupId,
          region,
          dockerInstalling: args.installDocker,
          nginxInstalling: args.installNginx,
          sshCommand: `ssh -i ${args.keyName}.pem ubuntu@${instance.PublicIpAddress}`,
          message: `Instance ${instanceId} provisioned. Wait ~2 minutes for user data scripts to complete.`,
          estimatedReadyTime: '2-3 minutes'
        };
      } catch (error) {
        logger.error('Provision deployment instance failed:', error);
        throw new Error(`Provision failed: ${error.message}`);
      }
    }
  }
];

{
    name: 'ec2_provision_with_credentials',
    description: 'Provision EC2 instance with environment credentials from stored credentials. Injects .env variables into the instance via user data script for deployment.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the deployment'
        },
        instanceType: {
          type: 'string',
          description: 'Instance type',
          default: 't3.small'
        },
        keyName: {
          type: 'string',
          description: 'Existing key pair name'
        },
        openPorts: {
          type: 'array',
          items: { type: 'number' },
          description: 'Ports to open in security group',
          default: [22, 80, 443]
        },
        installDocker: {
          type: 'boolean',
          description: 'Install Docker via user data script',
          default: true
        },
        envCredentialId: {
          type: 'string',
          description: 'ID of stored credential containing .env variables to inject'
        },
        envVariables: {
          type: 'object',
          description: 'Direct environment variables to inject (key-value pairs)'
        },
        envFilePath: {
          type: 'string',
          description: 'Path where to write the .env file on the instance',
          default: '/opt/app/.env'
        },
        dockerComposeContent: {
          type: 'string',
          description: 'Optional docker-compose.yml content to deploy'
        },
        repositoryUrl: {
          type: 'string',
          description: 'Optional Git repository URL to clone and deploy'
        }
      },
      required: ['name', 'keyName']
    },
    handler: async (args) => {
      try {
        const client = await getEC2Client();
        const region = process.env.AWS_REGION || 'us-east-1';
        
        logger.info(`Provisioning EC2 instance with credentials: ${args.name}`);
        
        // Fetch credentials if ID provided
        let envVars = args.envVariables || {};
        
        if (args.envCredentialId) {
          try {
            const DeploymentCredential = require('../../models/DeploymentCredential');
            const credential = await DeploymentCredential.findById(args.envCredentialId);
            
            if (credential && credential.type === 'env-file') {
              const decryptedData = credential.getDecryptedData();
              // Parse the .env content
              const lines = decryptedData.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                
                const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
                if (match) {
                  let value = match[2].trim();
                  if ((value.startsWith('"') && value.endsWith('"')) ||
                      (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                  }
                  envVars[match[1]] = value;
                }
              }
              logger.info(`Loaded ${Object.keys(envVars).length} env vars from credential`);
            }
          } catch (credError) {
            logger.error('Failed to load credential:', credError);
          }
        }
        
        // Create security group
        const sgName = `${args.name}-sg-${Date.now()}`;
        const ingressRules = (args.openPorts || [22, 80, 443]).map(port => ({
          protocol: 'tcp',
          port,
          cidr: '0.0.0.0/0',
          description: `Allow ${port}`
        }));
        
        let sgResult;
        try {
          const createSgResult = await client.send(new CreateSecurityGroupCommand({
            GroupName: sgName,
            Description: `Security group for ${args.name}`
          }));
          
          const sgId = createSgResult.GroupId;
          
          await client.send(new AuthorizeSecurityGroupIngressCommand({
            GroupId: sgId,
            IpPermissions: ingressRules.map(rule => ({
              IpProtocol: rule.protocol,
              FromPort: rule.port,
              ToPort: rule.port,
              IpRanges: [{ CidrIp: rule.cidr }]
            }))
          }));
          
          sgResult = { success: true, groupId: sgId };
        } catch (sgError) {
          logger.warn('Security group creation error:', sgError);
          sgResult = { success: false, error: sgError.message };
        }
        
        // Build user data script with credential injection
        const envFilePath = args.envFilePath || '/opt/app/.env';
        const appDir = envFilePath.substring(0, envFilePath.lastIndexOf('/'));
        
        let userDataScript = `#!/bin/bash
set -e

# Log all output
exec > >(tee /var/log/user-data.log|logger -t user-data -s 2>/dev/console) 2>&1
echo "Starting user data script at $(date)"

# Create application directory
mkdir -p ${appDir}
chmod 755 ${appDir}

`;
        
        // Install Docker if requested
        if (args.installDocker !== false) {
          userDataScript += `
# Install Docker
apt-get update
apt-get install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
usermod -aG docker ubuntu
echo "Docker installed successfully"

`;
        }
        
        // Inject environment variables
        if (Object.keys(envVars).length > 0) {
          userDataScript += `
# Create .env file with credentials
cat > ${envFilePath} << 'ENVEOF'
`;
          for (const [key, value] of Object.entries(envVars)) {
            // Escape special characters for bash heredoc
            const safeValue = String(value).replace(/'/g, "'\\''");
            userDataScript += `${key}='${safeValue}'\n`;
          }
          userDataScript += `ENVEOF

chmod 600 ${envFilePath}
chown ubuntu:ubuntu ${envFilePath}
echo "Environment file created at ${envFilePath} with ${Object.keys(envVars).length} variables"

`;
        }
        
        // Add docker-compose if provided
        if (args.dockerComposeContent) {
          userDataScript += `
# Create docker-compose.yml
cat > ${appDir}/docker-compose.yml << 'COMPOSEEOF'
${args.dockerComposeContent}
COMPOSEEOF

chmod 644 ${appDir}/docker-compose.yml
echo "docker-compose.yml created"

`;
        }
        
        // Clone repository if provided
        if (args.repositoryUrl) {
          userDataScript += `
# Install git and clone repository
apt-get install -y git
cd ${appDir}
git clone ${args.repositoryUrl} .
chown -R ubuntu:ubuntu ${appDir}
echo "Repository cloned: ${args.repositoryUrl}"

`;
        }
        
        // Start docker-compose if available
        if (args.dockerComposeContent || args.repositoryUrl) {
          userDataScript += `
# Start docker-compose if docker-compose.yml exists
if [ -f "${appDir}/docker-compose.yml" ]; then
  cd ${appDir}
  docker compose --env-file ${envFilePath} up -d || echo "docker-compose failed, check logs"
  echo "Docker Compose started"
fi

`;
        }
        
        userDataScript += `
echo "User data script completed at $(date)"
echo "DEPLOYMENT_READY" > /tmp/deployment-status
`;
        
        // Launch instance
        const amiId = UBUNTU_AMIS[region] || UBUNTU_AMIS['us-east-1'];
        
        const runParams = {
          ImageId: amiId,
          InstanceType: args.instanceType || 't3.small',
          KeyName: args.keyName,
          MinCount: 1,
          MaxCount: 1,
          UserData: Buffer.from(userDataScript).toString('base64'),
          TagSpecifications: [{
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: args.name },
              { Key: 'ManagedBy', Value: 'deployment-agent' },
              { Key: 'CreatedAt', Value: new Date().toISOString() },
              { Key: 'EnvCredentialId', Value: args.envCredentialId || 'none' },
              { Key: 'HasCredentials', Value: Object.keys(envVars).length > 0 ? 'true' : 'false' }
            ]
          }]
        };
        
        if (sgResult?.success && sgResult.groupId) {
          runParams.SecurityGroupIds = [sgResult.groupId];
        }
        
        const runResult = await client.send(new RunInstancesCommand(runParams));
        const instanceId = runResult.Instances[0].InstanceId;
        
        // Wait for running state
        await WaitUntilInstanceRunning(
          { client, maxWaitTime: 300 },
          { InstanceIds: [instanceId] }
        );
        
        // Get instance details
        const describeResult = await client.send(new DescribeInstancesCommand({
          InstanceIds: [instanceId]
        }));
        const instance = describeResult.Reservations[0]?.Instances[0];
        
        return {
          success: true,
          instanceId,
          name: args.name,
          publicIp: instance.PublicIpAddress,
          privateIp: instance.PrivateIpAddress,
          instanceType: args.instanceType || 't3.small',
          keyName: args.keyName,
          securityGroupId: sgResult?.groupId,
          region,
          credentialsInjected: Object.keys(envVars).length,
          envFilePath,
          dockerInstalled: args.installDocker !== false,
          repositoryCloned: !!args.repositoryUrl,
          sshCommand: `ssh -i ${args.keyName}.pem ubuntu@${instance.PublicIpAddress}`,
          checkStatusCommand: `ssh -i ${args.keyName}.pem ubuntu@${instance.PublicIpAddress} "cat /tmp/deployment-status"`,
          checkLogsCommand: `ssh -i ${args.keyName}.pem ubuntu@${instance.PublicIpAddress} "cat /var/log/user-data.log"`,
          message: `Instance ${instanceId} provisioned with ${Object.keys(envVars).length} environment variables. Wait ~3-5 minutes for setup to complete.`,
          estimatedReadyTime: '3-5 minutes'
        };
      } catch (error) {
        logger.error('Provision with credentials failed:', error);
        throw new Error(`Provision failed: ${error.message}`);
      }
    }
  }
];

/**
 * Get all EC2 tools
 */
const getTools = () => tools;

module.exports = {
  getTools
};

