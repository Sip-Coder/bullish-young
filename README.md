# Bullish Young

Static stock-research site for long-term AI equity investing. It uses plain HTML, CSS, and JavaScript and is designed for GitHub Pages.

## Data refresh

`scripts/refresh.py` uses yfinance to refresh Yahoo Finance statistics, two years of daily OHLCV history, and the AI basket. GitHub Actions runs it hourly. Failed tickers retain their prior record and history.

Run manually with:

```sh
python scripts/refresh.py
```

## Local preview

```sh
python3 -m http.server
```

Open `http://localhost:8000/`.
