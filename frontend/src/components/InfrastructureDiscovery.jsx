import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Network, Server, Database, Loader, Shield, CheckCircle2, AlertCircle } from 'lucide-react';

const InfrastructureDiscovery = ({ discovery }) => {
  if (!discovery) {
    return null;
  }

  // Handle two possible structures:
  // 1. Backend returns: { terraform: {...}, docker: {...}, kubernetes: {...} }
  // 2. Expected structure: { resources: { networking: [], compute: [], ... }, recommendations: {...} }
  
  const existingInfra = discovery?.existingInfrastructure || discovery;
  
  // Check if it's the infrastructure tools structure (terraform, docker, etc.)
  const hasInfrastructureTools = existingInfra?.terraform || existingInfra?.docker || existingInfra?.kubernetes || existingInfra?.cloudformation;
  
  // Check if it's the resources structure (networking, compute, etc.)
  const resources = discovery?.resources || existingInfra?.resources || {};
  const recommendations = discovery?.recommendations || existingInfra?.recommendations || {};
  
  // Ensure resources is an object, not null/undefined
  const safeResourcesObj = resources && typeof resources === 'object' ? resources : {};
  
  // Ensure resources object has all expected properties
  const safeResources = {
    networking: Array.isArray(safeResourcesObj.networking) ? safeResourcesObj.networking : [],
    compute: Array.isArray(safeResourcesObj.compute) ? safeResourcesObj.compute : [],
    databases: Array.isArray(safeResourcesObj.databases) ? safeResourcesObj.databases : [],
    loadBalancers: Array.isArray(safeResourcesObj.loadBalancers) ? safeResourcesObj.loadBalancers : [],
    security: Array.isArray(safeResourcesObj.security) ? safeResourcesObj.security : []
  };
  
  // Ensure recommendations is an object
  const safeRecommendations = recommendations && typeof recommendations === 'object' ? recommendations : { reuse: [], create: [] };
  
  // If no resources and no infrastructure tools detected, don't render
  const hasResources = safeResources.networking.length > 0 || safeResources.compute.length > 0 || 
                       safeResources.databases.length > 0 || safeResources.loadBalancers.length > 0 || 
                       safeResources.security.length > 0;
  
  if (!hasResources && !hasInfrastructureTools) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Existing Infrastructure</CardTitle>
        <CardDescription>Resources discovered in your cloud environment</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Display infrastructure tools if detected */}
        {hasInfrastructureTools && (
          <div className="space-y-3">
            {existingInfra.terraform && (
              <div className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                <span className="font-medium">Terraform</span>
                <Badge variant="outline">{existingInfra.terraform.files?.length || 0} files</Badge>
              </div>
            )}
            {existingInfra.docker && (
              <div className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                <span className="font-medium">Docker</span>
                <Badge variant="outline">{existingInfra.docker.files?.length || 0} files</Badge>
              </div>
            )}
            {existingInfra.kubernetes && (
              <div className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                <span className="font-medium">Kubernetes</span>
                <Badge variant="outline">{existingInfra.kubernetes.files?.length || 0} files</Badge>
              </div>
            )}
            {existingInfra.cloudformation && (
              <div className="flex items-center justify-between text-sm p-2 bg-muted rounded">
                <span className="font-medium">CloudFormation</span>
                <Badge variant="outline">{existingInfra.cloudformation.files?.length || 0} files</Badge>
              </div>
            )}
          </div>
        )}
        
        {/* Display cloud resources if available */}
        {safeResources.networking && safeResources.networking.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Network className="h-4 w-4" />
              <span className="text-sm font-medium">Networking</span>
            </div>
            <div className="space-y-1">
              {safeResources.networking.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{resource.type}</span>
                  <Badge variant="outline">{resource.id || resource.cidr}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {safeResources.compute && safeResources.compute.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Server className="h-4 w-4" />
              <span className="text-sm font-medium">Compute</span>
            </div>
            <div className="space-y-1">
              {safeResources.compute.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{resource.type}</span>
                  <Badge variant="outline">{resource.instanceType || resource.id}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {safeResources.databases && safeResources.databases.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Databases</span>
            </div>
            <div className="space-y-1">
              {safeResources.databases.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span>{resource.engine || resource.type}</span>
                  <Badge variant="outline">{resource.id}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {safeResources.loadBalancers && safeResources.loadBalancers.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Loader className="h-4 w-4" />
              <span className="text-sm font-medium">Load Balancers</span>
            </div>
            <div className="space-y-1">
              {safeResources.loadBalancers.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="capitalize">{resource.type}</span>
                  <Badge variant="outline">{resource.id}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {safeResources.security && safeResources.security.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4" />
              <span className="text-sm font-medium">Security Groups</span>
            </div>
            <div className="space-y-1">
              {safeResources.security.map((resource, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span>{resource.name || resource.id}</span>
                  <Badge variant="outline">{resource.id}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {safeRecommendations && (safeRecommendations.reuse?.length > 0 || safeRecommendations.create?.length > 0) && (
          <div className="pt-4 border-t">
            <div className="text-sm font-medium mb-2">Recommendations</div>
            <div className="space-y-2">
              {(safeRecommendations.reuse || []).map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                  <div>
                    <div className="font-medium capitalize">{rec.type}</div>
                    <div className="text-muted-foreground">{rec.reason}</div>
                  </div>
                </div>
              ))}
              {(safeRecommendations.create || []).map((rec, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5" />
                  <div>
                    <div className="font-medium capitalize">{rec.type}</div>
                    <div className="text-muted-foreground">{rec.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default InfrastructureDiscovery;

