import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Play, Search, XCircle, CheckCircle, Loader2, Clock } from 'lucide-react';
import { format } from 'date-fns';

const CommandHistory = ({ commands = [], onReRun, onViewDetails, loading = false }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const filteredCommands = commands.filter(cmd => {
    const matchesSearch = !searchTerm || 
      cmd.command?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cmd.commandId?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesType = filterType === 'all' || cmd.type === filterType;
    const matchesStatus = filterStatus === 'all' || cmd.status === filterStatus;

    return matchesSearch && matchesType && matchesStatus;
  });

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-destructive" />;
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'cancelled':
        return <XCircle className="h-4 w-4 text-muted-foreground" />;
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 text-green-500';
      case 'failed':
        return 'bg-destructive/10 text-destructive';
      case 'running':
        return 'bg-blue-500/10 text-blue-500';
      case 'cancelled':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Command History</CardTitle>
        <CardDescription>View and re-run previous commands</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search commands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="shell">Shell</SelectItem>
                <SelectItem value="terraform">Terraform</SelectItem>
                <SelectItem value="aws">AWS</SelectItem>
                <SelectItem value="docker">Docker</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Command List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No commands found
            </div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {filteredCommands.map((cmd) => (
                  <div
                    key={cmd.commandId}
                    className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-shrink-0 mt-1">
                      {getStatusIcon(cmd.status)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-sm font-mono break-all">
                          {cmd.command}
                        </code>
                        <Badge variant="outline" className={getStatusColor(cmd.status)}>
                          {cmd.status}
                        </Badge>
                        {cmd.type && (
                          <Badge variant="secondary" className="text-xs">
                            {cmd.type}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span>
                          {cmd.startedAt ? format(new Date(cmd.startedAt), 'PPpp') : ''}
                        </span>
                        {cmd.duration && (
                          <span>Duration: {cmd.duration}ms</span>
                        )}
                        {cmd.exitCode !== undefined && (
                          <span>Exit: {cmd.exitCode}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {cmd.status !== 'running' && onReRun && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onReRun(cmd.command)}
                          title="Re-run command"
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                      {onViewDetails && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewDetails(cmd.commandId)}
                          title="View details"
                        >
                          View
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default CommandHistory;





