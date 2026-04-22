// ── fetch-interceptor.js (runs in MAIN world) ─────────────────────────────
// Patches window.fetch to intercept AI conversation requests and parse
// the streaming SSE response body for turn mode, tool, model, and latency.

(() => {
  // Debug flag — logs to console so you can see what's being captured
  const DEBUG = false;
  function dbg(...args) {
    if (DEBUG) console.log("[AI Capture]", ...args);
  }

  // Mark that this script loaded so we can verify in DevTools
  window.__aiCaptureLoaded = true;
  dbg("fetch interceptor loaded");

  const ORIGINAL_FETCH = window.fetch.bind(window);

  // URL patterns for AI conversation endpoints
  const CHATGPT_ALLOWED_PATHS = new Set([
    "/backend-anon/f/conversation",
    "/backend-api/f/conversation",
    "/backend-api/conversation",
  ]);
  const CLAUDE_PATH_PATTERN =
    /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion(?:\/)?(?:$|\?)/i;
  const ANTHROPIC_PATH_PATTERN =
    /\/v1\/(?:messages|complete|responses)(?:\/)?(?:$|\?)/i;

  function parseUrl(input) {
    try {
      return new URL(input, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function detectPlatform(urlString) {
    const parsed = parseUrl(urlString);
    if (!parsed) return { isChatGPT: false, isClaude: false, parsed: null };

    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const pathWithQuery = `${parsed.pathname}${parsed.search || ""}`;

    const isChatGPTHost = host === "chatgpt.com";
    const isClaudeHost = host === "claude.ai" || host.endsWith(".claude.ai");
    const isAnthropicHost =
      host === "api.anthropic.com" || host.endsWith(".anthropic.com");

    const isChatGPT =
      isChatGPTHost && CHATGPT_ALLOWED_PATHS.has(parsed.pathname);
    const isClaude =
      (isClaudeHost && CLAUDE_PATH_PATTERN.test(pathWithQuery)) ||
      (isAnthropicHost && ANTHROPIC_PATH_PATTERN.test(pathWithQuery));

    return { isChatGPT, isClaude, parsed };
  }

  // ── Prompt extraction ──────────────────────────────────────────────────

  // Pulls the user's prompt text out of the request body (first 200 chars)
  function extractPromptPreview(bodyText, platform) {
    try {
      const parsed = JSON.parse(bodyText);

      if (platform === "claude") {
        if (typeof parsed.prompt === "string")
          return parsed.prompt.slice(0, 200);
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
          if (typeof content === "string") return content.slice(0, 200);
        }
      }
    } catch (_) {}
    return "";
  }

  function isLikelyChatGptUserSend(bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      // if the body text can't be parsed, return false
      if (parsed?.action && parsed.action !== "next") return false;

      const messages = parsed?.messages;
      // if messages is not an array, or empty, return false
      if (!Array.isArray(messages) || messages.length === 0) return false;

      // check each element in messages for a role to be user, if not, the return false - some will check if any elements in messsages is true
      return messages.some((msg) => {
        const role = msg?.author?.role || msg?.role || "";
        if (role !== "user") return false;
        const content = msg?.content;
        if (typeof content === "string") return content.trim().length > 0;
        if (Array.isArray(content?.parts)) return content.parts.length > 0;
        return Boolean(content);
      });
    } catch (_) {
      return false;
    }
  }

  // ── SSE stream parser ──────────────────────────────────────────────────

  // Reads the SSE response stream and gets the tool, model, turn type, and byte count, then posts the result to relay.js
  async function processStream(stream, meta) {
    const decoder = new TextDecoder("utf-8", { stream: true });
    const reader = stream.getReader();

    let lineBuffer = "";
    let response_bytes = 0;
    let sse_event_count = 0;
    let tool_invoked = false;
    let tool_name = null;
    let turn_use_case = null;
    let model_slug = null;
    const server_fetched_urls = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        response_bytes += value.byteLength;
        lineBuffer += decoder.decode(value, { stream: true });

        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop(); // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith("data:")) continue;
          const raw = trimmed.slice(5).trim();
          if (raw === "[DONE]") continue;

          sse_event_count++;

          let obj;
          try {
            obj = JSON.parse(raw);
          } catch (_) {
            continue;
          }
          if (!obj || typeof obj !== "object") continue;

          const type = obj.type || "";

          if (type === "server_ste_metadata") {
            const m = obj.metadata || {};
            tool_invoked = Boolean(m.tool_invoked);
            tool_name = m.tool_name || null;
            turn_use_case = m.turn_use_case || null;
            model_slug = m.model_slug || null;
            dbg("metadata found:", {
              tool_invoked,
              tool_name,
              turn_use_case,
              model_slug,
            });
          }

          if (type === "url_moderation") {
            const u = obj.url_moderation_result?.full_url;
            if (u && !server_fetched_urls.includes(u))
              server_fetched_urls.push(u);
          }

          if (type === "message_start" && obj.message?.model)
            model_slug = obj.message.model;
          if (!model_slug && typeof obj.model === "string")
            model_slug = obj.model;
          if (!model_slug && typeof obj.model_slug === "string")
            model_slug = obj.model_slug;
        }
      }

      lineBuffer += decoder.decode(); // flush remaining bytes
    } catch (e) {
      dbg("stream read error:", e.message);
    }

    // Claude streams can omit ChatGPT-style metadata/SSE payloads; keep non-empty responses.
    if (sse_event_count === 0 && response_bytes === 0) {
      dbg("skipping — empty response stream");
      return;
    }

    // Default turn_use_case to "text" if the stream had no metadata event
    if (!turn_use_case) turn_use_case = "text";

    dbg("send captured:", {
      turn_use_case,
      tool_name,
      model_slug,
      ttfb_ms: meta.ttfb_ms,
    });

    window.postMessage(
      {
        __aiCapture: true,
        payload: {
          platform: meta.platform,
          url: meta.url,
          capturedAt: meta.capturedAt,
          ttfb_ms: meta.ttfb_ms,
          prompt_preview: meta.prompt_preview,
          response_bytes,
          sse_event_count,
          tool_invoked,
          tool_name,
          turn_use_case,
          model_slug,
          server_fetched_urls: server_fetched_urls.map((u) => {
            try {
              return {
                url: u,
                domain: new URL(u).hostname.replace(/^www\./, ""),
              };
            } catch (_) {
              return { url: u, domain: u };
            }
          }),
        },
      },
      "*",
    );
  }

  // ── Patched fetch ──────────────────────────────────────────────────────

  // Replaces window.fetch —> intercepts matching AI POST requests, clones the response, and passes it to processStream
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input?.url ?? "");
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();

    const { isChatGPT, isClaude, parsed } = detectPlatform(url);

    if (!(isChatGPT || isClaude) || method !== "POST") {
      return ORIGINAL_FETCH(input, init);
    }

    dbg("intercepted POST:", parsed?.href || url);

    const bodyText = typeof init?.body === "string" ? init.body : "";
    if (isChatGPT && !isLikelyChatGptUserSend(bodyText)) {
      dbg("skipping ChatGPT POST: not a user send payload");
      return ORIGINAL_FETCH(input, init);
    }

    const platform = isChatGPT ? "chatgpt" : "claude";
    const prompt_preview = extractPromptPreview(bodyText, platform);

    const callTime = Date.now();
    const response = await ORIGINAL_FETCH(input, init);
    const ttfb_ms = Date.now() - callTime;

    dbg("response received, status:", response.status, "ttfb:", ttfb_ms + "ms");

    if (!response.body) {
      dbg("no response body, skipping");
      return response;
    }

    const cloned = response.clone();
    processStream(cloned.body, {
      platform,
      url: parsed?.href || url,
      capturedAt: callTime,
      ttfb_ms,
      prompt_preview,
    }).catch((e) => dbg("processStream error:", e.message));

    return response;
  };
})();
