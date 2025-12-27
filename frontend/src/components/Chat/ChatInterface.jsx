import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { Server, ShieldCheck, Zap } from 'lucide-react';

const ChatInterface = ({ deploymentId }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [envVars, setEnvVars] = useState({});
  const messagesEndRef = useRef(null);

  // Mock initial history load
  useEffect(() => {
    fetchHistory();
    fetchEnvVars();
  }, [deploymentId]);

  const fetchEnvVars = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}/env`);
      setEnvVars(response.data.data.environmentVariables || {});
    } catch (error) {
      console.log('Env vars not available');
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchHistory = async () => {
    try {
      const response = await api.get(`/chat/history/${deploymentId}`);
      setMessages(response.data.data.messages || []);
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async (message) => {
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    try {
      const response = await api.post('/chat/message', {
        deploymentId,
        message,
        stream: false
      });

      const assistantMessage = {
        role: 'assistant',
        content: response.data.data.message,
        commandResult: response.data.data.commandResult || null,
        detectedCommands: response.data.data.detectedCommands || null,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        error: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white relative overflow-hidden font-sans text-slate-900">
      {/* Dynamic Header Area */}
      <div className="flex-shrink-0 h-14 border-b border-slate-100 bg-white/50 backdrop-blur-md z-10 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
            <div className="relative group">
                <div className="absolute -inset-0.5 bg-primary/20 rounded-full blur opacity-50 group-hover:opacity-100 transition duration-300"></div>
                <div className="relative w-8 h-8 rounded-full bg-white flex items-center justify-center border border-slate-200 shadow-sm">
                    <Server className="text-primary w-4 h-4" />
                </div>
            </div>
            <div>
                <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    Infrastructure Pilot
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Live Analysis</span>
                </div>
            </div>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tight">Isolated Env</span>
            </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-10 space-y-10 scroll-smooth relative custom-scrollbar bg-slate-50/30">
        {/* Background Decorative Elements - Subtle for light theme */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
            <div className="absolute top-[5%] left-[10%] w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px]"></div>
            <div className="absolute bottom-[10%] right-[10%] w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[120px]"></div>
        </div>

        <div className="relative z-10 max-w-4xl mx-auto min-h-full pb-6">
            {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[55vh] text-center space-y-10 animate-fade-in">
                    <div className="relative">
                        <div className="absolute -inset-6 bg-primary/10 rounded-full blur-2xl animate-pulse"></div>
                        <div className="w-20 h-20 rounded-[2.5rem] bg-white border border-slate-200 flex items-center justify-center relative shadow-2xl rotate-3 hover:rotate-0 transition-transform duration-500">
                            <Zap className="w-10 h-10 text-primary fill-primary/10" />
                        </div>
                    </div>
                    
                    <div className="space-y-3 max-w-lg">
                        <h2 className="text-4xl font-black text-slate-900 tracking-tight">How can I help you?</h2>
                        <p className="text-slate-500 text-lg font-medium">
                            Describe your cloud requirements. I can provision, debug, or optimize your infrastructure in real-time.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10 w-full max-w-3xl px-4">
                        {[
                            { title: 'Provision S3 Bucket', desc: 'Secure storage with versioning', color: 'bg-blue-50 text-blue-700' },
                            { title: 'Deploy ECS Cluster', desc: 'Scalable container orchestration', color: 'bg-purple-50 text-purple-700' },
                            { title: 'Add Cache Layer', desc: 'ElastiCache Redis implementation', color: 'bg-orange-50 text-orange-700' },
                            { title: 'Network Audit', desc: 'Scan VPC for security gaps', color: 'bg-emerald-50 text-emerald-700' }
                        ].map((item) => (
                             <button 
                                key={item.title} 
                                onClick={() => handleSendMessage(item.title)}
                                className="group p-5 text-left rounded-[1.5rem] border border-slate-200 bg-white hover:bg-slate-50 hover:border-primary/30 transition-all duration-300 flex flex-col gap-1.5 shadow-sm hover:shadow-xl hover:-translate-y-1"
                             >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors">{item.title}</span>
                                    <div className={`w-2 h-2 rounded-full ${item.color.split(' ')[0]}`}></div>
                                </div>
                                <span className="text-xs font-medium text-slate-500 leading-tight">{item.desc}</span>
                             </button>
                        ))}
                    </div>
                </div>
            ) : (
                <MessageList messages={messages} loading={loading} deploymentId={deploymentId} />
            )}
            <div ref={messagesEndRef} className="h-6" />
        </div>
      </div>
      
      {/* Input Area - Floats slightly */}
      <div className="flex-shrink-0 z-20 w-full bg-gradient-to-t from-white via-white/90 to-transparent pt-6 pb-8 px-6">
        <div className="max-w-4xl mx-auto">
            <MessageInput onSend={handleSendMessage} disabled={loading} />
            <div className="mt-4 text-center">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                    Verified Cloud Execution
                    <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                </p>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
