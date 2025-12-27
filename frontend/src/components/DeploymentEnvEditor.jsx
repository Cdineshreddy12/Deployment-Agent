import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { useToast } from '../hooks/use-toast';
import { FileText, Save, Download, Plus, X } from 'lucide-react';

const DeploymentEnvEditor = ({ deploymentId }) => {
  const [envVars, setEnvVars] = useState({});
  const [globalEnvVars, setGlobalEnvVars] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchEnvVars();
    fetchGlobalEnvVars();
  }, [deploymentId]);

  const fetchEnvVars = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}/env`);
      setEnvVars(response.data.data.environmentVariables || {});
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load deployment environment variables',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchGlobalEnvVars = async () => {
    try {
      const response = await api.get('/settings/env');
      setGlobalEnvVars(response.data.data.environmentVariables || {});
    } catch (error) {
      // Global env vars not available, continue
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/deployments/${deploymentId}/env`, {
        environmentVariables: envVars
      });
      
      toast({
        title: 'Success',
        description: 'Environment variables saved successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save environment variables',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (newKey.trim()) {
      setEnvVars({
        ...envVars,
        [newKey.trim()]: newValue.trim()
      });
      setNewKey('');
      setNewValue('');
    }
  };

  const handleRemove = (key) => {
    const newVars = { ...envVars };
    delete newVars[key];
    setEnvVars(newVars);
  };

  const handleMergeGlobal = () => {
    const merged = { ...envVars };
    for (const [key, value] of Object.entries(globalEnvVars)) {
      if (!merged[key]) {
        merged[key] = value;
      }
    }
    setEnvVars(merged);
    
    toast({
      title: 'Merged',
      description: 'Global environment variables merged',
    });
  };

  const handleExport = async () => {
    try {
      const response = await api.get(`/deployments/${deploymentId}/env/file`, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deployment-${deploymentId}.env`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to export .env file',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Deployment Environment Variables
        </CardTitle>
        <CardDescription>
          Manage environment variables for this deployment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Variable name"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Input
            type="password"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAdd()}
          />
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {Object.keys(globalEnvVars).length > 0 && (
          <Button variant="outline" onClick={handleMergeGlobal} className="w-full">
            Merge Global Environment Variables
          </Button>
        )}

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {Object.entries(envVars).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2 p-2 border rounded">
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm font-medium">{key}</div>
                <div className="text-xs text-muted-foreground">
                  {value ? '***' : '(empty)'}
                  {globalEnvVars[key] && (
                    <Badge variant="outline" className="ml-2">Global</Badge>
                  )}
                </div>
              </div>
              <Input
                type="password"
                value={value || ''}
                onChange={(e) => setEnvVars({
                  ...envVars,
                  [key]: e.target.value
                })}
                className="flex-1 max-w-xs"
                placeholder="Enter value"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(key)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {Object.keys(envVars).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No environment variables set. Add variables above or merge from global settings.
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Variables'}
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export .env
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default DeploymentEnvEditor;

