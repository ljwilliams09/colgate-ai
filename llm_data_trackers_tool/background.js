// background.js 

const WATCHED_SITES = ['claude.ai', 'chatgpt.com'];

const TRACKERS = {
  'connect.facebook.net':      { label: 'Facebook (Meta)',  ai: 'Claude' },
  'www.google-analytics.com':  { label: 'Google Analytics', ai: 'ChatGPT' },
  'googletagmanager.com':      { label: 'Google Tag Manager', ai: 'ChatGPT' },
  'browser-intake-us5-datadoghq.com': { label: 'Datadog', ai: 'Both' },
  'api-iam.intercom.io':       { label: 'Intercom', ai: 'Both' },
};

// Watch every request
chrome.webRequest.onBeforeRequest.addListener(details => {
  chrome.tabs.get(details.tabId, tab => {
    if (!tab?.url) return;

    // Are we on an AI site?
    const onAI = WATCHED_SITES.find(s => tab.url.includes(s));
    if (!onAI) return;

    // Is this request going to a tracker?
    const tracker = Object.entries(TRACKERS)
      .find(([domain]) => details.url.includes(domain));
    if (!tracker) return;

    const [domain, info] = tracker;

    // Log it
    chrome.storage.local.get(['log'], result => {
      const log = result.log || [];
      log.push({
        ai:      onAI,          // 'claude.ai' or 'chatgpt.com'
        tracker: info.label,    // 'Facebook (Meta)'
        domain:  domain,
        time:    Date.now(),
      });
      chrome.storage.local.set({ log });
    });
  });
}, { urls: ['<all_urls>'] });