const watchlistCols = [
  ["ticker", "Ticker"], ["name", "Name"],
  ["signal", "Signal"], ["cross", "Cross"], ["brooksRef", "Brooks (ref)"],
  ["price", "Price"],
  ["chg_pct", "Day %"], ["vs50", "% vs 50D"], ["vs200", "% vs 200D"],
  ["range52", "52W range"], ["pe", "P/E"], ["forward_pe", "Fwd P/E"],
  ["roe", "ROE"], ["debt_equity_ratio", "Debt/Eq"], ["levered_fcf", "FCF"],
  ["market_cap", "Mkt Cap"], ["spark", "Trend"], ["unstar", ""]
];
let watchlistSort = "ticker", watchlistDir = 1, histories = new Map(), weeklies = new Map();

let crossFilter = "all";

shell("watchlist").then(async () => {
  const wrap = document.querySelector("#cross-filter-wrap");
  if (wrap && window.BYCross) {
    wrap.innerHTML = BYCross.filterControl("cross-filter");
    document.querySelector("#cross-filter").onchange = (event) => {
      crossFilter = event.target.value;
      drawWatchlist();
    };
  }
  document.querySelector("#watchlist-heads").innerHTML = watchlistCols.map(([key, label]) =>
    `<th class="${["ticker", "name", "signal", "cross", "brooksRef"].includes(key) ? "text" : ""}${["spark", "unstar"].includes(key) ? " no-sort" : ""}"${["spark", "unstar"].includes(key) ? "" : ` data-key="${key}"`}>${label}</th>`
  ).join("");
  document.querySelectorAll("#watchlist-heads [data-key]").forEach((th) => th.onclick = () => {
    watchlistDir = watchlistSort === th.dataset.key ? -watchlistDir : 1;
    watchlistSort = th.dataset.key;
    drawWatchlist();
  });
  await Promise.all(starredTickers().map(async (ticker) => {
    try {
      const response = await fetch(`data/history/${ticker}.json`);
      if (response.ok) histories.set(ticker, await response.json());
    } catch (_) { /* A missing history is expected for newly added tickers. */ }
    try {
      const response = await fetch(`data/history_long/${ticker}.json`);
      if (response.ok) weeklies.set(ticker, await response.json());
    } catch (_) { /* Weekly history is optional for the sell rule. */ }
  }));
  drawWatchlist();
  document.addEventListener("by:stars-changed", () => {
    const missing = starredTickers().filter((ticker) => !histories.has(ticker));
    if (!missing.length) { drawWatchlist(); return; }
    Promise.all(missing.map(async (ticker) => {
      try {
        const response = await fetch(`data/history/${ticker}.json`);
        if (response.ok) histories.set(ticker, await response.json());
      } catch (_) { /* Newly starred tickers may not have history yet. */ }
      try {
        const response = await fetch(`data/history_long/${ticker}.json`);
        if (response.ok) weeklies.set(ticker, await response.json());
      } catch (_) { /* Weekly history is optional for the sell rule. */ }
    })).then(drawWatchlist);
  });
});

function starredTickers() {
  const defaults = (BY.watchlist?.stocks || []).map((x) => x.ticker.toUpperCase());
  const additions = BY.starChanges().added.map((x) => x.toUpperCase());
  return [...new Set([...defaults, ...additions])].filter((ticker) => BY.isStarred(ticker));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeSignal(ticker, stock) {
  const daily = histories.get(ticker) || [];
  const weekly = weeklies.get(ticker) || [];
  const date = daily.at(-1)?.time || "";
  const fcf = stock.levered_fcf;
  const fcfNeg = fcf != null && Number.isFinite(+fcf) && +fcf < 0;
  const sellParts = [];

  if (daily.length >= 200 && weekly.length >= 2) {
    const ma200 = average(daily.slice(-200).map((bar) => bar.close));
    const first = weekly.at(-2), last = weekly.at(-1);
    if (first.close < ma200 && last.close < ma200) {
      sellParts.push(`Last two weekly closes ${BY.money(first.close)} and ${BY.money(last.close)} are both below the 200-day SMA ${BY.money(ma200)}`);
    }
  }
  if (fcfNeg) sellParts.push(`Free cash flow ${BY.big(fcf)}`);
  if (sellParts.length) {
    return { kind: "SELL / TRIM", className: "signal-sell", text: `${sellParts.join(". ")} · ${date}`, date };
  }
  if (daily.length < 200) {
    return { kind: "Not enough history", className: "signal-hold", text: `${daily.length} daily bars (need 200)${date ? ` · ${date}` : ""}`, date };
  }

  const closes = daily.map((bar) => bar.close);
  const close = closes.at(-1);
  const ma50 = average(closes.slice(-50));
  const ma200 = average(closes.slice(-200));
  const high50 = Math.max(...closes.slice(-50));
  const dipPct = high50 ? (high50 - close) / high50 * 100 : 0;
  const trendBuy = close > ma50 && ma50 > ma200;
  const dipBuy = dipPct >= 10 && close > ma200;
  if (trendBuy) {
    let text = `Close ${BY.money(close)} > 50-day SMA ${BY.money(ma50)} and 50-day SMA > 200-day SMA ${BY.money(ma200)}`;
    if (dipBuy) text += `. Also ${dipPct.toFixed(1)}% below the 50-day high ${BY.money(high50)}`;
    return { kind: "BUY", className: "signal-buy", text: `${text} · ${date}`, date };
  }
  if (dipBuy) {
    return { kind: "Dip buy", className: "signal-buy", text: `Close ${BY.money(close)} is ${dipPct.toFixed(1)}% below the 50-day high ${BY.money(high50)}, close > 200-day SMA ${BY.money(ma200)} · ${date}`, date };
  }
  return { kind: "HOLD", className: "signal-hold", text: `Close ${BY.money(close)} vs 50-day SMA ${BY.money(ma50)} and 200-day SMA ${BY.money(ma200)} · ${date}`, date };
}

function brooksRef(ticker) {
  const daily = histories.get(ticker);
  if (!daily?.length || typeof BrooksPA === "undefined") return "—";
  const result = BrooksPA.analyze(daily);
  const marker = result.markers?.at(-1);
  if (marker) {
    const label = (marker.meta?.setup || marker.text || "").trim();
    const time = marker.time ? ` · ${marker.time}` : "";
    return label ? `${label}${time}` : "—";
  }
  const alwaysIn = result.state?.alwaysIn;
  return alwaysIn && alwaysIn !== "unclear" ? `Always In ${alwaysIn}` : "—";
}

function rows() {
  const names = new Map((BY.watchlist?.stocks || []).map((x) => [x.ticker.toUpperCase(), x.name]));
  return starredTickers().map((ticker) => {
    const s = BY.stock(ticker) || { ticker, name: names.get(ticker) || ticker };
    const vs50 = s.price != null && s.ma50 ? (s.price / s.ma50 - 1) * 100 : null;
    const vs200 = s.price != null && s.ma200 ? (s.price / s.ma200 - 1) * 100 : null;
    const span = s.high_52w != null && s.low_52w != null ? s.high_52w - s.low_52w : 0;
    const range52 = span > 0 && s.price != null ? Math.max(0, Math.min(100, (s.price - s.low_52w) / span * 100)) : null;
    const computed = computeSignal(ticker, s);
    const cross = s.cross || null;
    return {
      ...s, ticker, name: names.get(ticker) || s.name || ticker, vs50, vs200, range52,
      signal: computed.kind, signalDetail: computed, cross, crossLabel: window.BYCross ? BYCross.label(cross).text : "",
      brooksRef: brooksRef(ticker)
    };
  });
}

function drawWatchlist() {
  const list = rows().filter((s) => !window.BYCross || BYCross.matches(s.cross, crossFilter)).sort((a, b) => {
    const x = watchlistSort === "cross" ? a.crossLabel : a[watchlistSort], y = watchlistSort === "cross" ? b.crossLabel : b[watchlistSort];
    if (x == null && y == null) return a.ticker.localeCompare(b.ticker);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * watchlistDir;
  });
  const empty = !list.length ? `<tr><td class="text" colspan="${watchlistCols.length}">No stocks match this cross filter.</td></tr>` : "";
  document.querySelector(".watchlist-table tbody").innerHTML = (list.map((s) => `<tr>
    <td><a href="stock.html?t=${encodeURIComponent(s.ticker)}">${s.ticker}</a></td>
    <td class="text">${s.name || "—"}</td>
    <td class="text signal ${s.signalDetail.className}" data-sort="${s.signal}"><span class="signal-kind">${s.signal}</span>${window.BYCross ? BYCross.tagsHtml(s.cross, s.signal) : ""}<span class="signal-detail">${s.signalDetail.text}</span></td>
    <td class="text cross-col">${window.BYCross ? BYCross.html(s.cross) : "—"}</td>
    <td class="text brooks-ref">${s.brooksRef}</td>
    <td>${BY.money(s.price)}</td>
    <td class="${valueClass(s.chg_pct)}">${BY.pct(s.chg_pct)}</td>
    <td class="${valueClass(s.vs50)}">${BY.pct(s.vs50)}</td>
    <td class="${valueClass(s.vs200)}">${BY.pct(s.vs200)}</td>
    <td>${rangeBar(s.range52)}</td><td>${BY.fmt(s.pe)}</td><td>${BY.fmt(s.forward_pe)}</td>
    <td>${s.roe == null ? "—" : `${BY.fmt(s.roe * 100)}%`}</td>
    <td>${BY.fmt(s.debt_equity_ratio)}</td><td>${BY.big(s.levered_fcf)}</td><td>${BY.big(s.market_cap)}</td>
    <td>${sparkline(histories.get(s.ticker))}</td><td>${BY.starButton(s.ticker)}</td>
  </tr>`).join("") || empty);
}

function valueClass(value) { return value == null ? "" : value >= 0 ? "up" : "down"; }
function rangeBar(value) {
  if (value == null) return "—";
  return `<span class="range52" title="${BY.fmt(value, 0)}% of 52-week range"><i style="width:${value}%"></i></span><span class="range52-label">${BY.fmt(value, 0)}%</span>`;
}
function sparkline(history) {
  const values = (history || []).map((x) => +x.close).filter(Number.isFinite).slice(-60);
  if (values.length < 2) return "—";
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const points = values.map((v, i) => `${(i / (values.length - 1) * 76 + 2).toFixed(1)},${(20 - (v - lo) / span * 16).toFixed(1)}`).join(" ");
  return `<svg class="sparkline" viewBox="0 0 80 24" aria-label="60-session price trend" role="img"><polyline points="${points}" /></svg>`;
}
