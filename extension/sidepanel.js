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

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
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

const tooltip = document.createElement("div");
tooltip.className = "custom-tooltip";
tooltip.setAttribute("role", "tooltip");
tooltip.hidden = true;
document.body.appendChild(tooltip);

let tooltipTarget = null;

function placeTooltip(target) {
  const rect = target.getBoundingClientRect();
  const padding = 12;
  const gap = 10;
  const maxWidth = 240;
  const text = target.dataset.tooltip || "";

  tooltip.textContent = text;
  tooltip.style.maxWidth = `${maxWidth}px`;

  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - gap;

  if (left < padding) left = padding;
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = window.innerWidth - padding - tooltipRect.width;
  }
  if (top < padding) {
    top = rect.bottom + gap;
  }
  if (top + tooltipRect.height > window.innerHeight - padding) {
    top = Math.max(padding, window.innerHeight - padding - tooltipRect.height);
  }

  tooltip.style.left = `${Math.max(padding, left)}px`;
  tooltip.style.top = `${Math.max(padding, top)}px`;
}

function showTooltip(target) {
  const text = target?.dataset?.tooltip;
  if (!text) return;
  tooltipTarget = target;
  tooltip.hidden = false;
  tooltip.textContent = text;
  placeTooltip(target);
  requestAnimationFrame(() => tooltip.classList.add("is-visible"));
}

function hideTooltip() {
  tooltip.classList.remove("is-visible");
  tooltip.hidden = true;
  tooltipTarget = null;
}

function bindTooltips() {
  // Event delegation — works on dynamically rendered elements like cards
  document.addEventListener("mouseover", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) showTooltip(target);
  });
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget?.closest("[data-tooltip]")) hideTooltip();
  });
  document.addEventListener("focusin", (e) => {
    const target = e.target.closest("[data-tooltip]");
    if (target) showTooltip(target);
  });
  document.addEventListener("focusout", hideTooltip);

  window.addEventListener("scroll", () => {
    if (tooltipTarget && !tooltip.hidden) placeTooltip(tooltipTarget);
  }, true);
  window.addEventListener("resize", () => {
    if (tooltipTarget && !tooltip.hidden) placeTooltip(tooltipTarget);
  });
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
    <span class="pill-sub">${d.tool_name ? esc(d.tool_name) : "no tool"}</span>
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
          <div class="card-ttfb" data-tooltip="Time To First Byte — how long from sending your message until the AI started responding">TTFB ${d.ttfb_ms != null ? Math.round(d.ttfb_ms) + " ms" : "-"}</div>
        </div>
      </div>
      <div class="card-meta">${modePill}${modelPill}</div>
      ${thirdPartyHtml}
      <div class="card-footer">${esc(d.send_id)} · ${platform}</div>
    </div>`;
}

function renderOverview(sends, todayAgg) {
  const ttfbVals = sends.map((s) => s.ttfb_ms).filter((v) => v != null);
  const promptsToday = Number(todayAgg?.total_captures || 0) || sends.length;
  const responseStats = todayAgg?.response_stats || {};
  const avgResponseBytes = Number(responseStats.avg_bytes || 0);
  const sseEvents = Number(responseStats.total_sse_events || 0);

  setText("promptsToday", promptsToday);
  const aggAvgTtfb = todayAgg?.latency_stats?.avg_ttfb_ms;
  setText(
    "avgTtfb",
    aggAvgTtfb != null
      ? `${Math.round(aggAvgTtfb)} ms`
      : ttfbVals.length
        ? `${Math.round(ttfbVals.reduce((a, b) => a + b, 0) / ttfbVals.length)} ms`
        : "-",
  );
  setText("avgResponseBytes", avgResponseBytes ? fmtBytes(Math.round(avgResponseBytes)) : "-");
  setText("sseEvents", sseEvents ? `${sseEvents}` : "-");

  const toolBreakdown = document.getElementById("toolBreakdown");
  if (toolBreakdown) {
    const entries = topEntries(todayAgg?.tools_invoked || {}, 6);
    toolBreakdown.innerHTML = entries.length
      ? entries.map(([label, value]) =>
          `<div class="tool-row">
            <span class="tool-row-name">${esc(label)}</span>
            <span class="tool-row-badge">${esc(value)}</span>
          </div>`
        ).join("")
      : `<div class="empty">No tool usage yet</div>`;
  }

  const topTrackers = document.getElementById("topTrackers");
  if (topTrackers) {
    const entries = topEntries(todayAgg?.server_fetched_domains || {}, 5);
    const max = entries[0]?.[1] || 1;
    topTrackers.innerHTML = entries.length
      ? `<div class="tracker-list">${entries.map(([domain, count], i) =>
          `<div class="tracker-entry">
            <div class="tracker-entry-bar" style="width:${Math.round((count / max) * 100)}%"></div>
            <span class="tracker-rank">${i + 1}</span>
            <span class="tracker-domain">${esc(domain)}</span>
            <span class="tracker-count">${count}</span>
          </div>`
        ).join("")}</div>`
      : `<div class="empty">No URLs accessed by AI today</div>`;
  }

  const platformSplit = document.getElementById("platformSplit");
  if (platformSplit) {
    const platforms = todayAgg?.platforms || {};
    const chatgpt = Number(platforms["chatgpt"] || 0);
    const claude  = Number(platforms["claude"]  || 0);
    const total   = chatgpt + claude || 1;
    const chatgptPct = Math.round((chatgpt / total) * 100);
    const claudePct  = 100 - chatgptPct;
    platformSplit.innerHTML = chatgpt + claude === 0
      ? `<div class="empty">No data yet</div>`
      : `<div class="platform-bar">
           <div class="platform-bar-fill platform-bar-chatgpt" style="width:${chatgptPct}%"></div>
           <div class="platform-bar-fill platform-bar-claude"  style="width:${claudePct}%"></div>
         </div>
         <div class="platform-labels">
           <span class="platform-label"><span class="platform-dot platform-dot--chatgpt"></span>ChatGPT ${chatgpt} sends</span>
           <span class="platform-label"><span class="platform-dot platform-dot--claude"></span>Claude ${claude} sends</span>
         </div>`;
  }
}

let activeLivestreamPlatform = "chatgpt";
let livestreamSubtabsReady = false;

function setupLivestreamSubtabs(sends) {
  // Set default platform from most recent send (only on first load)
  if (!livestreamSubtabsReady && sends.length) {
    activeLivestreamPlatform = sends[0].platform === "claude" ? "claude" : "chatgpt";
  }

  const subtabs = document.querySelectorAll("#livestreamSubtabs .subtab-btn");
  const slider = document.getElementById("livestreamSlider");

  function syncToggle() {
    subtabs.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.platform === activeLivestreamPlatform),
    );
    if (slider) slider.classList.toggle("is-claude", activeLivestreamPlatform === "claude");
  }

  syncToggle();

  if (livestreamSubtabsReady) return;
  livestreamSubtabsReady = true;

  subtabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeLivestreamPlatform = btn.dataset.platform;
      syncToggle();
      renderLivestreamCards(window._lastSends || []);
    });
  });
}

function renderLivestreamCards(sends) {
  const cards = document.getElementById("livestreamCards");
  if (!cards) return;
  cards.classList.toggle("is-claude", activeLivestreamPlatform === "claude");
  const filtered = sends.filter((s) =>
    activeLivestreamPlatform === "claude"
      ? s.platform === "claude"
      : s.platform !== "claude",
  );
  if (!filtered.length) {
    const other = activeLivestreamPlatform === "claude" ? "ChatGPT" : "Claude";
    cards.innerHTML = `<div class="empty">No ${activeLivestreamPlatform === "claude" ? "Claude" : "ChatGPT"} sends yet.<br>Switch to ${other} to see those captures.</div>`;
    return;
  }
  cards.innerHTML = filtered.slice(0, 20).map(buildCard).join("");
}

function renderLivestream(sends) {
  window._lastSends = sends;
  renderLivestreamCards(sends);
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
  if (!timeline) return;
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

let activePanelIndex = 0;

function setupSwipe() {
  const viewport = document.getElementById("panelViewport");
  if (!viewport) return;
  const navButtons = [...document.querySelectorAll("#swipeNav .nav-pill")];
  const dots = [...document.querySelectorAll("#dots .dot")];
  const clearBtn = document.getElementById("clearBtn");

  function setActive(index) {
    activePanelIndex = index;
    navButtons.forEach((b, i) => b.classList.toggle("is-active", i === index));
    dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
    if (clearBtn) clearBtn.style.display = index <= 1 ? "" : "none";
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
  setupLivestreamSubtabs(sends);
  renderLivestream(sends);
  await loadTrackers();
  renderTimewise(allAggs);
}

function startClock() {
  const el = document.getElementById("todayClock");
  if (!el) return;
  function tick() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, "0");
    const m = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    el.textContent = `${h}:${m}:${s} — resets at midnight`;
  }
  tick();
  setInterval(tick, 1000);
}

function scheduleMidnightClear() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight - now;
  setTimeout(async () => {
    await chrome.runtime.sendMessage({ type: "clear-aggregations" });
    await load();
    scheduleMidnightClear();
  }, msUntilMidnight);
}

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (activePanelIndex === 0) {
    // Dashboard — clear aggregation stats only
    await chrome.runtime.sendMessage({ type: "clear-aggregations" });
  } else {
    // Livestream — clear captured sends only
    await chrome.runtime.sendMessage({ type: "clear-sends" });
  }
  await load();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "sends-updated") load().catch(() => {});
  if (message.type === "trackers-updated") loadTrackers().catch(() => {});
});

bindTooltips();
setupSwipe();
startClock();
scheduleMidnightClear();
load().catch(() => {});

// ── Trackers tab ───────────────────────────────────────────────────────────────

function timeSince(ms) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) {
    const m = Math.round(diff / 60_000);
    return `${m} min${m !== 1 ? "s" : ""} ago`;
  }
  const h = Math.round(diff / 3_600_000);
  return `${h}h ago`;
}

function aggregateTrackerLog(log) {
  const map = {};
  for (const entry of log) {
    if (!map[entry.ai]) map[entry.ai] = {};
    if (!map[entry.ai][entry.tracker]) {
      map[entry.ai][entry.tracker] = {
        label: entry.tracker,
        desc: entry.desc || "",
        domain: entry.domain || "",
        count: 0,
        tOffset: entry.tOffset,
        beforePrompt: entry.beforePrompt,
      };
    }
    map[entry.ai][entry.tracker].count++;
  }
  return map;
}

const TRACKER_PLATFORMS = {
  "claude.ai": { name: "Claude", dotClass: "tr-dot-claude" },
  "chatgpt.com": { name: "ChatGPT", dotClass: "tr-dot-chatgpt" },
};

function renderTrackers(log, sessions) {
  const aggregated = aggregateTrackerLog(log);
  const allTrackers = Object.values(aggregated).flatMap((p) =>
    Object.values(p),
  );
  const beforeCount = allTrackers.filter((t) => t.beforePrompt).length;
  const companiesCount = new Set(allTrackers.map((t) => t.label)).size;

  document.getElementById("tr-before-count").textContent = String(beforeCount);
  document.getElementById("tr-total-pings").textContent = String(log.length);
  document.getElementById("tr-companies").textContent = String(companiesCount);

  const alertEl = document.getElementById("tr-alert");
  if (beforeCount > 0) {
    alertEl.textContent = `${beforeCount} tracker${beforeCount !== 1 ? "s" : ""} fired before your first prompt — companies were notified just by opening these tabs.`;
    alertEl.style.display = "";
  } else {
    alertEl.style.display = "none";
  }

  const platformsEl = document.getElementById("tr-platforms");
  platformsEl.innerHTML = `<p class="tr-intro">Trackers are third-party services that contact your browser while you use AI tools. They can collect behavioral data — sometimes before you've typed a single word. Hover over a company name or timing badge for details.</p>`;

  for (const [site, config] of Object.entries(TRACKER_PLATFORMS)) {
    const trackers = aggregated[site] ? Object.values(aggregated[site]) : [];
    const pingCount = log.filter((e) => e.ai === site).length;

    let html = `
      <div class="tr-platform">
        <div class="tr-platform-header">
          <div class="tr-platform-name">
            <span class="tr-dot ${esc(config.dotClass)}"></span>${esc(config.name)}
          </div>
          <span class="tr-pings">${pingCount} pings this session</span>
        </div>`;

    if (!trackers.length) {
      html += `<div class="tr-empty">None detected yet</div>`;
    } else {
      html += trackers
        .map((t) => {
          const timingClass = t.beforePrompt ? "tr-timing-before" : "tr-timing-after";
          const timingTip = "Seconds after your session started when this tracker first pinged";
          const statusLine = t.beforePrompt
            ? "Fired BEFORE your first message — this company was notified just by opening the AI tab."
            : "Fired AFTER your first message.";
          const nameTip = `${statusLine}${t.domain ? ` Domain: ${t.domain}.` : ""} Purpose: ${t.desc}`;
          return `
          <div class="tr-tracker-card">
            <div>
              <div class="tr-tracker-name" data-tooltip="${esc(nameTip)}">${esc(t.label)}</div>
            </div>
            <div class="tr-tracker-meta">
              <div class="${timingClass}" data-tooltip="${esc(timingTip)}">t + ${t.tOffset}s</div>
              <div class="tr-call-count">${t.count} call${t.count !== 1 ? "s" : ""}</div>
            </div>
          </div>`;
        })
        .join("");
    }

    html += `</div>`;
    platformsEl.insertAdjacentHTML("beforeend", html);
  }

  const starts = Object.values(sessions)
    .map((s) => s.start)
    .filter(Boolean);
  document.getElementById("tr-session-time").textContent = starts.length
    ? `Session started ${timeSince(Math.min(...starts))}`
    : "No session yet";
}

async function loadTrackers() {
  const response = await chrome.runtime.sendMessage({
    type: "get-tracker-log",
  });
  renderTrackers(response?.log || [], response?.sessions || {});
}

document.getElementById("tr-clearBtn").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-tracker-log" });
  renderTrackers([], {});
});

loadTrackers().catch(() => {});
