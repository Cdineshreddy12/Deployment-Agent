const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

/**
 * AI Code Generator Service
 * Uses Claude AI to dynamically generate connection test code, credential schemas, etc.
 * No hardcoding - everything is AI-generated based on service type
 */
class AICodeGenerator {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.CLAUDE_API_KEY
    });
  }

  /**
   * Generate connection test code for any service dynamically
   */
  async generateConnectionTestCode(serviceType, serviceDescription, credentialSchema) {
    try {
      const prompt = `You are an expert DevOps engineer. Generate a JavaScript function to test connection to a ${serviceType} service.

Service Description: ${serviceDescription || 'No description provided'}

Credential Schema:
${JSON.stringify(credentialSchema, null, 2)}

Requirements:
1. Create a JavaScript async function named "testConnection" that takes credentials object as parameter
2. The function should return: { success: boolean, message: string, details?: object }
3. Handle errors gracefully
4. Use appropriate libraries (require them at the top)
5. Test actual connectivity, not just credential format
6. Include timeout handling (5 seconds max)
7. Return detailed error messages if connection fails

Generate ONLY the JavaScript code, no explanations. The code should be ready to execute in a Node.js sandbox environment.`;

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const code = this.extractCode(response.content[0].text);
      
      logger.info(`Generated connection test code for ${serviceType}`);
      
      return {
        success: true,
        code,
        language: 'javascript'
      };
    } catch (error) {
      logger.error('Failed to generate connection test code:', error);
      throw error;
    }
  }

  /**
   * Generate credential schema for a service type dynamically
   */
  async generateCredentialSchema(serviceType, serviceDescription) {
    try {
      const prompt = `You are an expert DevOps engineer. Generate a credential schema for connecting to ${serviceType}.

Service Description: ${serviceDescription || 'No description provided'}

Generate a JSON schema object that defines:
1. All required credential fields
2. Field types (string, number, boolean, object, array)
3. Field descriptions
4. Whether each field is required or optional
5. Default values if applicable
6. Validation rules if applicable

Format:
{
  "fieldName": {
    "type": "string|number|boolean|object|array",
    "required": true|false,
    "description": "Human-readable description",
    "default": "default value if optional",
    "validation": "regex pattern or validation rule"
  }
}

Generate ONLY valid JSON, no explanations.`;

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const schemaText = this.extractJSON(response.content[0].text);
      const schema = JSON.parse(schemaText);
      
      logger.info(`Generated credential schema for ${serviceType}`);
      
      return {
        success: true,
        schema
      };
    } catch (error) {
      logger.error('Failed to generate credential schema:', error);
      throw error;
    }
  }

  /**
   * Generate Terraform provider configuration dynamically
   */
  async generateTerraformProviderConfig(serviceType, credentials) {
    try {
      const prompt = `You are an expert Terraform engineer. Generate Terraform provider configuration for ${serviceType}.

Credentials provided:
${JSON.stringify(credentials, null, 2)}

Requirements:
1. Identify the correct Terraform provider name
2. Generate the provider "provider" block
3. Include all necessary configuration from credentials
4. Use proper Terraform syntax
5. Include variable references if credentials should be variables
6. Follow Terraform best practices

Generate ONLY the Terraform HCL code, no explanations.`;

      const response = await this.client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const code = this.extractCode(response.content[0].text);
      
      logger.info(`Generated Terraform provider config for ${serviceType}`);
      
      return {
        success: true,
        providerCode: code
      };
    } catch (error) {
      logger.error('Failed to generate Terraform provider config:', error);
      throw error;
    }
  }

  /**
   * Extract code blocks from AI response
   */
  extractCode(text) {
    // Extract code from markdown code blocks
    const codeBlockRegex = /```(?:javascript|js|typescript|ts)?\n?([\s\S]*?)```/g;
    const matches = [...text.matchAll(codeBlockRegex)];
    
    if (matches.length > 0) {
      return matches[0][1].trim();
    }
    
    // If no code blocks, return the text as-is (might be plain code)
    return text.trim();
  }

  /**
   * Extract JSON from AI response
   */
  extractJSON(text) {
    // Try to find JSON code block
    const jsonBlockRegex = /```(?:json)?\n?([\s\S]*?)```/g;
    const matches = [...text.matchAll(jsonBlockRegex)];
    
    if (matches.length > 0) {
      return matches[0][1].trim();
    }
    
    // Try to find JSON object in text
    const jsonRegex = /\{[\s\S]*\}/;
    const jsonMatch = text.match(jsonRegex);
    
    if (jsonMatch) {
      return jsonMatch[0];
    }
    
    throw new Error('No JSON found in AI response');
  }
}

module.exports = new AICodeGenerator();

