import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, prism } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { User, Bot, Loader2, ChevronDown, ChevronRight, Terminal, Cpu, Copy, Check, AlertTriangle, Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import { parseMessageContent } from '../../lib/messageParser';
import CommandResult from './CommandResult';
import CommandButton from './CommandButton';
import ApiActionButton from './ApiActionButton';

// --- Helper Components ---

const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1.5 hover:bg-slate-100 rounded-md transition-all duration-200 text-slate-400 hover:text-slate-900"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-500 animate-in zoom-in duration-200" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
};

const ParameterView = ({ value, depth = 0, paramName = '' }) => {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 italic text-xs">null</span>;
  }

  if (typeof value === 'string') {
    const isCodeParam = paramName.toLowerCase().includes('code') ||
                       paramName.toLowerCase().includes('terraform') ||
                       paramName.toLowerCase().includes('dockerfile') ||
                       paramName.toLowerCase().includes('script') ||
                       paramName.toLowerCase().includes('config');
    
    const looksLikeCode = value.includes('terraform') ||
                         value.includes('provider') ||
                         value.includes('resource') ||
                         value.includes('FROM') ||
                         value.includes('RUN') ||
                         value.includes('function') ||
                         value.includes('const ') ||
                         value.includes('import ');
    
    const isTerraformCodeField = paramName === 'terraformCode' || 
                                 paramName.toLowerCase().includes('terraformcode');
    
    const isCodeLike = isTerraformCodeField || isCodeParam || (looksLikeCode && value.length > 50);

    if (isCodeLike) {
      let displayValue = value;
      try {
          displayValue = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
      } catch (e) {}

      let language = 'bash'; 
      const lowerName = paramName.toLowerCase();
      if (lowerName.includes('json')) language = 'json';
      else if (lowerName.includes('terraform') || lowerName.includes('tf')) language = 'hcl';
      else if (lowerName.includes('js')) language = 'javascript';
      
      return (
        <div className="relative my-2 w-full max-w-full rounded-xl border border-slate-200 overflow-hidden group">
          <div className="bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500 font-bold border-b border-slate-200 flex justify-between items-center uppercase tracking-widest">
             <div className="flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-slate-300"></div>
                 <span>{language}</span>
             </div>
             <div className="flex items-center gap-2">
                 <span className="text-slate-400 font-mono normal-case tracking-normal">{paramName}</span>
                 <CopyButton text={displayValue} />
             </div>
          </div>
          <SyntaxHighlighter
            style={prism}
            language={language}
            PreTag="div"
            customStyle={{ margin: 0, padding: '1.25rem', fontSize: '0.75rem', lineHeight: '1.6', backgroundColor: '#ffffff' }}
            wrapLines={true}
            wrapLongLines={true}
          >
            {displayValue}
          </SyntaxHighlighter>
        </div>
      );
    }
    return <span className="break-all whitespace-pre-wrap text-sm text-slate-700 font-medium leading-relaxed">{value}</span>;
  }

  if (typeof value === 'object') {
    const isArray = Array.isArray(value);
    const isEmpty = isArray ? value.length === 0 : Object.keys(value).length === 0;

    if (isEmpty) return <span className="text-slate-400 text-xs font-bold">{isArray ? '[]' : '{}'}</span>;

    return (
      <div className={cn("font-mono text-[11px] w-full", depth > 0 && "ml-3 pl-3 border-l border-slate-200")}>
        {Object.entries(value).map(([k, v]) => (
            <div key={k} className="my-2 w-full">
              <span className="text-primary font-bold mr-2">{k}:</span>
              <div className="mt-1 w-full">
                <ParameterView value={v} depth={depth + 1} paramName={k} />
              </div>
            </div>
        ))}
      </div>
    );
  }

  return <span className="text-emerald-600 font-bold text-sm font-mono">{String(value)}</span>;
};

const ToolCallDisplay = ({ name, params, incomplete = false, deploymentId, onExecute }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if this is an executable API call
  const isApiCall = name === 'api_call' || name?.includes('api') || params?.url;
  
  // Filter out internal params like _incomplete
  const displayParams = Object.fromEntries(
    Object.entries(params || {}).filter(([key]) => !key.startsWith('_'))
  );

  return (
    <div className={cn(
      "group my-5 border rounded-2xl overflow-hidden bg-white shadow-sm transition-all",
      incomplete 
        ? "border-amber-200 hover:border-amber-300" 
        : "border-slate-200 hover:border-primary/30 hover:shadow-md"
    )}>
      <div 
        className={cn(
          "flex items-center justify-between p-4 cursor-pointer transition-colors select-none",
          incomplete ? "bg-amber-50 hover:bg-amber-100" : "bg-slate-50 hover:bg-slate-100"
        )}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
              "p-2.5 rounded-xl transition-all duration-300",
              incomplete 
                ? 'bg-amber-100 text-amber-600 border border-amber-200'
                : isExpanded 
                  ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-110' 
                  : 'bg-white text-slate-400 border border-slate-200 group-hover:text-primary group-hover:border-primary/20'
          )}>
            {incomplete ? <AlertTriangle className="h-4 w-4" /> : <Terminal className="h-4 w-4" />}
          </div>
          <div className="flex flex-col">
            <span className={cn(
              "text-[9px] font-black uppercase tracking-[0.2em]",
              incomplete ? "text-amber-500" : "text-slate-400"
            )}>
              {incomplete ? 'Incomplete Request' : 'Execution Request'}
            </span>
            <span className="font-mono text-sm text-slate-900 font-bold tracking-tight">{name}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
            {incomplete && (
              <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest hidden sm:inline-block">
                Truncated
              </span>
            )}
            {!isExpanded && !incomplete && (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest hidden sm:inline-block">
                Expand Details
              </span>
            )}
            {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </div>
      </div>
      
      {isExpanded && (
        <div className="p-6 bg-white border-t border-slate-100 animate-slide-in">
          {/* Action Button for executable API calls */}
          {isApiCall && (
            <div className="mb-6 pb-6 border-b border-slate-100">
              <ApiActionButton
                name={name}
                params={displayParams}
                deploymentId={deploymentId}
                incomplete={incomplete}
                onExecute={onExecute}
              />
            </div>
          )}
          
          <div className="space-y-6">
            {Object.entries(displayParams).map(([key, value]) => (
              <div key={key} className="w-full">
                <div className="text-[9px] font-black text-slate-400 mb-2 uppercase tracking-[0.15em] flex items-center justify-between border-b border-slate-50 pb-1">
                    {key}
                    {typeof value === 'string' && <CopyButton text={value} />}
                </div>
                <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 w-full overflow-hidden">
                  <ParameterView value={value} paramName={key} />
                </div>
              </div>
            ))}
          </div>
          
          {incomplete && (
            <div className="mt-6 p-4 bg-amber-50 rounded-xl border border-amber-200 text-amber-700 text-sm">
              <div className="flex items-center gap-2 font-bold mb-1">
                <AlertTriangle className="h-4 w-4" />
                Response Truncated
              </div>
              <p className="text-xs text-amber-600">
                This tool call was cut off before completion. The AI response may have been too long. 
                You can try asking the AI to regenerate this part.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const MessageList = ({ messages, loading, deploymentId }) => {
  return (
    <div className="w-full space-y-10">
      {messages.map((message, index) => {
        const parts = message.role === 'assistant' ? parseMessageContent(message.content) : [{ type: 'text', content: message.content }];
        const isUser = message.role === 'user';
        const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

        return (
        <div
          key={index}
          className={cn(
            "flex gap-5 w-full animate-slide-in",
            isUser ? 'flex-row-reverse' : 'flex-row'
          )}
          style={{ animationFillMode: 'forwards', animationDelay: `${index * 0.05}s` }}
        >
          {/* Avatar */}
          <div className={cn(
             "h-10 w-10 md:h-12 md:w-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md border",
             isUser ? "bg-primary text-white border-primary/20 rotate-2" : "bg-white text-slate-400 border-slate-200 -rotate-2"
          )}>
             {isUser ? <User className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
          </div>
          
          {/* Message Content Group */}
          <div className={cn("flex flex-col max-w-[85%] md:max-w-[80%] lg:max-w-[75%]", isUser ? "items-end" : "items-start")}>
              
              {/* Message Bubble - Light Theme */}
              <div
                className={cn(
                  "rounded-[2rem] px-6 py-5 md:px-8 md:py-6 w-fit relative group transition-all",
                  isUser 
                    ? "bg-primary text-white rounded-tr-md shadow-xl shadow-primary/10"
                    : "bg-white border border-slate-200 rounded-tl-md shadow-sm hover:shadow-md hover:border-slate-300"
                )}
              >
                {/* Error State */}
                {message.error && (
                <div className="flex items-center gap-3 text-red-600 mb-4 font-bold bg-red-50 p-3 rounded-xl border border-red-100 text-xs uppercase tracking-tight">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-ping" />
                    Error Detected
                </div>
                )}

                <div className="text-sm md:text-base leading-relaxed">
                {parts.map((part, i) => (
                    <React.Fragment key={i}>
                    {part.type === 'text' && part.content && (
                        <div className={cn(
                            "prose max-w-none",
                            "prose-p:leading-relaxed prose-p:my-4 prose-p:font-medium prose-p:text-slate-700",
                            "prose-headings:font-black prose-headings:text-slate-900 prose-headings:mt-8 prose-headings:mb-4 prose-headings:tracking-tight",
                            "prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-800 prose-pre:rounded-2xl prose-pre:shadow-xl",
                            "prose-code:text-primary prose-code:bg-primary/5 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-lg prose-code:font-bold prose-code:before:content-none prose-code:after:content-none",
                            "prose-strong:text-slate-900 prose-strong:font-black prose-a:text-primary prose-li:marker:text-primary",
                            isUser && "text-white prose-p:text-white/95 prose-headings:text-white prose-strong:text-white prose-code:text-white prose-code:bg-white/20 prose-a:text-white prose-a:underline prose-li:text-white/90 prose-li:marker:text-white/50"
                        )}>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                            code({ node, inline, className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || '');
                                const codeString = String(children).replace(/\n$/, '');
                                
                                if (isUser) {
                                    return <code className="bg-white/20 rounded-md px-1.5 py-0.5 font-bold">{children}</code>
                                }

                                return !inline && match ? (
                                <div className="relative group/code my-8 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900">
                                    <div className="flex items-center justify-between px-5 py-3 bg-slate-800/50 border-b border-slate-800 backdrop-blur-sm">
                                        <div className="flex items-center gap-3">
                                            <div className="flex gap-2">
                                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                                                <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
                                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50"></div>
                                            </div>
                                            <span className="ml-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">{match[1]}</span>
                                        </div>
                                        <CopyButton text={codeString} />
                                    </div>
                                    <SyntaxHighlighter
                                    style={vscDarkPlus}
                                    language={match[1]}
                                    PreTag="div"
                                    className="!m-0 !bg-transparent"
                                    customStyle={{ padding: '1.5rem', fontSize: '0.85rem', lineHeight: '1.7' }}
                                    {...props}
                                    >
                                    {codeString}
                                    </SyntaxHighlighter>
                                </div>
                                ) : (
                                <code className="font-bold text-[0.9em] bg-slate-100 rounded px-1.5 py-0.5" {...props}>{children}</code>
                                );
                            }
                            }}
                        >
                            {part.content}
                        </ReactMarkdown>
                        </div>
                    )}
                    {part.type === 'tool_call' && (
                        <ToolCallDisplay 
                          name={part.name} 
                          params={part.params} 
                          incomplete={part.incomplete}
                          deploymentId={deploymentId}
                        />
                    )}
                    </React.Fragment>
                ))}
                
                {/* Footer Actions for Assistant Messages */}
                {!isUser && (
                    <div className="mt-8 space-y-6">
                        {message.commandResult && (
                        <CommandResult commandResult={message.commandResult} />
                        )}
                        
                        {message.detectedCommands && message.detectedCommands.length > 0 && deploymentId && (
                        <div className="pt-6 border-t border-slate-100 mt-4">
                            <div className="flex items-center gap-3 mb-4">
                                <Cpu className="w-4 h-4 text-primary" />
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Verified Recommendations</span>
                            </div>
                            <div className="flex flex-wrap gap-2.5">
                            {message.detectedCommands.map((cmd, idx) => (
                                <CommandButton
                                key={idx}
                                command={cmd.command}
                                deploymentId={deploymentId}
                                />
                            ))}
                            </div>
                        </div>
                        )}
                    </div>
                )}
                </div>
              </div>
              
              {/* Timestamp */}
              <div className={cn("text-[9px] font-black text-slate-400 mt-2 px-2 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity select-none", isUser ? "text-right" : "text-left")}>
                {timestamp || 'Just now'}
              </div>
          </div>
        </div>
      );})}
      
      {/* Loading Indicator - Clean Light Theme */}
      {loading && (
        <div className="flex gap-5 w-full animate-fade-in">
           <div className="h-10 w-10 md:h-12 md:w-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm">
             <Bot className="h-6 w-6 text-primary/40 animate-pulse" />
           </div>
           <div className="bg-white border border-slate-200 rounded-[1.5rem] rounded-tl-md px-6 py-4 shadow-sm flex items-center gap-4">
             <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"></div>
             </div>
             <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Processing Context...</span>
           </div>
        </div>
      )}
    </div>
  );
};

export default MessageList;
