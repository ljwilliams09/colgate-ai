// ── aggregation-api.js ───────────────────────────────────────────────────────
// Client-side API for querying aggregations from the sidepanel.
// These functions communicate with background.js via chrome.runtime.sendMessage()

// gets the aggregation statistics for a given day
async function getTodayStats() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "get-today-aggregation" },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response?.aggregation || null);
        }
      },
    );
  });
}

// gets aggregation statistics for a given date
async function getStatsForDate(dateKey) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "get-aggregation", date: dateKey },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response?.aggregation || null);
        }
      },
    );
  });
}

// gets all aggregation statistics
async function getAllStats() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "get-all-aggregations" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response?.aggregations || {});
      }
    });
  });
}

// exports all aggregation statistics
async function exportStats() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "export-aggregations" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response?.json || "{}");
      }
    });
  });
}

// clears all stats
async function clearStats() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "clear-aggregations" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response?.ok === true);
      }
    });
  });
}

// formats for the display
function formatAggregation(agg) {
  if (!agg) return null;
  return {
    date: new Date(agg.last_updated).toLocaleDateString(),
    total_captures: agg.total_captures,
    platforms: agg.platforms,
    models: Object.entries(agg.models)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5), // top 5
    avg_response_bytes: Math.round(agg.response_stats.avg_bytes),
    avg_latency_ms: Math.round(agg.latency_stats.avg_ttfb_ms),
    tools: agg.tools_invoked,
  };
}
