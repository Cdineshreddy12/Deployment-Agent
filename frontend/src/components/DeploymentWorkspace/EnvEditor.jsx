import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  DocumentArrowUpIcon,
  ClipboardDocumentIcon,
  LockClosedIcon,
  EyeIcon,
  EyeSlashIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  KeyIcon
} from '@heroicons/react/24/outline';
import api from '../../services/api';

/**
 * EnvEditor - Multi-tab .env editor with upload/paste and encrypted storage
 */

const EnvVariable = ({ 
  envKey, 
  value, 
  isSecret, 
  showValue, 
  onToggleShow, 
  onChange, 
  onDelete 
}) => {
  return (
    <div className="flex items-center space-x-2 py-1.5 group">
      <div className="flex-1 flex items-center">
        <span className="font-mono text-sm text-gray-300 w-48 truncate">{envKey}</span>
        <span className="text-gray-500 mx-2">=</span>
        <div className="flex-1 relative">
          <input
            type={showValue || !isSecret ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(envKey, e.target.value)}
            className="w-full bg-gray-900/50 border border-gray-600 rounded px-2 py-1 text-sm font-mono text-gray-300 focus:outline-none focus:border-blue-500"
            placeholder="value"
          />
          {isSecret && (
            <button
              onClick={() => onToggleShow(envKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
            >
              {showValue ? (
                <EyeSlashIcon className="w-4 h-4" />
              ) : (
                <EyeIcon className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>
      
      {isSecret && (
        <LockClosedIcon className="w-4 h-4 text-yellow-500" title="Secret variable" />
      )}
      
      <button
        onClick={() => onDelete(envKey)}
        className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <TrashIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

const ServiceTab = ({ name, active, hasEnv, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'text-blue-400 border-blue-400'
          : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-gray-600'
      }`}
    >
      <span className="flex items-center">
        {name}
        {hasEnv && (
          <CheckCircleIcon className="w-4 h-4 ml-1.5 text-green-400" />
        )}
      </span>
    </button>
  );
};

export default function EnvEditor({
  deploymentId,
  services = [{ name: 'main', type: 'backend' }],
  environments = {},
  onSave,
  onUpload,
  className = ''
}) {
  const [activeService, setActiveService] = useState(services[0]?.name || 'main');
  const [envContent, setEnvContent] = useState(environments[activeService] || '');
  const [parsedVars, setParsedVars] = useState({});
  const [showSecrets, setShowSecrets] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [mode, setMode] = useState('raw'); // 'raw' or 'parsed'
  const [newVarKey, setNewVarKey] = useState('');
  const [credentials, setCredentials] = useState([]);
  const [showCredsDialog, setShowCredsDialog] = useState(false);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const fileInputRef = useRef(null);

  // Fetch credentials when dialog opens
  useEffect(() => {
    if (showCredsDialog) {
      fetchCredentials();
    }
  }, [showCredsDialog]);

  const fetchCredentials = async () => {
    setLoadingCreds(true);
    try {
      const response = await api.get('/credentials?type=env-file');
      setCredentials(response.data.credentials || []);
    } catch (err) {
      console.error('Failed to fetch credentials:', err);
    } finally {
      setLoadingCreds(false);
    }
  };

  const loadCredential = async (credId) => {
    try {
      const response = await api.get(`/credentials/${credId}/decrypt`);
      const content = Object.entries(response.data.credential.data)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      setEnvContent(content);
      setParsedVars(parseEnvContent(content));
      setShowCredsDialog(false);
    } catch (err) {
      console.error('Failed to load credential:', err);
    }
  };

  // Parse .env content into variables
  const parseEnvContent = useCallback((content) => {
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
          isSecret: /password|secret|key|token|api/i.test(key)
        };
      }
    }
    
    return vars;
  }, []);

  // Convert parsed vars back to .env format
  const varsToEnvContent = useCallback((vars) => {
    return Object.entries(vars)
      .map(([key, { value }]) => {
        if (value.includes(' ') || value.includes('=') || value.includes('#')) {
          return `${key}="${value}"`;
        }
        return `${key}=${value}`;
      })
      .join('\n');
  }, []);

  // Handle tab change
  const handleTabChange = (serviceName) => {
    setActiveService(serviceName);
    const content = environments[serviceName] || '';
    setEnvContent(content);
    setParsedVars(parseEnvContent(content));
  };

  // Handle raw content change
  const handleContentChange = (e) => {
    const content = e.target.value;
    setEnvContent(content);
    setParsedVars(parseEnvContent(content));
  };

  // Handle variable change in parsed mode
  const handleVarChange = (key, value) => {
    setParsedVars(prev => ({
      ...prev,
      [key]: { ...prev[key], value }
    }));
    setEnvContent(varsToEnvContent({
      ...parsedVars,
      [key]: { ...parsedVars[key], value }
    }));
  };

  // Handle variable delete
  const handleVarDelete = (key) => {
    const newVars = { ...parsedVars };
    delete newVars[key];
    setParsedVars(newVars);
    setEnvContent(varsToEnvContent(newVars));
  };

  // Handle add new variable
  const handleAddVar = () => {
    if (!newVarKey.trim()) return;
    
    const key = newVarKey.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (parsedVars[key]) return; // Already exists
    
    setParsedVars(prev => ({
      ...prev,
      [key]: { value: '', isSecret: false }
    }));
    setNewVarKey('');
  };

  // Handle file upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const content = await file.text();
    setEnvContent(content);
    setParsedVars(parseEnvContent(content));
    
    if (onUpload) {
      onUpload(activeService, content, file);
    }
  };

  // Handle paste from clipboard
  const handlePaste = async () => {
    try {
      const content = await navigator.clipboard.readText();
      setEnvContent(content);
      setParsedVars(parseEnvContent(content));
    } catch (err) {
      console.error('Failed to read clipboard:', err);
    }
  };

  // Handle save
  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus(null);
    
    try {
      if (onSave) {
        await onSave(activeService, envContent);
        setSaveStatus({ type: 'success', message: 'Saved successfully' });
      }
    } catch (err) {
      setSaveStatus({ type: 'error', message: err.message });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  // Toggle secret visibility
  const toggleSecretVisibility = (key) => {
    setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const varsCount = Object.keys(parsedVars).length;
  const secretsCount = Object.values(parsedVars).filter(v => v.isSecret).length;

  return (
    <div className={`flex flex-col h-full bg-gray-800/50 rounded-lg border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center">
          <LockClosedIcon className="w-4 h-4 text-yellow-400 mr-2" />
          <span className="text-sm font-medium text-gray-200">Environment Variables</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setMode(mode === 'raw' ? 'parsed' : 'raw')}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            {mode === 'raw' ? 'Parsed View' : 'Raw View'}
          </button>
        </div>
      </div>

      {/* Service tabs */}
      {services.length > 1 && (
        <div className="flex border-b border-gray-700 overflow-x-auto">
          {services.map(service => (
            <ServiceTab
              key={service.name}
              name={service.name}
              active={activeService === service.name}
              hasEnv={!!environments[service.name]}
              onClick={() => handleTabChange(service.name)}
            />
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900/30">
        <div className="flex items-center space-x-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".env,.env.*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center px-2 py-1 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <DocumentArrowUpIcon className="w-4 h-4 mr-1" />
            Upload
          </button>
          <button
            onClick={handlePaste}
            className="flex items-center px-2 py-1 text-xs text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
          >
            <ClipboardDocumentIcon className="w-4 h-4 mr-1" />
            Paste
          </button>
          <button
            onClick={() => setShowCredsDialog(true)}
            className="flex items-center px-2 py-1 text-xs text-blue-300 bg-blue-900/40 hover:bg-blue-900/60 rounded transition-colors border border-blue-500/30"
          >
            <KeyIcon className="w-4 h-4 mr-1" />
            Load from Store
          </button>
        </div>
        
        <div className="flex items-center space-x-2">
          {saveStatus && (
            <span className={`text-xs ${saveStatus.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
              {saveStatus.message}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <ArrowPathIcon className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <CheckCircleIcon className="w-4 h-4 mr-1" />
            )}
            Save to DB
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {mode === 'raw' ? (
          <textarea
            value={envContent}
            onChange={handleContentChange}
            placeholder="# Paste your .env content here&#10;DATABASE_URL=postgres://...&#10;API_KEY=..."
            className="w-full h-full bg-gray-900/50 border border-gray-600 rounded p-3 text-sm font-mono text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
            spellCheck={false}
          />
        ) : (
          <div className="space-y-1">
            {Object.entries(parsedVars).map(([key, { value, isSecret }]) => (
              <EnvVariable
                key={key}
                envKey={key}
                value={value}
                isSecret={isSecret}
                showValue={showSecrets[key]}
                onToggleShow={toggleSecretVisibility}
                onChange={handleVarChange}
                onDelete={handleVarDelete}
              />
            ))}
            
            {/* Add new variable */}
            <div className="flex items-center space-x-2 pt-3 border-t border-gray-700 mt-3">
              <input
                type="text"
                value={newVarKey}
                onChange={(e) => setNewVarKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddVar()}
                placeholder="NEW_VARIABLE_NAME"
                className="flex-1 bg-gray-900/50 border border-gray-600 rounded px-2 py-1 text-sm font-mono text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <button
                onClick={handleAddVar}
                className="flex items-center px-2 py-1 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                <PlusIcon className="w-4 h-4 mr-1" />
                Add
              </button>
            </div>

            {varsCount === 0 && (
              <div className="text-center text-gray-500 text-sm py-8">
                No environment variables. Upload a file or paste content.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{varsCount} variable{varsCount !== 1 ? 's' : ''}</span>
          {secretsCount > 0 && (
            <span className="flex items-center text-yellow-400">
              <LockClosedIcon className="w-3 h-3 mr-1" />
              {secretsCount} secret{secretsCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Credentials Dialog */}
      {showCredsDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-sm font-medium text-white flex items-center">
                <KeyIcon className="w-4 h-4 mr-2 text-blue-400" />
                Select Stored .env File
              </h3>
              <button 
                onClick={() => setShowCredsDialog(false)}
                className="text-gray-400 hover:text-white"
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 max-h-[400px] overflow-y-auto">
              {loadingCreds ? (
                <div className="flex justify-center py-8">
                  <ArrowPathIcon className="w-6 h-6 text-blue-400 animate-spin" />
                </div>
              ) : credentials.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No stored .env files found.
                </div>
              ) : (
                <div className="space-y-2">
                  {credentials.map(cred => (
                    <button
                      key={cred.id}
                      onClick={() => loadCredential(cred.id)}
                      className="w-full flex items-center justify-between p-3 bg-gray-900/50 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors group"
                    >
                      <div className="text-left">
                        <div className="text-sm font-medium text-gray-200 group-hover:text-white">{cred.name}</div>
                        <div className="text-[10px] text-gray-500">{cred.platform} • {cred.envVarCount} variables</div>
                      </div>
                      <CheckCircleIcon className="w-4 h-4 text-blue-400 opacity-0 group-hover:opacity-100" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-4 py-3 bg-gray-900/50 border-t border-gray-700 flex justify-end">
              <button
                onClick={() => setShowCredsDialog(false)}
                className="px-4 py-1.5 text-xs font-medium text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

