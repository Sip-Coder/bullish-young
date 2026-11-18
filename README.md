# Bullish Young

Static stock-research site for long-term AI equity investing. It uses plain HTML, CSS, and JavaScript and is designed for GitHub Pages.

## Data refresh

`scripts/refresh.py` uses yfinance to refresh Yahoo Finance statistics, two years of daily OHLCV history, and the AI basket. GitHub Actions runs it hourly. Failed tickers retain their prior record and history.

To add a stock to the Portfolio watchlist (and the Map, Screener, and stock pages), add its ticker to `data/watchlist.json`; the hourly refresh picks it up automatically.

Run manually with:

```sh
python scripts/refresh.py
```

## Local preview

```sh
python3 -m http.server
```

Open `http://localhost:8000/`.
