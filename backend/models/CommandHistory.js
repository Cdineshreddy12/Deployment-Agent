const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const commandHistorySchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true,
    index: true
  },
  commandId: {
    type: String,
    required: true,
    unique: true,
    default: () => `cmd_${uuidv4().replace(/-/g, '')}`
  },
  command: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['shell', 'terraform', 'aws', 'docker', 'kubectl', 'other'],
    default: 'shell'
  },
  status: {
    type: String,
    enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  exitCode: {
    type: Number
  },
  startedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date
  },
  duration: {
    type: Number // milliseconds
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  workingDirectory: {
    type: String
  },
  environmentVariables: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  output: {
    type: String,
    maxlength: 100000 // Truncate very long outputs
  },
  error: {
    type: String,
    maxlength: 100000 // Truncate very long errors
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes
commandHistorySchema.index({ deploymentId: 1, startedAt: -1 });
commandHistorySchema.index({ userId: 1, startedAt: -1 });
commandHistorySchema.index({ status: 1 });
commandHistorySchema.index({ type: 1 });
commandHistorySchema.index({ commandId: 1 });

// Method to calculate duration
commandHistorySchema.methods.calculateDuration = function() {
  if (this.startedAt && this.completedAt) {
    this.duration = this.completedAt - this.startedAt;
  }
  return this.duration;
};

// Method to mark as completed
commandHistorySchema.methods.markCompleted = function(exitCode, output, error) {
  this.status = exitCode === 0 ? 'completed' : 'failed';
  this.exitCode = exitCode;
  this.completedAt = new Date();
  this.calculateDuration();
  
  // Truncate output/error if too long
  if (output && output.length > 100000) {
    this.output = output.substring(0, 100000) + '\n... (truncated)';
  } else {
    this.output = output || '';
  }
  
  if (error && error.length > 100000) {
    this.error = error.substring(0, 100000) + '\n... (truncated)';
  } else {
    this.error = error || '';
  }
};

// Method to mark as cancelled
commandHistorySchema.methods.markCancelled = function() {
  this.status = 'cancelled';
  this.completedAt = new Date();
  this.calculateDuration();
};

module.exports = mongoose.model('CommandHistory', commandHistorySchema);





