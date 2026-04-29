# AI Use Extension

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

## Extension Guide

The extension consists of 4 main tabs as described below:

### Dashboard

    - The dashboard gives insights into the daily AI use of the user. It provides widgets with insights, the most popular tool that was used, and the top url's that were accessed.
    - The clear button in the top corner will reset the daily counts on the dashboard.

### Live Stream

    - The livestream provides a prompt by prompt breakdown between chatgpt and claude for the size of a response for a prompt, the tools used, response method used, and any third party contacts used during the interaction.
    - The clear button in the top corner will also reset the livestream.

### Tracking

    - The tracking tab provides information on tracking calls made during interactions. Part of these tracking calls happen during loading or even before a user types anything, others happen afterwards. The tracking tab gives a breakdown of the different companies that are contacted, the total contacts, and breakdowns between ChatGPT and Claude.

### Timeline

    - Finally, the timeline's purpose is to show aggregated data over time. With data being aggregated and stored on a daily basis, the timeline provides graphs on total prompts, estimated water usage, and tool proportion use over time. Additionally, lifetime stats are displayed below regarding estimated lifetime water use from AI, total prompts sent to AI, the users most used model, and the third party company contacted the most.
