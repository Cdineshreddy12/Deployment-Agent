import React, { useState, useEffect } from 'react';
import {
  DocumentTextIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  CloudArrowUpIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';

/**
 * EnvImporter - Component to select and import .env files from project tree
 * Allows importing .env content and saving as credentials for deployment
 */

const EnvFileCard = ({ file, selected, onClick, onPreview }) => (
  <div
    className={`p-3 rounded-lg border cursor-pointer transition-all ${
      selected
        ? 'border-blue-500 bg-blue-500/10'
        : 'border-gray-700 bg-gray-800/50 hover:border-gray-600'
    }`}
    onClick={onClick}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center">
        <DocumentTextIcon className="w-5 h-5 text-yellow-400 mr-2" />
        <div>
          <span className="text-sm font-medium text-gray-200">{file.name}</span>
          <span className="text-xs text-gray-500 ml-2">{file.path}</span>
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onPreview(file); }}
        className="p-1 text-gray-400 hover:text-white transition-colors"
        title="Preview file"
      >
        <EyeIcon className="w-4 h-4" />
      </button>
    </div>
  </div>
);

const VariablePreview = ({ variables, showValues, onToggleShow }) => (
  <div className="space-y-1">
    {Object.entries(variables).map(([key, { value, isSecret }]) => (
      <div key={key} className="flex items-center text-sm font-mono">
        <span className="text-gray-300 w-48 truncate">{key}</span>
        <span className="text-gray-500 mx-2">=</span>
        <span className={`flex-1 truncate ${isSecret ? 'text-yellow-400' : 'text-gray-400'}`}>
          {showValues || !isSecret ? value : '••••••••'}
        </span>
        {isSecret && (
          <LockClosedIcon className="w-4 h-4 text-yellow-500 ml-2" title="Secret value" />
        )}
      </div>
    ))}
  </div>
);

export default function EnvImporter({
  deploymentId,
  envFiles = [],
  repositoryUrl,
  onImportComplete,
  className = ''
}) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [parsedVariables, setParsedVariables] = useState({});
  const [showValues, setShowValues] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [credentialName, setCredentialName] = useState('');

  // Parse .env content into variables
  const parseEnvContent = (content) => {
    const vars = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        let cleanValue = value.trim();
        if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
          cleanValue = cleanValue.slice(1, -1);
        }
        vars[key] = {
          value: cleanValue,
          isSecret: /password|secret|key|token|api|auth/i.test(key)
        };
      }
    }
    
    return vars;
  };

  // Fetch file content from GitHub
  const handlePreviewFile = async (file) => {
    setSelectedFile(file);
    setLoading(true);
    setError(null);
    
    try {
      // If we have repository URL, fetch from GitHub
      if (repositoryUrl) {
        const response = await api.post('/github/read-file', {
          repositoryUrl,
          filePath: file.path
        });
        
        if (response.data.success) {
          const content = response.data.data.content;
          setFileContent(content);
          setParsedVariables(parseEnvContent(content));
          setCredentialName(file.name.replace(/^\./, '').replace(/\./g, '_'));
        } else {
          setError('Failed to load file content');
        }
      } else {
        // For local files, we might not have direct access
        setError('Preview not available for local files - import directly');
      }
    } catch (err) {
      console.error('Preview error:', err);
      setError(err.response?.data?.error?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  // Import .env file to deployment
  const handleImport = async () => {
    if (!selectedFile || !fileContent) return;
    
    setImporting(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await api.post(`/project/${deploymentId}/env/import`, {
        filePath: selectedFile.path,
        content: fileContent,
        name: selectedFile.name,
        service: 'main'
      });
      
      if (response.data.success) {
        setSuccess(`Imported ${response.data.data.variableCount} variables`);
        if (onImportComplete) {
          onImportComplete({
            file: selectedFile,
            variables: parsedVariables,
            variableCount: Object.keys(parsedVariables).length
          });
        }
      } else {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error?.message || 'Import failed';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Import error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Import failed';
      setError(errorMessage);
    } finally {
      setImporting(false);
    }
  };

  // Save as stored credential
  const handleSaveAsCredential = async () => {
    if (!fileContent || !credentialName.trim()) return;
    
    setSavingCredential(true);
    setError(null);
    setSuccess(null);
    
    try {
      const response = await api.post('/credentials/from-env', {
        name: credentialName,
        content: fileContent,
        platform: 'env-file',
        description: `Imported from ${selectedFile?.path || '.env'}`
      });
      
      if (response.data.success) {
        setSuccess('Saved as credential for future deployments');
      } else {
        const errorMsg = typeof response.data.error === 'string' 
          ? response.data.error 
          : response.data.error?.message || 'Failed to save credential';
        setError(errorMsg);
      }
    } catch (err) {
      console.error('Save credential error:', err);
      const errorMessage = err.response?.data?.error?.message || 
                          err.response?.data?.error || 
                          err.message || 
                          'Failed to save credential';
      setError(errorMessage);
    } finally {
      setSavingCredential(false);
    }
  };

  // Handle direct paste
  const handlePasteContent = async () => {
    try {
      const content = await navigator.clipboard.readText();
      setFileContent(content);
      setParsedVariables(parseEnvContent(content));
      setSelectedFile({ name: 'pasted.env', path: 'clipboard' });
    } catch (err) {
      setError('Failed to read from clipboard');
    }
  };

  const variableCount = Object.keys(parsedVariables).length;
  const secretCount = Object.values(parsedVariables).filter(v => v.isSecret).length;

  return (
    <div className={`bg-gray-800/50 border border-gray-700 rounded-lg flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <DocumentTextIcon className="w-5 h-5 text-yellow-400 mr-2" />
            <span className="text-sm font-medium text-gray-200">.env Files from Project</span>
          </div>
          <button
            onClick={handlePasteContent}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Paste from clipboard
          </button>
        </div>
      </div>

      {/* File list */}
      <div className="p-4 border-b border-gray-700">
        {envFiles.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">
            No .env files detected in project
          </p>
        ) : (
          <div className="space-y-2">
            {envFiles.map((file, index) => (
              <EnvFileCard
                key={index}
                file={file}
                selected={selectedFile?.path === file.path}
                onClick={() => setSelectedFile(file)}
                onPreview={handlePreviewFile}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview section */}
      {selectedFile && (
        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <ArrowPathIcon className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          ) : fileContent ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">
                  {variableCount} variable{variableCount !== 1 ? 's' : ''}
                </span>
                {secretCount > 0 && (
                  <span className="flex items-center text-yellow-400">
                    <LockClosedIcon className="w-4 h-4 mr-1" />
                    {secretCount} secret{secretCount !== 1 ? 's' : ''}
                  </span>
                )}
                <button
                  onClick={() => setShowValues(!showValues)}
                  className="flex items-center text-gray-400 hover:text-white transition-colors"
                >
                  {showValues ? (
                    <><EyeSlashIcon className="w-4 h-4 mr-1" /> Hide values</>
                  ) : (
                    <><EyeIcon className="w-4 h-4 mr-1" /> Show values</>
                  )}
                </button>
              </div>

              {/* Variables preview */}
              <div className="bg-gray-900/50 rounded-lg p-3 max-h-48 overflow-y-auto">
                <VariablePreview
                  variables={parsedVariables}
                  showValues={showValues}
                />
              </div>

              {/* Credential name for saving */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Credential Name (for saving)</label>
                <input
                  type="text"
                  value={credentialName}
                  onChange={(e) => setCredentialName(e.target.value)}
                  placeholder="my-project-env"
                  className="w-full bg-gray-900/50 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 text-center py-4">
              Click preview to load file content
            </p>
          )}
        </div>
      )}

      {/* Error / Success messages */}
      {error && (
        <div className="mx-4 mb-2 flex items-center p-2 bg-red-500/20 border border-red-500/30 rounded text-sm text-red-400">
          <XCircleIcon className="w-4 h-4 mr-2 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mb-2 flex items-center p-2 bg-green-500/20 border border-green-500/30 rounded text-sm text-green-400">
          <CheckCircleIcon className="w-4 h-4 mr-2 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Action buttons */}
      <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between">
        <button
          onClick={handleImport}
          disabled={!selectedFile || !fileContent || importing}
          className="flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {importing ? (
            <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ArrowDownTrayIcon className="w-4 h-4 mr-2" />
          )}
          Import to Deployment
        </button>
        
        <button
          onClick={handleSaveAsCredential}
          disabled={!fileContent || !credentialName.trim() || savingCredential}
          className="flex items-center px-4 py-2 text-sm font-medium text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {savingCredential ? (
            <ArrowPathIcon className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <KeyIcon className="w-4 h-4 mr-2" />
          )}
          Save as Credential
        </button>
      </div>
    </div>
  );
}

