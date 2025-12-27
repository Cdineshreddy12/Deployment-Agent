const { Client } = require('ssh2');
const fs = require('fs');
const readline = require('readline');
const logger = require('./logger');

class SSHClient {
  /**
   * Create SSH connection
   */
  async connect(config) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      
      conn.on('ready', () => {
        resolve(conn);
      });

      conn.on('error', (err) => {
        reject(err);
      });

      // Prepare connection config
      const connectConfig = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        readyTimeout: config.timeout || 20000
      };

      // Add authentication method
      if (config.privateKey) {
        connectConfig.privateKey = fs.readFileSync(config.privateKey);
      } else if (config.password) {
        connectConfig.password = config.password;
      } else {
        // Try to use default SSH key
        const defaultKeyPath = `${process.env.HOME}/.ssh/id_rsa`;
        if (fs.existsSync(defaultKeyPath)) {
          connectConfig.privateKey = fs.readFileSync(defaultKeyPath);
        } else {
          reject(new Error('No authentication method provided'));
          return;
        }
      }

      conn.connect(connectConfig);
    });
  }

  /**
   * Execute command on remote host
   */
  async exec(conn, command) {
    return new Promise((resolve, reject) => {
      conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('close', (code, signal) => {
          resolve({
            code,
            signal,
            stdout,
            stderr
          });
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Start interactive shell
   */
  async shell(conn) {
    return new Promise((resolve, reject) => {
      conn.shell((err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        // Create readline interface for input
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        // Pipe stream to stdout
        stream.pipe(process.stdout);
        process.stdin.pipe(stream);

        // Handle exit
        stream.on('close', () => {
          rl.close();
          resolve();
        });

        stream.on('error', (err) => {
          rl.close();
          reject(err);
        });

        resolve(stream);
      });
    });
  }

  /**
   * Upload file to remote host
   */
  async uploadFile(conn, localPath, remotePath) {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }

  /**
   * Download file from remote host
   */
  async downloadFile(conn, remotePath, localPath) {
    return new Promise((resolve, reject) => {
      conn.sftp((err, sftp) => {
        if (err) {
          reject(err);
          return;
        }

        sftp.fastGet(remotePath, localPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    });
  }
}

module.exports = new SSHClient();





