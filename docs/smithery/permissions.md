# GitHub Permissions

Learn about the GitHub permissions required for Smithery integration.

## Overview

Smithery for GitHub automatically verifies and deploys your MCP servers directly from your repository. It provides test capabilities for every PR with interactive server inspections, real-time deployment status, and faster issue resolution—all without manual configuration.

## Required Repository Permissions

Smithery requires the following permissions to your connected GitHub account:

| **Permission**       | **Read** | **Write** | **Description**                                                                                                                                                                               |
|----------------------|----------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Contents**         | ✓        | ✓         | Allows us to fetch and write source code to generate new pull requests on new branches. We only commit to new branches that we create, so they do not affect your existing branches.        |
| **Pull Requests**    | ✓        | ✓         | Enables us to create pull requests for generated changes and add interactive server inspection links directly within your PR discussions for immediate testing.                                |
| **Metadata**         | ✓        | ✗         | Allows us to access basic repository information to help provide insights and ensure seamless integration with your GitHub account.                                                            |
| **Checks**           | ✓        | ✓         | Enables Smithery to create and view detailed status reports on your server.                                                                                                                    |
| **Commit Status**    | ✓        | ✓         | Allows us to mark commits with success/failure/pending states that appear in pull requests, showing MCP server deployment status.                                                              |
| **Deployments**      | ✓        | ✓         | Provides access to create and manage deployment processes for your MCP servers when code changes.                                                                                              |
| **Issues**           | ✓        | ✓         | Enables Smithery to automatically create issues when problems are detected in your server code or deployment process, helping track and resolve implementation bugs.                           |
| **Repository Hooks** | ✓        | ✓         | Allows creation and management of webhooks that notify Smithery when code changes, enabling automated updates to your MCP servers.                                                             |

These permissions allow Smithery to create a seamless integration with GitHub, responding automatically to your code changes and keeping your MCP servers up-to-date.

## Installing the GitHub App

### Automatic Installation

When you create a new MCP server on Smithery, you'll be automatically prompted to install the GitHub app for your repositories. This ensures seamless integration from the start.

### Manual Installation

If you need to install the GitHub app manually or want to grant access to additional repositories:

1. **Visit the GitHub App page**: [https://github.com/apps/smithery-ai](https://github.com/apps/smithery-ai)

2. **Click "Install"** to add the app to your GitHub account or organization

3. **Choose repositories**: Select whether to install on:
   - All repositories (current and future)
   - Selected repositories only

4. **Complete installation**: Review the permissions and click "Install" to finish

### Managing Repository Access

After installation, you can modify which repositories Smithery has access to:

1. Go to your GitHub account settings
2. Navigate to **Applications** → **Installed GitHub Apps**
3. Find **Smithery** and click **Configure**
4. Add or remove repository access as needed

## What Smithery Does With These Permissions

### Automated Workflows

- **Code Change Detection**: Webhooks notify Smithery when you push code changes
- **Automatic Deployments**: Server deployments trigger automatically based on repository changes
- **Status Updates**: Commit status shows deployment progress and results in pull requests

### Enhanced Development Experience

- **Pull Request Integration**: Interactive server inspection links added to PR discussions
- **Issue Tracking**: Automatic issue creation when deployment or server problems are detected
- **Real-time Feedback**: Deployment status visible directly in GitHub interface

### Security and Isolation

- **Branch Isolation**: All generated code changes go to new branches, never affecting your main branch
- **Read-only on Main**: No direct writes to your main or existing branches
- **Transparent Changes**: All modifications visible through standard GitHub pull request process

## Security Considerations

### What Smithery Can Access

- Repository source code (for building and deploying servers)
- Pull request discussions (for adding inspection links)
- Commit history and metadata
- Repository settings and webhooks

### What Smithery Cannot Access

- Private data outside your repositories
- Other GitHub organizations or accounts
- Repository secrets or environment variables
- Direct write access to protected branches

### Best Practices

1. **Repository Selection**: Only grant access to repositories containing MCP servers
2. **Review Permissions**: Regularly review and audit app permissions in GitHub settings
3. **Monitor Activity**: Watch for unexpected pull requests or issues created by Smithery
4. **Protected Branches**: Use GitHub's branch protection rules to prevent unauthorized changes

## Troubleshooting

### Installation Issues

**Problem**: GitHub app won't install
- **Solution**: Ensure you have admin access to the repository or organization

**Problem**: Smithery can't access repository
- **Solution**: Verify the repository is included in the app installation scope

### Permission Issues

**Problem**: Deployment failing with permission errors
- **Solution**: Check that all required permissions are granted to the Smithery app

**Problem**: Pull request status not updating
- **Solution**: Verify "Checks" and "Commit Status" permissions are enabled

### Common Solutions

1. **Reinstall the App**: Remove and reinstall the GitHub app if experiencing persistent issues
2. **Check Organization Settings**: Ensure your organization allows third-party app installations
3. **Verify Webhooks**: Confirm webhooks are properly configured and receiving events

## Support

If you encounter issues with GitHub permissions or integration:

1. Check the Smithery documentation for troubleshooting guides
2. Review GitHub's app permission documentation
3. Contact Smithery support with specific error messages and repository details

The GitHub app installation is required for Smithery to automatically deploy your MCP servers, create pull request status checks, and provide real-time deployment feedback.