import { calculateDividendModel, inferDividendInputs } from './calc.js';

const form = document.querySelector('#calculatorForm');
const symbolInput = document.querySelector('#symbolInput');
const loadTickerButton = document.querySelector('#loadTickerButton');
const resetManualButton = document.querySelector('#resetManualButton');
const searchResults = document.querySelector('#searchResults');
const apiStatus = document.querySelector('#apiStatus');
const resultTitle = document.querySelector('#resultTitle');
const quoteChip = document.querySelector('#quoteChip');
const chart = document.querySelector('#projectionChart');
const chartContext = chart.getContext('2d');
const copyUrlButton = document.querySelector('#copyUrlButton');
const copyUrlButtonBottom = document.querySelector('#copyUrlButtonBottom');
const localUrl = 'http://127.0.0.1:4173/';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1
});

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2
});

const number = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 4
});

let loadedSymbol = '';
let debounceId = 0;

form.addEventListener('input', render);
form.addEventListener('change', render);
copyUrlButton.addEventListener('click', () => copyLocalUrl(copyUrlButton));
copyUrlButtonBottom.addEventListener('click', () => copyLocalUrl(copyUrlButtonBottom));

symbolInput.addEventListener('input', () => {
  clearTimeout(debounceId);
  const query = symbolInput.value.trim();
  if (query.length < 2) {
    searchResults.innerHTML = '';
    return;
  }
  debounceId = setTimeout(() => searchSymbols(query), 280);
});

loadTickerButton.addEventListener('click', () => loadTicker(symbolInput.value.trim()));
symbolInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadTicker(symbolInput.value.trim());
  }
});

resetManualButton.addEventListener('click', () => {
  loadedSymbol = '';
  resultTitle.textContent = 'Manual estimate';
  quoteChip.textContent = 'No ticker loaded';
  apiStatus.textContent = 'Manual mode ready';
  apiStatus.className = 'status-pill';
  searchResults.innerHTML = '';
  render();
});

render();

async function searchSymbols(query) {
  setStatus('Searching tickers...', 'busy');
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
    if (!data.matches.length) {
      searchResults.innerHTML = '<p class="empty-state">No ticker matches found.</p>';
      setStatus('No matches found', 'warn');
      return;
    }

    searchResults.innerHTML = data.matches.slice(0, 5).map((match) => `
      <button class="result-button" type="button" data-symbol="${escapeHtml(match.symbol)}">
        <strong>${escapeHtml(match.symbol)}</strong>
        <span>${escapeHtml(match.name || 'Unknown name')}</span>
        <em>${escapeHtml(match.region || 'Unknown region')}</em>
      </button>
    `).join('');

    for (const button of searchResults.querySelectorAll('.result-button')) {
      button.addEventListener('click', () => {
        symbolInput.value = button.dataset.symbol;
        loadTicker(button.dataset.symbol);
      });
    }

    setStatus('Ticker search ready', 'ok');
  } catch (error) {
    searchResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    setStatus('Use manual inputs or add API key', 'warn');
  }
}

async function loadTicker(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return;

  setStatus(`Loading ${symbol}...`, 'busy');
  loadTickerButton.disabled = true;

  try {
    const [quote, dividends] = await Promise.all([
      fetchJson(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
      fetchJson(`/api/dividends?symbol=${encodeURIComponent(symbol)}`)
    ]);

    loadedSymbol = quote.symbol || symbol;
    const inferred = inferDividendInputs(dividends.events);

    setInputValue('sharePrice', quote.price || quote.previousClose || 0);
    if (inferred.dividendPerShare > 0) {
      setInputValue('dividendPerShare', inferred.dividendPerShare);
      form.elements.frequency.value = inferred.frequency;
    }

    resultTitle.textContent = `${loadedSymbol} dividend estimate`;
    quoteChip.textContent = `${currency.format(quote.price || 0)} ${quote.currency || 'USD'}${quote.latestTradingDay ? ` as of ${quote.latestTradingDay}` : ''}`;

    if (!dividends.events.length) {
      setStatus(`${loadedSymbol} loaded, no dividend data found`, 'warn');
    } else {
      setStatus(`${loadedSymbol} loaded from Alpha Vantage`, 'ok');
    }

    searchResults.innerHTML = '';
    render();
  } catch (error) {
    setStatus(error.message, 'warn');
    searchResults.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  } finally {
    loadTickerButton.disabled = false;
  }
}

function render() {
  const model = calculateDividendModel(readForm());
  document.querySelector('#annualIncome').textContent = currency.format(model.annualIncome);
  document.querySelector('#monthlyIncome').textContent = currency.format(model.monthlyIncome);
  document.querySelector('#afterTaxIncome').textContent = currency.format(model.afterTaxAnnualIncome);
  document.querySelector('#sharesOwned').textContent = number.format(model.shares);
  document.querySelector('#yieldOnCost').textContent = percent.format(model.yieldOnCost);
  document.querySelector('#currentYield').textContent = percent.format(model.currentYield);

  const finalYear = model.projection.at(-1);
  document.querySelector('#finalProjection').textContent = finalYear
    ? `${currency.format(finalYear.grossIncome)} in year ${finalYear.year}`
    : '$0';

  renderSchedule(model.payoutSchedule);
  renderProjectionTable(model.projection);
  drawChart(model.projection);
}

function readForm() {
  const data = new FormData(form);
  return {
    symbol: loadedSymbol,
    investmentAmount: data.get('investmentAmount'),
    sharePrice: data.get('sharePrice'),
    dividendPerShare: data.get('dividendPerShare'),
    frequency: data.get('frequency'),
    taxRate: data.get('taxRate'),
    fees: data.get('fees'),
    projectionYears: data.get('projectionYears'),
    dividendGrowthRate: data.get('dividendGrowthRate'),
    priceGrowthRate: data.get('priceGrowthRate'),
    recurringContribution: data.get('recurringContribution'),
    reinvestDividends: data.get('reinvestDividends') === 'on',
    allowFractionalShares: data.get('allowFractionalShares') === 'on'
  };
}

function renderSchedule(schedule) {
  const target = document.querySelector('#payoutSchedule');
  if (!schedule.length) {
    target.innerHTML = '<p class="empty-state">Enter dividend assumptions to see estimated payouts.</p>';
    return;
  }

  target.innerHTML = schedule.map((item) => `
    <div class="schedule-item">
      <span>${escapeHtml(item.label)}</span>
      <strong>${currency.format(item.amount)}</strong>
    </div>
  `).join('');
}

function renderProjectionTable(projection) {
  const target = document.querySelector('#projectionTable');
  target.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Year</th>
          <th>Income</th>
          <th>Value</th>
          <th>Shares</th>
        </tr>
      </thead>
      <tbody>
        ${projection.map((row) => `
          <tr>
            <td>${row.year}</td>
            <td>${currency.format(row.grossIncome)}</td>
            <td>${currency.format(row.portfolioValue)}</td>
            <td>${number.format(row.shares)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function drawChart(projection) {
  const width = chart.width;
  const height = chart.height;
  chartContext.clearRect(0, 0, width, height);
  chartContext.fillStyle = '#f7fbf8';
  chartContext.fillRect(0, 0, width, height);

  const padding = 36;
  const values = projection.map((row) => row.grossIncome);
  const maxValue = Math.max(...values, 1);
  const barWidth = Math.max(12, (width - padding * 2) / Math.max(values.length, 1) - 8);

  chartContext.strokeStyle = '#d7e5dd';
  chartContext.lineWidth = 1;
  chartContext.beginPath();
  for (let line = 0; line <= 4; line += 1) {
    const y = padding + ((height - padding * 2) / 4) * line;
    chartContext.moveTo(padding, y);
    chartContext.lineTo(width - padding, y);
  }
  chartContext.stroke();

  values.forEach((value, index) => {
    const x = padding + index * (barWidth + 8);
    const usableHeight = height - padding * 2;
    const barHeight = (value / maxValue) * usableHeight;
    const y = height - padding - barHeight;
    const gradient = chartContext.createLinearGradient(0, y, 0, height - padding);
    gradient.addColorStop(0, '#287c59');
    gradient.addColorStop(1, '#80b56d');
    chartContext.fillStyle = gradient;
    chartContext.fillRect(x, y, barWidth, barHeight);

    if (index === values.length - 1 || index === 0 || values.length <= 8) {
      chartContext.fillStyle = '#32433b';
      chartContext.font = '12px system-ui, sans-serif';
      chartContext.textAlign = 'center';
      chartContext.fillText(String(index + 1), x + barWidth / 2, height - 12);
    }
  });

  chartContext.fillStyle = '#53645c';
  chartContext.font = '12px system-ui, sans-serif';
  chartContext.textAlign = 'left';
  chartContext.fillText(compactCurrency.format(maxValue), 10, padding);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Market data request failed.');
  }

  return data;
}

function setInputValue(name, value) {
  const field = form.elements[name];
  if (!field) return;
  field.value = Number(value || 0).toFixed(name === 'dividendPerShare' ? 4 : 2);
}

function setStatus(message, tone = '') {
  apiStatus.textContent = message;
  apiStatus.className = `status-pill ${tone}`.trim();
}

async function copyLocalUrl(button) {
  const originalText = button.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(localUrl);
      } catch {
        fallbackCopy(localUrl);
      }
    } else {
      fallbackCopy(localUrl);
    }
    button.textContent = 'Copied';
    setStatus('Local URL copied. Paste it into Safari while this app is running.', 'ok');
  } catch {
    button.textContent = 'Copy failed';
    setStatus('Copy failed. Select and copy the URL at the bottom of the page.', 'warn');
  } finally {
    setTimeout(() => {
      button.textContent = originalText;
    }, 1800);
  }
}

function fallbackCopy(value) {
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', '');
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.append(textArea);
  textArea.select();
  document.execCommand('copy');
  textArea.remove();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}
