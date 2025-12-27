const mongoose = require('mongoose');

const costSchema = new mongoose.Schema({
  deploymentId: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  totalCost: {
    type: Number,
    required: true
  },
  breakdown: {
    compute: {
      type: Number,
      default: 0
    },
    database: {
      type: Number,
      default: 0
    },
    networking: {
      type: Number,
      default: 0
    },
    storage: {
      type: Number,
      default: 0
    },
    other: {
      type: Number,
      default: 0
    }
  },
  services: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  estimatedCost: {
    type: Number
  },
  variance: {
    type: Number
  },
  variancePercentage: {
    type: Number
  },
  recommendations: [{
    type: {
      type: String,
      enum: ['right_sizing', 'reserved_instances', 'idle_resources', 'unattached_volumes']
    },
    resource: String,
    currentType: String,
    recommendedType: String,
    potentialSavings: Number,
    description: String
  }]
}, {
  timestamps: true
});

// Indexes
costSchema.index({ deploymentId: 1, date: -1 });
costSchema.index({ date: -1 });

// Calculate variance before saving
costSchema.pre('save', function(next) {
  if (this.estimatedCost !== undefined && this.totalCost !== undefined) {
    this.variance = this.totalCost - this.estimatedCost;
    if (this.estimatedCost > 0) {
      this.variancePercentage = (this.variance / this.estimatedCost) * 100;
    }
  }
  next();
});

module.exports = mongoose.model('Cost', costSchema);

