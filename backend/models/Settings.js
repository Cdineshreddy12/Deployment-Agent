const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['global', 'user'],
    default: 'user'
  },
  apiUrls: {
    backend: {
      type: String,
      default: process.env.VITE_API_URL || 'http://localhost:5002/api/v1'
    },
    websocket: {
      type: String,
      default: process.env.VITE_WS_URL || 'ws://localhost:5002'
    },
    github: {
      type: String,
      default: 'https://api.github.com'
    }
  },
  credits: {
    total: {
      type: Number,
      default: 0
    },
    used: {
      type: Number,
      default: 0
    },
    remaining: {
      type: Number,
      default: 0
    }
  },
  environmentVariables: {
    type: Map,
    of: String,
    default: new Map()
  },
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'auto'],
      default: 'auto'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      slack: {
        type: Boolean,
        default: false
      }
    }
  }
}, {
  timestamps: true
});

// Indexes
settingsSchema.index({ userId: 1, type: 1 }, { unique: true });

// Methods
settingsSchema.methods.updateCredits = function(used) {
  this.credits.used += used;
  this.credits.remaining = this.credits.total - this.credits.used;
  return this.save();
};

settingsSchema.methods.setEnvVar = function(key, value) {
  this.environmentVariables.set(key, value);
  return this.save();
};

settingsSchema.methods.getEnvVar = function(key) {
  return this.environmentVariables.get(key);
};

settingsSchema.methods.removeEnvVar = function(key) {
  this.environmentVariables.delete(key);
  return this.save();
};

module.exports = mongoose.model('Settings', settingsSchema);

