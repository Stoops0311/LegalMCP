# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LegalMCP is a Model Context Protocol (MCP) server built using the Smithery scaffold. It's a TypeScript-based MCP server that provides tools for LLMs to interact with.

## Architecture

- **Framework**: Smithery CLI for MCP development
- **SDK**: @modelcontextprotocol/sdk for MCP server implementation
- **Validation**: Zod for schema validation
- **Entry Point**: `src/index.ts` - Exports a stateless MCP server factory function

## Development Commands

```bash
# Start development server
npm run dev

# Install dependencies
npm install
```

## Core Implementation Pattern

The server follows the Smithery scaffold pattern:
1. Define config schema using Zod
2. Export default function that creates a stateless server
3. Use `McpServer` class to define tools and capabilities
4. Tools are defined with: name, description, input schema, and handler function

## Adding New Tools

Tools are added using the `server.tool()` method in `src/index.ts`:

```typescript
server.tool(
  "toolName",
  "Tool description",
  { 
    // Zod schema for input parameters
    paramName: z.string().describe("Parameter description"),
  },
  async ({ paramName }) => {
    // Tool implementation
    return {
      content: [{ type: "text", text: "Response" }],
    };
  }
);
```

## MCP Response Format

All tool responses must follow the MCP content format:
```typescript
{
  content: [{ type: "text", text: "Your response here" }]
}
```

## Configuration

Server configuration is defined through the `configSchema` export and passed when creating the server instance. The scaffold includes a `debug` flag by default.

## Smithery Documentation References

When working with MCP servers, consult these documentation files in `docs/smithery/`:

### Core Development Workflow
1. **Getting Started** (`getting-started.md`) - First read for MCP concepts and benefits
2. **Project Configuration** (`project-config.md`) - Setting up Dockerfile and smithery.yaml
3. **Development** - Use `npm run dev` for local testing with Smithery CLI

### Deployment & Hosting
- **Deployments** (`deployments.md`) - When ready to deploy (TypeScript vs Container runtime)
- **smithery.yaml Reference** (`smithery-yaml.md`) - Configuring build and runtime settings
- **Permissions** (`permissions.md`) - GitHub integration setup

### Runtime Configuration
- **Session Configuration** (`session-config.md`) - When users need API keys or custom settings

## MCP Development Guidelines

### When to Check Documentation
- **Planning Phase**: Read `getting-started.md` for architecture decisions
- **Setup Issues**: Check `project-config.md` for Dockerfile/yaml problems  
- **Deployment Errors**: Reference `deployments.md` and `smithery-yaml.md`
- **User Configuration**: Implement session configs per `session-config.md`
- **GitHub Integration**: Use `permissions.md` for CI/CD setup

### Critical MCP Rules
1. **Stateless Design**: All tools must be stateless - no shared state between calls
2. **Error Handling**: Always return proper MCP content format, even for errors
3. **Schema Validation**: Use Zod for all input validation before processing
4. **Security**: Never log or expose user configuration (API keys, secrets)
5. **Tool Discovery**: Implement lazy loading - list tools without requiring auth

### MCP Response Patterns
```typescript
// Success response
{ content: [{ type: "text", text: "Result data" }] }

// Error response  
{ content: [{ type: "text", text: "Error: Description of what went wrong" }] }

// Multiple content blocks
{ content: [
  { type: "text", text: "Description" },
  { type: "text", text: JSON.stringify(data) }
]}
```

### Configuration Handling
- Parse base64 config from query params: `?config=eyJ...`
- Always provide defaults for optional configuration
- Use JSON Schema in smithery.yaml for validation
- Test with example configurations before deployment

### Testing Strategy
1. **Local Development**: Use `npm run dev` with Smithery CLI
2. **MCP Inspector**: Test protocol compliance before deployment
3. **Configuration Testing**: Verify all config schemas work correctly
4. **Tool Validation**: Test each tool independently and in combination

### Performance Considerations
- Minimize tool execution time (< 30 seconds)
- Handle large responses appropriately (pagination, streaming)
- Cache expensive operations when possible (respecting stateless requirement)
- Validate inputs early to fail fast

### Deployment Checklist
- [ ] Dockerfile builds successfully locally
- [ ] smithery.yaml is properly configured
- [ ] All tools work with MCP Inspector
- [ ] Configuration schema is complete and tested
- [ ] Error handling covers edge cases
- [ ] Security review completed (no exposed secrets)