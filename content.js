// Steam Spending Insights - Content Script
// Parses the Steam purchase history table and extracts transaction data

(function() {
  'use strict';

  function parsePrice(priceStr) {
    if (!priceStr) return 0;
    // Remove currency symbols and whitespace, handle European format
    // Handle "25,--€" format (no cents)
    let cleaned = priceStr.trim()
      .replace(/[^\d,.\-+]/g, '')
      .replace(',--', ',00')
      .replace(/\.(?=\d{3})/g, '') // Remove thousand separators
      .replace(',', '.'); // Convert European decimal comma to dot
    return parseFloat(cleaned) || 0;
  }

  function parseDate(dateStr) {
    if (!dateStr) return null;
    const cleaned = dateStr.trim();

    // German format: "7. Dez. 2025" or "17. Nov. 2016"
    const germanMonths = {
      'Jan': 0, 'Feb': 1, 'Mär': 2, 'Mar': 2, 'Apr': 3, 'Mai': 4, 'May': 4,
      'Jun': 5, 'Jul': 6, 'Aug': 7, 'Sep': 8, 'Okt': 9, 'Oct': 9, 'Nov': 10, 'Dez': 11, 'Dec': 11
    };

    // Try German format first
    const germanMatch = cleaned.match(/(\d{1,2})\.\s*(\w{3})\.?\s*(\d{4})/);
    if (germanMatch) {
      const day = parseInt(germanMatch[1]);
      const month = germanMonths[germanMatch[2]] ?? 0;
      const year = parseInt(germanMatch[3]);
      return new Date(year, month, day);
    }

    // Try English format: "Dec 7, 2025"
    const englishMatch = cleaned.match(/(\w{3})\s+(\d{1,2}),?\s*(\d{4})/);
    if (englishMatch) {
      const month = germanMonths[englishMatch[1]] ?? 0;
      const day = parseInt(englishMatch[2]);
      const year = parseInt(englishMatch[3]);
      return new Date(year, month, day);
    }

    // Fallback to native parsing
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
    return '€'; // Default based on sample
  }

  function getTextContent(element) {
    if (!element) return '';
    // Clone the element and remove nested elements we don't want
    const clone = element.cloneNode(true);
    // Remove images and other non-text elements
    clone.querySelectorAll('img, a').forEach(el => el.remove());
    return clone.textContent.trim().replace(/\s+/g, ' ');
  }

  function parseTransactionRows() {
    const rows = document.querySelectorAll('.wallet_table_row');
    const transactions = [];

    rows.forEach(row => {
      try {
        const dateEl = row.querySelector('.wht_date');
        const itemsEl = row.querySelector('.wht_items');
        const typeEl = row.querySelector('.wht_type');
        const totalEl = row.querySelector('.wht_total');
        const walletChangeEl = row.querySelector('.wht_wallet_change');
        const walletBalanceEl = row.querySelector('.wht_wallet_balance');

        // Extract game name and item name
        let gameName = '';
        let itemName = '';
        let isGift = false;
        let giftRecipient = '';
        let isMarketTransaction = false;
        let marketTransactionCount = 1;

        if (itemsEl) {
          const itemText = getTextContent(itemsEl);

          // Check for gift
          if (itemText.includes('Geschenk gesendet') || itemText.includes('Gift sent')) {
            isGift = true;
            const recipientLink = itemsEl.querySelector('a');
            if (recipientLink) {
              giftRecipient = recipientLink.textContent.trim();
            }
          }

          // Check for market transaction
          if (itemText.includes('Steam-Communitymarkt') || itemText.includes('Community Market')) {
            isMarketTransaction = true;
          }

          // Check for wallet funding
          const walletFundMatch = itemText.match(/(\d+[,.]?\d*)[,\-]+€?\s*Steam-Guthaben/i);

          // Extract game/item names
          const itemDivs = itemsEl.querySelectorAll('div');
          itemDivs.forEach(div => {
            const text = div.textContent.trim();
            if (div.classList.contains('wth_payment')) {
              itemName = text;
            } else if (!div.classList.contains('help_purchase_img') && text && !text.includes('Geschenk')) {
              if (!gameName) gameName = text;
            }
          });

          // If no game name found in divs, use full text
          if (!gameName && !isMarketTransaction && !isGift) {
            gameName = itemText;
          }
        }

        // Extract transaction type
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
              // Check for multiple market transactions: "X Markttransaktionen"
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

        // Handle nested price in div (market transactions)
        let totalStr = '';
        if (totalEl) {
          const nestedDiv = totalEl.querySelector('div');
          totalStr = nestedDiv ? nestedDiv.textContent.trim() : totalEl.textContent.trim();
        }

        const walletChangeStr = walletChangeEl ? walletChangeEl.textContent.trim() : '';
        const walletBalanceStr = walletBalanceEl ? walletBalanceEl.textContent.trim() : '';

        const walletChange = parsePrice(walletChangeStr);
        const isPositiveChange = walletChangeStr.includes('+') || walletChange > 0;

        // Determine if this is a wallet funding
        const itemText = itemsEl ? getTextContent(itemsEl) : '';
        const isWalletFunding = (itemText.includes('Steam-Guthaben gekauft') ||
                                 itemText.includes('Wallet Credit') ||
                                 itemText.includes('Funds')) && isPositiveChange;

        // Determine if this is a refund (positive wallet change but not wallet funding or market sale)
        const isRefund = isPositiveChange && !isWalletFunding && !isMarketTransaction;

        // Determine if this is a market sale (positive) or market purchase (negative)
        const isMarketSale = isMarketTransaction && isPositiveChange;
        const isMarketPurchase = isMarketTransaction && !isPositiveChange;

        const transaction = {
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
          marketTransactionCount: marketTransactionCount,
          isGiftPurchase: transactionType.includes('Geschenkeinkauf') || transactionType.includes('Gift purchase')
        };

        transactions.push(transaction);
      } catch (e) {
        console.error('Error parsing row:', e);
      }
    });

    return transactions;
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTransactions') {
      const transactions = parseTransactionRows();
      sendResponse({ transactions: transactions });
    }
    return true;
  });

  // Store transactions in window for debugging
  window.steamTransactions = parseTransactionRows();
  console.log('Steam Spending Insights: Found', window.steamTransactions.length, 'transactions');
})();
