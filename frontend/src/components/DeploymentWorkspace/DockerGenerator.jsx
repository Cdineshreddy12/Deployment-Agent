import React, { useState } from 'react';
import {
  CubeIcon,
  SparklesIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  DocumentDuplicateIcon,
  EyeIcon,
  CloudArrowUpIcon,
  CodeBracketIcon,
  DocumentTextIcon,
  ArrowRightIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';
import FileGenerationWorkflow from './FileGenerationWorkflow';

/**
 * DockerGenerator - Panel for generating Docker files using Claude
 * Allows generating Dockerfile per service and docker-compose.yml for entire project
 */

const GenerateButton = ({ onClick, loading, icon: Icon, label, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled || loading}
    className={`flex items-center justify-center px-3 py-2 text-sm font-medium rounded-lg transition-all ${
      disabled
        ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
        : loading
        ? 'bg-blue-600/50 text-blue-300 cursor-wait'
        : 'bg-blue-600 hover:bg-blue-500 text-white'
    }`}
  >
    {loading ? (
      <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
    ) : (
      <Icon className="w-4 h-4 mr-2" />
    )}
    {label}
  </button>
);

const PreviewModal = ({ isOpen, onClose, content, filename, onConfirm, explanation }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center">
            <SparklesIcon className="w-5 h-5 text-emerald-400 mr-2" />
            <h3 className="text-lg font-medium text-white">Generated: {filename}</h3>
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
                  <DocumentDuplicateIcon className="w-4 h-4 mr-1" />
                  Copy
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
            >
              <XCircleIcon className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <pre className="bg-gray-900 rounded-lg p-4 text-sm font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap">
            {content}
          </pre>

          {explanation && (
            <div className="mt-4 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
              <h4 className="text-sm font-medium text-gray-200 mb-2 flex items-center">
                <EyeIcon className="w-4 h-4 mr-1" />
                Explanation
              </h4>
              <p className="text-sm text-gray-400 whitespace-pre-wrap">{explanation}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex items-center px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            <CloudArrowUpIcon className="w-4 h-4 mr-2" />
            Add to Project
          </button>
        </div>
      </div>
    </div>
  );
};

export default function DockerGenerator({
  deploymentId,
  services = [],
  projectInfo = {},
  projectStructure = {},
  onFileGenerated,
  className = '',
  useNewWorkflow = true // New README-based workflow by default
}) {
  const [generating, setGenerating] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [useWorkflow, setUseWorkflow] = useState(useNewWorkflow);

  // Generate Dockerfile for a specific service
  const handleGenerateDockerfile = async (service) => {
    const key = `dockerfile-${service.name}`;
    setGenerating(prev => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await api.post('/project/generate-docker', {
        deploymentId,
        serviceName: service.name,
        serviceType: service.type,
        framework: service.framework,
        packageJson: service.packageJson || projectInfo,
        // envVariables will be read from .env files by backend
        projectStructure,
        servicePath: service.path || '.'
      });

      if (response.data.success) {
        setPreview({
          filename: `${service.path && service.path !== '.' ? service.path + '/' : ''}Dockerfile`,
          content: response.data.data.content,
          explanation: response.data.data.explanation,
          type: 'dockerfile',
          service: service.name,
          servicePath: service.path
        });
      } else {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error?.message || 'Failed to generate Dockerfile';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Generate Dockerfile error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to generate Dockerfile';
      setError(errorMessage);
    } finally {
      setGenerating(prev => ({ ...prev, [key]: false }));
    }
  };

  // Generate docker-compose.yml for entire project
  const handleGenerateCompose = async () => {
    setGenerating(prev => ({ ...prev, 'compose': true }));
    setError(null);

    try {
      // Detect databases from services
      const databases = services
        .filter(s => s.type === 'database' || s.type === 'cache')
        .map(s => ({ type: s.framework || s.name, name: s.name }));

      const response = await api.post('/project/generate-compose', {
        deploymentId,
        services: services.filter(s => s.type !== 'database' && s.type !== 'cache'),
        databases,
        projectInfo,
        // envVariables will be read from .env files by backend
        projectStructure
      });

      if (response.data.success) {
        setPreview({
          filename: 'docker-compose.yml',
          content: response.data.data.content,
          explanation: response.data.data.explanation,
          type: 'docker-compose'
        });
      } else {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error?.message || 'Failed to generate docker-compose.yml';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Generate docker-compose error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to generate docker-compose.yml';
      setError(errorMessage);
    } finally {
      setGenerating(prev => ({ ...prev, 'compose': false }));
    }
  };

  // Generate .dockerignore
  const handleGenerateDockerignore = async (service = null) => {
    const key = service ? `dockerignore-${service.name}` : 'dockerignore';
    setGenerating(prev => ({ ...prev, [key]: true }));
    setError(null);

    try {
      const response = await api.post('/project/generate-dockerignore', {
        deploymentId,
        framework: service?.framework || services[0]?.framework,
        language: 'javascript',
        servicePath: service?.path || '.'
      });

      if (response.data.success) {
        setPreview({
          filename: `${service?.path && service.path !== '.' ? service.path + '/' : ''}.dockerignore`,
          content: response.data.data.content,
          type: 'dockerignore',
          service: service?.name
        });
      } else {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error?.message || 'Failed to generate .dockerignore';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Generate .dockerignore error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to generate .dockerignore';
      setError(errorMessage);
    } finally {
      setGenerating(prev => ({ ...prev, [key]: false }));
    }
  };

  // Handle confirm - add generated file to project
  const handleConfirmGeneration = () => {
    if (preview && onFileGenerated) {
      onFileGenerated({
        path: preview.filename,
        content: preview.content,
        type: preview.type,
        service: preview.service
      });
    }
    setPreview(null);
  };

  const applicationServices = services.filter(s => 
    s.type !== 'database' && s.type !== 'cache'
  );

  // If using new workflow, show FileGenerationWorkflow
  if (useWorkflow) {
    return (
      <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CubeIcon className="w-5 h-5 text-blue-400 mr-2" />
              <span className="text-sm font-medium text-gray-200">Docker Generation</span>
              <span className="ml-2 text-xs text-gray-500">Powered by Claude (README-based workflow)</span>
            </div>
            <button
              onClick={() => setUseWorkflow(false)}
              className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
              title="Use legacy direct generation"
            >
              Legacy Mode
            </button>
          </div>
        </div>
        
        {/* Error Display */}
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-900/20 border border-red-500/30 rounded-lg">
            <div className="flex items-start">
              <XCircleIcon className="w-5 h-5 text-red-400 mr-2 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-400 font-semibold text-sm mb-1">Error</p>
                <p className="text-red-300 text-xs">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-400 hover:text-red-300 ml-2"
                title="Dismiss error"
              >
                <XCircleIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* New Workflow */}
        <div className="p-4">
          {!deploymentId ? (
            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-400 mr-2" />
                <div>
                  <p className="text-yellow-400 font-semibold text-sm mb-1">Deployment Required</p>
                  <p className="text-yellow-300 text-xs">Please select a deployment to generate Docker files.</p>
                </div>
              </div>
            </div>
          ) : (
            <FileGenerationWorkflow
              deploymentId={deploymentId}
              stageId="GENERATE_README"
              onComplete={() => {
                // Files have been generated and verified
                if (onFileGenerated) {
                  // Notify parent that files were generated
                  onFileGenerated({ workflow: 'completed' });
                }
              }}
              onError={(error) => {
                console.error('FileGenerationWorkflow error:', error);
                setError(error?.message || error?.toString() || 'File generation workflow error');
              }}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <CubeIcon className="w-5 h-5 text-blue-400 mr-2" />
            <span className="text-sm font-medium text-gray-200">Docker Generation</span>
            <span className="ml-2 text-xs text-gray-500">Powered by Claude (Legacy Mode)</span>
          </div>
          <button
            onClick={() => setUseWorkflow(true)}
            className="flex items-center text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-gray-700"
            title="Use new README-based workflow"
          >
            <DocumentTextIcon className="w-3 h-3 mr-1" />
            Use New Workflow
            <ArrowRightIcon className="w-3 h-3 ml-1" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Error display */}
        {error && (
          <div className="flex items-center p-3 bg-red-500/20 border border-red-500/30 rounded-lg text-sm text-red-400">
            <XCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Generate docker-compose.yml */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-200">docker-compose.yml</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Orchestrate all {services.length} service{services.length !== 1 ? 's' : ''}
              </p>
            </div>
            <GenerateButton
              onClick={handleGenerateCompose}
              loading={generating['compose']}
              icon={SparklesIcon}
              label="Generate"
              disabled={services.length === 0}
            />
          </div>
        </div>

        {/* Per-service Dockerfile generation */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Dockerfiles by Service
          </h4>
          
          {applicationServices.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">
              No application services detected
            </p>
          ) : (
            applicationServices.map(service => (
              <div
                key={service.name}
                className="p-3 bg-gray-900/50 rounded-lg border border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <CodeBracketIcon className="w-4 h-4 text-gray-500 mr-2" />
                    <div>
                      <span className="text-sm font-medium text-gray-200">{service.name}</span>
                      <span className="ml-2 text-xs text-gray-500">
                        {service.framework || service.type} • {service.path || '.'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {service.hasDockerfile && (
                      <span className="text-xs px-2 py-0.5 bg-green-500/20 text-green-400 rounded">
                        Has Dockerfile
                      </span>
                    )}
                    <GenerateButton
                      onClick={() => handleGenerateDockerfile(service)}
                      loading={generating[`dockerfile-${service.name}`]}
                      icon={SparklesIcon}
                      label={service.hasDockerfile ? 'Regenerate' : 'Generate'}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* .dockerignore generation */}
        <div className="p-3 bg-gray-900/50 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-medium text-gray-200">.dockerignore</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Exclude unnecessary files from Docker builds
              </p>
            </div>
            <GenerateButton
              onClick={() => handleGenerateDockerignore()}
              loading={generating['dockerignore']}
              icon={SparklesIcon}
              label="Generate"
            />
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      <PreviewModal
        isOpen={!!preview}
        onClose={() => setPreview(null)}
        content={preview?.content || ''}
        filename={preview?.filename || ''}
        explanation={preview?.explanation}
        onConfirm={handleConfirmGeneration}
      />
    </div>
  );
}

