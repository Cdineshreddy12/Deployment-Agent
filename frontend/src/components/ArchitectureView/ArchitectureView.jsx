import React, { useState, useEffect } from 'react';
import { 
  FolderTree, 
  Package, 
  Server, 
  Database, 
  Code, 
  Settings,
  CheckCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw
} from 'lucide-react';
import api from '../../services/api';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

const ArchitectureView = ({ deploymentId }) => {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    structure: true,
    dependencies: true,
    requirements: true,
    issues: true
  });

  useEffect(() => {
    if (deploymentId) {
      fetchAnalysis();
    }
  }, [deploymentId]);

  const fetchAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get(`/architecture/${deploymentId}`);
      if (response.data.success) {
        setAnalysis(response.data.data);
      } else {
        setError(response.data.error || 'Failed to analyze architecture');
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch architecture analysis');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>Analyzing project architecture...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50 bg-destructive/10">
        <CardContent className="flex flex-col items-center p-8 text-destructive">
          <AlertTriangle className="h-8 w-8 mb-4" />
          <p className="mb-4">{error}</p>
          <Button onClick={fetchAnalysis} variant="outline" size="sm" className="border-destructive/50 text-destructive hover:bg-destructive/20">
            <RefreshCw size={16} className="mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!analysis) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center p-8 text-muted-foreground">
          <Info className="h-8 w-8 mb-4" />
          <p>No analysis available. Set a workspace path first.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-6 bg-card rounded-xl text-foreground">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-semibold text-foreground m-0">Project Architecture</h2>
        <Button onClick={fetchAnalysis} variant="outline" size="sm" className="flex items-center gap-2">
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      {/* Project Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Code size={24} className="text-primary" />
            <div>
              <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Project Type</span>
              <span className="block text-base font-semibold text-foreground capitalize">{analysis.projectType?.type || 'Unknown'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Server size={24} className="text-primary" />
            <div>
              <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Framework</span>
              <span className="block text-base font-semibold text-foreground capitalize">{analysis.projectType?.framework || 'Vanilla'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <FolderTree size={24} className="text-primary" />
            <div>
              <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Architecture</span>
              <span className="block text-base font-semibold text-foreground capitalize">{analysis.architecturePattern?.primary || 'Standard'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <Package size={24} className="text-primary" />
            <div>
              <span className="block text-xs text-muted-foreground uppercase tracking-wider mb-1">Package Manager</span>
              <span className="block text-base font-semibold text-foreground capitalize">{analysis.dependencies?.packageManager || 'npm'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Structure Section */}
      <Card className="mb-4 overflow-hidden">
        <CardHeader 
          className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-accent transition-colors"
          onClick={() => toggleSection('structure')}
        >
          {expandedSections.structure ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
          <FolderTree size={20} className="text-muted-foreground" />
          <CardTitle className="text-base font-semibold m-0">Project Structure</CardTitle>
        </CardHeader>
        {expandedSections.structure && (
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2 mb-4">
              {analysis.structure?.hasDocker && (
                <Badge variant="outline" className="bg-cyan-50 text-cyan-600 border-cyan-200">Docker</Badge>
              )}
              {analysis.structure?.hasCICD && (
                <Badge variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200">CI/CD</Badge>
              )}
              {analysis.structure?.hasTests && (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200">Tests</Badge>
              )}
              {analysis.structure?.isMonorepo && (
                <Badge variant="outline" className="bg-orange-50 text-orange-600 border-orange-200">Monorepo</Badge>
              )}
            </div>
            {analysis.structure?.keyDirectories?.length > 0 && (
              <div>
                <h4 className="text-sm text-muted-foreground mb-2">Key Directories</h4>
                <ul className="list-none p-0 m-0">
                  {analysis.structure.keyDirectories.map((dir, i) => (
                    <li key={i} className="flex items-center gap-2 py-1 text-sm font-mono text-foreground">
                      <FolderTree size={14} />
                      {dir.path || dir.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Dependencies Section */}
      <Card className="mb-4 overflow-hidden">
        <CardHeader 
          className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-accent transition-colors"
          onClick={() => toggleSection('dependencies')}
        >
          {expandedSections.dependencies ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
          <Package size={20} className="text-muted-foreground" />
          <CardTitle className="text-base font-semibold m-0">Dependencies & Scripts</CardTitle>
        </CardHeader>
        {expandedSections.dependencies && (
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-3 mb-4">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono ${analysis.dependencies?.hasBuildScript ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                {analysis.dependencies?.hasBuildScript ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>build</span>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono ${analysis.dependencies?.hasStartScript ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                {analysis.dependencies?.hasStartScript ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>start</span>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono ${analysis.dependencies?.hasTestScript ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                {analysis.dependencies?.hasTestScript ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>test</span>
              </div>
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono ${analysis.dependencies?.hasDevScript ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-destructive/10 text-destructive border border-destructive/20'}`}>
                {analysis.dependencies?.hasDevScript ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                <span>dev</span>
              </div>
            </div>

            {analysis.dependencies?.detectedFrameworks?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm text-muted-foreground mb-2">Detected Frameworks</h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.dependencies.detectedFrameworks.map((fw, i) => (
                    <Badge key={i} variant="outline" className="bg-indigo-50 text-indigo-600 border-indigo-200">{fw}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.dependencies?.detectedDatabases?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm text-muted-foreground mb-2">Database Dependencies</h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.dependencies.detectedDatabases.map((db, i) => (
                    <Badge key={i} variant="outline" className="bg-pink-50 text-pink-600 border-pink-200 flex items-center gap-1">
                      <Database size={12} />
                      {db}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.dependencies?.detectedServices?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm text-muted-foreground mb-2">External Services</h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.dependencies.detectedServices.map((svc, i) => (
                    <Badge key={i} variant="outline" className="bg-sky-50 text-sky-600 border-sky-200">{svc}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Deployment Requirements Section */}
      <Card className="mb-4 overflow-hidden">
        <CardHeader 
          className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-accent transition-colors"
          onClick={() => toggleSection('requirements')}
        >
          {expandedSections.requirements ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
          <Settings size={20} className="text-muted-foreground" />
          <CardTitle className="text-base font-semibold m-0">Deployment Requirements</CardTitle>
        </CardHeader>
        {expandedSections.requirements && analysis.deploymentRequirements && (
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Runtime</span>
                <span className="text-sm text-foreground">
                  {analysis.deploymentRequirements.runtime?.name} {analysis.deploymentRequirements.runtime?.version}
                </span>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Build Required</span>
                <span className="text-sm text-foreground">
                  {analysis.deploymentRequirements.buildRequired ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Docker Required</span>
                <span className="text-sm text-foreground">
                  {analysis.deploymentRequirements.dockerRequired ? 'Yes' : 'No'}
                </span>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Install Command</span>
                <code className="block mt-1 px-2 py-1 bg-background rounded text-xs font-mono text-emerald-600 break-all">{analysis.deploymentRequirements.installCommand}</code>
              </div>
              {analysis.deploymentRequirements.buildCommand && (
                <div className="p-3 bg-muted rounded-lg">
                  <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Build Command</span>
                  <code className="block mt-1 px-2 py-1 bg-background rounded text-xs font-mono text-emerald-600 break-all">{analysis.deploymentRequirements.buildCommand}</code>
                </div>
              )}
              {analysis.deploymentRequirements.startCommand && (
                <div className="p-3 bg-muted rounded-lg">
                  <span className="block text-xs text-muted-foreground mb-1 uppercase tracking-wider">Start Command</span>
                  <code className="block mt-1 px-2 py-1 bg-background rounded text-xs font-mono text-emerald-600 break-all">{analysis.deploymentRequirements.startCommand}</code>
                </div>
              )}
            </div>

            {analysis.deploymentRequirements.ports?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm text-muted-foreground mb-2">Exposed Ports</h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.deploymentRequirements.ports.map((port, i) => (
                    <Badge key={i} variant="outline" className="bg-emerald-50 text-emerald-600 border-emerald-200 font-mono">{port}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.deploymentRequirements.environmentVariables?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm text-muted-foreground mb-2">Environment Variables ({analysis.deploymentRequirements.environmentVariables.length})</h4>
                <ul className="list-none p-0 m-0">
                  {analysis.deploymentRequirements.environmentVariables.slice(0, 10).map((v, i) => (
                    <li key={i} className="flex items-center gap-2 py-1">
                      <code className="px-2 py-1 bg-muted rounded text-xs font-mono text-pink-600">{v.name || v}</code>
                      {v.required && <Badge variant="destructive" className="text-xs">Required</Badge>}
                    </li>
                  ))}
                  {analysis.deploymentRequirements.environmentVariables.length > 10 && (
                    <li className="text-muted-foreground italic text-sm py-1">
                      +{analysis.deploymentRequirements.environmentVariables.length - 10} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Potential Issues Section */}
      {analysis.potentialIssues?.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <CardHeader 
            className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-accent transition-colors"
            onClick={() => toggleSection('issues')}
          >
            {expandedSections.issues ? <ChevronDown className="h-5 w-5 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 text-muted-foreground" />}
            <AlertTriangle size={20} className="text-muted-foreground" />
            <CardTitle className="text-base font-semibold m-0">Potential Issues ({analysis.potentialIssues.length})</CardTitle>
          </CardHeader>
          {expandedSections.issues && (
            <CardContent className="px-4 pb-4">
              <ul className="list-none p-0 m-0">
                {analysis.potentialIssues.map((issue, i) => (
                  <li key={i} className={`flex gap-3 p-3 rounded-lg mb-2 last:mb-0 ${issue.severity === 'warning' ? 'bg-yellow-50 border border-yellow-200' : 'bg-blue-50 border border-blue-200'}`}>
                    {issue.severity === 'warning' ? (
                      <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className="text-sm text-foreground m-0 mb-1">{issue.message}</p>
                      {issue.recommendation && (
                        <p className="text-xs text-muted-foreground italic m-0">{issue.recommendation}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
};

export default ArchitectureView;


