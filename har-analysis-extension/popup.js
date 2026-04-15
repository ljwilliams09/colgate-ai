// ── popup.js ──────────────────────────────────────────────────────────────
// Fetches stored send data from the background service worker and renders
// the dashboard. Uses the same color system and flow map layout as dashboard.html.

// ── Formatting helpers ────────────────────────────────────────────────────

function fmtBytes(bytes) {
  const v = Number(bytes);
  if (!v || v < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let s = v, i = 0;
  while (s >= 1024 && i < units.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(s >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// ── Dynamic turn-mode colors ──────────────────────────────────────────────
// Same palette and hash approach as dashboard.html — so the same category
// always gets the same color across both the extension and the static dashboard.

const PALETTE = [
  { bg: "#eef2ff", border: "#c0caff", color: "#3a4abd" },
  { bg: "#fff7e6", border: "#f5c876", color: "#7a4f00" },
  { bg: "#fff0f6", border: "#f5a0c8", color: "#7a0040" },
  { bg: "#edfaf3", border: "#7dd9a8", color: "#0a5c39" },
  { bg: "#f3edff", border: "#c8a8f5", color: "#4a0a7a" },
  { bg: "#fff4ed", border: "#f5b87a", color: "#7a3300" },
  { bg: "#edf8ff", border: "#7acef5", color: "#003a5c" },
  { bg: "#fdfaed", border: "#d4c876", color: "#5c4f00" },
];

const colorCache = {};

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getStyle(uc) {
  if (!colorCache[uc]) colorCache[uc] = PALETTE[hashStr(uc) % PALETTE.length];
  return colorCache[uc];
}

// ── Render ────────────────────────────────────────────────────────────────

const TOOL_SUBTITLE = {
  text:     "no tool / memory only",
  search:   "web search",
  shopping: "shopping mode",
};

function render(sends) {
  // Summary stats
  document.getElementById("totalSends").textContent = sends.length;

  const withTool  = sends.filter(s => s.tool_invoked);
  const ttfbVals  = sends.map(s => s.ttfb_ms).filter(v => v != null);

  document.getElementById("toolRate").textContent =
    sends.length ? Math.round((withTool.length / sends.length) * 100) + "%" : "—";

  document.getElementById("avgTtfb").textContent =
    ttfbVals.length
      ? Math.round(ttfbVals.reduce((a, b) => a + b, 0) / ttfbVals.length) + " ms"
      : "—";

  const section   = document.getElementById("flowSection");
  const emptyState = document.getElementById("emptyState");

  if (!sends.length) {
    emptyState.style.display = "";
    return;
  }

  emptyState.style.display = "none";

  // Build the flow map table
  let html = `
    <div class="flow-header">
      <div class="flow-col flow-col-prompt">Prompt</div>
      <div class="flow-col">Turn mode</div>
      <div class="flow-col">Tool</div>
      <div class="flow-col">Model</div>
      <div class="flow-col flow-col-resp">Response</div>
    </div>`;

  sends.forEach(d => {
    const uc      = (d.turn_use_case || "unknown").toLowerCase();
    const s       = getStyle(uc);
    const toolSub = TOOL_SUBTITLE[uc] || uc;
    const modelSub = d.tool_invoked ? "tool assisted" : "reasoning";
    const preview  = d.prompt_preview
      ? `"${esc(d.prompt_preview).slice(0, 40)}${d.prompt_preview.length > 40 ? "…" : ""}"`
      : "—";

    // Small platform indicator next to the send label
    const platformIcon = d.platform === "claude" ? "Claude" : "ChatGPT";

    html += `
      <div class="flow-row">
        <div class="flow-col flow-col-prompt">
          <div class="flow-prompt-text">${preview}</div>
          <div class="flow-sub">${esc(d.send_id)} · ${platformIcon}</div>
        </div>
        <div class="flow-col">
          <span class="use-case-pill" style="background:${s.bg};border-color:${s.border};color:${s.color}">
            ${esc(uc)}
          </span>
        </div>
        <div class="flow-col">
          ${d.tool_name
            ? `<div class="flow-main">${esc(d.tool_name)}</div><div class="flow-sub">${esc(toolSub)}</div>`
            : `<div class="flow-main" style="color:#aaa">no tool</div><div class="flow-sub">${esc(toolSub)}</div>`
          }
        </div>
        <div class="flow-col">
          ${d.model_slug
            ? `<div class="flow-main">${esc(d.model_slug)}</div><div class="flow-sub">${modelSub}</div>`
            : `<div class="flow-main" style="color:#aaa">—</div>`
          }
        </div>
        <div class="flow-col flow-col-resp">
          <div class="flow-main">${fmtBytes(d.response_bytes)}</div>
          <div class="flow-sub">TTFB ${d.ttfb_ms != null ? Math.round(d.ttfb_ms) + " ms" : "—"}</div>
        </div>
      </div>`;
  });

  // Replace only the rows, not the empty state element
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  // Remove old rows (everything except emptyState)
  [...section.children].forEach(child => {
    if (child.id !== "emptyState") child.remove();
  });
  section.prepend(...tempDiv.children);
}

// ── Load data from background ─────────────────────────────────────────────

async function load() {
  const response = await chrome.runtime.sendMessage({ type: "get-sends" });
  render(Array.isArray(response?.sends) ? response.sends : []);
}

// Clear button
document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-sends" });
  render([]);
  document.getElementById("emptyState").style.display = "";
});

// Auto-refresh when new data arrives while popup is open
chrome.storage.onChanged.addListener((changes) => {
  if (changes.aiCaptureSends) load().catch(() => {});
});

load().catch(() => {});
