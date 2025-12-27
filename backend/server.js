const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { WebSocketServer } = require('ws');

const logger = require('./utils/logger');
const { connectDB } = require('./config/database');
// TODO: Redis - Commented out for now, uncomment when Redis is available
// const { connectRedis } = require('./config/redis');
const { initializeStateLockTable, initializeStateBucket } = require('./config/aws');
const { initializeMCP } = require('./config/mcp');
const mcpOrchestrator = require('./services/mcpOrchestrator');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const chatRoutes = require('./routes/chat');
const deploymentRoutes = require('./routes/deployments');
const terraformRoutes = require('./routes/terraform');
const sandboxRoutes = require('./routes/sandbox');
const stateRoutes = require('./routes/state');
const costRoutes = require('./routes/costs');
const jobRoutes = require('./routes/jobs');
const monitoringRoutes = require('./routes/monitoring');
const serviceRoutes = require('./routes/services');
const dynamicServiceRoutes = require('./routes/dynamicServices');
const githubRoutes = require('./routes/github');
const settingsRoutes = require('./routes/settings');
const credentialsRoutes = require('./routes/credentials');
const cliRoutes = require('./routes/cli');
const commandsRoutes = require('./routes/commands');
const filesRoutes = require('./routes/files');
const stepsRoutes = require('./routes/steps');
const credentialRequestsRoutes = require('./routes/credentialRequests');
const cursorRoutes = require('./routes/cursor');
const requirementsRoutes = require('./routes/requirements');
const architectureRoutes = require('./routes/architecture');
const deploymentPlanRoutes = require('./routes/deploymentPlan');
const mcpRoutes = require('./routes/mcp');
const projectRoutes = require('./routes/project');
const fileGenerationRoutes = require('./routes/fileGeneration');

// Import middleware
const errorHandler = require('./middleware/errorHandler');

// TODO: Workers - Commented out as they require Redis
// Import workers (requires Redis)
// const terraformWorker = require('./workers/terraformWorker');
// const sandboxWorker = require('./workers/sandboxWorker');
// const cleanupWorker = require('./workers/cleanupWorker');

const app = express();
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

// Store active WebSocket connections
const wsClients = new Map();
// Store CLI log streaming connections by deploymentId
const cliLogStreams = new Map();
// Store deployment progress connections by deploymentId
const deploymentProgressStreams = new Map();
// Store command event streaming connections by deploymentId
const commandEventStreams = new Map();

wss.on('connection', (ws, req) => {
  // Extract token and deploymentId from query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const deploymentId = url.searchParams.get('deploymentId');
  const streamType = url.searchParams.get('type') || 'general'; // 'general', 'cli', or 'commands'
  
  // TODO: Validate token here
  // For now, accept all connections
  
  const clientId = `client-${Date.now()}`;
  
  // Handle pipeline log streaming connections
  if (streamType === 'pipeline' && deploymentId) {
    if (!pipelineLogStreams.has(deploymentId)) {
      pipelineLogStreams.set(deploymentId, new Set());
    }
    pipelineLogStreams.get(deploymentId).add(ws);
    logger.info(`Pipeline stream connected for deployment ${deploymentId}`);
    
    ws.on('close', () => {
      const streams = pipelineLogStreams.get(deploymentId);
      if (streams) {
        streams.delete(ws);
        if (streams.size === 0) {
          pipelineLogStreams.delete(deploymentId);
        }
      }
      logger.info(`Pipeline stream disconnected for deployment ${deploymentId}`);
    });
    
    // Send current pipeline status
    const { pipelineOrchestrator } = require('./services/pipelineOrchestrator');
    const summary = pipelineOrchestrator.getPipelineSummary(deploymentId);
    if (summary) {
      ws.send(JSON.stringify({
        type: 'pipeline_status',
        deploymentId,
        ...summary
      }));
    }
    return;
  }
  
  // Handle command event streaming connections
  if (streamType === 'commands' && deploymentId) {
    if (!commandEventStreams.has(deploymentId)) {
      commandEventStreams.set(deploymentId, new Set());
    }
    commandEventStreams.get(deploymentId).add(ws);
    logger.info(`Command event stream connected for deployment ${deploymentId}`);
    
    ws.on('close', () => {
      const streams = commandEventStreams.get(deploymentId);
      if (streams) {
        streams.delete(ws);
        if (streams.size === 0) {
          commandEventStreams.delete(deploymentId);
        }
      }
      logger.info(`Command event stream disconnected for deployment ${deploymentId}`);
    });
    
    ws.on('error', (error) => {
      logger.error(`Command event stream error for deployment ${deploymentId}:`, error);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'command_stream_connected',
      deploymentId,
      timestamp: new Date().toISOString()
    }));
    
    return; // Don't add to general wsClients
  }
  
  // Handle CLI log streaming connections
  if (streamType === 'cli' && deploymentId) {
    if (!cliLogStreams.has(deploymentId)) {
      cliLogStreams.set(deploymentId, new Set());
    }
    cliLogStreams.get(deploymentId).add(ws);
    logger.info(`CLI log stream connected for deployment ${deploymentId}`);
    
    ws.on('close', () => {
      const streams = cliLogStreams.get(deploymentId);
      if (streams) {
        streams.delete(ws);
        if (streams.size === 0) {
          cliLogStreams.delete(deploymentId);
        }
      }
      logger.info(`CLI log stream disconnected for deployment ${deploymentId}`);
    });
    
    ws.on('error', (error) => {
      logger.error(`CLI log stream error for deployment ${deploymentId}:`, error);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'cli_log_stream_connected',
      deploymentId,
      timestamp: new Date().toISOString()
    }));
    
    return; // Don't add to general wsClients
  }
  
  // Handle deployment progress streaming connections
  const progressDeploymentId = url.searchParams.get('progressDeploymentId');
  if (progressDeploymentId) {
    if (!deploymentProgressStreams.has(progressDeploymentId)) {
      deploymentProgressStreams.set(progressDeploymentId, new Set());
    }
    deploymentProgressStreams.get(progressDeploymentId).add(ws);
    
    // Register with progress tracker
    const progressTracker = require('./services/progressTracker');
    progressTracker.registerConnection(progressDeploymentId, ws);
    
    logger.info(`Deployment progress stream connected for deployment ${progressDeploymentId}`);
    
    ws.on('close', () => {
      const streams = deploymentProgressStreams.get(progressDeploymentId);
      if (streams) {
        streams.delete(ws);
        if (streams.size === 0) {
          deploymentProgressStreams.delete(progressDeploymentId);
        }
      }
      progressTracker.unregisterConnection(progressDeploymentId, ws);
      logger.info(`Deployment progress stream disconnected for deployment ${progressDeploymentId}`);
    });
    
    ws.on('error', (error) => {
      logger.error('Deployment progress WebSocket error:', error);
      progressTracker.unregisterConnection(progressDeploymentId, ws);
    });
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'deployment_progress_connected',
      deploymentId: progressDeploymentId,
      timestamp: new Date().toISOString()
    }));
    
    return; // Don't add to general wsClients
  }
  
  // General WebSocket connection
  wsClients.set(clientId, ws);
  
  logger.info(`WebSocket client connected: ${clientId}`);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      logger.debug('WebSocket message received:', data);
      
      // Handle different message types
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (error) {
      logger.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    wsClients.delete(clientId);
    logger.info(`WebSocket client disconnected: ${clientId}`);
  });
  
  ws.on('error', (error) => {
    logger.error('WebSocket error:', error);
  });
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    timestamp: new Date().toISOString()
  }));
});

// Helper function to broadcast CLI logs to connected clients
const broadcastCLILog = (deploymentId, level, message) => {
  const streams = cliLogStreams.get(deploymentId);
  if (streams) {
    const logMessage = JSON.stringify({
      type: 'cli_log',
      deploymentId,
      level,
      message,
      timestamp: new Date().toISOString()
    });
    
    streams.forEach((ws) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(logMessage);
      }
    });
  }
};

// Helper function to broadcast command events to connected clients
const broadcastCommandEvent = (deploymentId, eventType, eventData) => {
  const streams = commandEventStreams.get(deploymentId);
  if (streams) {
    const message = JSON.stringify({
      type: 'command_event',
      eventType,
      deploymentId,
      ...eventData,
      timestamp: new Date().toISOString()
    });
    
    streams.forEach((ws) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(message);
      }
    });
  }
};

// Store pipeline log streaming connections by deploymentId
const pipelineLogStreams = new Map();

// Helper function to broadcast pipeline logs
const broadcastPipelineLog = (deploymentId, data) => {
  const streams = pipelineLogStreams.get(deploymentId);
  if (streams) {
    const logMessage = JSON.stringify({
      type: 'pipeline_log',
      deploymentId,
      ...data,
      timestamp: new Date().toISOString()
    });
    
    streams.forEach((ws) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(logMessage);
      }
    });
  }
};

// Helper function to broadcast pipeline stage updates
const broadcastPipelineStage = (deploymentId, stage, status, data = {}) => {
  const streams = pipelineLogStreams.get(deploymentId);
  if (streams) {
    const message = JSON.stringify({
      type: 'pipeline_stage',
      deploymentId,
      stage,
      status,
      ...data,
      timestamp: new Date().toISOString()
    });
    
    streams.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    });
  }
};

// Make CLI log broadcast available to other modules
app.locals.broadcastCLILog = broadcastCLILog;
app.locals.cliLogStreams = cliLogStreams;
app.locals.broadcastCommandEvent = broadcastCommandEvent;
app.locals.commandEventStreams = commandEventStreams;
app.locals.broadcastPipelineLog = broadcastPipelineLog;
app.locals.broadcastPipelineStage = broadcastPipelineStage;
app.locals.pipelineLogStreams = pipelineLogStreams;

// Set broadcast function in CLI executor
const cliExecutor = require('./services/cliExecutor');
cliExecutor.setBroadcastFunction(broadcastCLILog);

// Set broadcast function in command execution service
const commandExecutionService = require('./services/commandExecutionService');
commandExecutionService.setBroadcastFunction((deploymentId, eventType, eventData) => {
  broadcastCommandEvent(deploymentId, eventType, eventData);
});

// Helper function to broadcast to all clients
const broadcast = (event, data) => {
  const message = JSON.stringify({ type: event, ...data });
  wsClients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
    }
  });
};

// Make broadcast available to other modules
app.locals.broadcast = broadcast;

// Make WebSocket clients available to other modules
app.locals.wsClients = wsClients;
app.locals.deploymentProgressStreams = deploymentProgressStreams;

// Initialize progress tracker and connect to workflow orchestrator
const progressTracker = require('./services/progressTracker');
const workflowOrchestrator = require('./services/workflowOrchestrator');

// Listen to workflow orchestrator progress events and broadcast via WebSocket
workflowOrchestrator.on('progress', (progressEvent) => {
  progressTracker.trackProgress(progressEvent.deploymentId, progressEvent);
});

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'https://api.anthropic.com']
    }
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/deployments', deploymentRoutes);
app.use('/api/v1/terraform', terraformRoutes);
app.use('/api/v1/sandbox', sandboxRoutes);
app.use('/api/v1/state', stateRoutes);
app.use('/api/v1/costs', costRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/services', serviceRoutes);
app.use('/api/v1/services', dynamicServiceRoutes); // Dynamic service routes
app.use('/api/v1/github', githubRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/credentials', credentialsRoutes);
app.use('/api/v1/cli', cliRoutes);
app.use('/api/v1/commands', commandsRoutes);
app.use('/api/v1/files', filesRoutes);
app.use('/api/v1/steps', stepsRoutes);
app.use('/api/v1/credentials', credentialRequestsRoutes);
app.use('/api/v1/cursor', cursorRoutes);
app.use('/api/v1/requirements', requirementsRoutes);
app.use('/api/v1/architecture', architectureRoutes);
app.use('/api/v1/deployment-plan', deploymentPlanRoutes);
app.use('/api/v1/mcp', mcpRoutes);
app.use('/api/v1/project', projectRoutes);
app.use('/api/v1/file-generation', fileGenerationRoutes);
app.use('/api/v1', monitoringRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`
    }
  });
});

// Initialize services and start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // TODO: Redis - Commented out for now, uncomment when Redis is available
    // Connect to Redis
    // await connectRedis();
    
    // TODO: AWS Resources - Commented out due to permission issues, uncomment when AWS permissions are configured
    // Initialize AWS resources (requires proper IAM permissions)
    // await initializeStateLockTable();
    // await initializeStateBucket();
    
    // Initialize MCP servers
    await initializeMCP();
    await mcpOrchestrator.initialize();
    
    // TODO: Queue Workers - Commented out as they require Redis
    // Start queue workers (requires Redis)
    // logger.info('Starting queue workers...');
    // terraformWorker.start();
    // sandboxWorker.start();
    // cleanupWorker.start();
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`WebSocket server running on /ws`);
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  
  // Close WebSocket connections
  wsClients.forEach((ws) => {
    ws.close();
  });
  
  // Close HTTP server
  server.close(() => {
    logger.info('HTTP server closed');
  });
  
  // TODO: Workers - Commented out as they require Redis
  // Stop workers (requires Redis)
  // terraformWorker.stop();
  // sandboxWorker.stop();
  // cleanupWorker.stop();
  
  // Disconnect from databases
  const { disconnectDB } = require('./config/database');
  // TODO: Redis - Commented out for now, uncomment when Redis is available
  // const { disconnectRedis } = require('./config/redis');
  await disconnectDB();
  // await disconnectRedis();
  
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start the server (only if not imported as module)
if (require.main === module) {
  startServer();
}

module.exports = { app, server, wss };

