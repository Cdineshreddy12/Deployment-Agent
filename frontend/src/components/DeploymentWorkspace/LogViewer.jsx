import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CommandLineIcon,
  CloudIcon,
  ServerIcon,
  ArrowPathIcon,
  PauseIcon,
  PlayIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  CheckCircleIcon
} from '@heroicons/react/24/outline';

/**
 * LogViewer - Tabbed real-time log viewer with Docker/Terraform/SSH tabs
 */

const LogLine = ({ line, index, searchQuery }) => {
  const { type, content, timestamp, level } = line;
  
  // Determine log level styling
  let levelClass = 'text-gray-400';
  let bgClass = '';
  
  if (level === 'error' || content.toLowerCase().includes('error')) {
    levelClass = 'text-red-400';
    bgClass = 'bg-red-500/10';
  } else if (level === 'warning' || content.toLowerCase().includes('warn')) {
    levelClass = 'text-yellow-400';
    bgClass = 'bg-yellow-500/5';
  } else if (level === 'success' || content.includes('successfully') || content.includes('✓')) {
    levelClass = 'text-green-400';
  } else if (content.startsWith('Step ') || content.startsWith('---')) {
    levelClass = 'text-blue-400';
  }

  // Highlight search matches
  let displayContent = content;
  if (searchQuery) {
    const regex = new RegExp(`(${searchQuery})`, 'gi');
    displayContent = content.replace(regex, '<mark class="bg-yellow-500/50 text-white">$1</mark>');
  }

  return (
    <div className={`flex items-start py-0.5 px-2 hover:bg-gray-700/30 ${bgClass}`}>
      <span className="text-gray-600 text-xs font-mono w-10 flex-shrink-0 text-right mr-3">
        {index + 1}
      </span>
      {timestamp && (
        <span className="text-gray-500 text-xs font-mono w-20 flex-shrink-0 mr-2">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      )}
      <span 
        className={`text-sm font-mono flex-1 whitespace-pre-wrap break-all ${levelClass}`}
        dangerouslySetInnerHTML={{ __html: displayContent }}
      />
    </div>
  );
};

const TabButton = ({ name, icon: Icon, active, count, hasErrors, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'text-blue-400 border-blue-400'
          : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-gray-600'
      }`}
    >
      <Icon className="w-4 h-4 mr-1.5" />
      {name}
      {count > 0 && (
        <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-700 rounded">
          {count}
        </span>
      )}
      {hasErrors && (
        <ExclamationTriangleIcon className="w-4 h-4 ml-1.5 text-red-400" />
      )}
    </button>
  );
};

export default function LogViewer({
  deploymentId,
  logs = {
    docker: [],
    terraform: [],
    ssh: []
  },
  onClear,
  className = ''
}) {
  const [activeTab, setActiveTab] = useState('docker');
  const [isFollowing, setIsFollowing] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const logContainerRef = useRef(null);
  const [internalLogs, setInternalLogs] = useState(logs);

  // Update internal logs when props change
  useEffect(() => {
    setInternalLogs(logs);
  }, [logs]);

  // Auto-scroll when following and new logs arrive
  useEffect(() => {
    if (isFollowing && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [internalLogs, isFollowing, activeTab]);

  // Handle scroll to detect manual scrolling
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    if (!isAtBottom && isFollowing) {
      setIsFollowing(false);
    }
  }, [isFollowing]);

  // Get current tab logs
  const currentLogs = internalLogs[activeTab] || [];

  // Filter logs based on search and error filter
  const filteredLogs = currentLogs.filter(log => {
    if (showErrors) {
      const content = log.content?.toLowerCase() || '';
      if (!content.includes('error') && !content.includes('fail') && log.level !== 'error') {
        return false;
      }
    }
    
    if (searchQuery) {
      const content = log.content?.toLowerCase() || '';
      return content.includes(searchQuery.toLowerCase());
    }
    
    return true;
  });

  // Count errors per tab
  const countErrors = (tabLogs) => {
    return tabLogs.filter(log => {
      const content = log.content?.toLowerCase() || '';
      return content.includes('error') || content.includes('fail') || log.level === 'error';
    }).length;
  };

  const dockerErrors = countErrors(internalLogs.docker || []);
  const terraformErrors = countErrors(internalLogs.terraform || []);
  const sshErrors = countErrors(internalLogs.ssh || []);

  // Clear logs for current tab
  const handleClear = () => {
    setInternalLogs(prev => ({
      ...prev,
      [activeTab]: []
    }));
    if (onClear) {
      onClear(activeTab);
    }
  };

  // Download logs
  const handleDownload = () => {
    const content = currentLogs.map(log => {
      const ts = log.timestamp ? `[${new Date(log.timestamp).toISOString()}] ` : '';
      return `${ts}${log.content}`;
    }).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deploymentId}-${activeTab}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Scroll to bottom
  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      setIsFollowing(true);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-gray-800/50 rounded-lg border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center">
          <CommandLineIcon className="w-4 h-4 text-green-400 mr-2" />
          <span className="text-sm font-medium text-gray-200">Deployment Logs</span>
        </div>
        <div className="flex items-center space-x-2">
          {isFollowing ? (
            <span className="flex items-center text-xs text-green-400">
              <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />
              Following
            </span>
          ) : (
            <button
              onClick={scrollToBottom}
              className="text-xs text-gray-400 hover:text-gray-200"
            >
              Scroll to bottom
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 overflow-x-auto">
        <TabButton
          name="Docker"
          icon={CommandLineIcon}
          active={activeTab === 'docker'}
          count={(internalLogs.docker || []).length}
          hasErrors={dockerErrors > 0}
          onClick={() => setActiveTab('docker')}
        />
        <TabButton
          name="Terraform"
          icon={CloudIcon}
          active={activeTab === 'terraform'}
          count={(internalLogs.terraform || []).length}
          hasErrors={terraformErrors > 0}
          onClick={() => setActiveTab('terraform')}
        />
        <TabButton
          name="SSH"
          icon={ServerIcon}
          active={activeTab === 'ssh'}
          count={(internalLogs.ssh || []).length}
          hasErrors={sshErrors > 0}
          onClick={() => setActiveTab('ssh')}
        />
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900/30">
        <div className="flex items-center space-x-2">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search logs..."
              className="bg-gray-900/50 border border-gray-600 rounded pl-8 pr-2 py-1 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 w-48"
            />
          </div>
          
          {/* Error filter */}
          <button
            onClick={() => setShowErrors(!showErrors)}
            className={`flex items-center px-2 py-1 text-xs rounded transition-colors ${
              showErrors
                ? 'text-red-400 bg-red-500/20'
                : 'text-gray-400 bg-gray-700 hover:bg-gray-600'
            }`}
          >
            <ExclamationTriangleIcon className="w-4 h-4 mr-1" />
            Errors Only
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsFollowing(!isFollowing)}
            className={`flex items-center px-2 py-1 text-xs rounded transition-colors ${
              isFollowing
                ? 'text-green-400 bg-green-500/20'
                : 'text-gray-400 bg-gray-700 hover:bg-gray-600'
            }`}
          >
            {isFollowing ? (
              <>
                <PauseIcon className="w-4 h-4 mr-1" />
                Pause
              </>
            ) : (
              <>
                <PlayIcon className="w-4 h-4 mr-1" />
                Follow
              </>
            )}
          </button>
          
          <button
            onClick={handleDownload}
            className="flex items-center px-2 py-1 text-xs text-gray-400 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
            Download
          </button>
          
          <button
            onClick={handleClear}
            className="flex items-center px-2 py-1 text-xs text-gray-400 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <TrashIcon className="w-4 h-4 mr-1" />
            Clear
          </button>
        </div>
      </div>

      {/* Log content */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto font-mono text-sm bg-gray-900/50"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <CommandLineIcon className="w-12 h-12 mb-2 opacity-50" />
            <p className="text-sm">No logs yet</p>
            <p className="text-xs mt-1">Logs will appear here when the deployment runs</p>
          </div>
        ) : (
          <div className="py-2">
            {filteredLogs.map((log, index) => (
              <LogLine
                key={index}
                line={log}
                index={index}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>
            {filteredLogs.length} line{filteredLogs.length !== 1 ? 's' : ''}
            {showErrors && ` (errors only)`}
            {searchQuery && ` matching "${searchQuery}"`}
          </span>
          <div className="flex items-center space-x-3">
            {dockerErrors > 0 && (
              <span className="flex items-center text-red-400">
                <XCircleIcon className="w-3 h-3 mr-1" />
                {dockerErrors} Docker error{dockerErrors !== 1 ? 's' : ''}
              </span>
            )}
            {terraformErrors > 0 && (
              <span className="flex items-center text-red-400">
                <XCircleIcon className="w-3 h-3 mr-1" />
                {terraformErrors} Terraform error{terraformErrors !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


