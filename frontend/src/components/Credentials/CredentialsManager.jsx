import React, { useState, useEffect } from 'react';
import { 
  Key, 
  Plus, 
  Trash2, 
  Edit, 
  Upload, 
  Eye, 
  EyeOff, 
  Cloud, 
  Lock, 
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  X,
  FileCode,
  FileKey
} from 'lucide-react';
import api from '../../services/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useToast } from '../../hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../ui/tabs";

const CredentialsManager = () => {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("env-file");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    platform: 'generic',
    tags: '',
    file: null,
    content: '',
    accessKeyId: '',
    secretAccessKey: '',
    sessionToken: '',
    region: 'us-east-1'
  });
  const [showSecret, setShowSecret] = useState(false);
  const [selectedCredential, setSelectedCredential] = useState(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      const response = await api.get('/credentials');
      setCredentials(response.data.credentials || []);
    } catch (err) {
      toast({
        title: 'Error',
        description: err.response?.data?.error || 'Failed to fetch credentials',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (value) => {
    setActiveTab(value);
    resetForm();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      platform: 'generic',
      tags: '',
      file: null,
      content: '',
      accessKeyId: '',
      secretAccessKey: '',
      sessionToken: '',
      region: 'us-east-1'
    });
    setShowSecret(false);
  };

  const handleOpenDialog = (type) => {
    setActiveTab(type);
    setDialogOpen(true);
    resetForm();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFormData({ ...formData, file });
      
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData(prev => ({ ...prev, content: event.target.result }));
      };
      reader.readAsText(file);
    }
  };

  const handleSubmit = async () => {
    try {
      const data = new FormData();
      
      if (activeTab === 'env-file' || activeTab === 'ssh-key') {
        data.append('name', formData.name);
        if (formData.tags) data.append('tags', formData.tags);
        if (formData.platform) data.append('platform', formData.platform);
        
        if (formData.file) {
          data.append('file', formData.file);
        } else {
          data.append('content', formData.content);
        }
        
        const endpoint = activeTab === 'env-file' ? '/credentials/env-file' : '/credentials/ssh-key';
        await api.post(endpoint, data, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else if (activeTab === 'aws') {
        await api.post('/credentials/aws', {
          name: formData.name,
          accessKeyId: formData.accessKeyId,
          secretAccessKey: formData.secretAccessKey,
          sessionToken: formData.sessionToken || undefined,
          region: formData.region,
          tags: formData.tags
        });
      }
      
      toast({
        title: 'Success',
        description: 'Credential saved successfully',
      });
      setDialogOpen(false);
      fetchCredentials();
    } catch (err) {
      toast({
        title: 'Error',
        description: err.response?.data?.error || 'Failed to save credential',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this credential?')) {
      return;
    }
    
    try {
      await api.delete(`/credentials/${id}`);
      toast({
        title: 'Success',
        description: 'Credential deleted successfully',
      });
      fetchCredentials();
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to delete credential',
        variant: 'destructive',
      });
    }
  };

  const handleView = async (credential) => {
    try {
      const response = await api.get(`/credentials/${credential.id}/decrypt`);
      setSelectedCredential({ ...credential, decryptedData: response.data.credential.data });
      setViewDialogOpen(true);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to decrypt credential',
        variant: 'destructive',
      });
    }
  };

  const filteredCredentials = credentials.filter(c => {
    if (activeTab === 'env-file') return c.type === 'env-file';
    if (activeTab === 'ssh-key') return c.type === 'ssh-key';
    if (activeTab === 'aws') return c.type === 'aws-credentials';
    return true;
  });

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployment Credentials</h1>
          <p className="text-muted-foreground mt-2">
            Manage SSH keys, AWS credentials, and .env files for deployments
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Credential
        </Button>
      </div>

      <Tabs defaultValue="env-file" value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="bg-muted p-1 rounded-lg">
          <TabsTrigger value="env-file" className="flex items-center gap-2">
            <FileCode className="h-4 w-4" />
            .env Files
          </TabsTrigger>
          <TabsTrigger value="ssh-key" className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            SSH Keys
          </TabsTrigger>
          <TabsTrigger value="aws" className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            AWS Credentials
          </TabsTrigger>
        </TabsList>

        {loading ? (
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCredentials.length === 0 ? (
              <Card className="col-span-full py-12 flex flex-col items-center justify-center border-dashed">
                <ShieldCheck className="h-12 w-12 text-muted-foreground opacity-20 mb-4" />
                <h3 className="text-lg font-semibold text-muted-foreground">No credentials found</h3>
                <p className="text-sm text-muted-foreground mb-4">Click "Add" to store your first secure credential</p>
                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New
                </Button>
              </Card>
            ) : (
              filteredCredentials.map((cred) => (
                <Card key={cred.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-lg flex items-center gap-2">
                          {cred.name}
                          {cred.active ? (
                            <div className="h-2 w-2 rounded-full bg-green-500" />
                          ) : (
                            <div className="h-2 w-2 rounded-full bg-gray-400" />
                          )}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {cred.platform}
                          </Badge>
                          <span className="text-xs">
                            {cred.type === 'env-file' ? `${cred.envVarCount} vars` : cred.type}
                          </span>
                        </CardDescription>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" onClick={() => handleView(cred)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(cred.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {cred.tags && cred.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {cred.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>Created {new Date(cred.createdAt).toLocaleDateString()}</span>
                      {cred.lastUsed && (
                        <span>Used {new Date(cred.lastUsed).toLocaleDateString()}</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}
      </Tabs>

      {/* Add Credential Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Add {activeTab === 'env-file' ? '.env File' : activeTab === 'ssh-key' ? 'SSH Key' : 'AWS Credentials'}
            </DialogTitle>
            <DialogDescription>
              Store your credentials securely. Data is encrypted using AES-256-GCM.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Unique Name</label>
              <Input
                placeholder="e.g., Production AWS, Staging .env"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {activeTab === 'env-file' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Platform</label>
                  <select 
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={formData.platform}
                    onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                  >
                    <option value="generic">Generic</option>
                    <option value="aws">AWS</option>
                    <option value="gcp">GCP</option>
                    <option value="azure">Azure</option>
                    <option value="kubernetes">Kubernetes</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tags</label>
                  <Input
                    placeholder="production, web"
                    value={formData.tags}
                    onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  />
                </div>
              </div>
            )}

            {(activeTab === 'env-file' || activeTab === 'ssh-key') && (
              <div className="space-y-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">
                    {activeTab === 'env-file' ? '.env File Content' : 'SSH Private Key Content'}
                  </label>
                  <div className="flex gap-2 mb-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="relative"
                      asChild
                    >
                      <label className="cursor-pointer">
                        <Upload className="h-4 w-4 mr-2" />
                        Upload File
                        <input type="file" className="hidden" onChange={handleFileChange} />
                      </label>
                    </Button>
                    {formData.file && (
                      <span className="text-xs text-muted-foreground flex items-center">
                        <CheckCircle2 className="h-3 w-3 mr-1 text-green-500" />
                        {formData.file.name}
                      </span>
                    )}
                  </div>
                  <textarea
                    className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={activeTab === 'env-file' ? "KEY=VALUE\nPORT=3000" : "-----BEGIN RSA PRIVATE KEY-----"}
                    value={formData.content}
                    onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  />
                </div>
              </div>
            )}

            {activeTab === 'aws' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Access Key ID</label>
                    <Input
                      placeholder="AKIA..."
                      value={formData.accessKeyId}
                      onChange={(e) => setFormData({ ...formData, accessKeyId: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Secret Access Key</label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        placeholder="Secret key"
                        value={formData.secretAccessKey}
                        onChange={(e) => setFormData({ ...formData, secretAccessKey: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 py-2"
                        onClick={() => setShowSecret(!showSecret)}
                      >
                        {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Default Region</label>
                    <Input
                      placeholder="us-east-1"
                      value={formData.region}
                      onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tags</label>
                    <Input
                      placeholder="aws, backup"
                      value={formData.tags}
                      onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Session Token (Optional)</label>
                  <Input
                    placeholder="Temporary session token"
                    value={formData.sessionToken}
                    onChange={(e) => setFormData({ ...formData, sessionToken: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formData.name || (!formData.content && !formData.accessKeyId)}>
              Save Credential
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Credential Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-yellow-500" />
              {selectedCredential?.name}
            </DialogTitle>
            <DialogDescription>
              Decrypted content. Be careful with this information.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            {selectedCredential?.type === 'env-file' ? (
              <div className="bg-muted p-4 rounded-md font-mono text-xs max-h-[400px] overflow-auto">
                {Object.entries(selectedCredential.decryptedData || {}).map(([key, value]) => (
                  <div key={key} className="py-1">
                    <span className="text-blue-400">{key}</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">"{value}"</span>
                  </div>
                ))}
              </div>
            ) : selectedCredential?.type === 'ssh-key' ? (
              <textarea
                readOnly
                className="w-full min-h-[300px] bg-muted p-4 rounded-md font-mono text-xs focus:outline-none"
                value={selectedCredential.decryptedData?.key}
              />
            ) : (
              <div className="space-y-4">
                <div className="bg-muted p-4 rounded-md">
                  <div className="text-xs text-muted-foreground mb-1">Access Key ID</div>
                  <div className="font-mono text-sm">{selectedCredential?.decryptedData?.accessKeyId}</div>
                </div>
                <div className="bg-muted p-4 rounded-md">
                  <div className="text-xs text-muted-foreground mb-1">Secret Access Key</div>
                  <div className="font-mono text-sm">••••••••••••••••</div>
                </div>
                <div className="bg-muted p-4 rounded-md">
                  <div className="text-xs text-muted-foreground mb-1">Region</div>
                  <div className="font-mono text-sm">{selectedCredential?.decryptedData?.region}</div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => setViewDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CredentialsManager;
