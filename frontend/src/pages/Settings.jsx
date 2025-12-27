import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useToast } from '../hooks/use-toast';
import { Settings as SettingsIcon, Save, Download, Upload, CreditCard, Globe } from 'lucide-react';

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [envVars, setEnvVars] = useState({});
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await api.get('/settings');
      const settingsData = response.data.data.settings;
      setSettings(settingsData);
      setEnvVars(settingsData.environmentVariables || {});
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put('/settings', {
        apiUrls: settings.apiUrls,
        credits: settings.credits,
        preferences: settings.preferences
      });
      
      toast({
        title: 'Success',
        description: 'Settings saved successfully',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEnv = async () => {
    setSaving(true);
    try {
      await api.put('/settings/env', {
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

  const handleAddEnvVar = () => {
    if (newEnvKey.trim() && newEnvValue.trim()) {
      setEnvVars({
        ...envVars,
        [newEnvKey.trim()]: newEnvValue.trim()
      });
      setNewEnvKey('');
      setNewEnvValue('');
    }
  };

  const handleRemoveEnvVar = (key) => {
    const newEnvVars = { ...envVars };
    delete newEnvVars[key];
    setEnvVars(newEnvVars);
  };

  const handleExportEnv = async () => {
    try {
      const response = await api.post('/settings/env/export', {}, {
        responseType: 'blob'
      });
      
      const blob = new Blob([response.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.env';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: 'Success',
        description: '.env file exported',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to export .env file',
        variant: 'destructive',
      });
    }
  };

  const handleImportEnv = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target.result;
        await api.post('/settings/env/import', { envContent: content });
        
        toast({
          title: 'Success',
          description: '.env file imported successfully',
        });
        
        fetchSettings();
      };
      reader.readAsText(file);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to import .env file',
        variant: 'destructive',
      });
    }
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure your environment, API endpoints, and preferences
        </p>
      </div>

      <Tabs defaultValue="api" className="space-y-4">
        <TabsList>
          <TabsTrigger value="api">API Configuration</TabsTrigger>
          <TabsTrigger value="env">Environment Variables</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                API Endpoints
              </CardTitle>
              <CardDescription>
                Configure API endpoint URLs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="backendUrl">Backend API URL</Label>
                <Input
                  id="backendUrl"
                  value={settings?.apiUrls?.backend || ''}
                  onChange={(e) => setSettings({
                    ...settings,
                    apiUrls: {
                      ...settings.apiUrls,
                      backend: e.target.value
                    }
                  })}
                  placeholder="http://localhost:5002/api/v1"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="websocketUrl">WebSocket URL</Label>
                <Input
                  id="websocketUrl"
                  value={settings?.apiUrls?.websocket || ''}
                  onChange={(e) => setSettings({
                    ...settings,
                    apiUrls: {
                      ...settings.apiUrls,
                      websocket: e.target.value
                    }
                  })}
                  placeholder="ws://localhost:5002"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="githubUrl">GitHub API URL</Label>
                <Input
                  id="githubUrl"
                  value={settings?.apiUrls?.github || ''}
                  onChange={(e) => setSettings({
                    ...settings,
                    apiUrls: {
                      ...settings.apiUrls,
                      github: e.target.value
                    }
                  })}
                  placeholder="https://api.github.com"
                />
              </div>
              
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save Settings'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="env">
          <Card>
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>
                Manage global environment variables
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="Variable name (e.g., DATABASE_URL)"
                  value={newEnvKey}
                  onChange={(e) => setNewEnvKey(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddEnvVar()}
                />
                <Input
                  type="password"
                  placeholder="Value"
                  value={newEnvValue}
                  onChange={(e) => setNewEnvValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleAddEnvVar()}
                />
                <Button onClick={handleAddEnvVar}>Add</Button>
              </div>

              <div className="space-y-2">
                {Object.entries(envVars).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 p-2 border rounded">
                    <div className="flex-1">
                      <div className="font-mono text-sm">{key}</div>
                      <div className="text-xs text-muted-foreground">
                        {value ? '***' : '(empty)'}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveEnvVar(key)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveEnv} disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  Save Environment Variables
                </Button>
                <Button variant="outline" onClick={handleExportEnv}>
                  <Download className="h-4 w-4 mr-2" />
                  Export .env
                </Button>
                <label>
                  <Button variant="outline" as="span">
                    <Upload className="h-4 w-4 mr-2" />
                    Import .env
                  </Button>
                  <input
                    type="file"
                    accept=".env"
                    onChange={handleImportEnv}
                    className="hidden"
                  />
                </label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credits">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Credits & Quota
              </CardTitle>
              <CardDescription>
                Manage your API credits and usage
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">Total Credits</div>
                  <div className="text-2xl font-bold">{settings?.credits?.total || 0}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Used</div>
                  <div className="text-2xl font-bold">{settings?.credits?.used || 0}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Remaining</div>
                  <div className="text-2xl font-bold text-green-600">
                    {settings?.credits?.remaining || 0}
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="totalCredits">Update Total Credits</Label>
                <Input
                  id="totalCredits"
                  type="number"
                  value={settings?.credits?.total || 0}
                  onChange={(e) => setSettings({
                    ...settings,
                    credits: {
                      ...settings.credits,
                      total: parseInt(e.target.value) || 0,
                      remaining: (parseInt(e.target.value) || 0) - (settings?.credits?.used || 0)
                    }
                  })}
                />
              </div>
              
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Save Credits
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Settings;
