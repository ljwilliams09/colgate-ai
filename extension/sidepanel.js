// ── sidepanel.js ──────────────────────────────────────────────────────────

function fmtBytes(bytes) {
  const v = Number(bytes);
  if (!v || v < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let s = v;
  let i = 0;
  while (s >= 1024 && i < units.length - 1) {
    s /= 1024;
    i++;
  }
  return `${s.toFixed(s >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function topEntries(obj, limit = 5) {
  return Object.entries(obj || {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}

function setMiniList(elId, entries, emptyText = "No data yet") {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = `<div class="empty">${esc(emptyText)}</div>`;
    return;
  }

  el.innerHTML = entries
    .map(
      ([label, value]) =>
        `<div class="mini-row"><span class="mini-label">${esc(label)}</span><span class="mini-value">${esc(value)}</span></div>`,
    )
    .join("");
}

const PALETTE = [
  { bg: "#18304a", border: "#2f6b93", color: "#9fe2ff" },
  { bg: "#1f2f22", border: "#3d8450", color: "#b5ffc8" },
  { bg: "#3a2917", border: "#9d6d2c", color: "#ffd9a0" },
  { bg: "#302148", border: "#6f49a6", color: "#d5b5ff" },
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

function buildCard(d) {
  const uc = (d.turn_use_case || "unknown").toLowerCase();
  const s = getStyle(uc);
  const platform = d.platform === "claude" ? "Claude" : "ChatGPT";
  const preview = d.prompt_preview
    ? `\"${esc(d.prompt_preview).slice(0, 64)}${d.prompt_preview.length > 64 ? "..." : ""}\"`
    : "<em style='color:#bbb'>no prompt captured</em>";

  const modePill = `<span class="pill" style="background:${s.bg};border-color:${s.border};color:${s.color}">
    <span class="pill-label">${esc(uc)}</span>
    <span class="pill-sub">turn mode</span>
  </span>`;

  const toolPill = d.tool_name
    ? `<span class="pill" style="background:${s.bg};border-color:${s.border};color:${s.color}">
        <span class="pill-label">${esc(d.tool_name)}</span>
        <span class="pill-sub">tool</span>
       </span>`
    : `<span class="pill pill-no-tool">
        <span class="pill-label">no tool</span>
        <span class="pill-sub">turn</span>
       </span>`;

  const modelPill = d.model_slug
    ? `<span class="pill pill-model">
        <span class="pill-label">${esc(d.model_slug)}</span>
        <span class="pill-sub">model</span>
       </span>`
    : "";

  const contacts = Array.isArray(d.third_party_contacts)
    ? d.third_party_contacts
    : [];
  const thirdPartyHtml = contacts.length
    ? `<div class="card-third-parties">
        <div class="tp-label">Third-party contacts (${contacts.length})</div>
        <div class="tp-list">
          ${contacts
            .slice(0, 4)
            .map(
              (c) =>
                `<span class="tp-chip"><span class="tp-domain">${esc(c.domain)}</span><span class="tp-cat">${esc(c.category)}</span></span>`,
            )
            .join("")}
        </div>
       </div>`
    : `<div class="card-third-parties tp-none">No third-party contacts detected</div>`;

  return `
    <div class="send-card">
      <div class="card-top">
        <div class="card-prompt">${preview}</div>
        <div class="card-response">
          <div class="card-response-size">${fmtBytes(d.response_bytes)}</div>
          <div class="card-ttfb">TTFB ${d.ttfb_ms != null ? Math.round(d.ttfb_ms) + " ms" : "-"}</div>
        </div>
      </div>
      <div class="card-meta">${modePill}${toolPill}${modelPill}</div>
      ${thirdPartyHtml}
      <div class="card-footer">${esc(d.send_id)} · ${platform}</div>
    </div>`;
}

function renderOverview(sends, todayAgg) {
  const withTool = sends.filter((s) => s.tool_invoked);
  const ttfbVals = sends.map((s) => s.ttfb_ms).filter((v) => v != null);
  const tpCounts = sends.map((s) => (s.third_party_contacts || []).length);
  const promptsToday = Number(todayAgg?.total_captures || 0) || sends.length;
  const promptStats = todayAgg?.prompt_stats || {};
  const responseStats = todayAgg?.response_stats || {};
  const totalResponseChars =
    Number(responseStats.total_chars || 0) ||
    sends.reduce((sum, s) => sum + (Number(s.response_chars) || 0), 0);
  const responsePages =
    totalResponseChars > 0
      ? (totalResponseChars / 2500).toFixed(totalResponseChars < 2500 ? 2 : 1)
      : "-";
  const avgPromptLength = Number(promptStats.avg_length || 0);
  const promptRange =
    promptStats.max_length != null && promptStats.min_length != null
      ? `${promptStats.min_length}–${promptStats.max_length}`
      : "-";
  const avgResponseBytes = Number(responseStats.avg_bytes || 0);
  const sseEvents = Number(responseStats.total_sse_events || 0);

  document.getElementById("totalSends").textContent = sends.length;
  document.getElementById("promptsToday").textContent = String(promptsToday);
  document.getElementById("toolRate").textContent = sends.length
    ? `${Math.round((withTool.length / sends.length) * 100)}%`
    : "-";
  document.getElementById("avgTtfb").textContent = ttfbVals.length
    ? `${Math.round(ttfbVals.reduce((a, b) => a + b, 0) / ttfbVals.length)} ms`
    : "-";
  document.getElementById("avgThirdParties").textContent = tpCounts.length
    ? (tpCounts.reduce((a, b) => a + b, 0) / tpCounts.length).toFixed(1)
    : "-";
  document.getElementById("responsePages").textContent =
    responsePages === "-" ? "-" : `~${responsePages}`;
  document.getElementById("avgPromptLength").textContent = avgPromptLength
    ? `${Math.round(avgPromptLength)} chars`
    : "-";
  document.getElementById("promptRange").textContent = promptRange;
  document.getElementById("avgResponseBytes").textContent = avgResponseBytes
    ? `${fmtBytes(Math.round(avgResponseBytes))}`
    : "-";
  document.getElementById("sseEvents").textContent = sseEvents
    ? `${sseEvents}`
    : "-";
}

function renderLivestream(sends) {
  const cards = document.getElementById("livestreamCards");
  if (!cards) return;

  if (!sends.length) {
    cards.innerHTML = `<div class="empty">No sends captured yet.<br>Chat with ChatGPT or Claude and it will show up here.</div>`;
    return;
  }

  cards.innerHTML = sends.slice(0, 5).map(buildCard).join("");
}

function renderSpecifics(todayAgg, sends) {
  const agg = todayAgg || {};
  setMiniList(
    "modelsList",
    topEntries(agg.models, 8).map(([k, v]) => [k, `${v}`]),
    "No model data yet",
  );
  setMiniList(
    "toolsList",
    topEntries(agg.tools_invoked, 8).map(([k, v]) => [k, `${v}`]),
    "No tool usage yet",
  );
  setMiniList(
    "platformList",
    topEntries(agg.platforms, 4).map(([k, v]) => [k, `${v}`]),
    "No platform data yet",
  );

  const domainMap = {};
  for (const s of sends) {
    const contacts = Array.isArray(s.third_party_contacts)
      ? s.third_party_contacts
      : [];
    for (const c of contacts) {
      domainMap[c.domain] = (domainMap[c.domain] || 0) + 1;
    }
  }
  setMiniList(
    "domainList",
    topEntries(domainMap, 8).map(([k, v]) => [k, `${v}`]),
    "No third-party domains seen",
  );
}

function formatDayLabel(dayKey) {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function renderTimewise(allAggs) {
  const timeline = document.getElementById("timeline");
  const rows = Object.entries(allAggs || {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  if (!rows.length) {
    timeline.innerHTML = `<div class="empty">No daily rollups yet.<br>Start chatting to build your timewise panel.</div>`;
    return;
  }

  const maxCaptures = Math.max(
    ...rows.map(([, agg]) => agg.total_captures || 0),
    1,
  );
  timeline.innerHTML = rows
    .map(([day, agg]) => {
      const captures = agg.total_captures || 0;
      const width = Math.max(4, Math.round((captures / maxCaptures) * 100));
      const avg = agg.latency_stats?.avg_ttfb_ms
        ? `${Math.round(agg.latency_stats.avg_ttfb_ms)} ms`
        : "-";
      const bytes = agg.response_stats?.avg_bytes
        ? fmtBytes(Math.round(agg.response_stats.avg_bytes))
        : "-";

      return `<div class="timeline-row">
        <div class="timeline-head">
          <span class="timeline-day">${formatDayLabel(day)}</span>
          <span class="timeline-count">${captures} sends</span>
        </div>
        <div class="bar-track"><span class="bar-fill" style="width:${width}%"></span></div>
        <div class="timeline-meta">
          <span>Avg TTFB: ${avg}</span>
          <span>Avg Size: ${bytes}</span>
        </div>
      </div>`;
    })
    .join("");
}

function setupSwipe() {
  const viewport = document.getElementById("panelViewport");
  const navButtons = [...document.querySelectorAll(".nav-pill")];
  const dots = [...document.querySelectorAll(".dot")];

  function setActive(index) {
    navButtons.forEach((b, i) => b.classList.toggle("is-active", i === index));
    dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
  }

  function goTo(index) {
    const left = viewport.clientWidth * index;
    viewport.scrollTo({ left, behavior: "smooth" });
    setActive(index);
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => goTo(Number(btn.dataset.index || 0)));
  });

  dots.forEach((dot) => {
    dot.addEventListener("click", () => goTo(Number(dot.dataset.index || 0)));
  });

  viewport.addEventListener("scroll", () => {
    const index = Math.round(
      viewport.scrollLeft / Math.max(1, viewport.clientWidth),
    );
    setActive(index);
  });
}

async function load() {
  const [sendsResp, todayAgg, allAggs] = await Promise.all([
    chrome.runtime.sendMessage({ type: "get-sends" }),
    getTodayStats().catch(() => null),
    getAllStats().catch(() => ({})),
  ]);

  const sends = Array.isArray(sendsResp?.sends) ? sendsResp.sends : [];
  renderOverview(sends, todayAgg);
  renderLivestream(sends);
  renderSpecifics(todayAgg, sends);
  renderTimewise(allAggs);
}

document.getElementById("clearBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-sends" });
  await chrome.runtime.sendMessage({ type: "clear-aggregations" });
  await load();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "sends-updated") load().catch(() => {});
});

setupSwipe();
load().catch(() => {});
