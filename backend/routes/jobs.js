const express = require('express');
const Job = require('../models/Job');
const createTerraformQueue = require('../queues/terraformQueue');
const createSandboxQueue = require('../queues/sandboxQueue');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get job by ID
router.get('/:jobId', async (req, res, next) => {
  try {
    const job = await Job.findOne({ jobId: req.params.jobId });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Job not found'
        }
      });
    }

    res.json({
      success: true,
      data: { job }
    });
  } catch (error) {
    next(error);
  }
});

// Get all jobs
router.get('/', async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;

    const jobs = await Job.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments(query);

    res.json({
      success: true,
      data: {
        jobs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Cancel job
router.post('/:jobId/cancel', async (req, res, next) => {
  try {
    const job = await Job.findOne({ jobId: req.params.jobId });

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Job not found'
        }
      });
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OPERATION',
          message: 'Cannot cancel completed or failed job'
        }
      });
    }

    // Cancel in queue
    let queue;
    if (job.type.startsWith('terraform_')) {
      queue = await createTerraformQueue();
    } else if (job.type.startsWith('sandbox_')) {
      queue = await createSandboxQueue();
    }

    if (queue) {
      const bullJob = await queue.getJob(req.params.jobId);
      if (bullJob) {
        await bullJob.remove();
      }
    }

    // Update job record
    job.status = 'cancelled';
    job.completedAt = new Date();
    await job.save();

    res.json({
      success: true,
      message: 'Job cancelled'
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

