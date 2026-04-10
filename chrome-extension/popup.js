const capturedCount = document.getElementById("captured-count");
const visibleCount = document.getElementById("visible-count");
const filterLabel = document.getElementById("filter-label");
const activeTabLabel = document.getElementById("active-tab-label");
const logList = document.getElementById("log-list");
const emptyState = document.getElementById("empty-state");
const refreshButton = document.getElementById("refresh-button");
const clearButton = document.getElementById("clear-button");

let filterTabId = null;

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

async function render() {
  filterTabId = await getActiveTabId();
  const history = await loadHistory();
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

refreshButton.addEventListener("click", () => {
  render().catch((error) => {
    console.error("Failed to refresh network capture", error);
  });
});

clearButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-history" });
  await render();
});

render().catch((error) => {
  console.error("Failed to load network capture", error);
  emptyState.textContent = "Unable to load network history.";
  emptyState.classList.remove("hidden");
});
