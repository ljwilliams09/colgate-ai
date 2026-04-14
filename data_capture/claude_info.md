# Claude Network Patterns

## Domain Endpoints

- **claude.ai**
  - main application
- **assets-proxy.anthropic.com**
  - serves fonts, stylesheets, and scripts for formatting claude.ai
- **api.anthropic.com**
  - checks the MCP registry which gives a list of available connectors (for example connecting claude to Notion, Google Drive, Slack, etc.)
- **???-cdn.anthropic.com**
  - hostnames for a content distribution network, most likely serves anthropic claude users to distribute content faster and load user data easier
- **a.claude.ai**
  - unknown

**_Third Party Domains_**

- **browser-intake-us5-datadoghq.com**
  - third party company endpoint that collects web metrics and data for companies to monitor and analyze their applications
- **widget.intercom.io**
  - connects to claude's outsourced customer support and a popup help window
- **js.intercomcdn.com**
  - cdn for intercom
- **connect.facebook.net**
  - most likely for a login with facebook feature
- **google.com**
  - used for images related to the Notion logo or the Linear logo (see lines 267 and 268 in claude_3-prompts_output.csv)
- **cdn.sanity.io**
  - claude fetches some files from Sanity's cdn
- **t?.gstatic.com**
  - another cdn owned by google, used for fetching some types of images
- **and more...**

## Prompts and Response
