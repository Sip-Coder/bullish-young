(() => {
  "use strict";

  const STORE_KEY = "by-drawings-v1";
  const NS = "http://www.w3.org/2000/svg";
  const COLOR = "#6b3fad";
  const SELECTED = "#4b2385";
  const instances = [];
  let active = null;

  const svg = (name, attrs = {}) => {
    let node = document.createElementNS(NS, name);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };
  const canonicalTime = (value) => {
    if (typeof value === "number") return Math.floor(value);
    if (typeof value === "string") return Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);
    if (value && typeof value === "object")
      return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 1000);
    return null;
  };
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const validDrawing = (d) => d && (d.type === "trend" || d.type === "hline") &&
    Number.isFinite(d.price) && (d.type === "hline" ||
      Number.isFinite(d.time) && Number.isFinite(d.time2) && Number.isFinite(d.price2));

  function createDrawings(opts) {
    const getChart = opts.getChart;
    const getMainSeries = opts.getMainSeries;
    const getData = opts.getData;
    const getTicker = opts.getTicker;
    const box = opts.box;
    const toolbar = opts.toolbar;
    if (!box || !toolbar || !getChart() || !getMainSeries()) return null;

    const q = (sel) => toolbar.querySelector(sel);
    let overlay, drawings = [], selected = null, tool = "pointer";
    let action = null, pending = null;

    const chartTime = (seconds) => {
      const data = getData() || [];
      if (typeof data[0]?.time === "number") return seconds;
      return new Date(seconds * 1000).toISOString().slice(0, 10);
    };
    const load = () => {
      try {
        let all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        return Array.isArray(all[getTicker()]) ? all[getTicker()].filter(validDrawing) : [];
      } catch (_) { return []; }
    };
    const save = () => {
      try {
        let all = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
        if (!all || Array.isArray(all) || typeof all !== "object") all = {};
        all[getTicker()] = drawings;
        localStorage.setItem(STORE_KEY, JSON.stringify(all));
      } catch (_) { /* Storage can be unavailable in private browsing. */ }
    };
    const bounds = () => ({ width: box.clientWidth, height: box.clientHeight });

    function timeX(seconds) {
      const chart = getChart(), data = getData() || [];
      let scale = chart?.timeScale(), x = scale?.timeToCoordinate(chartTime(seconds));
      if (x != null) return x;
      if (!data.length) return null;
      let first = data[0], last = data.at(-1), x1 = scale.timeToCoordinate(first.time), x2 = scale.timeToCoordinate(last.time);
      if (x1 == null || x2 == null) return null;
      let t1 = canonicalTime(first.time), t2 = canonicalTime(last.time);
      return t1 === t2 ? x1 : x1 + (seconds - t1) * (x2 - x1) / (t2 - t1);
    }
    function xTime(x) {
      const chart = getChart(), data = getData() || [];
      let scale = chart?.timeScale(), value = scale?.coordinateToTime(x);
      if (value != null) return canonicalTime(value);
      if (!data.length) return null;
      let first = data[0], last = data.at(-1), x1 = scale.timeToCoordinate(first.time), x2 = scale.timeToCoordinate(last.time);
      if (x1 == null || x2 == null || x1 === x2) return null;
      return Math.round(canonicalTime(first.time) + (x - x1) *
        (canonicalTime(last.time) - canonicalTime(first.time)) / (x2 - x1));
    }
    const pointAt = (event) => {
      const mainSeries = getMainSeries();
      let rect = box.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
      let time = xTime(x), price = mainSeries?.coordinateToPrice(y);
      return time == null || price == null ? null : { x, y, time, price };
    };
    const drawingPoints = (d) => {
      const mainSeries = getMainSeries();
      return d.type === "hline"
        ? [{ x: 0, y: mainSeries?.priceToCoordinate(d.price) }]
        : [{ x: timeX(d.time), y: mainSeries?.priceToCoordinate(d.price) },
           { x: timeX(d.time2), y: mainSeries?.priceToCoordinate(d.price2) }];
    };

    function label(parent, text, x, y, axis = false) {
      let width = Math.max(38, text.length * 6.15 + 10), height = 18, size = bounds();
      x = Math.max(2, Math.min(x, size.width - width - 2));
      y = Math.max(2, Math.min(y, size.height - height - 2));
      let group = svg("g", { class: axis ? "drawing-axis-label" : "drawing-label" });
      group.append(svg("rect", { x, y, width, height, rx: 3, fill: COLOR, opacity: ".94" }));
      let textNode = svg("text", { x: x + 5, y: y + 12.5, fill: "white" });
      textNode.textContent = text;
      group.append(textNode); parent.append(group);
    }
    function measurement(d) {
      const data = getData() || [];
      let change = d.price2 - d.price, pct = d.price ? change / d.price * 100 : 0;
      let lo = Math.min(d.time, d.time2), hi = Math.max(d.time, d.time2);
      let bars = data.filter((bar) => { let t = canonicalTime(bar.time); return t >= lo && t <= hi; }).length;
      let days = Math.round(Math.abs(d.time2 - d.time) / 86400);
      let money = `${change >= 0 ? "+" : "−"}$${Math.abs(change).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      let percent = `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;
      return `${money} · ${percent} · ${bars} bars · ${days}d`;
    }
    function renderDrawing(d) {
      let points = drawingPoints(d), isActive = d.id === selected;
      if (points.some((p) => p.x == null || p.y == null || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return;
      let group = svg("g", { "data-id": d.id }), color = isActive ? SELECTED : COLOR;
      if (d.type === "hline") {
        let y = points[0].y, w = bounds().width;
        group.append(svg("line", { x1: 0, y1: y, x2: w, y2: y, stroke: color,
          "stroke-width": isActive ? 2.5 : 1.5, "stroke-dasharray": "6 4" }));
        group.append(svg("line", { class: "drawing-hit", x1: 0, y1: y, x2: w, y2: y,
          stroke: "transparent", "stroke-width": 14, "data-part": "line" }));
        label(group, `$${d.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, w - 72, y - 9, true);
        if (isActive) group.append(svg("circle", { class: "drawing-handle", cx: Math.max(10, w - 82), cy: y,
          r: 5, fill: "white", stroke: color, "stroke-width": 2, "data-part": "line" }));
      } else {
        let [a, b] = points;
        group.append(svg("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: color,
          "stroke-width": isActive ? 2.5 : 1.5 }));
        group.append(svg("line", { class: "drawing-hit", x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          stroke: "transparent", "stroke-width": 14, "data-part": "line" }));
        label(group, measurement(d), (a.x + b.x) / 2 - 65, Math.min(a.y, b.y) - 24);
        if (isActive) [a, b].forEach((p, index) => group.append(svg("circle", {
          class: "drawing-handle", cx: p.x, cy: p.y, r: 5, fill: "white", stroke: color,
          "stroke-width": 2, "data-part": `p${index}`
        })));
      }
      overlay.append(group);
    }
    function render() {
      const chart = getChart(), mainSeries = getMainSeries();
      if (!overlay || !chart || !mainSeries) return;
      let { width, height } = bounds();
      overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
      overlay.replaceChildren();
      drawings.forEach(renderDrawing);
      if (pending) renderDrawing(pending);
      const del = q("[data-draw=delete]") || q("#draw-delete");
      if (del) del.disabled = !selected;
    }

    function setTool(next) {
      if (action) return;
      pending = null; tool = next;
      ["pointer", "trend", "hline"].forEach((name) => {
        const btn = q(`[data-draw="${name}"]`) || q(`#draw-${name}`);
        if (btn) btn.classList.toggle("active", name === tool);
      });
      overlay.style.pointerEvents = tool === "pointer" ? "none" : "all";
      overlay.style.cursor = tool === "pointer" ? "default" : "crosshair";
      getChart()?.applyOptions({ handleScroll: tool === "pointer", handleScale: tool === "pointer" });
      render();
    }
    function select(idValue) { selected = idValue; render(); }
    function removeSelected() {
      if (!selected) return;
      drawings = drawings.filter((d) => d.id !== selected); selected = null; save(); render();
    }
    function beginCapture(event, detail) {
      action = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, ...detail };
      overlay.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    function onDown(event) {
      if (event.button != null && event.button !== 0) return;
      activate();
      const mainSeries = getMainSeries();
      let target = event.target.closest?.("[data-id]"), p = pointAt(event);
      if (tool === "pointer") {
        if (!target || !p) return;
        let d = drawings.find((item) => item.id === target.dataset.id); if (!d) return;
        select(d.id);
        beginCapture(event, { kind: "move", id: d.id, part: event.target.dataset.part || "line",
          origin: { ...d }, originPoint: p, originalPixels: drawingPoints(d) });
        return;
      }
      if (!p) return;
      if (tool === "hline") {
        pending = { id: id(), type: "hline", price: p.price };
        beginCapture(event, { kind: "new-hline" }); render(); return;
      }
      if (pending) {
        beginCapture(event, { kind: "finish-trend", first: { time: pending.time, price: pending.price } });
        pending.time2 = p.time; pending.price2 = p.price; render(); return;
      }
      pending = { id: id(), type: "trend", time: p.time, price: p.price, time2: p.time, price2: p.price };
      beginCapture(event, { kind: "new-trend", first: p }); render();
    }
    function onMove(event) {
      if (!action || action.pointerId !== event.pointerId) return;
      const mainSeries = getMainSeries();
      let p = pointAt(event); if (!p) return;
      event.preventDefault();
      if (action.kind === "new-hline") pending.price = p.price;
      else if (action.kind === "new-trend" || action.kind === "finish-trend") {
        pending.time2 = p.time; pending.price2 = p.price;
      } else if (action.kind === "move") {
        let d = drawings.find((item) => item.id === action.id); if (!d) return;
        if (d.type === "hline") d.price = p.price;
        else if (action.part === "p0") { d.time = p.time; d.price = p.price; }
        else if (action.part === "p1") { d.time2 = p.time; d.price2 = p.price; }
        else {
          let dx = event.clientX - action.startX, dy = event.clientY - action.startY;
          let [a, b] = action.originalPixels;
          let time1 = xTime(a.x + dx), time2 = xTime(b.x + dx);
          let price1 = mainSeries.coordinateToPrice(a.y + dy), price2 = mainSeries.coordinateToPrice(b.y + dy);
          if (time1 != null && time2 != null && price1 != null && price2 != null) {
            d.time = time1; d.time2 = time2; d.price = price1; d.price2 = price2;
          }
        }
      }
      render();
    }
    function onUp(event) {
      if (!action || action.pointerId !== event.pointerId) return;
      let moved = Math.hypot(event.clientX - action.startX, event.clientY - action.startY) > 5;
      try { overlay.releasePointerCapture(event.pointerId); } catch (_) {}
      if (action.kind === "new-hline") {
        drawings.push(pending); selected = pending.id; pending = null; save();
      } else if (action.kind === "new-trend" && !moved) {
        action = null; render(); return;
      } else if (action.kind === "new-trend" || action.kind === "finish-trend") {
        if (pending.time !== pending.time2 || pending.price !== pending.price2) {
          drawings.push(pending); selected = pending.id; save();
        }
        pending = null; action = null; render(); return;
      } else if (action.kind === "move") save();
      action = null; render();
    }
    function cancel() {
      if (action?.pointerId != null && overlay.hasPointerCapture(action.pointerId))
        overlay.releasePointerCapture(action.pointerId);
      if (action && action.kind === "move") {
        let index = drawings.findIndex((d) => d.id === action.id);
        if (index >= 0) drawings[index] = action.origin;
      }
      action = null; pending = null; render();
    }
    function onKey(event) {
      if (active !== api) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selected &&
          !/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
        event.preventDefault(); removeSelected();
      } else if (event.key === "Escape") {
        if (action || pending) cancel();
        else if (selected) select(null);
        else if (tool !== "pointer") setTool("pointer");
      }
    }
    function activate() { active = api; }

    const btn = (name) => q(`[data-draw="${name}"]`) || q(`#draw-${name}`);
    overlay = box.querySelector(".drawing-overlay") || svg("svg", { class: "drawing-overlay", "aria-label": "Chart drawings" });
    if (!overlay.parentNode) box.append(overlay);
    drawings = load();
    btn("pointer").onclick = () => { activate(); setTool("pointer"); };
    btn("trend").onclick = () => { activate(); setTool("trend"); };
    btn("hline").onclick = () => { activate(); setTool("hline"); };
    btn("delete").onclick = () => { activate(); removeSelected(); };
    btn("clear").onclick = () => {
      activate();
      if (!drawings.length || !confirm(`Clear all drawings for ${getTicker()}?`)) return;
      drawings = []; selected = null; pending = null; save(); render();
    };
    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("pointermove", onMove, { passive: false });
    overlay.addEventListener("pointerup", onUp);
    overlay.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", onKey);
    getChart().subscribeClick(() => { if (tool === "pointer" && !action) select(null); });
    getChart().timeScale().subscribeVisibleTimeRangeChange(() => api.sync());
    setTool("pointer");

    const api = {
      sync: () => requestAnimationFrame(render),
      destroy() {
        document.removeEventListener("keydown", onKey);
        overlay.remove();
      }
    };
    instances.push(api);
    activate();
    return api;
  }

  window.createDrawings = createDrawings;
  window.initDrawings = (opts) => {
    if (opts?.box) return createDrawings(opts);
    if (typeof chart === "undefined" || !chart || typeof mainSeries === "undefined" || !mainSeries) return;
    const box = document.querySelector(".chart-box");
    const toolbar = document.querySelector(".drawing-toolbar");
    if (!box || !toolbar) return;
    const inst = createDrawings({
      getChart: () => chart,
      getMainSeries: () => mainSeries,
      getData: () => data,
      getTicker: () => ticker,
      box,
      toolbar,
    });
    window.syncDrawings = inst ? inst.sync : () => {};
    return inst;
  };
  window.syncDrawings = () => instances.forEach((inst) => inst.sync());
})();
