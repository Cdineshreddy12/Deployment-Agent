import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Database, HardDrive, MessageSquare, Zap, Globe, Lock } from 'lucide-react';

const CodeAnalysisResults = ({ analysis }) => {
  if (!analysis) {
    return null;
  }

  const { databases, storage, messaging, caching, apis, environmentVariables, security } = analysis;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code Analysis Results</CardTitle>
        <CardDescription>Infrastructure needs detected from codebase</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {databases && databases.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Database className="h-4 w-4" />
              <span className="text-sm font-medium">Databases</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {databases.map((db, idx) => (
                <Badge key={idx} variant="secondary">{db}</Badge>
              ))}
            </div>
          </div>
        )}

        {storage && storage.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="h-4 w-4" />
              <span className="text-sm font-medium">Storage</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {storage.map((s, idx) => (
                <Badge key={idx} variant="secondary">{s}</Badge>
              ))}
            </div>
          </div>
        )}

        {messaging && messaging.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4" />
              <span className="text-sm font-medium">Messaging</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {messaging.map((m, idx) => (
                <Badge key={idx} variant="secondary">{m}</Badge>
              ))}
            </div>
          </div>
        )}

        {caching && caching.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">Caching</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {caching.map((c, idx) => (
                <Badge key={idx} variant="secondary">{c}</Badge>
              ))}
            </div>
          </div>
        )}

        {apis && apis.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-4 w-4" />
              <span className="text-sm font-medium">External APIs</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {apis.slice(0, 5).map((api, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">{api}</Badge>
              ))}
              {apis.length > 5 && (
                <Badge variant="outline" className="text-xs">+{apis.length - 5} more</Badge>
              )}
            </div>
          </div>
        )}

        {security && (security.ssl || security.encryption) && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Lock className="h-4 w-4" />
              <span className="text-sm font-medium">Security</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {security.ssl && <Badge variant="default">SSL/TLS</Badge>}
              {security.encryption && <Badge variant="default">Encryption</Badge>}
            </div>
          </div>
        )}

        {environmentVariables && environmentVariables.length > 0 && (
          <div>
            <div className="text-sm font-medium mb-2">Environment Variables Detected</div>
            <div className="text-xs text-muted-foreground">
              {environmentVariables.slice(0, 10).join(', ')}
              {environmentVariables.length > 10 && ` +${environmentVariables.length - 10} more`}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CodeAnalysisResults;

