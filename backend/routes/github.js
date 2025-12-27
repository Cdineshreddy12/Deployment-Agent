const express = require('express');
const githubService = require('../services/githubService');
const githubAnalysis = require('../services/githubAnalysis');
const credentialManager = require('../services/credentialManager');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const logger = require('../utils/logger');
const Repository = require('../models/Repository');
const CodeAnalysis = require('../models/CodeAnalysis');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * Helper function to get GitHub token from various sources
 * Priority: request > database > environment
 */
async function getGitHubToken(req) {
  // First, check if token is provided in request
  const requestToken = req.query.githubToken || req.body.githubToken || req.headers['x-github-token'];
  if (requestToken) {
    return requestToken;
  }
  
  // Second, try to get from database
  try {
    const dbToken = await credentialManager.getGitHubToken(req.user._id);
    if (dbToken) {
      return dbToken;
    }
  } catch (error) {
    logger.warn('Failed to get GitHub token from database:', error);
  }
  
  // Finally, fallback to environment variable
  return process.env.GITHUB_TOKEN || null;
}

/**
 * Save or update GitHub token
 * POST /api/v1/github/token
 */
router.post('/token', requirePermission('credentials.create'), async (req, res, next) => {
  try {
    const { token, name, description } = req.body;
    
    if (!token || !token.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'GitHub token is required'
        }
      });
    }

    // Validate token by trying to list repositories
    try {
      await githubService.listRepositories(null, token);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_INVALID',
          message: error.message || 'Invalid GitHub token. Please check your token and try again.'
        }
      });
    }

    // Store token in database
    const credential = await credentialManager.storeGitHubToken(
      req.user._id,
      token,
      {
        name: name || 'GitHub Personal Access Token',
        description: description || 'GitHub Personal Access Token for repository access'
      }
    );
    
    res.json({
      success: true,
      data: {
        message: 'GitHub token saved successfully',
        credential: {
          _id: credential._id,
          name: credential.name,
          createdAt: credential.createdAt
        }
      }
    });
  } catch (error) {
    logger.error('Failed to save GitHub token:', error);
    next(error);
  }
});

/**
 * Get GitHub token status (without exposing the token)
 * GET /api/v1/github/token
 */
router.get('/token', requirePermission('credentials.read'), async (req, res, next) => {
  try {
    const hasToken = await credentialManager.hasGitHubToken(req.user._id);
    
    res.json({
      success: true,
      data: {
        hasToken,
        message: hasToken 
          ? 'GitHub token is configured' 
          : 'No GitHub token found. Please configure your token to access repositories.'
      }
    });
  } catch (error) {
    logger.error('Failed to check GitHub token:', error);
    next(error);
  }
});

/**
 * Delete GitHub token
 * DELETE /api/v1/github/token
 */
router.delete('/token', requirePermission('credentials.delete'), async (req, res, next) => {
  try {
    const deleted = await credentialManager.deleteGitHubToken(req.user._id);
    
    res.json({
      success: true,
      data: {
        message: deleted 
          ? 'GitHub token deleted successfully' 
          : 'No GitHub token found to delete'
      }
    });
  } catch (error) {
    logger.error('Failed to delete GitHub token:', error);
    next(error);
  }
});

/**
 * Connect GitHub account / List repositories
 * GET /api/v1/github/repositories
 */
router.get('/repositories', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    // Get token using helper function (checks request > database > environment)
    const token = await getGitHubToken(req);
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: 'GitHub Personal Access Token is required to list repositories. Please save your token using the GitHub settings or provide it in the request.'
        }
      });
    }
    
    const repositories = await githubService.listRepositories(null, token);
    
    res.json({
      success: true,
      data: {
        repositories: repositories.map(repo => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          url: repo.html_url,
          description: repo.description,
          language: repo.language,
          defaultBranch: repo.default_branch,
          private: repo.private,
          updatedAt: repo.updated_at
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to list repositories:', error);
    
    // Handle authentication errors gracefully
    if (error.message && error.message.includes('Authentication failed')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_INVALID',
          message: error.message
        }
      });
    }
    
    if (error.message && error.message.includes('GitHub Personal Access Token')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: error.message
        }
      });
    }
    
    next(error);
  }
});

/**
 * Analyze repository
 * POST /api/v1/github/analyze
 */
router.post('/analyze', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { repositoryUrl, branch, deploymentId, githubToken } = req.body;
    
    if (!repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'repositoryUrl is required'
        }
      });
    }
    
    // Get token from request, deployment, database, or environment
    let token = githubToken;
    if (!token && deploymentId) {
      const Deployment = require('../models/Deployment');
      const deployment = await Deployment.findOne({ deploymentId });
      if (deployment && deployment.githubToken) {
        token = deployment.githubToken;
      }
    }
    // If still no token, use helper function (checks database > environment)
    if (!token) {
      token = await getGitHubToken(req);
    }
    
    // Check if token is provided (before making API call)
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: 'GitHub Personal Access Token is required to access repositories. Please save your token using the GitHub settings or provide it in the request.'
        }
      });
    }
    
    // Check repository access
    const accessCheck = await githubService.checkRepositoryAccess(repositoryUrl, token);
    if (!accessCheck.accessible) {
      // Determine appropriate status code based on error message
      // Use 400 for invalid token, 404 for not found, 403 for access denied
      // Never use 401 as that triggers logout in frontend
      let statusCode = 403;
      let errorCode = 'REPOSITORY_ACCESS_DENIED';
      
      if (accessCheck.error && accessCheck.error.includes('not found')) {
        statusCode = 404;
        errorCode = 'REPOSITORY_NOT_FOUND';
      } else if (accessCheck.error && accessCheck.error.includes('Authentication failed')) {
        statusCode = 400; // Bad Request - invalid token (not auth failure)
        errorCode = 'GITHUB_TOKEN_INVALID';
      }
      
      return res.status(statusCode).json({
        success: false,
        error: {
          code: errorCode,
          message: `Cannot access repository: ${accessCheck.error}`
        }
      });
    }
    
    // Analyze repository
    const analysis = await githubAnalysis.analyzeRepository(repositoryUrl, branch, token);
    
    // Store or update repository record
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    await Repository.findOneAndUpdate(
      { owner, repo },
      {
        url: repositoryUrl,
        owner,
        repo,
        defaultBranch: analysis.repository.defaultBranch,
        description: analysis.repository.description,
        language: analysis.repository.language,
        topics: analysis.repository.topics,
        userId: req.user._id,
        lastAnalyzedAt: new Date(),
        analysisCache: analysis
      },
      { upsert: true, new: true }
    );
    
    // Store code analysis if deploymentId provided
    if (deploymentId) {
      try {
        // Ensure filesAnalyzed is properly formatted as array of objects
        const fileTypes = analysis.structure?.fileTypes || {};
        
        // Convert fileTypes object to array of objects
        let filesAnalyzed = [];
        
        // Handle case where fileTypes might be a string (shouldn't happen, but defensive)
        if (typeof fileTypes === 'string') {
          logger.warn('fileTypes is a string, skipping conversion', { deploymentId, fileTypes });
          filesAnalyzed = [];
        } else if (Array.isArray(fileTypes)) {
          // Already an array - validate and ensure proper structure
          filesAnalyzed = fileTypes.filter(item => {
            return item && 
                   typeof item === 'object' && 
                   !Array.isArray(item) &&
                   typeof item.path === 'string' && 
                   typeof item.type === 'string' &&
                   (typeof item.size === 'number' || item.size === undefined);
          }).map(item => ({
            path: String(item.path || ''),
            type: String(item.type || ''),
            size: typeof item.size === 'number' ? item.size : 0
          }));
        } else if (fileTypes && typeof fileTypes === 'object' && !Array.isArray(fileTypes)) {
          // Convert object to array
          filesAnalyzed = Object.keys(fileTypes).map(ext => {
            const size = fileTypes[ext];
            return {
              path: `*.${String(ext)}`,
              type: String(ext),
              size: typeof size === 'number' ? size : (parseInt(size) || 0)
            };
          }).filter(item => {
            // Validate each item
            return item && 
                   typeof item === 'object' && 
                   !Array.isArray(item) &&
                   typeof item.path === 'string' && 
                   typeof item.type === 'string' &&
                   typeof item.size === 'number';
          });
        }
        
        // Ensure filesAnalyzed is always an array of valid objects
        if (!Array.isArray(filesAnalyzed)) {
          logger.warn('filesAnalyzed is not an array after conversion, defaulting to empty array', { 
            deploymentId, 
            fileTypes,
            filesAnalyzedType: typeof filesAnalyzed 
          });
          filesAnalyzed = [];
        }
        
        // Double-check: ensure all items are plain objects, not strings or other types
        filesAnalyzed = filesAnalyzed.filter(item => {
          return item && 
                 typeof item === 'object' && 
                 !Array.isArray(item) &&
                 item.constructor === Object &&
                 typeof item.path === 'string' && 
                 typeof item.type === 'string' &&
                 typeof item.size === 'number';
        });
        
        // Prepare update data with validated filesAnalyzed
        const updateData = {
          deploymentId,
          repositoryUrl,
          analysis: analysis.codeAnalysis || {},
          filesAnalyzed: filesAnalyzed, // Always an array now
          analyzedAt: new Date()
        };
        
        // Use setDefaultsOnInsert to ensure proper defaults
        await CodeAnalysis.findOneAndUpdate(
          { deploymentId },
          updateData,
          { 
            upsert: true, 
            new: true, 
            runValidators: true,
            setDefaultsOnInsert: true
          }
      );
      } catch (error) {
        logger.error('Failed to save code analysis:', {
          deploymentId,
          error: error.message,
          stack: error.stack,
          errorName: error.name
        });
        // Don't fail the whole request if code analysis save fails
      }
    }
    
    res.json({
      success: true,
      data: {
        analysis
      }
    });
  } catch (error) {
    logger.error('Failed to analyze repository:', error);
    next(error);
  }
});

/**
 * Commit Terraform code to repository
 * POST /api/v1/github/commit
 */
router.post('/commit', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, repositoryUrl, branch, createPR } = req.body;
    
    if (!deploymentId || !repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId and repositoryUrl are required'
        }
      });
    }
    
    // Get deployment Terraform code
    const Deployment = require('../models/Deployment');
    const deployment = await Deployment.findOne({ deploymentId });
    
    if (!deployment || !deployment.terraformCode) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Deployment or Terraform code not found'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    const targetBranch = branch || deployment.repositoryBranch || 'main';
    
    // Create deployment branch
    const branchName = `deployment/${deploymentId}-${Date.now()}`;
    await githubService.createBranch(owner, repo, branchName, targetBranch);
    
    // Prepare files to commit
    const files = [];
    if (deployment.terraformCode.main) {
      files.push({
        path: 'terraform/main.tf',
        content: deployment.terraformCode.main
      });
    }
    if (deployment.terraformCode.variables) {
      files.push({
        path: 'terraform/variables.tf',
        content: deployment.terraformCode.variables
      });
    }
    if (deployment.terraformCode.outputs) {
      files.push({
        path: 'terraform/outputs.tf',
        content: deployment.terraformCode.outputs
      });
    }
    if (deployment.terraformCode.providers) {
      files.push({
        path: 'terraform/providers.tf',
        content: deployment.terraformCode.providers
      });
    }
    
    // Create commit
    const commitMessage = `Deploy infrastructure for ${deployment.name}\n\nDeployment ID: ${deploymentId}\nEnvironment: ${deployment.environment}`;
    const commitResult = await githubService.createCommit(
      owner,
      repo,
      branchName,
      files,
      commitMessage,
      {
        name: deployment.userName,
        email: deployment.userEmail,
        date: new Date().toISOString()
      }
    );
    
    // Create pull request if requested
    let prResult = null;
    if (createPR) {
      prResult = await githubService.createPullRequest(
        owner,
        repo,
        `Deploy: ${deployment.name}`,
        branchName,
        targetBranch,
        `Infrastructure deployment for ${deployment.name}\n\n**Deployment ID:** ${deploymentId}\n**Environment:** ${deployment.environment}\n**Region:** ${deployment.region}`
      );
    }
    
    // Update deployment
    await Deployment.findOneAndUpdate(
      { deploymentId },
      {
        githubCommitSha: commitResult.sha,
        repositoryUrl,
        repositoryBranch: branchName,
        githubPullRequestUrl: prResult?.html_url
      }
    );
    
    res.json({
      success: true,
      data: {
        commit: {
          sha: commitResult.sha,
          url: commitResult.url
        },
        branch: branchName,
        pullRequest: prResult ? {
          number: prResult.number,
          url: prResult.html_url
        } : null
      }
    });
  } catch (error) {
    logger.error('Failed to commit to repository:', error);
    next(error);
  }
});

/**
 * Trigger GitHub Actions workflow
 * POST /api/v1/github/actions/trigger
 */
router.post('/actions/trigger', requirePermission('deployments.create'), async (req, res, next) => {
  try {
    const { deploymentId, repositoryUrl, workflowId, ref, inputs } = req.body;
    
    if (!deploymentId || !repositoryUrl || !workflowId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'deploymentId, repositoryUrl, and workflowId are required'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    const targetRef = ref || 'main';
    
    // Trigger workflow
    const result = await githubService.triggerWorkflow(owner, repo, workflowId, targetRef, inputs || {});
    
    // Get workflow runs to find the triggered run
    const runs = await githubService.listWorkflowRuns(owner, repo, workflowId, targetRef);
    const latestRun = runs[0];
    
    // Update deployment
    const Deployment = require('../models/Deployment');
    await Deployment.findOneAndUpdate(
      { deploymentId },
      {
        githubActionsRunId: latestRun?.id?.toString()
      }
    );
    
    res.json({
      success: true,
      data: {
        workflowRun: latestRun ? {
          id: latestRun.id,
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          url: latestRun.html_url
        } : null
      }
    });
  } catch (error) {
    logger.error('Failed to trigger workflow:', error);
    next(error);
  }
});

/**
 * Get workflow status
 * GET /api/v1/github/actions/status/:runId
 */
router.get('/actions/status/:runId', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { runId } = req.params;
    const { repositoryUrl } = req.query;
    
    if (!repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'repositoryUrl is required'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    const run = await githubService.getWorkflowRun(owner, repo, runId);
    
    res.json({
      success: true,
      data: {
        run: {
          id: run.id,
          status: run.status,
          conclusion: run.conclusion,
          url: run.html_url,
          createdAt: run.created_at,
          updatedAt: run.updated_at
        }
      }
    });
  } catch (error) {
    logger.error('Failed to get workflow status:', error);
    next(error);
  }
});

/**
 * List workflows in repository
 * GET /api/v1/github/workflows
 */
router.get('/workflows', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { repositoryUrl } = req.query;
    
    if (!repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'repositoryUrl is required'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    const workflows = await githubService.listWorkflows(owner, repo);
    
    res.json({
      success: true,
      data: {
        workflows: workflows.map(wf => ({
          id: wf.id,
          name: wf.name,
          path: wf.path,
          state: wf.state,
          url: wf.html_url
        }))
      }
    });
  } catch (error) {
    logger.error('Failed to list workflows:', error);
    next(error);
  }
});

/**
 * Get complete repository folder structure as a tree
 * GET /api/v1/github/tree
 */
router.get('/tree', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { repositoryUrl, branch } = req.query;
    
    if (!repositoryUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'repositoryUrl is required'
        }
      });
    }
    
    // Get token from request, database, or environment
    const token = await getGitHubToken(req);
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: 'GitHub Personal Access Token is required to access repository tree.'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    
    // Get repository info for default branch
    const repoInfo = await githubService.getRepository(owner, repo, token);
    const targetBranch = branch || repoInfo.default_branch;
    
    // Get full tree recursively
    const tree = await githubService.getTree(owner, repo, targetBranch, token);
    
    // Transform flat tree to nested structure compatible with FolderTreeView
    const nestedTree = buildNestedTree(tree);
    
    // Also extract list of files and directories
    const files = tree.filter(item => item.type === 'blob').map(item => ({
      path: item.path,
      name: item.path.split('/').pop(),
      type: 'file',
      size: item.size || 0,
      extension: item.path.includes('.') ? item.path.split('.').pop() : null
    }));
    
    const directories = tree.filter(item => item.type === 'tree').map(item => ({
      path: item.path,
      name: item.path.split('/').pop(),
      type: 'directory'
    }));
    
    // Detect .env files for credential import
    const envFiles = files.filter(f => 
      f.name.startsWith('.env') || 
      f.name === 'env.example' || 
      f.name === 'env.template'
    );
    
    res.json({
      success: true,
      data: {
        repository: {
          owner,
          repo,
          branch: targetBranch,
          url: repositoryUrl
        },
        tree: nestedTree,
        files,
        directories,
        envFiles,
        totalFiles: files.length,
        totalDirectories: directories.length
      }
    });
  } catch (error) {
    logger.error('Failed to get repository tree:', error);
    
    if (error.message && error.message.includes('Authentication failed')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_INVALID',
          message: error.message
        }
      });
    }
    
    next(error);
  }
});

/**
 * Read a single file from a GitHub repository
 * POST /api/v1/github/read-file
 */
router.post('/read-file', requirePermission('deployments.read'), async (req, res, next) => {
  try {
    const { repositoryUrl, filePath, branch } = req.body;
    
    if (!repositoryUrl || !filePath) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'repositoryUrl and filePath are required'
        }
      });
    }
    
    const token = await getGitHubToken(req);
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'GITHUB_TOKEN_REQUIRED',
          message: 'GitHub Personal Access Token is required to read file.'
        }
      });
    }
    
    const { owner, repo } = githubService.parseRepositoryUrl(repositoryUrl);
    
    const fileData = await githubService.readFile(owner, repo, filePath, branch || null, token);
    
    res.json({
      success: true,
      data: {
        filePath,
        content: fileData.content,
        sha: fileData.sha,
        size: fileData.size
      }
    });
  } catch (error) {
    logger.error('Failed to read file from GitHub:', error);
    
    if (error.isNotFound) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FILE_NOT_FOUND',
          message: `File not found: ${req.body.filePath}`
        }
      });
    }
    
    next(error);
  }
});

/**
 * Build nested tree structure from flat GitHub tree
 * Compatible with FolderTreeView component format
 */
function buildNestedTree(flatTree) {
  const result = {};
  
  // Sort to ensure directories are created before their contents
  const sorted = flatTree.sort((a, b) => a.path.localeCompare(b.path));
  
  for (const item of sorted) {
    const parts = item.path.split('/');
    let current = result;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      if (isLast) {
        if (item.type === 'tree') {
          // Directory
          if (!current[part]) {
            current[part] = { _type: 'directory', _children: {} };
          }
        } else {
          // File
          const extension = part.includes('.') ? part.split('.').pop() : null;
          current[part] = {
            _type: 'file',
            path: item.path,
            name: part,
            size: item.size || 0,
            extension,
            sha: item.sha
          };
        }
      } else {
        // Intermediate directory
        if (!current[part]) {
          current[part] = { _type: 'directory', _children: {} };
        }
        current = current[part]._children;
      }
    }
  }
  
  return result;
}

module.exports = router;

