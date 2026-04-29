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

function fmtNumber(num) {
  const n = Number(num);
  if (!n || n < 1000) return String(Math.round(n));
  if (n < 1000000) {
    const k = n / 1000;
    return `${Number(k.toFixed(k >= 10 ? 0 : 1))}k`;
  }
  if (n < 1000000000) {
    const m = n / 1000000;
    return `${Number(m.toFixed(m >= 10 ? 0 : 1))}m`;
  }
  const b = n / 1000000000;
  return `${Number(b.toFixed(b >= 10 ? 0 : 1))}b`;
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
  const targets = document.querySelectorAll("[data-tooltip]");
  targets.forEach((target) => {
    target.addEventListener("mouseenter", () => showTooltip(target));
    target.addEventListener("mousemove", () => {
      if (tooltipTarget === target && !tooltip.hidden) placeTooltip(target);
    });
    target.addEventListener("mouseleave", hideTooltip);
    target.addEventListener("focusin", () => showTooltip(target));
    target.addEventListener("focusout", hideTooltip);
  });

  window.addEventListener(
    "scroll",
    () => {
      if (tooltipTarget && !tooltip.hidden) placeTooltip(tooltipTarget);
    },
    true,
  );
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
          <div class="card-ttfb">TTFB ${d.ttfb_ms != null ? Math.round(d.ttfb_ms) + " ms" : "-"}</div>
        </div>
      </div>
      <div class="card-meta">${modePill}${modelPill}</div>
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

  setText("totalSends", sends.length);
  setText("promptsToday", promptsToday);
  setText(
    "toolRate",
    sends.length
      ? `${Math.round((withTool.length / sends.length) * 100)}%`
      : "-",
  );
  const aggAvgTtfb = todayAgg?.latency_stats?.avg_ttfb_ms;
  setText(
    "avgTtfb",
    aggAvgTtfb != null
      ? `${Math.round(aggAvgTtfb)} ms`
      : ttfbVals.length
        ? `${Math.round(ttfbVals.reduce((a, b) => a + b, 0) / ttfbVals.length)} ms`
        : "-",
  );
  setText(
    "avgThirdParties",
    tpCounts.length
      ? (tpCounts.reduce((a, b) => a + b, 0) / tpCounts.length).toFixed(1)
      : "-",
  );
  setText("responsePages", responsePages === "-" ? "-" : `~${responsePages}`);
  setText(
    "avgPromptLength",
    avgPromptLength ? `${Math.round(avgPromptLength)} chars` : "-",
  );
  setText("promptRange", promptRange);
  setText(
    "avgResponseBytes",
    avgResponseBytes ? `${fmtBytes(Math.round(avgResponseBytes))}` : "-",
  );
  setText("sseEvents", sseEvents ? `${sseEvents}` : "-");

  const toolBreakdown = document.getElementById("toolBreakdown");
  if (toolBreakdown) {
    const entries = topEntries(todayAgg?.tools_invoked || {}, 6);
    toolBreakdown.innerHTML = entries.length
      ? entries
          .map(
            ([label, value]) =>
              `<div class="tool-row">
            <span class="tool-row-name">${esc(label)}</span>
            <span class="tool-row-badge">${esc(value)}</span>
          </div>`,
          )
          .join("")
      : `<div class="empty">No tool usage yet</div>`;
  }

  const topTrackers = document.getElementById("topTrackers");
  if (topTrackers) {
    const entries = topEntries(todayAgg?.server_fetched_domains || {}, 5);
    const max = entries[0]?.[1] || 1;
    topTrackers.innerHTML = entries.length
      ? `<div class="tracker-list">${entries
          .map(
            ([domain, count], i) =>
              `<div class="tracker-entry">
            <div class="tracker-entry-bar" style="width:${Math.round((count / max) * 100)}%"></div>
            <span class="tracker-rank">${i + 1}</span>
            <span class="tracker-domain">${esc(domain)}</span>
            <span class="tracker-count">${count}</span>
          </div>`,
          )
          .join("")}</div>`
      : `<div class="empty">No trackers detected today</div>`;
  }

  const platformSplit = document.getElementById("platformSplit");
  if (platformSplit) {
    const platforms = todayAgg?.platforms || {};
    const chatgpt = Number(platforms["chatgpt"] || 0);
    const claude = Number(platforms["claude"] || 0);
    const total = chatgpt + claude || 1;
    const chatgptPct = Math.round((chatgpt / total) * 100);
    const claudePct = 100 - chatgptPct;
    platformSplit.innerHTML =
      chatgpt + claude === 0
        ? `<div class="empty">No data yet</div>`
        : `<div class="platform-bar">
           <div class="platform-bar-fill platform-bar-chatgpt" style="width:${chatgptPct}%"></div>
           <div class="platform-bar-fill platform-bar-claude"  style="width:${claudePct}%"></div>
         </div>
         <div class="platform-labels">
           <span class="platform-label"><span class="platform-dot platform-dot--chatgpt"></span>ChatGPT ${chatgpt}</span>
           <span class="platform-label"><span class="platform-dot platform-dot--claude"></span>Claude ${claude}</span>
         </div>`;
  }
}

function renderLivestream(sends) {
  const cards =
    document.getElementById("livestreamCards") ||
    document.getElementById("cards");
  if (!cards) return;

  if (!sends.length) {
    cards.innerHTML = `<div class="empty">No sends captured yet.<br>Chat with ChatGPT or Claude and it will show up here.</div>`;
    return;
  }

  cards.innerHTML = sends.slice(0, 5).map(buildCard).join("");
}

function renderSpecifics(todayAgg, sends) {
  if (!document.getElementById("modelsList")) return;
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

function formatDayLabel(dayKey, granularity = "day") {
  const d = new Date(`${dayKey}T00:00:00`);
  if (granularity === "month") {
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }
  if (granularity === "week") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  if (granularity === "year") {
    return d.toLocaleDateString(undefined, { year: "numeric" });
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function getTimeMetricValue(agg, metric) {
  if (!agg || typeof agg !== "object") return 0;
  if (metric === "total_captures") return Number(agg.total_captures || 0);
  if (metric === "avg_ttfb_ms")
    return Number(agg.latency_stats?.avg_ttfb_ms || 0);
  if (metric === "avg_bytes") return Number(agg.response_stats?.avg_bytes || 0);
  if (metric === "total_est_tokens") {
    const est = Number(agg.response_stats?.total_est_tokens || 0);
    if (est > 0) return est;
    const avgEst = Number(agg.response_stats?.avg_est_tokens || 0);
    const captures = Number(agg.total_captures || 0);
    if (avgEst > 0 && captures > 0) return Math.round(avgEst * captures);
    const words = Number(agg.response_stats?.total_words || 0);
    if (words > 0) return Math.ceil(words * 1.3);
    // Fallback for older stored rollups that only have char counts
    const chars = Number(agg.response_stats?.total_chars || 0);
    return Math.ceil(chars / 4);
  }
  return 0;
}

function formatMetricValue(metric, value) {
  if (metric === "avg_bytes") return fmtBytes(Math.round(value));
  if (metric === "avg_ttfb_ms") return `${Math.round(value)} ms`;
  if (metric === "total_est_tokens") {
    const n = Math.round(value);
    const abbrev = fmtNumber(n);
    return `${abbrev} ${n === 1 ? "token" : "tokens"}`;
  }
  if (metric === "total_captures") {
    return fmtNumber(Math.round(value));
  }
  return fmtNumber(Math.round(value));
}

function renderTimelineChart(rows, metric) {
  const svg = document.getElementById("timelineChart");
  if (!svg) return;

  const width = Math.max(320, svg.clientWidth || 600);
  const height = 180;
  const pad = { t: 14, r: 12, b: 30, l: 56 };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = Math.max(10, height - pad.t - pad.b);

  const points = rows.map(([day, agg], i) => ({
    i,
    day,
    value: getTimeMetricValue(agg, metric),
  }));
  const values = points.map((p) => p.value);
  const rawMax = Math.max(1, ...values);
  const rawMin = Math.min(...values, 0);

  // Set anchor points based on metric type
  let anchorMin = 0;
  let anchorMax = 10;
  if (metric === "avg_ttfb_ms") {
    anchorMax = 100;
  } else if (metric === "avg_bytes") {
    anchorMax = 1024; // 1KB
  }

  // Expand anchors if data exceeds them
  const minV = Math.min(rawMin, anchorMin);
  const maxV = Math.max(rawMax, anchorMax);
  const finalMax = maxV === minV ? maxV + 1 : maxV;

  // Even spacing: distribute points evenly across the inner width
  const xSpacing = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i) => pad.l + i * xSpacing;
  const y = (v) =>
    pad.t + innerH - ((v - minV) / Math.max(1e-6, finalMax - minV)) * innerH;

  const path = points
    .map((p) => `${p.i === 0 ? "M" : "L"}${x(p.i)} ${y(p.value)}`)
    .join(" ");

  const areaPath = `${path} L ${x(points.length - 1)} ${pad.t + innerH} L ${x(0)} ${pad.t + innerH} Z`;

  const isCountMetric =
    metric === "total_captures" || metric === "total_est_tokens";
  let yTickValues;
  if (isCountMetric) {
    // Integer, unique ticks for count-based metrics to avoid repeated labels.
    const cappedMax = Math.max(1, Math.ceil(finalMax));
    const step = Math.max(1, Math.ceil(cappedMax / 4));
    yTickValues = [];
    for (let v = 0; v <= cappedMax; v += step) {
      yTickValues.push(v);
    }
    if (yTickValues[yTickValues.length - 1] !== cappedMax) {
      yTickValues.push(cappedMax);
    }
  } else {
    yTickValues = [0, 0.25, 0.5, 0.75, 1].map(
      (t) => minV + (finalMax - minV) * t,
    );
  }

  const yTicks = yTickValues.map((v) => ({
    y: y(v),
    label: formatMetricValue(metric, v),
  }));

  const xStep = Math.max(1, Math.floor(points.length / 6));
  const xLabels = points.filter(
    (_, i) => i % xStep === 0 || i === points.length - 1,
  );

  // Determine date granularity based on data span
  let dateGranularity = "day";
  if (points.length > 1) {
    const firstDate = new Date(`${points[0].day}T00:00:00`);
    const lastDate = new Date(`${points[points.length - 1].day}T00:00:00`);
    const daySpan = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
    if (daySpan > 365) {
      dateGranularity = "year";
    } else if (daySpan > 90) {
      dateGranularity = "month";
    } else if (daySpan > 21) {
      dateGranularity = "week";
    }
  }

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${yTicks
      .map(
        (t) => `
      <line class="timeline-chart-grid" x1="${pad.l}" y1="${t.y}" x2="${pad.l + innerW}" y2="${t.y}" />
      <text class="timeline-chart-label" x="50" y="${t.y + 3}" text-anchor="end">${esc(t.label)}</text>`,
      )
      .join("")}
    <line class="timeline-chart-axis" x1="${pad.l}" y1="${pad.t + innerH}" x2="${pad.l + innerW}" y2="${pad.t + innerH}" />
    <path class="timeline-chart-area" d="${areaPath}" />
    <path class="timeline-chart-line" d="${path}" />
    ${points
      .map(
        (p) => `
      <circle class="timeline-chart-point" cx="${x(p.i)}" cy="${y(p.value)}" r="3.5">
        <title>${esc(formatDayLabel(p.day, dateGranularity))}: ${esc(formatMetricValue(metric, p.value))}</title>
      </circle>`,
      )
      .join("")}
    ${xLabels
      .map(
        (p) => `
      <text class="timeline-chart-label" x="${x(p.i)}" y="${height - 8}" text-anchor="middle">${esc(formatDayLabel(p.day, dateGranularity))}</text>`,
      )
      .join("")}
  `;
}

let timewiseBound = false;
let timewiseRows = [];

function renderTimewise(allAggs) {
  const timeline = document.getElementById("timeline");
  if (!timeline) return;
  const rows = Object.entries(allAggs || {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  timewiseRows = rows;

  if (!rows.length) {
    timeline.innerHTML = `<div class="empty">No data yet.<br>Start chatting to build your timewise panel.</div>`;
    return;
  }

  const lifetime = rows.reduce(
    (acc, [day, agg]) => {
      const captures = Number(agg.total_captures || 0);
      const totalBytes = Number(agg.response_stats?.total_bytes || 0);
      const totalSse = Number(agg.response_stats?.total_sse_events || 0);
      const totalTtfb = Number(agg.latency_stats?.total_ttfb_ms || 0);
      const estTokens = getTimeMetricValue(agg, "total_est_tokens");

      acc.days += 1;
      acc.captures += captures;
      acc.totalBytes += totalBytes;
      acc.totalSse += totalSse;
      acc.totalEstTokens += estTokens;
      acc.totalTtfbMs += totalTtfb;

      if (!acc.firstDay || day < acc.firstDay) acc.firstDay = day;
      if (!acc.lastDay || day > acc.lastDay) acc.lastDay = day;
      return acc;
    },
    {
      days: 0,
      captures: 0,
      totalBytes: 0,
      totalSse: 0,
      totalEstTokens: 0,
      totalTtfbMs: 0,
      firstDay: null,
      lastDay: null,
    },
  );

  const lifetimeAvgTtfb =
    lifetime.captures > 0
      ? `${Math.round(lifetime.totalTtfbMs / lifetime.captures)} ms`
      : "-";
  const lifetimeAvgBytes =
    lifetime.captures > 0
      ? fmtBytes(lifetime.totalBytes / lifetime.captures)
      : "-";
  const lifetimeDateRange =
    lifetime.firstDay && lifetime.lastDay
      ? `${formatDayLabel(lifetime.firstDay)} - ${formatDayLabel(lifetime.lastDay)}`
      : "-";

  const lifetimeHtml = `<section class="timeline-lifetime">
    <div class="timeline-lifetime-head">
      <span class="timeline-lifetime-title">Lifetime Aggregations</span>
      <span class="timeline-lifetime-range">${lifetimeDateRange}</span>
    </div>
    <div class="timeline-lifetime-grid">
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">Days</span>
        <span class="timeline-lifetime-v">${lifetime.days}</span>
      </div>
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">Total Prompts</span>
        <span class="timeline-lifetime-v">${lifetime.captures}</span>
      </div>
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">Est. Tokens</span>
        <span class="timeline-lifetime-v">${fmtNumber(Math.round(lifetime.totalEstTokens))} tokens</span>
      </div>
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">Avg TTFB</span>
        <span class="timeline-lifetime-v">${lifetimeAvgTtfb}</span>
      </div>
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">Avg Resp Size</span>
        <span class="timeline-lifetime-v">${lifetimeAvgBytes}</span>
      </div>
      <div class="timeline-lifetime-stat">
        <span class="timeline-lifetime-k">SSE Events</span>
        <span class="timeline-lifetime-v">${lifetime.totalSse}</span>
      </div>
    </div>
  </section>`;

  timeline.innerHTML = lifetimeHtml;

  const metricSelect = document.getElementById("timeMetric");
  const selectedMetric = metricSelect?.value || "total_captures";
  renderTimelineChart(rows, selectedMetric);

  if (!timewiseBound && metricSelect) {
    metricSelect.addEventListener("change", () => {
      renderTimelineChart(timewiseRows, metricSelect.value || "total_captures");
    });
    window.addEventListener("resize", () => {
      renderTimelineChart(timewiseRows, metricSelect.value || "total_captures");
    });
    timewiseBound = true;
  }
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

function setupTrackerSwipe() {
  const viewport = document.getElementById("trackerPanelViewport");
  if (!viewport) return;
  const navButtons = [
    ...document.querySelectorAll("#trackerSwipeNav .nav-pill"),
  ];
  const dots = [...document.querySelectorAll("#trackerDots .dot")];

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
  platformsEl.innerHTML = "";

  for (const [site, config] of Object.entries(TRACKER_PLATFORMS)) {
    const trackers = aggregated[site] ? Object.values(aggregated[site]) : [];
    const pingCount = log.filter((e) => e.ai === site).length;
    const before = trackers.filter((t) => t.beforePrompt);
    const after = trackers.filter((t) => !t.beforePrompt);

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
      if (before.length) {
        html += `<div class="tr-group-label">Before you typed</div>`;
        html += before
          .map(
            (t) => `
          <div class="tr-tracker-card">
            <div>
              <div class="tr-tracker-name">${esc(t.label)}</div>
              <div class="tr-tracker-desc">${esc(t.desc)}</div>
            </div>
            <div class="tr-tracker-meta">
              <div class="tr-timing-before">t + ${t.tOffset}s</div>
              <div class="tr-call-count">${t.count} call${t.count !== 1 ? "s" : ""}</div>
            </div>
          </div>`,
          )
          .join("");
      }
      if (after.length) {
        html += `<div class="tr-group-label">After you typed</div>`;
        html += after
          .map(
            (t) => `
          <div class="tr-tracker-card">
            <div>
              <div class="tr-tracker-name">${esc(t.label)}</div>
              <div class="tr-tracker-desc">${esc(t.desc)}</div>
            </div>
            <div class="tr-tracker-meta">
              <div class="tr-timing-after">t + ${t.tOffset}s</div>
              <div class="tr-call-count">${t.count} call${t.count !== 1 ? "s" : ""}</div>
            </div>
          </div>`,
          )
          .join("");
      }
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
