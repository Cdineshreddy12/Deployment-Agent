import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { 
  Server, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Plus,
  TrendingUp,
  DollarSign,
  Rocket
} from 'lucide-react';
import { format } from 'date-fns';

const Dashboard = () => {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    deployed: 0,
    failed: 0
  });

  useEffect(() => {
    fetchDeployments();
  }, []);

  const fetchDeployments = async () => {
    try {
      const response = await api.get('/deployments?limit=10');
      setDeployments(response.data.data.deployments);
      
      const allResponse = await api.get('/deployments?limit=1000');
      const allDeployments = allResponse.data.data.deployments;
      
      setStats({
        total: allDeployments.length,
        active: allDeployments.filter(d => ['DEPLOYING', 'SANDBOX_DEPLOYING', 'TESTING', 'PENDING_APPROVAL'].includes(d.status)).length,
        deployed: allDeployments.filter(d => d.status === 'DEPLOYED').length,
        failed: allDeployments.filter(d => ['DEPLOYMENT_FAILED', 'SANDBOX_FAILED'].includes(d.status)).length
      });
    } catch (error) {
      console.error('Error fetching deployments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      'DEPLOYED': { variant: 'success', icon: CheckCircle2 },
      'DEPLOYING': { variant: 'warning', icon: Clock },
      'PENDING_APPROVAL': { variant: 'warning', icon: Clock },
      'DEPLOYMENT_FAILED': { variant: 'destructive', icon: XCircle },
      'SANDBOX_FAILED': { variant: 'destructive', icon: XCircle },
    };
    
    const statusInfo = statusMap[status] || { variant: 'secondary', icon: Clock };
    const Icon = statusInfo.icon;
    
    return (
      <Badge variant={statusInfo.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {status.replace(/_/g, ' ')}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Overview of your deployments and infrastructure
          </p>
        </div>
        <div className="flex gap-3">
          <Link to="/workspace">
            <Button variant="outline">
              <Rocket className="h-4 w-4 mr-2" />
              Project Workspace
            </Button>
          </Link>
          <Link to="/chat">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Deployment
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deployments</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
            <p className="text-xs text-muted-foreground">In progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deployed</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.deployed}</div>
            <p className="text-xs text-muted-foreground">Successfully deployed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.failed}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Deployments</CardTitle>
          <CardDescription>
            Latest deployment activity
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deployments.length === 0 ? (
            <div className="text-center py-12">
              <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No deployments yet</h3>
              <p className="text-muted-foreground mb-4">
                Get started by creating your first deployment
              </p>
              <Link to="/chat">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Deployment
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {deployments.map((deployment) => (
                <Link
                  key={deployment._id}
                  to={`/deployments/${deployment.deploymentId}`}
                  className="block"
                >
                  <Card className="hover:bg-accent transition-colors cursor-pointer">
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-3">
                            <h3 className="font-semibold text-lg">{deployment.name}</h3>
                            {getStatusBadge(deployment.status)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {deployment.description || 'No description'}
                          </p>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                            <span className="capitalize">{deployment.environment}</span>
                            <span>•</span>
                            <span>{format(new Date(deployment.createdAt), 'MMM d, yyyy')}</span>
                            {deployment.estimatedMonthlyCost && (
                              <>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <DollarSign className="h-3 w-3" />
                                  ${deployment.estimatedMonthlyCost}/mo
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;

