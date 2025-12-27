import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import api from '../../services/api';
import { FolderOpen, Loader2, CheckCircle, AlertCircle, Code, Package } from 'lucide-react';
import { useToast } from '../../hooks/use-toast';

const ProjectDetection = ({ deploymentId, onDetected, onNext }) => {
  const [workspacePath, setWorkspacePath] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [projectType, setProjectType] = useState(null);
  const [configFiles, setConfigFiles] = useState(null);
  const { toast } = useToast();

  const handleDetect = async () => {
    if (!workspacePath.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a workspace path',
        variant: 'destructive'
      });
      return;
    }

    setDetecting(true);
    try {
      // Set workspace path
      await api.post('/cursor/workspace', {
        deploymentId,
        workspacePath: workspacePath.trim()
      });

      // Detect project type
      const typeResponse = await api.post('/cursor/detect-project-type', {
        deploymentId
      });
      setProjectType(typeResponse.data.data);

      // Read config files
      const configResponse = await api.post('/cursor/config-files', {
        deploymentId
      });
      setConfigFiles(configResponse.data.data);

      toast({
        title: 'Success',
        description: 'Project detected successfully'
      });

      if (onDetected) {
        onDetected({
          workspacePath: workspacePath.trim(),
          projectType: typeResponse.data.data,
          configFiles: configResponse.data.data
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to detect project',
        variant: 'destructive'
      });
    } finally {
      setDetecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          Step 1: Project Detection
        </CardTitle>
        <CardDescription>
          Connect to your Cursor workspace to detect project type and structure
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="workspace-path">Workspace Path</Label>
          <div className="flex gap-2">
            <Input
              id="workspace-path"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder="/path/to/your/project"
              className="font-mono"
            />
            <Button
              onClick={handleDetect}
              disabled={detecting || !workspacePath.trim()}
            >
              {detecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Detecting...
                </>
              ) : (
                'Detect'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter the absolute path to your project directory
          </p>
        </div>

        {projectType && (
          <div className="space-y-3 p-4 border rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <h3 className="font-semibold">Project Detected</h3>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-muted-foreground">Project Type</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Code className="h-4 w-4" />
                  <Badge variant="outline">{projectType.type}</Badge>
                  {projectType.framework && (
                    <Badge variant="secondary">{projectType.framework}</Badge>
                  )}
                </div>
              </div>

              {projectType.packageManager && (
                <div>
                  <Label className="text-xs text-muted-foreground">Package Manager</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Package className="h-4 w-4" />
                    <Badge variant="outline">{projectType.packageManager}</Badge>
                  </div>
                </div>
              )}
            </div>

            {configFiles && (
              <div className="mt-4">
                <Label className="text-xs text-muted-foreground mb-2 block">Config Files Found</Label>
                <div className="flex flex-wrap gap-2">
                  {configFiles.packageJson && (
                    <Badge variant="outline" className="text-xs">
                      package.json
                    </Badge>
                  )}
                  {configFiles.readme && (
                    <Badge variant="outline" className="text-xs">
                      README.md
                    </Badge>
                  )}
                  {configFiles.envExample && (
                    <Badge variant="outline" className="text-xs">
                      .env.example
                    </Badge>
                  )}
                  {configFiles.dockerfile && (
                    <Badge variant="outline" className="text-xs">
                      Dockerfile
                    </Badge>
                  )}
                  {configFiles.dockerCompose && (
                    <Badge variant="outline" className="text-xs">
                      docker-compose.yml
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {onNext && (
              <Button onClick={onNext} className="w-full mt-4">
                Continue to Requirements Analysis
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ProjectDetection;





