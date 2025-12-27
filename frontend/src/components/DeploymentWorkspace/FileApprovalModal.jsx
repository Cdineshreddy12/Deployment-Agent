import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import {
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
  FolderIcon
} from '@heroicons/react/24/outline';
import { useToast } from '../../hooks/use-toast';

/**
 * FileApprovalModal - Modal for reviewing and approving generated files
 */
const FileApprovalModal = ({ 
  open, 
  onOpenChange, 
  proposals = [], 
  onApprove, 
  onReject,
  onApproveAll,
  onRejectAll,
  workspacePath,
  loading = false,
  sequentialMode = false, // New prop for sequential generation
  onToggleSequentialMode // New prop for toggling mode
}) => {
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [processingFiles, setProcessingFiles] = useState(new Set());
  const { toast } = useToast();
  
  // Track which Dockerfiles have been created
  const dockerfiles = proposals.filter(p => 
    p.filePath.toLowerCase().includes('dockerfile') || 
    p.type === 'dockerfile'
  );
  const createdDockerfiles = dockerfiles.filter(p => p.status === 'approved' || p.writtenToDisk);
  const pendingDockerfiles = dockerfiles.filter(p => p.status === 'pending');
  
  // In sequential mode, only first pending file can be approved
  const getCanApprove = (proposal, index) => {
    if (!sequentialMode) return true;
    
    // Allow all non-Dockerfile files
    const isDockerfile = proposal.filePath.toLowerCase().includes('dockerfile') || proposal.type === 'dockerfile';
    if (!isDockerfile) return true;
    
    // For Dockerfiles in sequential mode, only allow first pending
    const dockerfileIndex = dockerfiles.findIndex(d => d.id === proposal.id);
    const previousDockerfilesCreated = dockerfiles
      .slice(0, dockerfileIndex)
      .every(d => d.status === 'approved' || d.writtenToDisk);
    
    return previousDockerfilesCreated;
  };

  const toggleFileExpansion = (fileId) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(fileId)) {
      newExpanded.delete(fileId);
    } else {
      newExpanded.add(fileId);
    }
    setExpandedFiles(newExpanded);
  };

  const handleCopyCode = (content, filePath) => {
    navigator.clipboard.writeText(content);
    toast({
      title: "Copied!",
      description: `${filePath} copied to clipboard`,
    });
  };

  const getLanguageFromPath = (filePath) => {
    const ext = filePath.split('.').pop().toLowerCase();
    const languageMap = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'py': 'python',
      'yml': 'yaml',
      'yaml': 'yaml',
      'json': 'json',
      'sh': 'bash',
      'bash': 'bash',
      'tf': 'hcl',
      'conf': 'nginx',
      'config': 'nginx',
      'md': 'markdown',
      'dockerfile': 'dockerfile'
    };
    
    if (filePath.toLowerCase().includes('dockerfile')) return 'dockerfile';
    if (filePath.toLowerCase().includes('docker-compose')) return 'yaml';
    
    return languageMap[ext] || 'text';
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleApprove = async (proposal) => {
    setProcessingFiles(prev => new Set(prev).add(proposal.id));
    try {
      await onApprove(proposal.id);
      toast({
        title: "File Approved",
        description: `${proposal.filePath} has been written to your workspace`,
      });
    } catch (error) {
      toast({
        title: "Approval Failed",
        description: error.message || "Failed to approve file",
        variant: "destructive",
      });
    } finally {
      setProcessingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(proposal.id);
        return newSet;
      });
    }
  };

  const handleReject = async (proposal) => {
    setProcessingFiles(prev => new Set(prev).add(proposal.id));
    try {
      await onReject(proposal.id);
      toast({
        title: "File Rejected",
        description: `${proposal.filePath} has been rejected`,
      });
    } catch (error) {
      toast({
        title: "Rejection Failed",
        description: error.message || "Failed to reject file",
        variant: "destructive",
      });
    } finally {
      setProcessingFiles(prev => {
        const newSet = new Set(prev);
        newSet.delete(proposal.id);
        return newSet;
      });
    }
  };

  const handleApproveAll = async () => {
    setProcessingFiles(prev => new Set(proposals.map(p => p.id)));
    try {
      await onApproveAll();
      toast({
        title: "All Files Approved",
        description: `${proposals.length} file(s) have been written to your workspace`,
      });
    } catch (error) {
      toast({
        title: "Batch Approval Failed",
        description: error.message || "Failed to approve all files",
        variant: "destructive",
      });
    } finally {
      setProcessingFiles(new Set());
    }
  };

  const handleRejectAll = async () => {
    setProcessingFiles(prev => new Set(proposals.map(p => p.id)));
    try {
      await onRejectAll();
      toast({
        title: "All Files Rejected",
        description: `${proposals.length} file(s) have been rejected`,
      });
    } catch (error) {
      toast({
        title: "Batch Rejection Failed",
        description: error.message || "Failed to reject all files",
        variant: "destructive",
      });
    } finally {
      setProcessingFiles(new Set());
    }
  };

  if (!proposals || proposals.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-white flex items-center gap-2">
            <DocumentTextIcon className="w-6 h-6 text-blue-400" />
            Review Generated Files
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            {proposals.length} file{proposals.length !== 1 ? 's' : ''} ready for your approval
          </DialogDescription>
          {workspacePath && (
            <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700">
              <FolderIcon className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-400">
                Workspace: <span className="text-gray-300 font-mono">{workspacePath}</span>
              </span>
            </div>
          )}
          
          {/* Dockerfile generation mode toggle and progress */}
          {dockerfiles.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between px-3 py-2 bg-blue-600/10 rounded-lg border border-blue-500/30">
                <div className="flex items-center gap-2">
                  <DocumentTextIcon className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-blue-300 font-medium">
                    Dockerfile Generation
                  </span>
                </div>
                {onToggleSequentialMode && (
                  <button
                    onClick={onToggleSequentialMode}
                    className={`px-3 py-1 text-xs rounded-lg transition-all ${
                      sequentialMode
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {sequentialMode ? '📋 Sequential' : '⚡ Generate All'}
                  </button>
                )}
              </div>
              
              {/* Progress bar for Dockerfiles */}
              {dockerfiles.length > 0 && (
                <div className="px-3 py-2 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">Dockerfile Progress</span>
                    <span className="text-xs text-gray-400">
                      {createdDockerfiles.length} of {dockerfiles.length} created
                    </span>
                  </div>
                  <div className="w-full bg-gray-700 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(createdDockerfiles.length / dockerfiles.length) * 100}%` }}
                    />
                  </div>
                  {sequentialMode && pendingDockerfiles.length > 0 && (
                    <p className="text-xs text-yellow-400 mt-2">
                      ⚠️ Sequential mode: Approve {pendingDockerfiles[0].filePath} to unlock the next
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-4">
          {proposals.map((proposal, index) => {
            const isExpanded = expandedFiles.has(proposal.id);
            const isProcessing = processingFiles.has(proposal.id);
            const language = getLanguageFromPath(proposal.filePath);
            const canApprove = getCanApprove(proposal, index);
            const isLocked = !canApprove;

            return (
              <div
                key={proposal.id}
                className={`border rounded-lg bg-gray-800/50 overflow-hidden ${
                  isLocked ? 'border-gray-700 opacity-60' : 'border-gray-700'
                }`}
              >
                {/* File Header */}
                <div className="flex items-center justify-between p-4 bg-gray-800/80">
                  <button
                    onClick={() => toggleFileExpansion(proposal.id)}
                    className="flex items-center gap-3 flex-1 text-left hover:text-blue-400 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-mono text-gray-200 font-medium">
                        {proposal.filePath}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-gray-500">
                          {formatFileSize(proposal.size)}
                        </span>
                        <span className="text-xs text-gray-500 capitalize">
                          {proposal.type}
                        </span>
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-2">
                    {isLocked && (
                      <span className="text-xs text-yellow-400 mr-2 flex items-center gap-1">
                        🔒 Locked
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleCopyCode(proposal.content, proposal.filePath)}
                      disabled={isProcessing}
                      className="text-gray-400 hover:text-white"
                    >
                      <ClipboardDocumentIcon className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(proposal)}
                      disabled={isProcessing || loading || isLocked}
                      className="border-red-600/30 text-red-400 hover:bg-red-600/10 hover:text-red-300"
                    >
                      <XCircleIcon className="w-4 h-4 mr-1" />
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprove(proposal)}
                      disabled={isProcessing || loading || isLocked}
                      className="bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircleIcon className="w-4 h-4 mr-1" />
                      Approve
                    </Button>
                  </div>
                </div>

                {/* Code Preview */}
                {isExpanded && (
                  <div className="border-t border-gray-700">
                    <div className="max-h-96 overflow-y-auto bg-gray-950">
                      <SyntaxHighlighter
                        language={language}
                        style={vscDarkPlus}
                        showLineNumbers
                        customStyle={{
                          margin: 0,
                          padding: '1rem',
                          fontSize: '0.875rem',
                          background: 'transparent',
                        }}
                      >
                        {proposal.content}
                      </SyntaxHighlighter>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="border-t border-gray-700 pt-4">
          <div className="flex items-center justify-between w-full gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="border-gray-600 text-gray-400 hover:text-white"
            >
              Close
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleRejectAll}
                disabled={loading || proposals.length === 0}
                className="border-red-600/30 text-red-400 hover:bg-red-600/10 hover:text-red-300"
              >
                <XCircleIcon className="w-4 h-4 mr-2" />
                Reject All
              </Button>
              <Button
                onClick={handleApproveAll}
                disabled={loading || proposals.length === 0}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircleIcon className="w-4 h-4 mr-2" />
                Approve All ({proposals.length})
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FileApprovalModal;

