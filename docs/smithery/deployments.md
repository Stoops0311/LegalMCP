# Deployments

Learn how to deploy your MCP server on Smithery using hosted deployment options.

## Overview

Smithery Deployments allow you to host your MCP server on Smithery served over [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) connection.

## Deployment Methods

### TypeScript Deploy

The fastest way to deploy TypeScript MCP servers on Smithery. This method automatically builds and deploys your server using the TypeScript runtime.

#### Prerequisites

- TypeScript MCP server
- Built with the [Smithery CLI](https://github.com/smithery-ai/cli)
- Repository with `package.json` and proper entry points

#### Setup

Create a `smithery.yaml` file in your repository root:

```yaml
runtime: "typescript"
```

#### Deploy Process

1. Push your code (including `smithery.yaml`) to GitHub
2. Connect your GitHub to Smithery (or claim your server if already listed)
3. Navigate to the Deployments tab on your server page
4. Click Deploy to build and host your server

### Custom Deploy

For advanced users deploying Docker containers in any programming language.

#### Prerequisites

- Docker container that implements [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)
- Dockerfile in your repository
- Server that listens on `PORT` environment variable

#### Technical Requirements

**HTTP Endpoint**
- **Endpoint**: `/mcp` must be available
- **Methods**: Handle `GET`, `POST`, and `DELETE` requests
- **Port**: Listen on `PORT` environmental variable

**Configuration Handling**
Smithery passes configuration as query parameters using dot-notation:

```
GET/POST /mcp?server.host=localhost&server.port=8080&apiKey=secret123
```

Parse these into a configuration object supporting nested properties.

#### Setup

Create a `smithery.yaml` file:

```yaml
runtime: "container"
build:
  dockerfile: "Dockerfile"           # Path to your Dockerfile
  dockerBuildPath: "."               # Docker build context
startCommand:
  type: "http"
  configSchema:                      # JSON Schema for configuration
    type: "object"
    properties:
      apiKey:
        type: "string"
        description: "Your API key"
    required: ["apiKey"]
  exampleConfig:
    apiKey: "sk-example123"
```

#### Deploy Process

1. Push your code (including `smithery.yaml` and `Dockerfile`) to GitHub
2. Connect your GitHub to Smithery (or claim your server if already listed)
3. Navigate to the Deployments tab on your server page
4. Click Deploy to build and host your container

## Best Practices

### Tool Discovery

To ensure your tools appear in Smithery's registry, implement "lazy loading":

- List tools without requiring authentication
- Only validate API keys when tools are actually invoked
- This allows users to discover your server's capabilities before configuring it

### Docker Optimization

- Use appropriate base images to minimize image size
- Implement multi-stage builds when possible
- Support major Linux distros (Alpine/Debian-based)
- Ensure `sh` is available in your container

### Configuration Security

- Handle API keys and secrets securely
- Validate configuration server-side
- Never log or expose sensitive configuration values

## Example Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build the application
RUN npm run build

CMD ["node", "dist/index.js"]
```

## Troubleshooting

- Test your MCP server locally before deploying using [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- Ensure your Dockerfile builds locally first
- Verify your server implements the Streamable HTTP protocol correctly
- Check that your server listens on the `PORT` environment variable