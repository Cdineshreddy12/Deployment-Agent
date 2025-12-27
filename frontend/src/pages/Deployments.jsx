import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { 
  Server, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Plus,
  Search,
  DollarSign
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '../hooks/use-toast';

const Deployments = () => {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    environment: undefined,
    status: undefined,
    search: ''
  });
  const { toast } = useToast();

  useEffect(() => {
    fetchDeployments();
  }, [filters.environment, filters.status]);

  const fetchDeployments = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.environment && filters.environment !== 'all') params.append('environment', filters.environment);
      if (filters.status && filters.status !== 'all') params.append('status', filters.status);

      const response = await api.get(`/deployments?${params.toString()}`);
      let filtered = response.data.data.deployments;
      
      if (filters.search) {
        filtered = filtered.filter(d => 
          d.name.toLowerCase().includes(filters.search.toLowerCase()) ||
          d.description?.toLowerCase().includes(filters.search.toLowerCase())
        );
      }
      
      setDeployments(filtered);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch deployments",
        variant: "destructive",
      });
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployments</h1>
          <p className="text-muted-foreground mt-2">
            Manage and monitor your infrastructure deployments
          </p>
        </div>
        <Link to="/chat">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Deployment
          </Button>
        </Link>
      </div>

      <div className="flex gap-4 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deployments..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="pl-10"
          />
        </div>
        <Select 
          value={filters.environment || 'all'} 
          onValueChange={(value) => setFilters({ ...filters, environment: value === 'all' ? undefined : value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Environments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Environments</SelectItem>
            <SelectItem value="development">Development</SelectItem>
            <SelectItem value="staging">Staging</SelectItem>
            <SelectItem value="production">Production</SelectItem>
          </SelectContent>
        </Select>
        <Select 
          value={filters.status || 'all'} 
          onValueChange={(value) => setFilters({ ...filters, status: value === 'all' ? undefined : value })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="DEPLOYED">Deployed</SelectItem>
            <SelectItem value="DEPLOYING">Deploying</SelectItem>
            <SelectItem value="PENDING_APPROVAL">Pending Approval</SelectItem>
            <SelectItem value="DEPLOYMENT_FAILED">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {deployments.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No deployments found</h3>
            <p className="text-muted-foreground mb-4">
              {filters.search || filters.environment || filters.status
                ? 'Try adjusting your filters'
                : 'Get started by creating your first deployment'}
            </p>
            {!filters.search && !filters.environment && !filters.status && (
              <Link to="/chat">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Deployment
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {deployments.map((deployment) => (
            <Link
              key={deployment._id}
              to={`/deployments/${deployment.deploymentId}`}
              className="block"
            >
              <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-lg line-clamp-1">{deployment.name}</h3>
                      {getStatusBadge(deployment.status)}
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {deployment.description || 'No description'}
                    </p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2 border-t">
                      <span className="capitalize">{deployment.environment}</span>
                      <span>•</span>
                      <span>{format(new Date(deployment.createdAt), 'MMM d')}</span>
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
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Deployments;

