# AI Use Extension

## Network Traffic Analysis

- Insights:

1. How does network traffic signify the start and end of a prompt
2. What is the proportion of information that a person receieves from AI?
   - P(AI) = proportion of information from AI / proportion of informaiton from AI + proportion of information from non-AI
3. Who is notified when the user prompts/interacts with AI tools? What kinds of data do LLMs collect on the usage of their sites?
   - ChatGPT pings `www.google-analytics.com` before the user prompt (init phase), and every single time the user interacts with the LLM
   - Claude pings `connect.facebook.net` before the user prompt, and every single time the user interacts with the LLM
   - Both `google analytics` and `facebook pixel` are specifically designed to track user behavior
   - This raises the question of whether behavioral data collected by these third parties could inform how AI platforms optimize for user engagement, however, this question cannot be answered from network traffic alone since the data is encrypted.
3.

## Chrome Extension

The `extension/` folder contains a Manifest V3 Chrome extension that captures browser network requests and shows them in a popup.

To load it in Chrome:

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Click Load unpacked
4. Upload the `extension` folder

## Network Traffic Analysis

To analyze network patterns between ChatGPT and Claude, two prominent AI models, we used the `/data_capture/capture.js` script to log network traffic requests and response information.

We used three simple prompts, such as "hi there" to establish patterns in each AI services network traffic, and gather a small amount of data to manually look through and annotate.

The `/data_capture/data_info.md` file is a markdown file that highlights the different domains that are called during use, the amounts of times each domains are called, the overall amount of requests and responses, and the likely purpose of each domain.

From the data capture, it was clear that each service is structured incredibly differently with ChatGPT being incredibly centralized in the domains that it hosted resources under, whereas Claude was much more distributed in the domains and third party resources that it used.

## Final Additions

For the beta, our plan was to establish that this works well with both ChatGPT and Claude and can give some baseline insights into AI usage. For the final, we plan to add a couple of more insights from the network traffic, including aggregation of use over time and possible tool insights for Claude.
