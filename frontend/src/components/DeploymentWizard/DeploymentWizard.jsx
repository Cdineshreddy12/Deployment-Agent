import React, { useState } from 'react';
import { PanelGroup, Panel, Separator } from 'react-resizable-panels';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import ProjectDetection from './ProjectDetection';
import RequirementsAnalysis from './RequirementsAnalysis';
import CredentialCollector from '../CredentialCollector';
import CommandTerminal from '../CommandTerminal/CommandTerminal';
import ChatInterface from '../Chat/ChatInterface';
import { ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react';

// Resize handle component for panels
const ResizeHandle = ({ className = '' }) => (
  <Separator
    className={`group flex items-center justify-center bg-slate-200 hover:bg-primary transition-colors cursor-col-resize data-[orientation=horizontal]:w-2 data-[orientation=horizontal]:h-full data-[orientation=vertical]:h-2 data-[orientation=vertical]:w-full ${className}`}
  >
    <div className="w-0.5 h-8 bg-slate-400 group-hover:bg-primary rounded-full transition-colors data-[orientation=vertical]:w-8 data-[orientation=vertical]:h-0.5" />
  </Separator>
);

const DeploymentWizard = ({ deploymentId }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [projectData, setProjectData] = useState(null);
  const [requirements, setRequirements] = useState(null);
  const [credentials, setCredentials] = useState(null);

  const steps = [
    { id: 1, title: 'Project Detection', component: ProjectDetection },
    { id: 2, title: 'Requirements Analysis', component: RequirementsAnalysis },
    { id: 3, title: 'Credentials', component: CredentialCollector },
    { id: 4, title: 'Deployment', component: CommandTerminal }
  ];

  const totalSteps = steps.length;
  const progress = (currentStep / totalSteps) * 100;

  const handleStepComplete = (stepId, data) => {
    switch (stepId) {
      case 1:
        setProjectData(data);
        break;
      case 2:
        setRequirements(data);
        break;
      case 3:
        setCredentials(data);
        break;
    }
  };

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const CurrentComponent = steps[currentStep - 1].component;

  return (
    <div className="h-full w-full">
      <PanelGroup direction="horizontal" className="h-full">
        {/* Left Panel - Wizard Content */}
        <Panel defaultSize={60} minSize={40} className="flex flex-col">
          <div className="h-full overflow-y-auto p-6 space-y-6">
            {/* Progress Bar */}
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Step {currentStep} of {totalSteps}</span>
                    <span className="text-muted-foreground">{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} />
                  <div className="flex items-center justify-between mt-4">
                    {steps.map((step, index) => (
                      <div
                        key={step.id}
                        className={`flex flex-col items-center flex-1 ${
                          index < currentStep - 1 ? 'text-green-600' :
                          index === currentStep - 1 ? 'text-primary' :
                          'text-muted-foreground'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                          index < currentStep - 1 ? 'bg-green-600 border-green-600 text-white' :
                          index === currentStep - 1 ? 'border-primary bg-primary text-primary-foreground' :
                          'border-muted-foreground bg-background'
                        }`}>
                          {index < currentStep - 1 ? (
                            <CheckCircle className="h-5 w-5" />
                          ) : (
                            <span>{step.id}</span>
                          )}
                        </div>
                        <span className="text-xs mt-2 text-center">{step.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Current Step Component */}
            <CurrentComponent
              deploymentId={deploymentId}
              projectType={projectData?.projectType}
              onDetected={(data) => {
                handleStepComplete(1, data);
                setTimeout(handleNext, 500);
              }}
              onAnalysisComplete={(data) => handleStepComplete(2, data)}
              onNext={handleNext}
              onSave={(data) => {
                handleStepComplete(3, data);
                setTimeout(handleNext, 500);
              }}
            />

            {/* Navigation */}
            {currentStep !== totalSteps && (
              <div className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentStep === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>
                <Button
                  onClick={handleNext}
                  disabled={currentStep === totalSteps}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        </Panel>

        {/* Resize Handle */}
        <ResizeHandle />

        {/* Right Panel - AI Chat */}
        <Panel defaultSize={40} minSize={30} className="flex flex-col border-l border-slate-200">
          <div className="h-full flex flex-col">
            {deploymentId ? (
              <ChatInterface deploymentId={deploymentId} />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <p className="text-sm">Deployment ID required for AI chat</p>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

export default DeploymentWizard;





