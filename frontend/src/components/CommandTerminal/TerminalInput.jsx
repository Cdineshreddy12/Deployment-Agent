import React, { useState, useRef, useEffect } from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Send, X, Loader2, ChevronRight } from 'lucide-react';

const TerminalInput = ({ onExecute, onCancel, isExecuting, commandHistory = [], disabled = false }) => {
  const [command, setCommand] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    // Focus input when component mounts
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (command.trim() && !isExecuting && !disabled) {
      onExecute(command.trim());
      setCommand('');
      setHistoryIndex(-1);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex === -1 
          ? commandHistory.length - 1 
          : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setCommand(commandHistory[newIndex].command || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setCommand('');
        } else {
          setHistoryIndex(newIndex);
          setCommand(commandHistory[newIndex].command || '');
        }
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-center bg-slate-50 p-1.5 rounded-xl border border-slate-200 focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/5 transition-all duration-300 shadow-sm">
      <div className="flex-1 relative flex items-center">
        <div className="absolute left-3 flex items-center gap-1">
            <ChevronRight className="h-4 w-4 text-primary animate-pulse" />
        </div>
        <Input
          ref={inputRef}
          value={command}
          onChange={(e) => {
            setCommand(e.target.value);
            setHistoryIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Type cloud command..."
          disabled={isExecuting || disabled}
          className="pl-9 font-mono text-sm bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-slate-900 placeholder:text-slate-400 h-10 font-bold"
          autoComplete="off"
        />
      </div>
      {isExecuting ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onCancel}
          disabled={disabled}
          className="h-9 px-4 rounded-lg shadow-lg shadow-red-500/10 font-bold uppercase tracking-widest text-[10px]"
        >
          <X className="h-3.5 w-3.5 mr-2" />
          Abort
        </Button>
      ) : (
        <Button
          type="submit"
          size="sm"
          disabled={!command.trim() || disabled}
          className="h-9 px-5 bg-primary text-white hover:bg-primary/90 rounded-lg shadow-lg shadow-primary/20 font-bold uppercase tracking-widest text-[10px] transition-all hover:scale-105"
        >
          {disabled ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5 mr-2" />
          )}
          Run
        </Button>
      )}
    </form>
  );
};

export default TerminalInput;
