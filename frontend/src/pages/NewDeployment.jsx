import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { useToast } from '../hooks/use-toast';
import { Github, Loader2, CheckCircle2, ArrowRight, FileText, CheckCircle } from 'lucide-react';
import CodeAnalysisResults from '../components/CodeAnalysisResults';
import InfrastructureDiscovery from '../components/InfrastructureDiscovery';

const NewDeployment = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [deploymentId, setDeploymentId] = useState(null);
  
  // Step 1: Input Method Selection
  const [inputMethod, setInputMethod] = useState('workspace'); // 'workspace' or 'github'
  const [workspacePath, setWorkspacePath] = useState('');
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  // Check if GitHub token is stored in database
  useEffect(() => {
    const checkTokenStatus = async () => {
      try {
        const response = await api.get('/github/token');
        if (response.data.success && response.data.data.hasToken) {
          setHasStoredToken(true);
        }
      } catch (error) {
        // Token not found - that's okay
        setHasStoredToken(false);
      } finally {
        setCheckingToken(false);
      }
    };
    
    checkTokenStatus();
  }, []);
  
  // Step 2: Analysis Results
  const [analysis, setAnalysis] = useState(null);
  const [plan, setPlan] = useState(null);
  
  // Step 3: Environment Variables
  const [envVars, setEnvVars] = useState({});
  const [envSchema, setEnvSchema] = useState({});
  
  // Step 4: Credentials
  const [selectedCredentials, setSelectedCredentials] = useState({});

  const handleStep1Submit = async (e) => {
    // Prevent form submission if called from form
    if (e) {
      e.preventDefault();
    }

    // Validate based on input method
    if (inputMethod === 'workspace') {
      if (!workspacePath.trim()) {
        toast({
          title: 'Error',
          description: 'Please provide a workspace path',
          variant: 'destructive',
        });
        return;
      }
    } else {
      if (!repositoryUrl.trim()) {
        toast({
          title: 'Error',
          description: 'Please provide a repository URL',
          variant: 'destructive',
        });
        return;
      }

      // Only require token if not stored in database
      if (!hasStoredToken && !githubToken.trim()) {
        toast({
          title: 'Error',
          description: 'Please provide a GitHub token or save one in GitHub settings',
          variant: 'destructive',
        });
        return;
      }
    }

    setLoading(true);
    try {
      // Create deployment
      const deploymentData = {
        name: inputMethod === 'workspace' 
          ? workspacePath.split('/').pop() || 'New Deployment'
          : repositoryUrl.split('/').pop() || 'New Deployment',
        description: inputMethod === 'workspace'
          ? `Deployment from workspace: ${workspacePath}`
          : `Deployment from ${repositoryUrl}`,
        environment: 'development',
        repositoryUrl: inputMethod === 'github' ? repositoryUrl : undefined,
        workspacePath: inputMethod === 'workspace' ? workspacePath : undefined
      };

      // Only include token if provided (otherwise will use stored token)
      if (inputMethod === 'github' && githubToken.trim()) {
        deploymentData.githubToken = githubToken;
      }

      const response = await api.post('/deployments', deploymentData);

      const deployment = response.data.data.deployment;
      setDeploymentId(deployment.deploymentId);

      // If workspace path, analyze using Cursor integration
      if (inputMethod === 'workspace') {
        // Set workspace path
        await api.post('/cursor/workspace', {
          deploymentId: deployment.deploymentId,
          workspacePath
        });

        // Analyze requirements
        const analysisResponse = await api.post('/requirements/analyze', {
          deploymentId: deployment.deploymentId
        });

        setAnalysis({
          projectType: analysisResponse.data.data.analysis.projectType,
          requirements: analysisResponse.data.data.analysis.requirements,
          configFiles: analysisResponse.data.data.analysis.configFiles
        });
      } else {
        // Start GitHub analysis (token will be fetched from DB if not provided)
        const analysisData = {
          repositoryUrl,
          branch: 'main',
          deploymentId: deployment.deploymentId
        };

        // Only include token if provided
        if (githubToken.trim()) {
          analysisData.githubToken = githubToken;
        }

        const analysisResponse = await api.post('/github/analyze', analysisData);
        setAnalysis(analysisResponse.data.data.analysis);
      }

      // Generate .env schema
      try {
        const envResponse = await api.post(`/deployments/${deployment.deploymentId}/env/generate`);
        const detectedVars = {};
        for (const varName of Object.keys(envResponse.data.data.environmentVariables || {})) {
          detectedVars[varName] = '';
        }
        setEnvVars(detectedVars);
        setEnvSchema(envResponse.data.data.schema || {});
      } catch (envError) {
        // Env generation is optional, continue even if it fails
        console.warn('Failed to generate env schema:', envError);
        setEnvVars({});
        setEnvSchema({});
      }

      // Get plan from deployment (will be generated by orchestrator)
      setStep(2);
      
      toast({
        title: 'Repository Analyzed',
        description: 'Code analysis completed successfully',
      });
    } catch (error) {
      // Don't let errors cause page refresh or redirect
      const errorMessage = error.response?.data?.error?.message || 
                          error.message || 
                          'Failed to analyze repository';
      const errorCode = error.response?.data?.error?.code;
      
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
      
      // Log error for debugging but don't redirect
      console.error('Deployment creation error:', {
        code: errorCode,
        message: errorMessage,
        status: error.response?.status
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStep2Continue = () => {
    setStep(3);
  };

  const handleStep3Submit = async () => {
    if (!deploymentId) return;

    setLoading(true);
    try {
      // Save environment variables
      await api.put(`/deployments/${deploymentId}/env`, {
        environmentVariables: envVars
      });

      setStep(4);
      
      toast({
        title: 'Environment Variables Saved',
        description: 'Proceeding to credential selection',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save environment variables',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStep4Submit = async () => {
    if (!deploymentId) return;

    setLoading(true);
    try {
      // Reuse selected credentials
      for (const [serviceType, credId] of Object.entries(selectedCredentials)) {
        if (credId) {
          await api.post(`/credentials/${credId}/reuse`, {
            deploymentId
          });
        }
      }

      // Navigate to chat/deployment detail
      navigate(`/chat/${deploymentId}`);
      
      toast({
        title: 'Deployment Created',
        description: 'Starting deployment process...',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to start deployment',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Deployment</h1>
        <p className="text-muted-foreground mt-2">
          Start with your GitHub repository and let AI handle the rest
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center flex-1">
            <div
              className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                step >= s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-muted-foreground'
              }`}
            >
              {step > s ? <CheckCircle2 className="h-5 w-5" /> : s}
            </div>
            {s < 4 && (
              <div
                className={`flex-1 h-1 mx-2 ${
                  step > s ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Input Method Selection */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {inputMethod === 'workspace' ? <FileText className="h-5 w-5" /> : <Github className="h-5 w-5" />}
              {inputMethod === 'workspace' ? 'Connect Cursor Workspace' : 'Connect GitHub Repository'}
            </CardTitle>
            <CardDescription>
              {inputMethod === 'workspace' 
                ? 'Provide your local workspace path for direct file access (recommended)'
                : 'Provide your repository URL. GitHub token is optional if you\'ve already saved one.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Method Selection */}
            <div className="flex gap-2 p-1 bg-muted rounded-lg">
              <Button
                type="button"
                variant={inputMethod === 'workspace' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setInputMethod('workspace')}
              >
                <FileText className="h-4 w-4 mr-2" />
                Cursor Workspace
              </Button>
              <Button
                type="button"
                variant={inputMethod === 'github' ? 'default' : 'ghost'}
                className="flex-1"
                onClick={() => setInputMethod('github')}
              >
                <Github className="h-4 w-4 mr-2" />
                GitHub Repository
              </Button>
            </div>

            <form onSubmit={handleStep1Submit} className="space-y-4">
              {inputMethod === 'workspace' ? (
                <div className="space-y-2">
                  <Label htmlFor="workspacePath">Workspace Path</Label>
                  <Input
                    id="workspacePath"
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    placeholder="/Users/username/projects/my-app"
                    required
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter the absolute path to your project directory. The system will read files directly without cloning.
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="repositoryUrl">Repository URL</Label>
                    <Input
                      id="repositoryUrl"
                      value={repositoryUrl}
                      onChange={(e) => setRepositoryUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                      required
                    />
                  </div>
              
                  {checkingToken ? (
                    <div className="text-sm text-muted-foreground">Checking GitHub token status...</div>
                  ) : hasStoredToken ? (
                    <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-muted-foreground">
                        Using stored GitHub token. You can override it below if needed.
                      </span>
                    </div>
                  ) : null}
                  
                  <div className="space-y-2">
                    <Label htmlFor="githubToken">
                      GitHub Personal Access Token {hasStoredToken && <span className="text-muted-foreground">(Optional)</span>}
                    </Label>
                    <Input
                      id="githubToken"
                      type="password"
                      value={githubToken}
                      onChange={(e) => setGithubToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      required={!hasStoredToken}
                    />
                    <p className="text-xs text-muted-foreground">
                      {hasStoredToken ? (
                        <>
                          Leave empty to use your saved token, or enter a new token to override it. Create a token at{' '}
                          <a
                            href="https://github.com/settings/tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            github.com/settings/tokens
                          </a>
                          {' '}with repo, read:org, read:user, and workflow scopes.
                        </>
                      ) : (
                        <>
                          Create a token at{' '}
                          <a
                            href="https://github.com/settings/tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            github.com/settings/tokens
                          </a>
                          {' '}with repo, read:org, read:user, and workflow scopes. Your token will be securely stored for future use.
                        </>
                      )}
                    </p>
                  </div>
                </>
              )}
              
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {inputMethod === 'workspace' ? 'Analyzing Workspace...' : 'Analyzing Repository...'}
                  </>
                ) : (
                  <>
                    {inputMethod === 'workspace' ? 'Analyze Workspace' : 'Analyze Repository'}
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Analysis Results & Plan */}
      {step === 2 && analysis && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Analysis Complete</CardTitle>
              <CardDescription>
                Repository analyzed and deployment plan generated
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {analysis.codeAnalysis && (
                <CodeAnalysisResults analysis={analysis.codeAnalysis} />
              )}
              
              {analysis.existingInfrastructure && analysis.existingInfrastructure.resources && (
                <InfrastructureDiscovery discovery={analysis.existingInfrastructure} />
              )}
              
              <Button onClick={handleStep2Continue} className="w-full">
                Continue to Environment Variables
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: Environment Variables */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Environment Variables
            </CardTitle>
            <CardDescription>
              Fill in the required environment variables detected from your codebase
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(envVars).length === 0 ? (
              <p className="text-muted-foreground">No environment variables detected</p>
            ) : (
              <div className="space-y-3">
                {Object.keys(envVars).map((key) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={key}>
                      {key}
                      {envSchema[key]?.required && (
                        <Badge variant="destructive" className="ml-2">Required</Badge>
                      )}
                    </Label>
                    {envSchema[key]?.description && (
                      <p className="text-xs text-muted-foreground">
                        {envSchema[key].description}
                      </p>
                    )}
                    <Input
                      id={key}
                      type={envSchema[key]?.type === 'password' ? 'password' : 'text'}
                      value={envVars[key] || ''}
                      onChange={(e) => setEnvVars({
                        ...envVars,
                        [key]: e.target.value
                      })}
                      placeholder={envSchema[key]?.defaultValue || `Enter ${key}`}
                    />
                  </div>
                ))}
              </div>
            )}
            
            <Button onClick={handleStep3Submit} disabled={loading} className="w-full">
              {loading ? 'Saving...' : 'Save & Continue'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Credentials */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Credentials</CardTitle>
            <CardDescription>
              Choose credentials to reuse or provide new ones
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Credential selection will be handled in the chat interface. Click continue to start the deployment process.
            </p>
            
            <Button onClick={handleStep4Submit} disabled={loading} className="w-full">
              {loading ? 'Starting...' : 'Start Deployment'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default NewDeployment;

