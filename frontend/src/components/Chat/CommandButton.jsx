import React, { useState } from 'react';
import { Play, Loader2, CheckCircle, XCircle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../hooks/use-toast';

const CommandButton = ({ command, deploymentId, onExecute }) => {
  const [isExecuting, setIsExecuting] = useState(false);
  const [status, setStatus] = useState(null); // 'success' | 'error'
  const { toast } = useToast();

  const handleExecute = async () => {
    if (!deploymentId || !command) return;

    setIsExecuting(true);
    setStatus(null);

    try {
      const commandType = command.toLowerCase().startsWith('terraform') 
        ? 'terraform' 
        : command.toLowerCase().startsWith('aws')
        ? 'aws'
        : 'shell';

      const response = await api.post('/commands/execute', {
        deploymentId,
        command,
        type: commandType
      });

      if (response.data.data.requiresConfirmation) {
        toast({
          title: "Confirmation Required",
          description: "This command requires confirmation before execution.",
          variant: "default",
        });
        setIsExecuting(false);
        return;
      }

      setStatus('success');
      toast({
        title: "Command Executed",
        description: "Command execution started. Check the Terminal tab for output.",
        variant: "default",
      });

      if (onExecute) {
        onExecute(command);
      }

      setTimeout(() => {
        setStatus(null);
        setIsExecuting(false);
      }, 3000);
    } catch (error) {
      setStatus('error');
      const errorMessage = error.response?.data?.error?.message || error.message;
      toast({
        title: "Execution Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setIsExecuting(false);
      setTimeout(() => setStatus(null), 3000);
    }
  };

  return (
    <button 
      onClick={handleExecute}
      disabled={isExecuting || !deploymentId}
      className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold transition-all group disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow hover:border-primary/30"
    >
        {isExecuting ? (
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
        ) : status === 'success' ? (
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
        ) : status === 'error' ? (
          <XCircle className="w-3.5 h-3.5 text-red-500" />
        ) : (
          <Play className="w-3.5 h-3.5 text-primary group-hover:scale-110 transition-transform" />
        )}
        <span className="font-mono text-slate-700 group-hover:text-primary transition-colors">{command}</span>
    </button>
  );
};

export default CommandButton;
