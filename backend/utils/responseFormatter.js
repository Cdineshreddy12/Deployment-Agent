/**
 * Response Formatter Utility
 * Formats Claude responses before sending to frontend
 */

/**
 * Format markdown content
 */
function formatMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Clean up markdown
  // Remove excessive blank lines
  content = content.replace(/\n{3,}/g, '\n\n');
  
  // Ensure code blocks are properly formatted
  content = content.replace(/```(\w+)?\n?/g, '```$1\n');
  
  return content.trim();
}

/**
 * Format code blocks
 */
function formatCodeBlocks(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Ensure code blocks have proper closing tags
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let formatted = content;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1] || '';
    const code = match[2].trim();
    const formattedBlock = `\`\`\`${lang}\n${code}\n\`\`\``;
    formatted = formatted.replace(match[0], formattedBlock);
  }
  
  return formatted;
}

/**
 * Format lists
 */
function formatLists(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Ensure list items are properly formatted
  // Fix inconsistent list markers
  content = content.replace(/^[\*\-\+]\s+/gm, '- ');
  
  // Ensure proper spacing between list items
  content = content.replace(/\n([\*\-\+])\s+/g, '\n$1 ');
  
  return content;
}

/**
 * Auto-detect and format content
 */
function detectAndFormat(content) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  let formatted = content;
  
  // Format markdown
  formatted = formatMarkdown(formatted);
  
  // Format code blocks
  formatted = formatCodeBlocks(formatted);
  
  // Format lists
  formatted = formatLists(formatted);
  
  return formatted;
}

/**
 * Extract and structure response components
 */
function structureResponse(content) {
  if (!content || typeof content !== 'string') {
    return {
      text: '',
      codeBlocks: [],
      lists: [],
      hasCode: false,
      hasLists: false
    };
  }

  const codeBlocks = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    codeBlocks.push({
      language: match[1] || 'text',
      code: match[2].trim()
    });
  }
  
  const lists = [];
  const listRegex = /^[\*\-\+]\s+(.+)$/gm;
  while ((match = listRegex.exec(content)) !== null) {
    lists.push(match[1].trim());
  }
  
  return {
    text: content,
    codeBlocks,
    lists,
    hasCode: codeBlocks.length > 0,
    hasLists: lists.length > 0,
    formatted: detectAndFormat(content)
  };
}

module.exports = {
  formatMarkdown,
  formatCodeBlocks,
  formatLists,
  detectAndFormat,
  structureResponse
};


