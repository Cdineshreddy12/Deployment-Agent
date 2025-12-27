import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { cn } from '../../lib/utils';

const WorkflowVisualization = ({ statusHistory = [], currentStatus }) => {
  const statusOrder = [
    'INITIATED',
    'GATHERING',
    'PLANNING',
    'VALIDATING',
    'ESTIMATED',
    'PENDING_APPROVAL',
    'SANDBOX_DEPLOYING',
    'TESTING',
    'SANDBOX_VALIDATED',
    'APPROVED',
    'DEPLOYING',
    'DEPLOYED'
  ];

  const getNodeStatus = useMemo(() => {
    const currentIndex = statusOrder.indexOf(currentStatus);
    return (status) => {
      const statusIndex = statusOrder.indexOf(status);
      if (statusIndex === -1) return 'pending';
      if (statusIndex < currentIndex) return 'completed';
      if (statusIndex === currentIndex) return 'current';
      return 'pending';
    };
  }, [currentStatus]);

  const initialNodes = useMemo(() => {
    return statusOrder.map((status, index) => {
      const nodeStatus = getNodeStatus(status);
      return {
        id: status,
        type: 'default',
        position: { x: index * 180, y: 0 },
        data: {
          label: (
            <div className="text-center">
              <div className={cn(
                "px-3 py-2 rounded-md text-xs font-medium whitespace-nowrap",
                nodeStatus === 'current' && "bg-primary text-primary-foreground shadow-lg",
                nodeStatus === 'completed' && "bg-green-500 text-white",
                nodeStatus === 'pending' && "bg-muted text-muted-foreground opacity-50"
              )}>
                {status.replace(/_/g, ' ')}
              </div>
            </div>
          ),
        },
        style: {
          background: 'transparent',
          border: 'none',
        },
      };
    });
  }, [getNodeStatus]);

  const initialEdges = useMemo(() => {
    return statusOrder.slice(0, -1).map((status, index) => ({
      id: `e${status}-${statusOrder[index + 1]}`,
      source: status,
      target: statusOrder[index + 1],
      type: 'smoothstep',
      animated: getNodeStatus(statusOrder[index + 1]) === 'current',
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      style: {
        strokeWidth: 2,
        stroke: getNodeStatus(statusOrder[index + 1]) === 'current' ? '#3b82f6' : '#e5e7eb',
      },
    }));
  }, [getNodeStatus]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  return (
    <div className="h-[500px] w-full border rounded-lg bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        className="bg-background"
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default WorkflowVisualization;
