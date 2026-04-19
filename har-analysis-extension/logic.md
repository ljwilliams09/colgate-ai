# AI Session Capture Extension — How It Works

## What Is This Extension?

When you type a message into ChatGPT and hit Send, your browser sends a **network request** to the AI company's servers and streams the response back. This extension **intercepts** that request and response in real time and pulls out useful data like how long the AI took to respond, what tool it used, and which model answered.

---

## Flow Chart

```mermaid
flowchart LR
    A["You type and hit Send"]
    B["Browser calls window.fetch()"]
    C["fetch-interceptor.js intercepts"]
    D["Reads SSE stream"]
    E["Posts via postMessage"]
    F["relay.js receives"]
    G["relay.js → background.js"]
    H["Saves to storage & updates badge"]
    I["Side panel displays results"]

    A --> B --> C --> D --> E --> F --> G --> H --> I
```

---

## Step-by-Step Breakdown

### Step 1 — Intercepting the Request

**File: `fetch-interceptor.js`** *(runs inside the webpage itself)*

Most website use a browser function called `window.fetch()` to make network requests. This script **replaces** that function with its own version the moment the page loads. The page does not know so it still calls `window.fetch()` like normal, but now our code runs first.

When a fetch request is made, the script checks:

- Is this a POST request? (AI sends are always POST)
- Does the URL match a known ChatGPT endpoint?

If so, then it:

1. **Reads the request body** to extract a preview of what the user typed
2. **Records the time** before calling the real fetch
3. **Calls the real fetch** and gets the response back
4. **Clones the response** so it can read the stream without breaking the page
5. **Reads the streaming response line by line** (this is called SSE — Server-Sent Events)

> **What is SSE?** Instead of sending one big response, AI models stream their reply back in tiny chunks called events. Each chunk is a line starting with `data:` followed by JSON. The script reads each of these lines to piece together what happened.

From the stream it extracts:

| Event Type | What It Tells Us |
| --- | --- |
| `server_ste_metadata` | Tool used, turn mode (text/search/shopping), model name |
| `url_moderation` | URLs the AI fetched on your behalf (e.g. during web search) |
| `message_start` | Model name (Claude uses this instead of metadata) |

If the stream has **zero SSE events**, it was a background/noise request (like a telemetry ping) — the script ignores it.

Finally, it fires a `postMessage` with all the captured data tagged with `__aiCapture: true`.

---

### Step 2 — Crossing the Extension Boundary

**File: `relay.js`** *(runs in the extension's isolated world)*

**The Issue:**

Chrome extensions run scripts in an isolated world, which means they sit next to the page but can’t directly touch its variables. But the fetch-interceptor.js needs to run in the MAIN world so it can override window.fetch and actually intercept requests.

The issue is that once we are in the MAIN world, we lose access to Chrome APIs like chrome.runtime.sendMessage(). So now we can intercept the data, but can’t send it to the extension directly.

**The solution:** use `postMessage` as a bridge.

- `fetch-interceptor.js` (MAIN world) fires a `window.postMessage`
- `relay.js` (isolated world) listens for that message
- `relay.js` then calls `chrome.runtime.sendMessage()` to pass it into the extension system

```mermaid
flowchart LR
    subgraph MAIN["MAIN world (page)"]
        FI["fetch-interceptor.js"]
    end

    subgraph ISO["ISOLATED world (extension)"]
        R["relay.js"]
    end

    subgraph EXT["Chrome Extension"]
        BG["background.js"]
    end

    FI -->|"window.postMessage()"| R
    R -->|"chrome.runtime.sendMessage()"| BG
```

---

### Step 3 — Storing the Data

**File: `background.js`** *(runs as a Chrome service worker)*

The background script manages all shared state. When it receives an `ai-capture` message from relay.js, it:

1. Assigns the send a sequential ID (`send1`, `send2`, etc.)
2. Adds it to the front of the `sends[]` array (newest first)
3. Trims the list to the last 100 sends (so that storage doesn't grow forever)
4. Saves everything to `chrome.storage.local` (persists even if you close the side panel)
5. Updates the **badge number** on the extension icon so you can see how many sends were captured
6. Sends a `sends-updated` message to notify the side panel to refresh

---

### Step 3b — Third-Party Domain Tracking

**File: `background.js`** *(webRequest API)*

In addition to storing send data, the background script also watches **every network request** the browser makes using Chrome's `webRequest` API. This works like a browser-level TShark, it sees all traffic, not just AI requests.

**How it works:**

1. Every completed request gets logged to a **rolling 90-second buffer** (domain + timestamp)
2. AI platform domains (`chatgpt.com`, `openai.com`, `claude.ai`, `anthropic.com`) are filtered out — we only want third parties
3. When a send is captured, the buffer is scanned for all requests that happened between the send's start time and now
4. Each unique domain is **categorized** using the [Disconnect.me tracker database](https://github.com/disconnectme/disconnect-tracking-protection) — a community-maintained list of thousands of known trackers. It is fetched once on startup and cached locally for a week
5. If a domain isn't in the Disconnect list, a **keyword heuristic** fallback runs (e.g. if the domain contains "analytics", "track", "beacon", etc.)
6. The resulting list of `{ domain, category }` pairs is saved as `third_party_contacts` on the send record

**Why this matters:** Even a one-word prompt to ChatGPT triggers connections to Google Analytics, Datadog, and other external services. This feature makes that visible per-send.

---

### Step 4 — Displaying the Results

**Files: `sidepanel.html`, `sidepanel.js`, `sidepanel.css`**

When opening the extension's side panel, `sidepanel.js` asks the background worker for all stored sends via a `get-sends` message. It then renders a card for each send showing:

- What you typed (prompt preview)
- What mode the AI used (text, search, shopping, etc.)
- What tool was called, if any
- Which model responded
- How long it took to get the first byte back (TTFB)
- How many bytes came back and how many SSE events streamed
- Any external URLs the AI fetched during the response
- Which third-party domains were contacted during the send (with category labels)

---

## Full File Reference

| File | Where It Runs | What It Does |
|---|---|---|
| `fetch-interceptor.js` | Inside the webpage (MAIN world) | Patches `window.fetch`, reads SSE stream, extracts data |
| `relay.js` | Extension isolated world | Bridges page → extension message boundary |
| `background.js` | Chrome service worker | Stores sends, manages badge, notifies UI |
| `sidepanel.html/js/css` | Extension side panel | Renders the captured send data visually |
| `popup.html/js/css` | Extension popup | Minimal UI shown on icon click |
| `manifest.json` | Chrome config | Declares permissions, which scripts run where, side panel path |

---

## Info Extension Records Per Send

| Field | How We Get It | What It Means |
|---|---|---|
| `prompt_preview` | Parsed from POST request body | The first 200 characters of what the user typed |
| `ttfb_ms` | `Date.now()` before and after fetch | How long (ms) before the AI sent the first byte back |
| `turn_use_case` | SSE `server_ste_metadata` event | Mode: `text`, `search`, `shopping`, etc. |
| `tool_invoked` | SSE `server_ste_metadata` event | `true` if the AI used a tool (e.g. web search) |
| `tool_name` | SSE `server_ste_metadata` event | Name of the tool used (e.g. `browser`) |
| `model_slug` | SSE metadata or `message_start` | Which model answered (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
| `response_bytes` | Counted from stream chunks | Total size of the streamed response |
| `sse_event_count` | Counted SSE lines | Number of streaming data events in the response |
| `server_fetched_urls` | SSE `url_moderation` events | URLs the model went out and fetched (web search results) |
| `third_party_contacts` | `webRequest` buffer + Disconnect.me list | Third-party domains contacted during the send, with category labels |

---

## What browser APIs and resources the Chrome extension is allowed to access?

Permissions Needed (from `manifest.json`)

| Permission | Why |
| --- | --- |
| `storage` | To save captured sends across sessions |
| `sidePanel` | To show the side panel UI |
| `host_permissions: chatgpt.com, claude.ai` | To inject the interceptor scripts into those pages only |
| `webRequest` + `<all_urls>` | To observe all browser network requests for third-party domain tracking |
