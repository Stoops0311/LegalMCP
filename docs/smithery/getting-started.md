# Building MCPs with Smithery

This guide covers how to build Model Context Protocol (MCP) servers using Smithery's development platform and hosting services.

## Overview

Smithery supports developers building MCPs by providing CI/CD deployments and hosting capabilities. This enables rapid development and deployment of MCP servers that can be used by LLM applications.

## Benefits of Hosting on Smithery

- **Tool Playground**: Smithery shows a tool playground on your server page, allowing users to discover and try your MCP online
- **No Installation Required**: Users can call your server without installing dependencies or security concerns
- **Enhanced Discovery**: Smithery ranks hosted servers higher in search results
- **Developer SDK**: Provides an SDK to make it easier to deploy servers on Smithery

## Getting Started Options

### New to Building MCPs?

If you're new to building MCP servers, start with the comprehensive TypeScript guide:

- **TypeScript Getting Started Guide** - Complete walkthrough for TypeScript developers using the Smithery CLI `dev` and `build` commands

### Deployment Methods

Choose the appropriate deployment method for your project:

1. **TypeScript Deploy** - Use this if you're building with TypeScript using the Smithery CLI
2. **Custom Deploy** - Use this if you're using another language or need full control over your Docker container

## Key Resources

- **Deployments** - Learn about hosting your MCP servers
- **Project Configuration** - Advanced configuration options  
- **Permissions** - Understanding MCP permissions and GitHub integration
- **Session Configuration** - How to handle user-specific configurations

## Architecture Concepts

MCP servers built with Smithery follow these patterns:

- **Stateless Design**: Servers are designed to be stateless for scalability
- **Tool-based Interface**: Functionality is exposed through well-defined tools
- **Configuration-driven**: Runtime behavior controlled through session configurations
- **HTTP Transport**: Uses Streamable HTTP for communication

## Next Steps

1. Review the [Deployments Guide](./deployments.md) to understand deployment options
2. Set up your [Project Configuration](./project-config.md)
3. Learn about [Session Configuration](./session-config.md) for user customization
4. Understand [GitHub Permissions](./permissions.md) for integration