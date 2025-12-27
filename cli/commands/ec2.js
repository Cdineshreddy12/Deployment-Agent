const chalk = require('chalk');
const ora = require('ora');
const { table } = require('table');
const awsClient = require('../lib/aws');
const logger = require('../lib/logger');
const api = require('../lib/api');

module.exports = {
  /**
   * List EC2 instances
   */
  async list(options) {
    const spinner = ora('Fetching EC2 instances...').start();

    try {
      // Try to get AWS credentials from backend or use environment variables
      await this.loadAWSCredentials();

      const instances = await awsClient.listInstances(options.region, {
        state: options.state
      });

      spinner.stop();

      if (instances.length === 0) {
        console.log('No EC2 instances found.');
        return;
      }

      // Create table
      const tableData = [
        ['Instance ID', 'Type', 'State', 'Public IP', 'Private IP', 'Launch Time']
      ];

      instances.forEach(instance => {
        tableData.push([
          instance.InstanceId,
          instance.InstanceType,
          instance.State,
          instance.PublicIpAddress,
          instance.PrivateIpAddress,
          new Date(instance.LaunchTime).toLocaleDateString()
        ]);
      });

      console.log(table(tableData));
    } catch (error) {
      spinner.fail('Failed to list EC2 instances');
      logger.error(error.message);
      
      if (error.message.includes('credentials')) {
        logger.warn('Please configure AWS credentials. You can:');
        logger.warn('  1. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables');
        logger.warn('  2. Configure AWS credentials via the backend API');
      }
      
      process.exit(1);
    }
  },

  /**
   * Describe EC2 instance
   */
  async describe(instanceId, options) {
    const spinner = ora(`Fetching details for ${instanceId}...`).start();

    try {
      await this.loadAWSCredentials();

      const instance = await awsClient.describeInstance(instanceId, options.region);

      spinner.stop();

      console.log(chalk.bold('\nInstance Details:'));
      console.log(`  Instance ID: ${instance.InstanceId}`);
      console.log(`  Instance Type: ${instance.InstanceType}`);
      console.log(`  State: ${instance.State.Name}`);
      console.log(`  Public IP: ${instance.PublicIpAddress || 'N/A'}`);
      console.log(`  Private IP: ${instance.PrivateIpAddress || 'N/A'}`);
      console.log(`  Public DNS: ${instance.PublicDnsName || 'N/A'}`);
      console.log(`  Private DNS: ${instance.PrivateDnsName || 'N/A'}`);
      console.log(`  Key Name: ${instance.KeyName || 'N/A'}`);
      console.log(`  Launch Time: ${new Date(instance.LaunchTime).toLocaleString()}`);

      if (instance.Tags && instance.Tags.length > 0) {
        console.log('\n  Tags:');
        instance.Tags.forEach(tag => {
          console.log(`    ${tag.Key}: ${tag.Value}`);
        });
      }

      if (instance.SecurityGroups && instance.SecurityGroups.length > 0) {
        console.log('\n  Security Groups:');
        instance.SecurityGroups.forEach(sg => {
          console.log(`    ${sg.GroupId} (${sg.GroupName})`);
        });
      }
    } catch (error) {
      spinner.fail('Failed to describe instance');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Start EC2 instance
   */
  async start(instanceId, options) {
    const spinner = ora(`Starting instance ${instanceId}...`).start();

    try {
      await this.loadAWSCredentials();

      const result = await awsClient.startInstance(instanceId, options.region);

      spinner.succeed(`Instance ${instanceId} is starting`);
      console.log(`  Current State: ${result.CurrentState.Name}`);
      console.log(`  Previous State: ${result.PreviousState.Name}`);
    } catch (error) {
      spinner.fail('Failed to start instance');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Stop EC2 instance
   */
  async stop(instanceId, options) {
    const spinner = ora(`Stopping instance ${instanceId}...`).start();

    try {
      await this.loadAWSCredentials();

      const result = await awsClient.stopInstance(instanceId, options.region);

      spinner.succeed(`Instance ${instanceId} is stopping`);
      console.log(`  Current State: ${result.CurrentState.Name}`);
      console.log(`  Previous State: ${result.PreviousState.Name}`);
    } catch (error) {
      spinner.fail('Failed to stop instance');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Reboot EC2 instance
   */
  async reboot(instanceId, options) {
    const spinner = ora(`Rebooting instance ${instanceId}...`).start();

    try {
      await this.loadAWSCredentials();

      await awsClient.rebootInstance(instanceId, options.region);

      spinner.succeed(`Instance ${instanceId} is rebooting`);
    } catch (error) {
      spinner.fail('Failed to reboot instance');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Load AWS credentials from backend or environment
   */
  async loadAWSCredentials() {
    // First try environment variables
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      awsClient.configure({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
      return;
    }

    // Try to get credentials from backend API
    try {
      // This would require a backend endpoint to get AWS credentials
      // For now, we'll just use environment variables
      throw new Error('AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    } catch (error) {
      throw error;
    }
  }
};





