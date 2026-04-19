// ── fetch-interceptor.js (runs in MAIN world) ─────────────────────────────
// Patches window.fetch to intercept AI conversation requests and parse
// the streaming SSE response body for turn mode, tool, model, and latency.

(() => {
  // Debug flag — logs to console so you can see what's being captured
  const DEBUG = true;
  function dbg(...args) { if (DEBUG) console.log("[AI Capture]", ...args); }

  // Mark that this script loaded so we can verify in DevTools
  window.__aiCaptureLoaded = true;
  dbg("fetch interceptor loaded");

  const ORIGINAL_FETCH = window.fetch.bind(window);

  // URL patterns for AI conversation endpoints
  const CHATGPT_PATTERN = /backend-api\/(?:f\/)?conversation|\/responses|chat\/completions/i;
  const CLAUDE_PATTERN  = /claude\.ai\/api\/.*\/chat_conversations\//i;

  // ── Prompt extraction ──────────────────────────────────────────────────

  function extractPromptPreview(bodyText, platform) {
    try {
      const parsed = JSON.parse(bodyText);

      if (platform === "claude") {
        if (typeof parsed.prompt === "string") return parsed.prompt.slice(0, 200);
      }

      const messages = parsed.messages;
      if (Array.isArray(messages)) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          const role = msg?.author?.role || msg?.role || "";
          if (role !== "user") continue;
          const content = msg.content;
          if (content?.parts && Array.isArray(content.parts)) {
            return content.parts.filter(Boolean).join(" ").slice(0, 200);
          }
          if (typeof content=== "string") return content.slice(0, 200);
        }
      }
    } catch (_) {}
    return "";
  }

  // ── SSE stream parser ──────────────────────────────────────────────────

  async function processStream(stream, meta) {
    const decoder = new TextDecoder("utf-8", { stream: true });
    const reader  = stream.getReader();

    let lineBuffer     = "";
    let response_bytes = 0;
    let sse_event_count = 0;
    let tool_invoked   = false;
    let tool_name      = null;
    let turn_use_case  = null;
    let model_slug     = null;
    const server_fetched_urls = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        response_bytes += value.byteLength;
        lineBuffer += decoder.decode(value, { stream: true });

        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (raw === "[DONE]") continue;

          sse_event_count++;

          let obj;
          try { obj = JSON.parse(raw); } catch (_) { continue; }
          if (!obj || typeof obj !== "object") continue;

          const type = obj.type || "";

          if (type === "server_ste_metadata") {
            const m = obj.metadata || {};
            tool_invoked  = Boolean(m.tool_invoked);
            tool_name     = m.tool_name    || null;
            turn_use_case = m.turn_use_case || null;
            model_slug    = m.model_slug   || null;
            dbg("metadata found:", { tool_invoked, tool_name, turn_use_case, model_slug });
          }

          if (type === "url_moderation") {
            const u = obj.url_moderation_result?.full_url;
            if (u && !server_fetched_urls.includes(u)) server_fetched_urls.push(u);
          }

          if (type === "message_start" && obj.message?.model) {
            model_slug = obj.message.model;
          }
        }
      }

      lineBuffer += decoder.decode(); // flush remaining bytes

    } catch (e) {
      dbg("stream read error:", e.message);
    }

    // If we got no SSE events at all, this was a background request — not a real user send
    if (sse_event_count === 0) {
      dbg("skipping — no SSE events (background request)");
      return;
    }

    // Default turn_use_case to "text" if the stream had no metadata event
    if (!turn_use_case) turn_use_case = "text";

    dbg("send captured:", { turn_use_case, tool_name, model_slug, ttfb_ms: meta.ttfb_ms });

    window.postMessage({
      __aiCapture: true,
      payload: {
        platform:   meta.platform,
        url:        meta.url,
        capturedAt: meta.capturedAt,
        ttfb_ms:    meta.ttfb_ms,
        prompt_preview: meta.prompt_preview,
        response_bytes,
        sse_event_count,
        tool_invoked,
        tool_name,
        turn_use_case,
        model_slug,
        server_fetched_urls: server_fetched_urls.map(u => {
          try {
            return { url: u, domain: new URL(u).hostname.replace(/^www\./, "") };
          } catch (_) {
            return { url: u, domain: u };
          }
        }),
      },
    }, "*");
  }

  // ── Patched fetch ──────────────────────────────────────────────────────

  window.fetch = async function (input, init) {
    const url    = typeof input === "string" ? input : (input?.url ?? "");
    const method = ((init?.method ?? (input?.method ?? "GET"))).toUpperCase();

    const isChatGPT = CHATGPT_PATTERN.test(url);
    const isClaude  = CLAUDE_PATTERN.test(url);

    if (!(isChatGPT || isClaude) || method !== "POST") {
      return ORIGINAL_FETCH(input, init);
    }

    dbg("intercepted POST:", url);

    const bodyText = typeof init?.body === "string" ? init.body : "";
    const platform = isChatGPT ? "chatgpt" : "claude";
    const prompt_preview = extractPromptPreview(bodyText, platform);

    const callTime = Date.now();
    const response = await ORIGINAL_FETCH(input, init);
    const ttfb_ms  = Date.now() - callTime;

    dbg("response received, status:", response.status, "ttfb:", ttfb_ms + "ms");

    if (!response.body) {
      dbg("no response body, skipping");
      return response;
    }

    // Use clone() instead of tee() — returns the original response untouched
    // so ChatGPT's frontend works normally
    const cloned = response.clone();
    processStream(cloned.body, {
      platform, url, capturedAt: callTime, ttfb_ms, prompt_preview,
    }).catch(e => dbg("processStream error:", e.message));

    return response;
  };

})();
