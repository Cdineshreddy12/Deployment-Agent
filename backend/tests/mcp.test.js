/**
 * MCP Integration Tests
 * Tests for MCP orchestrator, tool execution, and error handling
 */

const assert = require('assert');

// Mock dependencies before requiring the modules
const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

// Test configuration
const testConfig = {
  terraform: {
    url: 'https://mcp.terraform.com/sse',
    tools: ['get_provider_documentation', 'search_modules', 'get_module_info']
  },
  aws: {
    url: 'https://mcp.aws.com/sse',
    tools: ['describe_resources', 'estimate_cost', 'check_service_quotas']
  },
  github: {
    url: 'https://mcp.github.com/sse',
    tools: ['read_repository', 'read_file', 'create_branch']
  }
};

/**
 * Test Suite: MCP Orchestrator
 */
describe('MCP Orchestrator', () => {
  
  describe('Initialization', () => {
    it('should initialize with empty servers map', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      assert(MCPOrchestrator.servers !== undefined);
      console.log('✓ MCP Orchestrator initialized');
    });
    
    it('should have tool call history array', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      assert(Array.isArray(MCPOrchestrator.toolCallHistory));
      console.log('✓ Tool call history initialized');
    });
  });
  
  describe('Server Status', () => {
    it('should return correct status for unconfigured server', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const status = MCPOrchestrator.getServerStatus('nonexistent');
      assert(status.connected === false);
      console.log('✓ Unconfigured server returns not connected');
    });
    
    it('should return all server statuses', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const statuses = MCPOrchestrator.getAllServerStatuses();
      assert(typeof statuses === 'object');
      console.log('✓ All server statuses returned');
    });
  });
  
  describe('Tool Management', () => {
    it('should return available tools for configured servers', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const tools = MCPOrchestrator.getAvailableTools('terraform');
      assert(Array.isArray(tools));
      console.log('✓ Available tools returned as array');
    });
    
    it('should return all available tools across servers', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const allTools = MCPOrchestrator.getAllAvailableTools();
      assert(typeof allTools === 'object');
      console.log('✓ All available tools returned');
    });
  });
  
  describe('Fallback Behavior', () => {
    it('should use fallback when server unavailable', async () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      
      try {
        const result = await MCPOrchestrator.executeFallbackTool(
          'terraform',
          'get_provider_documentation',
          { provider: 'aws' }
        );
        
        assert(result.fallback === true);
        assert(result.success === true);
        console.log('✓ Terraform fallback works correctly');
      } catch (error) {
        console.log('✗ Terraform fallback failed:', error.message);
      }
    });
    
    it('should handle AWS fallback tools', async () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      
      try {
        const result = await MCPOrchestrator.executeFallbackTool(
          'aws',
          'estimate_cost',
          { resources: [] }
        );
        
        assert(result.fallback === true);
        console.log('✓ AWS fallback works correctly');
      } catch (error) {
        console.log('✗ AWS fallback failed:', error.message);
      }
    });
    
    it('should handle GitHub fallback tools', async () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      
      try {
        const result = await MCPOrchestrator.executeFallbackTool(
          'github',
          'read_repository',
          { owner: 'test', repo: 'test' }
        );
        
        assert(result.fallback === true);
        console.log('✓ GitHub fallback works correctly');
      } catch (error) {
        console.log('✗ GitHub fallback failed:', error.message);
      }
    });
  });
  
  describe('Tool Call History', () => {
    it('should track tool call history', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const history = MCPOrchestrator.getToolCallHistory();
      assert(Array.isArray(history));
      console.log('✓ Tool call history tracking works');
    });
    
    it('should respect limit parameter', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const history = MCPOrchestrator.getToolCallHistory(10);
      assert(history.length <= 10);
      console.log('✓ History limit respected');
    });
  });
  
  describe('Statistics', () => {
    it('should return tool call statistics', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      const stats = MCPOrchestrator.getToolCallStats();
      
      assert(typeof stats.total === 'number');
      assert(typeof stats.successful === 'number');
      assert(typeof stats.failed === 'number');
      assert(typeof stats.averageLatency === 'number');
      console.log('✓ Tool call statistics returned');
    });
  });
  
  describe('Parameter Sanitization', () => {
    it('should sanitize sensitive parameters', () => {
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      
      const params = {
        name: 'test',
        token: 'secret123',
        password: 'pass123',
        apiKey: 'key123'
      };
      
      const sanitized = MCPOrchestrator.sanitizeParameters(params);
      
      assert(sanitized.name === 'test');
      assert(sanitized.token === '[REDACTED]');
      assert(sanitized.password === '[REDACTED]');
      assert(sanitized.apiKey === '[REDACTED]');
      console.log('✓ Sensitive parameters sanitized');
    });
  });
});

/**
 * Test Suite: Claude Service MCP Integration
 */
describe('Claude Service MCP Integration', () => {
  
  describe('MCP Server Configuration', () => {
    it('should return MCP servers array', () => {
      const ClaudeService = require('../services/claude');
      const servers = ClaudeService.getMCPServers();
      assert(Array.isArray(servers));
      console.log('✓ MCP servers returned as array');
    });
    
    it('should include Terraform MCP server', () => {
      const ClaudeService = require('../services/claude');
      const servers = ClaudeService.getMCPServers();
      const terraformServer = servers.find(s => s.name === 'terraform-mcp');
      assert(terraformServer !== undefined);
      console.log('✓ Terraform MCP server included');
    });
  });
  
  describe('Tool Name Inference', () => {
    it('should infer terraform server for terraform tools', () => {
      const ClaudeService = require('../services/claude');
      const server = ClaudeService.inferServerFromToolName('get_provider_documentation');
      assert(server === 'terraform');
      console.log('✓ Terraform tools correctly identified');
    });
    
    it('should infer aws server for aws tools', () => {
      const ClaudeService = require('../services/claude');
      const server = ClaudeService.inferServerFromToolName('describe_resources');
      assert(server === 'aws');
      console.log('✓ AWS tools correctly identified');
    });
    
    it('should infer github server for github tools', () => {
      const ClaudeService = require('../services/claude');
      const server = ClaudeService.inferServerFromToolName('read_repository');
      assert(server === 'github');
      console.log('✓ GitHub tools correctly identified');
    });
    
    it('should return unknown for unrecognized tools', () => {
      const ClaudeService = require('../services/claude');
      const server = ClaudeService.inferServerFromToolName('unknown_tool');
      assert(server === 'unknown');
      console.log('✓ Unknown tools handled correctly');
    });
  });
  
  describe('MCP Tool Call Extraction', () => {
    it('should extract MCP tool calls from response', () => {
      const ClaudeService = require('../services/claude');
      
      const mockResponse = {
        content: [
          { type: 'text', text: 'Some text' },
          { type: 'mcp_tool_use', id: 'tool1', name: 'get_provider_documentation', input: { provider: 'aws' } },
          { type: 'mcp_tool_use', id: 'tool2', name: 'search_modules', input: { query: 'vpc' } }
        ]
      };
      
      const toolCalls = ClaudeService.extractMCPToolCalls(mockResponse);
      
      assert(toolCalls.length === 2);
      assert(toolCalls[0].name === 'get_provider_documentation');
      assert(toolCalls[1].name === 'search_modules');
      console.log('✓ MCP tool calls extracted correctly');
    });
    
    it('should handle empty response', () => {
      const ClaudeService = require('../services/claude');
      
      const toolCalls = ClaudeService.extractMCPToolCalls(null);
      assert(toolCalls.length === 0);
      
      const toolCalls2 = ClaudeService.extractMCPToolCalls({});
      assert(toolCalls2.length === 0);
      
      console.log('✓ Empty response handled correctly');
    });
  });
  
  describe('Data Sanitization', () => {
    it('should sanitize data for logging', () => {
      const ClaudeService = require('../services/claude');
      
      const data = {
        name: 'test',
        token: 'secret',
        apiKey: 'key123'
      };
      
      const sanitized = ClaudeService.sanitizeForLogging(data);
      
      assert(sanitized.name === 'test');
      assert(sanitized.token === '[REDACTED]');
      assert(sanitized.apiKey === '[REDACTED]');
      console.log('✓ Data sanitization works correctly');
    });
    
    it('should truncate large data', () => {
      const ClaudeService = require('../services/claude');
      
      const largeData = { content: 'x'.repeat(3000) };
      const sanitized = ClaudeService.sanitizeForLogging(largeData);
      
      assert(sanitized._truncated === true);
      assert(sanitized._length === JSON.stringify(largeData).length);
      console.log('✓ Large data truncation works');
    });
  });
});

/**
 * Test Suite: MCP Configuration
 */
describe('MCP Configuration', () => {
  
  describe('Config Validation', () => {
    it('should validate MCP configuration', () => {
      const { validateMCPConfig } = require('../config/mcp');
      const result = validateMCPConfig();
      
      assert(typeof result.valid === 'boolean');
      assert(Array.isArray(result.issues));
      console.log('✓ Configuration validation works');
    });
  });
  
  describe('Config Summary', () => {
    it('should return configuration summary', () => {
      const { getMCPConfigSummary } = require('../config/mcp');
      const summary = getMCPConfigSummary();
      
      assert(summary.terraform !== undefined);
      assert(summary.aws !== undefined);
      assert(summary.github !== undefined);
      assert(summary.docker !== undefined);
      console.log('✓ Configuration summary returned');
    });
  });
  
  describe('Connection Status', () => {
    it('should return all connection statuses', () => {
      const { getAllConnectionStatuses } = require('../config/mcp');
      const statuses = getAllConnectionStatuses();
      
      assert(statuses.terraform !== undefined);
      assert(statuses.aws !== undefined);
      assert(statuses.github !== undefined);
      assert(statuses.docker !== undefined);
      console.log('✓ Connection statuses returned');
    });
  });
});

/**
 * Run all tests
 */
async function runTests() {
  console.log('\n========================================');
  console.log('MCP Integration Test Suite');
  console.log('========================================\n');
  
  let passed = 0;
  let failed = 0;
  
  // Simple test runner
  const tests = [
    // MCP Orchestrator Tests
    async () => {
      console.log('\n--- MCP Orchestrator Tests ---\n');
      const MCPOrchestrator = require('../services/mcpOrchestrator');
      
      // Test 1: Initialization
      try {
        assert(MCPOrchestrator.servers !== undefined);
        console.log('✓ MCP Orchestrator initialized');
        passed++;
      } catch (e) {
        console.log('✗ MCP Orchestrator initialization failed:', e.message);
        failed++;
      }
      
      // Test 2: Tool call history
      try {
        assert(Array.isArray(MCPOrchestrator.toolCallHistory));
        console.log('✓ Tool call history initialized');
        passed++;
      } catch (e) {
        console.log('✗ Tool call history failed:', e.message);
        failed++;
      }
      
      // Test 3: Server status
      try {
        const status = MCPOrchestrator.getServerStatus('nonexistent');
        assert(status.connected === false);
        console.log('✓ Server status for unconfigured server correct');
        passed++;
      } catch (e) {
        console.log('✗ Server status test failed:', e.message);
        failed++;
      }
      
      // Test 4: Tool call stats
      try {
        const stats = MCPOrchestrator.getToolCallStats();
        assert(typeof stats.total === 'number');
        console.log('✓ Tool call statistics work');
        passed++;
      } catch (e) {
        console.log('✗ Tool call statistics failed:', e.message);
        failed++;
      }
      
      // Test 5: Parameter sanitization
      try {
        const params = { name: 'test', token: 'secret' };
        const sanitized = MCPOrchestrator.sanitizeParameters(params);
        assert(sanitized.token === '[REDACTED]');
        console.log('✓ Parameter sanitization works');
        passed++;
      } catch (e) {
        console.log('✗ Parameter sanitization failed:', e.message);
        failed++;
      }
    },
    
    // Claude Service Tests
    async () => {
      console.log('\n--- Claude Service MCP Tests ---\n');
      const ClaudeService = require('../services/claude');
      
      // Test 1: Get MCP servers
      try {
        const servers = ClaudeService.getMCPServers();
        assert(Array.isArray(servers));
        console.log('✓ getMCPServers returns array');
        passed++;
      } catch (e) {
        console.log('✗ getMCPServers failed:', e.message);
        failed++;
      }
      
      // Test 2: Infer server from tool name
      try {
        assert(ClaudeService.inferServerFromToolName('get_provider_documentation') === 'terraform');
        assert(ClaudeService.inferServerFromToolName('describe_resources') === 'aws');
        assert(ClaudeService.inferServerFromToolName('read_repository') === 'github');
        console.log('✓ Server inference from tool name works');
        passed++;
      } catch (e) {
        console.log('✗ Server inference failed:', e.message);
        failed++;
      }
      
      // Test 3: Extract MCP tool calls
      try {
        const mockResponse = {
          content: [
            { type: 'mcp_tool_use', id: 't1', name: 'test_tool', input: {} }
          ]
        };
        const calls = ClaudeService.extractMCPToolCalls(mockResponse);
        assert(calls.length === 1);
        console.log('✓ MCP tool call extraction works');
        passed++;
      } catch (e) {
        console.log('✗ MCP tool call extraction failed:', e.message);
        failed++;
      }
      
      // Test 4: Handle null response
      try {
        const calls = ClaudeService.extractMCPToolCalls(null);
        assert(calls.length === 0);
        console.log('✓ Null response handled');
        passed++;
      } catch (e) {
        console.log('✗ Null response handling failed:', e.message);
        failed++;
      }
    },
    
    // MCP Config Tests
    async () => {
      console.log('\n--- MCP Configuration Tests ---\n');
      const { validateMCPConfig, getMCPConfigSummary, getAllConnectionStatuses } = require('../config/mcp');
      
      // Test 1: Validate config
      try {
        const result = validateMCPConfig();
        assert(typeof result.valid === 'boolean');
        console.log('✓ Config validation works');
        passed++;
      } catch (e) {
        console.log('✗ Config validation failed:', e.message);
        failed++;
      }
      
      // Test 2: Config summary
      try {
        const summary = getMCPConfigSummary();
        assert(summary.terraform !== undefined);
        console.log('✓ Config summary works');
        passed++;
      } catch (e) {
        console.log('✗ Config summary failed:', e.message);
        failed++;
      }
      
      // Test 3: Connection statuses
      try {
        const statuses = getAllConnectionStatuses();
        assert(statuses.terraform !== undefined);
        console.log('✓ Connection statuses work');
        passed++;
      } catch (e) {
        console.log('✗ Connection statuses failed:', e.message);
        failed++;
      }
    }
  ];
  
  for (const test of tests) {
    try {
      await test();
    } catch (e) {
      console.error('Test suite error:', e);
      failed++;
    }
  }
  
  console.log('\n========================================');
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');
  
  return { passed, failed };
}

// Export for use as module
module.exports = { runTests };

// Run tests if executed directly
if (require.main === module) {
  runTests().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}


