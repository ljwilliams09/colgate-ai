const capturedCount = document.getElementById("captured-count");
const visibleCount = document.getElementById("visible-count");
const filterLabel = document.getElementById("filter-label");
const activeTabLabel = document.getElementById("active-tab-label");
const logList = document.getElementById("log-list");
const emptyState = document.getElementById("empty-state");
const refreshButton = document.getElementById("refresh-button");
const clearButton = document.getElementById("clear-button");
const rateLabel = document.getElementById("rate-label");
const errorRateLabel = document.getElementById("error-rate-label");
const windowTotalLabel = document.getElementById("window-total-label");
const topHosts = document.getElementById("top-hosts");
const streamStatus = document.getElementById("stream-status");

const MAX_RENDERED_LOGS = 250;

let filterTabId = null;
let history = [];
let summary = {
  total: 0,
  errorRate: 0,
  requestRatePerSec: 0,
  topHosts: [],
};
let streamPort = null;

function formatTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function formatDuration(durationMs) {
  if (typeof durationMs !== "number") {
    return "n/a";
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }

  return `${(durationMs / 1000).toFixed(2)} s`;
}

function stripUrl(value) {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function buildEntry(item) {
  const li = document.createElement("li");
  li.className = "log-item";

  const top = document.createElement("div");
  top.className = "log-top";

  const title = document.createElement("p");
  title.className = "log-url";
  title.textContent = stripUrl(item.url);

  const status = document.createElement("span");
  status.className = `badge ${item.error ? "status-error" : "status-ok"}`;
  status.textContent = item.error
    ? item.error
    : String(item.statusCode || "200");

  const metaRow = document.createElement("div");
  metaRow.className = "badge-row";

  [
    item.method,
    item.type,
    `Tab ${item.tabId}`,
    formatDuration(item.durationMs),
  ].forEach((label) => {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = label;
    metaRow.appendChild(badge);
  });

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${formatTimestamp(item.completedAt)}${item.fromCache ? " • from cache" : ""}`;

  top.appendChild(title);
  top.appendChild(status);
  li.appendChild(top);
  li.appendChild(metaRow);
  li.appendChild(meta);

  return li;
}

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  const tabId = activeTab?.id ?? null;
  const tabTitle = activeTab?.title || "Active tab";
  const tabHost = activeTab?.url ? new URL(activeTab.url).host : "";
  activeTabLabel.textContent =
    tabId === null
      ? "No active tab"
      : `${tabTitle}${tabHost ? ` • ${tabHost}` : ""}`;
  return tabId;
}

async function loadHistory() {
  const response = await chrome.runtime.sendMessage({ type: "get-history" });
  return Array.isArray(response?.history) ? response.history : [];
}

async function loadSummary() {
  const response = await chrome.runtime.sendMessage({ type: "get-summary" });
  return response?.summary || summary;
}

function renderSummary() {
  const requestRate = Number(summary?.requestRatePerSec || 0);
  const errorRate = Number(summary?.errorRate || 0);
  const windowTotal = Number(summary?.total || 0);

  rateLabel.textContent = requestRate.toFixed(2);
  errorRateLabel.textContent = `${(errorRate * 100).toFixed(1)}%`;
  windowTotalLabel.textContent = String(windowTotal);

  topHosts.replaceChildren();
  const hosts = Array.isArray(summary?.topHosts) ? summary.topHosts : [];

  if (!hosts.length) {
    const empty = document.createElement("li");
    empty.className = "top-host";
    empty.textContent = "No domain activity in current window.";
    topHosts.appendChild(empty);
    return;
  }

  for (const hostData of hosts.slice(0, 5)) {
    const item = document.createElement("li");
    item.className = "top-host";

    const name = document.createElement("span");
    name.className = "top-host-name";
    name.textContent = hostData.host;

    const meta = document.createElement("span");
    meta.className = "top-host-meta";
    const p95 =
      typeof hostData.p95Ms === "number"
        ? `${hostData.p95Ms}ms p95`
        : "p95 n/a";
    meta.textContent = `${hostData.count} req • ${(Number(hostData.errorRate || 0) * 100).toFixed(1)}% err • ${p95}`;

    item.appendChild(name);
    item.appendChild(meta);
    topHosts.appendChild(item);
  }
}

async function render() {
  filterTabId = await getActiveTabId();

  const visibleHistory =
    filterTabId === null
      ? history
      : history.filter((item) => item.tabId === filterTabId);

  capturedCount.textContent = String(history.length);
  visibleCount.textContent = String(visibleHistory.length);
  filterLabel.textContent =
    filterTabId === null ? "All tabs" : `Tab ${filterTabId}`;

  logList.replaceChildren();
  if (visibleHistory.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }

  emptyState.classList.add("hidden");
  for (const item of visibleHistory) {
    logList.appendChild(buildEntry(item));
  }
}

function startLiveStream() {
  if (streamPort) {
    return;
  }

  streamPort = chrome.runtime.connect({ name: "live-network-stream" });
  streamStatus.textContent = "Live";
  streamStatus.classList.add("live");

  streamPort.onMessage.addListener((message) => {
    if (message?.type === "snapshot") {
      history = Array.isArray(message.history) ? message.history : [];
      if (message.summary) {
        summary = message.summary;
      }
      renderSummary();
      render().catch((error) => {
        console.error("Failed to render snapshot", error);
      });
      return;
    }

    if (message?.type === "entry") {
      if (message.entry) {
        history.unshift(message.entry);
        if (history.length > MAX_RENDERED_LOGS) {
          history = history.slice(0, MAX_RENDERED_LOGS);
        }
      }
      if (message.summary) {
        summary = message.summary;
      }
      renderSummary();
      render().catch((error) => {
        console.error("Failed to render live entry", error);
      });
      return;
    }

    if (message?.type === "error") {
      streamStatus.textContent = "Error";
      streamStatus.classList.remove("live");
      console.error("Live stream error", message.error);
    }
  });

  streamPort.onDisconnect.addListener(() => {
    streamStatus.textContent = "Disconnected";
    streamStatus.classList.remove("live");
    streamPort = null;
  });
}

refreshButton.addEventListener("click", () => {
  Promise.all([loadHistory(), loadSummary()])
    .then(([latestHistory, latestSummary]) => {
      history = latestHistory;
      summary = latestSummary;
      renderSummary();
      return render();
    })
    .catch((error) => {
      console.error("Failed to refresh network capture", error);
    });
});

clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-history" });
  history = [];
  summary = {
    total: 0,
    errorRate: 0,
    requestRatePerSec: 0,
    topHosts: [],
  };
  renderSummary();
  await render();
});

Promise.all([loadHistory(), loadSummary()])
  .then(([latestHistory, latestSummary]) => {
    history = latestHistory;
    summary = latestSummary;
    renderSummary();
    startLiveStream();
    return render();
  })
  .catch((error) => {
    console.error("Failed to load network capture", error);
    emptyState.textContent = "Unable to load network history.";
    emptyState.classList.remove("hidden");
  });
