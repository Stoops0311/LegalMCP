# smithery.yaml Reference

Reference documentation for the smithery.yaml configuration file.

## Overview

The `smithery.yaml` file provides configuration for your Model Context Protocol (MCP) server on Smithery. This file must be placed in your repository root.

## Required Properties

### runtime

**Type**: String  
**Required**: Yes

Specifies the deployment runtime for your MCP server:

- `"typescript"` - Uses the Smithery CLI to build your TypeScript project directly
- `"container"` - Uses Docker containers for deployment (supports any language)

```yaml
runtime: "typescript"  # or "container"
```

## TypeScript Runtime

When using `runtime: "typescript"`, Smithery uses the [Smithery CLI](https://github.com/smithery-ai/cli) to build your TypeScript MCP server directly. This is the recommended approach for TypeScript projects.

### Basic Configuration

```yaml
runtime: "typescript"
env:
  NODE_ENV: "production"
```

### Properties

| Property  | Type   | Description                                                       |
|-----------|--------|-------------------------------------------------------------------|
| `runtime` | string | Must be set to `"typescript"`                                    |
| `env`     | object | Optional environment variables to inject when running your server |

Your server will be built using `@smithery/cli build` and deployed as a streamable HTTP server.

## Container Runtime

When using `runtime: "container"`, Smithery uses Docker containers to build and deploy your server. This supports any programming language and gives you full control over the deployment environment.

### Basic Configuration

```yaml
runtime: "container"
startCommand:
  type: "http"
  configSchema:
    type: "object"
    properties:
      apiKey:
        type: "string"
        description: "Your API key"
    required: ["apiKey"]
build:
  dockerfile: "Dockerfile"
  dockerBuildPath: "."
```

## Configuration Properties

### startCommand

**Type**: Object  
**Required**: For container runtime

Defines how your MCP server should be configured and accessed.

| Property        | Type   | Description                                                    |
|-----------------|--------|----------------------------------------------------------------|
| `type`          | string | Must be set to `"http"` for HTTP-based MCP servers            |
| `configSchema`  | object | JSON Schema defining the configuration options for your server |
| `exampleConfig` | object | Example configuration values for testing                       |

Your server must implement the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) protocol and handle configuration passed via query parameters to the `/mcp` endpoint.

### configSchema Examples

**Simple API Key Configuration:**
```yaml
configSchema:
  type: "object"
  required: ["apiKey"]
  properties:
    apiKey:
      type: "string"
      title: "API Key"
      description: "Your API key"
```

**Complex Configuration:**
```yaml
configSchema:
  type: "object"
  required: ["apiKey"]
  properties:
    apiKey:
      type: "string"
      title: "API Key"
      description: "Your API key"
    temperature:
      type: "number"
      default: 0.7
      minimum: 0
      maximum: 1
      title: "Temperature"
      description: "Controls randomness of output"
    database:
      type: "object"
      properties:
        host:
          type: "string"
          default: "localhost"
        port:
          type: "integer"
          default: 5432
exampleConfig:
  apiKey: "sk-example123"
  temperature: 0.8
  database:
    host: "localhost"
    port: 5432
```

### build

**Type**: Object  
**Optional**: For container runtime

Contains Docker build configuration for your server.

| Property          | Type   | Description                                                             |
|-------------------|--------|-------------------------------------------------------------------------|
| `dockerfile`      | string | Path to Dockerfile, relative to smithery.yaml. Defaults to "Dockerfile" |
| `dockerBuildPath` | string | Docker build context path, relative to smithery.yaml. Defaults to "."   |

```yaml
build:
  dockerfile: "docker/Dockerfile"
  dockerBuildPath: "."
```

### env

**Type**: Object  
**Optional**

Environment variables to inject when running your server. Available for both runtime types.

```yaml
env:
  NODE_ENV: "production"
  DEBUG: "true"
  LOG_LEVEL: "info"
```

## JSON Schema Support

The `configSchema` supports all standard JSON Schema features:

- **Data Types**: `string`, `number`, `boolean`, `integer`, `object`, `array`
- **Validation**: `required`, `minimum`, `maximum`, `enum`, `pattern`
- **Documentation**: `title`, `description`
- **Defaults**: `default` values for optional properties
- **Nested Objects**: Complex object structures with nested properties

## Complete Examples

### TypeScript Server

```yaml
runtime: "typescript"
env:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
```

### Python Container Server

```yaml
runtime: "container"
startCommand:
  type: "http"
  configSchema:
    type: "object"
    required: ["databaseUrl"]
    properties:
      databaseUrl:
        type: "string"
        title: "Database URL"
        description: "PostgreSQL connection string"
      maxConnections:
        type: "integer"
        default: 10
        minimum: 1
        maximum: 100
      debug:
        type: "boolean"
        default: false
  exampleConfig:
    databaseUrl: "postgresql://user:pass@localhost:5432/db"
    maxConnections: 5
    debug: false
build:
  dockerfile: "Dockerfile"
  dockerBuildPath: "."
env:
  PYTHONPATH: "/app"
```

### Node.js Container Server

```yaml
runtime: "container"
startCommand:
  type: "http"
  configSchema:
    type: "object"
    required: ["openaiApiKey"]
    properties:
      openaiApiKey:
        type: "string"
        title: "OpenAI API Key"
        description: "Your OpenAI API key for LLM calls"
      model:
        type: "string"
        default: "gpt-4"
        enum: ["gpt-3.5-turbo", "gpt-4", "gpt-4-turbo"]
        title: "Model"
      temperature:
        type: "number"
        default: 0.7
        minimum: 0
        maximum: 2
        title: "Temperature"
  exampleConfig:
    openaiApiKey: "sk-example123"
    model: "gpt-4"
    temperature: 0.8
build:
  dockerfile: "Dockerfile"
env:
  NODE_ENV: "production"
```

## Best Practices

1. **Use Descriptive Titles**: Provide clear `title` and `description` fields for all properties
2. **Set Reasonable Defaults**: Use `default` values for optional configuration
3. **Validate Input**: Use `minimum`, `maximum`, `enum` to constrain valid values
4. **Organize Logically**: Group related configuration into nested objects
5. **Provide Examples**: Include `exampleConfig` to help users understand expected values
6. **Keep It Simple**: Only expose essential configuration options to users