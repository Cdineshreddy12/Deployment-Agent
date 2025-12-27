const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * README Template Schema
 * Caches README templates for cost optimization
 */
const readmeTemplateSchema = new mongoose.Schema({
  templateId: {
    type: String,
    required: true,
    unique: true,
    default: () => `tpl_${uuidv4().replace(/-/g, '')}`
  },
  name: {
    type: String,
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['dockerfile', 'docker-compose', 'config', 'iac', 'other'],
    required: true,
    index: true
  },
  template: {
    type: String,
    required: true
  },
  variables: [{
    name: String,
    description: String,
    required: {
      type: Boolean,
      default: true
    },
    defaultValue: String
  }],
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Indexes
readmeTemplateSchema.index({ category: 1, name: 1 });
readmeTemplateSchema.index({ usageCount: -1 });
readmeTemplateSchema.index({ lastUsedAt: -1 });

// Methods
readmeTemplateSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  this.lastUsedAt = new Date();
  return this.save();
};

readmeTemplateSchema.methods.render = function(variables = {}) {
  let rendered = this.template;
  
  // Replace variables in template
  for (const variable of this.variables) {
    const value = variables[variable.name] || variable.defaultValue || '';
    const regex = new RegExp(`\\{\\{${variable.name}\\}\\}`, 'g');
    rendered = rendered.replace(regex, value);
  }
  
  return rendered;
};

const ReadmeTemplate = mongoose.model('ReadmeTemplate', readmeTemplateSchema);

module.exports = ReadmeTemplate;

