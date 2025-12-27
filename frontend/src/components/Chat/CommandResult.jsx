import React from 'react';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { prism, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

const CommandResult = ({ commandResult }) => {
  if (!commandResult) return null;
  
  const isSuccess = commandResult.success !== undefined ? commandResult.success : (commandResult.status === 'success');
  const output = commandResult.output || commandResult.message || JSON.stringify(commandResult, null, 2);
  const error = commandResult.error;
  
  return (
    <div className={`mt-6 rounded-2xl border transition-all shadow-sm ${isSuccess ? 'border-emerald-100 bg-emerald-50/30' : 'border-red-100 bg-red-50/30'} p-6`}>
        <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
                {isSuccess ? (
                    <div className="bg-emerald-500 p-1.5 rounded-lg shadow-lg shadow-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                ) : (
                    <div className="bg-red-500 p-1.5 rounded-lg shadow-lg shadow-red-500/20">
                        <XCircle className="w-4 h-4 text-white" />
                    </div>
                )}
                <span className={`text-sm font-black uppercase tracking-widest ${isSuccess ? 'text-emerald-700' : 'text-red-700'}`}>
                    {isSuccess ? 'Execution Perfect' : 'Execution Failed'}
                </span>
            </div>
            {commandResult.duration && (
                <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-white px-2 py-1 rounded-full border border-slate-100">
                    <Clock className="w-3 h-3" />
                    {commandResult.duration}ms
                </div>
            )}
        </div>
        
        {commandResult.command && (
            <div className="mb-4 text-[11px] font-bold text-slate-500 bg-white border border-slate-100 p-2 rounded-xl inline-block font-mono">
                <span className="text-primary mr-2">›</span> {commandResult.command}
            </div>
        )}

        <div className="space-y-4">
            {output && (
                <div>
                    <div className="text-[10px] text-slate-400 mb-2 font-black uppercase tracking-widest px-1">Standard Output</div>
                    <SyntaxHighlighter
                        style={prism}
                        language="bash"
                        PreTag="div"
                        customStyle={{ margin: 0, padding: '1rem', fontSize: '0.75rem', borderRadius: '1rem', background: '#ffffff', border: '1px solid #f1f5f9' }}
                    >
                        {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                    </SyntaxHighlighter>
                </div>
            )}
            
            {error && (
                <div>
                    <div className="text-[10px] text-red-400 mb-2 font-black uppercase tracking-widest px-1">Error Stream</div>
                    <SyntaxHighlighter
                        style={prism}
                        language="bash"
                        PreTag="div"
                        customStyle={{ margin: 0, padding: '1rem', fontSize: '0.75rem', borderRadius: '1rem', background: '#fef2f2', border: '1px solid #fee2e2' }}
                    >
                        {typeof error === 'string' ? error : JSON.stringify(error, null, 2)}
                    </SyntaxHighlighter>
                </div>
            )}
            
             {/* Terraform Changes Visualization */}
            {commandResult.changes && (
              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="bg-white border border-emerald-100 rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-xl font-black text-emerald-600">{commandResult.changes.add || 0}</div>
                  <div className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Added</div>
                </div>
                <div className="bg-white border border-amber-100 rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-xl font-black text-amber-600">{commandResult.changes.change || 0}</div>
                  <div className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Modified</div>
                </div>
                <div className="bg-white border border-red-100 rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-xl font-black text-red-600">{commandResult.changes.destroy || 0}</div>
                  <div className="text-[9px] text-slate-400 font-black uppercase tracking-widest">Removed</div>
                </div>
              </div>
            )}
        </div>
    </div>
  );
};

export default CommandResult;
