// ── relay.js (runs in ISOLATED world) ────────────────────────────────────
//
// Purpose:
//   fetch-interceptor.js runs in the page's MAIN world so it can patch
//   window.fetch, but MAIN world scripts can't use chrome.* APIs.
//   Solution: this file runs in the extension's ISOLATED world, which CAN use chrome.*,
//   Its a bridge: it picks up the postMessage from fetch-interceptor
//   and forwards the captured data to the background service worker.


window.addEventListener("message", (event) => {

  if (event.source !== window) return;

  // Ignore any postMessages that aren't from our fetch interceptor
  if (!event.data?.__aiCapture) return;

  // Forward the captured payload to background.js via the chrome messaging API
  try {
    chrome.runtime.sendMessage({
      type: "ai-capture",
      payload: event.data.payload,
    });
  } catch (_) {
    // happens if the service worker was force-killed and the extension context became invalid.
    // The next send will go through normally
  }
});
