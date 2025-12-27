const AWS = require('aws-sdk');
const logger = require('./logger');

class AWSClient {
  constructor() {
    this.clients = new Map();
  }

  /**
   * Get AWS client for a region
   */
  getEC2Client(region = 'us-east-1') {
    const key = `ec2-${region}`;
    if (!this.clients.has(key)) {
      this.clients.set(key, new AWS.EC2({ region }));
    }
    return this.clients.get(key);
  }

  /**
   * Configure AWS credentials
   */
  configure(credentials) {
    AWS.config.update({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      region: credentials.region || 'us-east-1'
    });
  }

  /**
   * List EC2 instances
   */
  async listInstances(region = 'us-east-1', filters = {}) {
    const ec2 = this.getEC2Client(region);
    const params = {};

    // Add filters
    if (filters.state) {
      params.Filters = [
        {
          Name: 'instance-state-name',
          Values: [filters.state]
        }
      ];
    }

    try {
      const result = await ec2.describeInstances(params).promise();
      const instances = [];

      result.Reservations.forEach(reservation => {
        reservation.Instances.forEach(instance => {
          instances.push({
            InstanceId: instance.InstanceId,
            InstanceType: instance.InstanceType,
            State: instance.State.Name,
            PublicIpAddress: instance.PublicIpAddress || 'N/A',
            PrivateIpAddress: instance.PrivateIpAddress || 'N/A',
            PublicDnsName: instance.PublicDnsName || 'N/A',
            PrivateDnsName: instance.PrivateDnsName || 'N/A',
            LaunchTime: instance.LaunchTime,
            Tags: instance.Tags || [],
            KeyName: instance.KeyName || 'N/A',
            SecurityGroups: instance.SecurityGroups || [],
            VpcId: instance.VpcId || 'N/A',
            SubnetId: instance.SubnetId || 'N/A'
          });
        });
      });

      return instances;
    } catch (error) {
      logger.error('Failed to list EC2 instances:', error);
      throw error;
    }
  }

  /**
   * Get instance details
   */
  async describeInstance(instanceId, region = 'us-east-1') {
    const ec2 = this.getEC2Client(region);
    
    try {
      const result = await ec2.describeInstances({
        InstanceIds: [instanceId]
      }).promise();

      if (result.Reservations.length === 0 || result.Reservations[0].Instances.length === 0) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      return result.Reservations[0].Instances[0];
    } catch (error) {
      logger.error(`Failed to describe instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Start EC2 instance
   */
  async startInstance(instanceId, region = 'us-east-1') {
    const ec2 = this.getEC2Client(region);
    
    try {
      const result = await ec2.startInstances({
        InstanceIds: [instanceId]
      }).promise();

      return result.StartingInstances[0];
    } catch (error) {
      logger.error(`Failed to start instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Stop EC2 instance
   */
  async stopInstance(instanceId, region = 'us-east-1') {
    const ec2 = this.getEC2Client(region);
    
    try {
      const result = await ec2.stopInstances({
        InstanceIds: [instanceId]
      }).promise();

      return result.StoppingInstances[0];
    } catch (error) {
      logger.error(`Failed to stop instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Reboot EC2 instance
   */
  async rebootInstance(instanceId, region = 'us-east-1') {
    const ec2 = this.getEC2Client(region);
    
    try {
      await ec2.rebootInstances({
        InstanceIds: [instanceId]
      }).promise();

      return { success: true };
    } catch (error) {
      logger.error(`Failed to reboot instance ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Get instance public IP
   */
  async getInstancePublicIp(instanceId, region = 'us-east-1') {
    const instance = await this.describeInstance(instanceId, region);
    return instance.PublicIpAddress || instance.PrivateIpAddress;
  }
}

module.exports = new AWSClient();





