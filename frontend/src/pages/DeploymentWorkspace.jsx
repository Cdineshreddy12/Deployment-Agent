import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Panel, Group as PanelGroup, Separator } from 'react-resizable-panels';
import {
  FolderOpenIcon,
  RocketLaunchIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StopIcon,
  ArrowUturnLeftIcon,
  CpuChipIcon,
  CloudIcon,
  SparklesIcon,
  KeyIcon,
  LinkIcon,
  CubeIcon,
  CommandLineIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon
} from '@heroicons/react/24/outline';

import FolderTreeView from '../components/DeploymentWorkspace/FolderTreeView';
import EnvEditor from '../components/DeploymentWorkspace/EnvEditor';
import LogViewer from '../components/DeploymentWorkspace/LogViewer';
import ServiceTopology from '../components/DeploymentWorkspace/ServiceTopology';
import DockerGenerator from '../components/DeploymentWorkspace/DockerGenerator';
import EnvImporter from '../components/DeploymentWorkspace/EnvImporter';
import ClaudeWizard from '../components/DeploymentWorkspace/ClaudeWizard';
import WorkspaceSelector from '../components/DeploymentWorkspace/WorkspaceSelector';
import api from '../services/api';

// Resize handle component for panels - uses Separator from react-resizable-panels
const ResizeHandle = ({ className = '' }) => (
  <Separator
    className={`group flex items-center justify-center bg-gray-800 hover:bg-blue-600 transition-colors cursor-col-resize data-[orientation=horizontal]:w-2 data-[orientation=horizontal]:h-full data-[orientation=vertical]:h-2 data-[orientation=vertical]:w-full ${className}`}
  >
    <div className="w-0.5 h-8 bg-gray-600 group-hover:bg-blue-400 rounded-full transition-colors data-[orientation=vertical]:w-8 data-[orientation=vertical]:h-0.5" />
  </Separator>
);

/**
 * DeploymentWorkspace - Single screen for complete deployment workflow
 * Shows folder structure, env editor, service topology, and real-time logs
 */

const STAGES = [
  { id: 'ANALYZE', name: 'Analysis', icon: FolderOpenIcon },
  { id: 'COLLECT_ENV', name: 'Environment', icon: CpuChipIcon },
  { id: 'GENERATE_FILES', name: 'Generate', icon: SparklesIcon },
  { id: 'VERIFY_GENERATION', name: 'Verify', icon: CheckCircleIcon },
  { id: 'LOCAL_BUILD', name: 'Build', icon: CpuChipIcon },
  { id: 'LOCAL_TEST', name: 'Test', icon: PlayIcon },
  { id: 'ANALYZE_LOGS', name: 'Log Analysis', icon: ExclamationTriangleIcon },
  { id: 'PROVISION_INFRA', name: 'Infrastructure', icon: CloudIcon },
  { id: 'DEPLOY_PRODUCTION', name: 'Deploy', icon: RocketLaunchIcon },
  { id: 'HEALTH_CHECK', name: 'Health Check', icon: CheckCircleIcon },
  { id: 'COMPLETE', name: 'Complete', icon: CheckCircleIcon }
];

const StageProgress = ({ currentStage, stageHistory }) => {
  const currentIndex = STAGES.findIndex(s => s.id === currentStage);
  
  return (
    <div className="flex items-center space-x-1 overflow-x-auto pb-2">
      {STAGES.map((stage, index) => {
        const Icon = stage.icon;
        const isComplete = index < currentIndex || currentStage === 'COMPLETE';
        const isCurrent = stage.id === currentStage;
        const historyItem = stageHistory?.find(h => h.stage === stage.id);
        const hasFailed = historyItem && !historyItem.success;
        
        return (
          <div key={stage.id} className="flex items-center">
            <div
              className={`flex items-center px-2 py-1 rounded text-xs font-medium transition-colors ${
                hasFailed
                  ? 'bg-red-500/20 text-red-400'
                  : isComplete
                  ? 'bg-green-500/20 text-green-400'
                  : isCurrent
                  ? 'bg-blue-500/20 text-blue-400 animate-pulse'
                  : 'bg-gray-700/50 text-gray-500'
              }`}
            >
              <Icon className="w-3 h-3 mr-1" />
              {stage.name}
            </div>
            {index < STAGES.length - 1 && (
              <div className={`w-4 h-0.5 ${isComplete ? 'bg-green-500' : 'bg-gray-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const ServiceCard = ({ service }) => {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-200">{service.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded ${
          service.type === 'frontend' ? 'bg-blue-500/20 text-blue-400' :
          service.type === 'backend' ? 'bg-green-500/20 text-green-400' :
          service.type === 'database' ? 'bg-purple-500/20 text-purple-400' :
          'bg-gray-500/20 text-gray-400'
        }`}>
          {service.type}
        </span>
      </div>
      <div className="text-xs text-gray-500 space-y-1">
        {service.framework && <div>Framework: {service.framework}</div>}
        {service.port && <div>Port: {service.port}</div>}
        {service.hasDockerfile && (
          <div className="flex items-center text-green-400">
            <CheckCircleIcon className="w-3 h-3 mr-1" />
            Dockerfile
          </div>
        )}
      </div>
    </div>
  );
};

const ClaudeStatus = ({ status, message }) => {
  return (
    <div className="flex items-center space-x-2 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg px-4 py-2">
      <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
      <SparklesIcon className="w-4 h-4 text-purple-400" />
      <span className="text-sm text-purple-300">{message || 'Claude is ready'}</span>
    </div>
  );
};

export default function DeploymentWorkspace() {
  const { id: deploymentIdParam } = useParams();
  const navigate = useNavigate();
  
  const [projectPath, setProjectPath] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [inputMode, setInputMode] = useState('local'); // 'local' or 'github'
  const [deploymentId, setDeploymentId] = useState(deploymentIdParam || null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  
  // Workspace selector state
  const [showWorkspaceSelector, setShowWorkspaceSelector] = useState(false);
  
  // Project data
  const [projectData, setProjectData] = useState(null);
  const [fileTree, setFileTree] = useState({});
  const [services, setServices] = useState([]);
  const [generatedFiles, setGeneratedFiles] = useState([]);
  const [environments, setEnvironments] = useState({});
  const [envFiles, setEnvFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('topology'); // 'topology' | 'docker' | 'env' | 'wizard'
  
  // File viewer state
  const [viewingFile, setViewingFile] = useState(null); // { path, content, language }
  
  // Fullscreen wizard state
  const [isWizardFullscreen, setIsWizardFullscreen] = useState(false);
  
  // Pipeline state
  const [currentStage, setCurrentStage] = useState(null);
  const [stageHistory, setStageHistory] = useState([]);
  const [claudeStatus, setClaudeStatus] = useState('Ready');
  
  // Logs
  const [logs, setLogs] = useState({
    docker: [],
    terraform: [],
    ssh: []
  });
  
  // WebSocket ref
  const wsRef = useRef(null);
  
  // Connect WebSocket for real-time updates
  useEffect(() => {
    if (!deploymentId) return;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?deploymentId=${deploymentId}&type=pipeline`;
    
    try {
      wsRef.current = new WebSocket(wsUrl);
      
      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };
      
      wsRef.current.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
      
      return () => {
        if (wsRef.current) {
          wsRef.current.close();
        }
      };
    } catch (err) {
      console.error('WebSocket connection failed:', err);
    }
  }, [deploymentId]);
  
  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((data) => {
    switch (data.type) {
      case 'pipeline_status':
        setCurrentStage(data.currentStage);
        break;
        
      case 'pipeline_log':
        setLogs(prev => {
          const logType = data.logType || 'docker';
          return {
            ...prev,
            [logType]: [...(prev[logType] || []), {
              content: data.log || data.message,
              timestamp: data.timestamp,
              level: data.level
            }]
          };
        });
        break;
        
      case 'pipeline_stage':
        setCurrentStage(data.stage);
        if (data.status === 'completed') {
          setStageHistory(prev => [...prev, { stage: data.stage, success: true }]);
        } else if (data.status === 'failed') {
          setStageHistory(prev => [...prev, { stage: data.stage, success: false }]);
        }
        break;
        
      case 'claude_status':
        setClaudeStatus(data.message);
        break;
        
      default:
        break;
    }
  }, []);
  
  // Handle workspace selection
  const handleWorkspaceSelect = async (session) => {
    try {
      setIsAnalyzing(true);
      setClaudeStatus('Loading previous workspace...');
      
      // Resume the session
      const resumeResponse = await api.post(`/project/wizard/${session.deploymentId}/resume-session`);
      
      if (resumeResponse.data.success) {
        // Update UI with selected workspace
        setDeploymentId(session.deploymentId);
        setProjectPath(session.projectContext?.projectPath || '');
        setCurrentStage(session.currentStage);
        setProjectData({
          projectType: session.projectContext?.projectType,
          projectPath: session.projectContext?.projectPath
        });
        
        // Fetch files for tree view if workspace path exists
        if (session.projectContext?.projectPath) {
          try {
            const filesResponse = await api.get(`/project/${session.deploymentId}/files`);
            if (filesResponse.data.success) {
              setFileTree(filesResponse.data.data.tree || {});
            }
          } catch (err) {
            console.warn('Could not load file tree:', err);
          }
        }
        
        // Switch to wizard tab
        setActiveTab('wizard');
        setClaudeStatus(`Workspace loaded: ${session.deploymentId}`);
        
        // Update URL
        navigate(`/workspace/${session.deploymentId}`);
      }
    } catch (err) {
      console.error('Failed to load workspace:', err);
      setClaudeStatus('Failed to load workspace: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Analyze local project
  const handleAnalyze = async () => {
    if (!projectPath.trim()) return;
    
    setIsAnalyzing(true);
    try {
      const response = await api.post('/project/analyze', { path: projectPath });
      
      if (response.data.success) {
        const { deploymentId: newId, data } = response.data;
        setDeploymentId(newId);
        setProjectData(data);
        setFileTree(data.structure?.tree || {});
        setServices(data.services || []);
        setCurrentStage('ANALYZE');
        setStageHistory([{ stage: 'ANALYZE', success: true }]);
        setClaudeStatus('Project analyzed successfully');
        
        // Fetch files for tree view
        const filesResponse = await api.get(`/project/${newId}/files`);
        if (filesResponse.data.success) {
          setFileTree(filesResponse.data.data.tree || {});
        }
      }
    } catch (err) {
      console.error('Analysis failed:', err);
      setClaudeStatus('Analysis failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Analyze GitHub repository
  const handleAnalyzeRepo = async () => {
    if (!repoUrl.trim()) return;
    
    setIsAnalyzing(true);
    setClaudeStatus('Scanning GitHub repository...');
    try {
      // First, get the full repository tree
      const treeResponse = await api.get('/github/tree', {
        params: { repositoryUrl: repoUrl }
      });
      
      if (treeResponse.data.success) {
        const { data } = treeResponse.data;
        
        // Set file tree from GitHub
        setFileTree(data.tree || {});
        setEnvFiles(data.envFiles || []);
        
        // Also analyze the repository for services
        const analysisResponse = await api.post('/github/analyze', {
          repositoryUrl: repoUrl
        });
        
        if (analysisResponse.data.success) {
          const analysis = analysisResponse.data.data.analysis;
          
          // Create project data from analysis
          const projectDataFromGithub = {
            projectType: analysis.structure?.languages?.[0] || 'unknown',
            framework: analysis.codeAnalysis?.framework || null,
            services: detectServicesFromAnalysis(analysis),
            structure: {
              totalFiles: data.totalFiles,
              totalDirectories: data.totalDirectories,
              tree: data.tree
            },
            repository: data.repository,
            missingInfrastructure: analysis.missingInfrastructure
          };
          
          setProjectData(projectDataFromGithub);
          setServices(projectDataFromGithub.services);
          setCurrentStage('ANALYZE');
          setStageHistory([{ stage: 'ANALYZE', success: true }]);
          setClaudeStatus(`Repository scanned: ${data.totalFiles} files, ${data.totalDirectories} directories`);
        }
      }
    } catch (err) {
      console.error('GitHub analysis failed:', err);
      setClaudeStatus('Analysis failed: ' + (err.response?.data?.error?.message || err.message));
    } finally {
      setIsAnalyzing(false);
    }
  };
  
  // Helper to detect services from GitHub analysis
  const detectServicesFromAnalysis = (analysis) => {
    const services = [];
    const deps = analysis.dependencies?.runtime?.dependencies || {};
    const structure = analysis.structure || {};
    
    // Check for frontend frameworks
    if (deps.react || deps.vue || deps['@angular/core'] || deps.next) {
      services.push({
        name: 'frontend',
        type: 'frontend',
        framework: deps.next ? 'Next.js' : deps.react ? 'React' : deps.vue ? 'Vue' : 'Angular',
        port: 3000,
        path: '.',
        hasDockerfile: structure.hasDocker
      });
    }
    
    // Check for backend frameworks
    if (deps.express || deps.fastify || deps['@nestjs/core'] || deps.koa) {
      services.push({
        name: 'backend',
        type: 'backend',
        framework: deps.express ? 'Express' : deps.fastify ? 'Fastify' : deps['@nestjs/core'] ? 'NestJS' : 'Koa',
        port: 5000,
        path: '.',
        hasDockerfile: structure.hasDocker
      });
    }
    
    // Check for databases in code analysis
    if (analysis.codeAnalysis?.databases?.length > 0) {
      analysis.codeAnalysis.databases.forEach(db => {
        services.push({
          name: db.toLowerCase(),
          type: 'database',
          framework: db,
          port: db.includes('postgres') ? 5432 : db.includes('mysql') ? 3306 : db.includes('mongo') ? 27017 : null
        });
      });
    }
    
    // Check for caching
    if (analysis.codeAnalysis?.caching?.length > 0) {
      analysis.codeAnalysis.caching.forEach(cache => {
        services.push({
          name: cache.toLowerCase(),
          type: 'cache',
          framework: cache,
          port: cache.includes('redis') ? 6379 : null
        });
      });
    }
    
    // Fallback if no services detected
    if (services.length === 0) {
      services.push({
        name: 'main',
        type: 'backend',
        framework: analysis.codeAnalysis?.framework || 'Unknown',
        port: 3000,
        path: '.',
        hasDockerfile: structure.hasDocker
      });
    }
    
    return services;
  };
  
  // Handle generated file from DockerGenerator
  const handleFileGenerated = (file) => {
    setGeneratedFiles(prev => {
      // Remove existing file with same path if any
      const filtered = prev.filter(f => f.path !== file.path);
      return [...filtered, { ...file, generatedAt: new Date() }];
    });
    setClaudeStatus(`Generated: ${file.path}`);
  };
  
  // Save environment
  const handleSaveEnv = async (service, content) => {
    if (!deploymentId) return;
    
    await api.post('/project/env', {
      deploymentId,
      service,
      content
    });
    
    setEnvironments(prev => ({ ...prev, [service]: content }));
  };
  
  // Start deployment
  const handleDeploy = async () => {
    if (!deploymentId) return;
    
    setIsDeploying(true);
    setLogs({ docker: [], terraform: [], ssh: [] });
    
    try {
      // Get token for authentication
      const token = localStorage.getItem('token');
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      
      // Use SSE for deployment streaming (EventSource doesn't support custom headers, so pass token in query)
      const eventSource = new EventSource(
        `/api/v1/project/deploy?deploymentId=${deploymentId}${tokenParam}`,
        { withCredentials: true }
      );
      
      eventSource.onmessage = (event) => {
        if (event.data === '[DONE]') {
          eventSource.close();
          setIsDeploying(false);
          return;
        }
        
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'stage_start') {
            setCurrentStage(data.stage);
            setClaudeStatus(`Processing ${data.stage}...`);
          } else if (data.type === 'stage_result') {
            if (data.success) {
              setStageHistory(prev => [...prev, { stage: data.stage, success: true }]);
            }
          } else if (data.type === 'verification') {
            setClaudeStatus(data.approved ? 'Approved by Claude' : 'Claude reviewing...');
          } else if (data.type === 'log') {
            const logType = data.logType || 'docker';
            setLogs(prev => ({
              ...prev,
              [logType]: [...prev[logType], { content: data.log, timestamp: data.timestamp }]
            }));
          } else if (data.type === 'error') {
            setStageHistory(prev => [...prev, { stage: data.stage, success: false }]);
          } else if (data.type === 'summary') {
            setClaudeStatus(data.summary);
          }
        } catch (err) {
          console.error('SSE parse error:', err);
        }
      };
      
      eventSource.onerror = () => {
        eventSource.close();
        setIsDeploying(false);
      };
      
    } catch (err) {
      console.error('Deployment failed:', err);
      setIsDeploying(false);
    }
  };
  
  // Handle rollback
  const handleRollback = async () => {
    if (!deploymentId) return;
    
    try {
      await api.post(`/project/${deploymentId}/rollback`, {
        reason: 'User initiated rollback'
      });
      setClaudeStatus('Rollback completed');
    } catch (err) {
      console.error('Rollback failed:', err);
    }
  };
  
  // Handle file click - open file viewer
  const handleFileClick = async (path, node) => {
    // Check if it's a generated file first
    const generatedFile = generatedFiles.find(f => f.path === path);
    if (generatedFile) {
      setViewingFile({
        path,
        content: generatedFile.content,
        language: getLanguageFromPath(path)
      });
      return;
    }
    
    // Try to fetch file content
    try {
      if (inputMode === 'github' && repoUrl) {
        const response = await api.post('/github/read-file', {
          repositoryUrl: repoUrl,
          filePath: path
        });
        if (response.data.success) {
          setViewingFile({
            path,
            content: response.data.data.content,
            language: getLanguageFromPath(path)
          });
        }
      } else if (projectPath) {
        // For local files, use cursor/project API with projectPath as fallback
        const response = await api.post('/cursor/read-file', {
          deploymentId,
          filePath: path,
          projectPath: projectPath  // Pass projectPath as fallback for workspace recovery
        });
        if (response.data.success) {
          setViewingFile({
            path,
            content: response.data.data.content,
            language: getLanguageFromPath(path)
          });
        }
      }
    } catch (err) {
      console.error('Failed to read file:', err);
      setClaudeStatus(`Failed to read file: ${path}`);
    }
  };
  
  // Get language from file path for syntax highlighting
  const getLanguageFromPath = (filePath) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'json': 'json',
      'yml': 'yaml',
      'yaml': 'yaml',
      'md': 'markdown',
      'py': 'python',
      'sh': 'bash',
      'bash': 'bash',
      'dockerfile': 'dockerfile',
      'tf': 'hcl',
      'css': 'css',
      'scss': 'scss',
      'html': 'html',
      'sql': 'sql',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'xml': 'xml',
      'env': 'bash'
    };
    // Handle Dockerfile without extension
    if (filePath.toLowerCase().includes('dockerfile')) return 'dockerfile';
    return langMap[ext] || 'text';
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="bg-gray-800/50 border-b border-gray-700">
        <div className="max-w-[1920px] mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <RocketLaunchIcon className="w-8 h-8 text-blue-400" />
              <div>
                <h1 className="text-xl font-bold text-white">Deployment Workspace</h1>
                <p className="text-sm text-gray-400">
                  {deploymentId ? `ID: ${deploymentId.slice(0, 8)}...` : 'Enter project path to begin'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowWorkspaceSelector(true)}
                className="flex items-center px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
              >
                <FolderOpenIcon className="w-5 h-5 mr-2" />
                Load Workspace
              </button>
              
              <button
                onClick={() => navigate('/credentials')}
                className="flex items-center px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                <KeyIcon className="w-5 h-5 mr-2" />
                Credentials
              </button>
              
              {deploymentId && (
                <>
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying || !projectData}
                    className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    {isDeploying ? (
                      <>
                        <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
                        Deploying...
                      </>
                    ) : (
                      <>
                        <RocketLaunchIcon className="w-5 h-5 mr-2" />
                        Deploy
                      </>
                    )}
                  </button>
                  
                  <button
                    onClick={handleRollback}
                    disabled={isDeploying}
                    className="flex items-center px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  >
                    <ArrowUturnLeftIcon className="w-5 h-5 mr-2" />
                    Rollback
                  </button>
                </>
              )}
            </div>
          </div>
          
          {/* Input mode toggle and input field */}
          <div className="mt-4 space-y-3">
            {/* Mode toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setInputMode('local')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  inputMode === 'local'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <FolderOpenIcon className="w-4 h-4 inline mr-1" />
                Local Path
              </button>
              <button
                onClick={() => setInputMode('github')}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  inputMode === 'github'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                <LinkIcon className="w-4 h-4 inline mr-1" />
                GitHub Repo
              </button>
            </div>
            
            {/* Input field based on mode */}
            <div className="flex items-center space-x-3">
              <div className="flex-1 relative">
                {inputMode === 'local' ? (
                  <>
                    <FolderOpenIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={projectPath}
                      onChange={(e) => setProjectPath(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                      placeholder="/path/to/your/project"
                      className="w-full bg-gray-900/50 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </>
                ) : (
                  <>
                    <LinkIcon className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                      type="text"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeRepo()}
                      placeholder="https://github.com/username/repository"
                      className="w-full bg-gray-900/50 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                  </>
                )}
              </div>
              <button
                onClick={inputMode === 'local' ? handleAnalyze : handleAnalyzeRepo}
                disabled={isAnalyzing || (inputMode === 'local' ? !projectPath.trim() : !repoUrl.trim())}
                className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {isAnalyzing ? (
                  <>
                    <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="w-5 h-5 mr-2" />
                    {inputMode === 'local' ? 'Analyze' : 'Scan Repo'}
                  </>
                )}
              </button>
            </div>
          </div>
          
          {/* Stage progress */}
          {currentStage && (
            <div className="mt-4">
              <StageProgress currentStage={currentStage} stageHistory={stageHistory} />
            </div>
          )}
          
          {/* Claude status */}
          {deploymentId && (
            <div className="mt-4">
              <ClaudeStatus status="active" message={claudeStatus} />
            </div>
          )}
        </div>
      </div>
      
      {/* Main content with resizable panels */}
      <div className="h-[calc(100vh-280px)]">
        {projectData ? (
          <PanelGroup orientation="horizontal" className="h-full">
            {/* Left panel - File tree and services */}
            <Panel defaultSize={25} minSize={15} maxSize={40}>
              <div className="h-full flex flex-col p-2 space-y-4 overflow-hidden">
                <FolderTreeView
                  projectPath={projectPath || repoUrl}
                  files={projectData.structure?.files || []}
                  tree={fileTree}
                  generatedFiles={generatedFiles}
                  onFileClick={handleFileClick}
                  className="flex-1 min-h-0"
                />
                
                {/* Services */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex-shrink-0 max-h-[200px] overflow-y-auto">
                  <h3 className="text-sm font-medium text-gray-200 mb-3">Detected Services</h3>
                  <div className="space-y-2">
                    {services.map((service, index) => (
                      <ServiceCard key={index} service={service} />
                    ))}
                    {services.length === 0 && (
                      <p className="text-sm text-gray-500">No services detected</p>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
            
            <ResizeHandle />
            
            {/* Middle panel - Tabs for Topology, Docker, Env, Wizard */}
            <Panel defaultSize={35} minSize={20} maxSize={50}>
              <div className="h-full flex flex-col p-2">
                {/* Tab header */}
                <div className="flex border-b border-gray-700 mb-2 flex-shrink-0 overflow-x-auto">
                  <button
                    onClick={() => setActiveTab('topology')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === 'topology'
                        ? 'text-blue-400 border-blue-400'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    }`}
                  >
                    <CloudIcon className="w-4 h-4 inline mr-1" />
                    Topology
                  </button>
                  <button
                    onClick={() => setActiveTab('docker')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === 'docker'
                        ? 'text-blue-400 border-blue-400'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    }`}
                  >
                    <CubeIcon className="w-4 h-4 inline mr-1" />
                    Docker
                    {generatedFiles.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded">
                        {generatedFiles.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('env')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === 'env'
                        ? 'text-blue-400 border-blue-400'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    }`}
                  >
                    <KeyIcon className="w-4 h-4 inline mr-1" />
                    Env
                    {envFiles.length > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 rounded">
                        {envFiles.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActiveTab('wizard')}
                    className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                      activeTab === 'wizard'
                        ? 'text-purple-400 border-purple-400'
                        : 'text-gray-400 border-transparent hover:text-gray-200'
                    }`}
                  >
                    <CommandLineIcon className="w-4 h-4 inline mr-1" />
                    Wizard
                  </button>
                  {activeTab === 'wizard' && (
                    <button
                      onClick={() => setIsWizardFullscreen(!isWizardFullscreen)}
                      className="ml-2 p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                      title={isWizardFullscreen ? 'Exit fullscreen' : 'Fullscreen wizard'}
                    >
                      {isWizardFullscreen ? (
                        <ArrowsPointingInIcon className="w-4 h-4" />
                      ) : (
                        <ArrowsPointingOutIcon className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
                
                {/* Tab content */}
                <div className="flex-1 overflow-hidden min-h-0">
                  {activeTab === 'topology' && (
                    <ServiceTopology
                      services={services}
                      healthStatus={Object.fromEntries(services.map(s => [s.name, 'unknown']))}
                      className="h-full"
                    />
                  )}
                  
                  {activeTab === 'docker' && (
                    <DockerGenerator
                      useNewWorkflow={true}
                      deploymentId={deploymentId || undefined}
                      services={services}
                      projectInfo={projectData?.packageInfo || {}}
                      projectStructure={fileTree}
                      onFileGenerated={handleFileGenerated}
                      className="h-full overflow-y-auto"
                    />
                  )}
                  
                  {activeTab === 'env' && (
                    <div className="h-full flex flex-col space-y-4 overflow-y-auto">
                      {inputMode === 'github' && envFiles.length > 0 && (
                        <EnvImporter
                          deploymentId={deploymentId}
                          envFiles={envFiles}
                          repositoryUrl={repoUrl}
                          onImportComplete={(result) => {
                            setClaudeStatus(`Imported ${result.variableCount} variables from ${result.file.name}`);
                          }}
                          className="flex-shrink-0"
                        />
                      )}
                      <EnvEditor
                        deploymentId={deploymentId}
                        services={services.length > 0 ? services : [{ name: 'main', type: 'backend' }]}
                        environments={environments}
                        onSave={handleSaveEnv}
                        className={envFiles.length > 0 ? 'flex-1 min-h-[200px]' : 'h-full'}
                      />
                    </div>
                  )}
                  
                  {activeTab === 'wizard' && (
                    <ClaudeWizard
                      deploymentId={deploymentId}
                      projectContext={{
                        projectPath: inputMode === 'local' ? projectPath : repoUrl,
                        projectType: projectData?.projectType,
                        framework: projectData?.framework,
                        services,
                        generatedFiles
                      }}
                      onStageComplete={(result) => {
                        if (result.complete) {
                          setClaudeStatus('Deployment wizard completed!');
                        }
                      }}
                      className="h-full"
                    />
                  )}
                </div>
              </div>
            </Panel>
            
            <ResizeHandle />
            
            {/* Right panel - Logs */}
            <Panel defaultSize={40} minSize={25} maxSize={60}>
              <div className="h-full p-2">
                <LogViewer
                  deploymentId={deploymentId}
                  logs={logs}
                  className="h-full"
                />
              </div>
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex flex-col items-center justify-center h-[60vh] text-gray-500">
            <FolderOpenIcon className="w-24 h-24 mb-4 opacity-30" />
            <h2 className="text-xl font-medium mb-2">No Project Selected</h2>
            <p className="text-sm">Enter a project path above and click Analyze to begin</p>
          </div>
        )}
      </div>
      
      {/* File Content Viewer Modal */}
      {viewingFile && (
        <FileContentViewerModal
          file={viewingFile}
          onClose={() => setViewingFile(null)}
        />
      )}
      
      {/* Fullscreen Wizard Modal */}
      {isWizardFullscreen && (
        <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col">
          {/* Fullscreen header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center">
              <SparklesIcon className="w-6 h-6 text-purple-400 mr-2" />
              <span className="text-lg font-medium text-white">Claude Deployment Wizard</span>
              {deploymentId && (
                <span className="ml-3 text-sm text-gray-400">ID: {deploymentId.slice(0, 8)}...</span>
              )}
            </div>
            <button
              onClick={() => setIsWizardFullscreen(false)}
              className="flex items-center px-3 py-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowsPointingInIcon className="w-5 h-5 mr-1" />
              Exit Fullscreen
            </button>
          </div>
          
          {/* Fullscreen wizard content */}
          <div className="flex-1 p-4 overflow-hidden">
            <ClaudeWizard
              deploymentId={deploymentId}
              projectContext={{
                projectPath: inputMode === 'local' ? projectPath : repoUrl,
                projectType: projectData?.projectType,
                framework: projectData?.framework,
                services,
                generatedFiles
              }}
              onStageComplete={(result) => {
                if (result.complete) {
                  setClaudeStatus('Deployment wizard completed!');
                  setIsWizardFullscreen(false);
                }
              }}
              className="h-full"
            />
          </div>
        </div>
      )}
      
      {/* Workspace Selector Modal */}
      <WorkspaceSelector
        isOpen={showWorkspaceSelector}
        onClose={() => setShowWorkspaceSelector(false)}
        onSelect={handleWorkspaceSelect}
        currentDeploymentId={deploymentId}
      />
    </div>
  );
}

// File Content Viewer Modal Component
const FileContentViewerModal = ({ file, onClose }) => {
  const [copied, setCopied] = useState(false);
  
  const handleCopy = async () => {
    await navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Determine syntax highlighting language
  const getHighlightStyle = () => {
    // Simple inline styling since we're not importing syntax highlighter here
    return 'bg-gray-900 text-gray-300 font-mono text-sm';
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center">
            <FolderOpenIcon className="w-5 h-5 text-blue-400 mr-2" />
            <span className="text-sm font-medium text-gray-200">{file.path}</span>
            <span className="ml-2 px-2 py-0.5 text-xs bg-gray-700 text-gray-400 rounded">{file.language}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="flex items-center px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              {copied ? (
                <>
                  <CheckCircleIcon className="w-4 h-4 mr-1 text-green-400" />
                  Copied
                </>
              ) : (
                <>
                  <span className="mr-1">📋</span>
                  Copy
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors p-1"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          <pre className={`${getHighlightStyle()} p-4 rounded-lg overflow-x-auto whitespace-pre`}>
            {file.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

