// ── storage-aggregator.js
// scheme outline and code written with help from copilot.
//────────────────────────────────────────────────────
// Persistent aggregation of network captures organized by date (daily rollups).
// Stores aggregations in chrome.storage.local for cross-session persistence.
//
// Schema: {
//   "aggregations": {
//     "2025-04-26": { // ISO date string (YYYY-MM-DD)
//       "total_captures": 42,
//       "platforms": {
//         "chatgpt": 25,
//         "claude": 17
//       },
//       "models": {
//         "gpt-4": 15,
//         "claude-3-opus": 12,
//         ...
//       },
//       "tools_invoked": {
//         "web_search": 8,
//         "code_interpreter": 5,
//         ...
//       },
//       "turn_use_cases": {
//         "text": 30,
//         "image": 8,
//         "video": 2,
//         "code": 2
//       },
//       "response_stats": {
//         "total_bytes": 1250000,
//         "total_chars": 85000,
//         "avg_bytes": 29761,
//         "avg_chars": 2023,
//         "max_bytes": 125000,
//         "min_bytes": 1200,
//         "total_sse_events": 8500
//       },
//       "latency_stats": {
//         "total_ttfb_ms": 125000,
//         "avg_ttfb_ms": 2976,
//         "max_ttfb_ms": 15000,
//         "min_ttfb_ms": 250
//       },
//       "prompt_stats": {
//         "total_length": 450000,
//         "avg_length": 10714,
//         "max_length": 50000,
//         "min_length": 10
//       },
//       "server_fetched_domains": {
//         "example.com": 5,
//         "api.example.com": 3,
//         ...
//       },
//       "last_updated": 1703107200000 // timestamp
//     }
//   }
// }

const AGGREGATIONS_STORAGE_KEY = "aggregations";

// returns todays date in YYYY-MM-DD format
function getTodayKey() {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

// load all aggregations from storage using STORAGE_KEY
async function loadAggregations() {
  const stored = await chrome.storage.local.get(AGGREGATIONS_STORAGE_KEY);
  return stored[AGGREGATIONS_STORAGE_KEY] || {};
}

// we want to do data aggregations each day, so we can display daily specifics, and trends over time.
function initializeDailyAggregation() {
  return {
    total_captures: 0,
    platforms: {},
    models: {},
    tools_invoked: {},
    turn_use_cases: {},
    response_stats: {
      total_bytes: 0,
      total_chars: 0,
      avg_bytes: 0,
      avg_chars: 0,
      max_bytes: 0,
      min_bytes: Infinity,
      total_sse_events: 0,
    },
    latency_stats: {
      total_ttfb_ms: 0,
      avg_ttfb_ms: 0,
      max_ttfb_ms: 0,
      min_ttfb_ms: Infinity,
    },
    prompt_stats: {
      total_length: 0,
      avg_length: 0,
      max_length: 0,
      min_length: Infinity,
    },
    server_fetched_domains: {},
    last_updated: Date.now(),
  };
}

// increments a counter in a nested object
function incrementCounter(obj, key, amount = 1) {
  obj[key] = (obj[key] || 0) + amount;
}

// capture request for today's aggregation
async function addCapture(payload) {
  const dateKey = getTodayKey();
  const aggregations = await loadAggregations();

  // Initialize today's aggregation if it doesn't exist
  if (!aggregations[dateKey]) {
    aggregations[dateKey] = initializeDailyAggregation();
  }

  const today = aggregations[dateKey];

  // Total captures
  today.total_captures++;

  // Platform counts
  if (payload.platform) {
    incrementCounter(today.platforms, payload.platform);
  }

  // Model slug counts
  if (payload.model_slug) {
    incrementCounter(today.models, payload.model_slug);
  }

  // Tool invocations
  if (payload.tool_invoked && payload.tool_name) {
    incrementCounter(today.tools_invoked, payload.tool_name);
  }

  // Turn use cases
  if (payload.turn_use_case) {
    incrementCounter(today.turn_use_cases, payload.turn_use_case);
  }

  // Response statistics
  if (typeof payload.response_bytes === "number") {
    today.response_stats.total_bytes += payload.response_bytes;
    today.response_stats.max_bytes = Math.max(
      today.response_stats.max_bytes,
      payload.response_bytes,
    );
    today.response_stats.min_bytes = Math.min(
      today.response_stats.min_bytes,
      payload.response_bytes,
    );
  }

  if (typeof payload.response_chars === "number") {
    today.response_stats.total_chars += payload.response_chars;
    today.response_stats.avg_chars =
      today.response_stats.total_chars / today.total_captures;
  }

  if (typeof payload.sse_event_count === "number") {
    today.response_stats.total_sse_events += payload.sse_event_count;
  }

  // Recalculate average bytes
  today.response_stats.avg_bytes =
    today.response_stats.total_bytes / today.total_captures;

  // Latency statistics
  if (typeof payload.ttfb_ms === "number") {
    today.latency_stats.total_ttfb_ms += payload.ttfb_ms;
    today.latency_stats.avg_ttfb_ms =
      today.latency_stats.total_ttfb_ms / today.total_captures;
    today.latency_stats.max_ttfb_ms = Math.max(
      today.latency_stats.max_ttfb_ms,
      payload.ttfb_ms,
    );
    today.latency_stats.min_ttfb_ms = Math.min(
      today.latency_stats.min_ttfb_ms,
      payload.ttfb_ms,
    );
  }

  // Prompt statistics
  if (typeof payload.prompt_length === "number") {
    today.prompt_stats.total_length += payload.prompt_length;
    today.prompt_stats.avg_length =
      today.prompt_stats.total_length / today.total_captures;
    today.prompt_stats.max_length = Math.max(
      today.prompt_stats.max_length,
      payload.prompt_length,
    );
    today.prompt_stats.min_length = Math.min(
      today.prompt_stats.min_length,
      payload.prompt_length,
    );
  }

  // Server-fetched domains (third-party tracking)
  if (Array.isArray(payload.server_fetched_urls)) {
    for (const fetchedUrl of payload.server_fetched_urls) {
      if (fetchedUrl.domain) {
        incrementCounter(today.server_fetched_domains, fetchedUrl.domain);
      }
    }
  }

  // Update timestamp
  today.last_updated = Date.now();

  // Clean up Infinity values
  if (today.response_stats.min_bytes === Infinity)
    today.response_stats.min_bytes = 0;
  if (today.latency_stats.min_ttfb_ms === Infinity)
    today.latency_stats.min_ttfb_ms = 0;
  if (today.prompt_stats.min_length === Infinity)
    today.prompt_stats.min_length = 0;

  // Save back to storage
  await chrome.storage.local.set({ [AGGREGATIONS_STORAGE_KEY]: aggregations });
}

// get aggregation on a specific date
async function getAggregation(dateKey) {
  const aggregations = await loadAggregations();
  return aggregations[dateKey] || null;
}

// get today's aggregation
async function getTodayAggregation() {
  return getAggregation(getTodayKey());
}

// retrieves all aggregations
async function getAllAggregations() {
  return loadAggregations();
}

// deletes an aggregation for a given date
async function deleteAggregation(dateKey) {
  const aggregations = await loadAggregations();
  delete aggregations[dateKey];
  await chrome.storage.local.set({ [AGGREGATIONS_STORAGE_KEY]: aggregations });
}

// resets all aggregations
async function clearAllAggregations() {
  await chrome.storage.local.set({ [AGGREGATIONS_STORAGE_KEY]: {} });
}

// exports aggregations as json incase other service workers need to use
async function exportAsJson() {
  const aggregations = await loadAggregations();
  return JSON.stringify(aggregations, null, 2);
}

// Export for use in other files (service worker context)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    addCapture,
    getAggregation,
    getTodayAggregation,
    getAllAggregations,
    deleteAggregation,
    clearAllAggregations,
    exportAsJson,
  };
}
