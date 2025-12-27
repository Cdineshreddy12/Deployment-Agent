import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileCode,
  Play,
  Zap,
  Shield,
  AlertCircle,
  Circle
} from 'lucide-react';
import { cn } from '../../lib/utils';

const DeploymentProgress = ({ deploymentId, onComplete, onError }) => {
  const [progress, setProgress] = useState(null);
  const [history, setHistory] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    if (!deploymentId) return;

    // Connect to WebSocket for progress updates
    const token = localStorage.getItem('token');
    const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:5002';
    const url = `${wsUrl}/ws?token=${token}&progressDeploymentId=${deploymentId}`;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'deployment_progress') {
            setProgress(data);
            setHistory(prev => [...prev, data].slice(-50)); // Keep last 50 events

            // Call callbacks
            if (data.status === 'success' && data.phase === 'completed') {
              onComplete?.(data);
            } else if (data.status === 'failed') {
              onError?.(data);
            }
          } else if (data.type === 'deployment_progress_connected') {
            setWsConnected(true);
            // Fetch current status
            fetchProgressStatus();
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      ws.onclose = () => {
        setWsConnected(false);
        // Attempt to reconnect after 3 seconds
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.CLOSED) {
            // Reconnect logic would go here
          }
        }, 3000);
      };
    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
    }

    // Fetch initial status
    fetchProgressStatus();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [deploymentId]);

  const fetchProgressStatus = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}/deploy/status`);
      if (response.data.data.currentProgress) {
        setProgress(response.data.data.currentProgress);
      }
      if (response.data.data.history) {
        setHistory(response.data.data.history);
      }
    } catch (error) {
      console.error('Failed to fetch progress status:', error);
    }
  };

  const getPhaseIcon = (phase) => {
    switch (phase) {
      case 'initialization':
      case 'writing_files':
        return <FileCode className="h-5 w-5" />;
      case 'initializing':
        return <Loader2 className="h-5 w-5 animate-spin" />;
      case 'planning':
        return <Zap className="h-5 w-5" />;
      case 'applying':
        return <Play className="h-5 w-5" />;
      case 'verifying':
        return <Shield className="h-5 w-5" />;
      case 'completed':
        return <CheckCircle2 className="h-5 w-5" />;
      default:
        return <Circle className="h-5 w-5" />;
    }
  };

  const getPhaseStatus = (phase, status) => {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'in_progress') return 'active';
    return 'pending';
  };

  const phases = [
    { id: 'initialization', label: 'Initialization', progress: 0 },
    { id: 'writing_files', label: 'Writing Files', progress: 20 },
    { id: 'initializing', label: 'Terraform Init', progress: 30 },
    { id: 'planning', label: 'Terraform Plan', progress: 50 },
    { id: 'applying', label: 'Applying', progress: 85 },
    { id: 'verifying', label: 'Verification', progress: 95 },
    { id: 'completed', label: 'Completed', progress: 100 }
  ];

  const currentPhase = progress?.phase || 'initialization';
  const currentProgress = progress?.progress || 0;
  const currentStatus = progress?.status || 'pending';

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Deployment Progress</CardTitle>
            {wsConnected ? (
              <Badge variant="success" className="flex items-center gap-1">
                <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                Live
              </Badge>
            ) : (
              <Badge variant="secondary">Disconnected</Badge>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {currentProgress}%
          </div>
        </div>
        {progress?.message && (
          <CardDescription>{progress.message}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <Progress value={currentProgress} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{currentPhase}</span>
            <span>{currentProgress}%</span>
          </div>
        </div>

        {/* Phase Steps */}
        <div className="space-y-3">
          {phases.map((phase, index) => {
            const phaseStatus = getPhaseStatus(phase.id, 
              phase.id === currentPhase ? currentStatus : 
              phases.findIndex(p => p.id === currentPhase) > index ? 'completed' : 'pending'
            );

            return (
              <div
                key={phase.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border transition-colors",
                  phaseStatus === 'active' && "bg-primary/5 border-primary",
                  phaseStatus === 'completed' && "bg-green-500/5 border-green-500/20",
                  phaseStatus === 'failed' && "bg-destructive/5 border-destructive/20",
                  phaseStatus === 'pending' && "bg-muted/50 border-border"
                )}
              >
                <div className={cn(
                  "flex-shrink-0",
                  phaseStatus === 'completed' && "text-green-600",
                  phaseStatus === 'failed' && "text-destructive",
                  phaseStatus === 'active' && "text-primary",
                  phaseStatus === 'pending' && "text-muted-foreground"
                )}>
                  {phaseStatus === 'completed' ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : phaseStatus === 'failed' ? (
                    <XCircle className="h-5 w-5" />
                  ) : phaseStatus === 'active' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{phase.label}</div>
                  {phase.id === currentPhase && progress?.message && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {progress.message}
                    </div>
                  )}
                </div>
                {phaseStatus === 'completed' && (
                  <Badge variant="success" className="text-xs">Done</Badge>
                )}
                {phaseStatus === 'active' && (
                  <Badge variant="default" className="text-xs">In Progress</Badge>
                )}
              </div>
            );
          })}
        </div>

        {/* Resources Created */}
        {progress?.resources && progress.resources.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Resources Created:</h4>
            <div className="space-y-1">
              {progress.resources.slice(0, 5).map((resource, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span className="font-mono text-xs">{resource.type}.{resource.name}</span>
                </div>
              ))}
              {progress.resources.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  +{progress.resources.length - 5} more resources
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verification Results */}
        {progress?.verification && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Verification:</h4>
            <div className="flex items-center gap-2">
              <Badge variant={progress.verification.verified === progress.verification.total ? "success" : "warning"}>
                {progress.verification.verified}/{progress.verification.total} verified
              </Badge>
            </div>
          </div>
        )}

        {/* Error Display */}
        {progress?.error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="font-semibold">Error</span>
            </div>
            <p className="text-sm mt-2">{progress.error}</p>
          </div>
        )}

        {/* Recent History */}
        {history.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Recent Updates:</h4>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {history.slice(-5).reverse().map((event, idx) => (
                <div key={idx} className="text-xs text-muted-foreground flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  <span>{event.message}</span>
                  {event.progress !== undefined && (
                    <span className="ml-auto">{event.progress}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DeploymentProgress;

