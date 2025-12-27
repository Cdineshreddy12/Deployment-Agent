import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { useToast } from '../hooks/use-toast';
import api from '../services/api';
import { Github, CheckCircle2, XCircle } from 'lucide-react';

const GitHubConnect = ({ onConnected }) => {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const { toast } = useToast();

  // Check if GitHub token is already stored in database
  useEffect(() => {
    const checkTokenStatus = async () => {
      try {
        const response = await api.get('/github/token');
        if (response.data.success && response.data.data.hasToken) {
          setConnected(true);
        }
      } catch (error) {
        // Token not found or error - that's okay, user can add one
        console.log('No GitHub token found in database');
      } finally {
        setChecking(false);
      }
    };
    
    checkTokenStatus();
  }, []);

  const handleConnect = async () => {
    if (!token.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a GitHub token',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Save token to database (this will also validate it)
      await api.post('/github/token', {
        token: token.trim(),
        name: 'GitHub Personal Access Token',
        description: 'GitHub Personal Access Token for repository access'
      });

      // Test token by listing repositories
      const response = await api.get('/github/repositories');
      
      setConnected(true);
      setToken(''); // Clear the input for security
      toast({
        title: 'Success',
        description: 'GitHub account connected successfully',
      });
      
      if (onConnected) {
        onConnected();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to connect GitHub account',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await api.delete('/github/token');
      setConnected(false);
      setToken('');
      toast({
        title: 'Disconnected',
        description: 'GitHub account disconnected',
      });
      
      if (onConnected) {
        onConnected();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error?.message || 'Failed to disconnect GitHub account',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub Integration
        </CardTitle>
        <CardDescription>
          Connect your GitHub account to enable repository analysis and automated deployments
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {checking ? (
          <div className="text-sm text-muted-foreground">Checking GitHub connection...</div>
        ) : connected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium">GitHub account connected</span>
              </div>
              <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={loading}>
                {loading ? 'Disconnecting...' : 'Disconnect'}
              </Button>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Update GitHub Token</label>
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Update your token at{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  github.com/settings/tokens
                </a>
                {' '}with repo, read:org, read:user, and workflow scopes
              </p>
              <Button onClick={handleConnect} disabled={loading || !token.trim()} size="sm">
                {loading ? 'Updating...' : 'Update Token'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">GitHub Personal Access Token</label>
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Create a token at{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  github.com/settings/tokens
                </a>
                {' '}with repo, read:org, read:user, and workflow scopes. Your token will be securely stored in the database.
              </p>
            </div>
            <Button onClick={handleConnect} disabled={loading || !token.trim()}>
              {loading ? 'Connecting...' : 'Connect GitHub'}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GitHubConnect;

