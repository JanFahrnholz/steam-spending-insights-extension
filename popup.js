// Steam Spending Insights - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const activeEl = document.getElementById('active');
  const inactiveEl = document.getElementById('inactive');
  const txCountEl = document.getElementById('txCount');
  const scrollBtn = document.getElementById('scrollBtn');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('store.steampowered.com/account/history')) {
      showInactive();
      return;
    }

    // Try to get status from content script
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });

      if (response && response.active) {
        txCountEl.textContent = response.transactionCount;
        showActive();

        scrollBtn.addEventListener('click', async () => {
          await chrome.tabs.sendMessage(tab.id, { action: 'scrollToDashboard' });
          window.close();
        });
      } else {
        showInactive();
      }
    } catch (e) {
      // Content script not ready, try to inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });

        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 500));

        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatus' });
        if (response && response.active) {
          txCountEl.textContent = response.transactionCount;
          showActive();

          scrollBtn.addEventListener('click', async () => {
            await chrome.tabs.sendMessage(tab.id, { action: 'scrollToDashboard' });
            window.close();
          });
        } else {
          showInactive();
        }
      } catch (injectError) {
        console.error('Failed to inject script:', injectError);
        showInactive();
      }
    }
  } catch (error) {
    console.error('Error:', error);
    showInactive();
  }

  function showActive() {
    statusEl.classList.add('hidden');
    inactiveEl.classList.add('hidden');
    activeEl.classList.remove('hidden');
  }

  function showInactive() {
    statusEl.classList.add('hidden');
    activeEl.classList.add('hidden');
    inactiveEl.classList.remove('hidden');
  }
});
