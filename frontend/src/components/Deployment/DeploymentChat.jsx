import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import websocketService from '../../services/websocket';
import MessageList from '../Chat/MessageList';
import MessageInput from '../Chat/MessageInput';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Terminal, AlertCircle } from 'lucide-react';

const DeploymentChat = ({ deploymentId }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [cliLogs, setCliLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    fetchHistory();
    connectCLIWebSocket();

    return () => {
      disconnectCLIWebSocket();
    };
  }, [deploymentId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, cliLogs]);

  const fetchHistory = async () => {
    try {
      const response = await api.get(`/chat/history/${deploymentId}`);
      setMessages(response.data.data.messages || []);
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };

  const connectCLIWebSocket = () => {
    const token = localStorage.getItem('token');
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5002';
    const url = `${wsUrl}/ws?token=${token}&deploymentId=${deploymentId}&type=cli`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        console.log('CLI log stream connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'cli_log') {
            setCliLogs(prev => [...prev, {
              level: data.level,
              message: data.message,
              timestamp: data.timestamp
            }]);
          } else if (data.type === 'cli_log_stream_connected') {
            setIsConnected(true);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('CLI WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        console.log('CLI log stream disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            connectCLIWebSocket();
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to connect CLI WebSocket:', error);
    }
  };

  const disconnectCLIWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (message) => {
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const response = await api.post('/chat/message', {
        deploymentId,
        message,
        stream: false
      });

      const assistantMessage = {
        role: 'assistant',
        content: response.data.data.message,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        error: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const getLogLevelColor = (level) => {
    switch (level) {
      case 'error':
        return 'destructive';
      case 'warn':
        return 'warning';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)] w-full">
      <Card className="flex flex-col h-full flex-1">
        <div className="flex items-center justify-between p-4 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-muted-foreground" />
            <span className="font-semibold">Deployment Chat</span>
          </div>
          <Badge variant={isConnected ? 'success' : 'secondary'} className="text-xs">
            {isConnected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
        
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {/* Chat Messages */}
            <MessageList messages={messages} loading={loading} />
            
            {/* CLI Logs */}
            {cliLogs.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <Terminal className="h-4 w-4" />
                  <span>CLI Execution Logs</span>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-1 max-h-[300px] overflow-y-auto">
                  {cliLogs.map((log, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm font-mono">
                      <Badge variant={getLogLevelColor(log.level)} className="text-xs">
                        {log.level}
                      </Badge>
                      <span className="flex-1 break-words">{log.message}</span>
                      {log.level === 'error' && (
                        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          <div className="flex-shrink-0 border-t">
            <MessageInput onSend={handleSendMessage} disabled={loading} />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DeploymentChat;

