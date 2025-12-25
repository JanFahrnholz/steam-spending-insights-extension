# Steam Spending Insights Extension

A Chrome extension that provides comprehensive analytics and insights for your Steam purchase history, including advanced profit metrics and comparative analytics.

## Features

### Core Statistics
- Total spending and net spending (after refunds & market earnings)
- Transaction count and breakdown
- Spending by category (Games, In-Game, Market, Gifts)
- Purchase analytics (average, median, largest, smallest purchases)
- Unique games count

### Advanced Profit Analytics ✨ NEW
- **Market ROI**: Return on investment percentage from market trading
- **Win Rate**: Percentage of profitable market transactions
- **Average Profit per Sale**: How much you earn on average from each market sale
- **Average Cost per Purchase**: Average spending on market purchases
- **Breakeven Ratio**: How much you need to earn per €1 spent to break even

### Comparative & Trend Analysis ✨ NEW
- **Current Month Spending**: This month's spending with MoM comparison
- **30-Day Moving Average**: Average daily spending over the last 30 days
- **Year-over-Year Growth**: Compare current month to same month last year
- **Projected Annual Spending**: Estimated total spending for the year based on current trends

### Game Profitability Analysis ✨ NEW
- Per-game breakdown showing:
  - Total spent (game purchases + in-game items)
  - Market earned (from selling game items)
  - Net profit/loss
  - ROI percentage
  - Transaction count
- Sorted by profitability to identify which games make or lose you money

### Time-Based Analytics
- Spending rate (per day, week, month, year)
- Peak spending month
- Account age and activity timeline
- Purchase frequency
- Days since last purchase

### Visualizations
- Spending over time (monthly/yearly toggle)
- Spending by category (doughnut chart)
- Top 10 games by spending (bar chart)
- Spending heatmap (day vs month)

### Data Export
- JSON export with all metrics and transaction data
- CSV export for spreadsheet analysis

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. Visit your [Steam wallet history page](https://store.steampowered.com/account/history)

## Usage

1. Navigate to your Steam wallet history page
2. Scroll down to load more transactions (the extension auto-updates as you scroll)
3. View comprehensive analytics in the dashboard at the top of the page
4. Use filters to analyze specific time periods or transaction types
5. Export your data for further analysis

## Recent Enhancements

### Version 2.0 (December 2025)
- Added comprehensive profit analytics section with ROI, win rate, and breakeven calculations
- Implemented comparative analytics with MoM, YoY, and trend projections
- Created game-specific profitability breakdown table
- Enhanced statistics with 30-day moving averages and projected spending
- Improved UI with full-width profit section and Steam-themed styling
- Added support for detailed per-game profit tracking

## Privacy

All data processing happens locally in your browser. No data is sent to external servers. The extension only reads data from Steam's wallet history page that you already have access to.

## License

MIT License - feel free to modify and use as you wish!
