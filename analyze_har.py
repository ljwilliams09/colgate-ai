#!/usr/bin/env python3
"""Analyze HAR files and generate metrics plus an HTML dashboard."""

import argparse
import csv
import json
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from urllib.parse import urlparse


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    if p <= 0:
        return min(values)
    if p >= 100:
        return max(values)
    sorted_values = sorted(values)
    rank = (len(sorted_values) - 1) * (p / 100)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return sorted_values[low]
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (rank - low)


def categorize_request(hostname: str, path: str, content_type: str) -> str:
    host = hostname.lower()
    p = path.lower()
    ct = content_type.lower()

    if "analytics" in host or "/v1/b" in p or "rgstr" in p or "segment" in host:
        return "analytics"
    if "auth" in p or "login" in p or "signin" in p:
        return "auth"
    if "sentinel" in p or "captcha" in p or "challenge" in p:
        return "security"
    if p.endswith((".js", ".css", ".png", ".jpg", ".jpeg", ".svg", ".woff", ".woff2")):
        return "static"
    if "javascript" in ct or "text/css" in ct or "image/" in ct or "font/" in ct:
        return "static"
    if "/api" in p or "json" in ct or "graphql" in p:
        return "api"
    return "other"


def read_har_entries(har_path: Path) -> list[dict]:
    with har_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("log", {}).get("entries", [])


def safe_datetime(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.isoformat()
    except Exception:
        return value


def analyze_file(har_path: Path) -> dict:
    entries = read_har_entries(har_path)

    methods = Counter()
    statuses = Counter()
    domains = Counter()
    categories = Counter()
    content_types = Counter()
    response_times = []
    timeline_rows = []

    for entry in entries:
        request = entry.get("request", {})
        response = entry.get("response", {})
        started = safe_datetime(entry.get("startedDateTime", ""))
        total_time = float(entry.get("time", 0) or 0)

        url = request.get("url", "")
        parsed = urlparse(url)
        hostname = (parsed.hostname or "").lower()
        path = parsed.path or "/"

        method = request.get("method", "UNKNOWN")
        status = str(response.get("status", "UNKNOWN"))

        content_type = ""
        headers = response.get("headers", [])
        for h in headers:
            if h.get("name", "").lower() == "content-type":
                content_type = h.get("value", "")
                break

        category = categorize_request(hostname, path, content_type)

        methods[method] += 1
        statuses[status] += 1
        if hostname:
            domains[hostname] += 1
        categories[category] += 1
        if content_type:
            content_types[content_type.split(";")[0].strip()] += 1

        response_times.append(total_time)

        timeline_rows.append(
            {
                "har_file": har_path.name,
                "startedDateTime": started,
                "domain": hostname,
                "path": path,
                "method": method,
                "status": status,
                "category": category,
                "time_ms": round(total_time, 2),
            }
        )

    stats = {
        "file": har_path.name,
        "total_requests": len(entries),
        "avg_time_ms": round(mean(response_times), 2) if response_times else 0,
        "median_time_ms": round(median(response_times), 2) if response_times else 0,
        "p95_time_ms": round(percentile(response_times, 95), 2) if response_times else 0,
        "method_counts": dict(methods),
        "status_counts": dict(statuses),
        "top_domains": domains.most_common(15),
        "category_counts": dict(categories),
        "top_content_types": content_types.most_common(10),
        "timeline": timeline_rows,
    }
    return stats


def write_summary_csv(all_stats: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "har_file",
                "total_requests",
                "avg_time_ms",
                "median_time_ms",
                "p95_time_ms",
            ]
        )
        for s in all_stats:
            writer.writerow(
                [
                    s["file"],
                    s["total_requests"],
                    s["avg_time_ms"],
                    s["median_time_ms"],
                    s["p95_time_ms"],
                ]
            )


def write_top_domains_csv(all_stats: list[dict], output_path: Path) -> None:
    aggregate = Counter()
    for s in all_stats:
        for domain, count in s["top_domains"]:
            aggregate[domain] += count

    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["domain", "requests"])
        for domain, count in aggregate.most_common():
            writer.writerow([domain, count])


def write_timeline_csv(all_stats: list[dict], output_path: Path) -> None:
    rows = []
    for s in all_stats:
        rows.extend(s["timeline"])

    rows.sort(key=lambda r: (r["har_file"], r["startedDateTime"]))

    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "har_file",
                "startedDateTime",
                "domain",
                "path",
                "method",
                "status",
                "category",
                "time_ms",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def build_dashboard_data(all_stats: list[dict]) -> dict:
    domain_counter = Counter()
    category_counter = Counter()
    status_counter = Counter()
    per_file_latency = {}

    for s in all_stats:
        for domain, count in s["top_domains"]:
            domain_counter[domain] += count
        for k, v in s["category_counts"].items():
            category_counter[k] += v
        for k, v in s["status_counts"].items():
            status_counter[k] += v
        per_file_latency[s["file"]] = {
            "avg": s["avg_time_ms"],
            "median": s["median_time_ms"],
            "p95": s["p95_time_ms"],
        }

    return {
        "total_requests": sum(s["total_requests"] for s in all_stats),
        "files": [s["file"] for s in all_stats],
        "top_domains": domain_counter.most_common(12),
        "category_counts": dict(category_counter),
        "status_counts": dict(status_counter),
        "per_file_latency": per_file_latency,
    }


def write_dashboard_html(dashboard_data: dict, output_path: Path) -> None:
    payload = json.dumps(dashboard_data)
    html = f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">
  <title>HAR Network Insights</title>
  <style>
    :root {{
      --bg: #f5f3ee;
      --card: #fffaf2;
      --ink: #1f2a30;
      --muted: #5c6a71;
      --accent: #1b7f79;
      --accent-2: #e38b29;
      --border: #d9d2c2;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background: radial-gradient(circle at 10% 20%, #fff7e8 0%, var(--bg) 45%, #e9edf0 100%);
    }}
    .wrap {{
      max-width: 1100px;
      margin: 0 auto;
      padding: 24px;
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: clamp(1.8rem, 3.4vw, 2.6rem);
      letter-spacing: 0.02em;
    }}
    p {{ margin: 0; color: var(--muted); }}
    .grid {{
      margin-top: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 16px;
      box-shadow: 0 4px 24px rgba(40, 50, 56, 0.08);
    }}
    h2 {{ margin: 0 0 10px; font-size: 1.05rem; }}
    .metric {{ font-size: 2rem; color: var(--accent); margin-top: 8px; }}
    .bar {{
      display: grid;
      grid-template-columns: 170px 1fr auto;
      align-items: center;
      gap: 10px;
      margin: 8px 0;
      font-size: 0.92rem;
    }}
    .bar .label {{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .bar .track {{
      height: 11px;
      background: #ece6d7;
      border-radius: 99px;
      overflow: hidden;
    }}
    .bar .fill {{
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
    }}
    .latency-table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
    .latency-table th, .latency-table td {{
      text-align: left;
      border-bottom: 1px solid var(--border);
      padding: 8px 4px;
    }}
    .status-pill {{
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 8px;
      margin: 4px 6px 0 0;
      background: #fff;
      font-size: 0.84rem;
    }}
  </style>
</head>
<body>
  <div class=\"wrap\">
    <h1>HAR Network Insights Dashboard</h1>
    <p>Systematic view of request mix, latency profile, and top internet dependencies.</p>
    <div class=\"grid\">
      <section class=\"card\">
        <h2>Total Requests</h2>
        <div class=\"metric\" id=\"totalRequests\">-</div>
      </section>

      <section class=\"card\">
        <h2>Top Domains</h2>
        <div id=\"topDomains\"></div>
      </section>

      <section class=\"card\">
        <h2>Request Categories</h2>
        <div id=\"categories\"></div>
      </section>

      <section class=\"card\">
        <h2>Status Codes</h2>
        <div id=\"statuses\"></div>
      </section>

      <section class=\"card\" style=\"grid-column: 1 / -1;\">
        <h2>Per-File Latency (ms)</h2>
        <table class=\"latency-table\">
          <thead><tr><th>HAR File</th><th>Avg</th><th>Median</th><th>P95</th></tr></thead>
          <tbody id=\"latencyRows\"></tbody>
        </table>
      </section>
    </div>
  </div>

  <script>
    const data = {payload};

    const byValue = (a, b) => b[1] - a[1];

    function renderBars(targetId, items) {{
      const host = document.getElementById(targetId);
      if (!items.length) {{
        host.textContent = 'No data';
        return;
      }}
      const maxValue = items[0][1] || 1;
      host.innerHTML = items.map(([label, value]) => {{
        const width = Math.max(4, Math.round((value / maxValue) * 100));
        return `
          <div class="bar">
            <div class="label" title="${{label}}">${{label}}</div>
            <div class="track"><div class="fill" style="width:${{width}}%"></div></div>
            <div>${{value}}</div>
          </div>
        `;
      }}).join('');
    }}

    document.getElementById('totalRequests').textContent = data.total_requests;

    renderBars('topDomains', data.top_domains);
    renderBars('categories', Object.entries(data.category_counts).sort(byValue));

    const statusHost = document.getElementById('statuses');
    statusHost.innerHTML = Object.entries(data.status_counts)
      .sort(byValue)
      .map(([code, count]) => `<span class="status-pill">${{code}}: ${{count}}</span>`)
      .join('');

    const latencyRows = document.getElementById('latencyRows');
    latencyRows.innerHTML = Object.entries(data.per_file_latency)
      .map(([file, lat]) => `
        <tr>
          <td>${{file}}</td>
          <td>${{lat.avg}}</td>
          <td>${{lat.median}}</td>
          <td>${{lat.p95}}</td>
        </tr>
      `)
      .join('');
  </script>
</body>
</html>
"""
    with output_path.open("w", encoding="utf-8") as f:
        f.write(html)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze HAR files and generate metrics + HTML dashboard."
    )
    parser.add_argument(
        "input",
        nargs="+",
        help="HAR files or directories containing HAR files",
    )
    parser.add_argument(
        "--out-dir",
        default="har_analysis_output",
        help="Directory for generated reports (default: har_analysis_output)",
    )
    args = parser.parse_args()

    har_paths = []
    for item in args.input:
        p = Path(item)
        if p.is_dir():
            har_paths.extend(sorted(p.glob("*.har")))
        elif p.is_file() and p.suffix.lower() == ".har":
            har_paths.append(p)

    if not har_paths:
        raise SystemExit("No HAR files found. Provide .har files or a directory containing them.")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    all_stats = [analyze_file(p) for p in har_paths]

    summary_csv = out_dir / "summary.csv"
    domains_csv = out_dir / "top_domains.csv"
    timeline_csv = out_dir / "timeline.csv"
    dashboard_html = out_dir / "dashboard.html"

    write_summary_csv(all_stats, summary_csv)
    write_top_domains_csv(all_stats, domains_csv)
    write_timeline_csv(all_stats, timeline_csv)

    dashboard_data = build_dashboard_data(all_stats)
    write_dashboard_html(dashboard_data, dashboard_html)

    with (out_dir / "dashboard_data.json").open("w", encoding="utf-8") as f:
        json.dump(dashboard_data, f, indent=2)

    print(f"Analyzed {len(har_paths)} HAR file(s)")
    print(f"- {summary_csv}")
    print(f"- {domains_csv}")
    print(f"- {timeline_csv}")
    print(f"- {dashboard_html}")


if __name__ == "__main__":
    main()