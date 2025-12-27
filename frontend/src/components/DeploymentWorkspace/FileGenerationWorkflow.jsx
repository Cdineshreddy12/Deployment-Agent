import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  DocumentTextIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowUpTrayIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  SparklesIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';

/**
 * File Generation Workflow Component
 * Handles the Cursor-assisted file generation workflow
 */
const FileGenerationWorkflow = ({ deploymentId, stageId, onComplete, onError }) => {
  const [taskStatus, setTaskStatus] = useState(null);
  const [readme, setReadme] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [verificationReport, setVerificationReport] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [fileInputRef, setFileInputRef] = useState(null);
  const [fileStatus, setFileStatus] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [filesDetected, setFilesDetected] = useState(false);
  const [checkingFiles, setCheckingFiles] = useState(false);

  // Validate deploymentId
  useEffect(() => {
    if (!deploymentId) {
      setError('Deployment ID is required. Please select a deployment first.');
      setInitializing(false);
      return;
    }
    setInitializing(false);
  }, [deploymentId, stageId]);

  // Load task status on mount and check for existing files
  useEffect(() => {
    if (!deploymentId) {
      return;
    }
    loadTaskStatus();
    // Also check for files without task
    checkFilesWithoutTask();
    
    // Retry file check after a delay if workspace path wasn't set initially
    const retryTimeout = setTimeout(() => {
      if (!fileStatus?.workspacePath && !checkingFiles) {
        console.log('Retrying file check after delay...');
        checkFilesWithoutTask();
      }
    }, 2000); // Retry after 2 seconds
    
    return () => clearTimeout(retryTimeout);
  }, [deploymentId, stageId]);

  const loadTaskStatus = async () => {
    if (!deploymentId) {
      return;
    }

    try {
      setLoading(true);
      // Try to get task by deployment
      const response = await api.get(`/file-generation/deployment/${deploymentId}?stageId=${stageId || 'GENERATE_README'}`);
      
      if (response.data.success && response.data.data) {
        setTaskStatus(response.data.data);
        // Load file status from metadata
        if (response.data.data.metadata?.fileStatus) {
          setFileStatus(response.data.data.metadata.fileStatus);
        } else if (response.data.data.readme?.generated) {
          // If README is generated but no file status, trigger a file check
          // This handles cases where file check wasn't run before README generation
          try {
            const preCheckResponse = await api.post(`/file-generation/${response.data.data.taskId}/pre-check`);
            if (preCheckResponse.data.success && preCheckResponse.data.data.fileStatus) {
              setFileStatus(preCheckResponse.data.data.fileStatus);
            }
          } catch (error) {
            // Silently fail - file check is optional
            console.log('File pre-check not available:', error.message);
          }
        }
        if (response.data.data.readme?.generated) {
          loadReadme(response.data.data.taskId);
        }
      }
    } catch (error) {
      // Task might not exist yet, that's okay - don't show error for 404
      if (error.response?.status !== 404) {
        console.error('FileGenerationWorkflow: Error loading task status:', error);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadReadme = async (taskId) => {
    try {
      const response = await api.get(`/file-generation/${taskId}/readme`);
      if (response.data.success) {
        setReadme(response.data.data.readme);
      }
    } catch (error) {
      console.error('Failed to load README:', error);
    }
  };

  const checkFilesWithoutTask = async () => {
    if (!deploymentId) {
      return;
    }

    try {
      setCheckingFiles(true);
      const response = await api.get(`/file-generation/deployment/${deploymentId}/check-files`);
      
      if (response.data.success && response.data.data?.fileStatus) {
        const status = response.data.data.fileStatus;
        setFileStatus(status);
        
        // Check if files exist - also check if workspace path is set
        const hasFiles = status.existing && status.existing.length > 0;
        const hasWorkspacePath = status.workspacePath !== null && status.workspacePath !== undefined;
        
        // Only set filesDetected if we have a workspace path and files
        if (hasWorkspacePath) {
          setFilesDetected(hasFiles);
          
          // Log for debugging
          console.log('File check result:', {
            existingFiles: status.existing?.length || 0,
            missingFiles: status.missing?.length || 0,
            workspacePath: status.workspacePath,
            filesDetected: hasFiles
          });
        } else {
          // Workspace path not set yet, don't mark as detected
          setFilesDetected(false);
          console.log('Workspace path not set, files check skipped');
        }
      }
    } catch (error) {
      // Log error for debugging
      console.error('File check without task failed:', error);
      setFilesDetected(false);
    } finally {
      setCheckingFiles(false);
    }
  };

  const initiateTask = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // First check if files exist
      let currentFileStatus = fileStatus;
      if (!currentFileStatus) {
        // Re-check files if we don't have status
        try {
          const checkResponse = await api.get(`/file-generation/deployment/${deploymentId}/check-files`);
          if (checkResponse.data.success && checkResponse.data.data?.fileStatus) {
            currentFileStatus = checkResponse.data.data.fileStatus;
            setFileStatus(currentFileStatus);
          }
        } catch (error) {
          console.log('Failed to check files before initiation:', error.message);
        }
      }
      
      const hasExistingFiles = currentFileStatus?.existing && currentFileStatus.existing.length > 0;
      
      const response = await api.post('/file-generation/initiate', {
        deploymentId,
        stageId: stageId || 'GENERATE_README',
        taskType: 'docker'
      });

      if (response.data.success) {
        const taskId = response.data.data.taskId;
        
        // Do pre-check to update task metadata
        await preCheckFiles(taskId);
        
        // If files exist, skip README generation and go straight to verification
        if (hasExistingFiles) {
          // Update task status to ready_to_verify
          try {
            await api.post(`/file-generation/${taskId}/approve-readme`);
            // Then trigger verification
            await verifyFiles(taskId);
          } catch (error) {
            console.error('Failed to skip to verification:', error);
            // Fall back to normal flow
            await generateReadme(taskId);
          }
        } else {
          // No files exist, generate README
          await generateReadme(taskId);
        }
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to initiate task';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      onError?.(error);
    } finally {
      setLoading(false);
    }
  };

  const preCheckFiles = async (taskId) => {
    try {
      setLoading(true);
      const response = await api.post(`/file-generation/${taskId}/pre-check`);
      
      if (response.data.success) {
        setFileStatus(response.data.data.fileStatus);
        await loadTaskStatus();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to check files';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      // Don't throw - continue to README generation even if pre-check fails
    } finally {
      setLoading(false);
    }
  };

  const generateReadme = async (taskId) => {
    try {
      setLoading(true);
      const response = await api.post(`/file-generation/${taskId}/readme`);
      
      if (response.data.success) {
        setReadme(response.data.data.readme);
        // Update file status if provided
        if (response.data.data.fileStatus) {
          setFileStatus(response.data.data.fileStatus);
        }
        await loadTaskStatus();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to generate README';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const approveReadme = async (taskId) => {
    try {
      setLoading(true);
      const response = await api.post(`/file-generation/${taskId}/approve-readme`);
      
      if (response.data.success) {
        await loadTaskStatus();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to approve README';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const rejectReadme = async (taskId, reason) => {
    try {
      setLoading(true);
      const response = await api.post(`/file-generation/${taskId}/reject-readme`, { reason });
      
      if (response.data.success) {
        // Regenerate README
        await generateReadme(taskId);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to reject README';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (taskId, files) => {
    try {
      setLoading(true);
      const formData = new FormData();
      files.forEach(file => {
        formData.append('files', file);
      });

      const response = await api.post(`/file-generation/${taskId}/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        setUploadedFiles(response.data.data.files);
        await loadTaskStatus();
        // Auto-trigger verification
        await verifyFiles(taskId);
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to upload files';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const verifyFiles = async (taskId) => {
    try {
      setLoading(true);
      setError(null);
      
      // Use README-based verification endpoint
      const response = await api.post(`/file-generation/${taskId}/verify-from-readme`);
      
      if (response.data.success) {
        setVerificationReport({
          ...response.data.data.verification,
          detectedFiles: response.data.data.detectedFiles
        });
        await loadTaskStatus();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to verify files';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const approveVerification = async (taskId) => {
    try {
      setLoading(true);
      const response = await api.post(`/file-generation/${taskId}/approve-verification`);
      
      if (response.data.success) {
        onComplete?.();
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Failed to approve verification';
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
    } finally {
      setLoading(false);
    }
  };

  const copyReadmeToClipboard = () => {
    navigator.clipboard.writeText(readme);
  };

  // Show error if deploymentId is missing
  if (!deploymentId) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-6">
        <div className="flex items-center">
          <ExclamationTriangleIcon className="w-6 h-6 text-yellow-400 mr-3" />
          <div>
            <h3 className="text-lg font-semibold text-yellow-400 mb-1">Deployment ID Required</h3>
            <p className="text-yellow-300 text-sm">Please select a deployment first to generate Docker files.</p>
          </div>
        </div>
      </div>
    );
  }

  // Show loading while initializing or checking files
  if (initializing || checkingFiles || (loading && !taskStatus)) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <ArrowPathIcon className="w-8 h-8 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">
            {checkingFiles ? 'Checking for existing files...' : 'Checking for existing file generation task...'}
          </p>
        </div>
      </div>
    );
  }

  // Show error prominently if there is one
  if (error && !taskStatus) {
    return (
      <div className="space-y-4">
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4">
          <div className="flex items-start">
            <XCircleIcon className="w-5 h-5 text-red-400 mr-3 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-400 font-semibold mb-1">Error</p>
              <p className="text-red-300 text-sm">{typeof error === 'string' ? error : error?.message || JSON.stringify(error)}</p>
              <button
                onClick={() => {
                  setError(null);
                  loadTaskStatus();
                }}
                className="mt-3 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
        <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
          <div className="text-center">
            <SparklesIcon className="w-12 h-12 text-blue-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Ready to Generate Files</h3>
            <p className="text-gray-400 mb-4">Start the file generation workflow</p>
            <button
              onClick={initiateTask}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Start File Generation'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show UI when no task exists
  if (!taskStatus) {
    // If files are detected OR fileStatus shows existing files, show file status and verify button
    const hasExistingFiles = fileStatus && fileStatus.existing && fileStatus.existing.length > 0;
    const hasWorkspacePath = fileStatus && fileStatus.workspacePath;
    
    if (hasExistingFiles && hasWorkspacePath) {
      return (
        <div className="space-y-6">
          <FilePreCheckViewer
            fileStatus={fileStatus}
            loading={false}
            taskId={null}
          />
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <div className="text-center">
              <CheckCircleIcon className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Docker Files Detected</h3>
              <p className="text-gray-400 mb-4">
                Found {fileStatus.existing?.length || 0} existing Docker file(s). You can verify them or generate a new README.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={async () => {
                    // Create task and go straight to verification
                    try {
                      setLoading(true);
                      setError(null);
                      const response = await api.post('/file-generation/initiate', {
                        deploymentId,
                        stageId: stageId || 'GENERATE_README',
                        taskType: 'docker'
                      });
                      if (response.data.success) {
                        const taskId = response.data.data.taskId;
                        await preCheckFiles(taskId);
                        // Update task status to ready_to_verify, then verify
                        try {
                          // Set task status directly to ready_to_verify via API
                          // First, try to verify files directly
                          await verifyFiles(taskId);
                        } catch (error) {
                          console.error('Failed to verify files:', error);
                          // If verification fails, reload task status to see current state
                          await loadTaskStatus();
                        }
                      }
                    } catch (error) {
                      const errorMessage = error.response?.data?.error || error.message || 'Failed to verify files';
                      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
                    } finally {
                      setLoading(false);
                    }
                  }}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {loading ? 'Verifying...' : 'Verify Files'}
                </button>
                <button
                  onClick={initiateTask}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Generate New README
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // No files detected or workspace path not set, show file status if available
    if (fileStatus && hasWorkspacePath) {
      return (
        <div className="space-y-6">
          <FilePreCheckViewer
            fileStatus={fileStatus}
            loading={false}
            taskId={null}
          />
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
            <div className="text-center">
              <SparklesIcon className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">Ready to Generate Files</h3>
              <p className="text-gray-400 mb-4">
                {fileStatus.existing?.length === 0 
                  ? 'No Docker files found. Start the file generation workflow to create them.'
                  : 'Start the file generation workflow'}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={initiateTask}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? 'Starting...' : 'Start File Generation'}
                </button>
                <button
                  onClick={() => checkFilesWithoutTask()}
                  disabled={checkingFiles}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
                >
                  {checkingFiles ? 'Checking...' : 'Refresh File Check'}
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    // No file status or workspace path not set yet
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <SparklesIcon className="w-12 h-12 text-blue-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Ready to Generate Files</h3>
          <p className="text-gray-400 mb-4">
            {fileStatus && !fileStatus.workspacePath 
              ? 'Workspace path not set. Please set the workspace path first.'
              : 'Start the file generation workflow'}
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={initiateTask}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Starting...' : 'Start File Generation'}
            </button>
            <button
              onClick={() => checkFilesWithoutTask()}
              disabled={checkingFiles}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              {checkingFiles ? 'Checking...' : 'Check Files'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const status = taskStatus.status;
  
  // Determine effective status - if failed but README is approved, show next step
  let effectiveStatus = status;
  if (status === 'failed' && taskStatus.readme?.approved) {
    // If README is approved, we should show the next step (awaiting cursor generation)
    effectiveStatus = 'readme_approved';
  } else if (status === 'failed' && taskStatus.readme?.generated && !taskStatus.readme?.approved) {
    // If README is generated but not approved, show it for approval
    effectiveStatus = 'readme_generated';
  }

  return (
    <div className="space-y-6">
      {/* Show failed status warning if task failed */}
      {status === 'failed' && (
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-start">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 mr-3 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-yellow-400 font-semibold mb-1">Task Status: Failed</p>
              <p className="text-yellow-300 text-sm mb-3">
                The task encountered an error, but you can continue from the current step.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    try {
                      setLoading(true);
                      await api.post(`/file-generation/${taskStatus.taskId}/pre-check`);
                      await loadTaskStatus();
                    } catch (error) {
                      console.error('Failed to re-check files:', error);
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                >
                  Re-check Files
                </button>
                <button
                  onClick={() => loadTaskStatus()}
                  className="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg transition-colors"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Pre-Check Step - Show when checking or if file status exists */}
      {(effectiveStatus === 'checking_files' || (fileStatus && (fileStatus.existing?.length > 0 || fileStatus.missing?.length > 0))) && (
        <FilePreCheckViewer
          fileStatus={fileStatus}
          loading={effectiveStatus === 'checking_files' && loading}
          taskId={taskStatus?.taskId}
        />
      )}

      {/* README Generation Step */}
      {(effectiveStatus === 'readme_generating' || effectiveStatus === 'readme_generated') && (
        <ReadmeViewer
          readme={readme}
          status={effectiveStatus}
          taskId={taskStatus.taskId}
          loading={loading}
          fileStatus={fileStatus}
          onApprove={approveReadme}
          onReject={rejectReadme}
          onRegenerate={generateReadme}
          onCopy={copyReadmeToClipboard}
        />
      )}

      {/* Cursor Generation Instructions */}
      {effectiveStatus === 'readme_approved' && (
        <CursorGenerationInstructions
          readme={readme}
          onCopy={copyReadmeToClipboard}
        />
      )}

      {/* Verify Files Step - No upload needed */}
      {(effectiveStatus === 'awaiting_cursor' || effectiveStatus === 'ready_to_verify') && (
        <VerifyFilesButton
          taskId={taskStatus.taskId}
          loading={loading}
          onVerify={verifyFiles}
        />
      )}

      {/* File Upload Step - Legacy/optional */}
      {effectiveStatus === 'files_uploaded' && (
        <FileUpload
          taskId={taskStatus.taskId}
          uploadedFiles={uploadedFiles}
          loading={loading}
          onUpload={handleFileUpload}
          fileInputRef={fileInputRef}
          setFileInputRef={setFileInputRef}
        />
      )}

      {/* Verification Step */}
      {(effectiveStatus === 'verifying' || effectiveStatus === 'verified') && (
        <VerificationReport
          report={verificationReport}
          taskId={taskStatus.taskId}
          status={effectiveStatus}
          loading={loading}
          onApprove={approveVerification}
          onReverify={verifyFiles}
        />
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-4 mb-4">
          <div className="flex items-start">
            <XCircleIcon className="w-5 h-5 text-red-400 mr-3 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-400 font-semibold mb-1">Error</p>
              <p className="text-red-300 text-sm">{typeof error === 'string' ? error : error?.message || JSON.stringify(error)}</p>
            </div>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-300 ml-2"
              title="Dismiss error"
            >
              <XCircleIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * File Pre-Check Viewer Component
 */
const FilePreCheckViewer = ({ fileStatus, loading, taskId }) => {
  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <ArrowPathIcon className="w-8 h-8 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">Checking for existing files...</p>
        </div>
      </div>
    );
  }

  if (!fileStatus) {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <p className="text-gray-400">No file status available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center mb-4">
        <DocumentTextIcon className="w-6 h-6 text-blue-500 mr-2" />
        <h3 className="text-lg font-semibold text-white">File Pre-Check</h3>
      </div>

      {fileStatus.workspacePath ? (
        <div className="space-y-4">
          {/* Existing Files */}
          {fileStatus.existing && fileStatus.existing.length > 0 && (
            <div className="p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
              <h4 className="text-sm font-semibold text-green-400 mb-2 flex items-center">
                <CheckCircleIcon className="w-4 h-4 mr-1" />
                Existing Files ({fileStatus.existing.length})
              </h4>
              <ul className="list-disc list-inside text-xs text-gray-300 space-y-1">
                {fileStatus.existing.map((file, index) => (
                  <li key={index}>{file.path}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Files */}
          {fileStatus.missing && fileStatus.missing.length > 0 && (
            <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
              <h4 className="text-sm font-semibold text-yellow-400 mb-2 flex items-center">
                <XCircleIcon className="w-4 h-4 mr-1" />
                Files to Generate ({fileStatus.missing.length})
              </h4>
              <ul className="list-disc list-inside text-xs text-gray-300 space-y-1">
                {fileStatus.missing.map((file, index) => (
                  <li key={index}>{file.path}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Environment Files */}
          {fileStatus.envFiles && fileStatus.envFiles.length > 0 && (
            <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-400 mb-2">
                Environment Files ({fileStatus.envFiles.length})
              </h4>
              <ul className="list-disc list-inside text-xs text-gray-300 space-y-1">
                {fileStatus.envFiles.map((file, index) => (
                  <li key={index}>{file.path || file}</li>
                ))}
              </ul>
            </div>
          )}

          {fileStatus.existing?.length === 0 && fileStatus.missing?.length === 0 && (
            <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
              <p className="text-sm text-gray-400">No Docker files found. All files need to be generated.</p>
            </div>
          )}

          <p className="text-xs text-gray-500 mt-4">
            Workspace: {fileStatus.workspacePath}
          </p>
        </div>
      ) : (
        <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 mr-2" />
            <div>
              <p className="text-yellow-400 font-semibold text-sm mb-1">Workspace Path Not Set</p>
              <p className="text-yellow-300 text-xs">
                Please set the workspace path in the Deployment Workspace to enable file detection.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * README Viewer Component
 */
const ReadmeViewer = ({ readme, status, taskId, loading, fileStatus, onApprove, onReject, onRegenerate, onCopy }) => {
  const [rejectionReason, setRejectionReason] = useState('');

  if (status === 'readme_generating') {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <ArrowPathIcon className="w-8 h-8 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">Generating README...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center">
          <DocumentTextIcon className="w-6 h-6 text-blue-500 mr-2" />
          <h3 className="text-lg font-semibold text-white">Generated README</h3>
        </div>
        <button
          onClick={onCopy}
          className="px-3 py-1.5 text-sm bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 flex items-center"
        >
          <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
          Copy
        </button>
      </div>

      {/* Show file status summary if available */}
      {fileStatus && (
        <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="grid grid-cols-2 gap-4 text-xs">
            {fileStatus.existing && fileStatus.existing.length > 0 && (
              <div className="flex items-center">
                <CheckCircleIcon className="w-4 h-4 text-green-400 mr-1" />
                <span className="text-gray-400">Existing: {fileStatus.existing.length}</span>
              </div>
            )}
            {fileStatus.missing && fileStatus.missing.length > 0 && (
              <div className="flex items-center">
                <XCircleIcon className="w-4 h-4 text-yellow-400 mr-1" />
                <span className="text-gray-400">To Generate: {fileStatus.missing.length}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="bg-gray-950 rounded-lg p-4 mb-4 max-h-96 overflow-y-auto border border-gray-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          className="prose prose-invert prose-sm max-w-none"
        >
          {readme}
        </ReactMarkdown>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => onApprove(taskId)}
          disabled={loading}
          className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center"
        >
          <CheckCircleIcon className="w-5 h-5 mr-2" />
          Approve README
        </button>
        <button
          onClick={() => {
            if (rejectionReason) {
              onReject(taskId, rejectionReason);
            } else {
              const reason = prompt('Please provide a reason for rejection:');
              if (reason) {
                onReject(taskId, reason);
              }
            }
          }}
          disabled={loading}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center"
        >
          <XCircleIcon className="w-5 h-5 mr-2" />
          Reject
        </button>
      </div>
    </div>
  );
};

/**
 * Cursor Generation Instructions Component
 */
const CursorGenerationInstructions = ({ readme, onCopy }) => {
  return (
    <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-6">
      <div className="flex items-start">
        <SparklesIcon className="w-6 h-6 text-blue-400 mr-3 mt-1" />
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white mb-2">Generate Files in Cursor</h3>
          <ol className="list-decimal list-inside space-y-2 text-gray-300 mb-4">
            <li>Copy the README content below</li>
            <li>Open Cursor in your workspace</li>
            <li>Paste the README and ask Cursor to generate the Docker files</li>
            <li>Once files are generated, upload them using the button below</li>
          </ol>
          <button
            onClick={onCopy}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center"
          >
            <ClipboardDocumentIcon className="w-5 h-5 mr-2" />
            Copy README to Clipboard
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Verify Files Button Component
 */
const VerifyFilesButton = ({ taskId, loading, onVerify }) => {
  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center mb-4">
        <CheckCircleIcon className="w-6 h-6 text-green-500 mr-2" />
        <h3 className="text-lg font-semibold text-white">Ready to Verify</h3>
      </div>

      <div className="mb-4">
        <p className="text-sm text-gray-300 mb-2">
          Files have been generated in Cursor. Click the button below to verify them automatically.
        </p>
        <p className="text-xs text-gray-500">
          The system will use terminal commands to check if the expected files exist and verify their contents.
        </p>
      </div>

      <button
        onClick={() => onVerify(taskId)}
        disabled={loading}
        className="w-full px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center font-medium"
      >
        {loading ? (
          <>
            <ArrowPathIcon className="w-5 h-5 mr-2 animate-spin" />
            Verifying Files...
          </>
        ) : (
          <>
            <CheckCircleIcon className="w-5 h-5 mr-2" />
            Verify Generated Files
          </>
        )}
      </button>
    </div>
  );
};

/**
 * File Upload Component (Legacy/Optional)
 */
const FileUpload = ({ taskId, uploadedFiles, loading, onUpload, fileInputRef, setFileInputRef }) => {
  const [files, setFiles] = useState([]);
  const inputRef = React.useRef(null);

  useEffect(() => {
    setFileInputRef?.(inputRef);
  }, [setFileInputRef]);

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
  };

  const handleUpload = () => {
    if (files.length > 0) {
      onUpload(taskId, files);
    }
  };

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center mb-4">
        <ArrowUpTrayIcon className="w-6 h-6 text-green-500 mr-2" />
        <h3 className="text-lg font-semibold text-white">Upload Generated Files</h3>
      </div>

      {uploadedFiles.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-400 mb-2">Uploaded files:</p>
          <ul className="list-disc list-inside text-gray-300 space-y-1">
            {uploadedFiles.map((file, index) => (
              <li key={index}>{file.path} ({file.size} bytes)</li>
            ))}
          </ul>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept=".dockerfile,.yml,.yaml,.json,.sh,.conf,.config,.env,Dockerfile,docker-compose.yml,docker-compose.yaml"
      />

      <div className="flex gap-3">
        <button
          onClick={() => inputRef.current?.click()}
          className="px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700"
        >
          Select Files
        </button>
        {files.length > 0 && (
          <>
            <span className="px-4 py-2 text-gray-400">{files.length} file(s) selected</span>
            <button
              onClick={handleUpload}
              disabled={loading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Uploading...' : 'Upload Files'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Verification Report Component
 */
const VerificationReport = ({ report, taskId, status, loading, onApprove, onReverify }) => {
  if (status === 'verifying') {
    return (
      <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
        <div className="text-center">
          <ArrowPathIcon className="w-8 h-8 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">Verifying files...</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const hasErrors = report.summary?.errors > 0;
  const hasWarnings = report.summary?.warnings > 0;
  const passed = report.summary?.passed;
  const detectedFiles = report.detectedFiles;

  return (
    <div className="bg-gray-900 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center mb-4">
        {passed ? (
          <CheckCircleIcon className="w-6 h-6 text-green-500 mr-2" />
        ) : (
          <XCircleIcon className="w-6 h-6 text-red-500 mr-2" />
        )}
        <h3 className="text-lg font-semibold text-white">Verification Report</h3>
      </div>

      <div className="mb-4">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-2xl font-bold text-white">{report.summary?.totalFiles || 0}</div>
            <div className="text-sm text-gray-400">Files</div>
          </div>
          <div className="bg-red-900/20 rounded-lg p-3 border border-red-500/30">
            <div className="text-2xl font-bold text-red-400">{report.summary?.errors || 0}</div>
            <div className="text-sm text-gray-400">Errors</div>
          </div>
          <div className="bg-yellow-900/20 rounded-lg p-3 border border-yellow-500/30">
            <div className="text-2xl font-bold text-yellow-400">{report.summary?.warnings || 0}</div>
            <div className="text-sm text-gray-400">Warnings</div>
          </div>
        </div>

        {/* Detected Files Summary */}
        {detectedFiles && (
          <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Detected Files:</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center">
                <CheckCircleIcon className="w-4 h-4 text-green-400 mr-1" />
                <span className="text-gray-400">Found: {detectedFiles.existing?.length || 0}</span>
              </div>
              <div className="flex items-center">
                <XCircleIcon className="w-4 h-4 text-red-400 mr-1" />
                <span className="text-gray-400">Missing: {detectedFiles.missing?.length || 0}</span>
              </div>
            </div>
            {detectedFiles.existing && detectedFiles.existing.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Found files:</p>
                <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
                  {detectedFiles.existing.slice(0, 5).map((file, index) => (
                    <li key={index}>{file.path}</li>
                  ))}
                  {detectedFiles.existing.length > 5 && (
                    <li className="text-gray-500">... and {detectedFiles.existing.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
            {detectedFiles.missing && detectedFiles.missing.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-red-400 mb-1">Missing files:</p>
                <ul className="list-disc list-inside text-xs text-red-300 space-y-0.5">
                  {detectedFiles.missing.map((file, index) => (
                    <li key={index}>{file.path}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Environment Files Info */}
        {report.envFiles && (
          <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">Environment Files:</h4>
            <div className="flex items-center mb-1">
              <span className="text-xs text-gray-400">
                Detected: {report.envFiles.detected?.length || 0} .env file(s)
              </span>
            </div>
            {report.envFiles.variableCount > 0 && (
              <div className="flex items-center">
                <span className="text-xs text-gray-400">
                  Variables: {report.envFiles.variableCount} environment variable(s)
                </span>
              </div>
            )}
            {report.envFiles.detected && report.envFiles.detected.length > 0 && (
              <div className="mt-2">
                <p className="text-xs text-gray-500 mb-1">Found .env files:</p>
                <ul className="list-disc list-inside text-xs text-gray-400 space-y-0.5">
                  {report.envFiles.detected.slice(0, 5).map((file, index) => (
                    <li key={index}>{file.path}</li>
                  ))}
                  {report.envFiles.detected.length > 5 && (
                    <li className="text-gray-500">... and {report.envFiles.detected.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}

        {hasErrors && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-red-400 mb-2">Errors:</h4>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              {report.errors?.slice(0, 5).map((error, index) => (
                <li key={index}>
                  <span className="font-medium">{error.file}:</span> {error.message}
                  {error.suggestion && (
                    <span className="text-gray-500 ml-2">({error.suggestion})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasWarnings && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-yellow-400 mb-2">Warnings:</h4>
            <ul className="list-disc list-inside space-y-1 text-gray-300">
              {report.warnings?.slice(0, 5).map((warning, index) => (
                <li key={index}>
                  <span className="font-medium">{warning.file}:</span> {warning.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex gap-3">
        {passed ? (
          <button
            onClick={() => onApprove(taskId)}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center"
          >
            <CheckCircleIcon className="w-5 h-5 mr-2" />
            Approve & Continue
          </button>
        ) : (
          <button
            onClick={() => onReverify(taskId)}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Re-verify Files
          </button>
        )}
      </div>
    </div>
  );
};

export default FileGenerationWorkflow;

