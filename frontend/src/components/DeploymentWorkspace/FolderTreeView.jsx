import React, { useState, useMemo } from 'react';
import {
  FolderIcon,
  FolderOpenIcon,
  DocumentIcon,
  DocumentTextIcon,
  CodeBracketIcon,
  Cog6ToothIcon,
  SparklesIcon,
  ChevronRightIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';

/**
 * FolderTreeView - Interactive file browser with generated file badges
 */

const FileIcon = ({ name, extension }) => {
  // Map extensions to icons
  const iconMap = {
    js: CodeBracketIcon,
    jsx: CodeBracketIcon,
    ts: CodeBracketIcon,
    tsx: CodeBracketIcon,
    py: CodeBracketIcon,
    go: CodeBracketIcon,
    java: CodeBracketIcon,
    json: Cog6ToothIcon,
    yml: Cog6ToothIcon,
    yaml: Cog6ToothIcon,
    toml: Cog6ToothIcon,
    md: DocumentTextIcon,
    txt: DocumentTextIcon,
    env: Cog6ToothIcon,
    dockerfile: Cog6ToothIcon
  };

  // Check for special files
  if (name.toLowerCase() === 'dockerfile') {
    return <Cog6ToothIcon className="w-4 h-4 text-blue-400" />;
  }
  if (name.toLowerCase().includes('docker-compose')) {
    return <Cog6ToothIcon className="w-4 h-4 text-blue-400" />;
  }
  if (name.startsWith('.env')) {
    return <Cog6ToothIcon className="w-4 h-4 text-yellow-400" />;
  }

  const Icon = iconMap[extension?.toLowerCase()] || DocumentIcon;
  const colorClass = extension?.match(/^(js|jsx|ts|tsx)$/) 
    ? 'text-yellow-400' 
    : extension?.match(/^(py)$/)
    ? 'text-blue-400'
    : extension?.match(/^(go)$/)
    ? 'text-cyan-400'
    : 'text-gray-400';

  return <Icon className={`w-4 h-4 ${colorClass}`} />;
};

const TreeNode = ({ 
  name, 
  node, 
  path = '', 
  depth = 0, 
  onFileClick, 
  expandedPaths, 
  onToggle,
  generatedPaths = new Set()
}) => {
  const fullPath = path ? `${path}/${name}` : name;
  const isExpanded = expandedPaths.has(fullPath);
  const isGenerated = generatedPaths.has(fullPath);

  if (node._type === 'directory') {
    const children = Object.entries(node._children || {}).sort(([aName, aNode], [bName, bNode]) => {
      // Directories first, then files
      const aIsDir = aNode._type === 'directory';
      const bIsDir = bNode._type === 'directory';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return aName.localeCompare(bName);
    });

    return (
      <div>
        <div
          className="flex items-center py-1 px-2 hover:bg-gray-700/50 rounded cursor-pointer group"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onToggle(fullPath)}
        >
          {isExpanded ? (
            <ChevronDownIcon className="w-3 h-3 text-gray-500 mr-1" />
          ) : (
            <ChevronRightIcon className="w-3 h-3 text-gray-500 mr-1" />
          )}
          {isExpanded ? (
            <FolderOpenIcon className="w-4 h-4 text-amber-400 mr-2" />
          ) : (
            <FolderIcon className="w-4 h-4 text-amber-400 mr-2" />
          )}
          <span className="text-sm text-gray-300 truncate">{name}</span>
        </div>
        
        {isExpanded && (
          <div>
            {children.map(([childName, childNode]) => (
              <TreeNode
                key={childName}
                name={childName}
                node={childNode}
                path={fullPath}
                depth={depth + 1}
                onFileClick={onFileClick}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                generatedPaths={generatedPaths}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File node
  return (
    <div
      className="flex items-center py-1 px-2 hover:bg-gray-700/50 rounded cursor-pointer group"
      style={{ paddingLeft: `${depth * 16 + 24}px` }}
      onClick={() => onFileClick?.(fullPath, node)}
    >
      <FileIcon name={name} extension={node.extension} />
      <span className="text-sm text-gray-300 ml-2 truncate flex-1">{name}</span>
      
      {isGenerated && (
        <span className="flex items-center text-xs bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded ml-2">
          <SparklesIcon className="w-3 h-3 mr-0.5" />
          Generated
        </span>
      )}
      
      {node.size && (
        <span className="text-xs text-gray-500 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {formatFileSize(node.size)}
        </span>
      )}
    </div>
  );
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function FolderTreeView({ 
  projectPath,
  files = [],
  tree = {},
  generatedFiles = [],
  onFileClick,
  className = ''
}) {
  const [expandedPaths, setExpandedPaths] = useState(new Set(['']));
  const [searchQuery, setSearchQuery] = useState('');

  // Create set of generated file paths for quick lookup
  const generatedPaths = useMemo(() => {
    return new Set(generatedFiles.map(f => f.path || f));
  }, [generatedFiles]);

  const handleToggle = (path) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allPaths = new Set(['']);
    const collectPaths = (node, path = '') => {
      if (node._type === 'directory' && node._children) {
        Object.entries(node._children).forEach(([name, child]) => {
          const childPath = path ? `${path}/${name}` : name;
          if (child._type === 'directory') {
            allPaths.add(childPath);
            collectPaths(child, childPath);
          }
        });
      }
    };
    Object.entries(tree).forEach(([name, node]) => {
      if (node._type === 'directory') {
        allPaths.add(name);
        collectPaths(node, name);
      }
    });
    setExpandedPaths(allPaths);
  };

  const collapseAll = () => {
    setExpandedPaths(new Set(['']));
  };

  // Filter files based on search
  const filteredTree = useMemo(() => {
    if (!searchQuery) return tree;
    
    // For now, just return tree - search filtering can be added later
    return tree;
  }, [tree, searchQuery]);

  const rootEntries = Object.entries(filteredTree).sort(([aName, aNode], [bName, bNode]) => {
    const aIsDir = aNode._type === 'directory';
    const bIsDir = bNode._type === 'directory';
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return aName.localeCompare(bName);
  });

  return (
    <div className={`flex flex-col h-full bg-gray-800/50 rounded-lg border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center">
          <FolderIcon className="w-4 h-4 text-amber-400 mr-2" />
          <span className="text-sm font-medium text-gray-200">Project Files</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={expandAll}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Expand
          </button>
          <span className="text-gray-600">|</span>
          <button
            onClick={collapseAll}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Project path */}
      {projectPath && (
        <div className="px-3 py-1.5 bg-gray-900/50 border-b border-gray-700">
          <span className="text-xs text-gray-500 font-mono truncate block">
            {projectPath}
          </span>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 border-b border-gray-700">
        <input
          type="text"
          placeholder="Search files..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-gray-900/50 border border-gray-600 rounded px-2 py-1 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {rootEntries.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            No files to display
          </div>
        ) : (
          rootEntries.map(([name, node]) => (
            <TreeNode
              key={name}
              name={name}
              node={node}
              depth={0}
              onFileClick={onFileClick}
              expandedPaths={expandedPaths}
              onToggle={handleToggle}
              generatedPaths={generatedPaths}
            />
          ))
        )}
      </div>

      {/* Footer stats */}
      <div className="px-3 py-2 border-t border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{files.length} files</span>
          {generatedFiles.length > 0 && (
            <span className="flex items-center text-emerald-400">
              <SparklesIcon className="w-3 h-3 mr-1" />
              {generatedFiles.length} generated
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


