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

### Limitations and Future Work

There are some limitations to this project in terms of the data we capture and the insights we provide. First, AI services have integrated web searches into their chat conversations with users. The tool tracker does allow us to see some of these tool uses, but only for services that provide information about them through returned metadata. Different AI services might include network calls, such as web searches, in their backends to provide information to the user in the final response, but that network traffic is not available for use.

One insight we can't infer from network traffic is what information analytics are collecting. We can make some inferences from URL endpoints, such as that a URL has `analytics` in its path, but we cannot infer what kind of data it collects, whether it's about the user or its own service.

Additionally, it's incredibly valuable to know a person's AI usage to pinpoint their environmental impact. Through reading multiple articles on the energy that AI uses, such as [this one](https://www.technologyreview.com/2025/05/20/1116327/ai-energy-usage-climate-footprint-big-tech/), there are multiple factors that go into how much energy a prompt actually takes up. Tracking network traffic could be the first step toward pinpointing this by allowing us to see directly where queries are going, since the specific data center a user is communicating with matters. However, it is not enough to get us there, as there are too many extraneous factors, with the main one being the lack of transparency that AI companies give, because most of this information is kept behind closed doors.

In practicality, it is rather difficult to track the destination of queries through a javascript extension without having a predefined list of URL endpoints and DNS query records that map onto different locations; it would need to be implemented in an application.

The last limitation of this project was in capturing the response length/estimated tokens per response. Since AI services usually respond to prompts over SSE (server-sent events) and gives the chatbot a typing feel, it makes it so that a response does not arrive to the user in one response, but multiple. We weren't able to figure out a way to stitch these together easily in the time that we had, but it is possible and would be a future goal if given more time.
