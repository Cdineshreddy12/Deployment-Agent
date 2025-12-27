import React, { useMemo, useState } from 'react';
import {
  ServerIcon,
  CircleStackIcon,
  GlobeAltIcon,
  CubeTransparentIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationCircleIcon,
  MagnifyingGlassPlusIcon,
  MagnifyingGlassMinusIcon,
  ArrowsPointingOutIcon
} from '@heroicons/react/24/outline';

/**
 * ServiceTopology - Neumorphic visual diagram showing service connections
 * Features: Glassmorphism, soft shadows, 3D depth, animated connections
 */

const ServiceNode = ({ service, position, healthStatus, isSelected, onSelect }) => {
  const getServiceIcon = (type) => {
    switch (type) {
      case 'frontend':
      case 'fullstack':
        return GlobeAltIcon;
      case 'backend':
        return ServerIcon;
      case 'microservice':
        return CubeTransparentIcon;
      case 'database':
      case 'cache':
        return CircleStackIcon;
      default:
        return ServerIcon;
    }
  };

  const getTypeGlow = (type) => {
    switch (type) {
      case 'frontend':
        return { glow: 'shadow-blue-500/30', border: 'border-blue-500/40', bg: 'from-blue-600/20 to-blue-800/30' };
      case 'fullstack':
        return { glow: 'shadow-indigo-500/30', border: 'border-indigo-500/40', bg: 'from-indigo-600/20 to-indigo-800/30' };
      case 'backend':
        return { glow: 'shadow-emerald-500/30', border: 'border-emerald-500/40', bg: 'from-emerald-600/20 to-emerald-800/30' };
      case 'microservice':
        return { glow: 'shadow-cyan-500/30', border: 'border-cyan-500/40', bg: 'from-cyan-600/20 to-cyan-800/30' };
      case 'database':
        return { glow: 'shadow-purple-500/30', border: 'border-purple-500/40', bg: 'from-purple-600/20 to-purple-800/30' };
      case 'cache':
        return { glow: 'shadow-orange-500/30', border: 'border-orange-500/40', bg: 'from-orange-600/20 to-orange-800/30' };
      default:
        return { glow: 'shadow-gray-500/30', border: 'border-gray-500/40', bg: 'from-gray-600/20 to-gray-800/30' };
    }
  };

  const getHealthIndicator = () => {
    if (!healthStatus) return null;
    
    switch (healthStatus) {
      case 'healthy':
        return <CheckCircleIcon className="w-4 h-4 text-green-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.8)]" />;
      case 'unhealthy':
        return <XCircleIcon className="w-4 h-4 text-red-400 drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]" />;
      case 'unknown':
        return <ExclamationCircleIcon className="w-4 h-4 text-yellow-400 drop-shadow-[0_0_4px_rgba(234,179,8,0.8)]" />;
      default:
        return null;
    }
  };

  const Icon = getServiceIcon(service.type);
  const colors = getTypeGlow(service.type);

  return (
    <div
      className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
      style={{ left: position.x, top: position.y }}
      onClick={() => onSelect?.(service)}
    >
      {/* Neumorphic card with glassmorphism */}
      <div className={`
        relative rounded-2xl p-4 min-w-[130px]
        backdrop-blur-md bg-gradient-to-br ${colors.bg}
        border ${colors.border}
        transition-all duration-300 ease-out
        ${isSelected 
          ? `shadow-[0_0_20px_rgba(59,130,246,0.4),8px_8px_20px_rgba(0,0,0,0.5),-4px_-4px_12px_rgba(255,255,255,0.08)]` 
          : `shadow-[6px_6px_16px_rgba(0,0,0,0.4),-3px_-3px_10px_rgba(255,255,255,0.05)]`
        }
        hover:shadow-[0_0_24px_${colors.glow},10px_10px_24px_rgba(0,0,0,0.5),-5px_-5px_14px_rgba(255,255,255,0.08)]
        hover:scale-105 hover:-translate-y-1
        active:shadow-[inset_3px_3px_8px_rgba(0,0,0,0.3),inset_-2px_-2px_6px_rgba(255,255,255,0.05)]
        active:scale-100
      `}>
        {/* Health indicator */}
        <div className="absolute -top-2 -right-2 z-10">
          {getHealthIndicator()}
        </div>
        
        {/* Depth indicator for nested services */}
        {service.depth > 1 && (
          <div className="absolute -top-2 -left-2 z-10">
            <span className="text-[10px] bg-gray-900/80 text-gray-400 px-1.5 py-0.5 rounded-full border border-gray-700/50">
              L{service.depth}
            </span>
          </div>
        )}
        
        {/* Icon with glow effect */}
        <div className="flex justify-center mb-2">
          <div className={`p-2 rounded-xl bg-gradient-to-br ${colors.bg} backdrop-blur-sm`}>
            <Icon className="w-7 h-7 text-white/90 drop-shadow-[0_2px_4px_rgba(0,0,0,0.3)]" />
          </div>
        </div>
        
        {/* Service name */}
        <div className="text-center">
          <span className="text-sm font-medium text-white/95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            {service.name}
          </span>
        </div>
        
        {/* Port badge */}
        {service.port && (
          <div className="text-center mt-1">
            <span className="text-xs text-white/60 font-mono bg-black/20 px-2 py-0.5 rounded-md">
              :{service.port}
            </span>
          </div>
        )}
        
        {/* Framework badge */}
        {service.framework && (
          <div className="text-center mt-2">
            <span className={`
              text-[10px] font-medium px-2 py-1 rounded-full
              bg-gradient-to-r ${colors.bg}
              border ${colors.border}
              text-white/80 backdrop-blur-sm
            `}>
              {service.framework}
            </span>
          </div>
        )}
        
        {/* Service type indicator */}
        <div className="text-center mt-1.5">
          <span className="text-[9px] uppercase tracking-wider text-white/40">
            {service.type}
          </span>
        </div>
        
        {/* Path on hover */}
        {service.path && service.path !== '.' && (
          <div className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
            <span className="text-[10px] text-gray-500 bg-gray-900/90 px-2 py-1 rounded border border-gray-800">
              {service.path}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const AnimatedConnectionLine = ({ from, to, label, isActive }) => {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const arrowLength = 8;
  
  const nodeRadius = 70;
  const arrowX = to.x - Math.cos(angle) * nodeRadius;
  const arrowY = to.y - Math.sin(angle) * nodeRadius;
  const startX = from.x + Math.cos(angle) * nodeRadius;
  const startY = from.y + Math.sin(angle) * nodeRadius;

  const gradientId = `gradient-${from.x}-${from.y}-${to.x}-${to.y}`.replace(/\./g, '_');

  return (
    <g className="transition-opacity duration-300">
      {/* Gradient definition */}
      <defs>
        <linearGradient id={gradientId} x1={startX} y1={startY} x2={arrowX} y2={arrowY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(59, 130, 246, 0.6)" />
          <stop offset="50%" stopColor="rgba(139, 92, 246, 0.4)" />
          <stop offset="100%" stopColor="rgba(16, 185, 129, 0.6)" />
        </linearGradient>
      </defs>
      
      {/* Glow effect */}
      <line
        x1={startX}
        y1={startY}
        x2={arrowX}
        y2={arrowY}
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.3"
        filter="blur(3px)"
      />
      
      {/* Main line with animation */}
      <line
        x1={startX}
        y1={startY}
        x2={arrowX}
        y2={arrowY}
        stroke={`url(#${gradientId})`}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="8 4"
        className={isActive ? 'animate-dash' : ''}
      />
      
      {/* Arrow head */}
      <polygon
        points={`
          ${arrowX},${arrowY}
          ${arrowX - arrowLength * Math.cos(angle - Math.PI/6)},${arrowY - arrowLength * Math.sin(angle - Math.PI/6)}
          ${arrowX - arrowLength * Math.cos(angle + Math.PI/6)},${arrowY - arrowLength * Math.sin(angle + Math.PI/6)}
        `}
        fill="rgba(139, 92, 246, 0.8)"
        className="drop-shadow-[0_0_3px_rgba(139,92,246,0.5)]"
      />
      
      {/* Label with background */}
      {label && (
        <g>
          <rect
            x={midX - 20}
            y={midY - 10}
            width="40"
            height="16"
            rx="4"
            fill="rgba(17, 24, 39, 0.9)"
            stroke="rgba(75, 85, 99, 0.5)"
            strokeWidth="1"
          />
          <text
            x={midX}
            y={midY + 2}
            textAnchor="middle"
            className="text-[10px] fill-gray-400 font-medium"
          >
            {label}
          </text>
        </g>
      )}
    </g>
  );
};

export default function ServiceTopology({
  services = [],
  connections = [],
  healthStatus = {},
  className = ''
}) {
  const [selectedService, setSelectedService] = useState(null);
  const [zoom, setZoom] = useState(1);
  
  // Dynamic canvas size based on service count
  const canvasSize = useMemo(() => {
    const baseWidth = 700;
    const baseHeight = 500;
    const serviceCount = services.length;
    
    if (serviceCount > 10) {
      return { width: baseWidth + Math.min(serviceCount * 30, 400), height: baseHeight + Math.min(serviceCount * 20, 200) };
    }
    return { width: baseWidth, height: baseHeight };
  }, [services.length]);

  // Calculate positions for services with improved algorithm
  const positions = useMemo(() => {
    const { width, height } = canvasSize;
    const centerX = width / 2;
    const pos = {};
    
    // Group services by type
    const frontends = services.filter(s => s.type === 'frontend' || s.type === 'fullstack');
    const backends = services.filter(s => s.type === 'backend');
    const microservices = services.filter(s => s.type === 'microservice');
    const databases = services.filter(s => s.type === 'database');
    const caches = services.filter(s => s.type === 'cache');
    
    const spacing = 150;
    const topY = 60;
    const middleY = height / 2 - 30;
    const bottomY = height - 80;
    
    // Position frontends at top
    frontends.forEach((s, i) => {
      const totalWidth = frontends.length * spacing;
      const startX = centerX - totalWidth / 2 + spacing / 2;
      pos[s.name] = { x: startX + i * spacing, y: topY };
    });
    
    // Position backends and microservices in middle rows
    const middleServices = [...backends, ...microservices];
    if (middleServices.length > 0) {
      // For many microservices, arrange in a grid
      const cols = Math.min(Math.ceil(Math.sqrt(middleServices.length)), 5);
      const rows = Math.ceil(middleServices.length / cols);
      const gridSpacing = 140;
      const gridWidth = cols * gridSpacing;
      const gridHeight = rows * 90;
      const startX = centerX - gridWidth / 2 + gridSpacing / 2;
      const startY = middleY - gridHeight / 2 + 45;
      
      middleServices.forEach((s, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        pos[s.name] = { 
          x: startX + col * gridSpacing,
          y: startY + row * 90
        };
      });
    }
    
    // Position databases and caches at bottom
    const bottomServices = [...databases, ...caches];
    bottomServices.forEach((s, i) => {
      const totalWidth = bottomServices.length * spacing;
      const startX = centerX - totalWidth / 2 + spacing / 2;
      pos[s.name] = { x: startX + i * spacing, y: bottomY };
    });
    
    return pos;
  }, [services, canvasSize]);
  
  // Auto-generate connections
  const autoConnections = useMemo(() => {
    if (connections.length > 0) return connections;
    
    const auto = [];
    const frontends = services.filter(s => s.type === 'frontend' || s.type === 'fullstack');
    const backends = services.filter(s => s.type === 'backend');
    const microservices = services.filter(s => s.type === 'microservice');
    const databases = services.filter(s => s.type === 'database');
    const caches = services.filter(s => s.type === 'cache');
    
    // Connect frontends to backends/microservices
    frontends.forEach(fe => {
      backends.forEach(be => {
        auto.push({ from: fe.name, to: be.name, label: 'API' });
      });
      // Only connect to first few microservices to avoid clutter
      microservices.slice(0, 3).forEach(ms => {
        auto.push({ from: fe.name, to: ms.name, label: 'API' });
      });
    });
    
    // Connect backends to databases/caches
    backends.forEach(be => {
      databases.forEach(db => {
        auto.push({ from: be.name, to: db.name, label: 'DB' });
      });
      caches.slice(0, 1).forEach(cache => {
        auto.push({ from: be.name, to: cache.name, label: '' });
      });
    });
    
    // Connect microservices to databases (limit connections for clarity)
    microservices.slice(0, 4).forEach(ms => {
      databases.slice(0, 1).forEach(db => {
        auto.push({ from: ms.name, to: db.name, label: '' });
      });
    });
    
    return auto;
  }, [services, connections]);

  if (services.length === 0) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center p-8 rounded-2xl bg-gray-800/30 backdrop-blur-sm border border-gray-700/50">
          <ServerIcon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400 text-sm">No services detected</p>
          <p className="text-gray-500 text-xs mt-1">Analyze a project to see its topology</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative h-full rounded-2xl overflow-hidden ${className}`}>
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_var(--tw-gradient-stops))] from-purple-900/10 via-transparent to-transparent" />
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]" 
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />
      
      {/* Header */}
      <div className="relative z-10 px-4 py-3 border-b border-gray-700/50 backdrop-blur-sm bg-gray-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <CubeTransparentIcon className="w-5 h-5 text-blue-400 mr-2" />
            <span className="text-sm font-medium text-gray-200">Service Topology</span>
            <span className="ml-2 text-xs text-gray-500 bg-gray-800/50 px-2 py-0.5 rounded-full">
              {services.length} services
            </span>
          </div>
          
          {/* Zoom controls */}
          <div className="flex items-center space-x-1">
            <button 
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
              className="p-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors"
            >
              <MagnifyingGlassMinusIcon className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button 
              onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}
              className="p-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors"
            >
              <MagnifyingGlassPlusIcon className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setZoom(1)}
              className="p-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowsPointingOutIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      
      {/* Canvas with zoom */}
      <div 
        className="relative overflow-auto" 
        style={{ height: `calc(100% - 100px)` }}
      >
        <div 
          className="relative transition-transform duration-200 origin-center"
          style={{ 
            width: canvasSize.width, 
            height: canvasSize.height,
            transform: `scale(${zoom})`,
            minWidth: '100%',
            minHeight: '100%'
          }}
        >
          {/* SVG for connection lines */}
          <svg 
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ zIndex: 0 }}
          >
            {autoConnections.map((conn, index) => {
              const fromPos = positions[conn.from];
              const toPos = positions[conn.to];
              if (!fromPos || !toPos) return null;
              
              return (
                <AnimatedConnectionLine
                  key={index}
                  from={fromPos}
                  to={toPos}
                  label={conn.label}
                  isActive={selectedService?.name === conn.from || selectedService?.name === conn.to}
                />
              );
            })}
          </svg>
          
          {/* Service nodes */}
          {services.map((service) => {
            const pos = positions[service.name];
            if (!pos) return null;
            
            return (
              <ServiceNode
                key={service.name}
                service={service}
                position={pos}
                healthStatus={healthStatus[service.name]}
                isSelected={selectedService?.name === service.name}
                onSelect={setSelectedService}
              />
            );
          })}
        </div>
      </div>
      
      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-2 border-t border-gray-700/50 backdrop-blur-md bg-gray-900/60">
        <div className="flex items-center justify-center flex-wrap gap-x-5 gap-y-1 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 mr-1.5 shadow-[0_0_6px_rgba(59,130,246,0.5)]" />
            <span className="text-gray-400">Frontend</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 mr-1.5 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
            <span className="text-gray-400">Backend</span>
          </div>
          {services.some(s => s.type === 'microservice') && (
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-cyan-500 to-cyan-600 mr-1.5 shadow-[0_0_6px_rgba(6,182,212,0.5)]" />
              <span className="text-gray-400">Microservice</span>
            </div>
          )}
          <div className="flex items-center">
            <div className="w-3 h-3 rounded-full bg-gradient-to-br from-purple-500 to-purple-600 mr-1.5 shadow-[0_0_6px_rgba(139,92,246,0.5)]" />
            <span className="text-gray-400">Database</span>
          </div>
          {services.some(s => s.type === 'cache') && (
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 mr-1.5 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
              <span className="text-gray-400">Cache</span>
            </div>
          )}
        </div>
      </div>
      
      {/* CSS for animations */}
      <style>{`
        @keyframes dash {
          to {
            stroke-dashoffset: -24;
          }
        }
        .animate-dash {
          animation: dash 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
