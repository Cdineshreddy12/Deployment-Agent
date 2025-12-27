# AI-Powered Deployment Automation Platform

An internal AI-powered deployment automation tool that leverages Claude API with MCP servers to enable natural language infrastructure provisioning on AWS.

## Features

- 🤖 Natural language infrastructure provisioning via Claude AI
- 🏗️ Automatic Terraform code generation
- 🧪 Sandbox testing before production
- ✅ Multi-stage approval workflows
- 💰 Cost estimation and tracking
- 🔄 Rollback capabilities
- 📊 Real-time deployment monitoring
- 🔐 Enterprise-grade security
- 💻 **CLI Agent**: Command-line interface for managing deployments, connecting to AWS EC2, and executing remote commands

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB, Redis
- **Frontend**: React
- **Infrastructure**: AWS, Terraform
- **AI**: Claude API with MCP servers

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB 6+
- Redis 6+
- AWS Account with credentials
- Claude API key

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm run install:all
   ```

3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```

4. Start MongoDB and Redis:
   ```bash
   # MongoDB
   mongod

   # Redis
   redis-server
   ```

5. Start the backend:
   ```bash
   npm run dev
   ```

6. Start the frontend (in another terminal):
   ```bash
   npm run frontend
   ```

### Environment Variables

See `.env.example` for all required environment variables.

## Project Structure

```
deployment-agent/
├── backend/          # Express.js backend
├── frontend/         # React frontend
├── cli/              # CLI agent for command-line operations
├── terraform/        # Terraform modules and templates
└── scripts/          # Setup and utility scripts
```

## CLI Agent

The platform includes a powerful CLI agent that allows you to:

- Connect to AWS EC2 instances via SSH
- Manage deployments from the command line
- Execute remote commands on servers
- Interact with cloud services

**Quick Start:**
```bash
cd cli
npm install
npm link
deploy-agent login
deploy-agent ec2:list
```

See [CLI_AGENT.md](./CLI_AGENT.md) for full documentation.

## API Documentation

API endpoints are available at `/api/v1/` when the server is running.

## License

MIT

# Deployment-Agent
