// popup.js — 点击按钮激活着色工具
document.getElementById('activateBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_COLORIZER' });
  } catch (e) {
    // content script 未注入，先注入
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content.js']
    });
    setTimeout(async () => {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE_COLORIZER' });
      } catch (e2) {
        console.error('Failed:', e2);
      }
    }, 500);
  }
  window.close();
});
