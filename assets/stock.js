let ticker = new URLSearchParams(location.search).get("t")?.toUpperCase(),
  chart,
  mainSeries,
  s50,
  s200,
  volume,
  brooksEma,
  dailyData = [],
  longData = null,
  data = [],
  lines = [],
  lineMode = false,
  type = "candles",
  rangeDays = 180,
  brooksResult = null;
const brooksOn = () => document.querySelector("#brooks").checked;
const syncBrooksVisibility = () => {
  let visible = brooksOn() && !isLongRange();
  document.querySelector("#brooks-layers").hidden = !visible;
  document.querySelector("#brooks-badge").hidden = !visible;
};
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
  dailyData = await fetch(`data/history/${ticker}.json`).then((r) => r.json());
  longData = await fetch(`data/history_long/${ticker}.json`)
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null);
  data = dailyData;
  document.querySelector("#brooks").checked =
    new URLSearchParams(location.search).get("brooks") === "1";
  syncBrooksVisibility();
  makeChart();
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
}
function sma(n) {
  return data
    .map((x, i) =>
      i < n - 1
        ? null
        : {
            time: x.time,
            value:
              data.slice(i - n + 1, i + 1).reduce((a, b) => a + b.close, 0) / n,
          },
    )
    .filter(Boolean);
}
function coloredBars() {
  return data.map((b) => {
    let range = b.high - b.low || 1e-9,
      ratio = Math.abs(b.close - b.open) / range,
      color =
        ratio <= 0.25
          ? "#7c858e"
          : b.close > b.open && ratio >= 0.5
            ? "#0a8a3a"
            : b.close < b.open && ratio >= 0.5
              ? "#d0282e"
              : b.close >= b.open
                ? "#75b98c"
                : "#df8589";
    return { ...b, color, wickColor: color, borderColor: color };
  });
}
function insideOutsideMarkers() {
  let out = [],
    run = 0;
  for (let i = 1; i < data.length; i++) {
    let b = data[i],
      p = data[i - 1],
      inside = b.high <= p.high && b.low >= p.low,
      outside = b.high > p.high && b.low < p.low;
    if (inside) {
      run++;
      out.push({
        time: b.time,
        position: "aboveBar",
        color: "#7c858e",
        shape: "square",
        text: run === 1 ? "i" : run === 2 ? "ii" : "iii",
      });
    } else {
      run = 0;
      if (outside)
        out.push({
          time: b.time,
          position: "aboveBar",
          color: "#7c858e",
          shape: "square",
          text: "o",
        });
    }
  }
  return out;
}
function stripMarker(m) {
  let { meta, ...marker } = m;
  return marker;
}
function timeKey(t) {
  return typeof t === "string"
    ? t
    : t && `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
}
function applyBrooks() {
  syncBrooksVisibility();
  if (brooksEma) {
    chart.removeSeries(brooksEma);
    brooksEma = null;
  }
  if (!brooksOn() || isLongRange()) {
    brooksResult = null;
    mainSeries.setMarkers([]);
    setPriceData();
    return;
  }
  brooksResult = window.BrooksPA.analyze(data);
  brooksEma = chart.addLineSeries({
    color: "#e8751a",
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    title: "20 EMA",
  });
  brooksEma.setData(brooksResult.ema20);
  let state = brooksResult.state.alwaysIn,
    badge = document.querySelector("#brooks-badge");
  badge.textContent =
    state === "long"
      ? "Always in long"
      : state === "short"
        ? "Always in short"
        : "Trading range";
  badge.className = `brooks-badge ${state}`;
  setPriceData();
  applyMarkers();
}
function setPriceData() {
  let bars =
    document.querySelector("#bar-types").checked && brooksOn() && !isLongRange()
      ? coloredBars()
      : data;
  mainSeries.setData(
    type === "line"
      ? data.map((x) => ({ time: x.time, value: x.close }))
      : bars,
  );
}
function applyMarkers() {
  if (!mainSeries) return;
  let markers = brooksOn() ? brooksResult.markers.map(stripMarker) : [];
  if (brooksOn() && document.querySelector("#inside-outside").checked)
    markers = markers.concat(insideOutsideMarkers());
  markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  mainSeries.setMarkers(markers);
}
function makeChart() {
  let el = document.querySelector("#chart");
  chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: "#fff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eef0f2" }, horzLines: { color: "#eef0f2" } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { borderColor: "#ccd1d7" },
  });
  volume = chart.addHistogramSeries({
    priceFormat: { type: "volume" },
    priceScaleId: "volume",
  });
  chart
    .priceScale("volume")
    .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  s50 = chart.addLineSeries({
    color: "#e39116",
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  s200 = chart.addLineSeries({
    color: "#366dc9",
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
  });
  setSupportingData();
  setType("candles");
  setRange(180);
  new ResizeObserver(() =>
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }),
  ).observe(el);
  chart.subscribeCrosshairMove((p) => {
    let d = p.seriesData.get(mainSeries),
      base = d
        ? d.open != null
          ? `O ${BY.fmt(d.open)}  H ${BY.fmt(d.high)}  L ${BY.fmt(d.low)}  C ${BY.fmt(d.close)}`
          : `Close ${BY.fmt(d.value)}`
        : "",
      m = brooksResult?.markers.find(
        (x) => timeKey(x.time) === timeKey(p.time) && x.meta,
      );
    document.querySelector(".ohlc").textContent = m
      ? `${base}  ·  ${m.meta.setup} · ${m.meta.strong ? "strong" : "weak"} · ${m.meta.emaTest ? "EMA test" : "no EMA test"} · entry ${BY.fmt(m.meta.entry)} stop ${BY.fmt(m.meta.stop)}`
      : base;
  });
  el.addEventListener("click", (e) => {
    if (!lineMode) return;
    let price = mainSeries.coordinateToPrice(e.offsetY);
    if (price != null)
      lines.push(
        mainSeries.createPriceLine({
          price,
          color: "#6b3fad",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "H",
        }),
      );
  });
  document
    .querySelectorAll("[data-type]")
    .forEach((b) => (b.onclick = () => setType(b.dataset.type)));
  document.querySelectorAll("[data-days]").forEach(
    (b) =>
      (b.onclick = () => setRange(+b.dataset.days)),
  );
  document.querySelectorAll("[data-years]").forEach(
    (b) => (b.onclick = () => setRange(`${b.dataset.years}y`)),
  );
  document.querySelector("[data-max]").onclick = () => setRange("max");
  document.querySelector("#log-scale").onclick = toggleLogScale;
  sma50.onclick = () => toggle(sma50, s50);
  sma200.onclick = () => toggle(sma200, s200);
  hline.onclick = () => {
    lineMode = !lineMode;
    hline.classList.toggle("active", lineMode);
  };
  document.querySelector("#clear-lines").onclick = () => {
    lines.forEach((x) => mainSeries.removePriceLine(x));
    lines = [];
  };
  document.querySelector("#brooks").onchange = applyBrooks;
  document.querySelector("#bar-types").onchange = setPriceData;
  document.querySelector("#inside-outside").onchange = applyMarkers;
}
function isLongRange(value = rangeDays) {
  return typeof value === "string";
}
function setSupportingData() {
  s50.setData(sma(50));
  s200.setData(sma(200));
  volume.setData(data.map((x) => ({
    time: x.time,
    value: x.volume,
    color: x.close >= x.open ? "#0a8a3a66" : "#d0282e66",
  })));
}
function setLogScale(on) {
  chart.applyOptions({
    rightPriceScale: {
      mode: on ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal,
    },
  });
  let button = document.querySelector("#log-scale");
  button.classList.toggle("active", on);
  button.setAttribute("aria-pressed", String(on));
}
function toggleLogScale() {
  setLogScale(!document.querySelector("#log-scale").classList.contains("active"));
}
function setRange(days, applyLogDefault = true) {
  let wasLong = isLongRange();
  rangeDays = days;
  let nextData = isLongRange() && longData?.length ? longData : dailyData;
  if (data !== nextData) {
    data = nextData;
    setSupportingData();
    applyBrooks();
  } else if (wasLong !== isLongRange()) {
    applyBrooks();
  }
  if (!data.length) return;
  let to = data.at(-1).time, from;
  if (days === "max") {
    from = data[0].time;
  } else if (isLongRange()) {
    let date = new Date(`${to}T00:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() - parseInt(days, 10));
    from = date.toISOString().slice(0, 10);
    if (from < data[0].time) from = data[0].time;
  } else {
    from = data[Math.max(0, data.length - days)].time;
  }
  chart.timeScale().setVisibleRange({ from, to });
  document
    .querySelectorAll("[data-days]")
    .forEach((b) => b.classList.toggle("active", +b.dataset.days === days));
  document
    .querySelectorAll("[data-years]")
    .forEach((b) => b.classList.toggle("active", `${b.dataset.years}y` === days));
  document.querySelector("[data-max]").classList.toggle("active", days === "max");
  if (applyLogDefault) setLogScale(isLongRange());
}
function setType(t) {
  if (mainSeries) chart.removeSeries(mainSeries);
  type = t;
  mainSeries =
    t === "line"
      ? chart.addLineSeries({ color: "#1261a0", lineWidth: 2 })
      : t === "bars"
        ? chart.addBarSeries({ upColor: "#0a8a3a", downColor: "#d0282e" })
        : chart.addCandlestickSeries({
            upColor: "#0a8a3a",
            downColor: "#d0282e",
            wickUpColor: "#0a8a3a",
            wickDownColor: "#d0282e",
            borderVisible: false,
          });
  setPriceData();
  document
    .querySelectorAll("[data-type]")
    .forEach((b) => b.classList.toggle("active", b.dataset.type === t));
  lines = [];
  applyBrooks();
  setRange(rangeDays, false);
}
function toggle(btn, series) {
  let on = !btn.classList.contains("active");
  btn.classList.toggle("active", on);
  series.applyOptions({ visible: on });
}
function stats(s) {
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
