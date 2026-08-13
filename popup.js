(() => {
  const openDashboard = document.getElementById('openDashboard');
  const openAccounts = document.getElementById('openAccounts');

  openDashboard?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
  });

  openAccounts?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_ACCOUNTS_PAGE', category: 'bank' });
  });
})();
