import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Square,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Loader2,
  RefreshCw,
  Terminal,
  FileCode,
  Lock,
  Unlock,
  ArrowRight
} from 'lucide-react';
import api from '../../services/api';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from '../../lib/utils';

const DeploymentPlan = ({ deploymentId, onExecutionComplete }) => {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [executing, setExecuting] = useState(false);
  const [executionStatus, setExecutionStatus] = useState(null);
  const [expandedSteps, setExpandedSteps] = useState({});
  const [stepLogs, setStepLogs] = useState({});

  useEffect(() => {
    if (deploymentId) {
      fetchPlan();
    }
  }, [deploymentId]);

  // Poll for execution status while executing
  useEffect(() => {
    let interval;
    if (executing) {
      interval = setInterval(async () => {
        try {
          const response = await api.get(`/deployment-plan/${deploymentId}/status`);
          if (response.data.success) {
            setExecutionStatus(response.data.data);
            if (response.data.data.status === 'completed' || 
                response.data.data.status === 'failed' ||
                response.data.data.status === 'cancelled') {
              setExecuting(false);
              if (onExecutionComplete) {
                onExecutionComplete(response.data.data);
              }
            }
          }
        } catch (err) {
          console.error('Failed to fetch execution status:', err);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [executing, deploymentId, onExecutionComplete]);

  const fetchPlan = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/deployment-plan/${deploymentId}`);
      if (response.data.success) {
        setPlan(response.data.data);
        // Expand first pending step by default
        const firstPending = response.data.data.steps?.find(s => s.status === 'pending');
        if (firstPending) {
          setExpandedSteps({ [firstPending.id]: true });
        }
      } else {
        setError(response.data.error || 'Failed to fetch deployment plan');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch deployment plan');
    } finally {
      setLoading(false);
    }
  };

  const executePlan = async (autoApprove = false) => {
    setExecuting(true);
    setError(null);
    try {
      const response = await api.post(`/deployment-plan/${deploymentId}/execute`, {
        autoApprove,
        rollbackOnFailure: true
      });
      if (response.data.success) {
        setExecutionStatus(response.data.data);
      } else {
        setError(response.data.error);
        setExecuting(false);
      }
    } catch (err) {
      setError(err.message);
      setExecuting(false);
    }
  };

  const executeStep = async (stepId) => {
    try {
      const response = await api.post(`/deployment-plan/${deploymentId}/execute-step`, {
        stepId
      });
      if (response.data.success) {
        setStepLogs(prev => ({
          ...prev,
          [stepId]: response.data.data.result
        }));
        // Refresh plan to get updated status
        await fetchPlan();
      } else {
        setError(response.data.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelExecution = async () => {
    try {
      await api.post(`/deployment-plan/${deploymentId}/cancel`);
      setExecuting(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const rollback = async (fromStepId) => {
    try {
      const response = await api.post(`/deployment-plan/${deploymentId}/rollback`, {
        fromStepId
      });
      if (response.data.success) {
        await fetchPlan();
      } else {
        setError(response.data.error);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleStep = (stepId) => {
    setExpandedSteps(prev => ({
      ...prev,
      [stepId]: !prev[stepId]
    }));
  };

  const getStatusIcon = (status) => {
    const iconClasses = "h-4 w-4";
    switch (status) {
      case 'completed':
        return <CheckCircle className={cn(iconClasses, "text-emerald-600")} />;
      case 'failed':
        return <XCircle className={cn(iconClasses, "text-destructive")} />;
      case 'running':
        return <Loader2 className={cn(iconClasses, "text-blue-600 animate-spin")} />;
      case 'skipped':
        return <ArrowRight className={cn(iconClasses, "text-yellow-600")} />;
      case 'pending':
      default:
        return <Clock className={cn(iconClasses, "text-muted-foreground")} />;
    }
  };

  const getStepTypeIcon = (type) => {
    switch (type) {
      case 'command':
        return <Terminal size={16} />;
      case 'script':
        return <FileCode size={16} />;
      case 'approval':
        return <Lock size={16} />;
      default:
        return <Play size={16} />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4" />
          <p>Generating deployment plan...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50 bg-destructive/10">
        <CardContent className="flex flex-col items-center p-8 text-destructive">
          <AlertTriangle className="h-8 w-8 mb-4" />
          <p className="mb-4">{error}</p>
          <Button onClick={fetchPlan} variant="outline" size="sm" className="border-destructive/50 text-destructive hover:bg-destructive/20">
            <RefreshCw size={16} className="mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <p>No deployment plan available</p>
        </CardContent>
      </Card>
    );
  }

  const completedSteps = plan.steps?.filter(s => s.status === 'completed').length || 0;
  const totalSteps = plan.steps?.length || 0;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="p-6 bg-card rounded-xl text-foreground">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
        <div className="flex items-baseline gap-4">
          <h2 className="text-2xl font-semibold text-foreground m-0">Deployment Plan</h2>
          <Badge variant="outline" className="font-mono text-xs bg-muted">{plan.planId}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchPlan} variant="outline" size="icon" title="Refresh">
            <RefreshCw size={18} />
          </Button>
          {!executing ? (
            <>
              <Button 
                onClick={() => executePlan(false)} 
                className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700"
                disabled={completedSteps === totalSteps}
              >
                <Play size={16} />
                Execute Plan
              </Button>
              <Button 
                onClick={() => executePlan(true)} 
                variant="outline"
                className="flex items-center gap-2"
                disabled={completedSteps === totalSteps}
              >
                <Unlock size={16} />
                Auto-Approve
              </Button>
            </>
          ) : (
            <Button onClick={cancelExecution} variant="destructive" className="flex items-center gap-2">
              <Square size={16} />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <Progress value={progress} className="h-2 mb-2" />
        <span className="text-sm text-muted-foreground">
          {completedSteps} of {totalSteps} steps completed
        </span>
      </div>

      {/* Plan Metadata */}
      <Card className="mb-6">
        <CardContent className="flex flex-wrap gap-6 p-4">
          <div>
            <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</span>
            <span className="text-sm text-foreground">{new Date(plan.createdAt).toLocaleString()}</span>
          </div>
          <div>
            <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Estimated Time</span>
            <span className="text-sm text-foreground">{plan.estimatedDuration || 'Unknown'}</span>
          </div>
          {plan.strategy && (
            <div>
              <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Strategy</span>
              <span className="text-sm text-foreground">{plan.strategy}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Prerequisites */}
      {plan.prerequisites?.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Prerequisites</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-none p-0 m-0 space-y-2">
              {plan.prerequisites.map((prereq, i) => (
                <li key={i} className={cn("flex items-center gap-2 p-2 text-sm", prereq.met ? "text-emerald-600" : "text-yellow-600")}>
                  {prereq.met ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {prereq.name}: {prereq.description}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Steps List */}
      <div>
        <h3 className="text-base font-semibold mb-4">Execution Steps</h3>
        <div className="space-y-3">
          {plan.steps?.map((step, index) => (
            <Card 
              key={step.id} 
              className={cn(
                "overflow-hidden transition-colors",
                step.status === 'completed' && "border-l-4 border-l-emerald-600",
                step.status === 'failed' && "border-l-4 border-l-destructive",
                step.status === 'running' && "border-l-4 border-l-blue-600",
                step.status === 'pending' && "border-l-4 border-l-muted-foreground",
                step.status === 'skipped' && "border-l-4 border-l-yellow-600 opacity-70"
              )}
            >
              <CardHeader 
                className="flex justify-between items-center p-4 cursor-pointer hover:bg-accent transition-colors"
                onClick={() => toggleStep(step.id)}
              >
                <div className="flex items-center gap-3">
                  {expandedSteps[step.id] ? <ChevronDown size={18} className="text-muted-foreground" /> : <ChevronRight size={18} className="text-muted-foreground" />}
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-semibold text-muted-foreground">{index + 1}</span>
                  {getStatusIcon(step.status)}
                  <span className="font-medium text-foreground">{step.name}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground uppercase">
                    {getStepTypeIcon(step.type)}
                    {step.type}
                  </span>
                  {step.duration && (
                    <span className="font-mono text-xs text-muted-foreground">{step.duration}ms</span>
                  )}
                  {step.status === 'pending' && !executing && (
                    <Button 
                      onClick={(e) => { e.stopPropagation(); executeStep(step.id); }}
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 bg-indigo-50 border-indigo-200 text-indigo-600 hover:bg-indigo-100"
                    >
                      <Play size={14} />
                    </Button>
                  )}
                  {step.status === 'failed' && (
                    <Button 
                      onClick={(e) => { e.stopPropagation(); rollback(step.id); }}
                      variant="outline"
                      size="icon"
                      className="h-7 w-7 bg-orange-50 border-orange-200 text-orange-600 hover:bg-orange-100"
                      title="Rollback from here"
                    >
                      <RotateCcw size={14} />
                    </Button>
                  )}
                </div>
              </CardHeader>

              {expandedSteps[step.id] && (
                <CardContent className="px-4 pb-4 border-t">
                  <p className="text-sm text-muted-foreground my-4">{step.description}</p>
                  
                  {step.command && (
                    <div className="my-3">
                      <span className="text-xs text-muted-foreground mr-2">Command:</span>
                      <code className="block mt-1 px-3 py-2 bg-background rounded text-xs font-mono text-emerald-600 break-all">{step.command}</code>
                    </div>
                  )}

                  {step.dependencies?.length > 0 && (
                    <div className="my-3">
                      <span className="text-xs text-muted-foreground mr-2">Dependencies:</span>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {step.dependencies.map((dep, i) => (
                          <Badge key={i} variant="outline" className="text-xs">{dep}</Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {step.rollbackCommand && (
                    <div className="my-3">
                      <span className="text-xs text-muted-foreground mr-2">Rollback:</span>
                      <code className="block mt-1 px-3 py-2 bg-background rounded text-xs font-mono text-orange-600 break-all">{step.rollbackCommand}</code>
                    </div>
                  )}

                  {step.requiresApproval && (
                    <div className="flex items-center gap-2 my-3 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700">
                      <Lock size={14} />
                      <span>This step requires manual approval before execution</span>
                    </div>
                  )}

                  {stepLogs[step.id] && (
                    <div className="my-3">
                      <span className="text-xs text-muted-foreground mr-2">Output:</span>
                      <pre className="mt-1 px-3 py-2 bg-slate-900 rounded text-xs font-mono text-slate-100 overflow-x-auto max-h-[200px] whitespace-pre-wrap break-all">{stepLogs[step.id].output || stepLogs[step.id].error || 'No output'}</pre>
                    </div>
                  )}

                  {step.error && (
                    <div className="flex items-start gap-2 my-3 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{step.error}</span>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Execution Status */}
      {executionStatus && (
        <Card className={cn(
          "mt-6",
          executionStatus.status === 'running' && "bg-blue-50 border-blue-200",
          executionStatus.status === 'completed' && "bg-emerald-50 border-emerald-200",
          executionStatus.status === 'failed' && "bg-destructive/10 border-destructive/20"
        )}>
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold text-foreground mb-2">Execution Status</h4>
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="uppercase bg-white/50">{executionStatus.status}</Badge>
              {executionStatus.currentStep && (
                <span className="text-sm text-muted-foreground">
                  Current: {executionStatus.currentStep}
                </span>
              )}
            </div>
            {executionStatus.error && (
              <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-destructive/10 rounded text-sm text-destructive">
                <AlertTriangle size={14} />
                {executionStatus.error}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DeploymentPlan;

