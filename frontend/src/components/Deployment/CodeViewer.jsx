import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Copy, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { useToast } from '../../hooks/use-toast';

const CodeViewer = ({ terraformCode }) => {
  const [copiedFile, setCopiedFile] = React.useState(null);
  const { toast } = useToast();

  const handleCopy = (code, fileName) => {
    navigator.clipboard.writeText(code);
    setCopiedFile(fileName);
    toast({
      title: "Copied!",
      description: `${fileName} copied to clipboard`,
    });
    setTimeout(() => setCopiedFile(null), 2000);
  };

  if (!terraformCode || !terraformCode.main) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">No Terraform code available yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terraform Code</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="main" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="main">main.tf</TabsTrigger>
            <TabsTrigger value="variables">variables.tf</TabsTrigger>
            <TabsTrigger value="outputs">outputs.tf</TabsTrigger>
            <TabsTrigger value="providers">providers.tf</TabsTrigger>
          </TabsList>
          
          <TabsContent value="main" className="mt-4">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10"
                onClick={() => handleCopy(terraformCode.main, 'main.tf')}
              >
                {copiedFile === 'main.tf' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <SyntaxHighlighter
                language="hcl"
                style={vscDarkPlus}
                customStyle={{ borderRadius: '0.5rem', padding: '1rem' }}
              >
                {terraformCode.main}
              </SyntaxHighlighter>
            </div>
          </TabsContent>
          
          <TabsContent value="variables" className="mt-4">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10"
                onClick={() => handleCopy(terraformCode.variables, 'variables.tf')}
              >
                {copiedFile === 'variables.tf' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <SyntaxHighlighter
                language="hcl"
                style={vscDarkPlus}
                customStyle={{ borderRadius: '0.5rem', padding: '1rem' }}
              >
                {terraformCode.variables || '// No variables defined'}
              </SyntaxHighlighter>
            </div>
          </TabsContent>
          
          <TabsContent value="outputs" className="mt-4">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10"
                onClick={() => handleCopy(terraformCode.outputs, 'outputs.tf')}
              >
                {copiedFile === 'outputs.tf' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <SyntaxHighlighter
                language="hcl"
                style={vscDarkPlus}
                customStyle={{ borderRadius: '0.5rem', padding: '1rem' }}
              >
                {terraformCode.outputs || '// No outputs defined'}
              </SyntaxHighlighter>
            </div>
          </TabsContent>
          
          <TabsContent value="providers" className="mt-4">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 z-10"
                onClick={() => handleCopy(terraformCode.providers, 'providers.tf')}
              >
                {copiedFile === 'providers.tf' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <SyntaxHighlighter
                language="hcl"
                style={vscDarkPlus}
                customStyle={{ borderRadius: '0.5rem', padding: '1rem' }}
              >
                {terraformCode.providers || '// No provider configuration'}
              </SyntaxHighlighter>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default CodeViewer;

