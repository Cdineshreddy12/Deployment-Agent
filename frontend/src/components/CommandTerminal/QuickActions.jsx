import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { 
  Play, 
  FileCode, 
  Cloud, 
  Container, 
  Terminal,
  Loader2
} from 'lucide-react';

const QuickActions = ({ onExecute, isExecuting }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState(null);
  const [params, setParams] = useState({});

  const terraformActions = [
    { id: 'init', label: 'Init', command: 'terraform init', icon: Play },
    { id: 'plan', label: 'Plan', command: 'terraform plan', icon: FileCode },
    { id: 'apply', label: 'Apply', command: 'terraform apply -auto-approve', icon: Play },
    { id: 'validate', label: 'Validate', command: 'terraform validate', icon: FileCode },
    { id: 'destroy', label: 'Destroy', command: 'terraform destroy -auto-approve', icon: Play, danger: true },
  ];

  const awsActions = [
    { 
      id: 'describe-instances', 
      label: 'List EC2 Instances', 
      command: 'aws ec2 describe-instances',
      icon: Cloud,
      needsParams: false
    },
    { 
      id: 'list-buckets', 
      label: 'List S3 Buckets', 
      command: 'aws s3 ls',
      icon: Cloud,
      needsParams: false
    },
    { 
      id: 'get-logs', 
      label: 'Get CloudWatch Logs', 
      command: 'aws logs tail',
      icon: Cloud,
      needsParams: true,
      params: [
        { name: 'logGroupName', label: 'Log Group Name', required: true }
      ]
    },
  ];

  const dockerActions = [
    { id: 'ps', label: 'List Containers', command: 'docker ps', icon: Container },
    { id: 'images', label: 'List Images', command: 'docker images', icon: Container },
    { id: 'logs', label: 'View Logs', command: 'docker logs', icon: Container, needsParams: true, params: [{ name: 'container', label: 'Container ID/Name', required: true }] },
  ];

  const commonActions = [
    { id: 'ls', label: 'List Files', command: 'ls -la', icon: Terminal },
    { id: 'pwd', label: 'Current Directory', command: 'pwd', icon: Terminal },
    { id: 'cat', label: 'View File', command: 'cat', icon: Terminal, needsParams: true, params: [{ name: 'file', label: 'File Path', required: true }] },
  ];

  const handleActionClick = (action) => {
    if (action.needsParams && action.params) {
      setSelectedAction(action);
      setParams({});
      setDialogOpen(true);
    } else {
      onExecute(action.command);
    }
  };

  const handleExecuteWithParams = () => {
    if (!selectedAction) return;
    
    let command = selectedAction.command;
    
    // Replace parameters in command
    selectedAction.params?.forEach(param => {
      const value = params[param.name];
      if (value) {
        command = command.replace(`{${param.name}}`, value);
        if (!command.includes(value)) {
          command += ` ${value}`;
        }
      }
    });

    onExecute(command);
    setDialogOpen(false);
    setSelectedAction(null);
    setParams({});
  };

  const ActionButton = ({ action }) => (
    <Button
      variant={action.danger ? 'destructive' : 'outline'}
      className="w-full justify-start"
      onClick={() => handleActionClick(action)}
      disabled={isExecuting}
    >
      <action.icon className="h-4 w-4 mr-2" />
      {action.label}
    </Button>
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Execute common commands with one click</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="terraform" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="terraform">Terraform</TabsTrigger>
              <TabsTrigger value="aws">AWS</TabsTrigger>
              <TabsTrigger value="docker">Docker</TabsTrigger>
              <TabsTrigger value="common">Common</TabsTrigger>
            </TabsList>
            
            <TabsContent value="terraform" className="space-y-2 mt-4">
              {terraformActions.map(action => (
                <ActionButton key={action.id} action={action} />
              ))}
            </TabsContent>
            
            <TabsContent value="aws" className="space-y-2 mt-4">
              {awsActions.map(action => (
                <ActionButton key={action.id} action={action} />
              ))}
            </TabsContent>
            
            <TabsContent value="docker" className="space-y-2 mt-4">
              {dockerActions.map(action => (
                <ActionButton key={action.id} action={action} />
              ))}
            </TabsContent>
            
            <TabsContent value="common" className="space-y-2 mt-4">
              {commonActions.map(action => (
                <ActionButton key={action.id} action={action} />
              ))}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedAction?.label}</DialogTitle>
            <DialogDescription>
              {selectedAction?.command}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {selectedAction?.params?.map(param => (
              <div key={param.name} className="space-y-2">
                <Label htmlFor={param.name}>
                  {param.label}
                  {param.required && <span className="text-destructive"> *</span>}
                </Label>
                <Input
                  id={param.name}
                  value={params[param.name] || ''}
                  onChange={(e) => setParams({ ...params, [param.name]: e.target.value })}
                  placeholder={param.placeholder || `Enter ${param.label.toLowerCase()}`}
                />
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleExecuteWithParams}
                disabled={!selectedAction?.params?.every(p => !p.required || params[p.name])}
              >
                Execute
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default QuickActions;





