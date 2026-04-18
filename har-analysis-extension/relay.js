// ── relay.js (runs in ISOLATED world) ────────────────────────────────────
// fetch-interceptor.js runs in the page's MAIN world and can't touch any
// chrome.* APIs. This script runs in the extension's ISOLATED world, which
// can. It listens for the postMessage that fetch-interceptor.js fires after
// parsing a send, then forwards it to the background service worker.

window.addEventListener("message", (event) => {
  // Only accept messages from the same window (not iframes or other origins)
  if (event.source !== window) return;

  // Check our flag so we don't accidentally process unrelated postMessages
  if (!event.data?.__aiCapture) return;

  // Forward to the background service worker
  // Wrapped in try/catch because the extension context can become invalid
  // if the service worker is sleeping — it'll restart on the next message
  try {
    chrome.runtime.sendMessage({
      type: "ai-capture",
      payload: event.data.payload,
    });
  } catch (_) {
    // Extension context invalidated —> safe to ignore, data will be captured next time
  }
});
