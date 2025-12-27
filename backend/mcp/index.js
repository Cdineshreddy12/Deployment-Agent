#!/usr/bin/env node

/**
 * MCP Server Entry Point
 * This file is the main entry point for running the MCP server standalone
 * 
 * Usage:
 *   node backend/mcp/index.js
 *   
 * For Cursor IDE integration, add to mcp_servers in settings:
 *   {
 *     "deployment-agent": {
 *       "command": "node",
 *       "args": ["/path/to/backend/mcp/index.js"],
 *       "env": {
 *         "MONGODB_URI": "mongodb://localhost:27017/deployment-agent",
 *         "MCP_AUTH_ENABLED": "false"
 *       }
 *     }
 *   }
 */

const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mcpServer = require('./server');
const { connectDB } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Initialize and start the MCP server
 */
async function main() {
  try {
    // Connect to database
    logger.info('Connecting to database...');
    await connectDB();
    logger.info('Database connected');

    // Initialize MCP server
    await mcpServer.initialize();

    // Start with stdio transport (for Cursor integration)
    await mcpServer.startStdio();

    logger.info('MCP Server is running and ready for connections');

  } catch (error) {
    logger.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection:', reason);
});

// Start the server
main();





