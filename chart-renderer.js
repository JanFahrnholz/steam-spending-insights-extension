// Steam Spending Insights - Chart Renderer
// This script runs in the page context to access Chart.js

(function() {
  'use strict';

  window.ssiCharts = {};

  window.addEventListener('ssi-render-chart', function(e) {
    const { chartId, type, config } = e.detail;
    const canvas = document.getElementById(chartId);
    if (!canvas || !window.Chart) {
      console.error('SSI: Cannot render chart - canvas or Chart.js not available', chartId);
      return;
    }

    try {
      if (window.ssiCharts[chartId]) {
        window.ssiCharts[chartId].destroy();
      }
      window.ssiCharts[chartId] = new Chart(canvas, { type, ...config });
      console.log('SSI: Chart rendered', chartId);
    } catch (err) {
      console.error('SSI Chart error:', err);
    }
  });

  window.addEventListener('ssi-update-chart', function(e) {
    const { chartId, labels, data } = e.detail;
    const chart = window.ssiCharts[chartId];
    if (!chart) return;

    try {
      if (labels) chart.data.labels = labels;
      if (data) chart.data.datasets[0].data = data;
      chart.update();
    } catch (err) {
      console.error('SSI Chart update error:', err);
    }
  });

  // Signal that renderer is ready
  window.ssiChartRendererReady = true;
  window.dispatchEvent(new CustomEvent('ssi-renderer-ready'));
  console.log('Steam Spending Insights: Chart renderer loaded');
})();
