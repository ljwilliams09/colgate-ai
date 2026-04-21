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
const DISCONNECT_CACHE_AGE  = 7 * 24 * 60 * 60 * 1000; // refresh weekly

// domainMap: { "example.com": "Advertising" }
let domainMap = {};

async function loadDisconnectList() {
  // Try cache first
  const stored = await chrome.storage.local.get(DISCONNECT_CACHE_KEY);
  const cache  = stored[DISCONNECT_CACHE_KEY];
  if (cache && Date.now() - cache.fetchedAt < DISCONNECT_CACHE_AGE) {
    domainMap = cache.map;
    return;
  }

  try {
    const res  = await fetch(DISCONNECT_URL);
    const json = await res.json();
    const map  = {};

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
  [/monitor|sentry|datadog|newrelic|bugsnag|rollbar/i,   "monitoring"],
  [/ads\.|advert|doubleclick|pixel\.|pagead/i,           "advertising"],
  [/intercom|zendesk|freshdesk|helpscout/i,              "support"],
  [/hotjar|fullstory|logrocket|mouseflow/i,              "session recording"],
  [/segment\.|mixpanel|amplitude|heap\./i,               "analytics"],
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

// ── Third-party request buffer ─────────────────────────────────────────────

//right now it only does chatGPT and not calude!! 

const AI_DOMAINS       = ["chatgpt.com", "openai.com"];
const REQUEST_BUFFER_MS = 90_000;
const recentRequests   = []; // { domain, timestamp }

function isAiDomain(domain) {
  return AI_DOMAINS.some(d => domain === d || domain.endsWith("." + d));
}

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const now = Date.now();
    while (recentRequests.length && recentRequests[0].timestamp < now - REQUEST_BUFFER_MS) {
      recentRequests.shift();
    }
    try {
      const domain = new URL(details.url).hostname.replace(/^www\./, "");
      if (!domain || isAiDomain(domain)) return;
      recentRequests.push({ domain, timestamp: now });
    } catch (_) {}
  },
  { urls: ["<all_urls>"] }
);

function collectThirdParties(capturedAt) {
  const now  = Date.now();
  const seen = new Set();
  const out  = [];
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
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const STORAGE_KEY = "aiCaptureSends";
const MAX_SENDS   = 100;

let sends   = [];
let sendIdx = 0;

const ready = Promise.all([
  chrome.storage.local.get(STORAGE_KEY).then((result) => {
    sends   = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    sendIdx = sends.length;
    updateBadge();
  }),
  loadDisconnectList(),
]);

function updateBadge() {
  chrome.action.setBadgeBackgroundColor({ color: "#2f7f7b" });
  chrome.action.setBadgeText({ text: sends.length ? String(sends.length) : "" });
}

async function persist() {
  await chrome.storage.local.set({ [STORAGE_KEY]: sends });
  updateBadge();
  chrome.runtime.sendMessage({ type: "sends-updated" }).catch(() => {});
}

function ensureReady() { return ready; }

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
    ensureReady().then(() => { sendResponse({ sends }); });
    return true;
  }

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
