import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { ScrollArea } from './ui/scroll-area';
import { Badge } from './ui/badge';
import api from '../services/api';
import { Key, Eye, EyeOff, Save, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { useToast } from '../hooks/use-toast';

const CredentialCollector = ({ deploymentId, onSave, initialVariables = [] }) => {
  const [variables, setVariables] = useState([]);
  const [visible, setVisible] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [importText, setImportText] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (initialVariables.length > 0) {
      setVariables(initialVariables);
    } else if (deploymentId) {
      loadEnvVariables();
    }
  }, [deploymentId, initialVariables]);

  const loadEnvVariables = async () => {
    setLoading(true);
    try {
      // Try to get from .env file via Cursor
      const response = await api.post('/cursor/config-files', { deploymentId });
      const configFiles = response.data.data;

      if (configFiles.envExample) {
        // Parse .env.example
        const envVars = parseEnvContent(configFiles.envExample.content);
        setVariables(envVars);
      } else if (configFiles.env) {
        // Parse .env (but don't show values for security)
        const envVars = parseEnvContent(configFiles.env.content);
        setVariables(envVars.map(v => ({ ...v, value: '' })));
      }
    } catch (error) {
      console.error('Failed to load environment variables:', error);
      toast({
        title: 'Error',
        description: 'Failed to load environment variables',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const parseEnvContent = (content) => {
    const vars = [];
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
        if (match) {
          vars.push({
            name: match[1],
            value: match[2] || '',
            required: match[2] === ''
          });
        }
      }
    }

    return vars;
  };

  const toggleVisibility = (index) => {
    const newVisible = new Set(visible);
    if (newVisible.has(index)) {
      newVisible.delete(index);
    } else {
      newVisible.add(index);
    }
    setVisible(newVisible);
  };

  const updateVariable = (index, field, value) => {
    const updated = [...variables];
    updated[index] = { ...updated[index], [field]: value };
    setVariables(updated);
  };

  const addVariable = () => {
    setVariables([...variables, { name: '', value: '', required: false }]);
  };

  const removeVariable = (index) => {
    setVariables(variables.filter((_, i) => i !== index));
  };

  const handleImport = () => {
    const imported = parseEnvContent(importText);
    setVariables([...variables, ...imported]);
    setImportMode(false);
    setImportText('');
    toast({
      title: 'Imported',
      description: `Imported ${imported.length} environment variables`
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.post(`/deployments/${deploymentId}/env`, {
        environmentVariables: variables.reduce((acc, v) => {
          if (v.name) {
            acc[v.name] = v.value || '';
          }
          return acc;
        }, {})
      });

      toast({
        title: 'Saved',
        description: 'Environment variables saved securely'
      });

      if (onSave) {
        onSave(variables);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to save environment variables',
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const missingRequired = variables.filter(v => v.required && !v.value);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              Environment Variables
            </CardTitle>
            <CardDescription>
              Configure environment variables for your deployment
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportMode(!importMode)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || missingRequired.length > 0}
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {missingRequired.length > 0 && (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <span className="text-sm text-yellow-800 dark:text-yellow-200">
                  {missingRequired.length} required variable(s) missing values
                </span>
              </div>
            )}

            {importMode && (
              <div className="space-y-2 p-4 border rounded-lg bg-muted/50">
                <Label>Import from .env format</Label>
                <Textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="DATABASE_URL=postgresql://...&#10;API_KEY=..."
                  className="font-mono text-sm"
                  rows={5}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleImport}>
                    Import
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setImportMode(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            <ScrollArea className="h-[400px]">
              <div className="space-y-3">
                {variables.map((variable, index) => (
                  <div key={index} className="flex gap-2 items-start p-3 border rounded-lg">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`name-${index}`} className="text-xs">
                          Variable Name
                        </Label>
                        {variable.required && (
                          <Badge variant="destructive" className="text-xs">
                            Required
                          </Badge>
                        )}
                      </div>
                      <Input
                        id={`name-${index}`}
                        value={variable.name}
                        onChange={(e) => updateVariable(index, 'name', e.target.value.toUpperCase())}
                        placeholder="DATABASE_URL"
                        className="font-mono text-sm"
                      />
                      <div>
                        <Label htmlFor={`value-${index}`} className="text-xs">
                          Value
                        </Label>
                        <div className="relative">
                          <Input
                            id={`value-${index}`}
                            type={visible.has(index) ? 'text' : 'password'}
                            value={variable.value}
                            onChange={(e) => updateVariable(index, 'value', e.target.value)}
                            placeholder="Enter value..."
                            className="font-mono text-sm pr-10"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-0 top-0 h-full px-2"
                            onClick={() => toggleVisibility(index)}
                          >
                            {visible.has(index) ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeVariable(index)}
                      className="mt-6"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>

            <Button variant="outline" onClick={addVariable} className="w-full">
              + Add Variable
            </Button>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle className="h-4 w-4" />
              <span>Credentials are encrypted and stored securely per deployment</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CredentialCollector;





