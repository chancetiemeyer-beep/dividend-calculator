import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');
const apiBase = 'https://www.alphavantage.co/query';

loadEnv();

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(url, res);
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, {
      error: 'Something went wrong while handling the request.',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host, () => {
  console.log(`Dividend calculator running at http://${host}:${port}`);
});

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;

  const text = readFileSync(envPath, 'utf8');

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

async function handleApi(url, res) {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey || apiKey === 'your_api_key_here') {
    sendJson(res, 503, {
      error: 'Missing Alpha Vantage API key.',
      help: 'Create a .env file from .env.example and set ALPHA_VANTAGE_API_KEY.'
    });
    return;
  }

  if (url.pathname === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 1) {
      sendJson(res, 400, { error: 'Enter a ticker or company name to search.' });
      return;
    }
    const data = await alphaRequest({ function: 'SYMBOL_SEARCH', keywords: q, apikey: apiKey });
    const matches = (data.bestMatches || []).map((match) => ({
      symbol: match['1. symbol'],
      name: match['2. name'],
      type: match['3. type'],
      region: match['4. region'],
      marketOpen: match['5. marketOpen'],
      marketClose: match['6. marketClose'],
      timezone: match['7. timezone'],
      currency: match['8. currency'],
      matchScore: Number(match['9. matchScore'] || 0)
    }));
    sendJson(res, 200, { matches });
    return;
  }

  if (url.pathname === '/api/quote') {
    const symbol = sanitizeSymbol(url.searchParams.get('symbol'));
    if (!symbol) {
      sendJson(res, 400, { error: 'Enter a valid ticker symbol.' });
      return;
    }
    const data = await alphaRequest({ function: 'GLOBAL_QUOTE', symbol, apikey: apiKey });
    const quote = data['Global Quote'] || {};
    if (!Object.keys(quote).length) {
      sendJson(res, 404, { error: `No quote found for ${symbol}.` });
      return;
    }
    sendJson(res, 200, {
      symbol: quote['01. symbol'] || symbol,
      price: toNumber(quote['05. price']),
      previousClose: toNumber(quote['08. previous close']),
      change: toNumber(quote['09. change']),
      changePercent: quote['10. change percent'] || null,
      latestTradingDay: quote['07. latest trading day'] || null,
      currency: 'USD'
    });
    return;
  }

  if (url.pathname === '/api/dividends') {
    const symbol = sanitizeSymbol(url.searchParams.get('symbol'));
    if (!symbol) {
      sendJson(res, 400, { error: 'Enter a valid ticker symbol.' });
      return;
    }
    const data = await alphaRequest({ function: 'DIVIDENDS', symbol, apikey: apiKey });
    const events = (data.data || []).map((event) => ({
      amount: toNumber(event.amount),
      exDividendDate: event.ex_dividend_date || null,
      declarationDate: event.declaration_date || null,
      recordDate: event.record_date || null,
      paymentDate: event.payment_date || null
    })).filter((event) => Number.isFinite(event.amount) && event.amount > 0);

    sendJson(res, 200, {
      symbol: data.symbol || symbol,
      events,
      inferredAnnualDividend: inferAnnualDividend(events),
      inferredFrequency: inferFrequency(events)
    });
    return;
  }

  sendJson(res, 404, { error: 'API route not found.' });
}

async function alphaRequest(params) {
  const url = new URL(apiBase);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Alpha Vantage returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (data.Note) throw new Error(data.Note);
  if (data.Information) throw new Error(data.Information);
  if (data['Error Message']) throw new Error(data['Error Message']);
  return data;
}

async function serveStatic(requestPath, res) {
  const cleanPath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.normalize(path.join(publicDir, cleanPath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const contents = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'content-type': mimeTypes[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(contents);
  } catch {
    const fallback = await readFile(path.join(publicDir, 'index.html'));
    res.writeHead(200, { 'content-type': mimeTypes['.html'], 'cache-control': 'no-store' });
    res.end(fallback);
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sanitizeSymbol(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  return /^[A-Z0-9.-]{1,20}$/.test(value) ? value : '';
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function inferFrequency(events) {
  const recent = events
    .filter((event) => event.exDividendDate)
    .sort((a, b) => b.exDividendDate.localeCompare(a.exDividendDate))
    .slice(0, 8);

  if (recent.length < 2) return 'unknown';

  const gaps = [];
  for (let index = 0; index < recent.length - 1; index += 1) {
    const current = Date.parse(recent[index].exDividendDate);
    const next = Date.parse(recent[index + 1].exDividendDate);
    if (Number.isFinite(current) && Number.isFinite(next)) {
      gaps.push(Math.abs(current - next) / 86400000);
    }
  }

  if (!gaps.length) return 'unknown';
  const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (averageGap <= 40) return 'monthly';
  if (averageGap <= 120) return 'quarterly';
  if (averageGap <= 220) return 'semiannual';
  if (averageGap <= 430) return 'annual';
  return 'irregular';
}

function inferAnnualDividend(events) {
  const sorted = events
    .filter((event) => event.exDividendDate)
    .sort((a, b) => b.exDividendDate.localeCompare(a.exDividendDate));

  if (!sorted.length) return 0;

  const latestDate = Date.parse(sorted[0].exDividendDate);
  const oneYearAgo = latestDate - 370 * 86400000;
  const lastYearEvents = sorted.filter((event) => Date.parse(event.exDividendDate) >= oneYearAgo);

  if (lastYearEvents.length) {
    return roundMoney(lastYearEvents.reduce((sum, event) => sum + event.amount, 0));
  }

  const frequency = inferFrequency(sorted);
  const multiplier = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 }[frequency] || 1;
  return roundMoney(sorted[0].amount * multiplier);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}
