import React, { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import TerminalInput from './TerminalInput';
import LogDisplay from './LogDisplay';
import QuickActions from './QuickActions';
import CommandHistory from './CommandHistory';
import api from '../../services/api';
import websocketService from '../../services/websocket';
import { Terminal, Loader2, AlertCircle, Clock, Zap, History, Maximize2, Minimize2, FileCode, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTerminalSafe } from '../../context/TerminalContext';

const CommandTerminal = ({ deploymentId, isFullViewport = false }) => {
  const [logs, setLogs] = useState([]);
  const [commandHistory, setCommandHistory] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);
  const [activeCommand, setActiveCommand] = useState(null);
  const [queueLength, setQueueLength] = useState(0);
  const [error, setError] = useState(null);
  const [selectedCommand, setSelectedCommand] = useState(null);
  const [commandDetailsOpen, setCommandDetailsOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isConsoleMaximized, setIsConsoleMaximized] = useState(false);
  
  // Terminal context for chat integration
  const terminalContext = useTerminalSafe();

  // Listen for execution results from chat (via terminal context)
  useEffect(() => {
    if (!terminalContext) return;
    
    const { executionResults } = terminalContext;
    
    // Add new execution results to logs
    if (executionResults && executionResults.length > 0) {
      const latestResult = executionResults[0];
      
      // Check if this result is already in logs (by timestamp comparison)
      const resultAlreadyLogged = logs.some(
        log => log.contextResultId === latestResult.id
      );
      
      if (!resultAlreadyLogged && latestResult.id) {
        const icon = latestResult.type === 'file_generated' ? '📄' : 
                     latestResult.type === 'api_executed' ? '🔗' : '✨';
        
        setLogs(prev => [...prev, {
          level: latestResult.status === 'success' ? 'success' : 'error',
          message: `${icon} [Chat Action] ${latestResult.message}`,
          timestamp: latestResult.timestamp,
          contextResultId: latestResult.id,
          source: 'chat'
        }]);
      }
    }
  }, [terminalContext?.executionResults, logs]);

  useEffect(() => {
    if (!deploymentId) return;

    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5002';
    const token = localStorage.getItem('token');
    const url = `${wsUrl}/ws?token=${token}&deploymentId=${deploymentId}&type=commands`;

    const ws = new WebSocket(url);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'command_event') {
          handleCommandEvent(data);
        } else if (data.type === 'cli_log') {
          setLogs(prev => [...prev, {
            level: data.level,
            message: data.message,
            timestamp: data.timestamp
          }]);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    websocketService.connectCLILogs(deploymentId);
    const handleCLILog = (data) => {
      if (data.type === 'cli_log') {
        setLogs(prev => [...prev, {
          level: data.level,
          message: data.message,
          timestamp: data.timestamp
        }]);
      }
    };
    websocketService.onCLI('cli_log', handleCLILog);

    loadCommandHistory();
    const statusInterval = setInterval(() => {
      checkCommandStatus();
    }, 2000);

    return () => {
      ws.close();
      websocketService.offCLI('cli_log', handleCLILog);
      websocketService.disconnectCLILogs();
      clearInterval(statusInterval);
    };
  }, [deploymentId]);

  const handleCommandEvent = (event) => {
    const { eventType, commandId, command, exitCode, error: eventError } = event;

    switch (eventType) {
      case 'command_started':
        setIsExecuting(true);
        setActiveCommand({ commandId, command });
        setLogs(prev => [...prev, {
          level: 'info',
          message: `▶ Executing: ${command}`,
          timestamp: new Date().toISOString(),
          commandId
        }]);
        break;

      case 'command_completed':
        setIsExecuting(false);
        setActiveCommand(null);
        setLogs(prev => [...prev, {
          level: exitCode === 0 ? 'success' : 'error',
          message: `✓ Command completed with exit code ${exitCode}`,
          timestamp: new Date().toISOString(),
          commandId
        }]);
        loadCommandHistory();
        checkCommandStatus();
        break;

      case 'command_failed':
        setIsExecuting(false);
        setActiveCommand(null);
        setLogs(prev => [...prev, {
          level: 'error',
          message: `✗ Command failed: ${eventError || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
          commandId
        }]);
        loadCommandHistory();
        checkCommandStatus();
        break;

      case 'command_cancelled':
        setIsExecuting(false);
        setActiveCommand(null);
        setLogs(prev => [...prev, {
          level: 'warn',
          message: `⚠ Command cancelled`,
          timestamp: new Date().toISOString(),
          commandId
        }]);
        loadCommandHistory();
        checkCommandStatus();
        break;

      case 'command_queued':
        setQueueLength(event.position || 0);
        setLogs(prev => [...prev, {
          level: 'info',
          message: `⏳ Command queued (position ${event.position})`,
          timestamp: new Date().toISOString(),
          commandId
        }]);
        break;
    }
  };

  const checkCommandStatus = async () => {
    try {
      const response = await api.get(`/commands/status/${deploymentId}`);
      const { activeCommand, queueLength } = response.data.data;
      setActiveCommand(activeCommand);
      setQueueLength(queueLength || 0);
      setIsExecuting(!!activeCommand);
    } catch (error) {
      console.error('Failed to check command status:', error);
    }
  };

  const loadCommandHistory = async () => {
    setLoadingHistory(true);
    try {
      const response = await api.get(`/commands/history/${deploymentId}`, {
        params: { limit: 50 }
      });
      setCommandHistory(response.data.data.commands || []);
    } catch (error) {
      console.error('Failed to load command history:', error);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleExecute = async (command) => {
    setError(null);
    setIsExecuting(true);
    try {
      const commandType = command.toLowerCase().startsWith('terraform') 
        ? 'terraform' 
        : command.toLowerCase().startsWith('aws')
        ? 'aws'
        : 'shell';

      const response = await api.post('/commands/execute', {
        deploymentId,
        command,
        type: commandType
      });

      if (response.data.data.requiresConfirmation) {
        setError('This command requires confirmation. Please confirm in the dialog.');
        setIsExecuting(false);
        return;
      }
    } catch (error) {
      setIsExecuting(false);
      const errorMessage = error.response?.data?.error?.message || error.message;
      setError(errorMessage);
      setLogs(prev => [...prev, {
        level: 'error',
        message: `✗ Failed to execute command: ${errorMessage}`,
        timestamp: new Date().toISOString()
      }]);
    }
  };

  const handleCancel = async () => {
    if (!activeCommand?.commandId) return;
    try {
      await api.post(`/commands/${activeCommand.commandId}/cancel`);
    } catch (error) {
      console.error('Failed to cancel command:', error);
      setError('Failed to cancel command');
    }
  };

  const handleReRun = (command) => handleExecute(command);

  const handleViewDetails = async (commandId) => {
    try {
      const response = await api.get(`/commands/${commandId}`);
      setSelectedCommand(response.data.data);
      setCommandDetailsOpen(true);
    } catch (error) {
      console.error('Failed to load command details:', error);
      setError('Failed to load command details');
    }
  };

  return (
    <div className={cn(
        "flex flex-col bg-white text-slate-800 transition-all duration-300",
        isFullViewport ? "h-screen w-screen fixed inset-0 z-[100]" : "h-full w-full relative"
    )}>
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 border-b border-red-100">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-bold">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="ml-auto h-6 text-red-600 hover:bg-red-100 font-bold">
            Dismiss
          </Button>
        </div>
      )}

      <Tabs defaultValue="console" className="flex flex-col flex-1 h-full">
        <div className="flex-none px-4 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <TabsList className="bg-slate-200/50 p-1 rounded-lg">
            <TabsTrigger value="console" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 h-7 text-[10px] font-black uppercase tracking-widest">
              <Terminal className="h-3 w-3 mr-2" />
              Console
            </TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 h-7 text-[10px] font-black uppercase tracking-widest">
              <History className="h-3 w-3 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger value="actions" className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-3 h-7 text-[10px] font-black uppercase tracking-widest">
              <Zap className="h-3 w-3 mr-2" />
              Actions
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            {isExecuting && (
              <Badge variant="outline" className="border-emerald-200 text-emerald-600 gap-1.5 bg-emerald-50 text-[10px] font-bold px-2 py-0.5 animate-pulse">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Executing
              </Badge>
            )}
            {queueLength > 0 && (
              <Badge variant="outline" className="border-slate-200 text-slate-500 gap-1.5 bg-slate-100 text-[10px] font-bold px-2 py-0.5">
                <Clock className="h-2.5 w-2.5" />
                {queueLength} Queued
              </Badge>
            )}
            {isFullViewport && (
                <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setIsConsoleMaximized(!isConsoleMaximized)}
                    className="h-7 w-7 text-slate-400 hover:text-primary"
                >
                    {isConsoleMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                </Button>
            )}
          </div>
        </div>

        <TabsContent value="console" className="flex-1 flex flex-col min-h-0 m-0 relative group">
          <div className={cn(
              "flex-1 overflow-hidden bg-slate-50/50 relative",
              isConsoleMaximized ? "fixed inset-0 z-[110] bg-white" : ""
          )}>
             {isConsoleMaximized && (
                 <div className="absolute top-4 right-4 z-[120]">
                     <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setIsConsoleMaximized(false)}
                        className="bg-white/80 backdrop-blur rounded-full border-slate-200"
                    >
                        <Minimize2 className="h-3.5 w-3.5 mr-2" />
                        Exit Maximize
                    </Button>
                 </div>
             )}
             <LogDisplay logs={logs} autoScroll={true} />
          </div>
          <div className="flex-none p-4 border-t border-slate-100 bg-white shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.05)]">
            <TerminalInput
              onExecute={handleExecute}
              onCancel={handleCancel}
              isExecuting={isExecuting}
              commandHistory={commandHistory}
            />
          </div>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-hidden m-0 bg-white">
          <CommandHistory
            commands={commandHistory}
            onReRun={handleReRun}
            onViewDetails={handleViewDetails}
            loading={loadingHistory}
          />
        </TabsContent>

        <TabsContent value="actions" className="flex-1 overflow-y-auto m-0 p-6 bg-white">
          <QuickActions
            onExecute={handleExecute}
            isExecuting={isExecuting}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={commandDetailsOpen} onOpenChange={setCommandDetailsOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] bg-white text-slate-900 border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Command Inspection</DialogTitle>
            <DialogDescription className="text-slate-500 font-mono text-xs mt-2">
              {selectedCommand?.command}
            </DialogDescription>
          </DialogHeader>
          {selectedCommand && (
            <div className="space-y-6 overflow-y-auto max-h-[60vh] mt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Status</span>
                    <span className="text-sm font-bold">{selectedCommand.status}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Exit Code</span>
                    <span className="text-sm font-bold">{selectedCommand.exitCode ?? 'N/A'}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Duration</span>
                    <span className="text-sm font-bold">{selectedCommand.duration ? `${selectedCommand.duration}ms` : 'N/A'}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Timestamp</span>
                    <span className="text-sm font-bold">{selectedCommand.startedAt ? new Date(selectedCommand.startedAt).toLocaleTimeString() : 'N/A'}</span>
                </div>
              </div>
              
              {selectedCommand.output && (
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Raw Execution Output</span>
                  <pre className="p-5 bg-slate-900 text-slate-200 rounded-2xl overflow-auto text-xs font-mono shadow-xl border border-slate-800 leading-relaxed">
                    {selectedCommand.output}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CommandTerminal;
