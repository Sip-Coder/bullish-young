"""Refresh Yahoo statistics, daily/weekly OHLCV history, and the AI basket."""
import datetime as dt
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data")
HISTORY = os.path.join(D, "history")
HISTORY_LONG = os.path.join(D, "history_long")
INTRADAY = os.path.join(D, "intraday")
NOW = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f: return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError): return default

with open(os.path.join(D, "universe.txt"), encoding="utf-8") as f:
    UNIVERSE = [line.strip() for line in f if line.strip()]
BASKET = load_json(os.path.join(D, "basket_targets.json"), {"positions": []})
WATCHLIST = load_json(os.path.join(D, "watchlist.json"), {"stocks": []})
MARKET_TICKERS = ["QYLD", "ES=F"]
PREVIOUS = {r["ticker"]: r for r in load_json(os.path.join(D, "stats.json"), {}).get("stocks", [])}
FIELDS = {"marketCap":"market_cap","enterpriseValue":"enterprise_value","trailingPE":"pe","forwardPE":"forward_pe",
 "trailingPegRatio":"peg","priceToSalesTrailing12Months":"ps","priceToBook":"pb","enterpriseToRevenue":"ev_revenue",
 "enterpriseToEbitda":"ev_ebitda","profitMargins":"profit_margin","returnOnAssets":"roa","returnOnEquity":"roe",
 "totalRevenue":"revenue","netIncomeToCommon":"net_income","trailingEps":"eps","totalCash":"total_cash",
 "debtToEquity":"debt_equity_pct","freeCashflow":"levered_fcf","currentPrice":"price","fiftyTwoWeekHigh":"high_52w",
 "fiftyTwoWeekLow":"low_52w","sector":"sector","industry":"industry","shortName":"name",
 "regularMarketChangePercent":"chg_pct","regularMarketPreviousClose":"prev_close","regularMarketChange":"change"}

def history_rows(h):
    return [{"time":str(i.date()),"open":round(float(o),2),"high":round(float(hi),2),"low":round(float(lo),2),
             "close":round(float(cl),2),"volume":int(v)} for i,o,hi,lo,cl,v in
            zip(h.index,h.Open,h.High,h.Low,h.Close,h.Volume)]

def pull_once(ticker):
    tk = yf.Ticker(ticker.replace(".", "-")); info = tk.info; h = tk.history(period="2y", interval="1d")
    if len(h) < 2: raise RuntimeError("fewer than two history rows")
    c = h["Close"]
    row = {"ticker":ticker,"as_of":NOW,"source":f"https://finance.yahoo.com/quote/{ticker}/key-statistics/"}
    row.update({dest:info.get(src) for src,dest in FIELDS.items()})
    row["price"] = row.get("price") or round(float(c.iloc[-1]),2)
    row["prev_close"] = row.get("prev_close") or round(float(c.iloc[-2]),2)
    if row.get("change") is None: row["change"] = round(row["price"]-row["prev_close"],2)
    if row.get("chg_pct") is None and row["prev_close"]: row["chg_pct"] = round(row["change"]/row["prev_close"]*100,4)
    de = row.get("debt_equity_pct"); row["debt_equity_ratio"] = round(de/100,4) if de is not None else None
    row["ma50"] = round(float(c.iloc[-50:].mean()),2); row["ma200"] = round(float(c.iloc[-200:].mean()),2)
    return row, history_rows(h)

def pull(ticker):
    error = None
    for attempt in range(3):
        try:
            row, hist = pull_once(ticker); return ticker,row,hist,None
        except Exception as exc:
            error = exc
            if attempt < 2: time.sleep(2 ** attempt)
    old = PREVIOUS.get(ticker)
    return (ticker,{**old,"stale":True},None,str(error)) if old else (ticker,None,None,str(error))

def pull_long(ticker):
    path = os.path.join(HISTORY_LONG,f"{ticker}.json")
    # The hourly job only refreshes weekly history once a day (with a small safety margin).
    if os.path.exists(path) and time.time()-os.path.getmtime(path) < 20*60*60: return ticker,None,None
    try:
        h = yf.Ticker(ticker.replace(".", "-")).history(period="max", interval="1wk")
        if len(h) < 1: raise RuntimeError("no weekly history rows")
        return ticker,history_rows(h),None
    except Exception as exc:
        return ticker,None,str(exc)

def intraday_payload(h, interval):
    """Column arrays keep hourly refresh files substantially smaller than row JSON."""
    digits = 4 if float(h["Close"].median()) < 1 else 2
    price = lambda values: [round(float(value),digits) for value in values]
    return {"interval":interval,"as_of":NOW,
            "t":[int(value.timestamp()) for value in h.index],
            "o":price(h.Open),"h":price(h.High),"l":price(h.Low),"c":price(h.Close),
            "v":[int(value) for value in h.Volume]}

def pull_intraday(job):
    ticker, interval, period = job
    try:
        tk = yf.Ticker(ticker.replace(".","-"))
        h = tk.history(period=period,interval=interval)
        if (h is None or h.empty) and interval == "1h":
            for alt_period, alt_interval in ((period,"60m"),("2y","1h"),("2y","60m")):
                h = tk.history(period=alt_period,interval=alt_interval)
                if h is not None and not h.empty: break
        if h is None or h.empty: raise RuntimeError("no intraday history rows")
        h = h.dropna(subset=["Open","High","Low","Close"])
        if h.empty: raise RuntimeError("no complete intraday history rows")
        h["Volume"] = h["Volume"].fillna(0)
        return ticker,interval,intraday_payload(h,interval),None
    except Exception as exc:
        return ticker,interval,None,str(exc)


def markets_rows(h):
    has_adj = "Adj Close" in h.columns
    rows = []
    for stamp, row in h.iterrows():
        day = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp)[:10]
        item = {"time":day,"open":round(float(row["Open"]),2),"high":round(float(row["High"]),2),
                "low":round(float(row["Low"]),2),"close":round(float(row["Close"]),2),
                "volume":int(row["Volume"]) if row["Volume"]==row["Volume"] else 0}
        if has_adj and row["Adj Close"]==row["Adj Close"]:
            item["adjclose"] = round(float(row["Adj Close"]),2)
        rows.append(item)
    return rows

def pull_markets():
    """QYLD and ES=F for the Markets tab only — not added to stats.json."""
    payload = {"generated_at":NOW,"series":{}}
    previous = load_json(os.path.join(D,"markets.json"), {"series":{}})
    for ticker in MARKET_TICKERS:
        try:
            tk = yf.Ticker(ticker)
            daily = tk.history(period="2y", interval="1d", auto_adjust=False)
            weekly = tk.history(period="max", interval="1wk", auto_adjust=False)
            if daily is None or daily.empty: raise RuntimeError("no daily history rows")
            daily = daily.dropna(subset=["Open","High","Low","Close"])
            weekly = weekly.dropna(subset=["Open","High","Low","Close"]) if weekly is not None and not weekly.empty else daily.iloc[0:0]
            try: info = tk.info or {}
            except Exception: info = {}
            last = daily.iloc[-1]
            payload["series"][ticker] = {
                "ticker":ticker,
                "name":info.get("shortName") or info.get("longName") or ticker,
                "price":round(float(last["Close"]),2),
                "daily":markets_rows(daily),
                "weekly":markets_rows(weekly) if len(weekly) else [],
            }
        except Exception as exc:
            if ticker in previous.get("series",{}):
                payload["series"][ticker] = previous["series"][ticker]
            print(f"markets {ticker} failed: {exc}")
    return payload

def write_json(path, value):
    with open(path,"w",encoding="utf-8") as f: json.dump(value,f,indent=1,allow_nan=False); f.write("\n")

# Tickers in data/watchlist.json are always included in the hourly refresh; no other file edits are needed.
# Every page renders all stats.json rows (universe ∪ basket ∪ watchlist).
tickers = sorted(set(UNIVERSE) | {b["ticker"] for b in BASKET["positions"]} | {s["ticker"] for s in WATCHLIST["stocks"]})
intraday_tickers = sorted({b["ticker"] for b in BASKET["positions"]} | {s["ticker"] for s in WATCHLIST["stocks"]})
intraday_jobs = [(ticker,interval,period) for ticker in intraday_tickers for interval,period in
                 (("1m","5d"),("5m","60d"),("1h","730d"))]
with ThreadPoolExecutor(max_workers=4) as executor: results = list(executor.map(pull,tickers))
with ThreadPoolExecutor(max_workers=4) as executor: long_results = list(executor.map(pull_long,tickers))
with ThreadPoolExecutor(max_workers=4) as executor: intraday_results = list(executor.map(pull_intraday,intraday_jobs))
failures = [ticker for ticker,row,hist,error in results if error]
if len(failures) > len(tickers)/2: raise SystemExit(f"refusing to write: {len(failures)}/{len(tickers)} tickers failed")
os.makedirs(HISTORY,exist_ok=True); rows=[]
for ticker,row,hist,error in results:
    if row is not None: rows.append(row)
    if hist is not None: write_json(os.path.join(HISTORY,f"{ticker}.json"),hist)
long_updates = [(ticker,hist) for ticker,hist,error in long_results if hist is not None]
if long_updates: os.makedirs(HISTORY_LONG,exist_ok=True)
for ticker,hist in long_updates: write_json(os.path.join(HISTORY_LONG,f"{ticker}.json"),hist)
intraday_updates = [(ticker,interval,payload) for ticker,interval,payload,error in intraday_results if payload is not None]
if intraday_updates: os.makedirs(INTRADAY,exist_ok=True)
for ticker,interval,payload in intraday_updates:
    path = os.path.join(INTRADAY,f"{ticker}_{interval}.json")
    with open(path,"w",encoding="utf-8") as f:
        json.dump(payload,f,separators=(",",":"),allow_nan=False); f.write("\n")
stats = {r["ticker"]:r for r in rows}
write_json(os.path.join(D,"stats.json"),{"generated_at":NOW,"as_of":NOW,"count":len(rows),"stocks":rows})

positions=[]
for target in BASKET["positions"]:
    stock=stats.get(target["ticker"],{}); price=stock.get("price"); ma50=stock.get("ma50"); entry=target["entry_price"]
    status = "Above 50D: signal" if price and ma50 and price>ma50 else ("Down 10% from entry: signal" if price and price<=.9*entry else "Below 50D: waiting")
    flag = target.get("flag") if stock.get("levered_fcf") is not None and stock["levered_fcf"]<0 else None
    positions.append({**target,"shares":round(target["target_usd"]/price,2) if price else None,
      "whole_shares":int(target["target_usd"]//price) if price else None,"first_half_usd":target["target_usd"]/2,
      "second_half_usd":target["target_usd"]/2,"price":price,"ma50":ma50,
      "pct_vs_ma50":round((price/ma50-1)*100,2) if price and ma50 else None,
      "pct_vs_entry":round((price/entry-1)*100,2) if price else None,"status":status,"flag":flag,"as_of":NOW})
write_json(os.path.join(D,"basket.json"),{"generated_at":NOW,"as_of":NOW,"total":BASKET["total"],
 "cash_reserve":BASKET["cash_reserve"],"positions":positions})
markets = pull_markets()
write_json(os.path.join(D,"markets.json"), markets)
print(f"refreshed {len(rows)} tickers at {NOW}; failures: {failures}; long history updates: {len(long_updates)}; intraday files written: {len(intraday_updates)}; market series: {list(markets.get('series', {}))}")
