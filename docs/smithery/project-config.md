# Project Configuration

Learn how to configure your project for deployment on Smithery.

## Overview

This guide explains how to configure your project for deployment on Smithery. Your project configuration tells Smithery how to deploy your server and should live in the base of your repository. These are different from [session configurations](./session-config.md) that clients pass to initialize a new session on your server.

## Required Configuration Files

### 1. Dockerfile

The Dockerfile tells Smithery how to build your server. It should be placed in the root of your project or in the subdirectory containing your MCP server.

**Example Dockerfile:**
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY . .
RUN pip install -r requirements.txt

CMD ["python", "server.py"]
```

**Requirements:**
- Only Linux Docker images on major distros (Alpine/Debian-based) are supported
- Container must have `sh` available for execution
- Other distros are untested and may not deploy

### 2. smithery.yaml

The smithery.yaml file tells Smithery how to start your server. It should be placed alongside your Dockerfile.

**Basic Example:**
```yaml
version: 1
start:
  command: ["python", "server.py"]
  port: 8000
```

## Project Structure

### Monorepo Support

If your package is not in the root directory of your repository (monorepo case), place your Dockerfile and `smithery.yaml` in the subdirectory containing your package.

**Example Structure:**
```
repository/
├── packages/
│   └── mcp-server/
│       ├── Dockerfile
│       ├── smithery.yaml
│       ├── package.json
│       └── src/
└── other-packages/
```

**Configuration Steps:**
1. Place `Dockerfile` and `smithery.yaml` in `packages/mcp-server` directory
2. Set the base directory to `packages/mcp-server` in your server settings under GitHub integration

### Automatic Setup

Smithery will attempt to automatically generate a pull request with these files when you trigger a deployment. However, in some cases, the setup can fail and you may need to set this up manually.

## Dockerfile Best Practices

### Node.js Example
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

### Python Example
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy application code
COPY . .

CMD ["python", "server.py"]
```

### Optimization Tips

1. **Use Multi-stage Builds**: Reduce final image size by using build and runtime stages
2. **Layer Caching**: Copy dependency files before application code for better caching
3. **Minimal Base Images**: Use Alpine or slim variants when possible
4. **Security**: Run as non-root user when possible

## Environment Variables

You can specify environment variables in your `smithery.yaml`:

```yaml
runtime: "typescript"
env:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
```

## Validation and Testing

### Local Testing

Before deploying, ensure your setup works locally:

1. **Build Docker Image**: `docker build -t my-mcp-server .`
2. **Run Container**: `docker run -p 8000:8000 my-mcp-server`
3. **Test MCP Server**: Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to validate functionality

### Pre-deployment Checklist

- [ ] Dockerfile builds successfully locally
- [ ] Server implements Streamable HTTP protocol
- [ ] Server listens on `PORT` environment variable
- [ ] Configuration schema is properly defined
- [ ] All required files are in the repository

## Common Issues

### Build Failures

- **Missing Dependencies**: Ensure all dependencies are properly specified
- **Wrong Base Image**: Use supported Linux distributions (Alpine/Debian-based)
- **Path Issues**: Verify file paths are correct in your Dockerfile

### Runtime Issues

- **Port Binding**: Ensure server listens on `process.env.PORT`
- **HTTP Endpoint**: `/mcp` endpoint must be available
- **Configuration**: Parse base64-encoded config from query parameters correctly

## Next Steps

Once you have configured your project:

1. Review the [Deployments Guide](./deployments.md) for deployment options
2. Set up [Session Configuration](./session-config.md) for user customization
3. Configure [GitHub Permissions](./permissions.md) for integration
4. Test locally before deploying to Smithery