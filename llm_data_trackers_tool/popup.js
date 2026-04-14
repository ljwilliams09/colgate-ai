// popup.js
chrome.storage.local.get(['log'], result => {
  const log = result.log || [];

  const claudeTrackers  = [...new Set(log.filter(e => e.ai.includes('claude'))
                            .map(e => e.tracker))];
  const chatgptTrackers = [...new Set(log.filter(e => e.ai.includes('chatgpt'))
                            .map(e => e.tracker))];

  document.getElementById('claude-list').textContent  = claudeTrackers.join(', ') || 'none detected yet';
  document.getElementById('chatgpt-list').textContent = chatgptTrackers.join(', ') || 'none detected yet';
  document.getElementById('total').textContent = log.length;
});