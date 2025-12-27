const inquirer = require('inquirer');
const chalk = require('chalk');
const api = require('../lib/api');
const logger = require('../lib/logger');

module.exports = {
  /**
   * Manage configuration
   */
  async manage(options) {
    try {
      if (options.set) {
        const [key, value] = options.set.split('=');
        if (!key || !value) {
          logger.error('Invalid format. Use: config --set key=value');
          process.exit(1);
        }

        const config = await api.loadConfig();
        config[key] = value;
        await api.saveConfig(config);
        logger.success(`Configuration ${key} set to ${value}`);
      } else if (options.get) {
        const config = await api.loadConfig();
        const value = config[options.get];
        if (value !== undefined) {
          console.log(value);
        } else {
          logger.warn(`Configuration ${options.get} not found`);
        }
      } else if (options.list) {
        const config = await api.loadConfig();
        console.log(chalk.bold('\nConfiguration:'));
        Object.entries(config).forEach(([key, value]) => {
          if (key === 'token') {
            console.log(`  ${key}: ${value ? value.substring(0, 20) + '...' : 'Not set'}`);
          } else {
            console.log(`  ${key}: ${value || 'Not set'}`);
          }
        });
      } else {
        logger.warn('Please specify an action: --set, --get, or --list');
      }
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Initialize configuration
   */
  async init() {
    try {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiUrl',
          message: 'API URL:',
          default: 'http://localhost:5000',
          validate: (input) => input.length > 0 || 'API URL is required'
        }
      ]);

      await api.saveConfig({
        apiUrl: answers.apiUrl
      });

      logger.success('Configuration initialized!');
      logger.info('Run "deploy-agent login" to authenticate.');
    } catch (error) {
      logger.error(error.message);
      process.exit(1);
    }
  }
};





