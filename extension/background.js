// ── background.js (service worker) ───────────────────────────────────────
// Receives captured send data from relay.js, stores it in chrome.storage.local,
// and serves it to the side panel when requested.
// Also manages the badge count on the extension icon.
// Also tracks third-party domains per send using the Disconnect.me tracker list.
//Used AI to help code this!

// ── Disconnect.me tracker database ────────────────────────────────────────

const DISCONNECT_URL =
  "https://raw.githubusercontent.com/disconnectme/disconnect-tracking-protection/master/services.json";
const DISCONNECT_CACHE_KEY = "disconnectDomainMap";
const DISCONNECT_CACHE_AGE = 7 * 24 * 60 * 60 * 1000; // refresh weekly

// domainMap: { "example.com": "Advertising" }
let domainMap = {};

async function loadDisconnectList() {
  // Try cache first
  const stored = await chrome.storage.local.get(DISCONNECT_CACHE_KEY);
  const cache = stored[DISCONNECT_CACHE_KEY];
  if (cache && Date.now() - cache.fetchedAt < DISCONNECT_CACHE_AGE) {
    domainMap = cache.map;
    return;
  }

  try {
    const res = await fetch(DISCONNECT_URL);
    const json = await res.json();
    const map = {};

    for (const [category, companies] of Object.entries(json.categories || {})) {
      for (const company of Object.values(companies)) {
        for (const domains of Object.values(company)) {
          if (!Array.isArray(domains)) continue;
          for (const domain of domains) {
            map[domain.toLowerCase()] = category.toLowerCase();
          }
        }
      }
    }

    domainMap = map;
    await chrome.storage.local.set({
      [DISCONNECT_CACHE_KEY]: { map, fetchedAt: Date.now() },
    });
  } catch (e) {
    // Network failed — keep whatever was in domainMap (empty or stale cache)
    if (cache) domainMap = cache.map;
  }
}

//What do we think of this?? Is it too hardcoded?
// Keyword-based fallback for domains not in Disconnect list
const KEYWORD_RULES = [
  [/analytic|tracking|tracker|telemetr|beacon|stats\./i, "analytics"],
  [/monitor|sentry|datadog|newrelic|bugsnag|rollbar/i, "monitoring"],
  [/ads\.|advert|doubleclick|pixel\.|pagead/i, "advertising"],
  [/intercom|zendesk|freshdesk|helpscout/i, "support"],
  [/hotjar|fullstory|logrocket|mouseflow/i, "session recording"],
  [/segment\.|mixpanel|amplitude|heap\./i, "analytics"],
];

function categorizeDomain(domain) {
  const fromList = domainMap[domain];
  if (fromList) return fromList;
  // Check parent domain (e.g. sub.google-analytics.com)
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (domainMap[parent]) return domainMap[parent];
  }
  // Keyword fallback
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(domain)) return cat;
  }
  return "other";
}

// ── Tracker detection ─────────────────────────────────────────────────────────

const WATCHED_SITES = ["claude.ai", "chatgpt.com"];

const TRACKERS = {
  "connect.facebook.net":             { label: "Facebook (Meta)",    desc: "Ad behavior tracking" },
  "www.google-analytics.com":         { label: "Google Analytics",   desc: "Usage analytics" },
  "googletagmanager.com":             { label: "Google Tag Manager", desc: "Script injection" },
  "browser-intake-us5-datadoghq.com": { label: "Datadog",            desc: "Session monitoring" },
  "api-iam.intercom.io":              { label: "Intercom",           desc: "Live support connection" },
};

const PROMPT_PATTERNS = {
  "claude.ai":   /\/api\/.*\/completion|\/api\/.*\/messages/,
  "chatgpt.com": /\/backend-api\/conversation/,
};

const sessions = {};

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    chrome.tabs.get(details.tabId, (tab) => {
      if (chrome.runtime.lastError || !tab?.url) return;

      const onAI = WATCHED_SITES.find((s) => tab.url.includes(s));
      if (!onAI) return;

      const now = Date.now();
      if (!sessions[onAI]) {
        sessions[onAI] = { start: now, firstPromptTime: null };
        chrome.storage.local.set({ sessions });
      }
      const session = sessions[onAI];

      const promptPattern = PROMPT_PATTERNS[onAI];
      if (
        !session.firstPromptTime &&
        details.method === "POST" &&
        promptPattern?.test(details.url)
      ) {
        session.firstPromptTime = now;
        chrome.storage.local.set({ sessions });
      }

      const match = Object.entries(TRACKERS).find(([domain]) =>
        details.url.includes(domain),
      );
      if (!match) return;

      const [domain, info] = match;
      const tOffset = Number(((now - session.start) / 1000).toFixed(1));
      const beforePrompt = !session.firstPromptTime || now < session.firstPromptTime;

      chrome.storage.local.get(["trackerLog"], (result) => {
        const log = result.trackerLog || [];
        log.push({ ai: onAI, tracker: info.label, desc: info.desc, domain, time: now, tOffset, beforePrompt });
        chrome.storage.local.set({ trackerLog: log });
        chrome.runtime.sendMessage({ type: "trackers-updated" }).catch(() => {});
      });
    });
  },
  { urls: ["<all_urls>"] },
);

// ── Third-party request buffer ─────────────────────────────────────────────

//right now it only does chatGPT and not claude!!

const AI_DOMAINS = ["chatgpt.com", "openai.com", "claude.ai", "anthropic.com"];
const REQUEST_BUFFER_MS = 90_000;
const recentRequests = []; // { domain, timestamp }

function isAiDomain(domain) {
  return AI_DOMAINS.some((d) => domain === d || domain.endsWith("." + d));
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const now = Date.now();
    while (
      recentRequests.length &&
      recentRequests[0].timestamp < now - REQUEST_BUFFER_MS
    ) {
      recentRequests.shift();
    }
    try {
      const domain = new URL(details.url).hostname.replace(/^www\./, "");
      if (!domain || isAiDomain(domain)) return;
      recentRequests.push({ domain, timestamp: now });
    } catch (_) {}
  },
  { urls: ["<all_urls>"] },
);

function collectThirdParties(capturedAt) {
  const now = Date.now();
  const seen = new Set();
  const out = [];
  for (const r of recentRequests) {
    if (r.timestamp < capturedAt || r.timestamp > now) continue;
    if (seen.has(r.domain)) continue;
    seen.add(r.domain);
    out.push({ domain: r.domain, category: categorizeDomain(r.domain) });
  }
  return out;
}

// ── Extension core ─────────────────────────────────────────────────────────

// Open the side panel when the extension icon is clicked
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

const STORAGE_KEY = "aiCaptureSends";
const MAX_SENDS = 100;

let sends = [];
let sendIdx = 0;

const ready = Promise.all([
  chrome.storage.local.get([STORAGE_KEY, "sessions"]).then((result) => {
    sends = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    sendIdx = sends.length;
    Object.assign(sessions, result.sessions || {});
    updateBadge();
  }),
  loadDisconnectList(),
]);

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#2f7f7b" });
  chrome.action.setBadgeText({
    text: sends.length ? String(sends.length) : "",
  });
}

async function persist() {
  await chrome.storage.local.set({ [STORAGE_KEY]: sends });
  updateBadge();
  chrome.runtime.sendMessage({ type: "sends-updated" }).catch(() => {});
}

function ensureReady() {
  return ready;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "ai-capture") {
    ensureReady().then(() => {
      sendIdx++;
      const record = {
        send_id: `send${sendIdx}`,
        ...message.payload,
        third_party_contacts: collectThirdParties(message.payload.capturedAt),
      };
      sends.unshift(record);
      if (sends.length > MAX_SENDS) sends = sends.slice(0, MAX_SENDS);
      persist().catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "get-sends") {
    ensureReady().then(() => {
      sendResponse({ sends });
    });
    return true;
  }

  if (message.type === "clear-sends") {
    ensureReady().then(async () => {
      sends = [];
      sendIdx = 0;
      await chrome.storage.local.remove(STORAGE_KEY);
      updateBadge();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "get-tracker-log") {
    ensureReady().then(() => {
      chrome.storage.local.get(["trackerLog", "sessions"], (result) => {
        sendResponse({ log: result.trackerLog || [], sessions: result.sessions || {} });
      });
    });
    return true;
  }

  if (message.type === "clear-tracker-log") {
    ensureReady().then(async () => {
      for (const site of WATCHED_SITES) delete sessions[site];
      await chrome.storage.local.remove(["trackerLog", "sessions"]);
      chrome.runtime.sendMessage({ type: "trackers-updated" }).catch(() => {});
      sendResponse({ ok: true });
    });
    return true;
  }
});
