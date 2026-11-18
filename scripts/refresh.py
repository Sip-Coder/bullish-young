"""Refresh Yahoo statistics, daily/weekly OHLCV history, and the AI basket."""
import datetime as dt
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
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

def file_slug(ticker):
    return ticker.replace("=", "-")

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
NASDAQ_DIVIDENDS_URL = "https://api.nasdaq.com/api/quote/QYLD/dividends?assetclass=etf"
GLOBALX_FUND_URL = "https://www.globalxetfs.com/funds/qyld"
GLOBALX_DISTRIBUTIONS = "https://www.globalxetfs.com/funds/qyld#distributions"
MARKETS_DIR = os.path.join(D, "markets")
DIVIDENDS_DIR = os.path.join(D, "dividends")

def http_get(url, headers, timeout=20):
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")

def parse_mdy(value):
    if not value or str(value).strip() in ("N/A", "--", "-", "n/a"):
        return None
    parts = str(value).strip().split("/")
    if len(parts) != 3:
        return None
    month, day, year = parts
    return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"

def parse_money(value):
    if value is None:
        return None
    text = str(value).replace("$", "").replace(",", "").strip()
    if text in ("", "-", "N/A", "--"):
        return None
    return round(float(text), 4)
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

def close_lookup(rows):
    return {row["time"]: row["close"] for row in rows}

def close_before(closes, day):
    """Split-adjusted close on the last trading day strictly before the ex-date."""
    earlier = [key for key in closes if key < day]
    return closes[max(earlier)] if earlier else None

def split_lookup(ticker):
    """Yahoo split factors keyed by the split date (ISO). Soft-fail."""
    try:
        series = yf.Ticker(ticker.replace(".", "-")).splits
    except Exception as exc:
        print(f"splits {ticker} failed: {exc}")
        return {}
    out = {}
    if series is None:
        return out
    for stamp, ratio in series.items():
        day = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp)[:10]
        try:
            value = float(ratio)
        except (TypeError, ValueError):
            continue
        if day and value > 0 and value != 1:
            out[day] = value
    return out

def split_adjust_amount(amount, ex_date, splits):
    """Convert an as-paid amount into today's split-adjusted terms."""
    if amount is None:
        return None
    factor = 1.0
    for day, ratio in (splits or {}).items():
        if day > ex_date and ratio:
            factor *= ratio
    if not factor:
        return amount
    return round(amount / factor, 4)

_nasdaq_lock = threading.Lock()
_nasdaq_last = 0.0

def fetch_nasdaq_dividends(ticker="QYLD", assetclass="etf"):
    """Nasdaq dividend history. Throttled; callers must treat failures as soft."""
    global _nasdaq_last
    url = f"https://api.nasdaq.com/api/quote/{ticker}/dividends?assetclass={assetclass}"
    kind = "etf" if assetclass == "etf" else "stocks"
    with _nasdaq_lock:
        wait = 0.7 - (time.time() - _nasdaq_last)
        if wait > 0:
            time.sleep(wait)
        raw = http_get(url, {
            "User-Agent": BROWSER_UA,
            "Accept": "application/json, text/plain, */*",
            "Origin": "https://www.nasdaq.com",
            "Referer": f"https://www.nasdaq.com/market-activity/{kind}/{ticker.lower()}/dividend-history",
        })
        _nasdaq_last = time.time()
    payload = json.loads(raw)
    rows = (((payload or {}).get("data") or {}).get("dividends") or {}).get("rows") or []
    out = []
    for row in rows:
        typ = str(row.get("type") or "").strip() or "Cash"
        ex_date = parse_mdy(row.get("exOrEffDate"))
        amount = parse_money(row.get("amount"))
        if not ex_date or amount is None:
            continue
        item = {
            "ex_date": ex_date,
            "record_date": parse_mdy(row.get("recordDate")),
            "payable_date": parse_mdy(row.get("paymentDate")),
            "declared_date": parse_mdy(row.get("declarationDate")),
            "amount": amount,
            "type": typ,
            "source": "nasdaq",
        }
        if typ.lower() not in ("cash", ""):
            item["special"] = True
        out.append(item)
    if not out:
        raise RuntimeError("nasdaq returned no cash dividends")
    out.sort(key=lambda row: row["ex_date"])
    return out

def merge_dividend_rows(base_rows, nasdaq_rows):
    """Merge Nasdaq as-paid amounts and dates onto Yahoo rows by ex-date.

    Yahoo's amount is split-adjusted and kept as amount_adj. Nasdaq overwrites
    amount with the as-paid figure when it has that ex-date.
    """
    by_ex = {}
    for row in base_rows or []:
        if not row.get("ex_date"):
            continue
        item = dict(row)
        if item.get("amount_adj") is None and item.get("amount") is not None:
            item["amount_adj"] = item["amount"]
        by_ex[item["ex_date"]] = item
    for row in nasdaq_rows or []:
        existing = by_ex.get(row["ex_date"], {})
        merged = dict(existing)
        amount_adj = existing.get("amount_adj")
        for key in ("ex_date", "record_date", "payable_date", "declared_date", "amount", "type", "special", "source"):
            if row.get(key) is not None:
                merged[key] = row[key]
        merged["source"] = "nasdaq"
        if amount_adj is not None:
            merged["amount_adj"] = amount_adj
        by_ex[merged["ex_date"]] = merged
    rows = list(by_ex.values())
    rows.sort(key=lambda row: row["ex_date"])
    return rows

def fetch_yahoo_dividends(ticker="QYLD"):
    series = yf.Ticker(ticker).dividends
    if series is None or len(series) == 0:
        raise RuntimeError("yahoo returned no dividends")
    out = []
    for stamp, amount in series.items():
        day = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp)[:10]
        value = parse_money(amount)
        if not day or value is None:
            continue
        out.append({
            "ex_date": day,
            "record_date": None,
            "payable_date": None,
            "declared_date": None,
            "amount": value,
            "amount_adj": value,
            "source": "yahoo",
        })
    if not out:
        raise RuntimeError("yahoo returned no parseable dividends")
    out.sort(key=lambda row: row["ex_date"])
    return out

def fetch_globalx_official():
    html = http_get(GLOBALX_FUND_URL, {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.globalxetfs.com/",
    })
    if "Security Checkpoint" in html or "Just a moment" in html:
        raise RuntimeError("globalx returned a security checkpoint")
    def pct_near(label):
        match = re.search(re.escape(label) + r".{0,400}?(-?\d+\.\d+)\s*%", html, re.I | re.S)
        return float(match.group(1)) if match else None
    def money_near(label):
        match = re.search(re.escape(label) + r".{0,400}?\$(\d+\.\d{2})", html, re.I | re.S)
        return float(match.group(1)) if match else None
    trailing = pct_near("Trailing 12-Month Distribution") or pct_near("12-Month Trailing Yield")
    dist = pct_near("Distribution Rate")
    nav = money_near("NAV")
    if trailing is None and dist is None:
        raise RuntimeError("globalx official yields not found")
    as_of = None
    match = re.search(r"as of\s+([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4})", html, re.I)
    if match:
        try:
            as_of = dt.datetime.strptime(match.group(1), "%B %d, %Y").date().isoformat()
        except ValueError:
            try:
                as_of = dt.datetime.strptime(match.group(1), "%b %d, %Y").date().isoformat()
            except ValueError:
                as_of = None
    return {
        "as_of": as_of or dt.datetime.now(dt.timezone.utc).date().isoformat(),
        "nav": nav,
        "trailing_12m_yield": trailing,
        "distribution_rate": dist,
        "source": GLOBALX_DISTRIBUTIONS,
        "fetched_at": NOW,
    }

def attach_closes(rows, closes):
    out = []
    for row in rows:
        close = close_before(closes, row["ex_date"])
        item = dict(row)
        item["close"] = close
        item["pct"] = round(row["amount"] / close * 100, 4) if close else None
        out.append(item)
    return out

def summarize_dividends(rows, price, price_date, globalx, source):
    paid = [row for row in rows if row.get("amount") is not None]
    latest = paid[-1] if paid else None
    last12 = paid[-12:]
    ttm_total = round(sum(row["amount"] for row in last12), 4) if last12 else None
    annualized = round(latest["amount"] * 12, 4) if latest else None
    ttm_yield = round(ttm_total / price * 100, 2) if ttm_total is not None and price else None
    distribution_rate = round(annualized / price * 100, 2) if annualized is not None and price else None
    return {
        "generated_at": NOW,
        "ticker": "QYLD",
        "source": source,
        "price": price,
        "price_date": price_date,
        "latest": latest,
        "ttm_total": ttm_total,
        "ttm_yield": ttm_yield,
        "annualized_payout": annualized,
        "distribution_rate": distribution_rate,
        "globalx": globalx,
        "dividends": paid,
    }

def pull_qyld_dividends(price, price_date, closes):
    previous = load_json(os.path.join(MARKETS_DIR, "QYLD_dividends.json"), {})
    source = None
    rows = None
    try:
        rows = fetch_nasdaq_dividends()
        source = "nasdaq"
    except Exception as exc:
        print(f"nasdaq dividends failed: {exc}")
        try:
            rows = fetch_yahoo_dividends()
            source = "yahoo"
        except Exception as yahoo_exc:
            print(f"yahoo dividends failed: {yahoo_exc}")
    if not rows:
        rows = previous.get("dividends") or []
        source = previous.get("source") or "previous"
        if not rows:
            print("qyld dividends unavailable; leaving previous file untouched")
            return previous or None
    rows = attach_closes(rows, closes) if closes else rows
    globalx = previous.get("globalx")
    try:
        globalx = fetch_globalx_official()
    except Exception as exc:
        print(f"globalx official yields failed: {exc}")
    return summarize_dividends(rows, price, price_date, globalx, source)

def pull_markets():
    """QYLD and ES=F for the Markets tab only — not added to stats.json."""
    os.makedirs(MARKETS_DIR, exist_ok=True)
    payload = {"generated_at": NOW, "series": {}}
    previous = load_json(os.path.join(D, "markets.json"), {"series": {}})
    qyld_closes, qyld_price, qyld_price_date = {}, None, None
    for ticker in MARKET_TICKERS:
        slug = file_slug(ticker)
        try:
            tk = yf.Ticker(ticker)
            daily = tk.history(period="2y", interval="1d", auto_adjust=False)
            weekly = tk.history(period="max", interval="1wk", auto_adjust=False)
            if daily is None or daily.empty:
                raise RuntimeError("no daily history rows")
            daily = daily.dropna(subset=["Open", "High", "Low", "Close"])
            weekly = weekly.dropna(subset=["Open", "High", "Low", "Close"]) if weekly is not None and not weekly.empty else daily.iloc[0:0]
            try:
                info = tk.info or {}
            except Exception:
                info = {}
            last = daily.iloc[-1]
            daily_rows = markets_rows(daily)
            weekly_rows = markets_rows(weekly) if len(weekly) else []
            write_json(os.path.join(MARKETS_DIR, f"{slug}_daily.json"), daily_rows)
            write_json(os.path.join(MARKETS_DIR, f"{slug}_weekly.json"), weekly_rows)
            price = round(float(last["Close"]), 2)
            price_date = daily_rows[-1]["time"] if daily_rows else None
            item = {
                "ticker": ticker,
                "slug": slug,
                "name": info.get("shortName") or info.get("longName") or ticker,
                "price": price,
                "price_date": price_date,
            }
            if ticker == "QYLD":
                qyld_price, qyld_price_date = price, price_date
                try:
                    long_daily = tk.history(period="max", interval="1d", auto_adjust=False)
                    long_daily = long_daily.dropna(subset=["Close"]) if long_daily is not None else daily
                    qyld_closes = close_lookup(markets_rows(long_daily))
                except Exception as exc:
                    print(f"qyld long daily closes failed: {exc}")
                    qyld_closes = close_lookup(daily_rows)
            payload["series"][ticker] = item
        except Exception as exc:
            if ticker in previous.get("series", {}):
                payload["series"][ticker] = previous["series"][ticker]
            print(f"markets {ticker} failed: {exc}")
    dividends = None
    try:
        series = payload["series"].get("QYLD") or {}
        dividends = pull_qyld_dividends(qyld_price or series.get("price"), qyld_price_date or series.get("price_date"), qyld_closes)
        if dividends:
            write_json(os.path.join(MARKETS_DIR, "QYLD_dividends.json"), dividends)
            if "QYLD" in payload["series"]:
                payload["series"]["QYLD"].update({
                    "ttm_total": dividends.get("ttm_total"),
                    "ttm_yield": dividends.get("ttm_yield"),
                    "annualized_payout": dividends.get("annualized_payout"),
                    "distribution_rate": dividends.get("distribution_rate"),
                    "latest_dividend": dividends.get("latest"),
                    "globalx": dividends.get("globalx"),
                })
    except Exception as exc:
        print(f"qyld dividends summary failed: {exc}")
    return payload



def _adj_amount(row):
    if row.get("amount_adj") is not None:
        return row["amount_adj"]
    return row.get("amount")

def is_real_dividend_payer(rows, years=3):
    """True for current or historical payers; false for non-payers with only artifacts.

    A ticker is a payer if it has a real dividend in the last `years` years, any
    Nasdaq-confirmed dividend, or any payout of at least $0.01. A lone sub-cent
    Yahoo-only row does not count, so MNST/TTWO stay non-payers.
    """
    cutoff = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=365 * years)).isoformat()
    recent = False
    historical = False
    for row in rows or []:
        if not row.get("ex_date"):
            continue
        amount = _adj_amount(row)
        confirmed = row.get("source") == "nasdaq" or (amount is not None and amount >= 0.01)
        if not confirmed:
            continue
        historical = True
        if row["ex_date"] >= cutoff:
            recent = True
    return recent or historical

def drop_stale_nonpayer_micros(rows):
    """Drop Yahoo-only sub-$0.01 rows only for non-payers like MNST and TTWO.

    Real payers (including lapsed payers with earlier confirmed dividends)
    keep full split-adjusted history, including old payouts under $0.01/share.
    """
    if is_real_dividend_payer(rows):
        return list(rows or [])
    out = []
    for row in rows or []:
        amount = _adj_amount(row)
        if (
            amount is not None
            and amount < 0.01
            and row.get("source") != "nasdaq"
        ):
            continue
        out.append(row)
    return out

def attach_stock_dividend_closes(rows, closes, splits=None):
    """Yield % = split-adjusted amount / split-adjusted close before ex-date."""
    out = []
    for row in rows:
        close = close_before(closes, row["ex_date"])
        item = dict(row)
        item["close"] = close
        if item.get("amount_adj") is None and item.get("amount") is not None:
            item["amount_adj"] = split_adjust_amount(item["amount"], item["ex_date"], splits)
        adj = item.get("amount_adj")
        item["pct"] = round(adj / close * 100, 4) if close and adj is not None else None
        out.append(item)
    return out

def yahoo_rows_from_previous(previous):
    """Prior split-adjusted amounts only; never treat Nasdaq as-paid figures as adj."""
    out = []
    for row in (previous or {}).get("dividends") or []:
        adj = row.get("amount_adj")
        if adj is None and row.get("source") != "nasdaq":
            adj = row.get("amount")
        if row.get("ex_date") and adj is not None:
            out.append({
                "ex_date": row["ex_date"],
                "record_date": None,
                "payable_date": None,
                "declared_date": None,
                "amount": adj,
                "amount_adj": adj,
                "source": "yahoo",
            })
    return out

def pull_stock_dividends(ticker, force=False):
    """Daily Yahoo + Nasdaq dividend history for stock-page D markers. Soft-fail."""
    path = os.path.join(DIVIDENDS_DIR, f"{ticker}.json")
    previous = load_json(path, {})
    # Same once-a-day cadence as weekly history; Nasdaq is only hit for payers.
    if not force and os.path.exists(path) and time.time() - os.path.getmtime(path) < 20 * 60 * 60:
        return ticker, None, None
    try:
        yahoo = []
        try:
            yahoo = fetch_yahoo_dividends(ticker)
        except Exception as exc:
            print(f"yahoo dividends {ticker} failed: {exc}")
        have = {row["ex_date"] for row in yahoo}
        for row in yahoo_rows_from_previous(previous):
            if row["ex_date"] not in have:
                yahoo.append(row)
                have.add(row["ex_date"])
        nasdaq = []
        if yahoo:
            try:
                nasdaq = fetch_nasdaq_dividends(ticker, "stocks")
            except Exception as exc:
                print(f"nasdaq dividends {ticker} failed: {exc}")
        if not yahoo and not nasdaq:
            return ticker, {"generated_at": NOW, "ticker": ticker, "source": "yahoo", "dividends": []}, "no dividends"
        rows = drop_stale_nonpayer_micros(merge_dividend_rows(yahoo, nasdaq))
        try:
            tk = yf.Ticker(ticker.replace(".", "-"))
            h = tk.history(period="max", interval="1d", auto_adjust=False)
            h = h.dropna(subset=["Close"]) if h is not None and not h.empty else None
            closes = close_lookup(markets_rows(h)) if h is not None and len(h) else {}
        except Exception as exc:
            print(f"dividend closes {ticker} failed: {exc}")
            closes = {}
        splits = split_lookup(ticker)
        rows = attach_stock_dividend_closes(rows, closes, splits) if (closes or splits) else rows
        rows = drop_stale_nonpayer_micros(rows)
        source = "nasdaq" if nasdaq else "yahoo"
        return ticker, {"generated_at": NOW, "ticker": ticker, "source": source, "dividends": rows}, None
    except Exception as exc:
        if previous.get("dividends"):
            previous = {**previous, "dividends": drop_stale_nonpayer_micros(previous.get("dividends") or [])}
            return ticker, previous, str(exc)
        return ticker, None, str(exc)

def write_json(path, value):
    with open(path,"w",encoding="utf-8") as f: json.dump(value,f,indent=1,allow_nan=False); f.write("\n")

if __name__ == "__main__":
    # Tickers in data/watchlist.json are always included in the hourly refresh; no other file edits are needed.
    # Every page renders all stats.json rows (universe ∪ basket ∪ watchlist).
    tickers = sorted(set(UNIVERSE) | {b["ticker"] for b in BASKET["positions"]} | {s["ticker"] for s in WATCHLIST["stocks"]})
    intraday_tickers = sorted({b["ticker"] for b in BASKET["positions"]} | {s["ticker"] for s in WATCHLIST["stocks"]})
    intraday_jobs = [(ticker,interval,period) for ticker in intraday_tickers for interval,period in
                     (("1m","5d"),("5m","60d"),("1h","730d"))]
    # Markets tickers get compact intraday too, but are not added to stats.json / Map / Screener.
    intraday_jobs += [(ticker,interval,period) for ticker in MARKET_TICKERS for interval,period in
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
        path = os.path.join(INTRADAY,f"{file_slug(ticker)}_{interval}.json")
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
    # Stock-page dividend markers: daily Yahoo + Nasdaq (payers only, throttled). Failures must not fail the job.
    div_written = 0
    div_removed = 0
    try:
        os.makedirs(DIVIDENDS_DIR, exist_ok=True)
        with ThreadPoolExecutor(max_workers=2) as executor:
            div_results = list(executor.map(pull_stock_dividends, tickers))
        for ticker, payload, error in div_results:
            if error:
                print(f"dividends {ticker} failed: {error}")
            if payload is None:
                continue
            path = os.path.join(DIVIDENDS_DIR, f"{ticker}.json")
            div_rows = payload.get("dividends") or []
            if div_rows:
                write_json(path, payload)
                div_written += 1
            elif os.path.exists(path):
                os.remove(path)
                div_removed += 1
                print(f"dividends {ticker}: no confirmed rows, removed {path}")
    except Exception as exc:
        print(f"stock dividends refresh failed: {exc}")
    print(f"refreshed {len(rows)} tickers at {NOW}; failures: {failures}; long history updates: {len(long_updates)}; intraday files written: {len(intraday_updates)}; market series: {list(markets.get('series', {}))}; dividend files: {div_written}; removed: {div_removed}")
