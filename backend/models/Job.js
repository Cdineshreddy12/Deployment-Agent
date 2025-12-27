const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: [
      'terraform_init',
      'terraform_plan',
      'terraform_apply',
      'terraform_destroy',
      'sandbox_create',
      'sandbox_test',
      'sandbox_cleanup',
      'cost_tracking',
      'notification'
    ],
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  status: {
    type: String,
    enum: ['waiting', 'active', 'completed', 'failed', 'cancelled'],
    default: 'waiting'
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  attempts: {
    type: Number,
    default: 0
  },
  maxAttempts: {
    type: Number,
    default: 3
  },
  result: {
    type: mongoose.Schema.Types.Mixed
  },
  error: {
    message: String,
    stack: String,
    code: String
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  duration: {
    type: Number // milliseconds
  }
}, {
  timestamps: true
});

// Indexes
jobSchema.index({ status: 1, createdAt: -1 });
jobSchema.index({ type: 1, status: 1 });
// Note: jobId index is created automatically by unique: true in schema

// Generate jobId before saving
jobSchema.pre('save', async function(next) {
  if (!this.jobId) {
    const { v4: uuidv4 } = require('uuid');
    const shortId = uuidv4().split('-')[0];
    this.jobId = `job-${shortId}`;
  }
  next();
});

// Calculate duration before saving
jobSchema.pre('save', function(next) {
  if (this.startedAt && this.completedAt) {
    this.duration = this.completedAt - this.startedAt;
  }
  next();
});

module.exports = mongoose.model('Job', jobSchema);

