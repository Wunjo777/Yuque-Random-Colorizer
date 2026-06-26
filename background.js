// background.js — 点击图标 → 通知 content script 激活
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_COLORIZER' });
  } catch (e) {
    // content script 未注入，先注入再激活
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_COLORIZER' });
      } catch (e2) {
        console.error('[Colorizer] Activate failed:', e2);
      }
    }, 300);
  }
});
