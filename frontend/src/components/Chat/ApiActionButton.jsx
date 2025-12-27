import React, { useState } from 'react';
import { Play, Loader2, CheckCircle, XCircle, FileCode, Terminal, Send, ExternalLink } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../hooks/use-toast';
import { cn } from '../../lib/utils';
import { useTerminalSafe } from '../../context/TerminalContext';

/**
 * Determines the action type based on the API call parameters
 */
function getActionType(name, params) {
  const url = params?.url || '';
  const body = params?.body || {};
  
  // Check for file generation
  if (url.includes('generate-files') || body.terraformCode || body.filename) {
    return {
      type: 'generate_files',
      label: 'Generate File',
      icon: FileCode,
      description: body.filename || 'terraform file'
    };
  }
  
  // Check for terraform commands
  if (url.includes('terraform') || name?.toLowerCase().includes('terraform')) {
    return {
      type: 'terraform',
      label: 'Run Terraform',
      icon: Terminal,
      description: body.command || 'terraform command'
    };
  }
  
  // Check for CLI execution
  if (url.includes('execute') || url.includes('cli')) {
    return {
      type: 'execute',
      label: 'Execute',
      icon: Terminal,
      description: body.command || 'command'
    };
  }
  
  // Default API call
  return {
    type: 'api_call',
    label: 'Execute API Call',
    icon: Send,
    description: params?.method || 'API request'
  };
}

const ApiActionButton = ({ name, params, deploymentId, onExecute, incomplete = false }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error'
  const [result, setResult] = useState(null);
  const { toast } = useToast();
  const terminalContext = useTerminalSafe();

  const actionType = getActionType(name, params);
  const ActionIcon = actionType.icon;

  const handleExecute = async () => {
    if (!params || incomplete) return;

    setIsExecuting(true);
    setStatus(null);
    setResult(null);

    try {
      let response;
      const url = params.url || '';
      const method = (params.method || 'POST').toUpperCase();
      const body = params.body || {};

      // Normalize the URL - extract path from full URL if needed
      let apiPath = url;
      if (url.includes('localhost') || url.includes('127.0.0.1')) {
        // Extract path from full URL
        const urlObj = new URL(url);
        apiPath = urlObj.pathname;
      }
      
      // Ensure the path starts with /api/v1 or add it
      if (!apiPath.startsWith('/api/v1')) {
        if (apiPath.startsWith('/')) {
          apiPath = '/api/v1' + apiPath;
        } else {
          apiPath = '/api/v1/' + apiPath;
        }
      }
      
      // Remove /api/v1 prefix since the api service adds it
      apiPath = apiPath.replace(/^\/api\/v1/, '');

      // Add deploymentId to body if not present
      const requestBody = { ...body };
      if (deploymentId && !requestBody.deploymentId) {
        requestBody.deploymentId = deploymentId;
      }

      // Execute the appropriate API call based on method
      switch (method) {
        case 'GET':
          response = await api.get(apiPath, { params: requestBody });
          break;
        case 'POST':
          response = await api.post(apiPath, requestBody);
          break;
        case 'PUT':
          response = await api.put(apiPath, requestBody);
          break;
        case 'PATCH':
          response = await api.patch(apiPath, requestBody);
          break;
        case 'DELETE':
          response = await api.delete(apiPath, { data: requestBody });
          break;
        default:
          response = await api.post(apiPath, requestBody);
      }

      setStatus('success');
      setResult(response.data);

      toast({
        title: "Execution Successful",
        description: `${actionType.label} completed. ${actionType.type === 'generate_files' ? 'File created successfully.' : 'Check Terminal for details.'}`,
        variant: "default",
      });

      // Notify terminal context about the execution
      if (terminalContext) {
        if (actionType.type === 'generate_files') {
          terminalContext.notifyFileGenerated({
            filename: params.body?.filename || actionType.description,
            path: params.body?.repoPath || '.'
          });
        } else {
          terminalContext.notifyApiExecuted({
            url: apiPath,
            method,
            success: true,
            message: response.data?.message || `${actionType.label} completed successfully`
          });
        }
      }

      if (onExecute) {
        onExecute({
          type: actionType.type,
          name,
          params,
          result: response.data
        });
      }

      setTimeout(() => {
        setStatus(null);
      }, 5000);
    } catch (error) {
      setStatus('error');
      const errorMessage = error.response?.data?.error?.message || error.message;
      setResult({ error: errorMessage });

      toast({
        title: "Execution Failed",
        description: errorMessage,
        variant: "destructive",
      });

      // Notify terminal context about the failure
      if (terminalContext) {
        terminalContext.notifyApiExecuted({
          url: params.url,
          method: params.method || 'POST',
          success: false,
          message: errorMessage
        });
      }
      
      setTimeout(() => setStatus(null), 5000);
    } finally {
      setIsExecuting(false);
    }
  };

  // Render different button styles based on status
  const getButtonStyles = () => {
    if (incomplete) {
      return "bg-amber-50 border-amber-200 text-amber-600 cursor-not-allowed opacity-70";
    }
    if (status === 'success') {
      return "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-emerald-100";
    }
    if (status === 'error') {
      return "bg-red-50 border-red-200 text-red-700 shadow-red-100";
    }
    return "bg-white hover:bg-primary/5 border-slate-200 hover:border-primary/40 text-slate-700 hover:text-primary";
  };

  return (
    <div className="my-4">
      <button 
        onClick={handleExecute}
        disabled={isExecuting || incomplete}
        className={cn(
          "inline-flex items-center gap-3 px-5 py-3 border rounded-2xl text-sm font-bold transition-all group disabled:cursor-not-allowed shadow-sm",
          getButtonStyles()
        )}
      >
        <div className={cn(
          "p-2 rounded-xl transition-all",
          status === 'success' ? "bg-emerald-100" : 
          status === 'error' ? "bg-red-100" :
          incomplete ? "bg-amber-100" :
          "bg-slate-100 group-hover:bg-primary/10"
        )}>
          {isExecuting ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : status === 'success' ? (
            <CheckCircle className="w-4 h-4 text-emerald-600" />
          ) : status === 'error' ? (
            <XCircle className="w-4 h-4 text-red-600" />
          ) : (
            <ActionIcon className={cn(
              "w-4 h-4 transition-transform",
              incomplete ? "text-amber-600" : "text-slate-500 group-hover:text-primary group-hover:scale-110"
            )} />
          )}
        </div>
        
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
            {incomplete ? 'Incomplete' : actionType.label}
          </span>
          <span className="font-mono text-xs">
            {actionType.description}
          </span>
        </div>

        {!incomplete && !isExecuting && status !== 'success' && (
          <Play className="w-4 h-4 ml-2 text-slate-300 group-hover:text-primary transition-colors" />
        )}
      </button>

      {/* Show result summary if available */}
      {status === 'success' && result && (
        <div className="mt-2 ml-14 text-xs text-emerald-600 font-medium animate-fade-in">
          ✓ {result.message || 'Completed successfully'}
        </div>
      )}
      
      {status === 'error' && result?.error && (
        <div className="mt-2 ml-14 text-xs text-red-600 font-medium animate-fade-in">
          ✗ {result.error}
        </div>
      )}

      {incomplete && (
        <div className="mt-2 ml-14 text-xs text-amber-600 font-medium">
          ⚠ This action is incomplete and cannot be executed
        </div>
      )}
    </div>
  );
};

export default ApiActionButton;

