const chalk = require('chalk');
const ora = require('ora');
const awsClient = require('../lib/aws');
const sshClient = require('../lib/ssh');
const logger = require('../lib/logger');
const readline = require('readline');

module.exports = {
  /**
   * Connect to EC2 instance via SSH
   */
  async connect(instanceId, options) {
    const spinner = ora(`Connecting to ${instanceId}...`).start();

    try {
      // Get instance details
      const instance = await awsClient.describeInstance(instanceId, options.region);
      
      if (instance.State.Name !== 'running') {
        spinner.fail(`Instance is not running (current state: ${instance.State.Name})`);
        process.exit(1);
      }

      const host = instance.PublicIpAddress || instance.PrivateIpAddress;
      if (!host || host === 'N/A') {
        spinner.fail('Instance does not have a valid IP address');
        process.exit(1);
      }

      spinner.text = `Connecting to ${host}...`;

      // Determine SSH key
      let keyPath = options.key;
      if (!keyPath && instance.KeyName) {
        // Try common key locations
        const commonPaths = [
          `${process.env.HOME}/.ssh/${instance.KeyName}.pem`,
          `${process.env.HOME}/.ssh/${instance.KeyName}`,
          `${process.env.HOME}/.ssh/id_rsa`
        ];
        
        const fs = require('fs');
        for (const path of commonPaths) {
          if (fs.existsSync(path)) {
            keyPath = path;
            break;
          }
        }
      }

      if (!keyPath) {
        spinner.fail('SSH key not found. Please specify with --key option');
        process.exit(1);
      }

      // Connect via SSH
      const conn = await sshClient.connect({
        host,
        username: options.user,
        privateKey: keyPath,
        port: 22
      });

      spinner.succeed(`Connected to ${instanceId} (${host})`);

      // Execute command or start interactive shell
      if (options.command) {
        const result = await sshClient.exec(conn, options.command);
        console.log(result.stdout);
        if (result.stderr) {
          console.error(chalk.red(result.stderr));
        }
        conn.end();
        process.exit(result.code || 0);
      } else {
        console.log(chalk.green('\nConnected! Type "exit" to disconnect.\n'));
        await sshClient.shell(conn);
        conn.end();
      }
    } catch (error) {
      spinner.fail('Failed to connect');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Connect to generic host via SSH
   */
  async connectGeneric(host, options) {
    const spinner = ora(`Connecting to ${host}...`).start();

    try {
      const conn = await sshClient.connect({
        host,
        username: options.user || process.env.USER,
        privateKey: options.key,
        password: process.env.SSH_PASSWORD,
        port: parseInt(options.port) || 22
      });

      spinner.succeed(`Connected to ${host}`);

      if (options.command) {
        const result = await sshClient.exec(conn, options.command);
        console.log(result.stdout);
        if (result.stderr) {
          console.error(chalk.red(result.stderr));
        }
        conn.end();
        process.exit(result.code || 0);
      } else {
        console.log(chalk.green('\nConnected! Type "exit" to disconnect.\n'));
        await sshClient.shell(conn);
        conn.end();
      }
    } catch (error) {
      spinner.fail('Failed to connect');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Execute command on remote host
   */
  async exec(host, command, options) {
    const spinner = ora(`Executing command on ${host}...`).start();

    try {
      const conn = await sshClient.connect({
        host,
        username: options.user || process.env.USER,
        privateKey: options.key,
        password: process.env.SSH_PASSWORD,
        port: parseInt(options.port) || 22
      });

      spinner.stop();
      const result = await sshClient.exec(conn, command);
      
      console.log(result.stdout);
      if (result.stderr) {
        console.error(chalk.red(result.stderr));
      }

      conn.end();
      process.exit(result.code || 0);
    } catch (error) {
      spinner.fail('Failed to execute command');
      logger.error(error.message);
      process.exit(1);
    }
  }
};





