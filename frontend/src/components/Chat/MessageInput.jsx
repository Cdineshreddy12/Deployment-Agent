import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { ArrowUp, Sparkles, Paperclip } from 'lucide-react';
import { cn } from '../../lib/utils';

const MessageInput = ({ onSend, disabled }) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize logic
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message);
      setMessage('');
      if (textareaRef.current) {
          textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative group max-w-4xl mx-auto">
        {/* Glow effect - Subtle for light theme */}
        <div className="absolute -inset-1 bg-gradient-to-r from-primary/10 via-indigo-500/5 to-purple-500/10 rounded-[2rem] opacity-0 group-hover:opacity-100 transition duration-700 blur-xl"></div>
        
        <form onSubmit={handleSubmit} className="relative bg-white rounded-[2rem] border border-slate-200 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] flex items-end p-2.5 transition-all duration-300 focus-within:border-primary/40 focus-within:shadow-[0_10px_50px_-10px_rgba(var(--primary),0.15)] focus-within:ring-4 focus-within:ring-primary/5">
            
            <button 
                type="button" 
                className="p-4 text-slate-400 hover:text-primary transition-all rounded-2xl hover:bg-slate-50"
                title="Attach Files"
            >
                <Paperclip className="h-5 w-5" />
            </button>

            <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask your infrastructure pilot anything..."
                disabled={disabled}
                rows={1}
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-[200px] min-h-[56px] py-4 px-3 text-base font-medium leading-relaxed placeholder:text-slate-400 focus-visible:outline-none text-slate-900 scrollbar-hide"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            />
            
            <div className="pb-1.5 pr-1.5">
                <Button 
                    type="submit" 
                    disabled={disabled || !message.trim()} 
                    size="icon" 
                    className={cn(
                        "h-12 w-12 rounded-2xl transition-all duration-500",
                        message.trim() 
                        ? 'bg-primary text-white shadow-xl shadow-primary/20 hover:shadow-primary/40 hover:scale-105 active:scale-95' 
                        : 'bg-slate-100 text-slate-300'
                    )}
                >
                    {disabled ? (
                        <Sparkles className="h-5 w-5 animate-spin" />
                    ) : (
                        <ArrowUp className="h-6 w-6 stroke-[2.5px]" />
                    )}
                </Button>
            </div>
        </form>
    </div>
  );
};

export default MessageInput;
