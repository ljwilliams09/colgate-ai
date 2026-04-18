import json
import logging
import math
import os
import re
from collections import Counter
from urllib.parse import urlparse

import pandas as pd
#Used AI in coding 
# ── Configuration ─────────────────────────────────────────────────────────────

HAR_DIR = "har_files"       
OUT_DIR = "har_analysis_output"  

# When you hit send, the browser fires off multiple requests close together.
# These windows tell us how close requests need to be to count as "one send."
SEND_MERGE_WINDOW_SECONDS = 3   # requests within 3s of each other = same send
SEND_WINDOW_BEFORE_SECONDS = 1  # look 1s before the send for related requests
SEND_WINDOW_AFTER_SECONDS = 8   # look 8s after (model response takes a moment)

# These are the AI platforms themselves — we treat their domains as "internal"
# so we don't count them as external sites the model fetched.
INTERNAL_DOMAIN_SIGNALS = (
    "openai.com",
    "chatgpt.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "anthropic.com",
    "claude.ai",
)

# These request types are noise — we skip them when measuring how many outside
# sources the model pulled from.
EXCLUDED_DIVERSITY_CATEGORIES = {
    "analytics",
    "auth",
    "security",
    "realtime",
    "static",
}

# ── Logging ───────────────────────────────────────────────────────────────────
# to see when the script runs.

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

os.makedirs(OUT_DIR, exist_ok=True)

# ── URL categorization ────────────────────────────────────────────────────────
# Each request in the HAR gets a label so we can group them later.
# We scan the URL for keywords and assign a category (auth, analytics, api, etc.)

CATEGORY_RULES: list[tuple[str, re.Pattern]] = [
    ("auth", re.compile(r"auth|login|logout|oauth|signin|session|token", re.I)),
    ("analytics", re.compile(
        r"analytics|segment|amplitude|telemetry|statsig|"
        r"events|/track|google-analytics|statsc|/flush|metric",
        re.I,
    )),
    ("security", re.compile(r"security|captcha|challenge|turnstile|cf-chl", re.I)),
    ("realtime", re.compile(r"websocket|/ws$|/ws/", re.I)),
    ("api", re.compile(
        r"backend-api|/conversation|/responses|chat/completions|"
        r"/completions|/graphql|/models|/message|/chat|/files",
        re.I,
    )),
]

# If the response is a file type like JS, CSS, image, or font — it's "static"
STATIC_MIME_RE = re.compile(r"javascript|text/css|image/|font/|text/html", re.I)


def categorize_request(url: str, mime_type: str, domain: str) -> str:
    # Check the URL against each rule in order, return the first match
    combined = f"{url} {domain}"
    for category, pattern in CATEGORY_RULES:
        if pattern.search(combined):
            return category
    if STATIC_MIME_RE.search(mime_type or ""):
        return "static"
    return "other"


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_har_entries(filepath: str) -> list[dict]:
    # Opens a HAR file and returns the list of requests inside it
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("Skipping %s: %s", filepath, exc)
        return []
    entries = data.get("log", {}).get("entries", [])
    if not entries:
        log.warning("No entries found in %s", filepath)
    return entries


def safe_json_loads(text: str):
    # Tries to parse a string as JSON — returns None if it fails instead of crashing
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return None


def get_bytes_transferred(response: dict, content: dict) -> int:
    # HAR files store response size in a few different fields depending on the browser,
    # so we try each one and return the first valid number we find.
    for value in (
        response.get("bodySize"),
        content.get("size"),
        response.get("_transferSize"),
    ):
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
    return 0


def normalize_domain(domain: str) -> str:
    # Strips "www." so that "www.google.com" and "google.com" count as the same domain
    domain = (domain or "").strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def is_internal_domain(domain: str) -> bool:
    # Returns True if the domain belongs to the AI platform itself (not an external fetch)
    domain = normalize_domain(domain)
    if not domain or domain == "unknown":
        return True
    return any(signal in domain for signal in INTERNAL_DOMAIN_SIGNALS)


def shannon_entropy(items: list[str]) -> float:
    # Shannon entropy measures how "spread out" the domains are.
    # High entropy = many different domains. Low = mostly one domain.
    if not items:
        return 0.0
    counts = Counter(items)
    total = sum(counts.values())
    return -sum((count / total) * math.log2(count / total) for count in counts.values())


def normalized_entropy(items: list[str]) -> float:
    # Same as above but scaled 0–1 so it's easier to compare across different send sizes
    unique_count = len(set(items))
    if unique_count <= 1:
        return 0.0
    return shannon_entropy(items) / math.log2(unique_count)


# ── SSE response parser ───────────────────────────────────────────────────────
# When ChatGPT responds, it streams the reply back piece by piece using SSE
# (Server-Sent Events) —  a long chain of "data: {...}" lines.
# This function reads that stream and pulls out the interesting bits:
# what tool was used, which model answered, how fast it started, and what
# URLs it went off and fetched.

def parse_sse_response(entry: dict) -> dict:
    """
    Returns a dict with keys:
      tool_invoked         bool
      tool_name            str | None
      turn_use_case        str | None   e.g. "text", "search", "shopping"
      model_slug           str | None   e.g. "gpt-5-3-instant"
      ttfb_ms              float | None (timings.wait)
      receive_ms           float | None (timings.receive)
      response_bytes       int
      sse_event_count      int
      server_fetched_urls  list[str]
    """
    result = {
        "tool_invoked": False,
        "tool_name": None,
        "turn_use_case": None,
        "model_slug": None,
        "ttfb_ms": None,
        "receive_ms": None,
        "response_bytes": 0,
        "sse_event_count": 0,
        "server_fetched_urls": [],
    }

    # TTFB (Time to First Byte) = how long before the server started sending anything back.
    # "receive" = how long the full stream took to finish.
    timings = entry.get("timings", {})
    wait = timings.get("wait", -1)
    receive = timings.get("receive", -1)
    if isinstance(wait, (int, float)) and wait >= 0:
        result["ttfb_ms"] = round(float(wait), 2)
    if isinstance(receive, (int, float)) and receive >= 0:
        result["receive_ms"] = round(float(receive), 2)

    content = entry.get("response", {}).get("content", {})
    size = content.get("size", 0)
    if isinstance(size, (int, float)) and size > 0:
        result["response_bytes"] = int(size)

    body = content.get("text", "") or ""
    if not body:
        return result

    # Each line that starts with "data:" is one SSE event — filter out the final [DONE] signal
    lines = [l for l in body.split("\n") if l.startswith("data:") and l.strip() != "data: [DONE]"]
    result["sse_event_count"] = len(lines)

    fetched_urls: list[str] = []

    for line in lines:
        raw = line[5:].strip()  # strip the "data:" prefix
        obj = safe_json_loads(raw)
        if not isinstance(obj, dict):
            continue

        event_type = obj.get("type", "")

        # This specific event type carries the metadata we care about most —
        # tool name, turn mode, and model slug
        if event_type == "server_ste_metadata":
            meta = obj.get("metadata", {})
            if isinstance(meta, dict):
                result["tool_invoked"] = bool(meta.get("tool_invoked", False))
                result["tool_name"] = meta.get("tool_name") or None
                result["turn_use_case"] = meta.get("turn_use_case") or None
                result["model_slug"] = meta.get("model_slug") or None

        # This event fires when ChatGPT fetches a URL on your behalf (e.g. during search)
        elif event_type == "url_moderation":
            url_result = obj.get("url_moderation_result", {})
            url = url_result.get("full_url", "")
            if url:
                fetched_urls.append(url)

    # Remove duplicate URLs while keeping the original order
    seen_urls: set[str] = set()
    deduped: list[str] = []
    for u in fetched_urls:
        if u not in seen_urls:
            deduped.append(u)
            seen_urls.add(u)
    result["server_fetched_urls"] = deduped

    return result


# ── Telemetry / system-payload detection ─────────────────────────────────────
# Not every POST request is a user message — the browser also fires off lots of
# background telemetry (analytics pings, error logs, etc.). These keywords help
# us filter those out so we don't count them as "sends".

TELEMETRY_SIGNALS = frozenset([
    "analytics_event_tracked",
    "json_analytics_event_tracked",
    "clienteventsservicelogger",
    "statsc",
    "counters",
    "histograms",
    "segment",
    "telemetry",
    '"metric"',
    '"metrics"',
    '"event_name"',
    '"events"',
    '"namespace"',
    '"success":true',
    "client_type",
    "pubsub",
    "locale loaded",
    "account features loaded",
    "composer voice use loaded",
    "load thread",
    "share post",
])


def looks_like_system_or_telemetry_payload(post_text: str) -> bool:
    # Returns True if the request body looks like background noise, not a user prompt
    if not post_text:
        return False
    lowered = post_text.lower()
    return any(signal in lowered for signal in TELEMETRY_SIGNALS)


# ── User-text extraction ──────────────────────────────────────────────────────
# Different AI platforms format their request bodies differently.
# These functions try to find the actual user message text regardless of format.

def _text_from_content_list(items: list) -> str:
    # Some messages store content as a list of strings or dicts — this flattens them
    pieces = []
    for item in items:
        if isinstance(item, str):
            pieces.append(item)
        elif isinstance(item, dict):
            text = item.get("text")
            if isinstance(text, str):
                pieces.append(text)
    return " ".join(pieces).strip()


def extract_user_text_from_payload(post_text: str) -> str:
    # Tries several common payload shapes to find what the user actually typed
    parsed = safe_json_loads(post_text)
    if not isinstance(parsed, dict):
        return ""

    # Simple "prompt" field (some APIs use this)
    if isinstance(parsed.get("prompt"), str):
        return parsed["prompt"].strip()

    # "input" field (used by some APIs)
    inp = parsed.get("input")
    if isinstance(inp, str):
        return inp.strip()
    if isinstance(inp, list):
        return _text_from_content_list(inp)

    # "messages" array — common in ChatGPT and Claude. We want the last user message.
    messages = parsed.get("messages")
    if isinstance(messages, list):
        for msg in reversed(messages):
            if not isinstance(msg, dict):
                continue
            role = str(msg.get("role", "")).lower()
            if not role:
                author = msg.get("author")
                if isinstance(author, dict):
                    role = str(author.get("role", "")).lower()
            if role != "user":
                continue

            content = msg.get("content")
            if isinstance(content, dict):
                parts = content.get("parts")
                if isinstance(parts, list):
                    return " ".join(str(x) for x in parts if x is not None).strip()
            if isinstance(content, str):
                return content.strip()
            if isinstance(content, list):
                return _text_from_content_list(content)

            parts = msg.get("parts")
            if isinstance(parts, list):
                return " ".join(str(x) for x in parts if x is not None).strip()

    return ""


def payload_has_role_user(post_text: str) -> bool:
    # Quick check: does this request body contain a user role message?
    # Used as a fast first pass before doing the full extraction above.
    if not post_text:
        return False
    lowered = post_text.lower()
    if '"role":"user"' in lowered or '"role": "user"' in lowered:
        return True

    parsed = safe_json_loads(post_text)
    if isinstance(parsed, dict):
        for msg in parsed.get("messages") or []:
            if not isinstance(msg, dict):
                continue
            if str(msg.get("role", "")).lower() == "user":
                return True
            author = msg.get("author")
            if isinstance(author, dict) and str(author.get("role", "")).lower() == "user":
                return True
    return False


# ── Send-candidate detection ──────────────────────────────────────────────────
# A "send candidate" is a POST request that looks like it carries a user message.
# We use several filters to separate real sends from all the background noise.

# URLs that look like sends but aren't — skip these
EXCLUDED_URL_SIGNALS = frozenset([
    "statsc/flush", "analytics", "telemetry", "segment", "amplitude",
    "track", "metrics", "events", "feedback", "list_accessible",
    "ping", "flush", "moderations", "implicit_message_feedback",
    "conversation/prepare",
    "chat-requirements",
    "sentinel/heartbeat",
    "backend-api/lat/",
    "paragen_submission",
    "generate_autocompletions",
    "search/product_",
])

# URLs that strongly indicate a real AI conversation endpoint
STRONG_ENDPOINTS = re.compile(
    r"backend-api/(?:f/)?conversation(?:/[0-9a-f\-]+)?$"
    r"|/responses|/completions|chat/completions"
    r"|a-api\.anthropic\.com|api\.anthropic\.com"
    r"|/append_message|/retry_completion"
    r"|claude\.ai/api",
    re.I,
)

# Domains that are definitely AI APIs
STRONG_DOMAINS = re.compile(
    r"a-api\.anthropic\.com|api\.anthropic\.com|claude\.ai",
    re.I
)


def is_send_candidate(url: str, method: str, post_data: str) -> bool:
    # Returns True if this request looks like a user hitting "send"
    if (method or "").upper() != "POST":
        return False  # only POST requests can be sends

    url_lower = (url or "").lower()
    if any(sig in url_lower for sig in EXCLUDED_URL_SIGNALS):
        return False  # skip known noise URLs

    post_text = post_data or ""
    if looks_like_system_or_telemetry_payload(post_text):
        return False  # skip background telemetry

    domain = urlparse(url).netloc
    if not STRONG_ENDPOINTS.search(url) and not STRONG_DOMAINS.search(domain):
        return False  # not an AI API endpoint

    if len(post_text.strip()) < 20:
        return False  # too short to be a real message

    if payload_has_role_user(post_text):
        return True

    if len(extract_user_text_from_payload(post_text)) >= 3:
        return True

    return False


def build_payload_preview(post_text: str, max_len: int = 200) -> str:
    # Extracts a short preview of what the user typed to show in the dashboard
    user_text = extract_user_text_from_payload(post_text)
    return (user_text or post_text or "")[:max_len]


# ── Diversity filtering ───────────────────────────────────────────────────────

def is_external_source_row(row: pd.Series) -> bool:
    # Returns True if this request represents the model fetching from an outside source.
    # We use this to measure how many different external sites were pulled into a response.
    domain = row.get("normalized_domain") or normalize_domain(row.get("domain", ""))
    category = row.get("category", "")
    is_send = bool(row.get("is_send_candidate", False))

    if not domain or domain == "unknown":
        return False
    if is_send:
        return False  # the send request itself isn't an "external fetch"
    if category in EXCLUDED_DIVERSITY_CATEGORIES:
        return False  # skip noise categories
    if is_internal_domain(domain):
        return False  # skip the AI platform's own domains

    return True


# ── Main processing ───────────────────────────────────────────────────────────
# This is where we actually loop through every request in every HAR file
# and build two lists: one for all requests (timeline), one for sends only.

timeline_rows: list[dict] = []       # every single request across all HAR files
candidate_send_rows: list[dict] = [] # just the ones that look like user sends

har_files = [f for f in os.listdir(HAR_DIR) if f.endswith(".har")]
if not har_files:
    log.warning("No .har files found in '%s'", HAR_DIR)

for filename in har_files:
    path = os.path.join(HAR_DIR, filename)
    log.info("Processing %s ...", filename)
    entries = load_har_entries(path)

    if not entries:
        log.warning("Skipping %s: no valid entries.", filename)
        continue

    file_candidate_count = 0

    for entry in entries:
        # Pull the basic fields out of each HAR entry
        request = entry.get("request", {})
        response = entry.get("response", {})
        content = response.get("content", {})

        url = request.get("url", "")
        method = request.get("method", "")
        post_data = request.get("postData", {}).get("text", "") or ""
        status = response.get("status", 0)
        mime_type = content.get("mimeType", "")
        started = entry.get("startedDateTime", "")
        time_ms = max(entry.get("time", 0), 0)

        bytes_transferred = get_bytes_transferred(response, content)
        domain = urlparse(url).netloc or "unknown"
        category = categorize_request(url, mime_type, domain)
        is_candidate = is_send_candidate(url, method, post_data)
        preview = build_payload_preview(post_data) if is_candidate else ""

        # Add every request to the main timeline
        timeline_rows.append({
            "har_file": filename,
            "startedDateTime": started,
            "url": url,
            "domain": domain,
            "normalized_domain": normalize_domain(domain),
            "method": method,
            "status": status,
            "mime_type": mime_type,
            "category": category,
            "time_ms": time_ms,
            "bytes_transferred": bytes_transferred,
            "is_send_candidate": is_candidate,
            "post_data_preview": preview,
        })

        # If it's a send, also parse the streaming response for richer data
        if is_candidate:
            file_candidate_count += 1
            sse = parse_sse_response(entry)
            candidate_send_rows.append({
                "har_file": filename,
                "startedDateTime": started,
                "url": url,
                "method": method,
                "status": status,
                "time_ms": time_ms,
                "bytes_transferred": bytes_transferred,
                "send_preview": preview,
                "sse_tool_invoked": sse["tool_invoked"],
                "sse_tool_name": sse["tool_name"],
                "sse_turn_use_case": sse["turn_use_case"],
                "sse_model_slug": sse["model_slug"],
                "sse_ttfb_ms": sse["ttfb_ms"],
                "sse_receive_ms": sse["receive_ms"],
                "sse_response_bytes": sse["response_bytes"],
                "sse_event_count": sse["sse_event_count"],
                "sse_server_fetched_urls": sse["server_fetched_urls"],
            })

    log.info("  %d requests, %d send candidates.", len(entries), file_candidate_count)

# ── DataFrames ────────────────────────────────────────────────────────────────
# Convert our lists into pandas DataFrames so we can sort, filter, and group easily.

timeline_df = pd.DataFrame(timeline_rows)
candidate_send_df = pd.DataFrame(candidate_send_rows)

if not timeline_df.empty:
    timeline_df["startedDateTime"] = pd.to_datetime(
        timeline_df["startedDateTime"], errors="coerce", utc=True
    )
    timeline_df.sort_values(["har_file", "startedDateTime", "url"], inplace=True)
    timeline_df.reset_index(drop=True, inplace=True)

if not candidate_send_df.empty:
    candidate_send_df["startedDateTime"] = pd.to_datetime(
        candidate_send_df["startedDateTime"], errors="coerce", utc=True
    )
    candidate_send_df.sort_values(["har_file", "startedDateTime", "url"], inplace=True)
    candidate_send_df.reset_index(drop=True, inplace=True)
else:
    # If no sends were found, create an empty DataFrame with the right columns
    candidate_send_df = pd.DataFrame(columns=[
        "har_file", "startedDateTime", "url", "method", "status",
        "time_ms", "bytes_transferred", "send_preview",
        "sse_tool_invoked", "sse_tool_name", "sse_turn_use_case", "sse_model_slug",
        "sse_ttfb_ms", "sse_receive_ms", "sse_response_bytes", "sse_event_count",
        "sse_server_fetched_urls",
    ])

# ── Merge nearby send candidates into single send events ─────────────────────
# One user "send" can trigger multiple back-to-back POST requests (e.g. retries
# or tool follow-ups). We group anything within 3 seconds into one send event.

merged_send_rows: list[dict] = []

for har_file, group in candidate_send_df.groupby("har_file", sort=False):
    group = group.sort_values("startedDateTime").reset_index(drop=True)
    cluster_index = 0
    current_cluster = []

    def flush_cluster(cluster, idx):
        # Take the first request in a cluster as the "anchor" (the real send)
        anchor = cluster[0]
        return {
            "har_file": har_file,
            "send_id": f"{har_file}::send{idx}",
            "anchor_time": anchor.startedDateTime,
            "anchor_url": anchor.url,
            "anchor_method": anchor.method,
            "anchor_status": anchor.status,
            "anchor_time_ms": anchor.time_ms,
            "anchor_preview": anchor.send_preview,
            "candidate_requests_merged": len(cluster),
            "sse_tool_invoked": anchor.sse_tool_invoked,
            "sse_tool_name": anchor.sse_tool_name,
            "sse_turn_use_case": anchor.sse_turn_use_case,
            "sse_model_slug": anchor.sse_model_slug,
            "sse_ttfb_ms": anchor.sse_ttfb_ms,
            "sse_receive_ms": anchor.sse_receive_ms,
            "sse_response_bytes": anchor.sse_response_bytes,
            "sse_event_count": anchor.sse_event_count,
            "sse_server_fetched_urls": anchor.sse_server_fetched_urls,
        }

    for row in group.itertuples(index=False):
        if not current_cluster:
            current_cluster = [row]
            continue

        # If this request is close enough to the last one, add it to the same cluster
        delta = (row.startedDateTime - current_cluster[-1].startedDateTime).total_seconds()
        if delta <= SEND_MERGE_WINDOW_SECONDS:
            current_cluster.append(row)
        else:
            # Too far apart — flush the current cluster and start a new one
            cluster_index += 1
            merged_send_rows.append(flush_cluster(current_cluster, cluster_index))
            current_cluster = [row]

    if current_cluster:
        cluster_index += 1
        merged_send_rows.append(flush_cluster(current_cluster, cluster_index))

merged_send_df = pd.DataFrame(merged_send_rows)

if merged_send_df.empty:
    merged_send_df = pd.DataFrame(columns=[
        "har_file", "send_id", "anchor_time", "anchor_url", "anchor_method",
        "anchor_status", "anchor_time_ms", "anchor_preview", "candidate_requests_merged",
        "sse_tool_invoked", "sse_tool_name", "sse_turn_use_case", "sse_model_slug",
        "sse_ttfb_ms", "sse_receive_ms", "sse_response_bytes", "sse_event_count",
        "sse_server_fetched_urls",
    ])

# ── Attach nearby requests to each send window ───────────────────────────────
# For each send, we look at all the other requests that happened in a small
# time window around it — those are likely the tool fetches and API calls
# triggered by that same send.

timeline_df["send_id"] = None

if not timeline_df.empty and not merged_send_df.empty:
    for har_file, file_requests in timeline_df.groupby("har_file", sort=False):
        file_sends = merged_send_df[merged_send_df["har_file"] == har_file]
        if file_sends.empty:
            continue

        req_times = file_requests["startedDateTime"].values
        send_times = file_sends["anchor_time"].values
        send_ids = file_sends["send_id"].values

        before_ns = pd.Timedelta(seconds=SEND_WINDOW_BEFORE_SECONDS).value
        after_ns = pd.Timedelta(seconds=SEND_WINDOW_AFTER_SECONDS).value

        for req_idx, req_time in zip(file_requests.index, req_times):
            if pd.isnull(req_time):
                continue

            req_time_ns = req_time.astype("int64")
            # Find all sends that fall within the time window of this request
            mask = (
                (send_times.astype("int64") >= req_time_ns - before_ns) &
                (send_times.astype("int64") <= req_time_ns + after_ns)
            )

            eligible_ids = send_ids[mask]
            eligible_times = send_times[mask].astype("int64")

            if len(eligible_ids) == 0:
                continue

            # Assign this request to the nearest send in the window
            nearest = eligible_ids[abs(eligible_times - req_time_ns).argmin()]
            timeline_df.at[req_idx, "send_id"] = nearest

# ── Build send details for dashboard ─────────────────────────────────────────
# Now that every request is tagged to a send, we aggregate stats per send
# and build the full detail objects that the dashboard will display.

send_window_df = timeline_df.dropna(subset=["send_id"]).copy()

if not send_window_df.empty:
    # Roll up counts and totals for each send event
    per_send_stats = (
        send_window_df.groupby(["har_file", "send_id"])
        .agg(
            total_requests=("url", "count"),
            total_latency_ms=("time_ms", "sum"),
            avg_latency_ms=("time_ms", "mean"),
            total_bytes=("bytes_transferred", "sum"),
            send_anchor_count=("is_send_candidate", "sum"),
            start_time=("startedDateTime", "min"),
            end_time=("startedDateTime", "max"),
        )
        .reset_index()
    )

    per_send_stats["cluster_duration_seconds"] = (
        per_send_stats["end_time"] - per_send_stats["start_time"]
    ).dt.total_seconds()

    # Join in the SSE fields (tool name, model, TTFB etc.) from the merged sends
    per_send_stats = per_send_stats.merge(merged_send_df, on=["har_file", "send_id"], how="left")

    send_details = []
    all_external_domains_across_sends = []
    normalized_diversity_values = []
    unique_domain_counts = []
    all_ttfb_values: list[float] = []
    tool_invoked_count = 0
    turn_use_case_counter: Counter = Counter()
    tool_name_counter: Counter = Counter()
    model_slug_counter: Counter = Counter()

    for send_id, group in send_window_df.groupby("send_id"):
        send_row = per_send_stats.loc[per_send_stats["send_id"] == send_id].iloc[0]

        # The actual send request(s) within this window
        send_requests = group[group["is_send_candidate"] == True][[
            "method", "status", "time_ms", "url", "post_data_preview"
        ]].copy()

        # Filter down to just the external domains the model fetched
        external_group = group[group.apply(is_external_source_row, axis=1)].copy()
        external_domains = external_group["normalized_domain"].tolist()
        domain_counts = Counter(external_domains)

        unique_external_domains = len(domain_counts)
        diversity_entropy = round(shannon_entropy(external_domains), 4)
        diversity_entropy_normalized = round(normalized_entropy(external_domains), 4)
        external_request_count = int(len(external_domains))
        internal_request_count = int(len(group) - external_request_count)

        # First 3 unique external domains (in the order they were fetched)
        first_external_domains = []
        if not external_group.empty:
            external_group_sorted = external_group.sort_values("startedDateTime")
            seen_ext: set[str] = set()
            for domain in external_group_sorted["normalized_domain"]:
                if domain not in seen_ext:
                    first_external_domains.append(domain)
                    seen_ext.add(domain)
                if len(first_external_domains) == 3:
                    break

        top_domains = [
            {"domain": domain, "count": count}
            for domain, count in domain_counts.most_common(5)
        ]

        all_external_domains_across_sends.extend(external_domains)
        normalized_diversity_values.append(diversity_entropy_normalized)
        unique_domain_counts.append(unique_external_domains)

        # Pull out the SSE-derived fields for this send
        ttfb = send_row.get("sse_ttfb_ms")
        receive = send_row.get("sse_receive_ms")
        tool_invoked = bool(send_row.get("sse_tool_invoked", False))
        tool_name = send_row.get("sse_tool_name") or None
        turn_use_case = send_row.get("sse_turn_use_case") or "unknown"
        model_slug = send_row.get("sse_model_slug") or "unknown"
        server_fetched_urls_raw = send_row.get("sse_server_fetched_urls") or []

        # Update global counters used for the summary cards
        if ttfb is not None:
            all_ttfb_values.append(float(ttfb))
        if tool_invoked:
            tool_invoked_count += 1
        turn_use_case_counter[turn_use_case] += 1
        if tool_name:
            tool_name_counter[tool_name] += 1
        if model_slug and model_slug != "unknown":
            model_slug_counter[model_slug] += 1

        fetched_url_details = [
            {"url": u, "domain": normalize_domain(urlparse(u).netloc)}
            for u in (server_fetched_urls_raw if isinstance(server_fetched_urls_raw, list) else [])
        ]

        # Build the full detail object for this send — this is what the dashboard reads
        send_details.append({
            "har_file": send_row["har_file"],
            "send_id": send_id,
            "anchor_preview": send_row["anchor_preview"],
            "total_requests": int(send_row["total_requests"]),
            "send_anchor_count": int(send_row["send_anchor_count"]),
            "total_latency_ms": round(float(send_row["total_latency_ms"]), 2),
            "avg_latency_ms": round(float(send_row["avg_latency_ms"]), 2),
            "total_bytes": int(send_row["total_bytes"]),
            "cluster_duration_seconds": round(float(send_row["cluster_duration_seconds"]), 2),
            "category_breakdown": (
                group.groupby("category").size()
                .reset_index(name="count")
                .sort_values("count", ascending=False)
                .to_dict(orient="records")
            ),
            "send_requests": send_requests.to_dict(orient="records"),
            "external_request_count": external_request_count,
            "internal_request_count": internal_request_count,
            "unique_external_domains": unique_external_domains,
            "source_diversity_entropy": diversity_entropy,
            "source_diversity_entropy_normalized": diversity_entropy_normalized,
            "top_external_domains": top_domains,
            "first_external_domains": first_external_domains,
            "ttfb_ms": round(float(ttfb), 2) if ttfb is not None else None,
            "receive_ms": round(float(receive), 2) if receive is not None else None,
            "response_bytes": int(send_row.get("sse_response_bytes") or 0),
            "sse_event_count": int(send_row.get("sse_event_count") or 0),
            "tool_invoked": tool_invoked,
            "tool_name": tool_name,
            "turn_use_case": turn_use_case,
            "model_slug": model_slug,
            "server_fetched_urls": fetched_url_details,
        })

    overall_domain_counts = Counter(all_external_domains_across_sends)
    total_sends = len(send_details)

    avg_ttfb = round(sum(all_ttfb_values) / len(all_ttfb_values), 2) if all_ttfb_values else None
    tool_invocation_rate = round(tool_invoked_count / total_sends, 4) if total_sends else 0

    # Source diversity = how many different outside sites the model pulled from
    overall_source_diversity = {
        "avg_unique_external_domains_per_send": round(
            sum(unique_domain_counts) / len(unique_domain_counts), 3
        ) if unique_domain_counts else 0,
        "avg_normalized_entropy_per_send": round(
            sum(normalized_diversity_values) / len(normalized_diversity_values), 3
        ) if normalized_diversity_values else 0,
        "total_unique_external_domains": len(overall_domain_counts),
        "top_external_domains_overall": [
            {"domain": domain, "count": count}
            for domain, count in overall_domain_counts.most_common(10)
        ],
    }

    # Tool summary — breakdown of turn modes, tool names, and models used
    tool_summary = {
        "tool_invocation_rate": tool_invocation_rate,
        "tool_invoked_count": tool_invoked_count,
        "turn_use_case_breakdown": [
            {"use_case": k, "count": v} for k, v in turn_use_case_counter.most_common()
        ],
        "tool_name_breakdown": [
            {"tool_name": k, "count": v} for k, v in tool_name_counter.most_common()
        ],
        "model_slug_breakdown": [
            {"model_slug": k, "count": v} for k, v in model_slug_counter.most_common()
        ],
    }

    # Latency summary — average TTFB and per-send breakdown for the bar chart
    latency_summary = {
        "avg_ttfb_ms": avg_ttfb,
        "ttfb_per_send": [
            {"send_id": d["send_id"], "ttfb_ms": d["ttfb_ms"], "turn_use_case": d["turn_use_case"]}
            for d in send_details
        ],
    }

    sends_summary = {"total_sends": total_sends, "details": send_details}

else:
    # No sends found — return empty shells so the dashboard still loads cleanly
    sends_summary = {"total_sends": 0, "details": []}
    overall_source_diversity = {
        "avg_unique_external_domains_per_send": 0,
        "avg_normalized_entropy_per_send": 0,
        "total_unique_external_domains": 0,
        "top_external_domains_overall": [],
    }
    tool_summary = {
        "tool_invocation_rate": 0,
        "tool_invoked_count": 0,
        "turn_use_case_breakdown": [],
        "tool_name_breakdown": [],
        "model_slug_breakdown": [],
    }
    latency_summary = {"avg_ttfb_ms": None, "ttfb_per_send": []}

# ── Final dashboard JSON ──────────────────────────────────────────────────────
# Pack everything into one JSON file that dashboard.html will fetch and display.

dashboard_data = {
    "total_requests": int(len(timeline_df)),
    "sends": sends_summary,
    "source_diversity": overall_source_diversity,
    "tool_summary": tool_summary,
    "latency_summary": latency_summary,
}

json_path = os.path.join(OUT_DIR, "dashboard_data.json")
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(dashboard_data, f, indent=2, default=str)

log.info("Wrote dashboard_data.json")
log.info("Analysis complete. Output -> %s/", OUT_DIR)
log.info("Detected %d merged send event(s).", sends_summary["total_sends"])
log.info("Tool invocation rate: %.0f%%", tool_summary["tool_invocation_rate"] * 100)
log.info("Avg TTFB: %s ms", latency_summary["avg_ttfb_ms"])
