// ── sidepanel.js ──────────────────────────────────────────────────────────

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

const PALETTE = [
  { bg: "#1a1333", border: "#6d28d9", color: "#c4b5fd" },
  { bg: "#0f1e2e", border: "#1e4d6b", color: "#7dd3fc" },
  { bg: "#1a1130", border: "#5b21b6", color: "#a78bfa" },
  { bg: "#0e1f1a", border: "#065f46", color: "#6ee7b7" },
  { bg: "#1e1030", border: "#7c3aed", color: "#ddd6fe" },
  { bg: "#1a1020", border: "#9d174d", color: "#f9a8d4" },
  { bg: "#0f1e2e", border: "#0369a1", color: "#38bdf8" },
  { bg: "#1a1333", border: "#4c1d95", color: "#e9d5ff" },
];
const colorCache = {};
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function getStyle(uc) {
  if (!colorCache[uc]) colorCache[uc] = PALETTE[hashStr(uc) % PALETTE.length];
  return colorCache[uc];
}

function toolSubtitle(uc) {
  return uc.replace(/_/g, " ");
}

function buildCard(d) {
  const uc       = (d.turn_use_case || "unknown").toLowerCase();
  const s        = getStyle(uc);
  const toolSub  = toolSubtitle(uc);
  const platform = d.platform === "claude" ? "Claude" : "ChatGPT";
  const preview  = d.prompt_preview
    ? `"${esc(d.prompt_preview).slice(0, 60)}${d.prompt_preview.length > 60 ? "…" : ""}"`
    : "<em style='color:#bbb'>no prompt captured</em>";

  // Turn mode pill
  const modePill = `<span class="pill" style="background:${s.bg};border-color:${s.border};color:${s.color}">
    <span class="pill-label">${esc(uc)}</span>
    <span class="pill-sub">turn mode</span>
  </span>`;

  // Tool pill
  const toolPill = d.tool_name
    ? `<span class="pill" style="background:${s.bg};border-color:${s.border};color:${s.color}">
        <span class="pill-label">${esc(d.tool_name)}</span>
        <span class="pill-sub">${esc(toolSub)}</span>
       </span>`
    : `<span class="pill pill-no-tool">
        <span class="pill-label">no tool</span>
        <span class="pill-sub">${esc(toolSub)}</span>
       </span>`;

  // Model pill
  const modelPill = d.model_slug
    ? `<span class="pill pill-model">
        <span class="pill-label">${esc(d.model_slug)}</span>
        <span class="pill-sub">${d.tool_invoked ? "tool assisted" : "reasoning"}</span>
       </span>`
    : "";

  // Third-party contacts section
  const contacts = Array.isArray(d.third_party_contacts) ? d.third_party_contacts : [];
  const thirdPartyHtml = contacts.length
    ? `<div class="card-third-parties">
        <div class="tp-label">Third-party contacts (${contacts.length})</div>
        <div class="tp-list">
          ${contacts.map(c => `
            <span class="tp-chip">
              <span class="tp-domain">${esc(c.domain)}</span>
              <span class="tp-cat">${esc(c.category)}</span>
            </span>`).join("")}
        </div>
       </div>`
    : `<div class="card-third-parties tp-none">No third-party contacts detected</div>`;

  return `
    <div class="send-card">
      <div class="card-top">
        <div class="card-prompt">${preview}</div>
        <div class="card-response">
          <div class="card-response-size">${fmtBytes(d.response_bytes)}</div>
          <div class="card-ttfb" title="Time To First Byte — how long from sending your message until the AI started responding">TTFB ${d.ttfb_ms != null ? Math.round(d.ttfb_ms) + " ms" : "—"}</div>
        </div>
      </div>
      <div class="card-meta">${modePill}${toolPill}${modelPill}</div>
      ${thirdPartyHtml}
      <div class="card-footer">${esc(d.send_id)} · ${platform}</div>
    </div>`;
}

function renderToolBreakdown(sends) {
  const container = document.getElementById("toolBreakdown");
  if (!sends.length) { container.innerHTML = ""; return; }

  // Group sends by turn_use_case
  const groups = {};
  for (const s of sends) {
    const key = (s.turn_use_case || "unknown").toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }

  const rows = Object.entries(groups).map(([uc, items]) => {
    const style    = getStyle(uc);
    const avgTtfb  = Math.round(items.map(s => s.ttfb_ms).filter(Boolean).reduce((a, b) => a + b, 0) / (items.filter(s => s.ttfb_ms != null).length || 1));
    const avgBytes = Math.round(items.map(s => s.response_bytes || 0).reduce((a, b) => a + b, 0) / items.length);
    const subtitle = toolSubtitle(uc);
    return `
      <div class="tb-row">
        <span class="tb-pill" style="background:${style.bg};border-color:${style.border};color:${style.color}">${esc(uc)}</span>
        <span class="tb-sub">${esc(subtitle)}</span>
        <span class="tb-count">${items.length} send${items.length !== 1 ? "s" : ""}</span>
        <span class="tb-metric" title="Average time to first byte for this tool">${avgTtfb} ms</span>
        <span class="tb-metric">${fmtBytes(avgBytes)}</span>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="tool-breakdown">
      <div class="tb-header">Breakdown by tool</div>
      ${rows}
    </div>`;
}

function render(sends) {
  document.getElementById("totalSends").textContent = sends.length;

  const withTool = sends.filter(s => s.tool_invoked);
  const ttfbVals = sends.map(s => s.ttfb_ms).filter(v => v != null);

  document.getElementById("toolRate").textContent =
    sends.length ? Math.round((withTool.length / sends.length) * 100) + "%" : "—";
  document.getElementById("avgTtfb").textContent =
    ttfbVals.length
      ? Math.round(ttfbVals.reduce((a, b) => a + b, 0) / ttfbVals.length) + " ms"
      : "—";

  const tpCounts = sends.map(s => (s.third_party_contacts || []).length);
  document.getElementById("avgThirdParties").textContent =
    tpCounts.length
      ? (tpCounts.reduce((a, b) => a + b, 0) / tpCounts.length).toFixed(1)
      : "—";

  renderToolBreakdown(sends);

  const cards      = document.getElementById("cards");
  const emptyState = document.getElementById("emptyState");

  if (!sends.length) {
    if (emptyState) emptyState.style.display = "";
    [...cards.children].forEach(c => { if (c.id !== "emptyState") c.remove(); });
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  cards.innerHTML = sends.map(buildCard).join("");
}

async function load() {
  const response = await chrome.runtime.sendMessage({ type: "get-sends" });
  render(Array.isArray(response?.sends) ? response.sends : []);
}

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-sends" });
  render([]);
});

// Auto-refresh when the background notifies us of a new send
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "sends-updated") load().catch(() => {});
});

load().catch(() => {});
