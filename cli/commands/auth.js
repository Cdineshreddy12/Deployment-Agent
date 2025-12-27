const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const api = require('../lib/api');
const logger = require('../lib/logger');

module.exports = {
  /**
   * Login command
   */
  async login(options) {
    const spinner = ora('Logging in...').start();

    try {
      let email = options.email;
      let password = options.password;

      // Prompt for credentials if not provided
      if (!email || !password) {
        spinner.stop();
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message: 'Email:',
            validate: (input) => input.length > 0 || 'Email is required'
          },
          {
            type: 'password',
            name: 'password',
            message: 'Password:',
            validate: (input) => input.length > 0 || 'Password is required'
          }
        ]);
        email = answers.email;
        password = answers.password;
        spinner.start();
      }

      const response = await api.post('/api/v1/auth/login', {
        email,
        password
      });

      if (response.success && response.data.token) {
        // Save token to config
        await api.saveConfig({
          token: response.data.token,
          apiUrl: api.baseURL,
          user: response.data.user
        });

        spinner.succeed('Login successful!');
        logger.success(`Welcome, ${response.data.user.name || response.data.user.email}`);
      } else {
        throw new Error('Login failed');
      }
    } catch (error) {
      spinner.fail('Login failed');
      logger.error(error.message || 'Invalid credentials');
      process.exit(1);
    }
  },

  /**
   * Logout command
   */
  async logout() {
    try {
      await api.post('/api/v1/auth/logout');
      await api.saveConfig({});
      logger.success('Logged out successfully');
    } catch (error) {
      logger.error('Logout failed:', error.message);
    }
  },

  /**
   * Whoami command
   */
  async whoami() {
    const spinner = ora('Fetching user information...').start();

    try {
      const response = await api.get('/api/v1/auth/me');

      if (response.success) {
        spinner.stop();
        const user = response.data.user;
        console.log(chalk.bold('\nCurrent User:'));
        console.log(`  Name: ${user.name || 'N/A'}`);
        console.log(`  Email: ${user.email}`);
        console.log(`  Role: ${user.role || 'N/A'}`);
        console.log(`  Department: ${user.department || 'N/A'}`);
        console.log(`  Team: ${user.team || 'N/A'}`);
      }
    } catch (error) {
      spinner.fail('Failed to fetch user information');
      logger.error(error.message || 'Not authenticated');
      process.exit(1);
    }
  },

  /**
   * API key management
   */
  async apiKey(options) {
    try {
      if (options.create) {
        const spinner = ora('Creating API key...').start();
        const nameAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'API key name:',
            default: 'CLI Access'
          }
        ]);
        spinner.start();

        const response = await api.post('/api/v1/auth/api-keys', {
          name: nameAnswer.name
        });

        if (response.success) {
          spinner.stop();
          console.log(chalk.bold('\nAPI Key Created:'));
          console.log(chalk.green(response.data.apiKey));
          console.log(chalk.yellow('\n⚠️  Save this key securely. It will not be shown again.'));
          console.log(`\nTo use this key, set it as an environment variable:`);
          console.log(chalk.cyan(`export DEPLOYMENT_AGENT_API_KEY="${response.data.apiKey}"`));
        }
      } else if (options.list) {
        const spinner = ora('Fetching API keys...').start();
        const response = await api.get('/api/v1/auth/api-keys');

        if (response.success) {
          spinner.stop();
          const keys = response.data.apiKeys;
          if (keys.length === 0) {
            console.log('No API keys found.');
          } else {
            console.log(chalk.bold('\nAPI Keys:'));
            keys.forEach(key => {
              console.log(`\n  Key ID: ${key.keyId}`);
              console.log(`  Name: ${key.name}`);
              console.log(`  Created: ${new Date(key.createdAt).toLocaleString()}`);
              console.log(`  Last Used: ${key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'Never'}`);
              console.log(`  Expires: ${key.expiresAt ? new Date(key.expiresAt).toLocaleString() : 'Never'}`);
            });
          }
        }
      } else if (options.delete) {
        const spinner = ora('Deleting API key...').start();
        const response = await api.delete(`/api/v1/auth/api-keys/${options.delete}`);

        if (response.success) {
          spinner.succeed('API key deleted successfully');
        }
      } else {
        logger.warn('Please specify an action: --create, --list, or --delete <keyId>');
      }
    } catch (error) {
      logger.error(error.message || 'Operation failed');
      process.exit(1);
    }
  }
};





