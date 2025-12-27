# CLI Installation Guide

## Quick Start

### 1. Install Dependencies

```bash
cd cli
npm install
```

### 2. Make CLI Executable

```bash
chmod +x bin/cli.js
```

### 3. Link Globally (Optional)

```bash
npm link
```

This makes the `deploy-agent` command available globally on your system.

### 4. Initialize Configuration

```bash
deploy-agent config:init
```

### 5. Login

```bash
deploy-agent login
```

## Alternative: Use Without Global Installation

You can use the CLI without global installation:

```bash
# From the cli directory
node bin/cli.js --help

# Or create an alias
alias deploy-agent="node /path/to/cli/bin/cli.js"
```

## Development Setup

For development:

```bash
cd cli
npm install
npm link  # Makes it available globally during development
```

## Troubleshooting

### Permission Denied

If you get permission errors:

```bash
chmod +x bin/cli.js
```

### Command Not Found

If `deploy-agent` command is not found:

1. Make sure you ran `npm link` from the cli directory
2. Check your PATH includes npm global bin directory
3. Use `node bin/cli.js` directly instead

### Module Not Found Errors

Make sure all dependencies are installed:

```bash
cd cli
npm install
```

## Next Steps

1. Configure your API URL: `deploy-agent config:init`
2. Login: `deploy-agent login`
3. Try listing deployments: `deploy-agent deployments`
4. Set up AWS credentials for EC2 access
5. Try connecting to an EC2 instance: `deploy-agent ec2:list`





