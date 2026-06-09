# Dividend Calculator Web App

A local dividend income calculator for stocks and ETFs. It can load ticker, price, and dividend data from Alpha Vantage through a private Node server, then estimate annual income, average monthly income, after-tax income, payout timing, and long-term projections.

## Setup

1. Install Node.js 18 or newer.
2. Create a `.env` file in this folder using `.env.example` as the template.
3. Add your free Alpha Vantage key:

```bash
ALPHA_VANTAGE_API_KEY=your_api_key_here
PORT=4173
```

## Run

```bash
npm start
```

Open `http://localhost:4173`.

The calculator also works in manual mode when no API key is configured. Ticker search and automatic quote/dividend loading require the Alpha Vantage key.

## Test

```bash
npm test
```

## Notes

- Version one is optimized for U.S. stocks and ETFs.
- Monthly income is shown as an average unless the app can infer a payout schedule.
- Results are estimates for education and planning, not financial advice.
