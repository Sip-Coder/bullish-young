"""Hourly data refresh: pulls Yahoo Finance stats + 1y daily history for the universe and basket.
Writes data/stats.json, data/history/<TICKER>.json, data/basket.json. Every record carries as_of (UTC)."""
import json, os, datetime as dt
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data")
UNIVERSE = [l.strip() for l in open(os.path.join(D, "universe.txt")) if l.strip()]
BASKET = json.load(open(os.path.join(D, "basket_targets.json")))
NOW = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
FIELDS = {"marketCap":"market_cap","enterpriseValue":"enterprise_value","trailingPE":"pe","forwardPE":"forward_pe",
  "trailingPegRatio":"peg","priceToSalesTrailing12Months":"ps","priceToBook":"pb","enterpriseToRevenue":"ev_revenue",
  "enterpriseToEbitda":"ev_ebitda","profitMargins":"profit_margin","returnOnAssets":"roa","returnOnEquity":"roe",
  "totalRevenue":"revenue","netIncomeToCommon":"net_income","trailingEps":"eps","totalCash":"total_cash",
  "debtToEquity":"debt_equity_pct","freeCashflow":"levered_fcf","currentPrice":"price","fiftyTwoWeekHigh":"high_52w",
  "fiftyTwoWeekLow":"low_52w","sector":"sector","industry":"industry","shortName":"name","regularMarketChangePercent":"chg_pct"}

def pull(t):
    try:
        tk = yf.Ticker(t.replace(".", "-"))
        info = tk.info
        r = {"ticker": t, "as_of": NOW, "source": f"https://finance.yahoo.com/quote/{t}/key-statistics/"}
        r.update({v: info.get(k) for k, v in FIELDS.items()})
        de = r.get("debt_equity_pct")
        r["debt_equity_ratio"] = round(de / 100, 4) if de is not None else None  # Finviz scale
        h = tk.history(period="1y", interval="1d")
        c = h["Close"]
        if len(c) > 1:
            r["ma50"] = round(float(c[-50:].mean()), 2)
            r["ma200"] = round(float(c[-200:].mean()), 2)
            os.makedirs(os.path.join(D, "history"), exist_ok=True)
            json.dump([{"time": str(i.date()), "open": round(o, 2), "high": round(hi, 2), "low": round(lo, 2),
                        "close": round(cl, 2), "volume": int(v)} for i, o, hi, lo, cl, v in
                       zip(h.index, h.Open, h.High, h.Low, h.Close, h.Volume)],
                      open(os.path.join(D, "history", f"{t}.json"), "w"))
        return r
    except Exception as e:
        return {"ticker": t, "as_of": NOW, "error": str(e)}

tickers = sorted(set(UNIVERSE) | {b["ticker"] for b in BASKET["positions"]})
with ThreadPoolExecutor(8) as ex:
    rows = list(ex.map(pull, tickers))
stats = {r["ticker"]: r for r in rows}
json.dump({"as_of": NOW, "count": len(rows), "stocks": rows}, open(os.path.join(D, "stats.json"), "w"), indent=1)

# Basket with buy-zone signal: half now; second half when close > 50-day avg, or price <= 90% of first buy.
out = []
for b in BASKET["positions"]:
    s = stats.get(b["ticker"], {})
    px, ma50 = s.get("price"), s.get("ma50")
    sig = None
    if px and ma50:
        sig = "above 50-day avg (second-half buy signal)" if px > ma50 else f"{round((px/ma50-1)*100,1)}% below 50-day avg"
    out.append({**b, "price": px, "ma50": ma50, "ma200": s.get("ma200"), "signal": sig, "as_of": NOW})
json.dump({"as_of": NOW, "total": BASKET["total"], "cash_reserve": BASKET["cash_reserve"], "positions": out},
          open(os.path.join(D, "basket.json"), "w"), indent=1)
print(f"refreshed {len(rows)} tickers at {NOW}; errors: {[r['ticker'] for r in rows if 'error' in r]}")
