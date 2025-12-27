class WebSocketService {
  constructor() {
    this.ws = null;
    this.cliWs = null; // Separate WebSocket for CLI logs
    this.listeners = new Map();
    this.cliListeners = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  connect(deploymentId) {
    const token = localStorage.getItem('token');
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5002';
    const url = `${wsUrl}/ws/deployments/${deploymentId}?token=${token}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.notifyListeners(data.type, data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect(deploymentId);
    };
  }

  attemptReconnect(deploymentId) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connect(deploymentId);
      }, 1000 * this.reconnectAttempts);
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  notifyListeners(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        callback(data);
      });
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Connect to CLI log streaming WebSocket
   */
  connectCLILogs(deploymentId) {
    const token = localStorage.getItem('token');
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5002';
    const url = `${wsUrl}/ws?token=${token}&deploymentId=${deploymentId}&type=cli`;

    if (this.cliWs) {
      this.cliWs.close();
    }

    this.cliWs = new WebSocket(url);

    this.cliWs.onopen = () => {
      console.log('CLI log WebSocket connected');
      this.notifyCLIListeners('connected', { deploymentId });
    };

    this.cliWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'cli_log') {
          this.notifyCLIListeners('cli_log', data);
        } else {
          this.notifyCLIListeners(data.type, data);
        }
      } catch (error) {
        console.error('Error parsing CLI WebSocket message:', error);
      }
    };

    this.cliWs.onerror = (error) => {
      console.error('CLI log WebSocket error:', error);
      this.notifyCLIListeners('error', { error });
    };

    this.cliWs.onclose = () => {
      console.log('CLI log WebSocket disconnected');
      this.notifyCLIListeners('disconnected', { deploymentId });
      // Attempt to reconnect
      setTimeout(() => {
        if (!this.cliWs || this.cliWs.readyState === WebSocket.CLOSED) {
          this.connectCLILogs(deploymentId);
        }
      }, 3000);
    };
  }

  /**
   * Disconnect CLI log WebSocket
   */
  disconnectCLILogs() {
    if (this.cliWs) {
      this.cliWs.close();
      this.cliWs = null;
    }
    this.cliListeners.clear();
  }

  /**
   * Listen to CLI log events
   */
  onCLI(event, callback) {
    if (!this.cliListeners.has(event)) {
      this.cliListeners.set(event, []);
    }
    this.cliListeners.get(event).push(callback);
  }

  /**
   * Remove CLI event listener
   */
  offCLI(event, callback) {
    if (this.cliListeners.has(event)) {
      const callbacks = this.cliListeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Notify CLI listeners
   */
  notifyCLIListeners(event, data) {
    if (this.cliListeners.has(event)) {
      this.cliListeners.get(event).forEach((callback) => {
        callback(data);
      });
    }
  }
}

export default new WebSocketService();
