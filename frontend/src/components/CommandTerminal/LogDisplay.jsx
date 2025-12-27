import React, { useEffect, useRef } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { AlertCircle, CheckCircle, XCircle, Info, Terminal } from 'lucide-react';

const LogDisplay = ({ logs = [], autoScroll = true }) => {
  const scrollAreaRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const getLogIcon = (level) => {
    switch (level) {
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warn':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case 'info':
      default:
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getLogColor = (level) => {
    switch (level) {
      case 'error':
        return 'text-red-700 bg-red-50/50 border-red-100';
      case 'warn':
        return 'text-amber-700 bg-amber-50/50 border-amber-100';
      case 'success':
        return 'text-emerald-700 bg-emerald-50/50 border-emerald-100';
      case 'info':
      default:
        return 'text-slate-700 bg-white border-slate-100';
    }
  };

  return (
    <ScrollArea ref={scrollAreaRef} className="h-full w-full">
      <div className="p-4 space-y-2 font-mono text-sm">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-300">
            <Terminal className="h-12 w-12 mb-4 opacity-20" />
            <p className="text-xs font-bold uppercase tracking-widest">Waiting for command input...</p>
          </div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 py-2 px-3 rounded-xl border transition-all duration-200 hover:shadow-sm ${getLogColor(log.level)}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getLogIcon(log.level)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1.5 opacity-60">
                  <span className="text-[10px] font-black text-slate-400">
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                  </span>
                  {log.level && (
                    <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest h-4 px-1.5 border-current/20">
                      {log.level}
                    </Badge>
                  )}
                  {log.commandId && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-1.5 rounded">
                      ID: {log.commandId.substring(0, 8)}
                    </span>
                  )}
                </div>
                <pre className="whitespace-pre-wrap break-words text-[13px] font-medium leading-relaxed font-mono">
                  {log.message || log.content || ''}
                </pre>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
};

export default LogDisplay;
