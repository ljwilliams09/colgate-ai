# Persistent Network Aggregations Guide

## Overview

Your extension now captures AI network traffic and automatically stores **aggregated statistics** that persist across browser sessions. Data is grouped by day and stored in `chrome.storage.local`, which survives extension updates and browser restarts.

## Architecture

```
fetch-interceptor.js (captures requests)
    ↓ postMessage
relay.js (bridge to chrome APIs)
    ↓ chrome.runtime.sendMessage
background.js (service worker)
    ↓ addCapture()
storage-aggregator.js (daily aggregations in chrome.storage.local)
    ↓
sidepanel.js (query via aggregation-api.js)
```

## Data Stored Per Day

Each day's aggregation includes:

### Counters

- **total_captures**: Total number of requests captured
- **platforms**: Breakdown by ChatGPT vs Claude
- **models**: Usage count per model slug (gpt-4, claude-3-opus, etc.)
- **tools_invoked**: Which tools were used (web_search, code_interpreter, etc.)
- **turn_use_cases**: Type breakdown (text, image, video, code)
- **server_fetched_domains**: Third-party domains contacted (with counts)

### Response Statistics

- **total_bytes**: Sum of all response bytes
- **total_chars**: Sum of all response characters
- **avg_bytes**: Average response size
- **max_bytes / min_bytes**: Response size range
- **total_sse_events**: Total SSE stream events

### Latency Statistics

- **total_ttfb_ms**: Sum of time-to-first-byte
- **avg_ttfb_ms**: Average latency
- **max_ttfb_ms / min_ttfb_ms**: Latency range

### Prompt Statistics

- **total_length**: Sum of prompt characters sent
- **avg_length**: Average prompt size
- **max_length / min_length**: Prompt size range

## Usage Examples

### In your sidepanel (sidepanel.js):

```javascript
// Import the API
<script src="aggregation-api.js"></script>;

// Get today's stats
const todayStats = await getTodayStats();
console.log(`Today: ${todayStats.total_captures} requests`);
console.log(`Models:`, todayStats.models);

// Display in DOM
document.getElementById("stats").innerHTML = `
  <h3>Today's AI Activity</h3>
  <p>Requests: ${todayStats.total_captures}</p>
  <p>Avg Response: ${Math.round(todayStats.response_stats.avg_bytes)} bytes</p>
  <p>Avg Latency: ${Math.round(todayStats.latency_stats.avg_ttfb_ms)}ms</p>
`;

// Get all dates for a history view
const allStats = await getAllStats();
Object.entries(allStats).forEach(([date, agg]) => {
  console.log(`${date}: ${agg.total_captures} requests`);
});

// Export for external analysis
const json = await exportStats();
const blob = new Blob([json], { type: "application/json" });
// save to file, send to server, etc.
```

### In your data_capture pipeline:

```javascript
// Export aggregations to JSON
const aggregationJson = await chrome.runtime.sendMessage({
  type: "export-aggregations"
});

// Combine with individual request data
const allData = {
  individual_requests: /* from existing data */,
  daily_aggregations: JSON.parse(aggregationJson.json)
};

// Write to CSV or your database
fs.writeFileSync('aggregations.json', JSON.stringify(allData, null, 2));
```

## Storage Details

### Storage Key

- Key: `"aggregations"`
- Limit: ~10MB (Chrome extension local storage limit)
- Persistence: Survives extension updates, browser restarts

### Storage Schema Example

```json
{
  "aggregations": {
    "2025-04-26": {
      "total_captures": 42,
      "platforms": { "chatgpt": 25, "claude": 17 },
      "models": { "gpt-4": 15, "claude-3-opus": 12 },
      "tools_invoked": { "web_search": 8 },
      "turn_use_cases": { "text": 30, "image": 8 },
      "response_stats": { ... },
      "latency_stats": { ... },
      "prompt_stats": { ... },
      "server_fetched_domains": { ... },
      "last_updated": 1703107200000
    }
  }
}
```

## Real-time Updates

The aggregation is **updated in real-time** after each capture:

1. A request to ChatGPT/Claude is made
2. `fetch-interceptor.js` captures it
3. `relay.js` forwards via `chrome.runtime.sendMessage`
4. `background.js` receives and:
   - Stores the full request (existing behavior)
   - Calls `addCapture(payload)` to update daily aggregation
5. Stats are immediately available to sidepanel

## API Reference

All functions in `aggregation-api.js`:

```javascript
await getTodayStats(); // Get today's aggregation
await getStatsForDate("2025-04-26"); // Get specific date
await getAllStats(); // Get all dates
await exportStats(); // Export all as JSON
await clearStats(); // Delete all aggregations
formatAggregation(agg); // Format for display
```

## Integration with Your Data Pipeline

### Option 1: Real-time Export

Add to sidepanel or background.js:

```javascript
// Periodically export aggregations
setInterval(async () => {
  const json = await exportStats();
  // POST to your backend or save locally
}, 60000); // Every minute
```

### Option 2: Daily Export

```javascript
// Check if day changed, export yesterday if so
let lastExportDate = getTodayKey();
setInterval(async () => {
  const today = getTodayKey();
  if (today !== lastExportDate) {
    const yesterday = new Date(Date.now() - 86400000)
      .toISOString()
      .split("T")[0];
    const stats = await getStatsForDate(yesterday);
    // Upload or process stats
    lastExportDate = today;
  }
}, 60000);
```

### Option 3: CSV Export (via data_capture)

```javascript
// In your data_capture/capture.js
const aggregations = await chrome.runtime.sendMessage({
  type: "export-aggregations",
});

const csv = convertToCsv(JSON.parse(aggregations.json));
fs.writeFileSync("data/aggregations_export.csv", csv);
```

## Debugging

### Check storage in DevTools

1. Open extension background page
2. DevTools → Application → Storage → chrome.storage.local
3. Look for key: `"aggregations"`

### View today's aggregation

In browser console (on extension background page):

```javascript
const result = await chrome.storage.local.get("aggregations");
console.log(result.aggregations[new Date().toISOString().split("T")[0]]);
```

### Clear aggregations

```javascript
await chrome.runtime.sendMessage({ type: "clear-aggregations" });
// Or manually: chrome.storage.local.remove('aggregations');
```

## Retention & Cleanup

Currently, aggregations persist indefinitely. If you want automatic cleanup:

```javascript
// Add to storage-aggregator.js
const RETENTION_DAYS = 30;

async function cleanupOldAggregations() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

  const aggregations = await loadAggregations();
  for (const dateKey of Object.keys(aggregations)) {
    if (new Date(dateKey) < cutoff) {
      delete aggregations[dateKey];
    }
  }
  await chrome.storage.local.set({ STORAGE_KEY: aggregations });
}

// Call weekly
setInterval(cleanupOldAggregations, 7 * 24 * 60 * 60 * 1000);
```

## Next Steps

1. **Sidepanel dashboard**: Use `aggregation-api.js` to create a stats dashboard
2. **Data export**: Periodically export aggregations to your data_capture pipeline
3. **Analysis**: Aggregate weekly/monthly summaries
4. **Alerts**: Trigger notifications on usage thresholds
5. **Backend sync**: Send aggregations to a server database for cross-device analysis
