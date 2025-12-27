/**
 * Parse incomplete invoke tags (when the closing tag is missing)
 * This handles cases where the AI response is truncated
 */
function parseIncompleteInvoke(content) {
  // Look for incomplete invoke tags that start but don't close
  const incompleteInvokeMatch = content.match(/<invoke\s+name="([^"]+)"\s*>([\s\S]*)$/);
  if (!incompleteInvokeMatch) return null;

  const toolName = incompleteInvokeMatch[1];
  const paramContent = incompleteInvokeMatch[2];
  const params = {};

  // Parse any complete parameters within the incomplete invoke
  const paramRegex = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi;
  let paramMatch;
  let lastParamEnd = 0;

  while ((paramMatch = paramRegex.exec(paramContent)) !== null) {
    let value = paramMatch[2];
    try {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        value = JSON.parse(trimmed);
      }
    } catch (e) {
      // Keep as string if not valid JSON
    }
    params[paramMatch[1]] = value;
    lastParamEnd = paramMatch.index + paramMatch[0].length;
  }

  // Check for incomplete parameter at the end
  const remainingContent = paramContent.slice(lastParamEnd);
  const incompleteParamMatch = remainingContent.match(/<parameter\s+name="([^"]+)"\s*>([\s\S]*)$/);
  if (incompleteParamMatch) {
    let value = incompleteParamMatch[2];
    // Try to parse as JSON if it looks like JSON
    try {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && 
          (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
        value = JSON.parse(trimmed);
      }
    } catch (e) {
      // Keep as string
    }
    params[incompleteParamMatch[1]] = value;
    params._incomplete = true;
  }

  return {
    type: 'tool_call',
    name: toolName,
    params: params,
    incomplete: true,
    startIndex: incompleteInvokeMatch.index
  };
}

export function parseMessageContent(content) {
  if (!content) return [];
  
  const parts = [];
  // Updated regex to be more permissive with whitespace and catch XML tags more reliably
  // Using [\s\S] to match newlines within the tag
  const invokeRegex = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/gi;
  let lastIndex = 0;
  let match;

  while ((match = invokeRegex.exec(content)) !== null) {
    // Add preceding text
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      if (textContent.trim()) { // Only add non-empty text blocks
        parts.push({
          type: 'text',
          content: textContent
        });
      }
    }

    // Parse parameters
    const toolName = match[1];
    const paramContent = match[2];
    const params = {};
    // Regex for parameters - also permissive with whitespace
    const paramRegex = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi;
    let paramMatch;
    
    while ((paramMatch = paramRegex.exec(paramContent)) !== null) {
      let value = paramMatch[2];
      // Clean up common XML entities/spacing if needed, but usually keep raw
      // Try to parse JSON values
      try {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          value = JSON.parse(trimmed);
        }
      } catch (e) {
        // Keep as string if not valid JSON
      }
      params[paramMatch[1]] = value;
    }

    parts.push({
      type: 'tool_call',
      name: toolName,
      params: params,
      raw: match[0]
    });

    lastIndex = invokeRegex.lastIndex;
  }

  // Check for incomplete invoke tags in remaining content
  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex);
    
    // Check if there's an incomplete invoke tag
    const incompleteInvoke = parseIncompleteInvoke(remainingContent);
    
    if (incompleteInvoke) {
      // Add any text before the incomplete invoke
      const textBeforeIncomplete = remainingContent.slice(0, incompleteInvoke.startIndex);
      if (textBeforeIncomplete.trim()) {
        parts.push({
          type: 'text',
          content: textBeforeIncomplete
        });
      }
      // Add the incomplete invoke as a tool call (marked as incomplete)
      parts.push({
        type: 'tool_call',
        name: incompleteInvoke.name,
        params: incompleteInvoke.params,
        incomplete: true
      });
    } else if (remainingContent.trim()) {
      // No incomplete invoke, just add remaining text
      parts.push({
        type: 'text',
        content: remainingContent
      });
    }
  }

  return parts;
}

