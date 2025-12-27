const axios = require('axios');
const logger = require('../utils/logger');

/**
 * GitHub Service
 * Handles GitHub API operations for repository management, code commits, and Actions
 * Falls back to REST API if GitHub MCP server is not available
 */
class GitHubService {
  constructor() {
    this.apiBase = process.env.GITHUB_API_BASE_URL || 'https://api.github.com';
    this.token = process.env.GITHUB_TOKEN;
    this.appId = process.env.GITHUB_APP_ID;
    this.appPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    
    // Create axios instance with default headers
    this.client = axios.create({
      baseURL: this.apiBase,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Deployment-Agent'
      }
    });
    
    // Add auth token if available
    if (this.token) {
      this.client.defaults.headers.common['Authorization'] = `token ${this.token}`;
    }
  }

  /**
   * Parse repository URL to extract owner and repo
   */
  parseRepositoryUrl(repoUrl) {
    try {
      // Handle various formats: https://github.com/owner/repo, git@github.com:owner/repo.git, owner/repo
      let match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!match) {
        // Try owner/repo format
        match = repoUrl.match(/^([^/]+)\/([^/]+)$/);
      }
      
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace('.git', '')
        };
      }
      
      throw new Error(`Invalid repository URL: ${repoUrl}`);
    } catch (error) {
      logger.error('Failed to parse repository URL:', error);
      throw error;
    }
  }

  /**
   * Get a client instance with optional token
   */
  getClient(token = null) {
    const client = axios.create({
      baseURL: this.apiBase,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Deployment-Agent'
      }
    });
    
    // Use provided token, fallback to instance token, then env token
    const authToken = token || this.token || process.env.GITHUB_TOKEN;
    if (authToken) {
      client.defaults.headers.common['Authorization'] = `token ${authToken}`;
    }
    
    return client;
  }

  /**
   * Get repository information
   */
  async getRepository(owner, repo, token = null) {
    try {
      const client = this.getClient(token);
      const authToken = token || this.token || process.env.GITHUB_TOKEN;
      
      if (!authToken) {
        throw new Error(`No GitHub token provided. Please provide a GitHub Personal Access Token to access repository ${owner}/${repo}.`);
      }
      
      const response = await client.get(`/repos/${owner}/${repo}`);
      return response.data;
    } catch (error) {
      // If it's already our custom error, rethrow it
      if (error.message && error.message.includes('No GitHub token')) {
        throw error;
      }
      
      if (error.response?.status === 404) {
        // 404 could mean repository doesn't exist OR token doesn't have access (GitHub security)
        const authToken = token || this.token || process.env.GITHUB_TOKEN;
        if (!authToken) {
          throw new Error(`Repository ${owner}/${repo} not found or not accessible. Please provide a GitHub token.`);
        }
        throw new Error(`Repository ${owner}/${repo} not found or you don't have access. Please check your GitHub token permissions.`);
      }
      if (error.response?.status === 403) {
        throw new Error(`Access denied to repository ${owner}/${repo}. Please check your GitHub token permissions.`);
      }
      if (error.response?.status === 401) {
        throw new Error(`Authentication failed for repository ${owner}/${repo}. Please provide a valid GitHub token.`);
      }
      logger.error('Failed to get repository:', error);
      throw error;
    }
  }

  /**
   * List user repositories
   */
  async listRepositories(user = null, token = null) {
    try {
      // Check if token is provided
      const authToken = token || this.token || process.env.GITHUB_TOKEN;
      if (!authToken) {
        throw new Error('GitHub Personal Access Token is required to list repositories. Please provide a token or set GITHUB_TOKEN environment variable.');
      }
      
      // Use getClient to ensure proper authentication
      const client = this.getClient(token);
      const endpoint = user ? `/users/${user}/repos` : '/user/repos';
      const response = await client.get(endpoint, {
        params: {
          per_page: 100,
          sort: 'updated',
          type: 'all'
        }
      });
      return response.data;
    } catch (error) {
      // If it's already our custom error, rethrow it
      if (error.message && error.message.includes('GitHub Personal Access Token')) {
        throw error;
      }
      
      if (error.response?.status === 401) {
        throw new Error('Authentication failed. Please provide a valid GitHub Personal Access Token.');
      }
      logger.error('Failed to list repositories:', error);
      throw error;
    }
  }

  /**
   * Get repository contents (file or directory)
   */
  async getContents(owner, repo, path = '', ref = null, token = null) {
    try {
      const client = this.getClient(token);
      const params = ref ? { ref } : {};
      const response = await client.get(`/repos/${owner}/${repo}/contents/${path}`, { params });
      return response.data;
    } catch (error) {
      // Don't log 404 errors - they're expected when files don't exist
      if (error.response?.status === 404) {
        const notFoundError = new Error(`Not found: ${path}`);
        notFoundError.response = error.response;
        notFoundError.isNotFound = true;
        throw notFoundError;
      }
      
      // Don't log rate limit errors - they're expected
      if (error.response?.status === 403 && error.response?.data?.message?.includes('rate limit')) {
        const rateLimitError = new Error('GitHub API rate limit exceeded');
        rateLimitError.response = error.response;
        rateLimitError.isRateLimit = true;
        throw rateLimitError;
      }
      
      // Only log unexpected errors
      if (error.response?.status !== 404 && error.response?.status !== 403) {
        logger.error(`Failed to get contents for ${path}:`, {
          status: error.response?.status,
          message: error.message
        });
      }
      throw error;
    }
  }

  /**
   * Read a file from repository
   */
  async readFile(owner, repo, path, ref = null, token = null) {
    try {
      const contents = await this.getContents(owner, repo, path, ref, token);
      if (contents.type !== 'file') {
        throw new Error(`${path} is not a file`);
      }
      
      // Decode base64 content
      const content = Buffer.from(contents.content, 'base64').toString('utf-8');
      return {
        content,
        sha: contents.sha,
        size: contents.size,
        encoding: contents.encoding
      };
    } catch (error) {
      // Re-throw 404 and rate limit errors without logging
      if (error.isNotFound || error.isRateLimit) {
        throw error;
      }
      
      // Only log unexpected errors
      if (error.response?.status !== 404 && error.response?.status !== 403) {
        logger.error(`Failed to read file ${path}:`, {
          status: error.response?.status,
          message: error.message
        });
      }
      throw error;
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(owner, repo, path = '', ref = null) {
    try {
      const contents = await this.getContents(owner, repo, path, ref);
      if (!Array.isArray(contents)) {
        return [contents];
      }
      return contents;
    } catch (error) {
      logger.error(`Failed to list files in ${path}:`, error);
      throw error;
    }
  }

  /**
   * Get repository tree (recursive)
   */
  async getTree(owner, repo, sha = null, token = null) {
    try {
      const client = this.getClient(token);
      if (!sha) {
        // Get default branch
        const repoInfo = await this.getRepository(owner, repo, token);
        sha = repoInfo.default_branch;
      }
      
      // Get commit SHA
      const commitResponse = await client.get(`/repos/${owner}/${repo}/commits/${sha}`);
      const treeSha = commitResponse.data.commit.tree.sha;
      
      // Get tree recursively
      const treeResponse = await client.get(`/repos/${owner}/${repo}/git/trees/${treeSha}`, {
        params: { recursive: 1 }
      });
      
      return treeResponse.data.tree;
    } catch (error) {
      logger.error('Failed to get repository tree:', error);
      throw error;
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(owner, repo, branchName, fromBranch = 'main', token = null) {
    try {
      const client = token ? this.getClient(token) : this.client;
      
      // Get SHA of the branch to branch from
      const refResponse = await client.get(`/repos/${owner}/${repo}/git/refs/heads/${fromBranch}`);
      const sha = refResponse.data.object.sha;
      
      // Create new branch
      await client.post(`/repos/${owner}/${repo}/git/refs`, {
        ref: `refs/heads/${branchName}`,
        sha
      });
      
      logger.info(`Created branch ${branchName} from ${fromBranch}`);
      return { branch: branchName, sha };
    } catch (error) {
      if (error.response?.status === 422) {
        throw new Error(`Branch ${branchName} already exists`);
      }
      logger.error('Failed to create branch:', error);
      throw error;
    }
  }

  /**
   * Create a commit with multiple files
   */
  async createCommit(owner, repo, branch, files, message, author = null, token = null) {
    try {
      const client = token ? this.getClient(token) : this.client;
      
      // Get current tree SHA
      const refResponse = await client.get(`/repos/${owner}/${repo}/git/refs/heads/${branch}`);
      const baseSha = refResponse.data.object.sha;
      
      const commitResponse = await client.get(`/repos/${owner}/${repo}/git/commits/${baseSha}`);
      const baseTreeSha = commitResponse.data.tree.sha;
      
      // Create blobs for each file
      const tree = [];
      for (const file of files) {
        const blobResponse = await client.post(`/repos/${owner}/${repo}/git/blobs`, {
          content: file.content,
          encoding: 'utf-8'
        });
        
        tree.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobResponse.data.sha
        });
      }
      
      // Create tree
      const treeResponse = await client.post(`/repos/${owner}/${repo}/git/trees`, {
        base_tree: baseTreeSha,
        tree
      });
      
      // Create commit
      const commitData = {
        message,
        tree: treeResponse.data.sha,
        parents: [baseSha]
      };
      
      if (author) {
        commitData.author = author;
        commitData.committer = author;
      }
      
      const newCommitResponse = await client.post(`/repos/${owner}/${repo}/git/commits`, commitData);
      
      // Update branch reference
      await client.patch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
        sha: newCommitResponse.data.sha
      });
      
      logger.info(`Created commit ${newCommitResponse.data.sha} on branch ${branch}`);
      return {
        sha: newCommitResponse.data.sha,
        url: newCommitResponse.data.html_url
      };
    } catch (error) {
      logger.error('Failed to create commit:', error);
      throw error;
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(owner, repo, title, head, base, body = '', token = null) {
    try {
      const client = token ? this.getClient(token) : this.client;
      const response = await client.post(`/repos/${owner}/${repo}/pulls`, {
        title,
        head,
        base,
        body
      });
      
      logger.info(`Created PR #${response.data.number}: ${title}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to create pull request:', error);
      throw error;
    }
  }

  /**
   * Trigger a GitHub Actions workflow
   */
  async triggerWorkflow(owner, repo, workflowId, ref = 'main', inputs = {}) {
    try {
      const response = await this.client.post(
        `/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`,
        {
          ref,
          inputs
        }
      );
      
      logger.info(`Triggered workflow ${workflowId} on ${ref}`);
      return { success: true, status: response.status };
    } catch (error) {
      logger.error('Failed to trigger workflow:', error);
      throw error;
    }
  }

  /**
   * List workflows in repository
   */
  async listWorkflows(owner, repo) {
    try {
      const response = await this.client.get(`/repos/${owner}/${repo}/actions/workflows`);
      return response.data.workflows;
    } catch (error) {
      logger.error('Failed to list workflows:', error);
      throw error;
    }
  }

  /**
   * Get workflow run status
   */
  async getWorkflowRun(owner, repo, runId) {
    try {
      const response = await this.client.get(`/repos/${owner}/${repo}/actions/runs/${runId}`);
      return response.data;
    } catch (error) {
      logger.error('Failed to get workflow run:', error);
      throw error;
    }
  }

  /**
   * List workflow runs
   */
  async listWorkflowRuns(owner, repo, workflowId = null, branch = null) {
    try {
      const endpoint = workflowId
        ? `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs`
        : `/repos/${owner}/${repo}/actions/runs`;
      
      const params = {};
      if (branch) params.branch = branch;
      
      const response = await this.client.get(endpoint, { params });
      return response.data.workflow_runs;
    } catch (error) {
      logger.error('Failed to list workflow runs:', error);
      throw error;
    }
  }

  /**
   * Check if repository exists and is accessible
   */
  async checkRepositoryAccess(repoUrl, token = null) {
    try {
      const { owner, repo } = this.parseRepositoryUrl(repoUrl);
      await this.getRepository(owner, repo, token);
      return { accessible: true, owner, repo };
    } catch (error) {
      return { accessible: false, error: error.message };
    }
  }
}

module.exports = new GitHubService();

