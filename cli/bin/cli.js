#!/usr/bin/env node

const { program } = require('commander');
const chalk = require('chalk');
const authCommands = require('../commands/auth');
const deploymentCommands = require('../commands/deployments');
const ec2Commands = require('../commands/ec2');
const sshCommands = require('../commands/ssh');
const configCommands = require('../commands/config');
const projectCommand = require('../commands/project');

// CLI Version
const packageJson = require('../package.json');
program.version(packageJson.version);

// Configure CLI
program
  .name('deploy-agent')
  .description('CLI agent for Deployment Agent platform')
  .usage('<command> [options]');

// Auth commands
program
  .command('login')
  .description('Login to the deployment platform')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(authCommands.login);

program
  .command('logout')
  .description('Logout from the deployment platform')
  .action(authCommands.logout);

program
  .command('whoami')
  .description('Show current user information')
  .action(authCommands.whoami);

program
  .command('api-key')
  .description('Manage API keys')
  .option('-c, --create', 'Create a new API key')
  .option('-l, --list', 'List all API keys')
  .option('-d, --delete <keyId>', 'Delete an API key')
  .action(authCommands.apiKey);

// Deployment commands
program
  .command('deployments')
  .alias('deps')
  .description('List all deployments')
  .option('-e, --environment <env>', 'Filter by environment')
  .option('-s, --status <status>', 'Filter by status')
  .option('-p, --page <page>', 'Page number', '1')
  .option('-l, --limit <limit>', 'Items per page', '20')
  .action(deploymentCommands.list);

program
  .command('deployment <id>')
  .alias('dep')
  .description('Get deployment details')
  .action(deploymentCommands.get);

program
  .command('deploy')
  .description('Create a new deployment')
  .option('-n, --name <name>', 'Deployment name')
  .option('-d, --description <description>', 'Deployment description')
  .option('-e, --environment <env>', 'Environment (dev/staging/prod)')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-u, --url <url>', 'Repository URL')
  .option('-b, --branch <branch>', 'Repository branch', 'main')
  .action(deploymentCommands.create);

program
  .command('approve <id>')
  .description('Approve a deployment')
  .option('-c, --comment <comment>', 'Approval comment')
  .action(deploymentCommands.approve);

program
  .command('cancel <id>')
  .description('Cancel a deployment')
  .action(deploymentCommands.cancel);

program
  .command('rollback <id>')
  .description('Rollback a deployment')
  .option('-v, --version <version>', 'Version to rollback to')
  .option('-r, --reason <reason>', 'Rollback reason')
  .action(deploymentCommands.rollback);

// EC2 commands
program
  .command('ec2:list')
  .description('List EC2 instances')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-s, --state <state>', 'Filter by state (running, stopped, etc.)')
  .action(ec2Commands.list);

program
  .command('ec2:describe <instanceId>')
  .description('Describe an EC2 instance')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .action(ec2Commands.describe);

program
  .command('ec2:start <instanceId>')
  .description('Start an EC2 instance')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .action(ec2Commands.start);

program
  .command('ec2:stop <instanceId>')
  .description('Stop an EC2 instance')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .action(ec2Commands.stop);

program
  .command('ec2:reboot <instanceId>')
  .description('Reboot an EC2 instance')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .action(ec2Commands.reboot);

program
  .command('ec2:ssh <instanceId>')
  .description('SSH into an EC2 instance')
  .option('-u, --user <user>', 'SSH user', 'ec2-user')
  .option('-k, --key <keyPath>', 'Path to SSH private key')
  .option('-r, --region <region>', 'AWS region', 'us-east-1')
  .option('-c, --command <command>', 'Execute a command instead of interactive shell')
  .action(sshCommands.connect);

// SSH/Remote commands
program
  .command('ssh:connect <host>')
  .description('Connect to a remote host via SSH')
  .option('-u, --user <user>', 'SSH user')
  .option('-k, --key <keyPath>', 'Path to SSH private key')
  .option('-p, --port <port>', 'SSH port', '22')
  .option('-c, --command <command>', 'Execute a command instead of interactive shell')
  .action(sshCommands.connectGeneric);

program
  .command('ssh:exec <host> <command>')
  .description('Execute a command on a remote host')
  .option('-u, --user <user>', 'SSH user')
  .option('-k, --key <keyPath>', 'Path to SSH private key')
  .option('-p, --port <port>', 'SSH port', '22')
  .action(sshCommands.exec);

// Config commands
program
  .command('config')
  .description('Manage CLI configuration')
  .option('-s, --set <key=value>', 'Set a configuration value')
  .option('-g, --get <key>', 'Get a configuration value')
  .option('-l, --list', 'List all configuration')
  .action(configCommands.manage);

program
  .command('config:init')
  .description('Initialize CLI configuration')
  .action(configCommands.init);

// Error handling
program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.error(`See '${program.name()} --help' for available commands.`);
  process.exit(1);
});

// Add project command (with subcommands)
program.addCommand(projectCommand);

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}




