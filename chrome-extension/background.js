const STORAGE_KEY = "networkCaptureHistory";
const MAX_RECORDS = 500;

let history = [];
const pendingRequests = new Map();

const ready = chrome.storage.local.get(STORAGE_KEY).then((result) => {
  const savedHistory = result[STORAGE_KEY];
  history = Array.isArray(savedHistory) ? savedHistory : [];
  updateBadge();
});

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#0f766e" });
  chrome.action.setBadgeText({
    text: history.length ? String(history.length) : "",
  });
}

async function persistHistory() {
  await chrome.storage.local.set({ [STORAGE_KEY]: history });
  updateBadge();
}

function ensureReady() {
  return ready;
}

function startRequest(details) {
  pendingRequests.set(details.requestId, {
    requestId: details.requestId,
    url: details.url,
    method: details.method,
    type: details.type,
    tabId: details.tabId,
    initiator: details.initiator || "",
    startedAt: details.timeStamp,
  });
}

function finalizeRequest(details, outcome) {
  const start = pendingRequests.get(details.requestId) || {};
  pendingRequests.delete(details.requestId);

  const entry = {
    requestId: details.requestId,
    url: start.url || details.url,
    method: start.method || details.method || "GET",
    type: start.type || details.type || "other",
    tabId: typeof start.tabId === "number" ? start.tabId : details.tabId,
    initiator: start.initiator || details.initiator || "",
    startedAt: start.startedAt || details.timeStamp,
    completedAt: details.timeStamp,
    durationMs:
      typeof start.startedAt === "number"
        ? Math.max(0, details.timeStamp - start.startedAt)
        : null,
    statusCode: outcome.statusCode ?? null,
    statusText: outcome.statusText || (outcome.error ? "error" : "completed"),
    fromCache: Boolean(outcome.fromCache),
    ip: outcome.ip || "",
    error: outcome.error || "",
  };

  history.unshift(entry);
  if (history.length > MAX_RECORDS) {
    history = history.slice(0, MAX_RECORDS);
  }

  persistHistory().catch(() => {});
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) {
      startRequest(details);
    }
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId >= 0) {
      finalizeRequest(details, {
        statusCode: details.statusCode,
        statusText: "completed",
        fromCache: details.fromCache,
        ip: details.ip,
      });
    }
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.tabId >= 0) {
      finalizeRequest(details, {
        statusText: "error",
        error: details.error,
      });
    }
  },
  { urls: ["<all_urls>"] },
);

chrome.runtime.onInstalled.addListener(() => {
  ensureReady().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "get-history") {
    ensureReady()
      .then(() => sendResponse({ history }))
      .catch((error) =>
        sendResponse({ history: [], error: error?.message || String(error) }),
      );
    return true;
  }

  if (message?.type === "clear-history") {
    ensureReady()
      .then(async () => {
        history = [];
        pendingRequests.clear();
        await chrome.storage.local.remove(STORAGE_KEY);
        updateBadge();
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }
});
