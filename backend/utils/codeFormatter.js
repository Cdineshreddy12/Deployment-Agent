/**
 * Code formatting utilities
 * Ensures code is properly formatted before being sent to frontend
 */

/**
 * Format code string - unescape newlines, tabs, and ensure proper formatting
 */
function formatCodeString(code) {
  if (typeof code !== 'string') {
    return code;
  }

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatCodeString:entry',message:'Formatting code string',data:{hasEscapedNewlines:code.includes('\\n'),hasRealNewlines:code.includes('\n'),length:code.length,first100:code.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  // Unescape common escape sequences
  let formatted = code
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');

  // Remove leading/trailing whitespace but preserve indentation
  formatted = formatted.trim();

  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatCodeString:exit',message:'Code formatted',data:{hasEscapedNewlines:formatted.includes('\\n'),hasRealNewlines:formatted.includes('\n'),length:formatted.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
  // #endregion

  return formatted;
}

/**
 * Format tool call parameters - recursively format code strings
 */
function formatToolCallParams(params) {
  if (!params || typeof params !== 'object') {
    return params;
  }

  const formatted = {};
  
  for (const [key, value] of Object.entries(params)) {
    // Check if this is a code parameter
    const isCodeParam = 
      key.toLowerCase().includes('code') ||
      key.toLowerCase().includes('terraform') ||
      key.toLowerCase().includes('dockerfile') ||
      key.toLowerCase().includes('script') ||
      key.toLowerCase().includes('config') ||
      key.toLowerCase().includes('yaml') ||
      key.toLowerCase().includes('json');

    if (typeof value === 'string') {
      // Format if it's a code parameter OR if it contains code-like patterns
      if (isCodeParam || value.includes('\\n') || (value.includes('\n') && value.length > 50)) {
        formatted[key] = formatCodeString(value);
      } else {
        formatted[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // #region agent log
      if (key === 'body' && value.terraformCode) {
        fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatToolCallParams:recursive',message:'Recursively formatting body object',data:{terraformCodeType:typeof value.terraformCode,terraformCodeHasNewlines:value.terraformCode?.includes('\n'),terraformCodeHasEscapedNewlines:value.terraformCode?.includes('\\n'),terraformCodeLength:value.terraformCode?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      }
      // #endregion
      // Recursively format nested objects (like JSON body parameters)
      if (Array.isArray(value)) {
        formatted[key] = value.map(item => 
          typeof item === 'string' && isCodeParam 
            ? formatCodeString(item) 
            : typeof item === 'object' 
              ? formatToolCallParams(item) 
              : item
        );
      } else {
        // Recursively format nested objects - this handles JSON body parameters
        formatted[key] = formatToolCallParams(value);
      }
      // #region agent log
      if (key === 'body' && formatted[key]?.terraformCode) {
        fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatToolCallParams:after-recursive',message:'After recursive formatting',data:{terraformCodeHasNewlines:formatted[key].terraformCode?.includes('\n'),terraformCodeHasEscapedNewlines:formatted[key].terraformCode?.includes('\\n')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      }
      // #endregion
    } else {
      formatted[key] = value;
    }
  }

  return formatted;
}

/**
 * Format message content - extract and format code in tool calls
 */
function formatMessageContent(content) {
  if (typeof content !== 'string') {
    return content;
  }

  // #region agent log
  const hasTerraform = content.includes('terraform') || content.includes('terraformCode');
  const logData = {location:'codeFormatter.js:formatMessageContent:entry',message:'formatMessageContent called',data:{contentLength:content.length,hasTerraform,hasInvoke:content.includes('<invoke'),first200:content.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'};
  fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(logData)}).catch(()=>{});
  console.log('[DEBUG] formatMessageContent:', logData);
  // #endregion

  // Check if content contains tool calls with parameters
  const invokeRegex = /<invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/invoke>/gi;
  let formattedContent = content;
  const matches = [];
  let match;

  // Collect all matches first
  while ((match = invokeRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      toolName: match[1],
      paramContent: match[2],
      index: match.index
    });
    
    // #region agent log
    const hasTerraformInParams = match[2].includes('terraformCode') || match[2].includes('terraform');
    fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatMessageContent:match-found',message:'Found invoke tag',data:{toolName:match[1],hasTerraformInParams,paramContentLength:match[2].length,paramContentFirst300:match[2].substring(0,300)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
  }

  // Process matches in reverse order to preserve indices
  for (let i = matches.length - 1; i >= 0; i--) {
    const { fullMatch, toolName, paramContent } = matches[i];
    
    // Parse parameters
    const paramRegex = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi;
    const params = {};
    let paramMatch;
    
    while ((paramMatch = paramRegex.exec(paramContent)) !== null) {
      let value = paramMatch[2];
      
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

    // Format parameters
    const formattedParams = formatToolCallParams(params);
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatMessageContent:before-stringify',message:'Before JSON.stringify',data:{hasBody:!!formattedParams.body,bodyType:typeof formattedParams.body,bodyKeys:formattedParams.body?Object.keys(formattedParams.body):null,hasTerraformCode:!!formattedParams.body?.terraformCode,terraformCodeType:typeof formattedParams.body?.terraformCode,terraformCodeHasNewlines:formattedParams.body?.terraformCode?.includes('\n'),terraformCodeHasEscapedNewlines:formattedParams.body?.terraformCode?.includes('\\n')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    // Reconstruct the tool call with formatted parameters
    let formattedToolCall = `<invoke name="${toolName}">\n`;
    for (const [key, value] of Object.entries(formattedParams)) {
      if (typeof value === 'object' && value !== null) {
        // For objects, check if they contain code fields that need special handling
        // We'll stringify with a custom replacer to preserve newlines in code fields
        const jsonString = JSON.stringify(value, (k, v) => {
          // If this is a code field, ensure newlines are preserved
          if (typeof v === 'string' && (
            k?.toLowerCase().includes('code') ||
            k?.toLowerCase().includes('terraform') ||
            k?.toLowerCase().includes('dockerfile') ||
            k?.toLowerCase().includes('script')
          )) {
            // Return the string as-is (JSON.stringify will escape it properly)
            return v;
          }
          return v;
        }, 2);
        
        // #region agent log
        if (key === 'body' && value?.terraformCode) {
          fetch('http://127.0.0.1:7243/ingest/ffc643a4-be02-42e7-bbf2-86db1d489767',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'codeFormatter.js:formatMessageContent:after-stringify',message:'After JSON.stringify',data:{jsonStringLength:jsonString.length,jsonStringHasEscapedNewlines:jsonString.includes('\\n'),jsonStringHasRealNewlines:jsonString.includes('\n'),first200:jsonString.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        }
        // #endregion
        
        formattedToolCall += `<parameter name="${key}">${jsonString}</parameter>\n`;
      } else if (typeof value === 'string' && (value.includes('\n') || value.length > 100)) {
        // For long strings or strings with newlines, preserve formatting
        formattedToolCall += `<parameter name="${key}">${value}</parameter>\n`;
      } else {
        formattedToolCall += `<parameter name="${key}">${value}</parameter>\n`;
      }
    }
    formattedToolCall += `</invoke>`;
    
    // Replace in content (working backwards preserves indices)
    formattedContent = formattedContent.substring(0, matches[i].index) + 
                       formattedToolCall + 
                       formattedContent.substring(matches[i].index + fullMatch.length);
  }

  return formattedContent;
}

module.exports = {
  formatCodeString,
  formatToolCallParams,
  formatMessageContent
};

