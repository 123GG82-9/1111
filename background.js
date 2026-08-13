let dashboardWindowId = null;
const DASHBOARD_URL = chrome.runtime.getURL('dashboard.html');

function getLastFocusedWindowBounds() {
  return new Promise((resolve) => {
    chrome.windows.getLastFocused({}, (win) => {
      if (chrome.runtime.lastError || !win) {
        resolve({ left: 120, top: 80, width: 1200, height: 820 });
        return;
      }
      const width = Math.min(1400, Math.max(1000, Math.floor(win.width * 0.8)));
      const height = Math.min(900, Math.max(700, Math.floor(win.height * 0.9)));
      resolve({
        left: Math.max(0, win.left + Math.floor((win.width - width) / 2)),
        top: Math.max(0, win.top + Math.floor((win.height - height) / 2)),
        width,
        height
      });
    });
  });
}

function focusDashboardWindow() {
  return new Promise((resolve) => {
    if (!dashboardWindowId) return resolve(false);
    chrome.windows.get(dashboardWindowId, {}, (win) => {
      if (chrome.runtime.lastError || !win) {
        dashboardWindowId = null;
        return resolve(false);
      }
      chrome.windows.update(dashboardWindowId, { focused: true }, () => resolve(true));
    });
  });
}

async function openOrFocusDashboard() {
  if (await focusDashboardWindow()) return;
  const bounds = await getLastFocusedWindowBounds();
  chrome.windows.create({
    url: DASHBOARD_URL,
    type: 'popup',
    focused: true,
    width: bounds.width,
    height: bounds.height,
    left: bounds.left,
    top: bounds.top
  }, (win) => {
    if (!chrome.runtime.lastError && win) dashboardWindowId = win.id;
  });
}

chrome.action.onClicked.addListener(openOrFocusDashboard);
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === dashboardWindowId) dashboardWindowId = null;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'OPEN_ACCOUNTS_PAGE') {
    const url = chrome.runtime.getURL('accounts.html') + (msg.category ? '?category=' + encodeURIComponent(msg.category) : '');
    chrome.tabs.create({ url }, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === 'OPEN_DASHBOARD') {
    openOrFocusDashboard().then(() => sendResponse({ ok: true }));
    return true;
  }
});
