# AI Network Patterns

## ChatGPT

### ChatGPT Domain Endpoints

Total Requests and Responses: 1048

- **chatgpt.com** - 1025
  - Main application
- **cdn.openai.com** - 2
  - Simple content distribution network for fonts.
- **bzrcdn.openai.com** - 4
  - Another content distribution network for images.

**_Third Party Domains_**

- **google-analytics.com** - 4
  - Third party analytics service offered by Google for businesses to track website traffic.
- **googletagmanager.com** - 2
  - Third party service from Google that allows companies to insert small tags in code that help with tracking user behaviors.
- **accounts.google.com** - 6
  - Third party service for Google account login or authentication.

### Prompts and Responses

- When a prompt is sent to ChatGPT, the endpoint `https://chatgpt.com/backend-anon/f/conversation` is used through a `POST` request.

- When a response is sent back to the client, Claude uses the same endpoint as it uses to send the prompt, a normal fetch call, and a `text/event-stream` media type.

## Claude

Total Requests and Responses: 537

### Claude Domain Endpoints

- **claude.ai** - 140
  - Main application
- **assets-proxy.anthropic.com** - 182
  - Serves fonts, stylesheets, and scripts for formatting claude.ai
- **api.anthropic.com** - 53
  - Checks the MCP registry which gives a list of available connectors (for example connecting Claude to Notion, Google Drive, Slack, etc.)
- **???-cdn.anthropic.com** - 64
  - Hostnames for a content distribution network, most likely serves Anthropic Claude users to distribute content faster and load user data easier
- **a.claude.ai** - 12
  - Unknown

**_Third Party Domains_**

- **browser-intake-us5-datadoghq.com** - 44
  - Third party company endpoint that collects web metrics and data for companies to monitor and analyze their applications
- **widget.intercom.io** - 4
  - Connects to Claude's outsourced customer support and a popup help window
- **js.intercomcdn.com** - 8
  - CDN for intercom
- **connect.facebook.net** - 12
  - Most likely for a login with facebook feature
- **google.com** - 4
  - Used for images related to the Notion logo or the Linear logo (see lines 267 and 268 in claude_3-prompts_output.csv)
- **cdn.sanity.io** - 3
  - Claude fetches some files from Sanity's cdn
- **?.gstatic.com** - 4
  - Another cdn owned by google, used for fetching some types of images

### Prompts and Response

- When a prompt is sent to Claude, the endpoint `https://claude.ai/api/organizations/.../chat_conversations/.../completion` is used through a `POST` request.

- When a response is sent back to the client, Claude uses the same endpoint as it uses to send the prompt, a normal fetch call, and a `text/event-stream` media type.

### Questions

- How many calls is it making to third parties and other analytics companies?
- What types of tools does do these models use?
- What is the network structure
