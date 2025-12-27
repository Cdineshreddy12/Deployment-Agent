import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  SparklesIcon,
  PlayIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronDoubleRightIcon,
  CommandLineIcon,
  ClipboardDocumentIcon,
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  WrenchScrewdriverIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  DocumentTextIcon,
  ArrowUpTrayIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';
import FileApprovalModal from './FileApprovalModal';
import FileGenerationWorkflow from './FileGenerationWorkflow';

/**
 * ClaudeWizard - Step-by-step deployment wizard with Claude guidance
 */

const STAGE_ICONS = {
  ANALYZE: SparklesIcon,
  CONFIGURE: CommandLineIcon,
  GENERATE: SparklesIcon,
  GENERATE_README: DocumentTextIcon,
  AWAIT_CURSOR_GENERATION: SparklesIcon,
  AWAIT_FILE_UPLOAD: ArrowUpTrayIcon,
  VERIFY_FILES: CheckCircleIcon,
  FILES_VERIFIED: CheckCircleIcon,
  VERIFY: CheckCircleIcon,
  LOCAL_BUILD: CommandLineIcon,
  LOCAL_TEST: PlayIcon,
  PROVISION: CommandLineIcon,
  DEPLOY: ArrowTopRightOnSquareIcon,
  HEALTH_CHECK: CheckCircleIcon
};

const StageIndicator = ({ stage, status, isCurrent, onClick }) => {
  const Icon = STAGE_ICONS[stage.id] || SparklesIcon;
  
  return (
    <button
      onClick={onClick}
      className={`group flex items-center px-4 py-2.5 rounded-xl transition-all duration-200 ${
        isCurrent
          ? 'bg-gradient-to-r from-blue-600/30 to-purple-600/30 border border-blue-500/50 text-white shadow-lg shadow-blue-500/10'
          : status === 'completed'
          ? 'bg-green-600/10 border border-green-500/30 text-green-400 hover:bg-green-600/20'
          : status === 'failed'
          ? 'bg-red-600/10 border border-red-500/30 text-red-400 hover:bg-red-600/20'
          : 'bg-gray-800/50 border border-gray-700/50 text-gray-500 hover:text-gray-300 hover:bg-gray-800 hover:border-gray-600'
      }`}
    >
      <div className={`flex items-center justify-center w-6 h-6 rounded-lg mr-2 ${
        isCurrent ? 'bg-blue-500/30' :
        status === 'completed' ? 'bg-green-500/30' :
        status === 'failed' ? 'bg-red-500/30' :
        'bg-gray-700/50'
      }`}>
        {status === 'completed' ? (
          <CheckCircleIcon className="w-4 h-4 text-green-400" />
        ) : status === 'failed' ? (
          <XCircleIcon className="w-4 h-4 text-red-400" />
        ) : (
          <Icon className={`w-4 h-4 ${isCurrent ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
        )}
      </div>
      <span className={`text-xs font-medium whitespace-nowrap ${isCurrent ? 'text-white' : ''}`}>{stage.name}</span>
    </button>
  );
};

// Reusable markdown renderer with consistent styling
const MarkdownRenderer = ({ content, className = '' }) => {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={`prose prose-invert prose-sm max-w-none ${className}`}
      components={{
        h1: ({children}) => <h1 className="text-xl font-bold text-white mb-4 mt-6 pb-2 border-b border-gray-700">{children}</h1>,
        h2: ({children}) => <h2 className="text-lg font-bold text-purple-400 mb-3 mt-5">{children}</h2>,
        h3: ({children}) => <h3 className="text-base font-semibold text-blue-400 mb-2 mt-4">{children}</h3>,
        h4: ({children}) => <h4 className="text-sm font-semibold text-cyan-400 mb-2 mt-3">{children}</h4>,
        p: ({children}) => <p className="text-gray-300 mb-3 leading-relaxed">{children}</p>,
        ul: ({children}) => <ul className="list-disc list-inside space-y-1 mb-4 text-gray-300">{children}</ul>,
        ol: ({children}) => <ol className="list-decimal list-inside space-y-1 mb-4 text-gray-300">{children}</ol>,
        li: ({children}) => <li className="text-gray-300 ml-2">{children}</li>,
        strong: ({children}) => <strong className="font-bold text-yellow-400">{children}</strong>,
        em: ({children}) => <em className="italic text-gray-400">{children}</em>,
        blockquote: ({children}) => (
          <blockquote className="border-l-4 border-purple-500 pl-4 py-2 my-4 bg-purple-900/10 rounded-r-lg text-gray-400 italic">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-gray-700 my-6" />,
        a: ({href, children}) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
            {children}
          </a>
        ),
        code: ({node, inline, className, children, ...props}) => {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : 'bash';
          
          if (!inline) {
            return (
              <div className="my-4 rounded-lg overflow-hidden border border-gray-700">
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                  <span className="text-xs text-gray-500 font-mono">{language}</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}
                    className="text-gray-400 hover:text-white p-1 transition-colors"
                    title="Copy code"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
                <SyntaxHighlighter
                  {...props}
                  style={vscDarkPlus}
                  language={language}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: '1rem',
                    fontSize: '0.8rem',
                    lineHeight: '1.5',
                    background: '#1a1a1a'
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              </div>
            );
          }
          return (
            <code className="bg-gray-800 text-pink-400 px-1.5 py-0.5 rounded text-sm font-mono" {...props}>
              {children}
            </code>
          );
        },
        table: ({children}) => (
          <div className="overflow-x-auto my-4">
            <table className="min-w-full border border-gray-700 rounded-lg overflow-hidden">{children}</table>
          </div>
        ),
        th: ({children}) => <th className="bg-gray-800 px-4 py-2 text-left text-sm font-semibold text-gray-300 border-b border-gray-700">{children}</th>,
        td: ({children}) => <td className="px-4 py-2 text-sm text-gray-400 border-b border-gray-700/50">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
};

const CommandCard = ({ command, onExecute, isExecuting, result, index, isCurrentInQueue = false, isBlocked = false }) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(command.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getTypeStyle = (type) => {
    switch (type) {
      case 'docker':
      case 'docker-compose':
        return { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', icon: '🐳' };
      case 'aws':
        return { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', icon: '☁️' };
      case 'terraform':
        return { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', icon: '🏗️' };
      case 'ssh':
        return { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', icon: '🔐' };
      case 'http':
        return { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', icon: '🌐' };
      default:
        return { bg: 'bg-gray-600/20', text: 'text-gray-400', border: 'border-gray-500/30', icon: '💻' };
    }
  };

  const typeStyle = getTypeStyle(command.type);
  const statusColor = result?.success === true ? 'border-l-green-500' :
                      result?.success === false ? 'border-l-red-500' :
                      isCurrentInQueue ? 'border-l-purple-500' :
                      'border-l-gray-600';

  return (
    <div className={`bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl overflow-hidden shadow-lg border transition-all hover:shadow-xl ${
      isCurrentInQueue && !result ? 'border-purple-500/50 ring-1 ring-purple-500/30' : 'border-gray-700/50'
    } border-l-4 ${statusColor}`}>
      {/* Command header */}
      <div className="px-4 py-3 flex items-center justify-between bg-gray-900/50">
        <div className="flex items-center space-x-3">
          <span className="text-lg">{typeStyle.icon}</span>
          <div>
            <div className="flex items-center space-x-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeStyle.bg} ${typeStyle.text} border ${typeStyle.border}`}>
            {command.type}
          </span>
              {index !== undefined && (
                <span className="text-xs text-gray-500">#{index + 1}</span>
              )}
              {isCurrentInQueue && !result && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-600/20 text-purple-400 border border-purple-500/30">
                  Next
                </span>
              )}
              {command.isFixCommand && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-600/20 text-yellow-400 border border-yellow-500/30 flex items-center">
                  <WrenchScrewdriverIcon className="w-3 h-3 mr-1" />
                  Fix
                </span>
              )}
              {command.isRetryCommand && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-600/20 text-orange-400 border border-orange-500/30 flex items-center">
                  <ArrowPathIcon className="w-3 h-3 mr-1" />
                  Retry
                </span>
              )}
            </div>
            {command.reason && (
              <p className="text-xs text-gray-500 mt-1 max-w-md truncate">{command.reason}</p>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {result && (
            <span className={`flex items-center text-xs px-2 py-1 rounded-full ${
              result.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
              {result.success ? (
                <><CheckCircleIcon className="w-3.5 h-3.5 mr-1" /> Done</>
              ) : (
                <><XCircleIcon className="w-3.5 h-3.5 mr-1" /> Failed</>
              )}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-all"
            title="Copy command"
          >
            {copied ? (
              <CheckCircleIcon className="w-4 h-4 text-green-400" />
            ) : (
              <ClipboardDocumentIcon className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => onExecute(command)}
            disabled={isExecuting}
            className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isExecuting
                ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/30 cursor-wait'
                : result?.success
                ? 'bg-gray-600/50 text-gray-400 border border-gray-500/30 hover:bg-gray-600'
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg'
            }`}
          >
            {isExecuting ? (
              <>
                <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
                Running...
              </>
            ) : result?.success ? (
              <>
                <ArrowPathIcon className="w-4 h-4 mr-2" />
                Re-run
              </>
            ) : (
              <>
                <PlayIcon className="w-4 h-4 mr-2" />
                Execute
              </>
            )}
          </button>
        </div>
      </div>
      
      {/* Command code */}
      <div 
        className="px-4 py-3 bg-black/50 cursor-pointer group"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start">
          <span className="text-green-500 mr-2 font-mono text-sm">$</span>
          <code className={`font-mono text-sm text-gray-200 flex-1 ${expanded ? '' : 'truncate'}`}>
            {command.command}
          </code>
          {command.command.length > 80 && (
            <button className="text-gray-500 hover:text-gray-300 ml-2 text-xs">
              {expanded ? '▲' : '▼'}
            </button>
          )}
        </div>
      </div>
      
      {/* Result */}
      {result && (
        <div className={`px-4 py-2 text-xs border-t ${
          result.success ? 'bg-green-900/10 border-green-500/20' : 'bg-red-900/10 border-red-500/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center">
            {result.success ? (
                <CheckCircleIcon className="w-4 h-4 text-green-400 mr-2" />
            ) : (
                <XCircleIcon className="w-4 h-4 text-red-400 mr-2" />
            )}
              <span className={`font-medium ${result.success ? 'text-green-400' : 'text-red-400'}`}>
                {result.success ? 'Command completed successfully' : 'Command failed'}
            </span>
            </div>
            {result.exitCode !== undefined && (
              <span className="text-gray-500 font-mono">exit: {result.exitCode}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const TerminalOutput = ({ output, isStreaming, onClear, currentCommand }) => {
  const terminalRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [output]);

  const getLineClass = (type) => {
    switch (type) {
      case 'stderr':
        return 'text-red-400';
      case 'error':
        return 'text-red-500 font-bold bg-red-900/20 px-2 py-0.5 rounded';
      case 'success':
        return 'text-green-400 font-bold bg-green-900/20 px-2 py-0.5 rounded';
      case 'info':
        return 'text-cyan-400';
      case 'complete':
        return 'text-green-400 font-semibold';
      case 'timestamp':
        return 'text-gray-500 text-[10px] italic';
      case 'separator':
        return 'text-purple-500/50 border-b border-purple-500/20 py-1 my-2';
      case 'command':
        return 'text-yellow-400 font-bold bg-yellow-900/20 px-2 py-1 rounded-t border-l-2 border-yellow-500';
      case 'header':
        return 'text-purple-400 font-semibold';
      default:
        return 'text-gray-300';
    }
  };

  const handleCopyOutput = async () => {
    const text = output.map(line => line.content).join('\n');
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative bg-gradient-to-b from-gray-900 to-black rounded-xl border border-gray-700 overflow-hidden shadow-2xl">
      {/* Terminal header - macOS style */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800/80 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className="flex space-x-1.5">
            <button 
              onClick={onClear}
              className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
              title="Clear"
            />
            <button 
              onClick={() => setIsMinimized(!isMinimized)}
              className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-400 transition-colors"
              title="Minimize"
            />
            <div className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <span className="text-xs text-gray-400 ml-3 font-mono">
            {currentCommand ? `Running: ${currentCommand.substring(0, 50)}...` : 'Terminal'}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {isStreaming && (
            <span className="flex items-center text-xs text-green-400">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1.5" />
              Running
            </span>
          )}
          <button
            onClick={handleCopyOutput}
            className="p-1 text-gray-400 hover:text-white transition-colors rounded hover:bg-gray-700"
            title="Copy all output"
          >
            {copied ? (
              <CheckCircleIcon className="w-4 h-4 text-green-400" />
            ) : (
              <ClipboardDocumentIcon className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
      
      {/* Terminal content */}
      {!isMinimized && (
    <div
      ref={terminalRef}
          className="p-4 h-80 overflow-y-auto font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
          style={{ 
            fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
            fontSize: '12px',
            lineHeight: '1.6'
          }}
    >
      {output.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <CommandLineIcon className="w-12 h-12 mb-3 opacity-30" />
              <span className="text-sm">Terminal output will appear here...</span>
              <span className="text-xs text-gray-700 mt-1">Run a command to see the output</span>
            </div>
          ) : (
            <div className="space-y-0.5">
              {output.map((line, index) => (
          <div
            key={index}
                  className={`whitespace-pre-wrap break-words ${getLineClass(line.type)}`}
                >
                  {line.type === 'command' && <span className="text-gray-500 mr-2">$</span>}
            {line.content}
          </div>
              ))}
            </div>
      )}
      {isStreaming && (
            <span className="inline-block w-2 h-4 bg-green-400 animate-pulse ml-0.5" />
          )}
        </div>
      )}
    </div>
  );
};

export default function ClaudeWizard({
  deploymentId,
  projectContext = {},
  onStageComplete,
  className = ''
}) {
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Wizard state
  const [stages, setStages] = useState([]);
  const [currentStageId, setCurrentStageId] = useState(null);
  const [stageHistory, setStageHistory] = useState([]);
  
  // Current stage data
  const [instructions, setInstructions] = useState('');
  const [commands, setCommands] = useState([]);
  const [commandResults, setCommandResults] = useState({});
  const [executingCommand, setExecutingCommand] = useState(null);
  
  // Terminal output - now persisted across commands
  const [terminalOutput, setTerminalOutput] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  // Command tracking state
  const [commandStatus, setCommandStatus] = useState({}); // { command: { status: 'pending'|'running'|'success'|'failed', exitCode, output: [] } }
  
  // Command queue state for sequential execution
  const [commandQueue, setCommandQueue] = useState([]);
  const [currentCommandIndex, setCurrentCommandIndex] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockingError, setBlockingError] = useState(null);
  const [isAutoExecuting, setIsAutoExecuting] = useState(false);
  
  // Fix mode state - when commands fail, Claude analyzes and suggests fixes
  const [fixMode, setFixMode] = useState(false);
  const [fixCommands, setFixCommands] = useState([]);
  const [retryCommands, setRetryCommands] = useState([]);
  const [errorAnalysis, setErrorAnalysis] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);
  const [isResolvingError, setIsResolvingError] = useState(false);
  
  // File approval modal state
  const [fileProposals, setFileProposals] = useState([]);
  const [showFileApprovalModal, setShowFileApprovalModal] = useState(false);
  const [workspacePath, setWorkspacePath] = useState(projectContext?.projectPath || '');
  
  // AI Chat input state
  const [showAIChat, setShowAIChat] = useState(false);
  const [aiChatInput, setAIChatInput] = useState('');
  const [aiChatLoading, setAIChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  
  // Sequential Dockerfile generation state
  const [sequentialMode, setSequentialMode] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    if (deploymentId && !initialized) {
      checkExistingSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]); // Only run when deploymentId changes

  // Check if wizard session already exists and restore full state
  const checkExistingSession = async () => {
    if (!deploymentId) return;
    
    try {
      // First get status
      const statusResponse = await api.get(`/project/wizard/${deploymentId}/status`);
      
      if (statusResponse.data.success) {
        const status = statusResponse.data.data;
        setStages(status.allStages || []);
        setCurrentStageId(status.currentStage);
        setStageHistory(status.stageHistory || []);
        setInitialized(true);
        
        // Try to load full session data to restore state
        try {
          const sessionResponse = await api.get(`/project/wizard/${deploymentId}/session`);
          
          if (sessionResponse.data.success) {
            const session = sessionResponse.data.data;
            
            // Restore current stage data
            if (session.currentStageData) {
              // Restore instructions
              if (session.currentStageData.claudeInstructions) {
                setInstructions(session.currentStageData.claudeInstructions);
              }
              
              // Restore commands
              if (session.currentStageData.generatedCommands) {
                setCommands(session.currentStageData.generatedCommands);
              }
              
              // Restore command results and status
              if (session.currentStageData.executionResults) {
                const results = {};
                const cmdStatus = {};
                
                for (const exec of session.currentStageData.executionResults) {
                  results[exec.command] = {
                    success: exec.result?.success,
                    exitCode: exec.exitCode || exec.result?.exitCode
                  };
                  cmdStatus[exec.command] = {
                    status: exec.result?.success ? 'success' : 'failed',
                    exitCode: exec.exitCode || exec.result?.exitCode,
                    output: exec.output ? [{ type: 'stdout', content: exec.output }] : []
                  };
                }
                
                setCommandResults(results);
                setCommandStatus(cmdStatus);
              }
              
              // Restore terminal logs
              if (session.currentStageData.terminalLogs) {
                const lines = session.currentStageData.terminalLogs.split('\n').map(line => ({
                  type: 'stdout',
                  content: line
                }));
                setTerminalOutput(lines);
              }
              
              // Restore command queue state
              if (session.currentStageData.commandQueue) {
                setCommandQueue(session.currentStageData.commandQueue);
                setCurrentCommandIndex(session.currentStageData.currentCommandIndex || 0);
                setIsBlocked(session.currentStageData.isBlocked || false);
                setBlockingError(session.currentStageData.blockingError || null);
                
                // Update command status from queue
                const queueStatus = {};
                for (const cmd of session.currentStageData.commandQueue) {
                  queueStatus[cmd.command] = {
                    status: cmd.status,
                    exitCode: cmd.exitCode,
                    output: cmd.output ? [{ type: 'stdout', content: cmd.output }] : []
                  };
                }
                setCommandStatus(prev => ({ ...prev, ...queueStatus }));
              }
              
              // Restore error analysis if in fix mode
              if (session.currentStageData.errorAnalyses && session.currentStageData.errorAnalyses.length > 0) {
                const lastAnalysis = session.currentStageData.errorAnalyses[session.currentStageData.errorAnalyses.length - 1];
                setErrorAnalysis(lastAnalysis.analysis);
                setFixCommands(lastAnalysis.fixCommands || []);
                setRetryCommands(lastAnalysis.retryCommands || []);
                
                // Check if we're blocked
                if (session.currentStageData.isBlocked) {
                  setFixMode(true);
                }
              }
              
              // Restore verification result
              if (session.currentStageData.verificationResult) {
                setVerificationResult(session.currentStageData.verificationResult);
              }
            }
            
            console.log('Wizard session restored from database');
          }
        } catch (sessionErr) {
          console.log('Could not load full session data, loading instructions instead');
          // Fall back to loading instructions
          if (status.currentStage) {
            await loadStageInstructions(status.currentStage);
          }
        }
      }
    } catch (err) {
      // Session doesn't exist yet - that's okay, user can initialize manually
      console.log('No existing wizard session found, will initialize on demand');
    }
  };

  // Initialize wizard
  const initWizard = async () => {
    if (!deploymentId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Step 1: Frontend Validation - Ensure generatedFiles is always an array
      const validatedProjectContext = { ...projectContext };
      
      if (validatedProjectContext.generatedFiles !== undefined) {
        const rawGeneratedFiles = validatedProjectContext.generatedFiles;
        
        // Log what we're sending
        console.log('Frontend: Preparing generatedFiles for API', {
          type: typeof rawGeneratedFiles,
          isArray: Array.isArray(rawGeneratedFiles),
          preview: typeof rawGeneratedFiles === 'string' 
            ? rawGeneratedFiles.substring(0, 200)
            : Array.isArray(rawGeneratedFiles)
              ? `Array with ${rawGeneratedFiles.length} items`
              : String(rawGeneratedFiles).substring(0, 200)
        });
        
        // CRITICAL: Validate and normalize before sending
        if (typeof rawGeneratedFiles === 'string') {
          console.warn('Frontend: generatedFiles is a string! Converting to empty array.');
          console.warn('String preview:', rawGeneratedFiles.substring(0, 300));
          
          // Check if it's JavaScript code string (string concatenation)
          const isJavaScriptCode = 
            rawGeneratedFiles.includes("' +\n") || 
            rawGeneratedFiles.includes('" +\n') || 
            rawGeneratedFiles.includes("' +\\n") || 
            rawGeneratedFiles.includes('" +\\n') ||
            rawGeneratedFiles.trim().startsWith("[\n' +") || 
            rawGeneratedFiles.trim().startsWith('[\n" +') ||
            rawGeneratedFiles.includes("' +\n  '") ||
            rawGeneratedFiles.includes('" +\n  "') ||
            /^\s*\[\s*['"]\s*\+\s*\\?n/.test(rawGeneratedFiles);
          
          if (isJavaScriptCode) {
            console.error('Frontend: Detected JavaScript code string in generatedFiles! This is a serialization error.');
            validatedProjectContext.generatedFiles = [];
          } else {
            // Try to parse as JSON
            try {
              const parsed = JSON.parse(rawGeneratedFiles);
              if (Array.isArray(parsed)) {
                validatedProjectContext.generatedFiles = parsed;
              } else {
                validatedProjectContext.generatedFiles = [];
              }
            } catch (e) {
              console.error('Frontend: Failed to parse generatedFiles string as JSON:', e.message);
              validatedProjectContext.generatedFiles = [];
            }
          }
        } else if (!Array.isArray(rawGeneratedFiles)) {
          console.warn('Frontend: generatedFiles is not an array! Type:', typeof rawGeneratedFiles);
          validatedProjectContext.generatedFiles = [];
        } else {
          // Filter out any invalid entries and ensure clean objects
          validatedProjectContext.generatedFiles = rawGeneratedFiles.filter(item => {
            if (item === null || item === undefined) {
              console.warn('Frontend: Filtering out null/undefined item');
              return false;
            }
            if (typeof item === 'string') {
              console.warn('Frontend: Filtering out string item from array');
              return false;
            }
            if (typeof item !== 'object') {
              console.warn('Frontend: Filtering out non-object item. Type:', typeof item);
              return false;
            }
            return true;
          }).map(item => ({
            // Ensure proper structure with clean values
            path: String(item.path || ''),
            content: typeof item.content === 'string' ? item.content : String(item.content || ''),
            type: String(item.type || 'unknown'),
            service: String(item.service || ''),
            generatedAt: item.generatedAt ? (item.generatedAt instanceof Date ? item.generatedAt : new Date(item.generatedAt)) : new Date(),
            writtenToDisk: Boolean(item.writtenToDisk || false)
          }));
          
          // CRITICAL: JSON round-trip to ensure clean serialization
          try {
            validatedProjectContext.generatedFiles = JSON.parse(JSON.stringify(validatedProjectContext.generatedFiles));
          } catch (e) {
            console.error('Frontend: JSON round-trip failed, using original array:', e.message);
          }
        }
        
        console.log('Frontend: Validated generatedFiles', {
          originalLength: Array.isArray(rawGeneratedFiles) ? rawGeneratedFiles.length : 'N/A',
          validatedLength: validatedProjectContext.generatedFiles.length,
          isArray: Array.isArray(validatedProjectContext.generatedFiles)
        });
      }
      
      const response = await api.post('/project/wizard/init', {
        deploymentId,
        projectContext: validatedProjectContext
      });
      
      if (response.data.success) {
        setStages(response.data.data.stages);
        setCurrentStageId(response.data.data.currentStage);
        setInitialized(true);
        
        // Generate instructions for first stage
        await loadStageInstructions(response.data.data.currentStage);
      }
    } catch (err) {
      console.error('Wizard init error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to initialize wizard';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Load instructions for a stage
  const loadStageInstructions = async (stageId) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/project/wizard/step', {
        deploymentId,
        stage: stageId,
        action: 'generate',
        projectContext // Pass projectContext so backend can auto-initialize if needed
      });
      
      if (response.data.success) {
        setInstructions(response.data.data.instructions);
        setCommands(response.data.data.commands || []);
        setCommandResults({});
        setTerminalOutput([]);
        
        // Set command queue from backend
        setCommandQueue(response.data.data.commandQueue || response.data.data.commands || []);
        setCurrentCommandIndex(0);
        setIsBlocked(false);
        setBlockingError(null);
        
        // Reset command tracking and fix mode state
        setCommandStatus({});
        setFixMode(false);
        setFixCommands([]);
        setRetryCommands([]);
        setErrorAnalysis(null);
        setVerificationResult(null);
        setIsAutoExecuting(false);
        
        // If session was auto-initialized, update state
        if (response.data.data.sessionInitialized) {
          setStages(response.data.data.stages || []);
          setCurrentStageId(stageId);
          setInitialized(true);
        } else if (!initialized) {
          // Ensure we're marked as initialized even if not explicitly told
          setInitialized(true);
        }
        
        // Check for pending file proposals after a short delay
        setTimeout(() => {
          checkPendingFileProposals();
        }, 1000);
      }
    } catch (err) {
      console.error('Load stage instructions error:', err);
      
      // Backend should auto-initialize, but if we still get 404, try manual init
      if (err.response?.status === 404 && !initialized) {
        console.log('Session not found, attempting to initialize...');
        // Backend will auto-initialize on next request, but we should mark as initialized
        // after successful auto-init. For now, just show error and let user retry.
      }
      
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to load stage instructions';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Poll for pending file proposals
  const checkPendingFileProposals = async () => {
    if (!deploymentId) return;
    
    try {
      const response = await api.get(`/project/wizard/${deploymentId}/pending-files`);
      if (response.data.success && response.data.data.proposals.length > 0) {
        setFileProposals(response.data.data.proposals);
        setShowFileApprovalModal(true);
      }
    } catch (err) {
      console.error('Failed to fetch pending file proposals:', err);
    }
  };

  // Handle file approval
  const handleApproveFile = async (proposalId) => {
    try {
      const response = await api.post(`/project/wizard/${deploymentId}/approve-file`, {
        proposalId
      });
      
      if (response.data.success) {
        // Remove approved file from proposals
        setFileProposals(prev => prev.filter(p => p.id !== proposalId));
        
        // Close modal if no more proposals
        if (fileProposals.length <= 1) {
          setShowFileApprovalModal(false);
        }
      }
    } catch (err) {
      console.error('Failed to approve file:', err);
      throw new Error(err.response?.data?.error || 'Failed to approve file');
    }
  };

  // Handle file rejection
  const handleRejectFile = async (proposalId) => {
    try {
      const response = await api.post(`/project/wizard/${deploymentId}/reject-file`, {
        proposalId
      });
      
      if (response.data.success) {
        // Remove rejected file from proposals
        setFileProposals(prev => prev.filter(p => p.id !== proposalId));
        
        // Close modal if no more proposals
        if (fileProposals.length <= 1) {
          setShowFileApprovalModal(false);
        }
      }
    } catch (err) {
      console.error('Failed to reject file:', err);
      throw new Error(err.response?.data?.error || 'Failed to reject file');
    }
  };

  // Handle approve all files
  const handleApproveAll = async () => {
    try {
      // Approve all files in sequence
      for (const proposal of fileProposals) {
        await api.post(`/project/wizard/${deploymentId}/approve-file`, {
          proposalId: proposal.id
        });
      }
      
      // Clear all proposals and close modal
      setFileProposals([]);
      setShowFileApprovalModal(false);
    } catch (err) {
      console.error('Failed to approve all files:', err);
      throw new Error(err.response?.data?.error || 'Failed to approve all files');
    }
  };

  // Handle reject all files
  const handleRejectAll = async () => {
    try {
      // Reject all files in sequence
      for (const proposal of fileProposals) {
        await api.post(`/project/wizard/${deploymentId}/reject-file`, {
          proposalId: proposal.id
        });
      }
      
      // Clear all proposals and close modal
      setFileProposals([]);
      setShowFileApprovalModal(false);
    } catch (err) {
      console.error('Failed to reject all files:', err);
      throw new Error(err.response?.data?.error || 'Failed to reject all files');
    }
  };

  // Get timestamp for terminal output
  const getTimestamp = () => {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Execute a command with streaming - now with command tracking and auto-verification
  const executeCommand = async (command, isFixCommand = false, isRetryCommand = false) => {
    const cmdKey = command.command;
    setExecutingCommand(cmdKey);
    setIsStreaming(true);
    
    // Update command status to running
    setCommandStatus(prev => ({
      ...prev,
      [cmdKey]: { status: 'running', output: [] }
    }));
    
    // Add separator and command header to terminal (don't clear - persist output)
    const separator = terminalOutput.length > 0 
      ? [{ type: 'separator', content: `\n${'─'.repeat(50)}\n` }]
      : [];
    
    setTerminalOutput(prev => [
      ...prev,
      ...separator,
      { type: 'timestamp', content: `[${getTimestamp()}]` },
      { type: 'info', content: `$ ${cmdKey}` },
      ...(isFixCommand ? [{ type: 'info', content: '(Fix command)' }] : []),
      ...(isRetryCommand ? [{ type: 'info', content: '(Retry)' }] : [])
    ]);
    
    let commandOutput = [];
    let exitCode = null;
    let success = false;
    
    try {
      const token = localStorage.getItem('token');
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5002/api/v1';
      
      const response = await fetch(`${apiUrl}/cli/execute-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        credentials: 'include',
        body: JSON.stringify({
          deploymentId,
          command: cmdKey
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'stdout') {
                const outputLine = { type: 'stdout', content: parsed.content };
                commandOutput.push(outputLine);
                setTerminalOutput(prev => [...prev, outputLine]);
              } else if (parsed.type === 'stderr') {
                const outputLine = { type: 'stderr', content: parsed.content };
                commandOutput.push(outputLine);
                setTerminalOutput(prev => [...prev, outputLine]);
              } else if (parsed.type === 'complete') {
                exitCode = parsed.exitCode;
                success = parsed.success;
                const resultLine = { 
                  type: success ? 'success' : 'error', 
                  content: `\n${success ? '✓' : '✗'} Command ${success ? 'completed successfully' : 'failed'} (exit code: ${exitCode})`
                };
                setTerminalOutput(prev => [...prev, resultLine]);
              } else if (parsed.type === 'error') {
                const errorLine = { type: 'error', content: `Error: ${parsed.error}` };
                commandOutput.push(errorLine);
                setTerminalOutput(prev => [...prev, errorLine]);
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', data, e);
            }
          }
        }
      }

      // Determine final success status
      const finalSuccess = success || exitCode === 0;
      
      // Update command status
      setCommandStatus(prev => ({
        ...prev,
        [cmdKey]: { 
          status: finalSuccess ? 'success' : 'failed', 
          exitCode, 
          output: commandOutput 
        }
      }));
      
      // Update command results for UI
      const result = { 
        success: finalSuccess, 
        exitCode,
        output: commandOutput.map(o => o.content).join('\n')
      };
      setCommandResults(prev => ({ ...prev, [cmdKey]: result }));

      // Record in wizard backend using new execute-command endpoint
      const executeResult = await api.post(`/project/wizard/${deploymentId}/execute-command`, {
        command: cmdKey,
        success: finalSuccess,
        exitCode,
        output: commandOutput.map(o => o.content).join('\n')
      });
      
      // Update queue state from backend response
      if (executeResult.data.success) {
        const { isBlocked: nowBlocked, nextCommand, progress } = executeResult.data.data;
        setIsBlocked(nowBlocked);
        setCurrentCommandIndex(progress?.completed || 0);
        
        if (nowBlocked) {
          // Command failed - update blocking error state
          setBlockingError({
            command: cmdKey,
            exitCode,
            errorOutput: commandOutput.map(o => o.content).join('\n')
          });
          setFixMode(true);
        }
        
        // Update command queue status
        await refreshCommandQueue();
      }
      
      // Also record using old endpoint for backward compatibility
      await api.post(`/project/wizard/${deploymentId}/record`, {
        stage: currentStageId,
        command: cmdKey,
        result
      });

    } catch (err) {
      console.error('Execute command error:', err);
      const errorLine = { type: 'error', content: `Error: ${err.message}` };
      setTerminalOutput(prev => [...prev, errorLine]);
      
      setCommandStatus(prev => ({
        ...prev,
        [cmdKey]: { status: 'failed', error: err.message, output: [...commandOutput, errorLine] }
      }));
      
      setCommandResults(prev => ({
        ...prev,
        [cmdKey]: { success: false, error: err.message }
      }));
      
      // Record failure in backend
      try {
        await api.post(`/project/wizard/${deploymentId}/execute-command`, {
          command: cmdKey,
          success: false,
          exitCode: -1,
          output: err.message
        });
        
        // Update blocked state
        setIsBlocked(true);
        setBlockingError({
          command: cmdKey,
          exitCode: -1,
          errorOutput: err.message
        });
        setFixMode(true);
        
        await refreshCommandQueue();
      } catch (recordErr) {
        console.error('Failed to record command result:', recordErr);
      }
      
    } finally {
      setExecutingCommand(null);
      setIsStreaming(false);
    }
  };
  
  // Refresh command queue from backend
  const refreshCommandQueue = async () => {
    try {
      const response = await api.get(`/project/wizard/${deploymentId}/command-queue`);
      if (response.data.success) {
        const { queue, currentIndex, isBlocked: blocked, blockingError: error, progress } = response.data.data;
        setCommandQueue(queue || []);
        setCurrentCommandIndex(currentIndex || 0);
        setIsBlocked(blocked || false);
        setBlockingError(error || null);
        
        // Update command status from queue
        const newStatus = {};
        for (const cmd of (queue || [])) {
          newStatus[cmd.command] = {
            status: cmd.status,
            exitCode: cmd.exitCode,
            output: cmd.output ? [{ type: 'stdout', content: cmd.output }] : []
          };
        }
        setCommandStatus(prev => ({ ...prev, ...newStatus }));
      }
    } catch (err) {
      console.error('Failed to refresh command queue:', err);
    }
  };
  
  // Execute next command in the queue automatically
  const executeNextCommand = async () => {
    if (isBlocked) {
      console.log('Blocked by error - need to resolve first');
      return;
    }
    
    try {
      const response = await api.get(`/project/wizard/${deploymentId}/next-command`);
      if (response.data.success) {
        const { command, isBlocked: blocked, progress } = response.data.data;
        
        if (blocked) {
          setIsBlocked(true);
          return;
        }
        
        if (command) {
          // Execute this command
          await executeCommand(command, command.isFixCommand, command.isRetryCommand);
        } else {
          // No more commands - check if all done
          if (progress.completed >= progress.total && progress.total > 0) {
            console.log('All commands completed - triggering verification');
            await autoVerifyStage();
          }
        }
      }
    } catch (err) {
      console.error('Failed to get next command:', err);
    }
  };
  
  // Start auto-execution of all commands
  const startAutoExecution = async () => {
    setIsAutoExecuting(true);
    
    try {
      // Get first command
      const response = await api.get(`/project/wizard/${deploymentId}/next-command`);
      if (response.data.success) {
        const { command, isBlocked: blocked } = response.data.data;
        
        if (!blocked && command) {
          await executeCommand(command, command.isFixCommand, command.isRetryCommand);
        }
      }
    } catch (err) {
      console.error('Auto-execution failed:', err);
    } finally {
      setIsAutoExecuting(false);
    }
  };
  
  // Resolve blocking error with Claude
  const resolveBlockingError = async () => {
    if (!isBlocked || !blockingError) return;
    
    setIsResolvingError(true);
    
    try {
      const response = await api.post(`/project/wizard/${deploymentId}/resolve-error`, {
        stageId: currentStageId
      });
      
      if (response.data.success) {
        const { analysis, fixCommands: fixes, nextCommand } = response.data.data;
        
        setErrorAnalysis(analysis);
        setFixCommands(fixes || []);
        setIsBlocked(false);
        setBlockingError(null);
        
        // Refresh the command queue
        await refreshCommandQueue();
        
        // Add analysis to terminal
        setTerminalOutput(prev => [
          ...prev,
          { type: 'separator', content: `\n${'═'.repeat(50)}\n` },
          { type: 'info', content: '🔍 Claude Error Analysis:\n' },
          { type: 'stdout', content: analysis }
        ]);
      }
    } catch (err) {
      console.error('Failed to resolve error:', err);
      setErrorAnalysis(`Failed to analyze error: ${err.message}`);
    } finally {
      setIsResolvingError(false);
    }
  };
  
  // Skip blocked command and continue
  const skipBlockedCommand = async () => {
    try {
      const response = await api.post(`/project/wizard/${deploymentId}/skip-command`);
      
      if (response.data.success) {
        setIsBlocked(false);
        setBlockingError(null);
        setFixMode(false);
        
        await refreshCommandQueue();
        
        setTerminalOutput(prev => [
          ...prev,
          { type: 'info', content: '⏭️ Skipped failed command, continuing with next...' }
        ]);
      }
    } catch (err) {
      console.error('Failed to skip command:', err);
    }
  };
  
  // Check if all commands are done and trigger auto-verification
  const checkAutoVerify = async (lastCommand, lastSuccess, lastExitCode, lastOutput) => {
    // Get current commands to check (either regular commands, fix commands, or retry commands)
    const currentCommands = fixMode 
      ? [...fixCommands, ...retryCommands]
      : commands;
    
    if (currentCommands.length === 0) return;
    
    // Get latest command status (including the just-completed command)
    const updatedStatus = {
      ...commandStatus,
      [lastCommand]: { 
        status: lastSuccess ? 'success' : 'failed', 
        exitCode: lastExitCode, 
        output: lastOutput 
      }
    };
    
    // Check if all commands have been executed
    const allCommandsRun = currentCommands.every(cmd => 
      updatedStatus[cmd.command]?.status === 'success' || 
      updatedStatus[cmd.command]?.status === 'failed'
    );
    
    if (!allCommandsRun) {
      console.log('Not all commands run yet, skipping auto-verify');
      return;
    }
    
    // Find any failed commands
    const failedCmds = currentCommands.filter(cmd => 
      updatedStatus[cmd.command]?.status === 'failed'
    );
    
    if (failedCmds.length > 0) {
      // There are failures - analyze them
      console.log(`${failedCmds.length} command(s) failed, triggering error analysis`);
      await analyzeFailedCommands(failedCmds, updatedStatus);
    } else {
      // All commands succeeded - auto-verify the stage
      console.log('All commands succeeded, triggering auto-verify');
      await autoVerifyStage();
    }
  };
  
  // Analyze failed commands with Claude
  const analyzeFailedCommands = async (failedCmds, statusMap) => {
    setIsVerifying(true);
    setErrorAnalysis(null);
    
    try {
      const failedCommandsData = failedCmds.map(cmd => ({
        command: cmd.command,
        exitCode: statusMap[cmd.command]?.exitCode,
        errorOutput: statusMap[cmd.command]?.output
          ?.filter(o => o.type === 'stderr' || o.type === 'error')
          ?.map(o => o.content)
          ?.join('\n') || ''
      }));
      
      const response = await api.post('/project/wizard/step', {
        deploymentId,
        stage: currentStageId,
        action: 'analyze-errors',
        failedCommands: failedCommandsData,
        projectContext
      });
      
      if (response.data.success) {
        const { analysis, fixCommands: fixes, retryCommands: retries } = response.data.data;
        
        setErrorAnalysis(analysis);
        setFixCommands(fixes || []);
        setRetryCommands(retries || []);
        setFixMode(true);
        
        // Add analysis to terminal
        setTerminalOutput(prev => [
          ...prev,
          { type: 'separator', content: `\n${'═'.repeat(50)}\n` },
          { type: 'info', content: '🔍 Claude Error Analysis:\n' },
          { type: 'stdout', content: analysis }
        ]);
      }
    } catch (err) {
      console.error('Failed to analyze errors:', err);
      setErrorAnalysis(`Failed to analyze errors: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };
  
  // Auto-verify the stage after all commands succeed
  const autoVerifyStage = async () => {
    setIsVerifying(true);
    setVerificationResult(null);
    
    try {
      const response = await api.post('/project/wizard/step', {
        deploymentId,
        stage: currentStageId,
        action: 'auto-verify',
        projectContext
      });
      
      if (response.data.success) {
        const result = response.data.data;
        setVerificationResult(result);
        
        // Add verification result to terminal
        setTerminalOutput(prev => [
          ...prev,
          { type: 'separator', content: `\n${'═'.repeat(50)}\n` },
          { type: 'info', content: '🔍 Stage Verification:\n' },
          { type: result.passed ? 'success' : 'error', 
            content: result.passed ? '✓ Stage verified successfully!' : '✗ Stage verification failed' },
          { type: 'stdout', content: result.analysis || '' }
        ]);
        
        if (result.passed && result.shouldAdvance) {
          // Auto-advance to next stage after a brief delay
          setTerminalOutput(prev => [
            ...prev,
            { type: 'success', content: '\n→ Advancing to next stage...' }
          ]);
          
          setTimeout(() => {
            completeStage();
          }, 1500);
        } else if (!result.passed && result.fixCommands) {
          // Enter fix mode
          setFixCommands(result.fixCommands || []);
          setRetryCommands(result.retryCommands || []);
          setErrorAnalysis(result.analysis);
          setFixMode(true);
        }
      }
    } catch (err) {
      console.error('Auto-verify failed:', err);
      setVerificationResult({ passed: false, error: err.message });
    } finally {
      setIsVerifying(false);
    }
  };
  
  // Exit fix mode and clear fix-related state
  const exitFixMode = () => {
    setFixMode(false);
    setFixCommands([]);
    setRetryCommands([]);
    setErrorAnalysis(null);
  };
  
  // Regenerate current stage instructions
  const regenerateStage = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Clear current stage data
      setInstructions('');
      setCommands([]);
      setCommandResults({});
      setVerificationResult(null);
      
      // Re-run the stage
      const response = await api.post('/project/wizard/step', {
        deploymentId,
        stage: currentStageId,
        action: 'regenerate', // Signal to regenerate
        projectContext
      });
      
      if (response.data.success) {
        const { instructions: newInstructions, commands: newCommands } = response.data.data;
        setInstructions(newInstructions);
        setCommands(newCommands || []);
        
        setChatMessages(prev => [
          ...prev,
          {
            type: 'system',
            content: '🔄 Stage instructions regenerated',
            timestamp: new Date()
          }
        ]);
      }
    } catch (err) {
      console.error('Regenerate failed:', err);
      setError('Failed to regenerate stage: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };
  
  // Send custom AI chat message
  const sendAIChat = async () => {
    if (!aiChatInput.trim()) return;
    
    const userMessage = aiChatInput.trim();
    setAIChatInput('');
    setAIChatLoading(true);
    
    // Add user message to chat
    setChatMessages(prev => [
      ...prev,
      {
        type: 'user',
        content: userMessage,
        timestamp: new Date()
      }
    ]);
    
    try {
      const response = await api.post(`/project/wizard/${deploymentId}/chat`, {
        message: userMessage,
        currentStage: currentStageId
      });
      
      if (response.data.success) {
        const { message: aiResponse, instructions: newInstructions, commands: newCommands } = response.data.data;
        
        // Add AI response to chat
        setChatMessages(prev => [
          ...prev,
          {
            type: 'assistant',
            content: aiResponse || newInstructions || 'I received your message.',
            timestamp: new Date()
          }
        ]);
        
        // Update stage instructions if provided (optional - only if Claude suggests changes)
        if (newInstructions && newInstructions !== aiResponse) {
          setInstructions(newInstructions);
        }
        if (newCommands && newCommands.length > 0) {
          setCommands(newCommands);
        }
      }
    } catch (err) {
      console.error('AI chat failed:', err);
      setChatMessages(prev => [
        ...prev,
        {
          type: 'error',
          content: 'Failed to send message: ' + (err.response?.data?.error || err.message),
          timestamp: new Date()
        }
      ]);
    } finally {
      setAIChatLoading(false);
    }
  };

  // Complete current stage
  const completeStage = async () => {
    setLoading(true);
    
    try {
      const response = await api.post('/project/wizard/step', {
        deploymentId,
        stage: currentStageId,
        action: 'complete',
        success: true,
        projectContext // Pass projectContext for session restoration
      });
      
      if (response.data.success) {
        const { nextStage, isComplete } = response.data.data;
        
        setStageHistory(prev => [...prev, { stage: currentStageId, success: true }]);
        
        if (isComplete) {
          // Wizard complete!
          if (onStageComplete) {
            onStageComplete({ complete: true });
          }
        } else if (nextStage) {
          setCurrentStageId(nextStage.id);
          await loadStageInstructions(nextStage.id);
        }
      }
    } catch (err) {
      console.error('Complete stage error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to complete stage';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // Go to previous stage
  const goToPreviousStage = async () => {
    const currentIndex = stages.findIndex(s => s.id === currentStageId);
    if (currentIndex > 0) {
      const prevStage = stages[currentIndex - 1];
      setCurrentStageId(prevStage.id);
      await loadStageInstructions(prevStage.id);
    }
  };

  const currentStage = stages.find(s => s.id === currentStageId);
  const currentStageIndex = stages.findIndex(s => s.id === currentStageId);
  const progress = stages.length > 0 ? ((currentStageIndex + 1) / stages.length) * 100 : 0;

  return (
    <div className={`flex flex-col h-full bg-gradient-to-br from-gray-900 via-gray-900 to-gray-800 rounded-xl border border-gray-700/50 overflow-hidden shadow-2xl ${className}`}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-700/50 bg-gradient-to-r from-purple-900/30 via-gray-900 to-blue-900/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-blue-600 mr-3 shadow-lg">
              <SparklesIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Claude Deployment Wizard</h2>
              <p className="text-xs text-gray-500">AI-powered step-by-step deployment</p>
            </div>
          </div>
          {!initialized ? (
            <button
              onClick={initWizard}
              disabled={loading || !deploymentId}
              className="flex items-center px-5 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-all shadow-lg hover:shadow-xl"
            >
              {loading ? (
                <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <PlayIcon className="w-5 h-5 mr-2" />
              )}
              Start Wizard
            </button>
          ) : (
            <div className="flex items-center space-x-4">
              <div className="flex items-center text-xs text-green-400 bg-green-600/10 px-3 py-1.5 rounded-full border border-green-500/20">
                <CheckCircleIcon className="w-3.5 h-3.5 mr-1.5" />
                Session Persisted
              </div>
              <div className="text-xs text-gray-400 bg-gray-800 px-3 py-1.5 rounded-full">
                Step <span className="font-semibold text-white">{currentStageIndex + 1}</span> of <span className="font-semibold text-white">{stages.length}</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Progress bar */}
        {initialized && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span>Progress</span>
              <span className="font-medium text-white">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-500 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Stage indicators */}
      {initialized && (
        <div className="px-4 py-3 border-b border-gray-700/50 overflow-x-auto bg-gray-900/30">
          <div className="flex items-center space-x-2">
            {stages.map((stage, index) => {
              const historyItem = stageHistory.find(h => h.stage === stage.id);
              return (
                <React.Fragment key={stage.id}>
                  <StageIndicator
                    stage={stage}
                    status={historyItem?.success ? 'completed' : historyItem?.success === false ? 'failed' : 'pending'}
                    isCurrent={stage.id === currentStageId}
                    onClick={() => {
                      setCurrentStageId(stage.id);
                      loadStageInstructions(stage.id);
                    }}
                  />
                  {index < stages.length - 1 && (
                    <ChevronRightIcon className="w-4 h-4 text-gray-600 flex-shrink-0" />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
        {!initialized ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <div className="relative mb-6">
              <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 flex items-center justify-center">
                <SparklesIcon className="w-12 h-12 text-purple-400" />
              </div>
              <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center shadow-lg">
                <PlayIcon className="w-4 h-4 text-white" />
              </div>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Ready to Deploy?</h3>
            <p className="text-sm text-gray-400 text-center max-w-md mb-6">
              Claude will guide you through each step of the deployment process, 
              from project analysis to health checks.
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              {['Analyze', 'Configure', 'Build', 'Test', 'Deploy'].map((step) => (
                <span key={step} className="px-3 py-1.5 bg-gray-800 text-gray-400 rounded-full border border-gray-700">
                  {step}
                </span>
              ))}
            </div>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="relative">
              <ArrowPathIcon className="w-12 h-12 text-blue-400 animate-spin" />
            </div>
            <p className="text-sm text-gray-400 mt-4">Loading stage instructions...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-xl bg-red-600/20 flex items-center justify-center mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-400" />
            </div>
            <h4 className="text-base font-semibold text-red-400 mb-2">Something went wrong</h4>
            <p className="text-sm text-gray-400 text-center max-w-md">{error}</p>
            <button 
              onClick={() => setError(null)}
              className="mt-4 px-4 py-2 text-sm text-gray-300 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current stage info */}
            {currentStage && (
              <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 rounded-xl p-5 border border-gray-700/50 shadow-lg">
                <div className="flex items-start justify-between">
                  <div className="flex items-start">
                    <div className={`flex items-center justify-center w-12 h-12 rounded-xl mr-4 ${
                      fixMode ? 'bg-red-600/20' :
                      isVerifying ? 'bg-blue-600/20' :
                      'bg-purple-600/20'
                    }`}>
                      {(() => {
                        const Icon = STAGE_ICONS[currentStage.id] || SparklesIcon;
                        return <Icon className={`w-6 h-6 ${
                          fixMode ? 'text-red-400' :
                          isVerifying ? 'text-blue-400' :
                          'text-purple-400'
                        }`} />;
                      })()}
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className="text-xl font-bold text-white">{currentStage.name}</h3>
                        <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                          Step {currentStageIndex + 1}/{stages.length}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 max-w-xl">{currentStage.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {/* Regenerate button */}
                    <button
                      onClick={regenerateStage}
                      disabled={loading || isVerifying}
                      className="flex items-center px-3 py-1.5 text-sm text-purple-400 hover:text-purple-300 bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 hover:border-purple-500/50 rounded-lg transition-all disabled:opacity-50"
                      title="Regenerate stage instructions"
                    >
                      <ArrowPathIcon className="w-4 h-4 mr-1.5" />
                      Regenerate
                    </button>
                    
                    {/* Chat with AI button */}
                    <button
                      onClick={() => setShowAIChat(!showAIChat)}
                      className={`flex items-center px-3 py-1.5 text-sm rounded-lg transition-all ${
                        showAIChat
                          ? 'text-blue-400 bg-blue-600/20 border border-blue-500/50'
                          : 'text-blue-400 hover:text-blue-300 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/30 hover:border-blue-500/50'
                      }`}
                      title="Chat with AI"
                    >
                      <ChatBubbleLeftRightIcon className="w-4 h-4 mr-1.5" />
                      Chat with AI
                    </button>
                    
                    {fixMode && (
                      <span className="flex items-center px-3 py-1.5 bg-red-600/20 text-red-400 text-xs font-medium rounded-full border border-red-500/30">
                        <ExclamationTriangleIcon className="w-3.5 h-3.5 mr-1.5" />
                        Fix Mode
                      </span>
                    )}
                    {isVerifying && (
                      <span className="flex items-center px-3 py-1.5 bg-blue-600/20 text-blue-400 text-xs font-medium rounded-full border border-blue-500/30">
                        <ArrowPathIcon className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Verifying Stage
                      </span>
                    )}
                    {verificationResult?.passed && !fixMode && !isVerifying && (
                      <span className="flex items-center px-3 py-1.5 bg-green-600/20 text-green-400 text-xs font-medium rounded-full border border-green-500/30">
                        <CheckCircleIcon className="w-3.5 h-3.5 mr-1.5" />
                        Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Fix Mode Banner */}
            {fixMode && errorAnalysis && (
              <div className="bg-gradient-to-br from-red-900/30 via-gray-900 to-gray-900 rounded-xl p-5 border border-red-500/30 shadow-xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-600/20 mr-3">
                      <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
                </div>
                    <div>
                      <h4 className="text-base font-semibold text-red-400">Commands Failed</h4>
                      <p className="text-xs text-gray-500">Claude has analyzed the errors and provided fixes</p>
                    </div>
                  </div>
                  <button
                    onClick={exitFixMode}
                    className="flex items-center px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
                    title="Exit fix mode"
                  >
                    <XCircleIcon className="w-4 h-4 mr-1" />
                    Dismiss
                  </button>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-4 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  <MarkdownRenderer content={errorAnalysis} />
                </div>
              </div>
            )}
            
            {/* AI Chat Panel */}
            {showAIChat && (
              <div className="bg-gradient-to-br from-blue-900/20 via-gray-900 to-gray-900 rounded-xl border border-blue-500/30 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-blue-500/20 bg-blue-600/10">
                  <div className="flex items-center">
                    <ChatBubbleLeftRightIcon className="w-5 h-5 text-blue-400 mr-2" />
                    <h4 className="text-sm font-semibold text-blue-300">Chat with AI</h4>
                  </div>
                  <button
                    onClick={() => setShowAIChat(false)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <XCircleIcon className="w-5 h-5" />
                  </button>
                </div>
                
                {/* Chat messages */}
                <div className="max-h-[300px] overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-gray-500 text-sm py-8">
                      <ChatBubbleLeftRightIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                      <p>Ask Claude anything about this stage</p>
                      <p className="text-xs mt-1">Type your question below</p>
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg px-4 py-2 ${
                            msg.type === 'user'
                              ? 'bg-blue-600 text-white'
                              : msg.type === 'error'
                              ? 'bg-red-600/20 text-red-400 border border-red-500/30'
                              : msg.type === 'system'
                              ? 'bg-gray-700 text-gray-300 text-sm italic'
                              : 'bg-gray-800 text-gray-200'
                          }`}
                        >
                          <div className="text-sm whitespace-pre-wrap">
                            {msg.type === 'assistant' ? (
                              <MarkdownRenderer content={msg.content} />
                            ) : (
                              msg.content
                            )}
                          </div>
                          <div className="text-xs opacity-60 mt-1">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {aiChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-800 text-gray-400 rounded-lg px-4 py-2 flex items-center">
                        <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
                        Claude is thinking...
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Chat input */}
                <div className="px-4 py-3 border-t border-blue-500/20 bg-blue-600/5">
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={aiChatInput}
                      onChange={(e) => setAIChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendAIChat();
                        }
                      }}
                      placeholder="Ask Claude for help or clarification..."
                      className="flex-1 bg-gray-900/50 border border-gray-600 rounded-lg px-4 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={aiChatLoading}
                    />
                    <button
                      onClick={sendAIChat}
                      disabled={!aiChatInput.trim() || aiChatLoading}
                      className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                    >
                      <PaperAirplaneIcon className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Press Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </div>
            )}

            {/* Fix Mode Banner */}
            {fixMode && errorAnalysis && !showAIChat && (
              <div className="bg-gradient-to-br from-red-900/30 via-gray-900 to-gray-900 rounded-xl p-5 border border-red-500/30 shadow-xl">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-red-600/20 mr-3">
                      <ExclamationTriangleIcon className="w-6 h-6 text-red-400" />
                </div>
                    <div>
                      <h4 className="text-base font-semibold text-red-400">Commands Failed</h4>
                      <p className="text-xs text-gray-500">Claude has analyzed the errors and provided fixes</p>
                    </div>
                  </div>
                  <button
                    onClick={exitFixMode}
                    className="flex items-center px-3 py-1.5 text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
                    title="Exit fix mode"
                  >
                    <XCircleIcon className="w-4 h-4 mr-1" />
                    Dismiss
                  </button>
                </div>
                <div className="bg-gray-900/50 rounded-lg p-4 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                  <MarkdownRenderer content={errorAnalysis} />
                </div>
              </div>
            )}

            {/* Fix Commands */}
            {fixMode && fixCommands.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center bg-yellow-900/20 rounded-lg px-4 py-3 border border-yellow-500/30">
                  <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 mr-2" />
                  <div>
                    <h4 className="text-sm font-semibold text-yellow-400">Step 1: Run Fix Commands</h4>
                    <p className="text-xs text-gray-400">These commands will fix the issues before retrying</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {fixCommands.map((command, index) => (
                    <CommandCard
                      key={`fix-${index}`}
                      index={index}
                      command={command}
                      onExecute={(cmd) => executeCommand(cmd, true, false)}
                      isExecuting={executingCommand === command.command}
                      result={commandResults[command.command]}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Retry Commands */}
            {fixMode && retryCommands.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center bg-blue-900/20 rounded-lg px-4 py-3 border border-blue-500/30">
                  <ArrowPathIcon className="w-5 h-5 text-blue-400 mr-2" />
                  <div>
                    <h4 className="text-sm font-semibold text-blue-400">Step 2: Retry Original Commands</h4>
                    <p className="text-xs text-gray-400">After fixes are applied, re-run these commands</p>
                  </div>
                </div>
              <div className="space-y-3">
                  {retryCommands.map((command, index) => (
                    <CommandCard
                      key={`retry-${index}`}
                      index={index}
                      command={command}
                      onExecute={(cmd) => executeCommand(cmd, false, true)}
                      isExecuting={executingCommand === command.command}
                      result={commandResults[command.command]}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* File Generation Workflow - for GENERATE and related stages */}
            {!fixMode && currentStageId && ['GENERATE', 'GENERATE_README', 'AWAIT_CURSOR_GENERATION', 'AWAIT_FILE_UPLOAD', 'VERIFY_FILES', 'FILES_VERIFIED'].includes(currentStageId) && (
              <FileGenerationWorkflow
                deploymentId={deploymentId}
                stageId={currentStageId}
                onComplete={() => {
                  // Move to next stage
                  const nextStageIndex = stages.findIndex(s => s.id === currentStageId) + 1;
                  if (nextStageIndex < stages.length) {
                    const nextStage = stages[nextStageIndex];
                    setCurrentStageId(nextStage.id);
                    loadStageInstructions(nextStage.id);
                  }
                }}
                onError={(error) => {
                  setError(error.message || 'File generation workflow error');
                }}
              />
            )}

            {/* Claude instructions - only show when not in fix mode and not in file generation workflow */}
            {!fixMode && instructions && !['GENERATE', 'GENERATE_README', 'AWAIT_CURSOR_GENERATION', 'AWAIT_FILE_UPLOAD', 'VERIFY_FILES', 'FILES_VERIFIED'].includes(currentStageId) && (
              <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-purple-900/10 rounded-xl p-5 border border-gray-700/50 shadow-xl">
                <div className="flex items-center mb-4 pb-3 border-b border-gray-700/50">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-600/20 mr-3">
                    <SparklesIcon className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Claude's Guidance</h3>
                    <p className="text-xs text-gray-500">Step-by-step instructions for this stage</p>
                  </div>
                </div>
                <div className="text-sm max-h-[400px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent pr-2">
                  <MarkdownRenderer content={instructions} />
                </div>
              </div>
            )}

            {/* Command Queue Progress & Controls */}
            {!fixMode && commandQueue.length > 0 && (
              <div className="bg-gradient-to-r from-blue-900/20 via-gray-900 to-gray-900 rounded-xl p-4 border border-blue-500/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-blue-600/20">
                      <CommandLineIcon className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">Command Queue</h4>
                      <p className="text-xs text-gray-500">
                        {currentCommandIndex} of {commandQueue.length} completed
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {isBlocked ? (
                      <>
                        <button
                          onClick={resolveBlockingError}
                          disabled={isResolvingError || isStreaming}
                          className="flex items-center px-3 py-1.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          {isResolvingError ? (
                            <ArrowPathIcon className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <WrenchScrewdriverIcon className="w-4 h-4 mr-1.5" />
                          )}
                          Analyze & Fix
                        </button>
                        <button
                          onClick={skipBlockedCommand}
                          disabled={isStreaming}
                          className="flex items-center px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          <ChevronDoubleRightIcon className="w-4 h-4 mr-1" />
                          Skip
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={startAutoExecution}
                        disabled={isAutoExecuting || isStreaming || executingCommand}
                        className="flex items-center px-3 py-1.5 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors shadow-lg"
                      >
                        {isAutoExecuting || executingCommand ? (
                          <ArrowPathIcon className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <PlayIcon className="w-4 h-4 mr-1.5" />
                        )}
                        {currentCommandIndex === 0 ? 'Start All' : 'Continue'}
                      </button>
                    )}
                  </div>
                </div>
                
                {/* Queue Progress Bar */}
                <div className="relative h-3 bg-gray-800 rounded-full overflow-hidden mb-3">
                  <div 
                    className="absolute left-0 top-0 h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500 ease-out"
                    style={{ width: `${commandQueue.length > 0 ? (currentCommandIndex / commandQueue.length) * 100 : 0}%` }}
                  />
                  {isStreaming && (
                    <div 
                      className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse"
                      style={{ left: `${commandQueue.length > 0 ? (currentCommandIndex / commandQueue.length) * 100 : 0}%` }}
                    />
                  )}
                </div>
                
                {/* Compact Queue View */}
                <div className="flex flex-wrap gap-1.5">
                  {commandQueue.map((cmd, idx) => {
                    const status = cmd.status || commandStatus[cmd.command]?.status || 'pending';
                    const isCurrent = idx === currentCommandIndex;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center px-2 py-1 rounded-md text-xs font-mono transition-all ${
                          status === 'success' ? 'bg-green-600/20 text-green-400 border border-green-500/30' :
                          status === 'failed' ? 'bg-red-600/20 text-red-400 border border-red-500/30' :
                          status === 'running' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 animate-pulse' :
                          status === 'skipped' ? 'bg-gray-700/50 text-gray-500 border border-gray-600/30 line-through' :
                          isCurrent ? 'bg-purple-600/20 text-purple-400 border border-purple-500/30' :
                          'bg-gray-800 text-gray-500 border border-gray-700/30'
                        }`}
                        title={cmd.command}
                      >
                        {status === 'success' && <CheckCircleIcon className="w-3 h-3 mr-1" />}
                        {status === 'failed' && <XCircleIcon className="w-3 h-3 mr-1" />}
                        {status === 'running' && <ArrowPathIcon className="w-3 h-3 mr-1 animate-spin" />}
                        {idx + 1}
                        {cmd.isFixCommand && <WrenchScrewdriverIcon className="w-3 h-3 ml-1 text-yellow-400" />}
                      </div>
                    );
                  })}
                </div>
                
                {/* Blocking Error Banner */}
                {isBlocked && blockingError && (
                  <div className="mt-3 p-3 bg-red-900/30 rounded-lg border border-red-500/30">
                    <div className="flex items-start">
                      <ExclamationTriangleIcon className="w-5 h-5 text-red-400 mr-2 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-red-400">Command Failed</p>
                        <code className="text-xs text-red-300 font-mono break-all">{blockingError.command}</code>
                        <p className="text-xs text-gray-400 mt-1">Exit code: {blockingError.exitCode}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Commands - only show when not in fix mode */}
            {!fixMode && commands.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3">
                  <div className="flex items-center">
                    <CommandLineIcon className="w-5 h-5 text-blue-400 mr-2" />
                    <h4 className="text-sm font-semibold text-white">Commands to Execute</h4>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-gray-400">
                        {Object.values(commandStatus).filter(s => s.status === 'success').length} done
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs text-gray-400">
                        {Object.values(commandStatus).filter(s => s.status === 'failed').length} failed
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div className="w-2 h-2 rounded-full bg-gray-500" />
                      <span className="text-xs text-gray-400">
                        {commands.length - Object.keys(commandStatus).length} pending
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                {commands.map((command, index) => {
                  const queuedCmd = commandQueue.find(c => c.command === command.command);
                  const isCurrentInQueue = queuedCmd && commandQueue.indexOf(queuedCmd) === currentCommandIndex;
                  return (
                    <CommandCard
                      key={index}
                      index={index}
                      command={command}
                      onExecute={executeCommand}
                      isExecuting={executingCommand === command.command}
                      result={commandResults[command.command]}
                      isCurrentInQueue={isCurrentInQueue}
                      isBlocked={isBlocked}
                    />
                  );
                })}
                </div>
              </div>
            )}

            {/* Verification Result */}
            {verificationResult && !fixMode && (
              <div className={`rounded-xl p-5 border shadow-lg ${
                verificationResult.passed 
                  ? 'bg-gradient-to-br from-green-900/30 via-gray-900 to-gray-900 border-green-500/30' 
                  : 'bg-gradient-to-br from-yellow-900/30 via-gray-900 to-gray-900 border-yellow-500/30'
              }`}>
                <div className="flex items-start">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-lg mr-3 ${
                    verificationResult.passed ? 'bg-green-600/20' : 'bg-yellow-600/20'
                  }`}>
                    {verificationResult.passed ? (
                      <CheckCircleIcon className="w-6 h-6 text-green-400" />
                    ) : (
                      <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className={`text-base font-semibold mb-1 ${
                      verificationResult.passed ? 'text-green-400' : 'text-yellow-400'
                    }`}>
                      {verificationResult.passed ? '✓ Stage Verified Successfully!' : '⚠ Verification Incomplete'}
                    </h4>
                    {verificationResult.analysis && (
                      <div className="text-sm text-gray-300 bg-gray-900/50 rounded-lg p-3 mt-2">
                        <MarkdownRenderer content={verificationResult.analysis} />
              </div>
            )}
                  </div>
                </div>
              </div>
            )}

            {/* Terminal output - always visible */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <CommandLineIcon className="w-5 h-5 text-green-400 mr-2" />
                  <h4 className="text-sm font-semibold text-white">Terminal Output</h4>
                </div>
                {terminalOutput.length > 0 && (
                  <span className="text-xs text-gray-500">
                    {terminalOutput.filter(l => l.type !== 'separator').length} lines
                  </span>
                )}
              </div>
              <TerminalOutput 
                output={terminalOutput} 
                isStreaming={isStreaming}
                onClear={() => setTerminalOutput([])}
                currentCommand={executingCommand}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer navigation */}
      {initialized && (
        <div className="px-5 py-4 border-t border-gray-700/50 bg-gray-900/50 flex items-center justify-between">
          <button
            onClick={goToPreviousStage}
            disabled={currentStageIndex === 0 || loading || isVerifying}
            className="flex items-center px-4 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-50 rounded-lg transition-all"
          >
            <ChevronLeftIcon className="w-5 h-5 mr-1" />
            Previous Step
          </button>
          
          <div className="flex items-center space-x-3">
            {/* Manual verify button */}
            {!isVerifying && !verificationResult?.passed && commands.length > 0 && (
              <button
                onClick={autoVerifyStage}
                disabled={loading || isVerifying}
                className="flex items-center px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-600 hover:border-gray-500 rounded-xl transition-all"
              >
                <ArrowPathIcon className="w-4 h-4 mr-2" />
                Verify Stage
              </button>
            )}
            
            {/* Next/Complete button */}
            <button
              onClick={completeStage}
              disabled={loading || isVerifying || fixMode}
              className={`flex items-center px-5 py-2.5 text-sm font-medium rounded-xl transition-all shadow-lg hover:shadow-xl ${
                verificationResult?.passed
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isVerifying ? (
                <>
                  <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
                  Verifying Stage...
                </>
              ) : currentStageIndex === stages.length - 1 ? (
                <>
                  <CheckCircleIcon className="w-5 h-5 mr-2" />
                  Complete Wizard 🎉
                </>
              ) : (
                <>
                  {verificationResult?.passed ? (
                    <>
                      Advance to Next
                      <ChevronRightIcon className="w-5 h-5 ml-2" />
                    </>
                  ) : (
                    <>
                      Skip to Next
                      <ChevronRightIcon className="w-5 h-5 ml-2" />
                    </>
                  )}
                </>
              )}
            </button>
          </div>
        </div>
      )}
      
      {/* File Approval Modal */}
      <FileApprovalModal
        open={showFileApprovalModal}
        onOpenChange={setShowFileApprovalModal}
        proposals={fileProposals}
        onApprove={handleApproveFile}
        onReject={handleRejectFile}
        onApproveAll={handleApproveAll}
        onRejectAll={handleRejectAll}
        workspacePath={workspacePath}
        loading={loading}
        sequentialMode={sequentialMode}
        onToggleSequentialMode={() => setSequentialMode(!sequentialMode)}
      />
    </div>
  );
}

