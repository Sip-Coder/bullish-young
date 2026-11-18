const longRanges = ["2Y", "MAX"];
let markets = null;

shell("markets").then(async () => {
  markets = await fetch("data/markets.json").then((r) => r.json());
  initChart("qyld", "QYLD", { dividends: true });
  initChart("es", "ES=F", { dividends: false });
});

function seriesFor(ticker) {
  return markets?.series?.[ticker];
}

function barsFor(ticker, interval) {
  const series = seriesFor(ticker);
  return (interval === "weekly" ? series?.weekly : series?.daily) || [];
}

function rangeStart(range, lastTime) {
  if (range === "MAX") return null;
  const end = new Date(`${lastTime}T00:00:00Z`);
  if (range.endsWith("M")) end.setUTCMonth(end.getUTCMonth() - parseInt(range, 10));
  else end.setUTCFullYear(end.getUTCFullYear() - parseInt(range, 10));
  return end.toISOString().slice(0, 10);
}

function visibleBars(bars, range) {
  if (!bars.length) return [];
  const from = rangeStart(range, bars.at(-1).time);
  return from ? bars.filter((bar) => bar.time >= from) : bars;
}

function initChart(prefix, ticker, options) {
  const series = seriesFor(ticker);
  const priceEl = document.querySelector(`#${prefix}-price`);
  const nameEl = document.querySelector(`#${prefix}-name`);
  if (priceEl) priceEl.textContent = series ? BY.money(series.price) : "—";
  if (nameEl) nameEl.textContent = series?.name || ticker;

  const el = document.querySelector(`#${prefix}-chart`);
  const chart = LightweightCharts.createChart(el, {
    width: el.clientWidth,
    height: el.clientHeight,
    layout: { background: { color: "#fff" }, textColor: "#333" },
    grid: { vertLines: { color: "#eef0f2" }, horzLines: { color: "#eef0f2" } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    timeScale: { borderColor: "#ccd1d7" },
    rightPriceScale: { borderColor: "#ccd1d7" },
  });
  const priceSeries = chart.addLineSeries({ color: "#1261a0", lineWidth: 2, title: "Price" });
  const divSeries = options.dividends
    ? chart.addLineSeries({ color: "#0a8a3a", lineWidth: 2, title: "With dividends" })
    : null;
  let showDividends = Boolean(options.dividends);
  let interval = "daily", range = "6M";

  function apply() {
    const bars = visibleBars(barsFor(ticker, interval), range);
    priceSeries.setData(bars.map((bar) => ({ time: bar.time, value: bar.close })));
    if (divSeries) {
      const on = showDividends && interval !== "intraday";
      divSeries.applyOptions({ visible: on });
      divSeries.setData(on ? bars.filter((bar) => bar.adjclose != null).map((bar) => ({ time: bar.time, value: bar.adjclose })) : []);
    }
    if (bars.length) chart.timeScale().setVisibleRange({ from: bars[0].time, to: bars.at(-1).time });
  }

  document.querySelector(`#${prefix}-interval`).onchange = (event) => {
    interval = event.target.value;
    apply();
  };
  document.querySelector(`#${prefix}-range`).onchange = (event) => {
    range = event.target.value;
    apply();
  };
  const toggle = document.querySelector(`#${prefix}-dividends`);
  if (toggle) {
    toggle.onclick = () => {
      showDividends = !showDividends;
      toggle.classList.toggle("active", showDividends);
      toggle.setAttribute("aria-pressed", String(showDividends));
      apply();
    };
  }
  new ResizeObserver(() => {
    chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
  }).observe(el);
  apply();
}
