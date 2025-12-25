// Steam Spending Insights - Content Script
// In-page dashboard with filters, charts, and detailed statistics

(function() {
  'use strict';

  // Prevent double initialization
  if (window.ssiInitialized) return;
  window.ssiInitialized = true;

  // State
  let allTransactions = [];
  let filteredTransactions = [];
  let filterState = {
    dateFrom: null,
    dateTo: null,
    types: [],
    priceMin: null,
    priceMax: null,
    gameSearch: ''
  };

  // ============================================
  // PARSING FUNCTIONS
  // ============================================

  function parsePrice(priceStr) {
    if (!priceStr) return 0;
    let cleaned = priceStr.trim()
      .replace(/[^\d,.\-+]/g, '')
      .replace(',--', ',00')
      .replace(/\.(?=\d{3})/g, '')
      .replace(',', '.');
    return parseFloat(cleaned) || 0;
  }

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const cleaned = dateStr.trim();

    const germanMonths = {
      'Jan': 0, 'Feb': 1, 'Mär': 2, 'Mar': 2, 'Apr': 3, 'Mai': 4, 'May': 4,
      'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Okt': 9, 'Oct': 9, 'Nov': 10, 'Dez': 11, 'Dec': 11
    };

    const germanMatch = cleaned.match(/(\d{1,2})\.\s*(\w{3})\.?\s*(\d{4})/);
    if (germanMatch) {
      const day = parseInt(germanMatch[1]);
      const month = germanMonths[germanMatch[2]] ?? 0;
      const year = parseInt(germanMatch[3]);
      return new Date(year, month, day);
    }

    const englishMatch = cleaned.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
    if (englishMatch) {
      const month = germanMonths[englishMatch[1]] ?? 0;
      const day = parseInt(englishMatch[2]);
      const year = parseInt(englishMatch[3]);
      return new Date(year, month, day);
    }

    const parsed = new Date(cleaned);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function extractCurrency(priceStr) {
    if (!priceStr) return 'Unknown';
    const match = priceStr.match(/[$€£¥₹₽]/);
    if (match) return match[0];
    if (priceStr.includes('USD')) return '$';
    if (priceStr.includes('EUR')) return '€';
    if (priceStr.includes('GBP')) return '£';
    return '€';
  }

  function getTextContent(element) {
    if (!element) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('img, a').forEach(el => el.remove());
    return clone.textContent.trim().replace(/\s+/g, ' ');
  }

  function parseTransactionRows() {
    const rows = document.querySelectorAll('.wallet_table_row');
    const transactions = [];

    rows.forEach((row, index) => {
      try {
        const dateEl = row.querySelector('.wht_date');
        const itemsEl = row.querySelector('.wht_items');
        const typeEl = row.querySelector('.wht_type');
        const totalEl = row.querySelector('.wht_total');
        const walletChangeEl = row.querySelector('.wht_wallet_change');
        const walletBalanceEl = row.querySelector('.wht_wallet_balance');

        let gameName = '';
        let itemName = '';
        let isGift = false;
        let giftRecipient = '';
        let isMarketTransaction = false;
        let marketTransactionCount = 1;

        if (itemsEl) {
          const itemText = getTextContent(itemsEl);

          if (itemText.includes('Geschenk gesendet') || itemText.includes('Gift sent')) {
            isGift = true;
            const recipientLink = itemsEl.querySelector('a');
            if (recipientLink) {
              giftRecipient = recipientLink.textContent.trim();
            }
          }

          if (itemText.includes('Steam-Communitymarkt') || itemText.includes('Community Market')) {
            isMarketTransaction = true;
          }

          const itemDivs = itemsEl.querySelectorAll('div');
          itemDivs.forEach(div => {
            const text = div.textContent.trim();
            if (div.classList.contains('wth_payment')) {
              itemName = text;
            } else if (!div.classList.contains('help_purchase_img') && text && !text.includes('Geschenk')) {
              if (!gameName) gameName = text;
            }
          });

          if (!gameName && !isMarketTransaction && !isGift) {
            gameName = itemText;
          }
        }

        let transactionType = '';
        let paymentMethod = '';

        if (typeEl) {
          const typeDivs = typeEl.querySelectorAll('div');
          typeDivs.forEach(div => {
            const text = div.textContent.trim();
            if (div.classList.contains('wth_payment')) {
              paymentMethod = text;
            } else if (text) {
              transactionType = text;
              const marketMatch = text.match(/(\d+)\s*Markttransaktion/i);
              if (marketMatch) {
                isMarketTransaction = true;
                marketTransactionCount = parseInt(marketMatch[1]) || 1;
              } else if (text.includes('Markttransaktion')) {
                isMarketTransaction = true;
                marketTransactionCount = 1;
              }
            }
          });
        }

        const dateStr = dateEl ? dateEl.textContent.trim() : '';

        let totalStr = '';
        if (totalEl) {
          const nestedDiv = totalEl.querySelector('div');
          totalStr = nestedDiv ? nestedDiv.textContent.trim() : totalEl.textContent.trim();
        }

        const walletChangeStr = walletChangeEl ? walletChangeEl.textContent.trim() : '';
        const walletBalanceStr = walletBalanceEl ? walletBalanceEl.textContent.trim() : '';

        const walletChange = parsePrice(walletChangeStr);
        const isPositiveChange = walletChangeStr.includes('+') || walletChange > 0;

        const itemText = itemsEl ? getTextContent(itemsEl) : '';
        const isWalletFunding = (itemText.includes('Steam-Guthaben gekauft') ||
                                 itemText.includes('Wallet Credit') ||
                                 itemText.includes('Funds')) && isPositiveChange;

        const isRefund = isPositiveChange && !isWalletFunding && !isMarketTransaction;
        const isMarketSale = isMarketTransaction && isPositiveChange;
        const isMarketPurchase = isMarketTransaction && !isPositiveChange;

        const isInGame = transactionType.includes('im Spiel') || transactionType.includes('In-Game');
        const isGiftPurchase = transactionType.includes('Geschenkeinkauf') || transactionType.includes('Gift purchase');

        const transaction = {
          id: index,
          rowElement: row,
          date: parseDate(dateStr),
          dateStr: dateStr,
          gameName: gameName.replace(/\s+/g, ' ').trim(),
          itemName: itemName.replace(/\s+/g, ' ').trim(),
          transactionType: transactionType,
          paymentMethod: paymentMethod,
          total: parsePrice(totalStr),
          totalStr: totalStr,
          walletChange: walletChange,
          walletChangeStr: walletChangeStr,
          walletBalance: parsePrice(walletBalanceStr),
          currency: extractCurrency(totalStr || walletChangeStr),
          isRefund: isRefund,
          isWalletFunding: isWalletFunding,
          isGift: isGift,
          giftRecipient: giftRecipient,
          isMarketTransaction: isMarketTransaction,
          isMarketSale: isMarketSale,
          isMarketPurchase: isMarketPurchase,
          isInGame: isInGame,
          isGiftPurchase: isGiftPurchase,
          marketTransactionCount: marketTransactionCount
        };

        transactions.push(transaction);
      } catch (e) {
        console.error('Error parsing row:', e);
      }
    });

    return transactions;
  }

  // ============================================
  // FILTER FUNCTIONS
  // ============================================

  function applyFilters(transactions) {
    return transactions.filter(t => {
      // Date filter
      if (filterState.dateFrom && t.date && t.date < filterState.dateFrom) return false;
      if (filterState.dateTo && t.date && t.date > filterState.dateTo) return false;

      // Type filter
      if (filterState.types.length > 0) {
        let matches = false;
        if (filterState.types.includes('purchases') && !t.isRefund && !t.isMarketTransaction && !t.isWalletFunding && !t.isInGame && !t.isGiftPurchase && t.total > 0) matches = true;
        if (filterState.types.includes('refunds') && t.isRefund) matches = true;
        if (filterState.types.includes('market') && t.isMarketTransaction) matches = true;
        if (filterState.types.includes('gifts') && (t.isGift || t.isGiftPurchase)) matches = true;
        if (filterState.types.includes('ingame') && t.isInGame) matches = true;
        if (filterState.types.includes('wallet') && t.isWalletFunding) matches = true;
        if (!matches) return false;
      }

      // Price filter
      const amount = t.total || Math.abs(t.walletChange);
      if (filterState.priceMin !== null && amount < filterState.priceMin) return false;
      if (filterState.priceMax !== null && amount > filterState.priceMax) return false;

      // Game search filter
      if (filterState.gameSearch) {
        const search = filterState.gameSearch.toLowerCase();
        const gameName = (t.gameName || '').toLowerCase();
        const itemName = (t.itemName || '').toLowerCase();
        if (!gameName.includes(search) && !itemName.includes(search)) return false;
      }

      return true;
    });
  }

  function highlightTransactionRows() {
    const filteredIds = new Set(filteredTransactions.map(t => t.id));
    allTransactions.forEach(t => {
      if (t.rowElement) {
        t.rowElement.classList.remove('ssi-highlight', 'ssi-dimmed');
        if (filterState.types.length > 0 || filterState.dateFrom || filterState.dateTo || filterState.priceMin || filterState.priceMax || filterState.gameSearch) {
          if (filteredIds.has(t.id)) {
            t.rowElement.classList.add('ssi-highlight');
          } else {
            t.rowElement.classList.add('ssi-dimmed');
          }
        }
      }
    });
  }

  function updateFiltersAndRefresh() {
    filteredTransactions = applyFilters(allTransactions);
    highlightTransactionRows();
    updateStats(filteredTransactions);
    updateCharts(filteredTransactions);
    updateBreakdowns(filteredTransactions);
  }

  // ============================================
  // STATS FUNCTIONS
  // ============================================

  function formatCurrency(amount, currency = '€') {
    return `${amount.toFixed(2)}${currency}`;
  }

  function formatDate(date) {
    if (!date) return '-';
    return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function calculateStats(transactions) {
    const currency = transactions[0]?.currency || '€';

    const walletFundings = transactions.filter(t => t.isWalletFunding);
    const refunds = transactions.filter(t => t.isRefund);
    const marketSales = transactions.filter(t => t.isMarketSale);
    const marketPurchases = transactions.filter(t => t.isMarketPurchase);
    const giftPurchases = transactions.filter(t => t.isGiftPurchase || t.isGift);
    const inGamePurchases = transactions.filter(t => t.isInGame);
    const gamePurchases = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketTransaction && !t.isGiftPurchase &&
      !t.isInGame && t.total > 0
    );

    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && t.total > 0
    );

    const totalWalletFunded = walletFundings.reduce((sum, t) => sum + t.total, 0);
    const totalRefunded = refunds.reduce((sum, t) => sum + Math.abs(t.walletChange), 0);
    const totalMarketSpent = marketPurchases.reduce((sum, t) => sum + t.total, 0);
    const totalMarketEarned = marketSales.reduce((sum, t) => sum + Math.abs(t.walletChange), 0);
    const totalGiftValue = giftPurchases.reduce((sum, t) => sum + t.total, 0);
    const totalInGame = inGamePurchases.reduce((sum, t) => sum + t.total, 0);
    const totalGamePurchases = gamePurchases.reduce((sum, t) => sum + t.total, 0);
    const totalSpent = allSpending.reduce((sum, t) => sum + t.total, 0);

    const purchaseAmounts = allSpending
      .filter(t => !t.isMarketTransaction)
      .map(t => t.total)
      .filter(a => a > 0);

    const avgPurchase = purchaseAmounts.length > 0
      ? purchaseAmounts.reduce((a, b) => a + b, 0) / purchaseAmounts.length
      : 0;

    const sortedAmounts = [...purchaseAmounts].sort((a, b) => a - b);
    const medianPurchase = sortedAmounts.length > 0
      ? sortedAmounts.length % 2 === 0
        ? (sortedAmounts[sortedAmounts.length / 2 - 1] + sortedAmounts[sortedAmounts.length / 2]) / 2
        : sortedAmounts[Math.floor(sortedAmounts.length / 2)]
      : 0;

    const largestPurchase = Math.max(...purchaseAmounts, 0);
    const smallestPurchase = purchaseAmounts.length > 0 ? Math.min(...purchaseAmounts) : 0;

    const datesWithData = transactions.filter(t => t.date).map(t => t.date);
    const sortedDates = [...datesWithData].sort((a, b) => a - b);
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    let monthsSpan = 1;
    let yearsSpan = 1;
    let accountAgeDays = 0;
    let weeksSpan = 1;
    if (firstDate && lastDate) {
      monthsSpan = Math.max(1,
        (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
        (lastDate.getMonth() - firstDate.getMonth()) + 1
      );
      yearsSpan = Math.max(1, lastDate.getFullYear() - firstDate.getFullYear() + 1);
      accountAgeDays = Math.floor((lastDate - firstDate) / (1000 * 60 * 60 * 24));
      weeksSpan = Math.max(1, Math.ceil(accountAgeDays / 7));
    }

    const avgPerMonth = totalSpent / monthsSpan;
    const avgPerYear = totalSpent / yearsSpan;
    const avgPerWeek = totalSpent / weeksSpan;
    const avgPerDay = accountAgeDays > 0 ? totalSpent / accountAgeDays : totalSpent;

    const years = Math.floor(accountAgeDays / 365);
    const months = Math.floor((accountAgeDays % 365) / 30);
    const accountAgeStr = years > 0 ? `${years}y ${months}m` : `${months} months`;

    // Net spending (actual money spent)
    const netSpent = totalSpent - totalRefunded - totalMarketEarned;

    // Market stats
    const marketNet = totalMarketEarned - totalMarketSpent;
    const totalMarketTransactions = marketSales.length + marketPurchases.length;

    // Find most expensive month
    const monthlySpending = {};
    allSpending.forEach(t => {
      if (t.date) {
        const key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlySpending[key]) monthlySpending[key] = 0;
        monthlySpending[key] += t.total;
      }
    });
    const monthEntries = Object.entries(monthlySpending).sort((a, b) => b[1] - a[1]);
    const peakMonth = monthEntries[0] ? monthEntries[0][0] : null;
    const peakMonthAmount = monthEntries[0] ? monthEntries[0][1] : 0;

    // Days since last purchase
    const now = new Date();
    const daysSinceLastPurchase = lastDate ? Math.floor((now - lastDate) / (1000 * 60 * 60 * 24)) : 0;

    // Purchase frequency (avg days between purchases)
    const purchaseDates = allSpending.filter(t => t.date).map(t => t.date).sort((a, b) => a - b);
    let avgDaysBetweenPurchases = 0;
    if (purchaseDates.length > 1) {
      let totalDays = 0;
      for (let i = 1; i < purchaseDates.length; i++) {
        totalDays += Math.floor((purchaseDates[i] - purchaseDates[i - 1]) / (1000 * 60 * 60 * 24));
      }
      avgDaysBetweenPurchases = Math.round(totalDays / (purchaseDates.length - 1));
    }

    // Find largest single purchase details
    let largestPurchaseGame = '';
    let largestPurchaseDate = null;
    allSpending.filter(t => !t.isMarketTransaction).forEach(t => {
      if (t.total === largestPurchase) {
        largestPurchaseGame = t.gameName || 'Unknown';
        largestPurchaseDate = t.date;
      }
    });

    // Unique games count
    const uniqueGames = new Set(
      allSpending.filter(t => t.gameName && !t.isMarketTransaction).map(t => t.gameName)
    ).size;

    // Calculate profit metrics
    const profitMetrics = calculateProfitMetrics(
      transactions, marketSales, marketPurchases,
      totalMarketSpent, totalMarketEarned, marketNet
    );

    // Calculate comparative metrics
    const comparativeMetrics = calculateComparativeMetrics(transactions, allSpending);

    // Calculate game profit breakdown
    const gameProfitData = calculateGameProfitBreakdown(
      transactions, gamePurchases, inGamePurchases,
      marketSales, marketPurchases
    );

    return {
      currency,
      totalSpent,
      netSpent,
      totalTransactions: transactions.length,
      totalWalletFunded,
      totalRefunded,
      refundCount: refunds.length,
      totalGamePurchases,
      gamePurchaseCount: gamePurchases.length,
      totalInGame,
      inGameCount: inGamePurchases.length,
      totalMarketSpent,
      totalMarketEarned,
      marketNet,
      totalMarketTransactions,
      totalGiftValue,
      giftCount: giftPurchases.length,
      avgPurchase,
      medianPurchase,
      largestPurchase,
      largestPurchaseGame,
      largestPurchaseDate,
      smallestPurchase,
      firstDate,
      lastDate,
      avgPerMonth,
      avgPerYear,
      avgPerWeek,
      avgPerDay,
      accountAgeStr,
      accountAgeDays,
      daysSinceLastPurchase,
      avgDaysBetweenPurchases,
      peakMonth,
      peakMonthAmount,
      uniqueGames,
      allSpending,
      gamePurchases,
      giftPurchases,
      profitMetrics,
      comparativeMetrics,
      gameProfitData,
      marketSales,
      marketPurchases,
      inGamePurchases
    };
  }

  function calculateProfitMetrics(transactions, marketSales, marketPurchases, totalMarketSpent, totalMarketEarned, marketNet) {
    const totalMarketTransactions = marketSales.length + marketPurchases.length;

    // Win rate (percentage of sales vs total market transactions)
    const winRate = totalMarketTransactions > 0
      ? (marketSales.length / totalMarketTransactions) * 100
      : 0;

    // Average profit per sale
    const avgProfitPerSale = marketSales.length > 0
      ? totalMarketEarned / marketSales.length
      : 0;

    // Average cost per purchase
    const avgCostPerPurchase = marketPurchases.length > 0
      ? totalMarketSpent / marketPurchases.length
      : 0;

    // ROI percentage
    const roi = totalMarketSpent > 0
      ? (marketNet / totalMarketSpent) * 100
      : 0;

    // Breakeven ratio (how much to earn per €1 spent)
    const breakevenRatio = totalMarketEarned > 0
      ? totalMarketSpent / totalMarketEarned
      : 0;

    return {
      winRate,
      avgProfitPerSale,
      avgCostPerPurchase,
      roi,
      breakevenRatio
    };
  }

  function calculateComparativeMetrics(transactions, allSpending) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth();

    // Current month spending
    const currentMonthTransactions = allSpending.filter(t =>
      t.date && t.date.getFullYear() === currentYear && t.date.getMonth() === currentMonthNum
    );
    const currentMonth = currentMonthTransactions.reduce((sum, t) => sum + t.total, 0);

    // Previous month spending
    const prevMonthNum = currentMonthNum === 0 ? 11 : currentMonthNum - 1;
    const prevYear = currentMonthNum === 0 ? currentYear - 1 : currentYear;
    const prevMonthTransactions = allSpending.filter(t =>
      t.date && t.date.getFullYear() === prevYear && t.date.getMonth() === prevMonthNum
    );
    const previousMonth = prevMonthTransactions.reduce((sum, t) => sum + t.total, 0);

    // MoM change
    const momChange = previousMonth > 0
      ? ((currentMonth - previousMonth) / previousMonth) * 100
      : 0;

    // 30-day moving average
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const last30DaysTransactions = allSpending.filter(t => t.date && t.date >= thirtyDaysAgo);
    const thirtyDayTotal = last30DaysTransactions.reduce((sum, t) => sum + t.total, 0);
    const thirtyDayAvg = thirtyDayTotal / 30;

    // YoY growth (same month last year vs this year)
    const lastYearSameMonth = allSpending.filter(t =>
      t.date && t.date.getFullYear() === currentYear - 1 && t.date.getMonth() === currentMonthNum
    );
    const lastYearSameMonthTotal = lastYearSameMonth.reduce((sum, t) => sum + t.total, 0);
    const yoyGrowth = lastYearSameMonthTotal > 0
      ? ((currentMonth - lastYearSameMonthTotal) / lastYearSameMonthTotal) * 100
      : 0;

    // Projected annual (based on year-to-date average)
    const yearToDateTransactions = allSpending.filter(t =>
      t.date && t.date.getFullYear() === currentYear
    );
    const yearToDateTotal = yearToDateTransactions.reduce((sum, t) => sum + t.total, 0);
    const monthsElapsed = currentMonthNum + 1;
    const avgPerMonth = monthsElapsed > 0 ? yearToDateTotal / monthsElapsed : 0;
    const projectedAnnual = avgPerMonth * 12;

    return {
      currentMonth,
      previousMonth,
      momChange,
      thirtyDayAvg,
      yoyGrowth,
      projectedAnnual
    };
  }

  function calculateGameProfitBreakdown(transactions, gamePurchases, inGamePurchases, marketSales, marketPurchases) {
    const gameProfit = new Map();

    // Track game purchases
    gamePurchases.forEach(t => {
      const gameName = t.gameName || 'Unknown';
      if (!gameProfit.has(gameName)) {
        gameProfit.set(gameName, {
          gameName,
          totalSpent: 0,
          marketEarned: 0,
          marketSpent: 0,
          netProfit: 0,
          roi: 0,
          transactionCount: 0
        });
      }
      const game = gameProfit.get(gameName);
      game.totalSpent += t.total;
      game.transactionCount++;
    });

    // Track in-game purchases
    inGamePurchases.forEach(t => {
      const gameName = t.gameName || 'Unknown';
      if (!gameProfit.has(gameName)) {
        gameProfit.set(gameName, {
          gameName,
          totalSpent: 0,
          marketEarned: 0,
          marketSpent: 0,
          netProfit: 0,
          roi: 0,
          transactionCount: 0
        });
      }
      const game = gameProfit.get(gameName);
      game.totalSpent += t.total;
      game.transactionCount++;
    });

    // Track market sales (earned from selling items)
    marketSales.forEach(t => {
      const gameName = t.gameName || 'Market Items';
      if (!gameProfit.has(gameName)) {
        gameProfit.set(gameName, {
          gameName,
          totalSpent: 0,
          marketEarned: 0,
          marketSpent: 0,
          netProfit: 0,
          roi: 0,
          transactionCount: 0
        });
      }
      const game = gameProfit.get(gameName);
      game.marketEarned += Math.abs(t.walletChange);
      game.transactionCount++;
    });

    // Track market purchases
    marketPurchases.forEach(t => {
      const gameName = t.gameName || 'Market Items';
      if (!gameProfit.has(gameName)) {
        gameProfit.set(gameName, {
          gameName,
          totalSpent: 0,
          marketEarned: 0,
          marketSpent: 0,
          netProfit: 0,
          roi: 0,
          transactionCount: 0
        });
      }
      const game = gameProfit.get(gameName);
      game.marketSpent += t.total;
      game.transactionCount++;
    });

    // Calculate net profit and ROI for each game
    gameProfit.forEach((game, gameName) => {
      game.netProfit = game.marketEarned - (game.totalSpent + game.marketSpent);
      game.roi = game.totalSpent > 0
        ? (game.netProfit / game.totalSpent) * 100
        : 0;
    });

    // Convert to array and sort by ROI descending
    return Array.from(gameProfit.values())
      .sort((a, b) => b.roi - a.roi);
  }

  function buildTimeSeriesData(transactions, allSpending, marketSales, marketPurchases) {
    const monthlyData = {};
    const yearlyData = {};

    // Build spending data
    allSpending.forEach(t => {
      if (t.date) {
        const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        const yearKey = t.date.getFullYear().toString();

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { spent: 0, earned: 0, profit: 0 };
        }
        if (!yearlyData[yearKey]) {
          yearlyData[yearKey] = { spent: 0, earned: 0, profit: 0 };
        }

        monthlyData[monthKey].spent += t.total;
        yearlyData[yearKey].spent += t.total;
      }
    });

    // Build earnings data
    marketSales.forEach(t => {
      if (t.date) {
        const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        const yearKey = t.date.getFullYear().toString();

        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { spent: 0, earned: 0, profit: 0 };
        }
        if (!yearlyData[yearKey]) {
          yearlyData[yearKey] = { spent: 0, earned: 0, profit: 0 };
        }

        const earned = Math.abs(t.walletChange);
        monthlyData[monthKey].earned += earned;
        yearlyData[yearKey].earned += earned;
      }
    });

    // Calculate profit
    Object.keys(monthlyData).forEach(key => {
      monthlyData[key].profit = monthlyData[key].earned - monthlyData[key].spent;
    });
    Object.keys(yearlyData).forEach(key => {
      yearlyData[key].profit = yearlyData[key].earned - yearlyData[key].spent;
    });

    return { monthly: monthlyData, yearly: yearlyData };
  }

  function formatPeakMonth(monthStr) {
    if (!monthStr) return '-';
    const [year, month] = monthStr.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} ${year}`;
  }

  function updateStats(transactions) {
    const stats = calculateStats(transactions);
    const c = stats.currency;

    // Primary stats
    document.getElementById('ssi-totalSpent').textContent = formatCurrency(stats.totalSpent, c);
    document.getElementById('ssi-netSpent').textContent = formatCurrency(stats.netSpent, c);
    document.getElementById('ssi-totalTransactions').textContent = stats.totalTransactions;

    // Spending breakdown
    document.getElementById('ssi-gamePurchases').textContent = formatCurrency(stats.totalGamePurchases, c);
    document.getElementById('ssi-gamePurchaseCount').textContent = stats.gamePurchaseCount;
    document.getElementById('ssi-inGamePurchases').textContent = formatCurrency(stats.totalInGame, c);
    document.getElementById('ssi-inGameCount').textContent = stats.inGameCount;
    document.getElementById('ssi-giftValue').textContent = formatCurrency(stats.totalGiftValue, c);
    document.getElementById('ssi-giftCount').textContent = stats.giftCount;

    // Wallet & Refunds
    document.getElementById('ssi-walletFunded').textContent = formatCurrency(stats.totalWalletFunded, c);
    document.getElementById('ssi-totalRefunds').textContent = formatCurrency(stats.totalRefunded, c);
    document.getElementById('ssi-refundCount').textContent = stats.refundCount;

    // Market stats
    document.getElementById('ssi-marketSpent').textContent = formatCurrency(stats.totalMarketSpent, c);
    document.getElementById('ssi-marketEarned').textContent = formatCurrency(stats.totalMarketEarned, c);
    const marketNetEl = document.getElementById('ssi-marketNet');
    marketNetEl.textContent = (stats.marketNet >= 0 ? '+' : '') + formatCurrency(stats.marketNet, c);
    marketNetEl.className = 'ssi-stat-value' + (stats.marketNet >= 0 ? ' positive' : ' negative');
    document.getElementById('ssi-marketTransactions').textContent = stats.totalMarketTransactions;

    // Purchase analytics
    document.getElementById('ssi-avgPurchase').textContent = formatCurrency(stats.avgPurchase, c);
    document.getElementById('ssi-medianPurchase').textContent = formatCurrency(stats.medianPurchase, c);
    document.getElementById('ssi-largestPurchase').textContent = formatCurrency(stats.largestPurchase, c);
    document.getElementById('ssi-largestPurchaseGame').textContent = stats.largestPurchaseGame || '-';
    document.getElementById('ssi-smallestPurchase').textContent = formatCurrency(stats.smallestPurchase, c);
    document.getElementById('ssi-uniqueGames').textContent = stats.uniqueGames;

    // Time-based stats
    document.getElementById('ssi-avgPerDay').textContent = formatCurrency(stats.avgPerDay, c);
    document.getElementById('ssi-avgPerWeek').textContent = formatCurrency(stats.avgPerWeek, c);
    document.getElementById('ssi-avgPerMonth').textContent = formatCurrency(stats.avgPerMonth, c);
    document.getElementById('ssi-avgPerYear').textContent = formatCurrency(stats.avgPerYear, c);
    document.getElementById('ssi-peakMonth').textContent = formatPeakMonth(stats.peakMonth);
    document.getElementById('ssi-peakMonthAmount').textContent = formatCurrency(stats.peakMonthAmount, c);

    // Activity stats
    document.getElementById('ssi-firstPurchase').textContent = formatDate(stats.firstDate);
    document.getElementById('ssi-latestPurchase').textContent = formatDate(stats.lastDate);
    document.getElementById('ssi-accountAge').textContent = stats.accountAgeStr;
    document.getElementById('ssi-daysSinceLastPurchase').textContent = stats.daysSinceLastPurchase + ' days';
    document.getElementById('ssi-purchaseFrequency').textContent = stats.avgDaysBetweenPurchases > 0
      ? `Every ${stats.avgDaysBetweenPurchases} days`
      : '-';

    // Profit analytics metrics
    if (stats.profitMetrics) {
      const pm = stats.profitMetrics;
      const roiEl = document.getElementById('ssi-marketROI');
      if (roiEl) {
        roiEl.textContent = pm.roi.toFixed(2) + '%';
        roiEl.className = 'ssi-stat-value' + (pm.roi >= 0 ? ' positive' : ' negative');
      }

      const winRateEl = document.getElementById('ssi-winRate');
      if (winRateEl) winRateEl.textContent = pm.winRate.toFixed(1) + '%';

      const avgProfitEl = document.getElementById('ssi-avgProfitPerSale');
      if (avgProfitEl) avgProfitEl.textContent = formatCurrency(pm.avgProfitPerSale, c);

      const avgCostEl = document.getElementById('ssi-avgCostPerPurchase');
      if (avgCostEl) avgCostEl.textContent = formatCurrency(pm.avgCostPerPurchase, c);

      const breakevenEl = document.getElementById('ssi-breakevenRatio');
      if (breakevenEl) breakevenEl.textContent = pm.breakevenRatio.toFixed(2) + 'x';
    }

    // Comparative metrics
    if (stats.comparativeMetrics) {
      const cm = stats.comparativeMetrics;
      const currentMonthEl = document.getElementById('ssi-currentMonthSpending');
      if (currentMonthEl) currentMonthEl.textContent = formatCurrency(cm.currentMonth, c);

      const momChangeEl = document.getElementById('ssi-momChange');
      if (momChangeEl) {
        const arrow = cm.momChange > 0 ? '↑' : cm.momChange < 0 ? '↓' : '→';
        const sign = cm.momChange > 0 ? '+' : '';
        momChangeEl.textContent = `${arrow} ${sign}${cm.momChange.toFixed(1)}% vs last month`;
        momChangeEl.className = 'ssi-stat-subtitle' + (cm.momChange > 0 ? ' negative' : ' positive');
      }

      const thirtyDayEl = document.getElementById('ssi-thirtyDayAvg');
      if (thirtyDayEl) thirtyDayEl.textContent = formatCurrency(cm.thirtyDayAvg, c);

      const yoyEl = document.getElementById('ssi-yoyGrowth');
      if (yoyEl) {
        const sign = cm.yoyGrowth > 0 ? '+' : '';
        yoyEl.textContent = `${sign}${cm.yoyGrowth.toFixed(1)}%`;
        yoyEl.className = 'ssi-stat-value' + (cm.yoyGrowth > 0 ? ' negative' : ' positive');
      }

      const projectedEl = document.getElementById('ssi-projectedAnnual');
      if (projectedEl) projectedEl.textContent = formatCurrency(cm.projectedAnnual, c);
    }
  }

  // ============================================
  // CHART FUNCTIONS
  // ============================================

  function getSpendingOverTimeData(transactions, groupBy = 'month') {
    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && t.total > 0
    );

    // Get date range from all transactions (not just spending)
    const datesWithData = transactions.filter(t => t.date).map(t => t.date);
    if (datesWithData.length === 0) {
      return { labels: [], values: [] };
    }

    const sortedDates = [...datesWithData].sort((a, b) => a - b);
    const firstDate = sortedDates[0];
    const lastDate = sortedDates[sortedDates.length - 1];

    // Build spending data
    const data = {};
    allSpending.forEach(t => {
      if (t.date) {
        let key;
        if (groupBy === 'year') {
          key = t.date.getFullYear().toString();
        } else {
          key = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
        }
        if (!data[key]) data[key] = 0;
        data[key] += t.total;
      }
    });

    // Generate all time periods between first and last date
    const allPeriods = [];
    if (groupBy === 'year') {
      for (let year = firstDate.getFullYear(); year <= lastDate.getFullYear(); year++) {
        allPeriods.push(year.toString());
      }
    } else {
      // Generate all months
      const current = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      const end = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
      while (current <= end) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        allPeriods.push(key);
        current.setMonth(current.getMonth() + 1);
      }
    }

    return {
      labels: allPeriods,
      values: allPeriods.map(k => data[k] || 0)
    };
  }

  function getCategoryData(transactions) {
    const stats = calculateStats(transactions);
    return {
      labels: ['Games', 'In-Game', 'Market', 'Gifts'],
      values: [
        stats.totalGamePurchases,
        stats.totalInGame,
        stats.totalMarketSpent,
        stats.totalGiftValue
      ]
    };
  }

  function getTopGamesData(transactions, limit = 10) {
    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && !t.isMarketTransaction && t.total > 0 && t.gameName
    );

    const gameData = {};
    allSpending.forEach(t => {
      const game = t.gameName || 'Unknown';
      if (!gameData[game]) gameData[game] = 0;
      gameData[game] += t.total;
    });

    const sorted = Object.entries(gameData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    return {
      labels: sorted.map(([name]) => name.length > 30 ? name.substring(0, 27) + '...' : name),
      values: sorted.map(([, value]) => value)
    };
  }

  function getHeatmapData(transactions) {
    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && t.total > 0
    );

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Create 7x12 grid (days x months)
    const grid = Array(7).fill(null).map(() => Array(12).fill(0));

    allSpending.forEach(t => {
      if (t.date) {
        const day = t.date.getDay();
        const month = t.date.getMonth();
        grid[day][month] += t.total;
      }
    });

    return { grid, dayNames, monthNames };
  }

  let chartsInitialized = { spending: false, category: false, games: false };

  function updateCharts(transactions) {
    console.log('Steam Spending Insights: Updating charts');
    updateSpendingChart(transactions);
    updateCategoryChart(transactions);
    updateTopGamesChart(transactions);
    updateHeatmap(transactions);
  }

  let spendingChartMode = 'month';

  function formatChartLabel(label, mode) {
    if (mode === 'year') return label;
    // Format "2023-01" to "Jan '23"
    const [year, month] = label.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(month) - 1]} '${year.slice(2)}`;
  }

  function updateSpendingChart(transactions, forceRedraw = false) {
    const data = getSpendingOverTimeData(transactions, spendingChartMode);
    const formattedLabels = data.labels.map(l => formatChartLabel(l, spendingChartMode));

    if (chartsInitialized.spending && !forceRedraw) {
      updateChartInPage('ssi-spending-chart', formattedLabels, data.values);
    } else {
      chartsInitialized.spending = false;
      renderChartInPage('ssi-spending-chart', 'line', {
        data: {
          labels: formattedLabels,
          datasets: [{
            label: 'Spending',
            data: data.values,
            borderColor: '#66c0f4',
            backgroundColor: 'rgba(102, 192, 244, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: 'rgba(42, 71, 94, 0.5)' },
              ticks: { color: '#8f98a0', maxRotation: 45 }
            },
            y: {
              grid: { color: 'rgba(42, 71, 94, 0.5)' },
              ticks: { color: '#8f98a0' }
            }
          }
        }
      });
      chartsInitialized.spending = true;
    }
  }

  function updateCategoryChart(transactions) {
    const data = getCategoryData(transactions);

    if (chartsInitialized.category) {
      updateChartInPage('ssi-category-chart', data.labels, data.values);
    } else {
      renderChartInPage('ssi-category-chart', 'doughnut', {
        data: {
          labels: data.labels,
          datasets: [{
            data: data.values,
            backgroundColor: [
              '#66c0f4',
              '#4a9eda',
              '#5ba32b',
              '#dcb93a'
            ],
            borderColor: '#1b2838',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: '#c7d5e0', padding: 15 }
            }
          }
        }
      });
      chartsInitialized.category = true;
    }
  }

  function updateTopGamesChart(transactions) {
    const data = getTopGamesData(transactions);

    if (chartsInitialized.games) {
      updateChartInPage('ssi-games-chart', data.labels, data.values);
    } else {
      renderChartInPage('ssi-games-chart', 'bar', {
        data: {
          labels: data.labels,
          datasets: [{
            label: 'Spent',
            data: data.values,
            backgroundColor: 'rgba(102, 192, 244, 0.7)',
            borderColor: '#66c0f4',
            borderWidth: 1
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: 'rgba(42, 71, 94, 0.5)' },
              ticks: { color: '#8f98a0' }
            },
            y: {
              grid: { display: false },
              ticks: { color: '#c7d5e0' }
            }
          }
        }
      });
      chartsInitialized.games = true;
    }
  }

  function updateHeatmap(transactions) {
    const container = document.getElementById('ssi-heatmap');
    if (!container) return;

    const { grid, dayNames, monthNames } = getHeatmapData(transactions);
    const currency = transactions[0]?.currency || '€';

    // Find max for scaling
    const maxVal = Math.max(...grid.flat(), 1);

    let html = '<div class="ssi-heatmap-label"></div>';
    monthNames.forEach(m => {
      html += `<div class="ssi-heatmap-label">${m}</div>`;
    });

    dayNames.forEach((day, dayIdx) => {
      html += `<div class="ssi-heatmap-label">${day}</div>`;
      monthNames.forEach((_, monthIdx) => {
        const val = grid[dayIdx][monthIdx];
        const level = val === 0 ? 0 : Math.min(5, Math.ceil((val / maxVal) * 5));
        html += `<div class="ssi-heatmap-cell" data-level="${level}">
          <div class="ssi-heatmap-tooltip">${day} ${monthNames[monthIdx]}: ${formatCurrency(val, currency)}</div>
        </div>`;
      });
    });

    container.innerHTML = html;
  }

  // ============================================
  // BREAKDOWN FUNCTIONS
  // ============================================

  function updateBreakdowns(transactions) {
    const currency = transactions[0]?.currency || '€';
    const allSpending = transactions.filter(t =>
      !t.isWalletFunding && !t.isRefund && !t.isMarketSale && t.total > 0
    );

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
    renderBreakdown('ssi-yearly-breakdown', yearlyData, currency, true);

    // Transaction type breakdown
    const typeData = {};
    transactions.forEach(t => {
      const type = t.transactionType || 'Unknown';
      if (!typeData[type]) typeData[type] = { total: 0, count: 0 };
      typeData[type].total += t.total || Math.abs(t.walletChange);
      typeData[type].count++;
    });
    renderBreakdown('ssi-type-breakdown', typeData, currency);

    // Top purchases
    renderTopPurchases('ssi-top-purchases', allSpending, currency);

    // Game profit breakdown
    const stats = calculateStats(transactions);
    if (stats.gameProfitData) {
      renderGameProfitBreakdown('ssi-game-profit-breakdown', stats.gameProfitData, currency);
    }
  }

  function renderBreakdown(elementId, data, currency, sortByKey = false) {
    const el = document.getElementById(elementId);
    if (!el) return;

    let entries = Object.entries(data);
    if (sortByKey) {
      entries.sort((a, b) => b[0].localeCompare(a[0]));
    } else {
      entries.sort((a, b) => b[1].total - a[1].total);
    }

    const maxTotal = Math.max(...entries.map(e => e[1].total), 1);

    el.innerHTML = entries.slice(0, 15).map(([key, value]) => {
      const percentage = (value.total / maxTotal) * 100;
      return `
        <div class="ssi-breakdown-item">
          <div class="ssi-breakdown-bar" style="width: ${percentage}%"></div>
          <span class="ssi-breakdown-label">${key}</span>
          <span class="ssi-breakdown-value">${formatCurrency(value.total, currency)}</span>
          <span class="ssi-breakdown-count">(${value.count})</span>
        </div>
      `;
    }).join('');
  }

  function renderTopPurchases(elementId, allSpending, currency) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const sorted = [...allSpending]
      .filter(t => !t.isMarketTransaction)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    el.innerHTML = sorted.map((t, i) => `
      <div class="ssi-breakdown-item">
        <span class="ssi-breakdown-label">${i + 1}. ${t.gameName || 'Unknown'}${t.itemName ? ' - ' + t.itemName : ''}</span>
        <span class="ssi-breakdown-value">${formatCurrency(t.total, currency)}</span>
        <span class="ssi-breakdown-count">${formatDate(t.date)}</span>
      </div>
    `).join('');
  }

  function renderGameProfitBreakdown(elementId, gameProfitData, currency) {
    const container = document.getElementById(elementId);
    if (!container) return;

    if (!gameProfitData || gameProfitData.length === 0) {
      container.innerHTML = '<p class="ssi-no-data">No game profit data available</p>';
      return;
    }

    let html = `
      <table class="ssi-profit-table">
        <thead>
          <tr>
            <th>Game</th>
            <th>Spent</th>
            <th>Earned</th>
            <th>Net Profit</th>
            <th>ROI</th>
            <th>Transactions</th>
          </tr>
        </thead>
        <tbody>
    `;

    gameProfitData.slice(0, 20).forEach(game => {
      const profitClass = game.netProfit >= 0 ? 'positive' : 'negative';
      const roiClass = game.roi >= 0 ? 'positive' : 'negative';
      html += `
        <tr>
          <td class="game-name">${game.gameName}</td>
          <td>${formatCurrency(game.totalSpent, currency)}</td>
          <td>${formatCurrency(game.marketEarned, currency)}</td>
          <td class="${profitClass}">${formatCurrency(game.netProfit, currency)}</td>
          <td class="${roiClass}">${game.roi.toFixed(1)}%</td>
          <td>${game.transactionCount}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================
  // DASHBOARD UI
  // ============================================

  function createDashboardHTML() {
    return `
      <div class="ssi-header">
        <h2>
          <span>Steam Spending Insights</span>
        </h2>
        <div class="ssi-header-actions">
          <button class="ssi-btn" id="ssi-export-json">Export JSON</button>
          <button class="ssi-btn" id="ssi-export-csv">Export CSV</button>
          <button class="ssi-collapse-btn" id="ssi-collapse-toggle">▲</button>
        </div>
      </div>

      <div class="ssi-content" id="ssi-content">
        <!-- Notice -->
        <div class="ssi-notice">
          <strong>Tip:</strong> Scroll down on the Steam page to load more transactions before analyzing. The dashboard will update automatically.
        </div>

        <!-- Filters -->
        <div class="ssi-filters">
          <div class="ssi-filter-group">
            <label>Date Range</label>
            <div class="ssi-filter-row">
              <input type="date" id="ssi-date-from" placeholder="From">
              <span>to</span>
              <input type="date" id="ssi-date-to" placeholder="To">
            </div>
            <div class="ssi-date-presets">
              <button class="ssi-date-preset" data-preset="30days">30 Days</button>
              <button class="ssi-date-preset" data-preset="year">This Year</button>
              <button class="ssi-date-preset" data-preset="all">All Time</button>
            </div>
          </div>

          <div class="ssi-filter-group">
            <label>Transaction Type</label>
            <div class="ssi-type-chips">
              <button class="ssi-type-chip" data-type="purchases">Purchases</button>
              <button class="ssi-type-chip" data-type="refunds">Refunds</button>
              <button class="ssi-type-chip" data-type="market">Market</button>
              <button class="ssi-type-chip" data-type="gifts">Gifts</button>
              <button class="ssi-type-chip" data-type="ingame">In-Game</button>
              <button class="ssi-type-chip" data-type="wallet">Wallet</button>
            </div>
          </div>

          <div class="ssi-filter-group">
            <label>Price Range</label>
            <div class="ssi-filter-row">
              <input type="number" id="ssi-price-min" placeholder="Min" step="0.01">
              <span>-</span>
              <input type="number" id="ssi-price-max" placeholder="Max" step="0.01">
            </div>
          </div>

          <div class="ssi-filter-group">
            <label>Search Game/Item</label>
            <input type="text" id="ssi-game-search" placeholder="Type to search..." list="ssi-game-list">
            <datalist id="ssi-game-list"></datalist>
          </div>

          <button class="ssi-reset-filters" id="ssi-reset-filters">Reset Filters</button>
        </div>

        <!-- Primary Stats - Hero Section -->
        <div class="ssi-hero-stats">
          <div class="ssi-hero-card main">
            <div class="ssi-hero-icon">&#128176;</div>
            <div class="ssi-hero-content">
              <span class="ssi-hero-label">Total Spent</span>
              <span class="ssi-hero-value" id="ssi-totalSpent">-</span>
            </div>
          </div>
          <div class="ssi-hero-card">
            <div class="ssi-hero-icon">&#128179;</div>
            <div class="ssi-hero-content">
              <span class="ssi-hero-label">Net Spending</span>
              <span class="ssi-hero-value" id="ssi-netSpent">-</span>
              <span class="ssi-hero-subtitle">After refunds & market earnings</span>
            </div>
          </div>
          <div class="ssi-hero-card">
            <div class="ssi-hero-icon">&#128202;</div>
            <div class="ssi-hero-content">
              <span class="ssi-hero-label">Transactions</span>
              <span class="ssi-hero-value" id="ssi-totalTransactions">-</span>
            </div>
          </div>
        </div>

        <!-- Stats Sections -->
        <div class="ssi-stats-sections">
          <!-- Spending Breakdown -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#127918;</span>
              Spending Breakdown
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Games</span>
                <span class="ssi-stat-value" id="ssi-gamePurchases">-</span>
                <span class="ssi-stat-count" id="ssi-gamePurchaseCount">0</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">In-Game</span>
                <span class="ssi-stat-value" id="ssi-inGamePurchases">-</span>
                <span class="ssi-stat-count" id="ssi-inGameCount">0</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Gifts Sent</span>
                <span class="ssi-stat-value" id="ssi-giftValue">-</span>
                <span class="ssi-stat-count" id="ssi-giftCount">0</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Unique Games</span>
                <span class="ssi-stat-value" id="ssi-uniqueGames">-</span>
              </div>
            </div>
          </div>

          <!-- Wallet & Refunds -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#128184;</span>
              Wallet & Refunds
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Wallet Funded</span>
                <span class="ssi-stat-value" id="ssi-walletFunded">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Refunds</span>
                <span class="ssi-stat-value positive" id="ssi-totalRefunds">-</span>
                <span class="ssi-stat-count" id="ssi-refundCount">0</span>
              </div>
            </div>
          </div>

          <!-- Market Activity -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#128200;</span>
              Market Activity
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Market Spent</span>
                <span class="ssi-stat-value" id="ssi-marketSpent">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Market Earned</span>
                <span class="ssi-stat-value positive" id="ssi-marketEarned">-</span>
              </div>
              <div class="ssi-stat-card highlight">
                <span class="ssi-stat-label">Net Profit/Loss</span>
                <span class="ssi-stat-value" id="ssi-marketNet">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Transactions</span>
                <span class="ssi-stat-value" id="ssi-marketTransactions">-</span>
              </div>
            </div>
          </div>

          <!-- Advanced Profit Analytics Section -->
          <div class="ssi-stats-section ssi-profit-section full-width">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">💰</span>
              Advanced Profit Analytics
            </h3>

            <!-- ROI Metrics Grid -->
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card highlight">
                <span class="ssi-stat-label">Market ROI</span>
                <span class="ssi-stat-value" id="ssi-marketROI">-</span>
                <span class="ssi-stat-subtitle">Return on Investment</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Win Rate</span>
                <span class="ssi-stat-value" id="ssi-winRate">-</span>
                <span class="ssi-stat-subtitle">Profitable transactions</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Avg Profit/Sale</span>
                <span class="ssi-stat-value positive" id="ssi-avgProfitPerSale">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Avg Cost/Purchase</span>
                <span class="ssi-stat-value" id="ssi-avgCostPerPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Breakeven Ratio</span>
                <span class="ssi-stat-value" id="ssi-breakevenRatio">-</span>
                <span class="ssi-stat-subtitle">Earn per €1 spent</span>
              </div>
            </div>

            <!-- Comparative Analytics Grid -->
            <h4 class="ssi-subsection-title">Trend Analysis</h4>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">This Month</span>
                <span class="ssi-stat-value" id="ssi-currentMonthSpending">-</span>
                <span class="ssi-stat-subtitle" id="ssi-momChange">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">30-Day Avg</span>
                <span class="ssi-stat-value" id="ssi-thirtyDayAvg">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">YoY Growth</span>
                <span class="ssi-stat-value" id="ssi-yoyGrowth">-</span>
                <span class="ssi-stat-subtitle">vs same period last year</span>
              </div>
              <div class="ssi-stat-card highlight">
                <span class="ssi-stat-label">Projected Annual</span>
                <span class="ssi-stat-value" id="ssi-projectedAnnual">-</span>
                <span class="ssi-stat-subtitle">Based on current trends</span>
              </div>
            </div>
          </div>

          <!-- Purchase Analytics -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#128270;</span>
              Purchase Analytics
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Average</span>
                <span class="ssi-stat-value" id="ssi-avgPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Median</span>
                <span class="ssi-stat-value" id="ssi-medianPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Smallest</span>
                <span class="ssi-stat-value" id="ssi-smallestPurchase">-</span>
              </div>
              <div class="ssi-stat-card highlight">
                <span class="ssi-stat-label">Largest</span>
                <span class="ssi-stat-value" id="ssi-largestPurchase">-</span>
                <span class="ssi-stat-subtitle" id="ssi-largestPurchaseGame">-</span>
              </div>
            </div>
          </div>

          <!-- Spending Velocity -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#9201;</span>
              Spending Rate
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Per Day</span>
                <span class="ssi-stat-value small" id="ssi-avgPerDay">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Per Week</span>
                <span class="ssi-stat-value small" id="ssi-avgPerWeek">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Per Month</span>
                <span class="ssi-stat-value" id="ssi-avgPerMonth">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Per Year</span>
                <span class="ssi-stat-value" id="ssi-avgPerYear">-</span>
              </div>
              <div class="ssi-stat-card highlight">
                <span class="ssi-stat-label">Peak Month</span>
                <span class="ssi-stat-value small" id="ssi-peakMonth">-</span>
                <span class="ssi-stat-subtitle" id="ssi-peakMonthAmount">-</span>
              </div>
            </div>
          </div>

          <!-- Account Activity -->
          <div class="ssi-stats-section">
            <h3 class="ssi-section-title">
              <span class="ssi-section-icon">&#128197;</span>
              Activity Timeline
            </h3>
            <div class="ssi-stats-grid compact">
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">First Purchase</span>
                <span class="ssi-stat-value small" id="ssi-firstPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Latest Purchase</span>
                <span class="ssi-stat-value small" id="ssi-latestPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Account Age</span>
                <span class="ssi-stat-value small" id="ssi-accountAge">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Days Since Last</span>
                <span class="ssi-stat-value small" id="ssi-daysSinceLastPurchase">-</span>
              </div>
              <div class="ssi-stat-card">
                <span class="ssi-stat-label">Purchase Frequency</span>
                <span class="ssi-stat-value small" id="ssi-purchaseFrequency">-</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Charts -->
        <div class="ssi-charts">
          <div class="ssi-chart-container full-width">
            <div class="ssi-chart-header">
              <h3 class="ssi-chart-title">Spending Over Time</h3>
              <div class="ssi-chart-toggle">
                <button class="active" data-mode="month">Monthly</button>
                <button data-mode="year">Yearly</button>
              </div>
            </div>
            <canvas id="ssi-spending-chart" class="ssi-chart-canvas" height="250"></canvas>
          </div>

          <div class="ssi-chart-container">
            <div class="ssi-chart-header">
              <h3 class="ssi-chart-title">Spending by Category</h3>
            </div>
            <canvas id="ssi-category-chart" class="ssi-chart-canvas" height="250"></canvas>
          </div>

          <div class="ssi-chart-container">
            <div class="ssi-chart-header">
              <h3 class="ssi-chart-title">Top Games</h3>
            </div>
            <canvas id="ssi-games-chart" class="ssi-chart-canvas" height="300"></canvas>
          </div>

          <div class="ssi-chart-container full-width">
            <div class="ssi-chart-header">
              <h3 class="ssi-chart-title">Spending Heatmap (Day vs Month)</h3>
            </div>
            <div id="ssi-heatmap" class="ssi-heatmap"></div>
          </div>
        </div>

        <!-- Breakdowns -->
        <div class="ssi-breakdowns">
          <div class="ssi-breakdown">
            <div class="ssi-breakdown-header" data-target="ssi-yearly-breakdown">
              <h3 class="ssi-breakdown-title">Spending by Year</h3>
              <span class="ssi-breakdown-toggle">▼</span>
            </div>
            <div class="ssi-breakdown-content" id="ssi-yearly-breakdown"></div>
          </div>

          <div class="ssi-breakdown">
            <div class="ssi-breakdown-header" data-target="ssi-type-breakdown">
              <h3 class="ssi-breakdown-title">Transaction Types</h3>
              <span class="ssi-breakdown-toggle">▼</span>
            </div>
            <div class="ssi-breakdown-content" id="ssi-type-breakdown"></div>
          </div>

          <div class="ssi-breakdown">
            <div class="ssi-breakdown-header" data-target="ssi-top-purchases">
              <h3 class="ssi-breakdown-title">Top 10 Purchases</h3>
              <span class="ssi-breakdown-toggle">▼</span>
            </div>
            <div class="ssi-breakdown-content" id="ssi-top-purchases"></div>
          </div>

          <div class="ssi-breakdown">
            <div class="ssi-breakdown-header" data-target="ssi-game-profit-breakdown">
              <h3 class="ssi-breakdown-title">💎 Game Profitability Analysis</h3>
              <span class="ssi-breakdown-toggle">▼</span>
            </div>
            <div class="ssi-breakdown-content" id="ssi-game-profit-breakdown"></div>
          </div>
        </div>
      </div>
    `;
  }

  function injectDashboard() {
    const existingDashboard = document.getElementById('ssi-dashboard');
    if (existingDashboard) {
      existingDashboard.remove();
    }

    const historyTable = document.querySelector('.wallet_history_table');
    const insertPoint = historyTable || document.querySelector('.wallet_history_click_hint');

    if (!insertPoint) {
      console.error('Steam Spending Insights: Could not find insertion point');
      return false;
    }

    const dashboard = document.createElement('div');
    dashboard.id = 'ssi-dashboard';
    dashboard.innerHTML = createDashboardHTML();
    insertPoint.parentNode.insertBefore(dashboard, insertPoint);

    return true;
  }

  function setupEventListeners() {
    // Collapse toggle
    document.getElementById('ssi-collapse-toggle')?.addEventListener('click', () => {
      const content = document.getElementById('ssi-content');
      const btn = document.getElementById('ssi-collapse-toggle');
      content.classList.toggle('collapsed');
      btn.classList.toggle('collapsed');
      btn.textContent = content.classList.contains('collapsed') ? '▼' : '▲';
    });

    // Date filters
    document.getElementById('ssi-date-from')?.addEventListener('change', (e) => {
      filterState.dateFrom = e.target.value ? new Date(e.target.value) : null;
      updateFiltersAndRefresh();
    });

    document.getElementById('ssi-date-to')?.addEventListener('change', (e) => {
      filterState.dateTo = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
      updateFiltersAndRefresh();
    });

    // Date presets
    document.querySelectorAll('.ssi-date-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        const now = new Date();

        document.querySelectorAll('.ssi-date-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (preset === '30days') {
          filterState.dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filterState.dateTo = now;
        } else if (preset === 'year') {
          filterState.dateFrom = new Date(now.getFullYear(), 0, 1);
          filterState.dateTo = now;
        } else {
          filterState.dateFrom = null;
          filterState.dateTo = null;
        }

        document.getElementById('ssi-date-from').value = filterState.dateFrom ? filterState.dateFrom.toISOString().split('T')[0] : '';
        document.getElementById('ssi-date-to').value = filterState.dateTo ? filterState.dateTo.toISOString().split('T')[0] : '';
        updateFiltersAndRefresh();
      });
    });

    // Type filter chips
    document.querySelectorAll('.ssi-type-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const type = chip.dataset.type;
        if (chip.classList.contains('active')) {
          filterState.types.push(type);
        } else {
          filterState.types = filterState.types.filter(t => t !== type);
        }
        updateFiltersAndRefresh();
      });
    });

    // Price filters
    document.getElementById('ssi-price-min')?.addEventListener('input', (e) => {
      filterState.priceMin = e.target.value ? parseFloat(e.target.value) : null;
      updateFiltersAndRefresh();
    });

    document.getElementById('ssi-price-max')?.addEventListener('input', (e) => {
      filterState.priceMax = e.target.value ? parseFloat(e.target.value) : null;
      updateFiltersAndRefresh();
    });

    // Game search
    document.getElementById('ssi-game-search')?.addEventListener('input', (e) => {
      filterState.gameSearch = e.target.value;
      updateFiltersAndRefresh();
    });

    // Reset filters
    document.getElementById('ssi-reset-filters')?.addEventListener('click', () => {
      filterState = { dateFrom: null, dateTo: null, types: [], priceMin: null, priceMax: null, gameSearch: '' };
      document.getElementById('ssi-date-from').value = '';
      document.getElementById('ssi-date-to').value = '';
      document.getElementById('ssi-price-min').value = '';
      document.getElementById('ssi-price-max').value = '';
      document.getElementById('ssi-game-search').value = '';
      document.querySelectorAll('.ssi-type-chip').forEach(c => c.classList.remove('active'));
      document.querySelectorAll('.ssi-date-preset').forEach(b => b.classList.remove('active'));
      updateFiltersAndRefresh();
    });

    // Chart toggle (monthly/yearly)
    document.querySelectorAll('.ssi-chart-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ssi-chart-toggle button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        spendingChartMode = btn.dataset.mode;
        updateSpendingChart(filteredTransactions, true); // Force redraw for mode change
      });
    });

    // Breakdown toggles
    document.querySelectorAll('.ssi-breakdown-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('collapsed');
      });
    });

    // Export buttons
    document.getElementById('ssi-export-json')?.addEventListener('click', () => {
      const data = {
        exportDate: new Date().toISOString(),
        filterState: filterState,
        transactions: filteredTransactions.map(t => ({ ...t, rowElement: undefined }))
      };
      downloadFile(JSON.stringify(data, null, 2), 'steam-spending-data.json', 'application/json');
    });

    document.getElementById('ssi-export-csv')?.addEventListener('click', () => {
      const headers = ['Date', 'Game', 'Item', 'Type', 'Payment Method', 'Total', 'Wallet Change', 'Is Refund', 'Is Gift', 'Is Market'];
      const rows = filteredTransactions.map(t => [
        t.dateStr,
        t.gameName,
        t.itemName,
        t.transactionType,
        t.paymentMethod,
        t.total,
        t.walletChange,
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

  function populateGameAutocomplete() {
    const datalist = document.getElementById('ssi-game-list');
    if (!datalist) return;

    const games = new Set();
    allTransactions.forEach(t => {
      if (t.gameName) games.add(t.gameName);
    });

    datalist.innerHTML = [...games].sort().map(g => `<option value="${g}">`).join('');
  }

  // ============================================
  // INITIALIZATION
  // ============================================

  function loadChartJs(callback) {
    // Content scripts run in isolated world, so we need to inject Chart.js
    // into the page context and communicate via custom events

    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('chart.min.js');
    script.onload = () => {
      // Load the chart renderer script which will handle communication
      injectChartRenderer();
    };
    script.onerror = (e) => {
      console.error('Steam Spending Insights: Failed to load Chart.js', e);
      callback();
    };
    (document.head || document.documentElement).appendChild(script);

    // Listen for the renderer ready event
    window.addEventListener('ssi-renderer-ready', function onReady(e) {
      window.removeEventListener('ssi-renderer-ready', onReady);
      console.log('Steam Spending Insights: Chart renderer ready in page context');
      callback();
    }, { once: true });

    // Timeout fallback
    setTimeout(() => {
      console.log('Steam Spending Insights: Chart.js load timeout, proceeding without charts');
      callback();
    }, 5000);
  }

  function injectChartRenderer() {
    // Inject the chart renderer script into page context
    const rendererScript = document.createElement('script');
    rendererScript.src = chrome.runtime.getURL('chart-renderer.js');
    document.head.appendChild(rendererScript);
  }

  function renderChartInPage(chartId, type, config) {
    window.dispatchEvent(new CustomEvent('ssi-render-chart', {
      detail: { chartId, type, config }
    }));
  }

  function updateChartInPage(chartId, labels, data) {
    window.dispatchEvent(new CustomEvent('ssi-update-chart', {
      detail: { chartId, labels, data }
    }));
  }

  function init() {
    console.log('Steam Spending Insights: Initializing dashboard...');

    // Parse transactions
    allTransactions = parseTransactionRows();
    filteredTransactions = [...allTransactions];

    if (allTransactions.length === 0) {
      console.log('Steam Spending Insights: No transactions found yet');
      return;
    }

    console.log('Steam Spending Insights: Found', allTransactions.length, 'transactions');

    // Inject dashboard
    if (!injectDashboard()) {
      console.error('Steam Spending Insights: Failed to inject dashboard');
      return;
    }

    // Setup event listeners
    setupEventListeners();
    populateGameAutocomplete();

    // Load Chart.js and initialize charts
    loadChartJs(() => {
      updateStats(filteredTransactions);
      updateCharts(filteredTransactions);
      updateBreakdowns(filteredTransactions);
    });

    // Watch for new transactions being loaded
    const observer = new MutationObserver(() => {
      const newTransactions = parseTransactionRows();
      if (newTransactions.length !== allTransactions.length) {
        console.log('Steam Spending Insights: Detected new transactions, updating...');
        allTransactions = newTransactions;
        filteredTransactions = applyFilters(allTransactions);
        populateGameAutocomplete();
        updateStats(filteredTransactions);
        updateCharts(filteredTransactions);
        updateBreakdowns(filteredTransactions);
        highlightTransactionRows();
      }
    });

    const tableContainer = document.querySelector('.wallet_history_table');
    if (tableContainer) {
      observer.observe(tableContainer, { childList: true, subtree: true });
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTransactions') {
      sendResponse({ transactions: allTransactions.map(t => ({ ...t, rowElement: undefined })) });
    } else if (request.action === 'getStatus') {
      sendResponse({
        active: true,
        transactionCount: allTransactions.length,
        filteredCount: filteredTransactions.length
      });
    } else if (request.action === 'scrollToDashboard') {
      document.getElementById('ssi-dashboard')?.scrollIntoView({ behavior: 'smooth' });
      sendResponse({ success: true });
    }
    return true;
  });

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Store reference for debugging
  window.steamSpendingInsights = {
    getTransactions: () => allTransactions,
    getFiltered: () => filteredTransactions,
    getFilters: () => filterState
  };
})();
