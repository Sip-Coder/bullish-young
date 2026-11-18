(() => {
  "use strict";

  const longRanges = ["3Y", "5Y", "10Y", "MAX"];

  function unpackIntraday(payload) {
    return payload.t.map((time, i) => ({
      time, open: payload.o[i], high: payload.h[i], low: payload.l[i],
      close: payload.c[i], volume: payload.v[i],
      adjclose: payload.a ? payload.a[i] : undefined,
    }));
  }
  function aggregateBars(source, keyFor) {
    let groups = new Map();
    source.forEach((bar) => {
      let key = keyFor(bar.time), group = groups.get(key);
      if (!group) {
        groups.set(key, {
          time: key, open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          volume: bar.volume || 0, adjclose: bar.adjclose,
        });
      } else {
        group.high = Math.max(group.high, bar.high);
        group.low = Math.min(group.low, bar.low);
        group.close = bar.close;
        group.volume += bar.volume || 0;
        if (bar.adjclose != null) group.adjclose = bar.adjclose;
      }
    });
    return [...groups.values()];
  }
  function aggregateSeconds(source, seconds) {
    return aggregateBars(source, (time) => Math.floor(time / seconds) * seconds);
  }
  function aggregateCalendar(source, quarterly) {
    return aggregateBars(source, (time) => {
      let d = new Date(`${time}T00:00:00Z`), month = quarterly ? Math.floor(d.getUTCMonth() / 3) * 3 : d.getUTCMonth();
      return `${d.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
    });
  }
  function defaultInterval(range) { return longRanges.includes(range) ? "weekly" : "daily"; }
  function rangeStart(range, lastTime) {
    if (range === "MAX") return null;
    if (range === "YTD") {
      let start = new Date(Date.UTC(new Date().getFullYear(), 0, 1));
      return typeof lastTime === "number" ? Math.floor(start.getTime() / 1000) : start.toISOString().slice(0, 10);
    }
    let d = typeof lastTime === "number" ? new Date(lastTime * 1000) : new Date(`${lastTime}T00:00:00Z`);
    if (range.endsWith("M")) d.setUTCMonth(d.getUTCMonth() - parseInt(range, 10));
    else d.setUTCFullYear(d.getUTCFullYear() - parseInt(range, 10));
    return typeof lastTime === "number" ? Math.floor(d.getTime() / 1000) : d.toISOString().slice(0, 10);
  }
  function timeKey(t) {
    return typeof t === "string"
      ? t
      : t && `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  }

  function mount(root, options) {
    const q = (sel) => root.querySelector(sel);
    const qa = (sel) => [...root.querySelectorAll(sel)];
    let ticker = options.ticker;
    let dailyData = options.daily || [];
    let longData = options.weekly || null;
    let intradayData = options.intraday || {};
    let data = dailyData;
    let type = "candles";
    let selectedRange = options.defaultRange || "6M";
    let selectedInterval = options.defaultInterval || "daily";
    let chart, mainSeries, s50, s200, volume, brooksEma, brooksResult = null;
    const drawingsRef = { inst: null };
    const state = {};

    const brooksOn = () => Boolean(q(".brooks-toggle input, #brooks")?.checked);
    const syncBrooksVisibility = () => {
      let visible = brooksOn() && selectedInterval === "daily";
      let layers = q("#brooks-layers, .brooks-layers");
      let badge = q("#brooks-badge, .brooks-badge");
      if (layers) layers.hidden = !visible;
      if (badge) badge.hidden = !visible;
    };

    function intervalSource(interval = selectedInterval) {
      if (interval === "1m") return intradayData["1m"] || [];
      if (["5m", "10m", "15m", "30m"].includes(interval)) {
        let base = intradayData["5m"] || [];
        return interval === "5m" ? base : aggregateSeconds(base, parseInt(interval, 10) * 60);
      }
      if (["1h", "2h", "4h"].includes(interval)) {
        let base = intradayData["1h"] || [];
        return interval === "1h" ? base : aggregateSeconds(base, parseInt(interval, 10) * 3600);
      }
      if (interval === "daily") return dailyData;
      if (interval === "weekly") return longData?.length ? longData : dailyData;
      let base = longRanges.includes(selectedRange) ? (longData || dailyData) : dailyData;
      return aggregateCalendar(base, interval === "quarterly");
    }
    function intervalDisabled(interval, range = selectedRange) {
      if (interval === "1m") return range !== "1M" || !intradayData["1m"];
      if (["5m", "10m", "15m", "30m"].includes(interval))
        return ["4M", "6M", "9M", "YTD", "1Y", "2Y", ...longRanges].includes(range) || !intradayData["5m"];
      if (["1h", "2h", "4h"].includes(interval)) return longRanges.includes(range) || !intradayData["1h"];
      if (interval === "daily") return longRanges.includes(range);
      return false;
    }
    function sma(n) {
      return data
        .map((x, i) =>
          i < n - 1
            ? null
            : {
                time: x.time,
                value: data.slice(i - n + 1, i + 1).reduce((a, b) => a + b.close, 0) / n,
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
      let out = [], run = 0;
      for (let i = 1; i < data.length; i++) {
        let b = data[i], p = data[i - 1],
          inside = b.high <= p.high && b.low >= p.low,
          outside = b.high > p.high && b.low < p.low;
        if (inside) {
          run++;
          out.push({
            time: b.time, position: "aboveBar", color: "#7c858e", shape: "square",
            text: run === 1 ? "i" : run === 2 ? "ii" : "iii",
          });
        } else {
          run = 0;
          if (outside)
            out.push({ time: b.time, position: "aboveBar", color: "#7c858e", shape: "square", text: "o" });
        }
      }
      return out;
    }
    function stripMarker(m) {
      let { meta, ...marker } = m;
      return marker;
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
    function setPriceData() {
      let barTypes = q("#bar-types, .bar-types");
      let bars = barTypes?.checked && brooksOn() && selectedInterval === "daily" ? coloredBars() : data;
      mainSeries.setData(
        type === "line" ? data.map((x) => ({ time: x.time, value: x.close })) : bars,
      );
    }
    function applyMarkers() {
      if (!mainSeries) return;
      let markers = brooksOn() && brooksResult ? brooksResult.markers.map(stripMarker) : [];
      let inside = q("#inside-outside, .inside-outside");
      if (brooksOn() && brooksResult && inside?.checked) markers = markers.concat(insideOutsideMarkers());
      markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
      mainSeries.setMarkers(markers);
    }
    function applyBrooks() {
      syncBrooksVisibility();
      if (brooksEma) {
        chart.removeSeries(brooksEma);
        brooksEma = null;
      }
      if (!brooksOn() || selectedInterval !== "daily") {
        brooksResult = null;
        mainSeries.setMarkers([]);
        setPriceData();
        return;
      }
      brooksResult = window.BrooksPA.analyze(data);
      brooksEma = chart.addLineSeries({
        color: "#e8751a", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "20 EMA",
      });
      brooksEma.setData(brooksResult.ema20);
      let always = brooksResult.state.alwaysIn, badge = q("#brooks-badge, .brooks-badge");
      if (badge) {
        badge.textContent = always === "long" ? "Always in long" : always === "short" ? "Always in short" : "Trading range";
        badge.className = `brooks-badge ${always}`;
      }
      setPriceData();
      applyMarkers();
    }
    function updateAvailability() {
      let select = q("#bar-interval, .bar-interval");
      if (select) [...select.options].forEach((option) => option.disabled = intervalDisabled(option.value));
      let note = "";
      if (!options.intradayEligible) note = options.intradayNote || "Intraday for starred stocks.";
      else if (!Object.keys(intradayData).length) note = "Intraday data is not available yet.";
      else if (selectedInterval === "1m") note = "1-minute bars: last 5 trading days only.";
      else if (["5m", "10m", "15m", "30m"].includes(selectedInterval)) note = "5–30-minute bars: available history is limited to about 60 days.";
      else if (["1h", "2h", "4h"].includes(selectedInterval)) note = "Hourly bars: available history is limited to about 730 days.";
      const avail = q("#chart-availability, .chart-availability-detail");
      if (avail) avail.textContent = note;
    }
    function setLogScale(on) {
      chart.applyOptions({
        rightPriceScale: {
          mode: on ? LightweightCharts.PriceScaleMode.Logarithmic : LightweightCharts.PriceScaleMode.Normal,
        },
      });
      let button = q("#log-scale, .log-scale");
      if (button) {
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", String(on));
      }
      drawingsRef.inst?.sync();
    }
    function applyVisibleRange() {
      if (!data.length) return;
      let to = data.at(-1).time, from = rangeStart(selectedRange, to);
      if (from == null || from < data[0].time) from = data[0].time;
      chart.timeScale().setVisibleRange({ from, to });
      drawingsRef.inst?.sync();
    }
    function setIntervalValue(interval) {
      selectedInterval = interval;
      const select = q("#bar-interval, .bar-interval");
      if (select) select.value = interval;
      data = intervalSource();
      state.data = data;
      setSupportingData();
      applyBrooks();
      setPriceData();
      updateAvailability();
      applyVisibleRange();
      drawingsRef.inst?.sync();
    }
    function setRange(range, applyLogDefault = true) {
      selectedRange = range;
      const select = q("#date-range, .date-range");
      if (select) select.value = range;
      updateAvailability();
      if (intervalDisabled(selectedInterval, range)) selectedInterval = defaultInterval(range);
      setIntervalValue(selectedInterval);
      if (applyLogDefault) setLogScale(longRanges.includes(range));
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
      state.mainSeries = mainSeries;
      setPriceData();
      qa("[data-type]").forEach((b) => b.classList.toggle("active", b.dataset.type === t));
      applyBrooks();
      setRange(selectedRange, false);
      drawingsRef.inst?.sync();
    }
    function toggle(btn, series) {
      let on = !btn.classList.contains("active");
      btn.classList.toggle("active", on);
      series.applyOptions({ visible: on });
    }

    const el = q("#chart, .chart-el");
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
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    s50 = chart.addLineSeries({ color: "#e39116", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    s200 = chart.addLineSeries({ color: "#366dc9", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    state.chart = chart;
    data = intervalSource(selectedInterval);
    state.data = data;
    setSupportingData();
    setType("candles");
    setRange(selectedRange, false);
    if (options.defaultInterval && !intervalDisabled(options.defaultInterval, selectedRange)) {
      setIntervalValue(options.defaultInterval);
    }
    if (options.applyLogDefault) setLogScale(longRanges.includes(selectedRange));

    const box = q(".chart-box");
    const toolbar = q(".drawing-toolbar");
    if (window.createDrawings && box && toolbar) {
      drawingsRef.inst = window.createDrawings({
        getChart: () => chart,
        getMainSeries: () => mainSeries,
        getData: () => data,
        getTicker: () => ticker,
        box,
        toolbar,
      });
    }
    new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
      drawingsRef.inst?.sync();
    }).observe(el);
    chart.subscribeCrosshairMove((p) => {
      let d = p.seriesData.get(mainSeries),
        base = d
          ? d.open != null
            ? `O ${BY.fmt(d.open)}  H ${BY.fmt(d.high)}  L ${BY.fmt(d.low)}  C ${BY.fmt(d.close)}`
            : `Close ${BY.fmt(d.value)}`
          : "",
        m = brooksResult?.markers.find((x) => timeKey(x.time) === timeKey(p.time) && x.meta);
      const ohlc = q(".ohlc");
      if (ohlc) ohlc.textContent = m
        ? `${base}  ·  ${m.meta.setup} · ${m.meta.strong ? "strong" : "weak"} · ${m.meta.emaTest ? "EMA test" : "no EMA test"} · entry ${BY.fmt(m.meta.entry)} stop ${BY.fmt(m.meta.stop)}`
        : base;
    });
    qa("[data-type]").forEach((b) => (b.onclick = () => setType(b.dataset.type)));
    q("#date-range, .date-range").onchange = (event) => setRange(event.target.value);
    q("#bar-interval, .bar-interval").onchange = (event) => setIntervalValue(event.target.value);
    q("#log-scale, .log-scale").onclick = () =>
      setLogScale(!q("#log-scale, .log-scale").classList.contains("active"));
    const sma50 = q("#sma50, [data-sma='50']");
    const sma200 = q("#sma200, [data-sma='200']");
    if (sma50) sma50.onclick = () => toggle(sma50, s50);
    if (sma200) sma200.onclick = () => toggle(sma200, s200);
    const brooks = q("#brooks, .brooks-toggle input");
    if (brooks) brooks.onchange = applyBrooks;
    const barTypes = q("#bar-types, .bar-types");
    if (barTypes) barTypes.onchange = setPriceData;
    const inside = q("#inside-outside, .inside-outside");
    if (inside) inside.onchange = applyMarkers;
    return {
      get chart() { return chart; },
      get mainSeries() { return mainSeries; },
      get data() { return data; },
    };
  }

  window.BYChart = { mount, unpackIntraday, longRanges };
})();
