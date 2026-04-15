// ── background.js (service worker) ───────────────────────────────────────
// Receives captured send data from relay.js, stores it in chrome.storage.local,
// and serves it to the popup when requested.
// Also manages the badge count on the extension icon.
//Used AI 
// Open the side panel when the extension icon is clicked
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const STORAGE_KEY = "aiCaptureSends";
const MAX_SENDS   = 100; // keep the last 100 sends

let sends   = [];
let sendIdx = 0; // used to assign sequential send IDs

// Load any previously stored sends when the service worker starts up
const ready = chrome.storage.local.get(STORAGE_KEY).then((result) => {
  sends   = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  sendIdx = sends.length;
  updateBadge();
});

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#2f7f7b" });
  chrome.action.setBadgeText({
    text: sends.length ? String(sends.length) : "",
  });
}

async function persist() {
  await chrome.storage.local.set({ [STORAGE_KEY]: sends });
  updateBadge();
  // Tell the side panel to refresh if it's currently open
  chrome.runtime.sendMessage({ type: "sends-updated" }).catch(() => {});
}

// Wait for the initial storage load before handling any messages
function ensureReady() {
  return ready;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // A new send was captured — store it
  if (message.type === "ai-capture") {
    ensureReady().then(() => {
      sendIdx++;
      const record = {
        send_id: `send${sendIdx}`,
        ...message.payload,
      };
      sends.unshift(record); // newest first
      if (sends.length > MAX_SENDS) {
        sends = sends.slice(0, MAX_SENDS);
      }
      persist().catch(() => {});
      sendResponse({ ok: true });
    });
    return true; // keep the message channel open for async response
  }

  // Popup is opening — send back all stored sends
  if (message.type === "get-sends") {
    ensureReady().then(() => {
      sendResponse({ sends });
    });
    return true;
  }

  // User clicked the clear button in the popup
  if (message.type === "clear-sends") {
    ensureReady().then(async () => {
      sends   = [];
      sendIdx = 0;
      await chrome.storage.local.remove(STORAGE_KEY);
      updateBadge();
      sendResponse({ ok: true });
    });
    return true;
  }
});
