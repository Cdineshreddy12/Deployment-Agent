import React, { useState, useEffect } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';
import {
  XMarkIcon,
  DocumentDuplicateIcon,
  CheckIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  CodeBracketIcon
} from '@heroicons/react/24/outline';

/**
 * FileContentViewer - Modal/drawer for viewing file contents with syntax highlighting
 */

// Language detection helper
const getLanguageFromPath = (filePath) => {
  if (!filePath) return 'text';
  
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap = {
    'js': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'yml': 'yaml',
    'yaml': 'yaml',
    'md': 'markdown',
    'py': 'python',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'tf': 'hcl',
    'hcl': 'hcl',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'html': 'htmlbars',
    'htm': 'htmlbars',
    'xml': 'xml',
    'svg': 'xml',
    'sql': 'sql',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'kt': 'kotlin',
    'rb': 'ruby',
    'php': 'php',
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'hpp': 'cpp',
    'cs': 'csharp',
    'swift': 'swift',
    'r': 'r',
    'lua': 'lua',
    'perl': 'perl',
    'env': 'bash',
    'gitignore': 'bash',
    'dockerignore': 'bash',
    'makefile': 'makefile',
    'toml': 'ini',
    'ini': 'ini',
    'conf': 'nginx',
    'nginx': 'nginx',
    'proto': 'protobuf'
  };
  
  // Handle special filenames
  const filename = filePath.split('/').pop()?.toLowerCase() || '';
  if (filename === 'dockerfile' || filename.startsWith('dockerfile.')) return 'dockerfile';
  if (filename === 'makefile') return 'makefile';
  if (filename.startsWith('.env')) return 'bash';
  if (filename === 'gemfile') return 'ruby';
  if (filename === 'rakefile') return 'ruby';
  if (filename === 'vagrantfile') return 'ruby';
  
  return langMap[ext] || 'text';
};

// File icon based on type
const getFileIcon = (filePath) => {
  const lang = getLanguageFromPath(filePath);
  const codeTypes = ['javascript', 'typescript', 'python', 'go', 'rust', 'java', 'ruby', 'php', 'c', 'cpp'];
  
  if (codeTypes.includes(lang)) {
    return <CodeBracketIcon className="w-5 h-5 text-blue-400" />;
  }
  return <DocumentTextIcon className="w-5 h-5 text-gray-400" />;
};

export default function FileContentViewer({
  isOpen,
  onClose,
  filePath,
  content,
  loading = false,
  error = null,
  isGenerated = false,
  onRefresh
}) {
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(false);

  // Reset copied state when content changes
  useEffect(() => {
    setCopied(false);
  }, [content]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const language = getLanguageFromPath(filePath);
  const fileName = filePath?.split('/').pop() || 'File';
  const lineCount = content?.split('\n').length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between bg-gray-800/50 flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            {getFileIcon(filePath)}
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-white truncate">{fileName}</span>
                {isGenerated && (
                  <span className="px-2 py-0.5 text-xs bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30">
                    Generated
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2 text-xs text-gray-500">
                <span>{filePath}</span>
                <span>•</span>
                <span>{language}</span>
                <span>•</span>
                <span>{lineCount} lines</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 flex-shrink-0">
            {/* Toggle options */}
            <button
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                showLineNumbers
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
              title="Toggle line numbers"
            >
              #
            </button>
            <button
              onClick={() => setWrapLines(!wrapLines)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                wrapLines
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'bg-gray-700 text-gray-400 hover:text-white'
              }`}
              title="Toggle line wrap"
            >
              ↩
            </button>
            
            {/* Refresh button */}
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={loading}
                className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
                title="Refresh"
              >
                <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            
            {/* Copy button */}
            <button
              onClick={handleCopy}
              disabled={!content}
              className="flex items-center px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-4 h-4 mr-1.5 text-green-400" />
                  <span className="text-green-400">Copied</span>
                </>
              ) : (
                <>
                  <DocumentDuplicateIcon className="w-4 h-4 mr-1.5" />
                  Copy
                </>
              )}
            </button>
            
            {/* Close button */}
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <ArrowPathIcon className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-64 text-red-400">
              <div className="text-center">
                <p className="text-sm font-medium">Failed to load file</p>
                <p className="text-xs mt-1 text-gray-500">{error}</p>
              </div>
            </div>
          ) : content ? (
            <SyntaxHighlighter
              language={language}
              style={atomOneDark}
              showLineNumbers={showLineNumbers}
              wrapLines={wrapLines}
              wrapLongLines={wrapLines}
              customStyle={{
                margin: 0,
                padding: '1rem',
                background: 'transparent',
                fontSize: '0.875rem',
                lineHeight: '1.5'
              }}
              lineNumberStyle={{
                minWidth: '3em',
                paddingRight: '1em',
                color: '#4b5563',
                userSelect: 'none'
              }}
            >
              {content}
            </SyntaxHighlighter>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              <p className="text-sm">No content to display</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

