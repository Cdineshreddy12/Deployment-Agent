const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const { table } = require('table');
const api = require('../lib/api');
const logger = require('../lib/logger');

module.exports = {
  /**
   * List deployments
   */
  async list(options) {
    const spinner = ora('Fetching deployments...').start();

    try {
      const params = {
        page: options.page,
        limit: options.limit
      };

      if (options.environment) params.environment = options.environment;
      if (options.status) params.status = options.status;

      const response = await api.get('/api/v1/deployments', params);

      if (response.success) {
        spinner.stop();
        const deployments = response.data.deployments;
        const pagination = response.data.pagination;

        if (deployments.length === 0) {
          console.log('No deployments found.');
          return;
        }

        // Create table
        const tableData = [
          ['ID', 'Name', 'Environment', 'Status', 'Region', 'Created']
        ];

        deployments.forEach(dep => {
          tableData.push([
            dep.deploymentId.substring(0, 8),
            dep.name || 'N/A',
            dep.environment || 'N/A',
            dep.status || 'N/A',
            dep.region || 'N/A',
            new Date(dep.createdAt).toLocaleDateString()
          ]);
        });

        console.log(table(tableData));
        console.log(`\nPage ${pagination.page} of ${pagination.pages} (${pagination.total} total)`);
      }
    } catch (error) {
      spinner.fail('Failed to fetch deployments');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Get deployment details
   */
  async get(id) {
    const spinner = ora('Fetching deployment details...').start();

    try {
      const response = await api.get(`/api/v1/deployments/${id}`);

      if (response.success) {
        spinner.stop();
        const dep = response.data.deployment;

        console.log(chalk.bold('\nDeployment Details:'));
        console.log(`  ID: ${dep.deploymentId}`);
        console.log(`  Name: ${dep.name || 'N/A'}`);
        console.log(`  Description: ${dep.description || 'N/A'}`);
        console.log(`  Environment: ${dep.environment || 'N/A'}`);
        console.log(`  Status: ${dep.status || 'N/A'}`);
        console.log(`  Region: ${dep.region || 'N/A'}`);
        console.log(`  Repository: ${dep.repositoryUrl || 'N/A'}`);
        console.log(`  Branch: ${dep.repositoryBranch || 'N/A'}`);
        console.log(`  Created: ${new Date(dep.createdAt).toLocaleString()}`);
        console.log(`  Updated: ${new Date(dep.updatedAt).toLocaleString()}`);

        if (dep.userId && dep.userId.name) {
          console.log(`  Created by: ${dep.userId.name} (${dep.userId.email})`);
        }

        if (dep.tags && Object.keys(dep.tags).length > 0) {
          console.log('\n  Tags:');
          Object.entries(dep.tags).forEach(([key, value]) => {
            console.log(`    ${key}: ${value}`);
          });
        }
      }
    } catch (error) {
      spinner.fail('Failed to fetch deployment');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Create deployment
   */
  async create(options) {
    const spinner = ora('Creating deployment...').start();

    try {
      let name = options.name;
      let description = options.description;
      let environment = options.environment;
      let region = options.region;
      let repositoryUrl = options.url;
      let branch = options.branch;

      // Prompt for missing information
      if (!name || !environment || !repositoryUrl) {
        spinner.stop();
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Deployment name:',
            default: name,
            validate: (input) => input.length > 0 || 'Name is required'
          },
          {
            type: 'input',
            name: 'description',
            message: 'Description:',
            default: description
          },
          {
            type: 'list',
            name: 'environment',
            message: 'Environment:',
            choices: ['dev', 'staging', 'prod'],
            default: environment || 'dev'
          },
          {
            type: 'input',
            name: 'region',
            message: 'AWS Region:',
            default: region || 'us-east-1'
          },
          {
            type: 'input',
            name: 'repositoryUrl',
            message: 'Repository URL:',
            default: repositoryUrl,
            validate: (input) => input.length > 0 || 'Repository URL is required'
          },
          {
            type: 'input',
            name: 'branch',
            message: 'Branch:',
            default: branch || 'main'
          }
        ]);

        name = answers.name;
        description = answers.description;
        environment = answers.environment;
        region = answers.region;
        repositoryUrl = answers.repositoryUrl;
        branch = answers.branch;
        spinner.start();
      }

      const response = await api.post('/api/v1/deployments', {
        name,
        description,
        environment,
        region,
        repositoryUrl,
        repositoryBranch: branch
      });

      if (response.success) {
        spinner.succeed('Deployment created successfully!');
        const dep = response.data.deployment;
        console.log(`\nDeployment ID: ${chalk.bold(dep.deploymentId)}`);
        console.log(`Status: ${dep.status}`);
      }
    } catch (error) {
      spinner.fail('Failed to create deployment');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Approve deployment
   */
  async approve(id, options) {
    const spinner = ora('Approving deployment...').start();

    try {
      let comment = options.comment;
      if (!comment) {
        spinner.stop();
        const answer = await inquirer.prompt([
          {
            type: 'input',
            name: 'comment',
            message: 'Approval comment:',
            default: 'Approved via CLI'
          }
        ]);
        comment = answer.comment;
        spinner.start();
      }

      const response = await api.post(`/api/v1/deployments/${id}/approve`, {
        comment
      });

      if (response.success) {
        spinner.succeed('Deployment approved');
      }
    } catch (error) {
      spinner.fail('Failed to approve deployment');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Cancel deployment
   */
  async cancel(id) {
    const spinner = ora('Cancelling deployment...').start();

    try {
      const response = await api.post(`/api/v1/deployments/${id}/cancel`);

      if (response.success) {
        spinner.succeed('Deployment cancelled');
      }
    } catch (error) {
      spinner.fail('Failed to cancel deployment');
      logger.error(error.message);
      process.exit(1);
    }
  },

  /**
   * Rollback deployment
   */
  async rollback(id, options) {
    const spinner = ora('Rolling back deployment...').start();

    try {
      let version = options.version;
      let reason = options.reason;

      if (!version || !reason) {
        spinner.stop();
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'version',
            message: 'Version to rollback to:',
            validate: (input) => input.length > 0 || 'Version is required'
          },
          {
            type: 'input',
            name: 'reason',
            message: 'Rollback reason:',
            validate: (input) => input.length > 0 || 'Reason is required'
          }
        ]);
        version = answers.version;
        reason = answers.reason;
        spinner.start();
      }

      const response = await api.post(`/api/v1/deployments/${id}/rollback`, {
        version,
        reason
      });

      if (response.success) {
        spinner.succeed('Deployment rolled back');
      }
    } catch (error) {
      spinner.fail('Failed to rollback deployment');
      logger.error(error.message);
      process.exit(1);
    }
  }
};





