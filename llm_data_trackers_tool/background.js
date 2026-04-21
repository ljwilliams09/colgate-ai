// background.js

// ── Tracker config ────────────────────────────────────────────────────────────
const WATCHED_SITES = ["claude.ai", "chatgpt.com"];

const TRACKERS = {
  "connect.facebook.net":             { label: "Facebook (Meta)",    desc: "Ad behavior tracking" },
  "www.google-analytics.com":         { label: "Google Analytics",   desc: "Usage analytics" },
  "googletagmanager.com":             { label: "Google Tag Manager", desc: "Script injection" },
  "browser-intake-us5-datadoghq.com": { label: "Datadog",            desc: "Session monitoring" },
  "api-iam.intercom.io":              { label: "Intercom",           desc: "Live support connection" },
};

// Requests that indicate the user sent their first message
const PROMPT_PATTERNS = {
  "claude.ai":   /\/api\/.*\/completion|\/api\/.*\/messages/,
  "chatgpt.com": /\/backend-api\/conversation/,
};

// ── Full capture constants — mirrors chrome-extension/background.js exactly ───
const STORAGE_KEY = "networkCaptureHistory";
const MAX_RECORDS = 500;
const ANALYTICS_WINDOW_MS = 60_000;

// ── State ─────────────────────────────────────────────────────────────────────
let history = [];
const pendingRequests = new Map();
const livePorts = new Set();
const recentEvents = [];

// sessions: { [site]: { start: ms, firstPromptTime: ms | null } }
const sessions = {};

const ready = chrome.storage.local
  .get([STORAGE_KEY, "sessions"])
  .then((result) => {
    history = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    Object.assign(sessions, result.sessions || {});
    updateBadge();
  });

// ── Helpers — exact copies from chrome-extension/background.js ───────────────

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

function getHostFromUrl(value) {
  try {
    return new URL(value).host || "unknown";
  } catch {
    return "unknown";
  }
}

function computeP95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  return Math.round(sorted[index]);
}

function pruneRecentEvents(now) {
  const cutoff = now - ANALYTICS_WINDOW_MS;
  while (recentEvents.length && recentEvents[0].completedAt < cutoff) {
    recentEvents.shift();
  }
}

function buildSummary() {
  const now = Date.now();
  pruneRecentEvents(now);

  const byHost = new Map();
  let totalErrors = 0;

  for (const event of recentEvents) {
    const host = getHostFromUrl(event.url);
    const bucket = byHost.get(host) || {
      host,
      count: 0,
      errors: 0,
      durations: [],
    };

    bucket.count += 1;
    if (
      event.error ||
      (typeof event.statusCode === "number" && event.statusCode >= 400)
    ) {
      bucket.errors += 1;
      totalErrors += 1;
    }
    if (typeof event.durationMs === "number") {
      bucket.durations.push(event.durationMs);
    }
    byHost.set(host, bucket);
  }

  const topHosts = [...byHost.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((bucket) => ({
      host: bucket.host,
      count: bucket.count,
      errors: bucket.errors,
      errorRate: bucket.count
        ? Number((bucket.errors / bucket.count).toFixed(3))
        : 0,
      p95Ms: computeP95(bucket.durations),
    }));

  return {
    generatedAt: now,
    windowMs: ANALYTICS_WINDOW_MS,
    total: recentEvents.length,
    errorRate: recentEvents.length
      ? Number((totalErrors / recentEvents.length).toFixed(3))
      : 0,
    requestRatePerSec: Number(
      (recentEvents.length / (ANALYTICS_WINDOW_MS / 1000)).toFixed(2),
    ),
    topHosts,
  };
}

function broadcast(message) {
  for (const port of livePorts) {
    try {
      port.postMessage(message);
    } catch {
      // Ignore disconnected ports.
    }
  }
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
  if (history.length > MAX_RECORDS) history = history.slice(0, MAX_RECORDS);

  recentEvents.push(entry);
  const summary = buildSummary();
  broadcast({ type: "entry", entry, summary, historyCount: history.length });

  persistHistory().catch(() => {});
}

// ── Session helpers ───────────────────────────────────────────────────────────

function getOrCreateSession(site, now) {
  if (!sessions[site]) {
    sessions[site] = { start: now, firstPromptTime: null };
    chrome.storage.local.set({ sessions });
  }
  return sessions[site];
}

// ── webRequest listeners — only claude.ai and chatgpt.com tabs ────────────────

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    chrome.tabs.get(details.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) return;

      const onAI = WATCHED_SITES.find((s) => tab.url.includes(s));
      if (!onAI) return;

      const now = Date.now();
      const session = getOrCreateSession(onAI, now);

      // Full capture (same as chrome-extension/background.js)
      startRequest(details);

      // Detect the user's first prompt on this platform
      const promptPattern = PROMPT_PATTERNS[onAI];
      if (
        !session.firstPromptTime &&
        details.method === "POST" &&
        promptPattern?.test(details.url)
      ) {
        session.firstPromptTime = now;
        chrome.storage.local.set({ sessions });
        broadcast({ type: "prompt", ai: onAI, time: now });
      }

      // Tracker detection
      const match = Object.entries(TRACKERS).find(([domain]) =>
        details.url.includes(domain),
      );
      if (!match) return;

      const [domain, info] = match;
      const tOffset = Number(((now - session.start) / 1000).toFixed(1));
      const beforePrompt =
        !session.firstPromptTime || now < session.firstPromptTime;

      chrome.storage.local.get(["log"], (result) => {
        const log = result.log || [];
        log.push({
          ai: onAI,
          tracker: info.label,
          desc: info.desc,
          domain,
          time: now,
          tOffset,
          beforePrompt,
        });
        chrome.storage.local.set({ log });
        broadcast({ type: "tracker", ai: onAI });
      });
    });
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId >= 0 && pendingRequests.has(details.requestId)) {
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
    if (details.tabId >= 0 && pendingRequests.has(details.requestId)) {
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

// ── Live stream — mirrors chrome-extension/background.js exactly ──────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "live-network-stream") return;

  livePorts.add(port);

  ensureReady()
    .then(() => {
      port.postMessage({ type: "snapshot", history, summary: buildSummary() });
    })
    .catch((error) => {
      port.postMessage({
        type: "error",
        error: error?.message || String(error),
      });
    });

  port.onDisconnect.addListener(() => livePorts.delete(port));
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

  if (message?.type === "get-summary") {
    ensureReady()
      .then(() => sendResponse({ summary: buildSummary() }))
      .catch((error) =>
        sendResponse({ summary: null, error: error?.message || String(error) }),
      );
    return true;
  }

  if (message?.type === "clear-history") {
    ensureReady()
      .then(async () => {
        history = [];
        recentEvents.length = 0;
        pendingRequests.clear();
        for (const site of WATCHED_SITES) delete sessions[site];
        await chrome.storage.local.remove([STORAGE_KEY, "log", "sessions"]);
        updateBadge();
        broadcast({ type: "snapshot", history, summary: buildSummary() });
        sendResponse({ ok: true });
      })
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || String(error) }),
      );
    return true;
  }
});
