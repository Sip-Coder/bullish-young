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


  function dayFromTime(t) {
    if (typeof t === "string") return t.slice(0, 10);
    if (typeof t === "number") return new Date(t * 1000).toISOString().slice(0, 10);
    if (t && typeof t === "object" && t.year)
      return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
    return null;
  }
  function datePlus(iso, days) {
    let d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function monthPlus(iso, months) {
    let d = new Date(`${iso}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function fmtDivDate(iso) {
    if (!iso || iso === "N/A") return "—";
    let [y, m, d] = String(iso).split("-");
    if (!y || !m || !d) return iso;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
  }
  function fmtDivAmount(value) {
    if (value == null || !Number.isFinite(+value)) return "—";
    let n = Number(value), fixed = n.toFixed(4);
    if (fixed.endsWith("00")) return `$${n.toFixed(2)}`;
    return `$${fixed}`;
  }
  function fmtDivPct(value) {
    if (value == null || !Number.isFinite(+value)) return "—";
    return `${Number(value).toFixed(2)}%`;
  }
  function normalizeDividends(list) {
    return (list || [])
      .filter((row) => row && row.ex_date && row.ex_date !== "N/A" && Number.isFinite(+row.amount))
      .map((row) => ({
        ex_date: row.ex_date,
        record_date: row.record_date || null,
        payable_date: row.payable_date || row.pay_date || null,
        declared_date: row.declared_date || null,
        amount: +row.amount,
        amount_adj: row.amount_adj != null && Number.isFinite(+row.amount_adj) ? +row.amount_adj : null,
        pct: row.pct != null && Number.isFinite(+row.pct) ? +row.pct : null,
        close: row.close != null ? +row.close : null,
        type: row.type || null,
        special: !!row.special,
      }))
      .sort((a, b) => a.ex_date.localeCompare(b.ex_date));
  }

  function mount(root, options) {
    const q = (sel) => root.querySelector(sel);
    const qa = (sel) => [...root.querySelectorAll(sel)];
    let ticker = options.ticker;
    let dailyData = options.daily || [];
    let longData = options.weekly || null;
    let intradayData = options.intraday || {};
    let data = dailyData;
    let dividendRows = normalizeDividends(options.dividends);
    let type = "candles";
    let selectedRange = options.defaultRange || "6M";
    let selectedInterval = options.defaultInterval || "daily";
    let chart, mainSeries, s50, s200, volume, brooksEma, brooksResult = null;
    const drawingsRef = { inst: null };
    let divTip = null;
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
      syncOverlays();
    }
    function applyVisibleRange() {
      if (!data.length) return;
      let to = data.at(-1).time, from = rangeStart(selectedRange, to);
      if (from == null || from < data[0].time) from = data[0].time;
      chart.timeScale().setVisibleRange({ from, to });
      syncOverlays();
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
      syncOverlays();
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
      syncOverlays();
    }
    function toggle(btn, series) {
      let on = !btn.classList.contains("active");
      btn.classList.toggle("active", on);
      series.applyOptions({ visible: on });
    }


    function periodEnd(bar, next) {
      if (next) return dayFromTime(next.time);
      let start = dayFromTime(bar.time);
      if (!start) return null;
      if (selectedInterval === "weekly") return datePlus(start, 7);
      if (selectedInterval === "monthly") return monthPlus(start, 1);
      if (selectedInterval === "quarterly") return monthPlus(start, 3);
      return datePlus(start, 1);
    }
    function findBarForEx(exDate) {
      if (!data.length || !exDate) return null;
      if (typeof data[0].time === "number") {
        return data.find((bar) => dayFromTime(bar.time) === exDate) || null;
      }
      if (selectedInterval === "daily") {
        return data.find((bar) => bar.time === exDate) || data.find((bar) => bar.time >= exDate) || null;
      }
      for (let i = 0; i < data.length; i++) {
        let start = data[i].time, end = periodEnd(data[i], data[i + 1]);
        if (start <= exDate && (!end || exDate < end)) return data[i];
      }
      return null;
    }
    function hideDivTip() {
      if (divTip) divTip.hidden = true;
    }
    function amountsDiffer(paid, adj) {
      if (paid == null || adj == null || !Number.isFinite(+paid) || !Number.isFinite(+adj)) return false;
      return Math.abs(Number(paid) - Number(adj)) >= 0.00005;
    }
    function divTipHtml(rows) {
      return rows.map((row) => {
        const typeLabel = row.special && row.type && String(row.type).toLowerCase() !== "cash" ? row.type : null;
        const title = typeLabel ? `Dividend (${typeLabel})` : "Dividend";
        const adjRow = amountsDiffer(row.amount, row.amount_adj)
          ? `<div class="tip-row"><span>Split-adjusted</span><span>${fmtDivAmount(row.amount_adj)}</span></div>`
          : "";
        const typeRow = typeLabel
          ? `<div class="tip-row"><span>Type</span><span>${typeLabel}</span></div>`
          : "";
        return `
        <div class="tip-title">${title}</div>
        ${typeRow}
        <div class="tip-row"><span>Ex Div Date</span><span>${fmtDivDate(row.ex_date)}</span></div>
        <div class="tip-row"><span>Record Date</span><span>${fmtDivDate(row.record_date)}</span></div>
        <div class="tip-row"><span>Pay Date</span><span>${fmtDivDate(row.payable_date)}</span></div>
        <div class="tip-row"><span>Declared Date</span><span>${fmtDivDate(row.declared_date)}</span></div>
        <div class="tip-row"><span>Amount</span><span>${fmtDivAmount(row.amount)}</span></div>
        ${adjRow}
        <div class="tip-row"><span>Yield</span><span>${fmtDivPct(row.pct)}</span></div>
      `;
      }).join(rows.length > 1 ? '<hr class="tip-split">' : "");
    }
    function placeDivTip(event, rows, anchor) {
      const tip = divTip;
      if (!tip) return;
      tip.innerHTML = divTipHtml(rows);
      tip.hidden = false;
      const pad = 8;
      let x, y;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        x = rect.left + rect.width / 2 + 10;
        y = rect.top - 8;
      } else {
        x = event.clientX + 12;
        y = event.clientY + 12;
      }
      // Temporarily visible to measure
      const w = tip.offsetWidth, h = tip.offsetHeight;
      if (anchor) y = y - h; // prefer above the marker (Fidelity-style)
      if (x + w > window.innerWidth - pad) x = (anchor ? anchor.getBoundingClientRect().left : event.clientX) - w - 8;
      if (y < pad) y = (anchor ? anchor.getBoundingClientRect().bottom + 8 : event.clientY + 12);
      if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
      tip.style.left = `${Math.max(pad, x)}px`;
      tip.style.top = `${Math.max(pad, y)}px`;
    }
    function syncOverlays() {
      drawingsRef.inst?.sync();
      syncDividendMarkers();
    }
    function syncDividendMarkers() {
      const overlay = q(".div-marker-overlay");
      if (!overlay || !chart) return;
      hideDivTip();
      overlay.replaceChildren();
      if (!dividendRows.length || !data.length) return;
      const box = overlay.parentElement;
      const height = box.clientHeight;
      const width = box.clientWidth;
      // Volume occupies the bottom 20% of the plot; the time axis is ~26px.
      const y = Math.round((height - 26) * 0.79);
      const groups = new Map();
      dividendRows.forEach((row) => {
        const bar = findBarForEx(row.ex_date);
        if (!bar) return;
        const x = chart.timeScale().timeToCoordinate(bar.time);
        if (x == null || !Number.isFinite(x) || x < -16 || x > width + 16) return;
        const key = String(bar.time);
        const group = groups.get(key) || { x, rows: [] };
        group.rows.push(row);
        group.x = x;
        groups.set(key, group);
      });
      // Cluster markers that would overlap
      const clustered = [...groups.values()].sort((a, b) => a.x - b.x);
      const merged = [];
      clustered.forEach((group) => {
        const prev = merged.at(-1);
        if (prev && Math.abs(group.x - prev.x) < 14) {
          prev.rows = prev.rows.concat(group.rows);
          prev.x = (prev.x * (prev.rows.length - group.rows.length) + group.x * group.rows.length) / prev.rows.length;
        } else {
          merged.push({ x: group.x, rows: group.rows.slice() });
        }
      });
      merged.forEach((group) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "div-marker";
        btn.textContent = "D";
        const pad = 12;
        const left = Math.max(pad, Math.min(width - pad, group.x));
        btn.style.left = `${Math.round(left)}px`;
        btn.style.top = `${y}px`;
        const label = group.rows.length > 1
          ? `${group.rows.length} dividends`
          : `Dividend ${fmtDivDate(group.rows[0].ex_date)} ${fmtDivAmount(group.rows[0].amount)}`;
        btn.setAttribute("aria-label", label);
        if (group.rows.length > 1) {
          const count = document.createElement("span");
          count.className = "div-marker-count";
          count.textContent = String(group.rows.length);
          btn.append(count);
        }
        const show = (event) => {
          event.preventDefault();
          event.stopPropagation();
          placeDivTip(event, group.rows, btn);
        };
        btn.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        btn.addEventListener("pointerup", (event) => event.stopPropagation());
        btn.addEventListener("click", show);
        btn.addEventListener("pointerenter", (event) => {
          if (event.pointerType === "mouse") placeDivTip(event, group.rows, btn);
        });
        btn.addEventListener("pointerleave", (event) => {
          if (event.pointerType === "mouse") hideDivTip();
        });
        overlay.append(btn);
      });
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
    if (dividendRows.length) {
      // Keep the last-price line in the price pane and leave a lane for D markers above volume.
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.24 } });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    s50 = chart.addLineSeries({ color: "#16a34a", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    s200 = chart.addLineSeries({ color: "#dc2626", lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
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
    if (box && dividendRows.length) {
      let overlay = box.querySelector(".div-marker-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "div-marker-overlay";
        overlay.setAttribute("aria-hidden", "false");
        box.append(overlay);
      }
      divTip = document.querySelector(`.div-marker-tip[data-ticker="${CSS.escape(ticker)}"]`);
      if (!divTip) {
        divTip = document.createElement("div");
        divTip.className = "div-marker-tip";
        divTip.dataset.ticker = ticker;
        divTip.hidden = true;
        document.body.append(divTip);
      }
    }
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
      syncOverlays();
    }).observe(el);
    chart.timeScale().subscribeVisibleTimeRangeChange(() => syncDividendMarkers());
    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".div-marker") && !event.target.closest(".div-marker-tip")) hideDivTip();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideDivTip();
    });
    requestAnimationFrame(() => syncDividendMarkers());
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
