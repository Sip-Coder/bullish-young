let ticker = new URLSearchParams(location.search).get("t")?.toUpperCase(),
  chart,
  mainSeries,
  s50,
  s200,
  volume,
  brooksEma,
  data = [],
  lines = [],
  lineMode = false,
  type = "candles",
  rangeDays = 180,
  brooksResult = null;
const brooksOn = () => document.querySelector("#brooks").checked;
const syncBrooksVisibility = () => {
  document.querySelector("#brooks-layers").hidden = !brooksOn();
  document.querySelector("#brooks-badge").hidden = !brooksOn();
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
    `<div><h1>${ticker} · ${s.name || ""}</h1><div class="muted">${s.sector || "—"} · ${s.industry || "—"}</div></div><span class="stock-price">${BY.money(s.price)}</span><span class="${s.change >= 0 ? "up" : "down"}">${BY.change(s.change)} (${BY.pct(s.chg_pct)})</span>${basket ? `<span class="mobile-break"></span><span class="pill basket-pill ${basket.status.includes("Above") ? "green" : basket.status.includes("10%") ? "amber" : ""}">${BY.money(basket.target_usd)} · ${basket.status}</span>` : ""}`;
  data = await fetch(`data/history/${ticker}.json`).then((r) => r.json());
  document.querySelector("#brooks").checked =
    new URLSearchParams(location.search).get("brooks") === "1";
  syncBrooksVisibility();
  makeChart();
  stats(s);
});
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
  if (!brooksOn()) {
    brooksResult = null;
    mainSeries.setMarkers([]);
    setPriceData();
    setRange(rangeDays);
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
  setRange(rangeDays);
}
function setPriceData() {
  let bars =
    document.querySelector("#bar-types").checked && brooksOn()
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
  volume.setData(
    data.map((x) => ({
      time: x.time,
      value: x.volume,
      color: x.close >= x.open ? "#0a8a3a66" : "#d0282e66",
    })),
  );
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
  s50.setData(sma(50));
  s200.setData(sma(200));
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
function setRange(days) {
  rangeDays = days;
  let to = data.at(-1).time,
    from = data[Math.max(0, data.length - days)].time;
  chart.timeScale().setVisibleRange({ from, to });
  document
    .querySelectorAll("[data-days]")
    .forEach((b) => b.classList.toggle("active", +b.dataset.days === days));
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
  setRange(rangeDays);
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
