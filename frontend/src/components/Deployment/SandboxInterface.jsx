import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import MessageList from '../Chat/MessageList';
import MessageInput from '../Chat/MessageInput';
import DeploymentProgress from './DeploymentProgress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Play,
  RefreshCw,
  Trash2,
  Calendar,
  TestTube,
  Server,
  Shield,
  Zap,
  AlertCircle,
  Loader2,
  Cloud,
  Database,
  Network,
  FileCode,
  CheckCircle,
  Circle,
  MessageSquare,
  Bot
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useToast } from '../../hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const SandboxInterface = ({ deploymentId, deployment }) => {
  const [sandbox, setSandbox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [testing, setTesting] = useState(false);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [deploymentJobId, setDeploymentJobId] = useState(null);
  const [destroyDialogOpen, setDestroyDialogOpen] = useState(false);
  const [additionalHours, setAdditionalHours] = useState(4);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [awsResources, setAwsResources] = useState([]);
  const [terraformState, setTerraformState] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const messagesEndRef = useRef(null);
  const { toast } = useToast();

  useEffect(() => {
    if (deploymentId) {
      fetchSandboxStatus();
      fetchDeploymentStatus();
      fetchChatHistory();
      // Poll for updates every 5 seconds
      const interval = setInterval(() => {
        fetchSandboxStatus();
        fetchDeploymentStatus();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [deploymentId]);

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchChatHistory = async () => {
    try {
      const response = await api.get(`/chat/history/${deploymentId}`);
      setChatMessages(response.data.data.messages || []);
    } catch (error) {
      console.error('Error fetching chat history:', error);
    }
  };

  const fetchDeploymentStatus = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}`);
      const deployment = response.data.data;
      setDeploymentStatus(deployment);
      
      // Extract AWS resources from deployment
      if (deployment.resources && deployment.resources.length > 0) {
        setAwsResources(deployment.resources);
      }
      
      // Get Terraform state info
      if (deployment.terraformStateKey) {
        setTerraformState({
          stateKey: deployment.terraformStateKey,
          hasPlan: !!deployment.terraformPlan
        });
      }
    } catch (error) {
      console.error('Failed to fetch deployment status:', error);
    }
  };

  const fetchSandboxStatus = async () => {
    try {
      setLoading(true);
      // Check if deployment has sandboxId
      if (deployment?.sandboxId) {
        const response = await api.get(`/sandbox/${deployment.sandboxId}`);
        setSandbox(response.data.data.sandbox);
      } else {
        setSandbox(null);
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        toast({
          title: 'Error',
          description: 'Failed to fetch sandbox status',
          variant: 'destructive',
        });
      }
      setSandbox(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDeployToSandbox = async () => {
    try {
      setDeploying(true);
      setShowProgress(true);
      
      // Use unified deployment API
      const response = await api.post(`/deployments/${deploymentId}/deploy`, {
        source: 'ui',
        autoApprove: true,
        durationHours: 4,
        async: true
      });

      if (response.data.data.jobId) {
        setDeploymentJobId(response.data.data.jobId);
      }

      toast({
        title: 'Sandbox Deployment Started',
        description: 'Deploying infrastructure to sandbox and running tests. Monitor progress below.',
      });

      // Fetch sandbox status periodically
      const pollInterval = setInterval(async () => {
        try {
          await fetchSandboxStatus();
        } catch (error) {
          console.error('Error polling sandbox status:', error);
        }
      }, 5000);

      // Stop polling after 15 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
      }, 900000);
    } catch (error) {
      setDeploying(false);
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to deploy to sandbox',
        variant: 'destructive',
      });
    }
  };

  const handleRunTests = async () => {
    if (!sandbox?.sandboxId) return;

    try {
      setTesting(true);
      await api.post(`/sandbox/${sandbox.sandboxId}/test`);
      
      toast({
        title: 'Tests Started',
        description: 'Running automated tests on sandbox environment...',
      });

      // Poll for test results
      const pollInterval = setInterval(async () => {
        try {
          await fetchSandboxStatus();
          if (sandbox?.testStatus === 'passed' || sandbox?.testStatus === 'failed') {
            clearInterval(pollInterval);
            setTesting(false);
            
            toast({
              title: sandbox.testStatus === 'passed' ? 'Tests Passed' : 'Tests Failed',
              description: `Test status: ${sandbox.testStatus}`,
              variant: sandbox.testStatus === 'passed' ? 'default' : 'destructive',
            });
          }
        } catch (error) {
          console.error('Error polling test status:', error);
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setTesting(false);
      }, 60000);
    } catch (error) {
      setTesting(false);
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to run tests',
        variant: 'destructive',
      });
    }
  };

  const handleExtendSandbox = async () => {
    if (!sandbox?.sandboxId) return;

    try {
      await api.post(`/sandbox/${sandbox.sandboxId}/extend`, {
        additionalHours: parseInt(additionalHours)
      });

      toast({
        title: 'Sandbox Extended',
        description: `Sandbox lifetime extended by ${additionalHours} hours`,
      });

      setExtendDialogOpen(false);
      await fetchSandboxStatus();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to extend sandbox',
        variant: 'destructive',
      });
    }
  };

  const handleChatMessage = async (message) => {
    const userMessage = {
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatLoading(true);

    try {
      // Check if message contains sandbox-related commands
      const lowerMessage = message.toLowerCase();
      const isSandboxCommand = 
        lowerMessage.includes('deploy to sandbox') ||
        lowerMessage.includes('move to sandbox') ||
        lowerMessage.includes('test in sandbox') ||
        lowerMessage.includes('run tests') ||
        lowerMessage.includes('extend sandbox') ||
        lowerMessage.includes('destroy sandbox') ||
        lowerMessage.includes('sandbox status');

      // Handle sandbox-specific commands directly
      if (isSandboxCommand) {
        if (lowerMessage.includes('deploy to sandbox') || lowerMessage.includes('move to sandbox')) {
          await handleDeployToSandbox();
          const assistantMessage = {
            role: 'assistant',
            content: 'I\'m deploying your infrastructure to the sandbox environment and running tests. This may take a few minutes...',
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatLoading(false);
          return;
        }

        if (lowerMessage.includes('run tests') && sandbox?.sandboxId) {
          await handleRunTests();
          const assistantMessage = {
            role: 'assistant',
            content: 'Running automated tests on the sandbox environment...',
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatLoading(false);
          return;
        }

        if (lowerMessage.includes('extend sandbox') && sandbox?.sandboxId) {
          setExtendDialogOpen(true);
          const assistantMessage = {
            role: 'assistant',
            content: 'Opening the extend sandbox dialog. Please specify how many additional hours you want.',
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatLoading(false);
          return;
        }

        if (lowerMessage.includes('destroy sandbox') && sandbox?.sandboxId) {
          setDestroyDialogOpen(true);
          const assistantMessage = {
            role: 'assistant',
            content: 'Opening the destroy sandbox confirmation dialog.',
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatLoading(false);
          return;
        }

        if (lowerMessage.includes('sandbox status')) {
          await fetchSandboxStatus();
          await fetchDeploymentStatus();
          const statusMessage = sandbox 
            ? `Sandbox Status:\n- Sandbox ID: ${sandbox.sandboxId}\n- Test Status: ${sandbox.testStatus}\n- Expires: ${sandbox.expiresAt ? formatDistanceToNow(new Date(sandbox.expiresAt), { addSuffix: true }) : 'N/A'}\n- Resources: ${awsResources.length} deployed`
            : 'No sandbox environment exists yet. Use "deploy to sandbox" to create one.';
          const assistantMessage = {
            role: 'assistant',
            content: statusMessage,
            timestamp: new Date()
          };
          setChatMessages(prev => [...prev, assistantMessage]);
          setChatLoading(false);
          return;
        }
      }

      // Send to Claude API for general chat
      const response = await api.post('/chat/message', {
        deploymentId,
        message,
        stream: false
      });

      const assistantMessage = {
        role: 'assistant',
        content: response.data.data.message,
        commandResult: response.data.data.commandResult || null,
        timestamp: new Date()
      };

      setChatMessages(prev => [...prev, assistantMessage]);
      
      // Refresh sandbox status after chat (in case AI triggered actions)
      setTimeout(() => {
        fetchSandboxStatus();
        fetchDeploymentStatus();
      }, 2000);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = {
        role: 'assistant',
        content: error.response?.data?.error?.message || 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
        error: true
      };
      setChatMessages(prev => [...prev, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleDestroySandbox = async () => {
    if (!sandbox?.sandboxId) return;

    try {
      await api.delete(`/sandbox/${sandbox.sandboxId}`);
      
      toast({
        title: 'Sandbox Destroyed',
        description: 'Sandbox environment has been destroyed',
      });

      setDestroyDialogOpen(false);
      setSandbox(null);
      
      // Refresh deployment to update status
      window.location.reload();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to destroy sandbox',
        variant: 'destructive',
      });
    }
  };

  const getTestStatusBadge = (status) => {
    const variants = {
      'passed': 'default',
      'failed': 'destructive',
      'running': 'secondary',
      'pending': 'secondary'
    };

    return (
      <Badge variant={variants[status] || 'secondary'}>
        {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'}
      </Badge>
    );
  };

  const hasTerraformCode = deployment?.terraformCode?.main;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs for Overview and Chat */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview">Sandbox Overview</TabsTrigger>
          <TabsTrigger value="chat" className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            AI Assistant
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Header Actions */}
          <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Sandbox Environment</h2>
          <p className="text-muted-foreground mt-1">
            Test your infrastructure in an isolated sandbox environment
          </p>
        </div>
        <div className="flex gap-2">
          {!sandbox && hasTerraformCode && (
            <Button 
              onClick={handleDeployToSandbox} 
              disabled={deploying}
              className="gap-2"
            >
              {deploying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Deploy to Sandbox
                </>
              )}
            </Button>
          )}
          {sandbox && (
            <>
              <Button 
                onClick={handleRunTests} 
                disabled={testing}
                variant="outline"
                className="gap-2"
              >
                {testing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <TestTube className="h-4 w-4" />
                    Run Tests
                  </>
                )}
              </Button>
              <Button 
                onClick={() => setExtendDialogOpen(true)} 
                variant="outline"
                className="gap-2"
              >
                <Calendar className="h-4 w-4" />
                Extend
              </Button>
              <Button 
                onClick={() => setDestroyDialogOpen(true)} 
                variant="destructive"
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Destroy
              </Button>
            </>
          )}
        </div>
      </div>

          {/* Deployment Progress */}
          {showProgress && (
            <DeploymentProgress
              deploymentId={deploymentId}
              onComplete={(result) => {
                setShowProgress(false);
                setDeploying(false);
                fetchSandboxStatus();
                toast({
                  title: 'Deployment Completed',
                  description: 'Infrastructure deployed successfully!',
                });
              }}
              onError={(error) => {
                setShowProgress(false);
                setDeploying(false);
                toast({
                  title: 'Deployment Failed',
                  description: error.error || 'Deployment failed. Check logs for details.',
                  variant: 'destructive',
                });
              }}
            />
          )}

      {!hasTerraformCode && (
        <Card className="border-yellow-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-600">
              <AlertCircle className="h-5 w-5" />
              Terraform Code Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You need to generate Terraform code before deploying to sandbox. 
              Use the Chat tab to generate infrastructure code.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Deployment Workflow Status */}
      {deploymentStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              Deployment Workflow
            </CardTitle>
            <CardDescription>
              Current status: {deploymentStatus.status?.replace(/_/g, ' ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Workflow Steps */}
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border"></div>
                <div className="space-y-6">
                  {/* Step 1: Terraform Code Generated */}
                  <div className="relative flex items-start gap-4">
                    <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                      deploymentStatus.terraformCode?.main 
                        ? 'border-green-500 bg-green-50 dark:bg-green-950' 
                        : 'border-gray-300 bg-gray-50 dark:bg-gray-800'
                    }`}>
                      {deploymentStatus.terraformCode?.main ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 pt-1">
                      <p className={`font-medium ${
                        deploymentStatus.terraformCode?.main ? 'text-green-700 dark:text-green-400' : 'text-gray-500'
                      }`}>
                        Terraform Code Generated
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {deploymentStatus.terraformCode?.main 
                          ? 'Infrastructure code ready for deployment'
                          : 'Generate Terraform code first'}
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Terraform Initialized */}
                  <div className="relative flex items-start gap-4">
                    <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                      terraformState?.stateKey 
                        ? 'border-green-500 bg-green-50 dark:bg-green-950' 
                        : 'border-gray-300 bg-gray-50 dark:bg-gray-800'
                    }`}>
                      {terraformState?.stateKey ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 pt-1">
                      <p className={`font-medium ${
                        terraformState?.stateKey ? 'text-green-700 dark:text-green-400' : 'text-gray-500'
                      }`}>
                        Terraform Initialized
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {terraformState?.stateKey 
                          ? `State stored at: ${terraformState.stateKey}`
                          : 'Terraform not initialized yet'}
                      </p>
                    </div>
                  </div>

                  {/* Step 3: Resources Deployed */}
                  <div className="relative flex items-start gap-4">
                    <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                      awsResources.length > 0 
                        ? 'border-green-500 bg-green-50 dark:bg-green-950' 
                        : ['SANDBOX_DEPLOYING', 'TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status)
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-gray-300 bg-gray-50 dark:bg-gray-800'
                    }`}>
                      {awsResources.length > 0 ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : ['SANDBOX_DEPLOYING', 'TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status) ? (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                      ) : (
                        <Circle className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 pt-1">
                      <p className={`font-medium ${
                        awsResources.length > 0 
                          ? 'text-green-700 dark:text-green-400' 
                          : ['SANDBOX_DEPLOYING', 'TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status)
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-gray-500'
                      }`}>
                        AWS Resources Deployed
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {awsResources.length > 0 
                          ? `${awsResources.length} resource(s) created in AWS`
                          : ['SANDBOX_DEPLOYING', 'TESTING'].includes(deploymentStatus.status)
                          ? 'Deploying resources to AWS...'
                          : 'No resources deployed yet'}
                      </p>
                    </div>
                  </div>

                  {/* Step 4: Tests Run */}
                  <div className="relative flex items-start gap-4">
                    <div className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                      deploymentStatus.sandboxTestResults?.completedAt
                        ? deploymentStatus.sandboxTestResults.passed
                          ? 'border-green-500 bg-green-50 dark:bg-green-950'
                          : 'border-red-500 bg-red-50 dark:bg-red-950'
                        : ['TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status)
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                        : 'border-gray-300 bg-gray-50 dark:bg-gray-800'
                    }`}>
                      {deploymentStatus.sandboxTestResults?.completedAt ? (
                        deploymentStatus.sandboxTestResults.passed ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500" />
                        )
                      ) : ['TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status) ? (
                        <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                      ) : (
                        <Circle className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 pt-1">
                      <p className={`font-medium ${
                        deploymentStatus.sandboxTestResults?.completedAt
                          ? deploymentStatus.sandboxTestResults.passed
                            ? 'text-green-700 dark:text-green-400'
                            : 'text-red-700 dark:text-red-400'
                          : ['TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status)
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-gray-500'
                      }`}>
                        Tests Completed
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {deploymentStatus.sandboxTestResults?.completedAt
                          ? deploymentStatus.sandboxTestResults.passed
                            ? 'All tests passed successfully'
                            : 'Some tests failed'
                          : ['TESTING', 'SANDBOX_VALIDATED'].includes(deploymentStatus.status)
                          ? 'Running automated tests...'
                          : 'Tests not run yet'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AWS Resources Created */}
      {awsResources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              AWS Resources Created
            </CardTitle>
            <CardDescription>
              {awsResources.length} resource(s) deployed to AWS
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {awsResources.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    {resource.type?.includes('ecs') && <Server className="h-4 w-4 text-blue-500" />}
                    {resource.type?.includes('ecr') && <Database className="h-4 w-4 text-green-500" />}
                    {resource.type?.includes('security') && <Shield className="h-4 w-4 text-yellow-500" />}
                    {resource.type?.includes('iam') && <Shield className="h-4 w-4 text-purple-500" />}
                    {resource.type?.includes('cloudwatch') && <FileCode className="h-4 w-4 text-orange-500" />}
                    {!resource.type?.match(/ecs|ecr|security|iam|cloudwatch/) && <Cloud className="h-4 w-4 text-gray-500" />}
                    <div>
                      <p className="font-medium">{resource.name}</p>
                      <p className="text-sm text-muted-foreground">{resource.type}</p>
                      {resource.identifier && (
                        <p className="text-xs text-muted-foreground mt-1 font-mono">{resource.identifier}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant={resource.status === 'running' || resource.status === 'active' ? 'default' : 'secondary'}>
                    {resource.status || 'created'}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="mt-4 p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Resources are live in AWS
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                You can verify these resources in the AWS Console. All resources are deployed to the sandbox environment.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {sandbox ? (
        <>
          {/* Sandbox Status */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Sandbox Status</CardTitle>
                  <CardDescription>
                    Sandbox ID: {sandbox.sandboxId}
                  </CardDescription>
                </div>
                {getTestStatusBadge(sandbox.testStatus)}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Region</p>
                  <p className="text-lg font-semibold">{sandbox.region || 'us-east-1'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Expires</p>
                  <p className="text-lg font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    {sandbox.expiresAt 
                      ? formatDistanceToNow(new Date(sandbox.expiresAt), { addSuffix: true })
                      : 'N/A'}
                  </p>
                  {sandbox.expiresAt && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(sandbox.expiresAt), 'PPpp')}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Test Results */}
          {sandbox.testResults && (
            <Card>
              <CardHeader>
                <CardTitle>Test Results</CardTitle>
                <CardDescription>
                  Automated test results from sandbox environment
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Health Checks */}
                {sandbox.testResults.healthChecks && (
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        <h3 className="font-semibold">Health Checks</h3>
                      </div>
                      {sandbox.testResults.healthChecks.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    {sandbox.testResults.healthChecks.details && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        <pre className="bg-muted p-2 rounded text-xs">
                          {JSON.stringify(sandbox.testResults.healthChecks.details, null, 2)}
                        </pre>
                      </div>
                    )}
                    {sandbox.testResults.healthChecks.duration && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Duration: {sandbox.testResults.healthChecks.duration}ms
                      </p>
                    )}
                  </div>
                )}

                {/* Security Scan */}
                {sandbox.testResults.securityScan && (
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        <h3 className="font-semibold">Security Scan</h3>
                      </div>
                      {sandbox.testResults.securityScan.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    {sandbox.testResults.securityScan.findings?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium mb-1">Findings:</p>
                        <ul className="list-disc list-inside text-sm text-muted-foreground">
                          {sandbox.testResults.securityScan.findings.map((finding, idx) => (
                            <li key={idx}>
                              {finding.severity}: {finding.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {sandbox.testResults.securityScan.duration && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Duration: {sandbox.testResults.securityScan.duration}ms
                      </p>
                    )}
                  </div>
                )}

                {/* Performance Test */}
                {sandbox.testResults.performanceTest && (
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Zap className="h-5 w-5" />
                        <h3 className="font-semibold">Performance Test</h3>
                      </div>
                      {sandbox.testResults.performanceTest.passed ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-4 mt-2">
                      {sandbox.testResults.performanceTest.avgResponseTime !== undefined && (
                        <div>
                          <p className="text-sm font-medium">Avg Response Time</p>
                          <p className="text-lg font-semibold">
                            {sandbox.testResults.performanceTest.avgResponseTime}ms
                          </p>
                        </div>
                      )}
                      {sandbox.testResults.performanceTest.p95ResponseTime !== undefined && (
                        <div>
                          <p className="text-sm font-medium">P95 Response Time</p>
                          <p className="text-lg font-semibold">
                            {sandbox.testResults.performanceTest.p95ResponseTime}ms
                          </p>
                        </div>
                      )}
                    </div>
                    {sandbox.testResults.performanceTest.duration && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Duration: {sandbox.testResults.performanceTest.duration}ms
                      </p>
                    )}
                  </div>
                )}

                {/* Deployment Test Results */}
                {deployment?.sandboxTestResults && (
                  <div className="border rounded-lg p-4 bg-muted/50">
                    <h3 className="font-semibold mb-2">Deployment Test Summary</h3>
                    <div className="space-y-2">
                      {deployment.sandboxTestResults.tests?.map((test, idx) => (
                        <div key={idx} className="flex items-center justify-between">
                          <span className="text-sm">{test.name}</span>
                          {test.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500" />
                          )}
                        </div>
                      ))}
                    </div>
                    {deployment.sandboxTestResults.completedAt && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Completed: {format(new Date(deployment.sandboxTestResults.completedAt), 'PPpp')}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Resources */}
          {sandbox.resources && sandbox.resources.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Sandbox Resources</CardTitle>
                <CardDescription>
                  Resources deployed in the sandbox environment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {sandbox.resources.map((resource, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 border rounded">
                      <div>
                        <p className="font-medium">{resource.type}</p>
                        <p className="text-sm text-muted-foreground">{resource.identifier}</p>
                      </div>
                      <Badge variant={resource.status === 'running' ? 'default' : 'secondary'}>
                        {resource.status || 'unknown'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Sandbox Environment</CardTitle>
            <CardDescription>
              Deploy your infrastructure to a sandbox environment to test before production
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasTerraformCode ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Click "Deploy to Sandbox" to create a sandbox environment, deploy your Terraform infrastructure, 
                  and run automated tests.
                </p>
                <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                  <li>Creates an isolated sandbox environment</li>
                  <li>Deploys your Terraform infrastructure</li>
                  <li>Runs automated health checks, security scans, and performance tests</li>
                  <li>Sandbox expires automatically after 4 hours (configurable)</li>
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Generate Terraform code first using the Chat tab, then you can deploy to sandbox.
              </p>
            )}
          </CardContent>
        </Card>
      )}
        </TabsContent>

        {/* Chat Tab */}
        <TabsContent value="chat" className="space-y-6 mt-6">
          <Card className="flex flex-col h-[calc(100vh-300px)]">
            <CardHeader className="flex-shrink-0 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bot className="h-5 w-5 text-primary" />
                  <CardTitle>Sandbox AI Assistant</CardTitle>
                </div>
                <Badge variant="secondary" className="flex items-center gap-2">
                  <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                  Ready
                </Badge>
              </div>
              <CardDescription>
                Ask me to deploy to sandbox, run tests, check status, or manage your sandbox environment
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden flex flex-col p-0">
              <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                    <Bot className="h-12 w-12 text-muted-foreground" />
                    <div>
                      <h3 className="font-semibold text-lg mb-2">Sandbox AI Assistant</h3>
                      <p className="text-muted-foreground mb-4">
                        I can help you manage your sandbox environment. Try asking:
                      </p>
                      <div className="space-y-2 text-sm text-left max-w-md">
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="font-medium mb-1">"Deploy to sandbox"</p>
                          <p className="text-muted-foreground text-xs">Deploy infrastructure and run tests</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="font-medium mb-1">"Run tests"</p>
                          <p className="text-muted-foreground text-xs">Run automated tests on sandbox</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="font-medium mb-1">"Check sandbox status"</p>
                          <p className="text-muted-foreground text-xs">View current sandbox status</p>
                        </div>
                        <div className="p-3 bg-muted rounded-lg">
                          <p className="font-medium mb-1">"Extend sandbox"</p>
                          <p className="text-muted-foreground text-xs">Extend sandbox lifetime</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <MessageList messages={chatMessages} loading={chatLoading} />
                <div ref={messagesEndRef} />
              </div>
              <div className="flex-shrink-0 border-t p-4">
                <MessageInput 
                  onSend={handleChatMessage} 
                  disabled={chatLoading}
                  placeholder="Ask me to deploy to sandbox, run tests, or check status..."
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Extend Dialog */}
      <Dialog open={extendDialogOpen} onOpenChange={setExtendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend Sandbox Lifetime</DialogTitle>
            <DialogDescription>
              Add additional hours to the sandbox expiration time
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="hours">Additional Hours</Label>
              <Input
                id="hours"
                type="number"
                min="1"
                max="24"
                value={additionalHours}
                onChange={(e) => setAdditionalHours(e.target.value)}
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExtendSandbox}>
              Extend Sandbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Destroy Dialog */}
      <Dialog open={destroyDialogOpen} onOpenChange={setDestroyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Destroy Sandbox</DialogTitle>
            <DialogDescription>
              This will permanently destroy the sandbox environment and all its resources. 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDestroyDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDestroySandbox}>
              Destroy Sandbox
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SandboxInterface;

