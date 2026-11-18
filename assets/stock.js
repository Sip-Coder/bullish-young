let ticker = new URLSearchParams(location.search).get("t")?.toUpperCase(),
  chart,
  mainSeries,
  data = [];
shell("").then(async () => {
  let s = BY.stock(ticker);
  if (!s) {
    document.querySelector("#stock-main").innerHTML = "<h1>Not found</h1>";
    return;
  }
  document.title = `Bullish Young — ${ticker}`;
  let basket = BY.basket?.positions?.find((x) => x.ticker === ticker);
  document.querySelector(".stock-head").innerHTML =
    `<div><h1>${ticker} · ${s.name || ""}</h1><div class="muted">${s.sector || "—"} · ${s.industry || "—"}</div></div>${BY.starButton(ticker)}<span class="stock-price">${BY.money(s.price)}</span><span class="${s.change >= 0 ? "up" : "down"}">${BY.change(s.change)} (${BY.pct(s.chg_pct)})</span>${basket ? `<span class="mobile-break"></span><span class="pill basket-pill ${basket.status.includes("Above") ? "green" : basket.status.includes("10%") ? "amber" : ""}">${BY.money(basket.target_usd)} · ${basket.status}</span>` : ""}`;
  let dailyData = await fetch(`data/history/${ticker}.json`).then((r) => r.json());
  let longData = await fetch(`data/history_long/${ticker}.json`)
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null);
  let [watchlist, targets] = await Promise.all([
    fetch("data/watchlist.json").then((r) => r.json()).catch(() => ({ stocks: [] })),
    fetch("data/basket_targets.json").then((r) => r.json()).catch(() => ({ positions: [] })),
  ]);
  let intradayEligible = [...watchlist.stocks, ...targets.positions].some((x) => x.ticker === ticker);
  let intradayData = {};
  if (intradayEligible) {
    await Promise.all(["1m", "5m", "1h"].map(async (interval) => {
      let payload = await fetch(`data/intraday/${ticker}_${interval}.json`)
        .then((r) => r.ok ? r.json() : null).catch(() => null);
      if (payload?.t?.length) intradayData[interval] = BYChart.unpackIntraday(payload);
    }));
  }
  document.querySelector("#stock-main").dataset.intradayEligible = intradayEligible ? "1" : "0";
  document.querySelector("#brooks").checked =
    new URLSearchParams(location.search).get("brooks") === "1";
  const mounted = BYChart.mount(document.querySelector("#stock-main"), {
    ticker,
    daily: dailyData,
    weekly: longData,
    intraday: intradayData,
    defaultRange: "6M",
    defaultInterval: "daily",
    intradayEligible,
  });
  chart = mounted.chart;
  mainSeries = mounted.mainSeries;
  data = mounted.data;
  tradeCalc(s);
  stats(s);
});

function tradeCalc(s) {
  let el = document.querySelector("#trade-calc");
  el.innerHTML = `
    <h2>Trade Calculator</h2>
    <div class="trade-calc-card">
      <div class="trade-inputs">
        <label>Buy price<input id="trade-buy" type="number" inputmode="decimal" min="0" step="0.01" value="${s.price != null && Number.isFinite(+s.price) ? +s.price : ""}"></label>
        <label>Shares<input id="trade-shares" type="number" inputmode="decimal" min="0" step="any" value="100"></label>
        <label>Dollars<input id="trade-dollars" type="number" inputmode="decimal" min="0" step="0.01"></label>
        <label>Sell target price<input id="trade-sell" type="number" inputmode="decimal" min="0" step="0.01" placeholder="—"></label>
        <label>Sell range low <span class="muted">(optional)</span><input id="trade-low" type="number" inputmode="decimal" min="0" step="0.01" placeholder="—"></label>
        <label>Sell range high <span class="muted">(optional)</span><input id="trade-high" type="number" inputmode="decimal" min="0" step="0.01" placeholder="—"></label>
      </div>
      <div class="trade-tax">
        <label>After tax (held over 1 year) <span class="muted">— estimate</span><span class="trade-rate"><input id="trade-tax-rate" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="15">%</span></label>
        <span class="muted">Nevada has no state income tax.</span>
      </div>
      <div id="trade-results" class="trade-results" aria-live="polite"></div>
      <div class="trade-note muted">Before fees and taxes. After-tax amounts are estimates.</div>
    </div>`;

  let buy = el.querySelector("#trade-buy"),
    shares = el.querySelector("#trade-shares"),
    dollars = el.querySelector("#trade-dollars"),
    sell = el.querySelector("#trade-sell"),
    low = el.querySelector("#trade-low"),
    high = el.querySelector("#trade-high"),
    rate = el.querySelector("#trade-tax-rate"),
    results = el.querySelector("#trade-results"),
    number = (input) => input.value.trim() === "" ? null : +input.value,
    valid = (v) => Number.isFinite(v) && v >= 0,
    shareText = (v) => Number.isInteger(v) ? String(v) : String(+v.toFixed(4)),
    tone = (v) => v > 0 ? "up" : v < 0 ? "down" : "muted";

  function scenario(label, price, cost, count, taxRate, range = false) {
    if (!valid(price)) return "";
    let value = price * count,
      profit = value - cost,
      tax = profit > 0 && valid(taxRate) ? profit * taxRate / 100 : 0,
      afterTax = profit - tax;
    if (range) {
      return `<div class="trade-range-result"><span>${label}</span><span class="${tone(profit)}">${BY.money(profit)}</span>${profit > 0 && valid(taxRate) ? `<small class="${tone(afterTax)}">${BY.money(afterTax)} after tax estimate</small>` : ""}</div>`;
    }
    return `
      <div><span>Sell value</span><strong>${BY.money(value)}</strong></div>
      <div><span>Profit $</span><strong class="${tone(profit)}">${BY.money(profit)}</strong></div>
      <div><span>Profit %</span><strong class="${tone(profit)}">${BY.pct(cost > 0 ? profit / cost * 100 : null)}</strong></div>
      <div><span>Per-share gain</span><strong class="${tone(price - number(buy))}">${BY.money(price - number(buy))}</strong></div>
      ${profit > 0 && valid(taxRate) ? `<div class="trade-after-tax"><span>After-tax estimate</span><strong class="up">${BY.money(tax)} estimated tax · ${BY.money(afterTax)} profit after estimated tax</strong></div>` : ""}`;
  }
  function update() {
    let buyPrice = number(buy), count = number(shares), target = number(sell), taxRate = number(rate);
    if (!valid(buyPrice) || !valid(count)) {
      results.innerHTML = `<div><span>Total cost</span><strong>—</strong></div>`;
      return;
    }
    let cost = buyPrice * count;
    results.innerHTML = `<div><span>Total cost</span><strong>${BY.money(cost)}</strong></div>${scenario("", target, cost, count, taxRate)}${scenario("Profit at range low", number(low), cost, count, taxRate, true)}${scenario("Profit at range high", number(high), cost, count, taxRate, true)}`;
  }
  function syncFromShares() {
    let buyPrice = number(buy), count = number(shares);
    dollars.value = valid(buyPrice) && valid(count) ? (buyPrice * count).toFixed(2) : "";
    update();
  }
  function syncFromDollars() {
    let buyPrice = number(buy), amount = number(dollars);
    shares.value = valid(buyPrice) && buyPrice > 0 && valid(amount) ? shareText(amount / buyPrice) : "";
    update();
  }
  buy.addEventListener("input", syncFromShares);
  shares.addEventListener("input", syncFromShares);
  dollars.addEventListener("input", syncFromDollars);
  [sell, low, high, rate].forEach((input) => input.addEventListener("input", update));
  buy.addEventListener("change", syncFromShares);
  shares.addEventListener("change", syncFromShares);
  dollars.addEventListener("change", syncFromDollars);
  [sell, low, high, rate].forEach((input) => input.addEventListener("change", update));
  syncFromShares();
}function stats(s) {
  let valuation = [
      ["Market Cap", BY.big(s.market_cap)],
      ["Enterprise Value", BY.big(s.enterprise_value)],
      ["Trailing P/E", BY.fmt(s.pe)],
      ["Forward P/E", BY.fmt(s.forward_pe)],
      ["PEG Ratio", BY.fmt(s.peg)],
      ["Price/Sales", BY.fmt(s.ps)],
      ["Price/Book", BY.fmt(s.pb)],
      ["EV/Revenue", BY.fmt(s.ev_revenue)],
      ["EV/EBITDA", BY.fmt(s.ev_ebitda)],
    ],
    financial = [
      [
        "Profit Margin",
        BY.pct(s.profit_margin == null ? null : s.profit_margin * 100),
      ],
      ["Return on Assets", BY.pct(s.roa == null ? null : s.roa * 100)],
      ["Return on Equity", BY.pct(s.roe == null ? null : s.roe * 100)],
      ["Revenue", BY.big(s.revenue)],
      ["Net Income", BY.big(s.net_income)],
      ["Diluted EPS", BY.fmt(s.eps)],
      ["Total Cash", BY.big(s.total_cash)],
      [
        "Total Debt/Equity",
        `${BY.fmt(s.debt_equity_ratio)} <span class="muted">(${BY.fmt(s.debt_equity_pct)}%)</span>`,
      ],
      ["Levered Free Cash Flow", BY.big(s.levered_fcf)],
    ],
    trading = [
      ["52W High", BY.money(s.high_52w)],
      ["52W Low", BY.money(s.low_52w)],
      ["50D Avg", BY.money(s.ma50)],
      ["200D Avg", BY.money(s.ma200)],
    ];
  let block = (title, a) =>
    `<div><h2>${title}</h2>${a.map((x) => `<div class="stat-row"><span>${x[0]}</span><span>${x[1]}</span></div>`).join("")}</div>`;
  document.querySelector("#statistics").innerHTML =
    `<h2>Statistics</h2><div class="stats-grid">${block("Valuation Measures", valuation)}${block("Financial Highlights", financial)}</div>${block("Trading", trading)}<div class="source-line">As of ${BY.time(BY.stats.generated_at || s.as_of)} · <a href="https://finance.yahoo.com/quote/${ticker}/key-statistics/">Source: Yahoo Finance key statistics</a> · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&amp;CIK=${ticker}&amp;type=10-K">SEC filings (EDGAR)</a></div>`;
}
