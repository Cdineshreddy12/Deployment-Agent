import React, { createContext, useContext, useState, useCallback } from 'react';

const TerminalContext = createContext(null);

/**
 * Terminal Context Provider
 * Provides shared state and communication between chat and terminal components
 */
export const TerminalProvider = ({ children }) => {
  // Pending commands to be executed in terminal
  const [pendingCommands, setPendingCommands] = useState([]);
  
  // Recent execution results
  const [executionResults, setExecutionResults] = useState([]);
  
  // Active terminal view
  const [activeTerminalTab, setActiveTerminalTab] = useState('console');
  
  // Flag to trigger terminal focus
  const [shouldFocusTerminal, setShouldFocusTerminal] = useState(false);

  /**
   * Queue a command to be executed in the terminal
   */
  const queueCommand = useCallback((command, options = {}) => {
    const commandEntry = {
      id: `cmd-${Date.now()}`,
      command,
      source: options.source || 'chat',
      priority: options.priority || 'normal',
      autoExecute: options.autoExecute !== false,
      timestamp: new Date().toISOString()
    };
    
    setPendingCommands(prev => [...prev, commandEntry]);
    
    // Auto-focus terminal when command is queued
    if (options.focusTerminal !== false) {
      setShouldFocusTerminal(true);
    }
    
    return commandEntry.id;
  }, []);

  /**
   * Remove a command from the pending queue
   */
  const dequeueCommand = useCallback((commandId) => {
    setPendingCommands(prev => prev.filter(cmd => cmd.id !== commandId));
  }, []);

  /**
   * Clear all pending commands
   */
  const clearPendingCommands = useCallback(() => {
    setPendingCommands([]);
  }, []);

  /**
   * Add an execution result
   */
  const addExecutionResult = useCallback((result) => {
    const resultEntry = {
      id: `result-${Date.now()}`,
      ...result,
      timestamp: new Date().toISOString()
    };
    
    setExecutionResults(prev => [resultEntry, ...prev].slice(0, 50)); // Keep last 50 results
    return resultEntry.id;
  }, []);

  /**
   * Notify that a file was generated (for terminal to log)
   */
  const notifyFileGenerated = useCallback((fileInfo) => {
    addExecutionResult({
      type: 'file_generated',
      filename: fileInfo.filename,
      path: fileInfo.path,
      status: 'success',
      message: `Generated file: ${fileInfo.filename}`
    });
  }, [addExecutionResult]);

  /**
   * Notify that an API call was executed
   */
  const notifyApiExecuted = useCallback((apiInfo) => {
    addExecutionResult({
      type: 'api_executed',
      url: apiInfo.url,
      method: apiInfo.method,
      status: apiInfo.success ? 'success' : 'error',
      message: apiInfo.message || (apiInfo.success ? 'API call successful' : 'API call failed'),
      details: apiInfo.details
    });
  }, [addExecutionResult]);

  /**
   * Reset terminal focus flag (called by terminal after focusing)
   */
  const clearFocusRequest = useCallback(() => {
    setShouldFocusTerminal(false);
  }, []);

  const value = {
    // State
    pendingCommands,
    executionResults,
    activeTerminalTab,
    shouldFocusTerminal,
    
    // Actions
    queueCommand,
    dequeueCommand,
    clearPendingCommands,
    addExecutionResult,
    notifyFileGenerated,
    notifyApiExecuted,
    setActiveTerminalTab,
    clearFocusRequest
  };

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
};

/**
 * Hook to use terminal context
 */
export const useTerminal = () => {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
};

/**
 * Hook to use terminal context safely (returns null if not in provider)
 */
export const useTerminalSafe = () => {
  return useContext(TerminalContext);
};

export default TerminalContext;





