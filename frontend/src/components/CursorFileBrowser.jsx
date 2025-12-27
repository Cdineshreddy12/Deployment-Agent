import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Input } from './ui/input';
import api from '../services/api';
import { Folder, File, ChevronRight, ChevronDown, Search, Loader2, FileText, Code, Image } from 'lucide-react';

const CursorFileBrowser = ({ deploymentId, onFileSelect, selectedFiles = [] }) => {
  const [structure, setStructure] = useState([]);
  const [expanded, setExpanded] = useState(new Set(['.']));
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [fileContents, setFileContents] = useState({});

  useEffect(() => {
    if (deploymentId) {
      loadStructure();
    }
  }, [deploymentId]);

  const loadStructure = async () => {
    setLoading(true);
    try {
      const response = await api.post('/cursor/get-structure', {
        deploymentId,
        rootPath: '.',
        maxDepth: 3
      });
      setStructure(response.data.data.structure || []);
    } catch (error) {
      console.error('Failed to load structure:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (path) => {
    const newExpanded = new Set(expanded);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpanded(newExpanded);
  };

  const getFileIcon = (name) => {
    const ext = name.split('.').pop()?.toLowerCase();
    if (['js', 'jsx', 'ts', 'tsx', 'json'].includes(ext)) {
      return <Code className="h-4 w-4 text-blue-400" />;
    }
    if (['md', 'txt'].includes(ext)) {
      return <FileText className="h-4 w-4 text-gray-400" />;
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(ext)) {
      return <Image className="h-4 w-4 text-purple-400" />;
    }
    return <File className="h-4 w-4 text-gray-400" />;
  };

  const renderTree = (items, path = '.', depth = 0) => {
    const filtered = items.filter(item => {
      if (!searchTerm) return true;
      return item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
             item.path.toLowerCase().includes(searchTerm.toLowerCase());
    });

    return (
      <div className={depth > 0 ? 'ml-4' : ''}>
        {filtered.map((item) => {
          const isExpanded = expanded.has(item.path);
          const isSelected = selectedFiles.includes(item.path);

          if (item.type === 'directory') {
            return (
              <div key={item.path}>
                <div
                  className={`flex items-center gap-2 p-1 hover:bg-muted/50 rounded cursor-pointer ${isSelected ? 'bg-primary/10' : ''}`}
                  onClick={() => toggleExpand(item.path)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Folder className="h-4 w-4 text-blue-500" />
                  <span className="text-sm">{item.name}</span>
                </div>
                {isExpanded && item.children && item.children.length > 0 && (
                  <div className="ml-4">
                    {renderTree(item.children, item.path, depth + 1)}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              key={item.path}
              className={`flex items-center gap-2 p-1 hover:bg-muted/50 rounded cursor-pointer ${isSelected ? 'bg-primary/10' : ''}`}
              onClick={() => {
                if (onFileSelect) {
                  onFileSelect(item.path);
                }
                loadFileContent(item.path);
              }}
            >
              <div className="w-4" />
              {getFileIcon(item.name)}
              <span className="text-sm flex-1">{item.name}</span>
              {item.size && (
                <span className="text-xs text-muted-foreground">
                  {(item.size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const loadFileContent = async (filePath) => {
    if (fileContents[filePath]) {
      return; // Already loaded
    }

    try {
      const response = await api.post('/cursor/read-file', {
        deploymentId,
        filePath
      });
      setFileContents(prev => ({
        ...prev,
        [filePath]: response.data.data.content
      }));
    } catch (error) {
      console.error('Failed to load file content:', error);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Structure</CardTitle>
        <CardDescription>Browse files in your workspace</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search files..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8"
            />
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-1">
                {renderTree(structure)}
              </div>
            </ScrollArea>
          )}

          {Object.keys(fileContents).length > 0 && (
            <div className="mt-4 space-y-2">
              <h4 className="text-sm font-semibold">File Contents:</h4>
              {Object.entries(fileContents).map(([path, content]) => (
                <div key={path} className="border rounded-lg p-2 bg-muted/50">
                  <div className="text-xs font-mono text-muted-foreground mb-1">{path}</div>
                  <pre className="text-xs overflow-auto max-h-32">{content.substring(0, 500)}...</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default CursorFileBrowser;





