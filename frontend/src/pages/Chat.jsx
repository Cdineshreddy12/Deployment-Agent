import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import ChatInterface from '../components/Chat/ChatInterface';
import CommandTerminal from '../components/CommandTerminal/CommandTerminal';
import RepositorySelector from '../components/RepositorySelector';
import CodeAnalysisResults from '../components/CodeAnalysisResults';
import InfrastructureDiscovery from '../components/InfrastructureDiscovery';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Plus, MessageSquare, Github, Terminal, Activity, GitBranch, ArrowLeft, Maximize2, Layout } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { cn } from '../lib/utils';
import { TerminalProvider } from '../context/TerminalContext';

const Chat = () => {
  const { deploymentId } = useParams();
  const navigate = useNavigate();
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [codeAnalysis, setCodeAnalysis] = useState(null);
  const [infrastructureDiscovery, setInfrastructureDiscovery] = useState(null);
  const { toast } = useToast();
  
  // View states: 'split' | 'chat' | 'terminal'
  const [activeView, setActiveView] = useState('split');
  const [activeRightTab, setActiveRightTab] = useState('terminal');

  useEffect(() => {
    if (deploymentId) {
      fetchDeployment();
    } else {
      setLoading(false);
    }
  }, [deploymentId]);

  const fetchDeployment = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}`);
      const deploymentData = response.data.data.deployment;
      setDeployment(deploymentData);
      
      if (deploymentData.repositoryUrl) {
        setRepositoryUrl(deploymentData.repositoryUrl);
      }
      
      if (deploymentData.codeAnalysis) {
        try {
          const codeAnalysisResponse = await api.get(`/code-analysis/${deploymentId}`);
          setCodeAnalysis(codeAnalysisResponse.data.data.analysis);
        } catch (error) {
          // Code analysis not available
        }
      }
      
      if (deploymentData.existingInfrastructure) {
        try {
          const infraResponse = await api.get(`/infrastructure-discovery/${deploymentId}`);
          setInfrastructureDiscovery(infraResponse.data.data.discovery);
        } catch (error) {
          // Infrastructure discovery not available
        }
      }
    } catch (error) {
      console.error('Error fetching deployment:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRepositorySelect = async (url) => {
    setRepositoryUrl(url);
    if (deploymentId) {
      try {
        await api.patch(`/deployments/${deploymentId}`, {
          repositoryUrl: url
        });
      } catch (error) {
        console.error('Failed to update deployment:', error);
      }
    }
  };

  const handleAnalyzeRepository = async (url) => {
    try {
      const response = await api.post('/github/analyze', {
        repositoryUrl: url,
        deploymentId
      });
      const analysis = response.data.data.analysis;
      setCodeAnalysis(analysis.codeAnalysis);
      toast({
        title: 'Repository Analyzed',
        description: 'Code analysis completed successfully',
      });
    } catch (error) {
      toast({
        title: 'Analysis Failed',
        description: error.response?.data?.error?.message || 'Failed to analyze repository',
        variant: 'destructive',
      });
    }
  };

  const handleNewDeployment = async () => {
    try {
      const response = await api.post('/deployments', {
        name: 'New Deployment',
        description: 'Created from chat',
        environment: 'development'
      });
      toast({
        title: "Deployment created",
        description: "Starting conversation...",
      });
      navigate(`/chat/${response.data.data.deployment.deploymentId}`);
    } catch (error) {
      toast({
        title: "Error",
        description: error.response?.data?.error?.message || 'Failed to create deployment',
        variant: "destructive",
      });
    }
  };

  const getStatusVariant = (status) => {
    const statusMap = {
      'DEPLOYED': 'success',
      'DEPLOYING': 'warning',
      'PENDING_APPROVAL': 'warning',
      'DEPLOYMENT_FAILED': 'destructive',
      'SANDBOX_FAILED': 'destructive',
    };
    return statusMap[status] || 'secondary';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!deployment && !deploymentId) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-slate-50">
        <Card className="max-w-2xl w-full mx-auto shadow-xl border-border bg-white">
          <CardHeader className="text-center pb-8">
            <div className="flex justify-center mb-6">
              <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageSquare className="h-12 w-12 text-primary" />
              </div>
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900">Start a New Deployment</CardTitle>
            <CardDescription className="text-lg mt-2 text-slate-600">
              Describe your infrastructure needs in plain English and let AI generate the Terraform code for you.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center pb-8">
            <Button onClick={handleNewDeployment} size="lg" className="h-14 px-8 text-lg font-semibold shadow-md hover:shadow-xl transition-all">
              <Plus className="h-6 w-6 mr-2" />
              Create New Deployment
            </Button>
            <Button variant="ghost" className="mt-4 block mx-auto" onClick={() => navigate('/')}>
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <TerminalProvider>
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-slate-900">
      {/* Top Navigation Bar - Light Theme */}
      <header className="h-14 border-b border-slate-200 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md z-30 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div className="h-6 w-px bg-slate-200"></div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-slate-900 truncate max-w-[200px] md:max-w-[300px]">{deployment?.name}</h1>
            <Badge variant={getStatusVariant(deployment?.status)} className="uppercase text-[10px] tracking-widest font-bold">
              {deployment?.status?.replace(/_/g, ' ')}
            </Badge>
          </div>
        </div>

        {/* View Switcher Controls */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setActiveView('chat')}
                className={cn(
                    "h-8 px-3 rounded-lg text-xs font-bold gap-2 transition-all",
                    activeView === 'chat' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-900"
                )}
            >
                <MessageSquare className="h-3.5 w-3.5" />
                Chat
            </Button>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setActiveView('split')}
                className={cn(
                    "h-8 px-3 rounded-lg text-xs font-bold gap-2 transition-all",
                    activeView === 'split' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-900"
                )}
            >
                <Layout className="h-3.5 w-3.5" />
                Split
            </Button>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setActiveView('terminal')}
                className={cn(
                    "h-8 px-3 rounded-lg text-xs font-bold gap-2 transition-all",
                    activeView === 'terminal' ? "bg-white text-primary shadow-sm" : "text-slate-500 hover:text-slate-900"
                )}
            >
                <Terminal className="h-3.5 w-3.5" />
                Terminal
            </Button>
        </div>

        <div className="hidden md:flex items-center gap-4">
          <span className="bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-slate-200">
            {deployment?.environment || 'Development'}
          </span>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center border border-primary/20">
            <span className="text-xs font-bold text-primary">DS</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden bg-white relative">
        {/* Full-Screen Chat View */}
        <div className={cn(
            "flex flex-col border-r border-slate-200 transition-all duration-500 ease-in-out relative",
            activeView === 'chat' ? "w-full border-r-0" : activeView === 'terminal' ? "w-0 overflow-hidden opacity-0 pointer-events-none" : "flex-1"
        )}>
          <ChatInterface deploymentId={deploymentId} />
          {activeView === 'split' && (
              <Button 
                variant="outline" 
                size="icon" 
                onClick={() => setActiveView('chat')}
                className="absolute top-4 right-4 h-8 w-8 rounded-full bg-white/80 backdrop-blur shadow-sm border-slate-200 text-slate-400 hover:text-primary z-20"
                title="Full Screen Chat"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
          )}
        </div>

        {/* Full-Screen Terminal / Tools View */}
        <div className={cn(
            "flex flex-col bg-slate-50 border-l border-slate-200 transition-all duration-500 ease-in-out overflow-hidden shadow-inner",
            activeView === 'terminal' ? "w-full border-l-0 bg-white" : activeView === 'chat' ? "w-0 opacity-0 pointer-events-none" : "w-[40%] min-w-[400px] max-w-[700px]"
        )}>
          <Tabs value={activeRightTab} onValueChange={setActiveRightTab} className="flex-1 flex flex-col h-full">
            <div className="h-12 border-b border-slate-200 flex items-center justify-between px-4 bg-white/50">
              <TabsList className="bg-slate-200/50 p-1 gap-1 h-9 rounded-lg">
                <TabsTrigger 
                  value="terminal" 
                  className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 h-7 text-xs font-semibold transition-all"
                >
                  <Terminal className="h-3.5 w-3.5 mr-2" />
                  Terminal
                </TabsTrigger>
                <TabsTrigger 
                  value="details" 
                  className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 h-7 text-xs font-semibold transition-all"
                >
                  <Activity className="h-3.5 w-3.5 mr-2" />
                  Details
                </TabsTrigger>
                <TabsTrigger 
                  value="repository" 
                  className="data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-sm rounded-md px-4 h-7 text-xs font-semibold transition-all"
                >
                  <GitBranch className="h-3.5 w-3.5 mr-2" />
                  Repo
                </TabsTrigger>
              </TabsList>

              {activeView === 'split' && (
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setActiveView('terminal')}
                    className="h-8 w-8 rounded-lg text-slate-400 hover:text-primary hover:bg-white"
                    title="Full Screen Terminal"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
              )}
            </div>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="terminal" className="h-full m-0 data-[state=inactive]:hidden">
                <CommandTerminal deploymentId={deploymentId} isFullViewport={activeView === 'terminal'} />
              </TabsContent>

              <TabsContent value="details" className="h-full overflow-y-auto p-6 m-0 space-y-6 data-[state=inactive]:hidden">
                <Card className="border-slate-200 shadow-sm bg-white">
                  <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-900">Deployment Context</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Description</span>
                      <p className="mt-2 text-sm text-slate-700 leading-relaxed">{deployment?.description || 'No description provided.'}</p>
                    </div>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</span>
                            <div className="mt-2 flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${deployment?.status === 'DEPLOYED' ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`}></div>
                                <span className="text-sm font-semibold capitalize">{deployment?.status?.toLowerCase().replace(/_/g, ' ')}</span>
                            </div>
                        </div>
                        <div className="bg-slate-100/50 p-4 rounded-xl border border-slate-200">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Environment</span>
                            <p className="mt-2 text-sm font-semibold capitalize">{deployment?.environment}</p>
                        </div>
                    </div>

                    {infrastructureDiscovery && (
                      <div className="pt-6 border-t border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-primary rounded-full"></div>
                            Infrastructure Discovery
                        </h3>
                        <InfrastructureDiscovery discovery={infrastructureDiscovery} />
                      </div>
                    )}
                    {codeAnalysis && (
                      <div className="pt-6 border-t border-slate-200">
                        <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <div className="w-1.5 h-4 bg-primary rounded-full"></div>
                            Code Analysis
                        </h3>
                        <CodeAnalysisResults analysis={codeAnalysis} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="repository" className="h-full overflow-y-auto p-6 m-0 data-[state=inactive]:hidden">
                <Card className="border-slate-200 shadow-sm bg-white">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg font-bold">
                      <Github className="h-5 w-5 text-slate-900" />
                      Repository Sync
                    </CardTitle>
                    <CardDescription className="text-slate-600">
                      Connect your source code to enable automated analysis
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <RepositorySelector
                      value={repositoryUrl}
                      onChange={handleRepositorySelect}
                      onAnalyze={handleAnalyzeRepository}
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
    </TerminalProvider>
  );
};

export default Chat;
