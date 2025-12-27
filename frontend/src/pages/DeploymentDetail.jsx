import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  DollarSign,
  Server,
  ArrowLeft,
  Check,
  X,
  RotateCcw,
  Github,
  GitBranch,
  GitCommit,
  Workflow,
  Play
} from 'lucide-react';
import { format } from 'date-fns';
import CodeViewer from '../components/Deployment/CodeViewer';
import WorkflowVisualization from '../components/Deployment/WorkflowVisualization';
import LogViewer from '../components/Deployment/LogViewer';
import DeploymentEnvEditor from '../components/DeploymentEnvEditor';
import DeploymentChat from '../components/Deployment/DeploymentChat';
import SandboxInterface from '../components/Deployment/SandboxInterface';
import CommandTerminal from '../components/CommandTerminal/CommandTerminal';
import { useToast } from '../hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';

const DeploymentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [deployment, setDeployment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [approvalComment, setApprovalComment] = useState('');
  const { toast } = useToast();
  const hasAutoResumedRef = useRef(false); // Track if we've already auto-resumed
  const isResumingRef = useRef(false); // Track if resume is in progress

  useEffect(() => {
    hasAutoResumedRef.current = false; // Reset when deployment ID changes
    fetchDeployment();
  }, [id]);

  const fetchDeployment = async () => {
    try {
      const response = await api.get(`/deployments/${id}`);
      const deploymentData = response.data.data.deployment;
      setDeployment(deploymentData);
      
      // DISABLED: Auto-resume causes infinite loops
      // Users can manually click Resume button if needed
      // Auto-resume only once when component mounts and deployment is in resumable state
      // if (!hasAutoResumedRef.current && !isResumingRef.current) {
      //   const terminalStates = ['DEPLOYED', 'CANCELLED', 'DESTROYED', 'ROLLED_BACK', 'ROLLBACK_FAILED'];
      //   const resumableStates = ['GATHERING', 'REPOSITORY_ANALYSIS', 'CODE_ANALYSIS', 'INFRASTRUCTURE_DISCOVERY', 
      //                             'DEPENDENCY_ANALYSIS', 'PLANNING', 'VALIDATING', 'ESTIMATED', 'SANDBOX_DEPLOYING',
      //                             'TESTING', 'APPROVED', 'GITHUB_COMMIT', 'GITHUB_ACTIONS', 'DEPLOYING'];
      //   
      //   const lastUpdate = deploymentData.updatedAt ? new Date(deploymentData.updatedAt) : new Date();
      //   const timeSinceUpdate = Date.now() - lastUpdate.getTime();
      //   const shouldAutoResume = resumableStates.includes(deploymentData.status) && 
      //                            !terminalStates.includes(deploymentData.status) &&
      //                            timeSinceUpdate > 30000; // Only auto-resume if last update was more than 30 seconds ago
      //   
      //   if (shouldAutoResume) {
      //     hasAutoResumedRef.current = true; // Mark as auto-resumed
      //     // Auto-resume deployment processing (don't refresh immediately to avoid loop)
      //     handleResume(true).then(() => {
      //       // Refresh after resume completes
      //       setTimeout(() => {
      //         fetchDeployment();
      //       }, 5000);
      //     });
      //   }
      // }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch deployment details",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async (silent = false) => {
    if (isResumingRef.current) {
      return; // Prevent multiple simultaneous resume calls
    }
    
    isResumingRef.current = true;
    try {
      await api.post(`/deployments/${id}/resume`);
      if (!silent) {
        toast({
          title: "Resumed",
          description: "Deployment processing has been resumed",
        });
      }
      // Refresh after a delay to see updated status (only if manually triggered)
      if (!silent) {
        setTimeout(() => {
          fetchDeployment();
        }, 3000);
      }
    } catch (error) {
      if (!silent) {
        toast({
          title: "Error",
          description: error.response?.data?.error?.message || 'Failed to resume deployment',
          variant: "destructive",
        });
      }
    } finally {
      // Reset flag after a delay to prevent rapid clicking
      setTimeout(() => {
        isResumingRef.current = false;
      }, 2000);
    }
  };

  const handleApprove = async () => {
    try {
      await api.post(`/deployments/${id}/approve`, { comment: approvalComment });
      toast({
        title: "Approved",
        description: "Deployment has been approved",
      });
      setApproveDialogOpen(false);
      setApprovalComment('');
      fetchDeployment();
    } catch (error) {
      toast({
        title: "Error",
        description: error.response?.data?.error?.message || 'Failed to approve deployment',
        variant: "destructive",
      });
    }
  };

  const handleReject = async () => {
    try {
      await api.post(`/deployments/${id}/reject`, { reason: approvalComment });
      toast({
        title: "Rejected",
        description: "Deployment has been rejected",
      });
      setRejectDialogOpen(false);
      setApprovalComment('');
      fetchDeployment();
    } catch (error) {
      toast({
        title: "Error",
        description: error.response?.data?.error?.message || 'Failed to reject deployment',
        variant: "destructive",
      });
    }
  };

  const handleRollback = async () => {
    if (!window.confirm('Are you sure you want to rollback this deployment?')) {
      return;
    }
    
    try {
      await api.post(`/deployments/${id}/rollback`, { reason: 'Manual rollback' });
      toast({
        title: "Rollback initiated",
        description: "Deployment rollback has been started",
      });
      fetchDeployment();
    } catch (error) {
      toast({
        title: "Error",
        description: error.response?.data?.error?.message || 'Failed to rollback deployment',
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

  const canResume = () => {
    if (!deployment) return false;
    const terminalStates = ['DEPLOYED', 'CANCELLED', 'DESTROYED', 'ROLLED_BACK', 'ROLLBACK_FAILED'];
    const resumableStates = ['GATHERING', 'REPOSITORY_ANALYSIS', 'CODE_ANALYSIS', 'INFRASTRUCTURE_DISCOVERY', 
                              'DEPENDENCY_ANALYSIS', 'PLANNING', 'VALIDATING', 'ESTIMATED', 'SANDBOX_DEPLOYING',
                              'TESTING', 'APPROVED', 'GITHUB_COMMIT', 'GITHUB_ACTIONS', 'DEPLOYING',
                              'VALIDATION_FAILED', 'SANDBOX_FAILED'];
    return resumableStates.includes(deployment.status) && !terminalStates.includes(deployment.status);
  };

  const getLastError = () => {
    if (!deployment?.statusHistory) return null;
    // Find the most recent status history entry with a reason (error)
    const errorEntries = deployment.statusHistory
      .filter(sh => sh.reason)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return errorEntries.length > 0 ? errorEntries[0] : null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!deployment) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Deployment not found</p>
        <Button onClick={() => navigate('/deployments')} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Deployments
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/deployments')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{deployment.name}</h1>
            <p className="text-muted-foreground mt-2">{deployment.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {canResume() && (
            <Button onClick={() => handleResume(false)} variant="default">
              <Play className="h-4 w-4 mr-2" />
              Resume
            </Button>
          )}
        <Badge variant={getStatusVariant(deployment.status)} className="text-sm px-3 py-1">
          {deployment.status.replace(/_/g, ' ')}
        </Badge>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="code">Terraform Code</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          <TabsTrigger value="env">Environment Variables</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Show error message if there was a failure */}
          {getLastError() && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive flex items-center gap-2">
                  <XCircle className="h-5 w-5" />
                  Last Error
                </CardTitle>
                <CardDescription>
                  {getLastError().status} failed at {format(new Date(getLastError().timestamp), 'PPpp')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{getLastError().reason}</p>
                {canResume() && (
                  <Button onClick={() => handleResume(false)} variant="outline">
                    <Play className="h-4 w-4 mr-2" />
                    Retry Failed Step
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Environment</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold capitalize">{deployment.environment}</div>
                <p className="text-xs text-muted-foreground mt-1">Region: {deployment.region}</p>
              </CardContent>
            </Card>

            {deployment.estimatedMonthlyCost && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Estimated Cost</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold flex items-center gap-1">
                    <DollarSign className="h-5 w-5" />
                    {deployment.estimatedMonthlyCost}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">per month</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Resources</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{deployment.resourceCount || 0}</div>
                <p className="text-xs text-muted-foreground mt-1">Total resources</p>
              </CardContent>
            </Card>
          </div>

          {deployment.approvalStatus === 'pending' && (
            <Card>
              <CardHeader>
                <CardTitle>Approval Required</CardTitle>
                <CardDescription>
                  {deployment.approvals?.filter(a => a.decision === 'approved').length || 0} of {deployment.requiredApprovals} approvals received
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button onClick={() => setApproveDialogOpen(true)}>
                  <Check className="h-4 w-4 mr-2" />
                  Approve
                </Button>
                <Button variant="destructive" onClick={() => setRejectDialogOpen(true)}>
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </Button>
              </CardContent>
            </Card>
          )}

          {/* GitHub Integration Status */}
          {deployment.repositoryUrl && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Github className="h-5 w-5" />
                  GitHub Integration
                </CardTitle>
                <CardDescription>
                  Repository and deployment status
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Repository</span>
                  </div>
                  <a
                    href={deployment.repositoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    {deployment.repositoryUrl.replace('https://github.com/', '')}
                  </a>
                </div>
                
                {deployment.githubCommitSha && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitCommit className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Commit</span>
                    </div>
                    <a
                      href={`${deployment.repositoryUrl}/commit/${deployment.githubCommitSha}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline font-mono"
                    >
                      {deployment.githubCommitSha.substring(0, 7)}
                    </a>
                  </div>
                )}
                
                {deployment.githubPullRequestUrl && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">Pull Request</span>
                    </div>
                    <a
                      href={deployment.githubPullRequestUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View PR
                    </a>
                  </div>
                )}
                
                {deployment.githubActionsRunId && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">GitHub Actions</span>
                    </div>
                    <a
                      href={`${deployment.repositoryUrl}/actions/runs/${deployment.githubActionsRunId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      View Run
                    </a>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {deployment.status === 'DEPLOYED' && deployment.canRollback && (
            <Card>
              <CardHeader>
                <CardTitle>Rollback</CardTitle>
                <CardDescription>
                  Rollback to a previous version of this deployment
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" onClick={handleRollback}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Rollback Deployment
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="chat" className="h-[calc(100vh-200px)]">
          <DeploymentChat deploymentId={deployment.deploymentId} />
        </TabsContent>

        <TabsContent value="workflow">
          <Card>
            <CardHeader>
              <CardTitle>Deployment Workflow</CardTitle>
              <CardDescription>
                Visual representation of the deployment state machine
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkflowVisualization
                statusHistory={deployment.statusHistory || []}
                currentStatus={deployment.status}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="code">
          <CodeViewer terraformCode={deployment.terraformCode} />
        </TabsContent>

        <TabsContent value="env">
          <DeploymentEnvEditor deploymentId={deployment.deploymentId} />
        </TabsContent>

        <TabsContent value="resources">
          <Card>
            <CardHeader>
              <CardTitle>Resources</CardTitle>
              <CardDescription>
                AWS resources created by this deployment
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deployment.resources && deployment.resources.length > 0 ? (
                <div className="space-y-2">
                  {deployment.resources.map((resource, index) => (
                    <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Server className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{resource.name}</div>
                          <div className="text-sm text-muted-foreground">{resource.type}</div>
                        </div>
                      </div>
                      <Badge variant="secondary">{resource.status}</Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No resources created yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sandbox">
          <SandboxInterface deploymentId={deployment.deploymentId} deployment={deployment} />
        </TabsContent>

        <TabsContent value="terminal">
          <CommandTerminal deploymentId={deployment.deploymentId} />
        </TabsContent>

        <TabsContent value="logs">
          <LogViewer logs={[]} />
        </TabsContent>
      </Tabs>

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Deployment</DialogTitle>
            <DialogDescription>
              Add a comment (optional) and approve this deployment
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Add a comment..."
            value={approvalComment}
            onChange={(e) => setApprovalComment(e.target.value)}
            className="mt-4"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleApprove}>
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Deployment</DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this deployment
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for rejection..."
            value={approvalComment}
            onChange={(e) => setApprovalComment(e.target.value)}
            className="mt-4"
            required
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReject}>
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DeploymentDetail;

