import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { 
  FolderOpenIcon, 
  ClockIcon, 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  XCircleIcon,
  PlayIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';

const WorkspaceSelector = ({ isOpen, onClose, onSelect, currentDeploymentId }) => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const fetchSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/project/wizard/sessions', {
        params: { limit: 50, offset: 0 }
      });
      
      if (response.data.success) {
        setSessions(response.data.data.sessions);
      } else {
        setError('Failed to load sessions');
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      // Handle error object - extract message if it's an object
      let errorMessage = 'Failed to load previous workspaces';
      if (err.response?.data?.error) {
        if (typeof err.response.data.error === 'string') {
          errorMessage = err.response.data.error;
        } else if (typeof err.response.data.error === 'object' && err.response.data.error.message) {
          errorMessage = err.response.data.error.message;
        } else if (typeof err.response.data.error === 'object' && err.response.data.error.code) {
          errorMessage = err.response.data.error.code;
        }
      } else if (err.message) {
        errorMessage = err.message;
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = () => {
    if (selectedSession) {
      onSelect(selectedSession);
      onClose();
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon className="w-5 h-5 text-green-400" />;
      case 'failed':
        return <XCircleIcon className="w-5 h-5 text-red-400" />;
      case 'paused':
        return <ExclamationCircleIcon className="w-5 h-5 text-yellow-400" />;
      case 'active':
        return <PlayIcon className="w-5 h-5 text-blue-400" />;
      default:
        return <ClockIcon className="w-5 h-5 text-gray-400" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'paused':
        return 'text-yellow-400';
      case 'active':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] bg-gray-900 text-white border border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold flex items-center">
            <FolderOpenIcon className="w-6 h-6 mr-2 text-blue-400" />
            Select Previous Workspace
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-400">Loading workspaces...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <XCircleIcon className="w-8 h-8 text-red-400 mr-2" />
              <span className="text-red-400">{error}</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <FolderOpenIcon className="w-16 h-16 mb-4 opacity-50" />
              <p className="text-lg">No previous workspaces found</p>
              <p className="text-sm mt-2">Start a new deployment to create your first workspace</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.deploymentId}
                  onClick={() => setSelectedSession(session)}
                  className={`
                    p-4 rounded-lg border cursor-pointer transition-all
                    ${selectedSession?.deploymentId === session.deploymentId
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
                    }
                    ${session.deploymentId === currentDeploymentId ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center mb-2">
                        {getStatusIcon(session.status)}
                        <span className={`ml-2 font-medium ${getStatusColor(session.status)}`}>
                          {session.status.toUpperCase()}
                        </span>
                        {session.deploymentId === currentDeploymentId && (
                          <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                            Current
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-sm">
                        <div className="flex items-center text-gray-300">
                          <span className="font-medium mr-2">Deployment ID:</span>
                          <code className="text-xs bg-gray-800 px-2 py-1 rounded">{session.deploymentId}</code>
                        </div>
                        
                        {session.projectContext?.projectPath && (
                          <div className="flex items-center text-gray-400">
                            <FolderOpenIcon className="w-4 h-4 mr-2" />
                            <span className="truncate">{session.projectContext.projectPath}</span>
                          </div>
                        )}
                        
                        {session.projectContext?.projectType && (
                          <div className="text-gray-400">
                            <span className="font-medium">Type:</span> {
                              (() => {
                                const projectType = session.projectContext.projectType;
                                if (typeof projectType === 'object' && projectType !== null) {
                                  return projectType.language || projectType.name || projectType.type || 'Unknown';
                                }
                                return String(projectType);
                              })()
                            }
                          </div>
                        )}
                        
                        <div className="flex items-center space-x-4 text-gray-400">
                          <div>
                            <span className="font-medium">Stage:</span> {session.currentStage}
                          </div>
                          <div>
                            <span className="font-medium">Progress:</span> {session.progress || 0}%
                          </div>
                        </div>
                        
                        <div className="flex items-center space-x-4 text-xs text-gray-500">
                          <div className="flex items-center">
                            <ClockIcon className="w-3 h-3 mr-1" />
                            Started: {formatDate(session.startedAt)}
                          </div>
                          <div className="flex items-center">
                            <ClockIcon className="w-3 h-3 mr-1" />
                            Updated: {formatDate(session.lastUpdatedAt)}
                          </div>
                        </div>
                        
                        {session.metadata && (
                          <div className="flex items-center space-x-3 text-xs text-gray-500 mt-2 pt-2 border-t border-gray-700">
                            <span>Commands: {session.metadata.totalCommandsExecuted || 0}</span>
                            <span className="text-green-400">✓ {session.metadata.successfulCommands || 0}</span>
                            <span className="text-red-400">✗ {session.metadata.failedCommands || 0}</span>
                            {session.metadata.resumeCount > 0 && (
                              <span>Resumed: {session.metadata.resumeCount}×</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between items-center pt-4 border-t border-gray-700">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-gray-800 hover:bg-gray-700 border-gray-600"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSelect}
            disabled={!selectedSession || selectedSession.deploymentId === currentDeploymentId}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Load Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WorkspaceSelector;

