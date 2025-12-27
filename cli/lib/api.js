const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

class APIClient {
  constructor() {
    this.baseURL = process.env.DEPLOYMENT_AGENT_API_URL || 'http://localhost:5000';
    this.token = null;
    this.configPath = path.join(os.homedir(), '.deployment-agent', 'config.json');
  }

  /**
   * Load configuration from file
   */
  async loadConfig() {
    try {
      if (await fs.pathExists(this.configPath)) {
        const config = await fs.readJson(this.configPath);
        this.token = config.token;
        if (config.apiUrl) {
          this.baseURL = config.apiUrl;
        }
        return config;
      }
      return {};
    } catch (error) {
      // Config file doesn't exist or is invalid
      return {};
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config) {
    const configDir = path.dirname(this.configPath);
    await fs.ensureDir(configDir);
    await fs.writeJson(this.configPath, config, { spaces: 2 });
  }

  /**
   * Set authentication token
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * Get axios instance with auth headers
   */
  getClient() {
    const client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add auth token if available
    if (this.token) {
      client.defaults.headers.common['Authorization'] = `Bearer ${this.token}`;
    }

    // Add API key if available
    if (process.env.DEPLOYMENT_AGENT_API_KEY) {
      client.defaults.headers.common['X-API-Key'] = process.env.DEPLOYMENT_AGENT_API_KEY;
    }

    return client;
  }

  /**
   * Make authenticated request
   */
  async request(method, endpoint, data = null, options = {}) {
    await this.loadConfig();
    const client = this.getClient();

    try {
      const config = {
        method,
        url: endpoint,
        ...options
      };

      if (data) {
        if (method === 'GET') {
          config.params = data;
        } else {
          config.data = data;
        }
      }

      const response = await client.request(config);
      return response.data;
    } catch (error) {
      if (error.response) {
        const apiError = new Error(error.response.data?.error?.message || error.message);
        apiError.status = error.response.status;
        apiError.data = error.response.data;
        throw apiError;
      }
      throw error;
    }
  }

  // Convenience methods
  async get(endpoint, params = {}) {
    return this.request('GET', endpoint, params);
  }

  async post(endpoint, data = {}) {
    return this.request('POST', endpoint, data);
  }

  async put(endpoint, data = {}) {
    return this.request('PUT', endpoint, data);
  }

  async patch(endpoint, data = {}) {
    return this.request('PATCH', endpoint, data);
  }

  async delete(endpoint) {
    return this.request('DELETE', endpoint);
  }
}

module.exports = new APIClient();

