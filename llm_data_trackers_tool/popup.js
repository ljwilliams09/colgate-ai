// popup.js

const PLATFORM_CONFIG = {
  "claude.ai":   { name: "Claude",  dotClass: "dot-claude"  },
  "chatgpt.com": { name: "ChatGPT", dotClass: "dot-chatgpt" },
};

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

// Aggregate the flat log into per-platform, per-tracker summaries.
// Each tracker entry reflects its FIRST occurrence (earliest tOffset / beforePrompt value).
function aggregateLog(log) {
  const map = {}; // { [ai]: { [trackerLabel]: { label, desc, count, tOffset, beforePrompt } } }

  for (const entry of log) {
    if (!map[entry.ai]) map[entry.ai] = {};

    if (!map[entry.ai][entry.tracker]) {
      // First occurrence — capture timing and before/after state
      map[entry.ai][entry.tracker] = {
        label:        entry.tracker,
        desc:         entry.desc || "",
        count:        0,
        tOffset:      entry.tOffset,
        beforePrompt: entry.beforePrompt,
      };
    }

    map[entry.ai][entry.tracker].count++;
  }

  return map;
}

function buildTrackerCard(t) {
  const card = document.createElement("div");
  card.className = "tracker-card";

  const badgeClass = t.beforePrompt ? "timing-badge" : "timing-badge after";
  const calls = `${t.count} call${t.count !== 1 ? "s" : ""}`;

  card.innerHTML = `
    <div>
      <div class="tracker-name">${t.label}</div>
      <div class="tracker-desc">${t.desc}</div>
    </div>
    <div class="tracker-meta">
      <div class="${badgeClass}">t + ${t.tOffset}s</div>
      <div class="call-count">${calls}</div>
    </div>
  `;
  return card;
}

function render(log, sessions) {
  const aggregated = aggregateLog(log);

  // ── Header stats ──
  const allTrackers = Object.values(aggregated).flatMap((p) =>
    Object.values(p),
  );
  const beforeCount    = allTrackers.filter((t) => t.beforePrompt).length;
  const companiesCount = new Set(allTrackers.map((t) => t.label)).size;

  document.getElementById("before-count").textContent    = String(beforeCount);
  document.getElementById("total-pings").textContent     = String(log.length);
  document.getElementById("companies-count").textContent = String(companiesCount);

  // ── Alert banner ──
  const alertEl = document.getElementById("alert-banner");
  if (beforeCount > 0) {
    alertEl.textContent = `${beforeCount} tracker${beforeCount !== 1 ? "s" : ""} fired before your first prompt — companies were notified just by opening these tabs.`;
    alertEl.classList.remove("hidden");
  } else {
    alertEl.classList.add("hidden");
  }

  // ── Platform sections ──
  const platformsEl = document.getElementById("platforms");
  platformsEl.replaceChildren();

  for (const [site, config] of Object.entries(PLATFORM_CONFIG)) {
    const trackers  = aggregated[site] ? Object.values(aggregated[site]) : [];
    const pingCount = log.filter((e) => e.ai === site).length;

    const section = document.createElement("div");
    section.className = "platform";

    // Header row
    const header = document.createElement("div");
    header.className = "platform-header";
    header.innerHTML = `
      <div class="platform-name">
        <span class="dot ${config.dotClass}"></span>
        ${config.name}
      </div>
      <span class="platform-pings">${pingCount} pings this session</span>
    `;
    section.appendChild(header);

    if (!trackers.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "none detected yet";
      section.appendChild(empty);
    } else {
      const before = trackers.filter((t) => t.beforePrompt);
      const after  = trackers.filter((t) => !t.beforePrompt);

      if (before.length) {
        const label = document.createElement("div");
        label.className = "group-label";
        label.textContent = "Before you typed";
        section.appendChild(label);
        before.forEach((t) => section.appendChild(buildTrackerCard(t)));
      }

      if (after.length) {
        const label = document.createElement("div");
        label.className = "group-label";
        label.textContent = "After you typed";
        section.appendChild(label);
        after.forEach((t) => section.appendChild(buildTrackerCard(t)));
      }
    }

    platformsEl.appendChild(section);
  }

  // ── Session time ──
  const starts = Object.values(sessions)
    .map((s) => s.start)
    .filter(Boolean);
  document.getElementById("session-time").textContent = starts.length
    ? `Session started ${timeSince(Math.min(...starts))}`
    : "No session yet";
}

function loadAndRender() {
  chrome.storage.local.get(["log", "sessions"], (result) => {
    render(result.log || [], result.sessions || {});
  });
}

// Live stream — re-render on any background event
const port = chrome.runtime.connect({ name: "live-network-stream" });

port.onMessage.addListener((message) => {
  if (
    message?.type === "snapshot" ||
    message?.type === "entry" ||
    message?.type === "tracker" ||
    message?.type === "prompt"
  ) {
    loadAndRender();
  }
});

document.getElementById("clear-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clear-history" }, loadAndRender);
});

loadAndRender();
