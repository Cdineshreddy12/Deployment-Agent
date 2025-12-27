import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import api from '../../services/api';
import { FileText, Loader2, CheckCircle, Database, Cloud, Server } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';

const RequirementsAnalysis = ({ deploymentId, projectType, onAnalysisComplete, onNext }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [requirements, setRequirements] = useState({
    cloudProvider: '',
    infrastructureType: '',
    database: '',
    region: 'us-east-1'
  });
  const { toast } = useToast();

  useEffect(() => {
    if (deploymentId && projectType) {
      analyzeRequirements();
    }
  }, [deploymentId, projectType]);

  const analyzeRequirements = async () => {
    setAnalyzing(true);
    try {
      const response = await api.post('/cursor/config-files', { deploymentId });
      const configFiles = response.data.data;

      // Use requirement parser to analyze
      // For now, we'll do basic analysis here
      const detected = {
        environmentVariables: [],
        dependencies: [],
        buildCommands: [],
        runCommands: [],
        databaseRequirements: [],
        infrastructureNeeds: []
      };

      if (configFiles.packageJson && configFiles.packageJson.parsed) {
        detected.dependencies = Object.keys(configFiles.packageJson.parsed.dependencies || {});
        if (configFiles.packageJson.parsed.scripts) {
          if (configFiles.packageJson.parsed.scripts.build) {
            detected.buildCommands.push('npm run build');
          }
          if (configFiles.packageJson.parsed.scripts.start) {
            detected.runCommands.push('npm start');
          }
        }
      }

      if (configFiles.envExample) {
        // Parse env variables
        const lines = configFiles.envExample.content.split('\n');
        for (const line of lines) {
          const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*=/);
          if (match) {
            detected.environmentVariables.push(match[1]);
          }
        }
      }

      if (configFiles.dockerfile) {
        detected.infrastructureNeeds.push('docker');
      }

      setAnalysis(detected);

      if (onAnalysisComplete) {
        onAnalysisComplete(detected);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to analyze requirements',
        variant: 'destructive'
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleNext = () => {
    if (onNext) {
      onNext(requirements);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Step 2: Requirements Analysis
        </CardTitle>
        <CardDescription>
          Review detected requirements and configure deployment settings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {analyzing ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : analysis ? (
          <>
            <div className="space-y-4">
              <div>
                <Label>Cloud Provider</Label>
                <Select
                  value={requirements.cloudProvider}
                  onValueChange={(value) => setRequirements({ ...requirements, cloudProvider: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select cloud provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aws">AWS</SelectItem>
                    <SelectItem value="azure">Azure</SelectItem>
                    <SelectItem value="gcp">GCP</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {projectType?.type === 'nodejs' || projectType?.type === 'python' ? (
                <div>
                  <Label>Infrastructure Type</Label>
                  <Select
                    value={requirements.infrastructureType}
                    onValueChange={(value) => setRequirements({ ...requirements, infrastructureType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select infrastructure type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ec2">EC2/VM</SelectItem>
                      <SelectItem value="ecs">ECS/Fargate (Container)</SelectItem>
                      <SelectItem value="lambda">Lambda (Serverless)</SelectItem>
                      <SelectItem value="beanstalk">Elastic Beanstalk</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {analysis.databaseRequirements.length > 0 && (
                <div>
                  <Label>Database</Label>
                  <Select
                    value={requirements.database}
                    onValueChange={(value) => setRequirements({ ...requirements, database: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select database" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="postgresql">PostgreSQL (RDS)</SelectItem>
                      <SelectItem value="mysql">MySQL (RDS)</SelectItem>
                      <SelectItem value="mongodb">MongoDB</SelectItem>
                      <SelectItem value="redis">Redis</SelectItem>
                      <SelectItem value="none">None</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label>Region</Label>
                <Select
                  value={requirements.region}
                  onValueChange={(value) => setRequirements({ ...requirements, region: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="us-east-1">US East (N. Virginia)</SelectItem>
                    <SelectItem value="us-west-2">US West (Oregon)</SelectItem>
                    <SelectItem value="eu-west-1">Europe (Ireland)</SelectItem>
                    <SelectItem value="ap-southeast-1">Asia Pacific (Singapore)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="font-semibold text-sm">Detected Requirements</h4>

              {analysis.environmentVariables.length > 0 && (
                <div className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">Environment Variables</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.environmentVariables.map((varName) => (
                      <Badge key={varName} variant="outline" className="text-xs">
                        {varName}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {analysis.buildCommands.length > 0 && (
                <div className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Server className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">Build Commands</span>
                  </div>
                  <div className="space-y-1">
                    {analysis.buildCommands.map((cmd, idx) => (
                      <code key={idx} className="text-xs bg-muted p-1 rounded block">
                        {cmd}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {analysis.infrastructureNeeds.length > 0 && (
                <div className="p-3 border rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Cloud className="h-4 w-4 text-purple-500" />
                    <span className="text-sm font-medium">Infrastructure Needs</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {analysis.infrastructureNeeds.map((need) => (
                      <Badge key={need} variant="secondary" className="text-xs">
                        {need}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={handleNext}
              className="w-full mt-4"
              disabled={!requirements.cloudProvider || !requirements.infrastructureType}
            >
              Continue to Credentials
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default RequirementsAnalysis;





