# Deployment Agent CLI

A powerful command-line interface for the Deployment Agent platform. Connect to AWS EC2 instances, manage deployments, execute remote commands, and interact with cloud services.

## Features

- 🔐 **Authentication**: Login with email/password or API keys
- 🚀 **Deployment Management**: Create, list, approve, cancel, and rollback deployments
- ☁️ **AWS EC2 Integration**: List, start, stop, reboot EC2 instances
- 🔌 **SSH Connectivity**: Connect to EC2 instances or any remote host via SSH
- 💻 **Remote Execution**: Execute commands on remote servers
- ⚙️ **Configuration Management**: Manage CLI settings and credentials

## Installation

### From Source

```bash
cd cli
npm install
npm link  # Makes 'deploy-agent' command available globally
```

### Using npm (if published)

```bash
npm install -g deployment-agent-cli
```

## Configuration

### Initial Setup

```bash
deploy-agent config:init
```

This will prompt you for the API URL (default: http://localhost:5000).

### Authentication

#### Option 1: Login with Email/Password

```bash
deploy-agent login
```

Or with flags:

```bash
deploy-agent login --email user@example.com --password yourpassword
```

#### Option 2: Use API Key

1. Create an API key (via web UI or CLI):
```bash
deploy-agent api-key --create
```

2. Set it as an environment variable:
```bash
export DEPLOYMENT_AGENT_API_KEY="your-api-key-here"
```

### AWS Credentials

The CLI can use AWS credentials in two ways:

1. **Environment Variables** (Recommended):
```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
export AWS_REGION="us-east-1"
```

2. **Backend API**: Configure credentials through the web interface (coming soon)

## Usage

### Authentication Commands

```bash
# Login
deploy-agent login

# Logout
deploy-agent logout

# Check current user
deploy-agent whoami

# Manage API keys
deploy-agent api-key --create
deploy-agent api-key --list
deploy-agent api-key --delete <keyId>
```

### Deployment Commands

```bash
# List deployments
deploy-agent deployments
deploy-agent deployments --environment prod --status DEPLOYED

# Get deployment details
deploy-agent deployment <deployment-id>

# Create deployment
deploy-agent deploy --name "My App" --environment prod --url https://github.com/user/repo

# Approve deployment
deploy-agent approve <deployment-id> --comment "Looks good!"

# Cancel deployment
deploy-agent cancel <deployment-id>

# Rollback deployment
deploy-agent rollback <deployment-id> --version v1.0.0 --reason "Bug fix"
```

### EC2 Commands

```bash
# List EC2 instances
deploy-agent ec2:list
deploy-agent ec2:list --region us-west-2 --state running

# Describe instance
deploy-agent ec2:describe i-1234567890abcdef0

# Start instance
deploy-agent ec2:start i-1234567890abcdef0

# Stop instance
deploy-agent ec2:stop i-1234567890abcdef0

# Reboot instance
deploy-agent ec2:reboot i-1234567890abcdef0
```

### SSH Commands

#### Connect to EC2 Instance

```bash
# Interactive SSH session
deploy-agent ec2:ssh i-1234567890abcdef0

# Execute command
deploy-agent ec2:ssh i-1234567890abcdef0 --command "ls -la"

# Specify SSH user and key
deploy-agent ec2:ssh i-1234567890abcdef0 --user ubuntu --key ~/.ssh/my-key.pem
```

#### Connect to Generic Host

```bash
# Interactive SSH session
deploy-agent ssh:connect example.com --user myuser --key ~/.ssh/id_rsa

# Execute command
deploy-agent ssh:exec example.com "df -h" --user myuser
```

### Configuration Commands

```bash
# Set configuration
deploy-agent config --set apiUrl=http://api.example.com

# Get configuration
deploy-agent config --get apiUrl

# List all configuration
deploy-agent config --list

# Initialize configuration
deploy-agent config:init
```

## Examples

### Complete Workflow

```bash
# 1. Login
deploy-agent login

# 2. List EC2 instances
deploy-agent ec2:list

# 3. SSH into an instance
deploy-agent ec2:ssh i-1234567890abcdef0 --command "sudo systemctl status nginx"

# 4. Create a deployment
deploy-agent deploy \
  --name "Production Deployment" \
  --environment prod \
  --url https://github.com/myorg/myapp \
  --branch main

# 5. Approve the deployment
deploy-agent approve <deployment-id>
```

### Remote Command Execution

```bash
# Execute multiple commands
deploy-agent ssh:exec server.example.com "cd /app && git pull && npm install" --user deploy

# Check disk usage
deploy-agent ssh:exec server.example.com "df -h"

# View logs
deploy-agent ssh:exec server.example.com "tail -f /var/log/app.log"
```

## Environment Variables

- `DEPLOYMENT_AGENT_API_URL`: API server URL (default: http://localhost:5000)
- `DEPLOYMENT_AGENT_API_KEY`: API key for authentication
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_REGION`: AWS region (default: us-east-1)
- `SSH_PASSWORD`: SSH password (if not using key-based auth)

## Configuration File

The CLI stores configuration in `~/.deployment-agent/config.json`:

```json
{
  "token": "jwt-token-here",
  "apiUrl": "http://localhost:5000",
  "user": {
    "id": "...",
    "email": "..."
  }
}
```

## Troubleshooting

### Authentication Issues

```bash
# Check if you're logged in
deploy-agent whoami

# If not, login again
deploy-agent login
```

### AWS Credentials Not Found

```bash
# Set environment variables
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
```

### SSH Connection Failed

1. Ensure the instance is running: `deploy-agent ec2:describe <instance-id>`
2. Check security group allows SSH (port 22)
3. Verify SSH key path: `deploy-agent ec2:ssh <instance-id> --key ~/.ssh/key.pem`
4. Try with different user: `--user ubuntu` or `--user ec2-user`

### API Connection Issues

```bash
# Check API URL
deploy-agent config --get apiUrl

# Update API URL
deploy-agent config --set apiUrl=https://api.example.com
```

## Security Best Practices

1. **Use API Keys**: Prefer API keys over password authentication for automation
2. **Secure SSH Keys**: Store SSH keys with proper permissions (600)
3. **Environment Variables**: Use environment variables for sensitive credentials
4. **Rotate Credentials**: Regularly rotate API keys and AWS credentials
5. **Least Privilege**: Grant minimal required permissions

## Extending the CLI

The CLI is designed to be extensible. You can add new commands by:

1. Creating a new command file in `commands/`
2. Registering it in `bin/cli.js`
3. Adding corresponding API endpoints in the backend

## Support

For issues and questions:
- Check the main project README
- Review backend API documentation
- Open an issue on GitHub

## License

MIT





