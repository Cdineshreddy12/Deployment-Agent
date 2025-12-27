const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const axios = require('axios');
const EventSource = require('eventsource');
const { getConfig, getAuthToken } = require('../lib/config');

/**
 * Project Deployment CLI Commands
 * Interactive deployment workflow for local projects
 */

const createApiClient = () => {
  const config = getConfig();
  const token = getAuthToken();
  
  const client = axios.create({
    baseURL: `${config.apiUrl}/api/v1`,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  
  return client;
};

const projectCommand = new Command('project')
  .description('Deploy local projects with AI-powered analysis');

/**
 * Start interactive deployment flow
 */
projectCommand
  .command('start [path]')
  .description('Start full interactive deployment workflow')
  .option('--skip-local-test', 'Skip local Docker testing')
  .option('--skip-infra', 'Skip infrastructure provisioning')
  .option('--auto-approve', 'Auto-approve all Claude verifications')
  .action(async (projectPath, options) => {
    const api = createApiClient();
    
    // Get project path
    if (!projectPath) {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectPath',
          message: 'Enter project path:',
          default: process.cwd()
        }
      ]);
      projectPath = answers.projectPath;
    }
    
    projectPath = path.resolve(projectPath);
    
    // Verify path exists
    if (!fs.existsSync(projectPath)) {
      console.log(chalk.red(`Project path not found: ${projectPath}`));
      process.exit(1);
    }
    
    console.log(chalk.cyan('\n🚀 Starting Deployment Workflow'));
    console.log(chalk.gray(`Project: ${projectPath}\n`));
    
    // Step 1: Analyze
    const analyzeSpinner = ora('Analyzing project...').start();
    try {
      const analyzeResponse = await api.post('/project/analyze', { path: projectPath });
      
      if (!analyzeResponse.data.success) {
        analyzeSpinner.fail('Analysis failed');
        console.log(chalk.red(analyzeResponse.data.error));
        process.exit(1);
      }
      
      const { deploymentId, data } = analyzeResponse.data;
      analyzeSpinner.succeed('Project analyzed');
      
      console.log(chalk.green('\n✓ Analysis Complete'));
      console.log(chalk.gray('  Project Type:'), data.projectType?.language || 'Unknown');
      console.log(chalk.gray('  Framework:'), data.framework || 'None detected');
      console.log(chalk.gray('  Services:'), data.services?.length || 0);
      console.log(chalk.gray('  Deployment ID:'), deploymentId);
      
      // Show services
      if (data.services?.length > 0) {
        console.log(chalk.cyan('\n📦 Detected Services:'));
        data.services.forEach(s => {
          console.log(chalk.gray(`  - ${s.name} (${s.type})`), 
            s.framework ? chalk.yellow(`[${s.framework}]`) : '',
            s.hasDockerfile ? chalk.green('✓ Dockerfile') : chalk.red('✗ No Dockerfile')
          );
        });
      }
      
      // Show missing files
      if (data.missingFiles?.length > 0) {
        console.log(chalk.yellow('\n⚠️ Missing Infrastructure Files:'));
        data.missingFiles.forEach(f => {
          console.log(chalk.gray(`  - ${f.file}`), chalk.dim(`(${f.description})`));
        });
      }
      
      // Step 2: Collect environment
      if (!data.envStatus?.hasEnv) {
        console.log(chalk.yellow('\n⚠️ No .env file found'));
        
        const envAnswer = await inquirer.prompt([
          {
            type: 'list',
            name: 'envAction',
            message: 'How would you like to provide environment variables?',
            choices: [
              { name: 'Paste .env content', value: 'paste' },
              { name: 'Upload .env file', value: 'file' },
              { name: 'Skip for now', value: 'skip' }
            ]
          }
        ]);
        
        if (envAnswer.envAction === 'paste') {
          const { envContent } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'envContent',
              message: 'Paste your .env content:'
            }
          ]);
          
          if (envContent) {
            await api.post('/project/env', {
              deploymentId,
              content: envContent,
              service: 'main'
            });
            console.log(chalk.green('✓ Environment variables stored'));
          }
        } else if (envAnswer.envAction === 'file') {
          const { envFilePath } = await inquirer.prompt([
            {
              type: 'input',
              name: 'envFilePath',
              message: 'Enter path to .env file:',
              default: path.join(projectPath, '.env')
            }
          ]);
          
          if (fs.existsSync(envFilePath)) {
            const envContent = fs.readFileSync(envFilePath, 'utf8');
            await api.post('/project/env', {
              deploymentId,
              content: envContent,
              service: 'main'
            });
            console.log(chalk.green('✓ Environment variables stored'));
          } else {
            console.log(chalk.red('File not found'));
          }
        }
      } else {
        console.log(chalk.green('\n✓ Environment file detected'));
      }
      
      // Confirm before proceeding
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Proceed with file generation and deployment?',
          default: true
        }
      ]);
      
      if (!proceed) {
        console.log(chalk.yellow('\nDeployment cancelled'));
        process.exit(0);
      }
      
      // Step 3: Deploy with streaming logs
      console.log(chalk.cyan('\n🚀 Starting deployment...'));
      console.log(chalk.gray('Streaming logs will appear below:\n'));
      
      await streamDeployment(api, deploymentId, options);
      
    } catch (error) {
      analyzeSpinner.fail('Error');
      console.log(chalk.red(error.message));
      process.exit(1);
    }
  });

/**
 * Analyze project only
 */
projectCommand
  .command('analyze [path]')
  .description('Analyze a project without deploying')
  .action(async (projectPath) => {
    const api = createApiClient();
    projectPath = path.resolve(projectPath || process.cwd());
    
    const spinner = ora('Analyzing project...').start();
    
    try {
      const response = await api.post('/project/analyze', { path: projectPath });
      
      if (!response.data.success) {
        spinner.fail('Analysis failed');
        console.log(chalk.red(response.data.error));
        process.exit(1);
      }
      
      spinner.succeed('Analysis complete');
      
      const { data, deploymentId } = response.data;
      
      console.log(chalk.cyan('\n📋 Project Analysis'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.white('Deployment ID:'), deploymentId);
      console.log(chalk.white('Path:'), projectPath);
      console.log(chalk.white('Type:'), data.projectType?.language || 'Unknown');
      console.log(chalk.white('Framework:'), data.framework || 'None');
      console.log(chalk.white('Is Monorepo:'), data.projectType?.isMonorepo ? 'Yes' : 'No');
      
      console.log(chalk.cyan('\n📦 Services'));
      console.log(chalk.gray('─'.repeat(40)));
      if (data.services?.length > 0) {
        data.services.forEach(s => {
          console.log(`  ${chalk.white(s.name)}`);
          console.log(`    Type: ${s.type}`);
          console.log(`    Framework: ${s.framework || 'N/A'}`);
          console.log(`    Port: ${s.port || 'N/A'}`);
          console.log(`    Dockerfile: ${s.hasDockerfile ? chalk.green('Yes') : chalk.red('No')}`);
        });
      } else {
        console.log(chalk.gray('  No services detected'));
      }
      
      console.log(chalk.cyan('\n📁 Missing Files'));
      console.log(chalk.gray('─'.repeat(40)));
      if (data.missingFiles?.length > 0) {
        data.missingFiles.forEach(f => {
          const priority = f.priority === 'high' 
            ? chalk.red(`[${f.priority}]`) 
            : chalk.yellow(`[${f.priority}]`);
          console.log(`  ${priority} ${f.file}`);
          console.log(chalk.gray(`      ${f.description}`));
        });
      } else {
        console.log(chalk.green('  All required files present'));
      }
      
      console.log(chalk.cyan('\n🔐 Environment'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  .env file: ${data.envStatus?.hasEnv ? chalk.green('Found') : chalk.red('Missing')}`);
      console.log(`  .env.example: ${data.envStatus?.hasTemplate ? chalk.green('Found') : chalk.yellow('Missing')}`);
      
      if (data.recommendations?.length > 0) {
        console.log(chalk.cyan('\n💡 Recommendations'));
        console.log(chalk.gray('─'.repeat(40)));
        data.recommendations.forEach(r => {
          const icon = r.type === 'critical' ? '🔴' : r.type === 'warning' ? '🟡' : '🔵';
          console.log(`  ${icon} ${r.message}`);
        });
      }
      
    } catch (error) {
      spinner.fail('Error');
      console.log(chalk.red(error.message));
      process.exit(1);
    }
  });

/**
 * Set environment variables
 */
projectCommand
  .command('env:set <deploymentId>')
  .description('Set environment variables for a deployment')
  .option('-f, --file <path>', 'Path to .env file')
  .option('-s, --service <name>', 'Service name', 'main')
  .action(async (deploymentId, options) => {
    const api = createApiClient();
    
    let envContent;
    
    if (options.file) {
      if (!fs.existsSync(options.file)) {
        console.log(chalk.red('File not found:', options.file));
        process.exit(1);
      }
      envContent = fs.readFileSync(options.file, 'utf8');
    } else {
      const { content } = await inquirer.prompt([
        {
          type: 'editor',
          name: 'content',
          message: 'Enter environment variables (KEY=value format):'
        }
      ]);
      envContent = content;
    }
    
    const spinner = ora('Storing environment variables...').start();
    
    try {
      const response = await api.post('/project/env', {
        deploymentId,
        content: envContent,
        service: options.service
      });
      
      if (response.data.success) {
        spinner.succeed(`Stored ${response.data.data.variableCount} variables for ${options.service}`);
      } else {
        spinner.fail('Failed to store environment');
        console.log(chalk.red(response.data.error));
      }
    } catch (error) {
      spinner.fail('Error');
      console.log(chalk.red(error.message));
    }
  });

/**
 * Generate infrastructure files
 */
projectCommand
  .command('generate <deploymentId>')
  .description('Generate Dockerfile, docker-compose, and other infrastructure files')
  .action(async (deploymentId) => {
    const api = createApiClient();
    const spinner = ora('Generating infrastructure files...').start();
    
    try {
      const response = await api.post('/project/generate', { deploymentId });
      
      if (!response.data.success) {
        spinner.fail('Generation failed');
        console.log(chalk.red(response.data.error));
        process.exit(1);
      }
      
      spinner.succeed('Files generated');
      
      console.log(chalk.cyan('\n📄 Generated Files:'));
      response.data.data.files?.forEach(f => {
        console.log(chalk.gray(`  - ${f.path}`), f.isNew ? chalk.green('(new)') : chalk.yellow('(modified)'));
      });
      
      const { confirm } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: 'Write these files to disk?',
          default: true
        }
      ]);
      
      if (confirm) {
        const confirmResponse = await api.post('/project/generate/confirm', {
          deploymentId,
          approve: true
        });
        
        if (confirmResponse.data.success) {
          console.log(chalk.green('✓ Files written to disk'));
        } else {
          console.log(chalk.red('Failed to write files'));
        }
      }
      
    } catch (error) {
      spinner.fail('Error');
      console.log(chalk.red(error.message));
    }
  });

/**
 * Build Docker images
 */
projectCommand
  .command('build <deploymentId>')
  .description('Build Docker images locally')
  .action(async (deploymentId) => {
    const api = createApiClient();
    
    console.log(chalk.cyan('🔨 Building Docker images...'));
    console.log(chalk.gray('Streaming build logs:\n'));
    
    await streamEndpoint(api, '/project/build', { deploymentId });
  });

/**
 * Test locally
 */
projectCommand
  .command('test <deploymentId>')
  .description('Run and test containers locally')
  .action(async (deploymentId) => {
    const api = createApiClient();
    
    console.log(chalk.cyan('🧪 Running local tests...'));
    console.log(chalk.gray('Streaming test logs:\n'));
    
    await streamEndpoint(api, '/project/test', { deploymentId });
  });

/**
 * Deploy to production
 */
projectCommand
  .command('deploy <deploymentId>')
  .description('Deploy to production infrastructure')
  .option('--skip-local-test', 'Skip local testing phase')
  .option('--skip-infra', 'Skip infrastructure provisioning')
  .action(async (deploymentId, options) => {
    const api = createApiClient();
    
    console.log(chalk.cyan('🚀 Deploying to production...'));
    console.log(chalk.gray('Streaming deployment logs:\n'));
    
    await streamDeployment(api, deploymentId, options);
  });

/**
 * Stream logs
 */
projectCommand
  .command('logs <deploymentId>')
  .description('Stream deployment logs')
  .option('-t, --type <type>', 'Log type (docker, terraform, ssh)', 'all')
  .action(async (deploymentId, options) => {
    const api = createApiClient();
    const config = getConfig();
    
    console.log(chalk.cyan(`📜 Streaming ${options.type} logs...`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    
    const url = `${config.apiUrl}/api/v1/project/${deploymentId}/logs?type=${options.type}`;
    const token = getAuthToken();
    
    const es = new EventSource(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(formatLogLine(data));
      } catch (e) {
        console.log(event.data);
      }
    };
    
    es.onerror = (error) => {
      console.log(chalk.red('Connection error'));
      es.close();
    };
    
    process.on('SIGINT', () => {
      es.close();
      process.exit(0);
    });
  });

/**
 * Check status
 */
projectCommand
  .command('status <deploymentId>')
  .description('Check deployment status')
  .action(async (deploymentId) => {
    const api = createApiClient();
    
    try {
      const response = await api.get(`/project/${deploymentId}/status`);
      
      if (!response.data.success) {
        console.log(chalk.red('Deployment not found'));
        process.exit(1);
      }
      
      const { data } = response.data;
      
      console.log(chalk.cyan('\n📊 Deployment Status'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(chalk.white('ID:'), deploymentId);
      console.log(chalk.white('Current Stage:'), data.currentStage);
      console.log(chalk.white('Status:'), getStatusColor(data.status)(data.status));
      console.log(chalk.white('Progress:'), `${data.progress}%`);
      console.log(chalk.white('Stages Completed:'), `${data.stagesCompleted}/${data.totalStages}`);
      
      if (data.context?.services) {
        console.log(chalk.white('Services:'), data.context.services.join(', '));
      }
      
    } catch (error) {
      console.log(chalk.red(error.message));
    }
  });

/**
 * Rollback deployment
 */
projectCommand
  .command('rollback <deploymentId>')
  .description('Rollback a deployment')
  .option('-r, --reason <reason>', 'Rollback reason')
  .action(async (deploymentId, options) => {
    const api = createApiClient();
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to rollback this deployment?',
        default: false
      }
    ]);
    
    if (!confirm) {
      console.log(chalk.yellow('Rollback cancelled'));
      return;
    }
    
    const spinner = ora('Rolling back...').start();
    
    try {
      const response = await api.post(`/project/${deploymentId}/rollback`, {
        reason: options.reason || 'User initiated rollback'
      });
      
      if (response.data.success) {
        spinner.succeed('Rollback completed');
        console.log(chalk.gray(`Rolled back from: ${response.data.data.rolledBackFrom}`));
      } else {
        spinner.fail('Rollback failed');
      }
    } catch (error) {
      spinner.fail('Error');
      console.log(chalk.red(error.message));
    }
  });

// Helper functions

async function streamDeployment(api, deploymentId, options = {}) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const token = getAuthToken();
    
    const params = new URLSearchParams({
      deploymentId,
      skipLocalTest: options.skipLocalTest || false,
      skipInfra: options.skipInfra || false
    });
    
    const url = `${config.apiUrl}/api/v1/project/deploy?${params}`;
    
    const es = new EventSource(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    es.onmessage = (event) => {
      if (event.data === '[DONE]') {
        es.close();
        console.log(chalk.green('\n✓ Deployment complete'));
        resolve();
        return;
      }
      
      try {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'stage_start':
            console.log(chalk.cyan(`\n▶ ${data.stage}`));
            break;
          case 'stage_result':
            if (data.success) {
              console.log(chalk.green(`  ✓ ${data.stage} completed`));
            } else {
              console.log(chalk.red(`  ✗ ${data.stage} failed: ${data.error}`));
            }
            break;
          case 'verification':
            console.log(chalk.magenta(`  🤖 Claude: ${data.approved ? 'Approved' : 'Reviewing...'}`));
            break;
          case 'log':
            console.log(chalk.gray(`    ${data.log}`));
            break;
          case 'error':
            console.log(chalk.red(`  ✗ Error: ${data.error}`));
            break;
          case 'summary':
            console.log(chalk.cyan(`\n📋 Summary: ${data.summary}`));
            break;
        }
      } catch (e) {
        console.log(event.data);
      }
    };
    
    es.onerror = (error) => {
      es.close();
      reject(new Error('Stream connection error'));
    };
  });
}

async function streamEndpoint(api, endpoint, body) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const token = getAuthToken();
    
    const url = `${config.apiUrl}/api/v1${endpoint}`;
    
    // POST with SSE response
    api.post(endpoint, body, {
      responseType: 'stream'
    }).then(response => {
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log(chalk.green('\n✓ Complete'));
              resolve();
              return;
            }
            try {
              const parsed = JSON.parse(data);
              console.log(formatLogLine(parsed));
            } catch (e) {
              console.log(data);
            }
          }
        });
      });
    }).catch(reject);
  });
}

function formatLogLine(data) {
  const timestamp = data.timestamp 
    ? chalk.gray(`[${new Date(data.timestamp).toLocaleTimeString()}]`)
    : '';
  
  let content = data.log || data.message || data.content || '';
  
  if (content.toLowerCase().includes('error')) {
    content = chalk.red(content);
  } else if (content.toLowerCase().includes('warning')) {
    content = chalk.yellow(content);
  } else if (content.includes('successfully') || content.includes('✓')) {
    content = chalk.green(content);
  } else {
    content = chalk.gray(content);
  }
  
  return `${timestamp} ${content}`;
}

function getStatusColor(status) {
  switch (status) {
    case 'complete':
      return chalk.green;
    case 'running':
    case 'in_progress':
      return chalk.blue;
    case 'error':
    case 'failed':
      return chalk.red;
    case 'awaiting_verification':
      return chalk.magenta;
    default:
      return chalk.gray;
  }
}

module.exports = projectCommand;


