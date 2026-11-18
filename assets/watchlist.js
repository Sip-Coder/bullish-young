const watchlistCols = [
  ["ticker", "Ticker"], ["name", "Name"], ["price", "Price"],
  ["chg_pct", "Day %"], ["vs50", "% vs 50D"], ["vs200", "% vs 200D"],
  ["range52", "52W range"], ["pe", "P/E"], ["forward_pe", "Fwd P/E"],
  ["roe", "ROE"], ["debt_equity_ratio", "Debt/Eq"], ["levered_fcf", "FCF"],
  ["market_cap", "Mkt Cap"], ["spark", "Trend"], ["unstar", ""]
];
let watchlistSort = "ticker", watchlistDir = 1, histories = new Map();

shell("watchlist").then(async () => {
  document.querySelector("#watchlist-heads").innerHTML = watchlistCols.map(([key, label]) =>
    `<th class="${["ticker", "name"].includes(key) ? "text" : ""}${["spark", "unstar"].includes(key) ? " no-sort" : ""}"${["spark", "unstar"].includes(key) ? "" : ` data-key="${key}"`}>${label}</th>`
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
  }));
  drawWatchlist();
  document.addEventListener("by:stars-changed", drawWatchlist);
});

function starredTickers() {
  const defaults = (BY.watchlist?.stocks || []).map((x) => x.ticker.toUpperCase());
  const additions = BY.starChanges().added.map((x) => x.toUpperCase());
  return [...new Set([...defaults, ...additions])].filter((ticker) => BY.isStarred(ticker));
}

function rows() {
  const names = new Map((BY.watchlist?.stocks || []).map((x) => [x.ticker.toUpperCase(), x.name]));
  return starredTickers().map((ticker) => {
    const s = BY.stock(ticker) || { ticker, name: names.get(ticker) || ticker };
    const vs50 = s.price != null && s.ma50 ? (s.price / s.ma50 - 1) * 100 : null;
    const vs200 = s.price != null && s.ma200 ? (s.price / s.ma200 - 1) * 100 : null;
    const span = s.high_52w != null && s.low_52w != null ? s.high_52w - s.low_52w : 0;
    const range52 = span > 0 && s.price != null ? Math.max(0, Math.min(100, (s.price - s.low_52w) / span * 100)) : null;
    return { ...s, ticker, name: names.get(ticker) || s.name || ticker, vs50, vs200, range52 };
  });
}

function drawWatchlist() {
  const list = rows().sort((a, b) => {
    const x = a[watchlistSort], y = b[watchlistSort];
    if (x == null && y == null) return a.ticker.localeCompare(b.ticker);
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * watchlistDir;
  });
  document.querySelector(".watchlist-table tbody").innerHTML = list.map((s) => `<tr>
    <td><a href="stock.html?t=${encodeURIComponent(s.ticker)}">${s.ticker}</a></td>
    <td class="text">${s.name || "—"}</td><td>${BY.money(s.price)}</td>
    <td class="${valueClass(s.chg_pct)}">${BY.pct(s.chg_pct)}</td>
    <td class="${valueClass(s.vs50)}">${BY.pct(s.vs50)}</td>
    <td class="${valueClass(s.vs200)}">${BY.pct(s.vs200)}</td>
    <td>${rangeBar(s.range52)}</td><td>${BY.fmt(s.pe)}</td><td>${BY.fmt(s.forward_pe)}</td>
    <td>${s.roe == null ? "—" : `${BY.fmt(s.roe * 100)}%`}</td>
    <td>${BY.fmt(s.debt_equity_ratio)}</td><td>${BY.big(s.levered_fcf)}</td><td>${BY.big(s.market_cap)}</td>
    <td>${sparkline(histories.get(s.ticker))}</td><td>${BY.starButton(s.ticker)}</td>
  </tr>`).join("");
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
