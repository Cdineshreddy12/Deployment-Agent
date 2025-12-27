import React, { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useToast } from '../hooks/use-toast';
import api from '../services/api';
import { Github, Search, Loader2 } from 'lucide-react';

const RepositorySelector = ({ value, onChange, onAnalyze }) => {
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadRepositories();
  }, []);

  const loadRepositories = async () => {
    setLoading(true);
    try {
      const response = await api.get('/github/repositories');
      setRepositories(response.data.data.repositories || []);
    } catch (error) {
      if (error.response?.status === 401) {
        toast({
          title: 'GitHub Not Connected',
          description: 'Please connect your GitHub account first',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to load repositories',
          variant: 'destructive',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRepositorySelect = (repoUrl) => {
    onChange(repoUrl);
  };

  const handleCustomUrl = () => {
    if (customUrl.trim()) {
      onChange(customUrl);
    }
  };

  const handleAnalyze = async () => {
    if (!value) {
      toast({
        title: 'Error',
        description: 'Please select a repository',
        variant: 'destructive',
      });
      return;
    }

    if (onAnalyze) {
      onAnalyze(value);
    }
  };

  const filteredRepositories = repositories.filter(repo =>
    repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    repo.fullName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Github className="h-4 w-4" />
        <label className="text-sm font-medium">GitHub Repository</label>
      </div>

      <div className="space-y-2">
        <Select value={value} onValueChange={handleRepositorySelect}>
          <SelectTrigger>
            <SelectValue placeholder="Select a repository" />
          </SelectTrigger>
          <SelectContent>
            <div className="p-2">
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            {loading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              filteredRepositories.map((repo) => (
                <SelectItem key={repo.id} value={repo.url}>
                  <div className="flex flex-col">
                    <span className="font-medium">{repo.fullName}</span>
                    {repo.description && (
                      <span className="text-xs text-muted-foreground">{repo.description}</span>
                    )}
                  </div>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>

        <div className="text-xs text-muted-foreground text-center">or</div>

        <div className="flex gap-2">
          <Input
            placeholder="https://github.com/owner/repo"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleCustomUrl()}
          />
          <Button variant="outline" onClick={handleCustomUrl}>
            Use URL
          </Button>
        </div>
      </div>

      {value && (
        <Button onClick={handleAnalyze} className="w-full">
          Analyze Repository
        </Button>
      )}
    </div>
  );
};

export default RepositorySelector;

