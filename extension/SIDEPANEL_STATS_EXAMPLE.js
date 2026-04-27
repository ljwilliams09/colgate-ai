// ── EXAMPLE: Adding aggregation stats to sidepanel.js ────────────────────

// Add this to the top of your sidepanel.js (after existing utility functions)

/**
 * Display aggregation stats banner at the top of sidepanel
 */
async function renderAggregationBanner() {
  const stats = await getTodayStats();
  if (!stats) return;

  const bannerHtml = `
    <div style="
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      color: white;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    ">
      <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">
        📊 Today's AI Activity
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
        <div>
          <span style="opacity: 0.9;">Total Requests</span><br/>
          <span style="font-size: 18px; font-weight: bold;">${stats.total_captures}</span>
        </div>
        <div>
          <span style="opacity: 0.9;">Avg Response</span><br/>
          <span style="font-size: 18px; font-weight: bold;">
            ${Math.round(stats.response_stats.avg_bytes / 1024)}KB
          </span>
        </div>
        <div>
          <span style="opacity: 0.9;">Avg Latency</span><br/>
          <span style="font-size: 18px; font-weight: bold;">
            ${Math.round(stats.latency_stats.avg_ttfb_ms)}ms
          </span>
        </div>
        <div>
          <span style="opacity: 0.9;">Top Model</span><br/>
          <span style="font-size: 18px; font-weight: bold;">
            ${Object.keys(stats.models).length} models
          </span>
        </div>
      </div>
      
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px;">
        <strong>Platforms:</strong>
        ${Object.entries(stats.platforms)
          .map(([p, c]) => `${p === "chatgpt" ? "🟢" : "🟣"} ${p}: ${c}`)
          .join(" • ")}
      </div>

      <div style="margin-top: 8px; font-size: 11px;">
        <strong>Tools Used:</strong>
        ${
          Object.entries(stats.tools_invoked).length > 0
            ? Object.entries(stats.tools_invoked)
                .slice(0, 3)
                .map(([tool, count]) => `${tool} (${count})`)
                .join(" • ")
            : "None"
        }
      </div>
    </div>
  `;

  const container =
    document.getElementById("stats-banner") || document.createElement("div");
  container.id = "stats-banner";
  container.innerHTML = bannerHtml;

  const parent = document.querySelector("body") || document.documentElement;
  if (!document.getElementById("stats-banner")) {
    parent.insertBefore(container, parent.firstChild);
  }
}

/**
 * Create a detailed stats breakdown modal
 */
async function showDetailedStats() {
  const allStats = await getAllStats();
  if (Object.keys(allStats).length === 0) {
    alert("No aggregation data yet. Make some AI requests first!");
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const todayStats = allStats[today];

  const html = `
    <div style="
      max-width: 600px;
      margin: 20px auto;
      padding: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1);
    ">
      <h2 style="margin-top: 0; color: #333;">📈 Detailed Statistics</h2>
      
      <h3 style="color: #667eea; margin-top: 24px;">Today (${today})</h3>
      <div style="background: #f5f7fa; padding: 12px; border-radius: 6px; font-size: 13px; line-height: 1.8;">
        <div><strong>Total Captures:</strong> ${todayStats.total_captures}</div>
        <div><strong>Response Stats:</strong></div>
        <ul style="margin: 4px 0; padding-left: 20px;">
          <li>Total bytes: ${(todayStats.response_stats.total_bytes / 1024 / 1024).toFixed(2)}MB</li>
          <li>Avg: ${Math.round(todayStats.response_stats.avg_bytes)}B | 
              Max: ${todayStats.response_stats.max_bytes} | 
              Min: ${todayStats.response_stats.min_bytes}</li>
        </ul>
        <div><strong>Latency:</strong></div>
        <ul style="margin: 4px 0; padding-left: 20px;">
          <li>Avg: ${Math.round(todayStats.latency_stats.avg_ttfb_ms)}ms | 
              Max: ${todayStats.latency_stats.max_ttfb_ms}ms</li>
        </ul>
        <div><strong>Prompts:</strong></div>
        <ul style="margin: 4px 0; padding-left: 20px;">
          <li>Total chars: ${todayStats.prompt_stats.total_length} | 
              Avg: ${Math.round(todayStats.prompt_stats.avg_length)} chars</li>
        </ul>
      </div>

      <h3 style="color: #667eea; margin-top: 24px;">Models</h3>
      <div style="background: #f5f7fa; padding: 12px; border-radius: 6px; font-size: 13px;">
        ${Object.entries(todayStats.models)
          .sort(([, a], [, b]) => b - a)
          .map(
            ([model, count]) =>
              `<div style="margin: 4px 0;">
              <strong>${model}</strong>: <span style="color: #667eea; font-weight: bold;">${count}</span>
            </div>`,
          )
          .join("")}
      </div>

      <h3 style="color: #667eea; margin-top: 24px;">Third-party Domains</h3>
      <div style="background: #f5f7fa; padding: 12px; border-radius: 6px; font-size: 12px;">
        ${Object.entries(todayStats.server_fetched_domains)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 10)
          .map(
            ([domain, count]) =>
              `<div style="margin: 4px 0; word-break: break-all;">
              ${domain} <span style="color: #999;">(${count})</span>
            </div>`,
          )
          .join("")}
      </div>

      <button onclick="this.parentElement.style.display='none'" style="
        margin-top: 16px;
        padding: 8px 16px;
        background: #667eea;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      ">Close</button>
    </div>
  `;

  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.cssText =
    "position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;";
  document.body.appendChild(container);
  container.onclick = () => container.remove();
}

/**
 * Export and download aggregations as JSON
 */
async function downloadAggregations() {
  const json = await exportStats();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ai-aggregations-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Initialize sidebar with aggregation stats
 * Call this when sidepanel loads
 */
async function initializeWithStats() {
  try {
    await renderAggregationBanner();

    // Refresh stats every 30 seconds
    setInterval(() => renderAggregationBanner(), 30000);

    // Add a button to show detailed stats
    const detailsBtn = document.createElement("button");
    detailsBtn.textContent = "📊 Detailed Stats";
    detailsBtn.onclick = showDetailedStats;
    detailsBtn.style.cssText = `
      margin: 8px;
      padding: 8px 12px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    const downloadBtn = document.createElement("button");
    downloadBtn.textContent = "⬇️ Download";
    downloadBtn.onclick = downloadAggregations;
    downloadBtn.style.cssText = `
      margin: 8px;
      padding: 8px 12px;
      background: #10b981;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    `;

    // Find or create button container
    let btnContainer = document.getElementById("stats-controls");
    if (!btnContainer) {
      btnContainer = document.createElement("div");
      btnContainer.id = "stats-controls";
      btnContainer.style.cssText = "margin: 8px 0;";
      document.body.insertBefore(
        btnContainer,
        document.body.firstChild?.nextSibling,
      );
    }

    btnContainer.appendChild(detailsBtn);
    btnContainer.appendChild(downloadBtn);
  } catch (e) {
    console.error("Error initializing stats:", e);
  }
}

// Call when sidepanel loads
// document.addEventListener('DOMContentLoaded', initializeWithStats);
// OR if already loading:
// initializeWithStats();
