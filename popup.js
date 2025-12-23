// Steam Spending Analyzer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const statsEl = document.getElementById('stats');

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('store.steampowered.com/account/history')) {
      showError('Please navigate to your Steam Purchase History page first.');
      return;
    }

    // Try to inject content script if not already loaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {
      // Script might already be injected, continue
      console.log('Script injection:', e.message);
    }

    // Small delay to ensure script is ready
    await new Promise(resolve => setTimeout(resolve, 100));

    // Request transactions from content script
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getTransactions' });
    } catch (e) {
      console.error('Message error:', e);
      showError('Could not communicate with the page. Please refresh the Steam page and try again.');
      return;
    }

    if (!response || !response.transactions || response.transactions.length === 0) {
      showError('No transactions found. Make sure to scroll down on the Steam page to load all your transaction history.');
      return;
    }

    // Reconstruct Date objects (they get serialized to strings in message passing)
    const transactions = response.transactions.map(t => ({
      ...t,
      date: t.date ? new Date(t.date) : null
    }));
    calculateAndDisplayStats(transactions);
    showStats();

  } catch (error) {
    console.error('Error:', error);
    showError('An error occurred: ' + error.message);
  }

  function showError(message) {
    loadingEl.classList.add('hidden');
    if (message) {
      errorEl.innerHTML = `<p>${message}</p><p class="hint">Make sure to scroll down to load all transactions you want to analyze.</p>`;
    }
    errorEl.classList.remove('hidden');
  }

  function showStats() {
    loadingEl.classList.add('hidden');
    statsEl.classList.remove('hidden');
  }

  function formatCurrency(amount, currency = '€') {
    return `${amount.toFixed(2)}${currency}`;
  }

  function formatDate(date) {
    if (!date) return '-';
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function calculateAndDisplayStats(transactions) {
    const currency = transactions[0]?.currency || '€';

    // Categorize transactions
    const walletFundings = transactions.filter(t => t.isWalletFunding);
    const refunds = transactions.filter(t => t.isRefund);
    const marketSales = transactions.filter(t => t.isMarketSale);
    const marketPurchases = transactions.filter(t => t.isMarketPurchase);
    const giftPurchases = transactions.filter(t => t.isGiftPurchase || t.isGift);
    const inGamePurchases = transactions.filter(t =>
      t.transactionType.includes('im Spiel') || t.transactionType.includes('In-Game')
    );
    const gamePurchases = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketTransaction && !t.isGiftPurchase &&
      !t.transactionType.includes('im Spiel') && !t.transactionType.includes('In-Game') &&
      t.total > 0
    );

    // All actual spending (excluding wallet funding and refunds)
    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && t.total > 0
    );

    // Calculate totals
    const totalWalletFunded = walletFundings.reduce((sum, t) => sum + t.total, 0);
    const totalRefunded = refunds.reduce((sum, t) => sum + Math.abs(t.walletChange), 0);
    const totalMarketSpent = marketPurchases.reduce((sum, t) => sum + t.total, 0);
    const totalMarketEarned = marketSales.reduce((sum, t) => sum + Math.abs(t.walletChange), 0);
    const totalGiftValue = giftPurchases.reduce((sum, t) => sum + t.total, 0);
    const totalInGame = inGamePurchases.reduce((sum, t) => sum + t.total, 0);
    const totalGamePurchases = gamePurchases.reduce((sum, t) => sum + t.total, 0);
    const totalSpent = allSpending.reduce((sum, t) => sum + t.total, 0);

    // Averages (excluding special transactions)
    const purchaseAmounts = allSpending
      .filter(t => !t.isMarketTransaction)
      .map(t => t.total)
      .filter(a => a > 0);

    const avgPurchase = purchaseAmounts.length > 0
      ? purchaseAmounts.reduce((a, b) => a + b, 0) / purchaseAmounts.length
      : 0;

    // Median
    const sortedAmounts = [...purchaseAmounts].sort((a, b) => a - b);
    const medianPurchase = sortedAmounts.length > 0
      ? sortedAmounts.length % 2 === 0
        ? (sortedAmounts[sortedAmounts.length / 2 - 1] + sortedAmounts[sortedAmounts.length / 2]) / 2
        : sortedAmounts[Math.floor(sortedAmounts.length / 2)]
      : 0;

    // Extremes
    const largestPurchase = Math.max(...purchaseAmounts, 0);
    const smallestPurchase = purchaseAmounts.length > 0 ? Math.min(...purchaseAmounts) : 0;

    // Time analysis
    const datesWithData = transactions.filter(t => t.date).map(t => t.date);
    const sortedDates = [...datesWithData].sort((a, b) => a - b);
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    // Calculate months/years span
    let monthsSpan = 1;
    let yearsSpan = 1;
    let accountAgeDays = 0;
    if (firstDate && lastDate) {
      monthsSpan = Math.max(1,
        (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
        (lastDate.getMonth() - firstDate.getMonth()) + 1
      );
      yearsSpan = Math.max(1, lastDate.getFullYear() - firstDate.getFullYear() + 1);
      accountAgeDays = Math.floor((lastDate - firstDate) / (1000 * 60 * 60 * 24));
    }

    // Average days between purchases
    const avgDaysBetween = sortedDates.length > 1
      ? accountAgeDays / (sortedDates.length - 1)
      : 0;

    const avgPerMonth = totalSpent / monthsSpan;
    const avgPerYear = totalSpent / yearsSpan;

    // Format account age
    const years = Math.floor(accountAgeDays / 365);
    const months = Math.floor((accountAgeDays % 365) / 30);
    const accountAgeStr = years > 0 ? `${years}y ${months}m` : `${months} months`;

    // Display overview stats
    document.getElementById('totalSpent').textContent = formatCurrency(totalSpent, currency);
    document.getElementById('totalTransactions').textContent = transactions.length;
    document.getElementById('walletFunded').textContent = formatCurrency(totalWalletFunded, currency);
    document.getElementById('totalRefunds').textContent = formatCurrency(totalRefunded, currency);

    // Display money flow
    document.getElementById('gamePurchases').textContent = formatCurrency(totalGamePurchases, currency);
    document.getElementById('inGamePurchases').textContent = formatCurrency(totalInGame, currency);
    document.getElementById('marketSpent').textContent = formatCurrency(totalMarketSpent, currency);
    document.getElementById('marketEarned').textContent = formatCurrency(totalMarketEarned, currency);

    // Display gift stats
    document.getElementById('giftsSent').textContent = giftPurchases.length;
    document.getElementById('giftValue').textContent = formatCurrency(totalGiftValue, currency);

    // Display averages
    document.getElementById('avgPurchase').textContent = formatCurrency(avgPurchase, currency);
    document.getElementById('medianPurchase').textContent = formatCurrency(medianPurchase, currency);
    document.getElementById('largestPurchase').textContent = formatCurrency(largestPurchase, currency);
    document.getElementById('smallestPurchase').textContent = formatCurrency(smallestPurchase, currency);

    // Display time stats
    document.getElementById('firstPurchase').textContent = formatDate(firstDate);
    document.getElementById('latestPurchase').textContent = formatDate(lastDate);
    document.getElementById('avgPerMonth').textContent = formatCurrency(avgPerMonth, currency);
    document.getElementById('avgPerYear').textContent = formatCurrency(avgPerYear, currency);
    document.getElementById('accountAge').textContent = accountAgeStr;
    document.getElementById('avgDaysBetween').textContent = `${avgDaysBetween.toFixed(1)} days`;

    // Yearly breakdown
    const yearlyData = {};
    allSpending.forEach(t => {
      if (t.date) {
        const year = t.date.getFullYear();
        if (!yearlyData[year]) yearlyData[year] = { total: 0, count: 0 };
        yearlyData[year].total += t.total;
        yearlyData[year].count++;
      }
    });
    renderBreakdown('yearlyStats', yearlyData, currency, true);

    // Monthly breakdown
    const monthlyData = {};
    allSpending.forEach(t => {
      if (t.date) {
        const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[key]) monthlyData[key] = { total: 0, count: 0 };
        monthlyData[key].total += t.total;
        monthlyData[key].count++;
      }
    });
    renderBreakdown('monthlyStats', monthlyData, currency, true);

    // Game breakdown (excluding market and wallet funding)
    const gameData = {};
    allSpending.filter(t => !t.isMarketTransaction && t.gameName).forEach(t => {
      const game = t.gameName || 'Unknown';
      if (!gameData[game]) gameData[game] = { total: 0, count: 0 };
      gameData[game].total += t.total;
      gameData[game].count++;
    });
    renderBreakdown('gameStats', gameData, currency, false, 25);

    // Transaction type breakdown
    const typeData = {};
    transactions.forEach(t => {
      const type = t.transactionType || 'Unknown';
      if (!typeData[type]) typeData[type] = { total: 0, count: 0 };
      typeData[type].total += t.total || Math.abs(t.walletChange);
      typeData[type].count++;
    });
    renderBreakdown('typeStats', typeData, currency);

    // Payment method breakdown
    const paymentData = {};
    transactions.filter(t => t.paymentMethod).forEach(t => {
      const method = t.paymentMethod || 'Unknown';
      if (!paymentData[method]) paymentData[method] = { total: 0, count: 0 };
      paymentData[method].total += t.total || Math.abs(t.walletChange);
      paymentData[method].count++;
    });
    renderBreakdown('paymentStats', paymentData, currency);

    // Day of week breakdown
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayData = {};
    dayNames.forEach(day => dayData[day] = { total: 0, count: 0 });
    allSpending.forEach(t => {
      if (t.date) {
        const day = dayNames[t.date.getDay()];
        dayData[day].total += t.total;
        dayData[day].count++;
      }
    });
    renderBreakdown('dayOfWeekStats', dayData, currency, false, 7, false);

    // Month of year breakdown
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const monthOfYearData = {};
    monthNames.forEach(m => monthOfYearData[m] = { total: 0, count: 0 });
    allSpending.forEach(t => {
      if (t.date) {
        const month = monthNames[t.date.getMonth()];
        monthOfYearData[month].total += t.total;
        monthOfYearData[month].count++;
      }
    });
    renderBreakdown('monthOfYearStats', monthOfYearData, currency, false, 12, false);

    // Gift recipients breakdown
    const recipientData = {};
    giftPurchases.filter(t => t.giftRecipient).forEach(t => {
      const recipient = t.giftRecipient;
      if (!recipientData[recipient]) recipientData[recipient] = { total: 0, count: 0 };
      recipientData[recipient].total += t.total;
      recipientData[recipient].count++;
    });
    renderBreakdown('giftRecipientStats', recipientData, currency);

    // Top 10 purchases
    const topPurchasesEl = document.getElementById('topPurchases');
    const sortedPurchases = [...allSpending]
      .filter(t => !t.isMarketTransaction)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    topPurchasesEl.innerHTML = sortedPurchases.map((t, i) => `
      <div class="breakdown-item">
        <span class="breakdown-label">${i + 1}. ${t.gameName || 'Unknown'}${t.itemName ? ' - ' + t.itemName : ''}</span>
        <span class="breakdown-value">${formatCurrency(t.total, currency)}</span>
        <span class="breakdown-date">${formatDate(t.date)}</span>
      </div>
    `).join('');

    // Fun facts
    generateFunFacts(transactions, allSpending, currency, {
      totalSpent, totalMarketEarned, totalMarketSpent, largestPurchase,
      giftPurchases, accountAgeDays, avgDaysBetween, yearlyData, gameData
    });

    // Setup collapsible sections
    setupCollapsibles();

    // Setup export buttons
    setupExport(transactions, {
      totalSpent, totalRefunded, totalWalletFunded, totalMarketSpent, totalMarketEarned,
      avgPurchase, medianPurchase, largestPurchase, smallestPurchase, avgPerMonth, avgPerYear,
      yearlyData, monthlyData, gameData, typeData, paymentData
    });
  }

  function generateFunFacts(transactions, allSpending, currency, stats) {
    const funFactsEl = document.getElementById('funFacts');
    const facts = [];

    // Most expensive game
    const topGame = Object.entries(stats.gameData).sort((a, b) => b[1].total - a[1].total)[0];
    if (topGame) {
      facts.push(`Your biggest money pit is <strong>${topGame[0]}</strong> with ${formatCurrency(topGame[1].total, currency)} spent`);
    }

    // Best year for Valve
    const topYear = Object.entries(stats.yearlyData).sort((a, b) => b[1].total - a[1].total)[0];
    if (topYear) {
      facts.push(`Your biggest spending year was <strong>${topYear[0]}</strong> with ${formatCurrency(topYear[1].total, currency)}`);
    }

    // Market profit/loss
    const marketNet = stats.totalMarketEarned - stats.totalMarketSpent;
    if (marketNet > 0) {
      facts.push(`You made a <strong>profit</strong> of ${formatCurrency(marketNet, currency)} on the Steam Market!`);
    } else if (marketNet < 0) {
      facts.push(`You spent ${formatCurrency(Math.abs(marketNet), currency)} more on the Market than you earned`);
    }

    // Total games approximation
    const uniqueGames = Object.keys(stats.gameData).length;
    facts.push(`You've spent money on approximately <strong>${uniqueGames}</strong> different games/items`);

    // Spending per day of account
    if (stats.accountAgeDays > 0) {
      const perDay = stats.totalSpent / stats.accountAgeDays;
      facts.push(`That's an average of ${formatCurrency(perDay, currency)} <strong>per day</strong> since your first purchase`);
    }

    // Gift generosity
    if (stats.giftPurchases.length > 0) {
      const giftTotal = stats.giftPurchases.reduce((sum, t) => sum + t.total, 0);
      facts.push(`You've gifted ${formatCurrency(giftTotal, currency)} worth of games to <strong>${stats.giftPurchases.length}</strong> friends`);
    }

    // Largest single purchase
    if (stats.largestPurchase > 0) {
      const largestTx = allSpending.find(t => t.total === stats.largestPurchase);
      if (largestTx) {
        facts.push(`Your biggest single purchase was <strong>${largestTx.gameName || 'Unknown'}</strong> for ${formatCurrency(stats.largestPurchase, currency)}`);
      }
    }

    // Could have bought...
    const steamDecks = Math.floor(stats.totalSpent / 419);
    if (steamDecks >= 1) {
      facts.push(`With ${formatCurrency(stats.totalSpent, currency)}, you could have bought <strong>${steamDecks}</strong> Steam Deck${steamDecks > 1 ? 's' : ''}`);
    }

    funFactsEl.innerHTML = facts.map(fact => `<div class="fun-fact">${fact}</div>`).join('');
  }

  function renderBreakdown(elementId, data, currency, sortByKey = false, limit = null, sortDesc = true) {
    const el = document.getElementById(elementId);
    let entries = Object.entries(data);

    if (sortByKey) {
      entries.sort((a, b) => sortDesc ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
    } else {
      entries.sort((a, b) => sortDesc ? b[1].total - a[1].total : a[1].total - b[1].total);
    }

    if (limit) {
      entries = entries.slice(0, limit);
    }

    const maxTotal = Math.max(...entries.map(e => e[1].total), 1);

    el.innerHTML = entries.map(([key, value]) => {
      const percentage = maxTotal > 0 ? (value.total / maxTotal) * 100 : 0;
      return `
        <div class="breakdown-item">
          <div class="breakdown-bar" style="width: ${percentage}%"></div>
          <span class="breakdown-label">${key}</span>
          <span class="breakdown-value">${formatCurrency(value.total, currency)}</span>
          <span class="breakdown-count">(${value.count})</span>
        </div>
      `;
    }).join('');
  }

  function setupCollapsibles() {
    document.querySelectorAll('.collapse-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const content = toggle.nextElementSibling;
        const icon = toggle.querySelector('.toggle-icon');
        content.classList.toggle('collapsed');
        icon.textContent = content.classList.contains('collapsed') ? '▼' : '▲';
      });
    });
  }

  function setupExport(transactions, stats) {
    document.getElementById('exportBtn').addEventListener('click', () => {
      const data = {
        exportDate: new Date().toISOString(),
        summary: stats,
        transactions: transactions
      };
      downloadFile(JSON.stringify(data, null, 2), 'steam-spending-data.json', 'application/json');
    });

    document.getElementById('exportCsvBtn').addEventListener('click', () => {
      const headers = ['Date', 'Game', 'Item', 'Type', 'Payment Method', 'Total', 'Wallet Change', 'Wallet Balance', 'Is Refund', 'Is Gift', 'Is Market'];
      const rows = transactions.map(t => [
        t.dateStr,
        t.gameName,
        t.itemName,
        t.transactionType,
        t.paymentMethod,
        t.total,
        t.walletChange,
        t.walletBalance,
        t.isRefund,
        t.isGiftPurchase || t.isGift,
        t.isMarketTransaction
      ]);

      const csv = [headers, ...rows].map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ).join('\n');

      downloadFile(csv, 'steam-spending-data.csv', 'text/csv');
    });
  }

  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
});
