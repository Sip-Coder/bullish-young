const narrowMap = matchMedia("(max-width: 700px)");
const fineHover = matchMedia("(hover: hover) and (pointer: fine)");
let selectedTicker = null;
let focusedSector = null;
let tipTimer = null;
let pressTimer = null;
let suppressClick = false;
let leavesIndex = [];

const tip = document.querySelector("#tip");
const card = document.querySelector("#map-card");

shell("map").then(render);
addEventListener("resize", () => {
  clearTimeout(window.rt);
  window.rt = setTimeout(render, 100);
});
narrowMap.addEventListener("change", render);

document.addEventListener("by:stars-changed", () => {
  if (tip.style.display === "block") {
    const ticker = tip.dataset.ticker;
    const stock = ticker && BY.stock(ticker);
    if (stock) tip.innerHTML = tipHTML(stock);
  }
  if (!card.hidden && card.dataset.ticker) {
    const stock = BY.stock(card.dataset.ticker);
    if (stock) fillCard(stock);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!selectedTicker) return;
  if (event.target.closest("#map-card, .map-node, .sector-label, .sector-heading, #tip")) return;
  clearSelection();
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (selectedTicker) clearSelection();
    else if (focusedSector) zoomOut();
  }
});

tip.addEventListener("mouseenter", () => clearTimeout(tipTimer));
tip.addEventListener("mouseleave", hideTip);

document.querySelector("#map-back").onclick = zoomOut;

function stocksBySector() {
  const stocks = BY.stats.stocks.filter((s) => s.market_cap > 0);
  return d3.group(stocks, (s) => s.sector || "Other");
}

function render() {
  const box = document.querySelector("#treemap");
  const groups = stocksBySector();
  box.innerHTML = "";
  leavesIndex = [];
  clearSelection();
  hideTip();
  updateChrome();

  if (focusedSector) {
    const children = groups.get(focusedSector) || [];
    box.classList.toggle("treemap-stacked", narrowMap.matches);
    box.classList.add("map-zoomed");
    if (narrowMap.matches) {
      const section = document.createElement("section");
      const header = document.createElement("h2");
      const canvas = document.createElement("div");
      section.className = "map-sector";
      header.className = "sector-heading";
      header.textContent = focusedSector;
      canvas.className = "sector-map sector-map-zoom";
      canvas.style.height = `${Math.max(480, Math.round(window.innerHeight - 220))}px`;
      section.append(header, canvas);
      box.append(section);
      drawTree(canvas, children);
    } else {
      drawTree(box, children);
    }
    return;
  }

  if (narrowMap.matches) {
    box.classList.add("treemap-stacked");
    box.classList.remove("map-zoomed");
    [...groups].sort((a, b) => d3.sum(b[1], (s) => s.market_cap) - d3.sum(a[1], (s) => s.market_cap)).forEach(([name, children]) => {
      const section = document.createElement("section"), header = document.createElement("h2"), canvas = document.createElement("div");
      section.className = "map-sector";
      header.className = "sector-heading";
      header.textContent = name;
      header.title = `Zoom into ${name}`;
      bindSectorZoom(header, name);
      canvas.className = "sector-map";
      canvas.style.height = `${Math.min(820, Math.max(140, 56 + children.length * 34))}px`;
      section.append(header, canvas);
      box.append(section);
      drawTree(canvas, children);
    });
  } else {
    box.classList.remove("treemap-stacked", "map-zoomed");
    const root = d3.hierarchy({ children: [...groups].map(([name, children]) => ({ name, children })) }).sum((d) => d.market_cap || 0).sort((a, b) => b.value - a.value);
    d3.treemap().tile(d3.treemapSquarify).size([box.clientWidth, box.clientHeight]).paddingOuter(2).paddingTop((d) => (d.depth === 1 ? 20 : 0)).paddingInner(0)(root);
    root.children.forEach((g) => {
      const label = document.createElement("div");
      label.className = "sector-label";
      label.textContent = g.data.name;
      label.title = `Zoom into ${g.data.name}`;
      label.style.cssText = `left:${g.x0 + 3}px;top:${g.y0 + 2}px;max-width:${Math.max(0, g.x1 - g.x0 - 6)}px`;
      bindSectorZoom(label, g.data.name);
      box.append(label);
    });
    drawLeaves(box, root.leaves());
  }
}

function drawTree(canvas, stocks) {
  const root = d3.hierarchy({ children: stocks }).sum((d) => d.market_cap || 0).sort((a, b) => b.value - a.value);
  d3.treemap().tile(d3.treemapSquarify).size([canvas.clientWidth, canvas.clientHeight]).paddingOuter(0).paddingInner(0)(root);
  drawLeaves(canvas, root.leaves());
}

function labelPlan(ticker, w, h) {
  const minFont = 10, padX = 4, padY = 2, char = 0.62;
  if (w < ticker.length * minFont * char + padX || h < minFont + padY) return { show: false };
  const font = Math.max(minFont, Math.min(22, Math.floor(Math.min((w - padX) / Math.max(ticker.length * char, 1), h - padY))));
  const showPct = h >= font * 2 + 6 && w >= Math.max(28, font * 3);
  return { show: true, font, showPct };
}

function drawLeaves(container, leaves) {
  const color = d3.scaleLinear().domain([-3, 0, 3]).range(["#d0282e", "#858b91", "#0a8a3a"]).clamp(true);
  leaves.forEach((d) => {
    const s = d.data, w = Math.max(0, d.x1 - d.x0), h = Math.max(0, d.y1 - d.y0);
    const node = document.createElement("div");
    const plan = labelPlan(s.ticker, w, h);
    node.className = "map-node";
    node.dataset.ticker = s.ticker;
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `${s.ticker}, ${s.name || s.ticker}, ${s.sector || ""}, ${BY.money(s.price)}, ${BY.pct(s.chg_pct)}`);
    node.style.cssText = `left:${d.x0}px;top:${d.y0}px;width:${w}px;height:${h}px;background:${color(s.chg_pct || 0)}`;
    if (plan.show) {
      node.style.fontSize = `${plan.font}px`;
      node.innerHTML = `<span class="map-ticker">${s.ticker}</span>${plan.showPct ? `<small style="font-size:${Math.max(10, Math.round(plan.font * 0.72))}px">${BY.pct(s.chg_pct)}</small>` : ""}`;
    }
    bindNode(node, s);
    container.append(node);
    leavesIndex.push({ container, node, stock: s, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
  });
  bindContainerHits(container);
}

function bindContainerHits(container) {
  if (container.dataset.hitsBound) return;
  container.dataset.hitsBound = "1";
  container.addEventListener("mousemove", (event) => {
    if (narrowMap.matches || !fineHover.matches) return;
    if (event.target.closest(".sector-label, .sector-heading, #tip, #map-card")) return;
    const leaf = hitLeaf(container, event.clientX, event.clientY);
    if (!leaf) { scheduleHideTip(); return; }
    showTip(leaf.stock, event.clientX, event.clientY);
  });
  container.addEventListener("mouseleave", (event) => {
    if (event.relatedTarget && event.relatedTarget.closest?.("#tip")) return;
    scheduleHideTip();
  });
}

function hitLeaf(container, clientX, clientY) {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left + container.scrollLeft;
  const y = clientY - rect.top + container.scrollTop;
  const hits = leavesIndex.filter((leaf) => leaf.container === container);
  const inside = hits.find((leaf) => x >= leaf.x0 && x <= leaf.x1 && y >= leaf.y0 && y <= leaf.y1);
  if (inside) return inside;
  let best = null, bestDistance = 4;
  hits.forEach((leaf) => {
    const dx = x < leaf.x0 ? leaf.x0 - x : x > leaf.x1 ? x - leaf.x1 : 0;
    const dy = y < leaf.y0 ? leaf.y0 - y : y > leaf.y1 ? y - leaf.y1 : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) { bestDistance = distance; best = leaf; }
  });
  return best;
}

function bindNode(node, stock) {
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (narrowMap.matches) {
        if (selectedTicker === stock.ticker) openStock(stock.ticker);
        else showCard(stock, node);
      } else openStock(stock.ticker);
    }
  });
  node.addEventListener("click", (event) => {
    if (event.target.closest(".star")) return;
    if (narrowMap.matches || suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      if (suppressClick) { suppressClick = false; return; }
      if (selectedTicker === stock.ticker) openStock(stock.ticker);
      else showCard(stock, node);
      return;
    }
    openStock(stock.ticker);
  });
  node.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    if (!narrowMap.matches) return;
    const startX = event.clientX, startY = event.clientY;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      showCard(stock, node);
    }, 500);
    const onMove = (moveEvent) => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 10) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      clearTimeout(pressTimer);
      pressTimer = null;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
  node.addEventListener("contextmenu", (event) => {
    if (narrowMap.matches) event.preventDefault();
  });
}

function tipHTML(stock) {
  const changeClass = stock.chg_pct >= 0 ? "up" : "down";
  return `<div class="tooltip-head"><div><div class="tip-ticker">${stock.ticker}</div><div class="tip-name">${stock.name || stock.ticker}</div></div>${BY.starButton(stock.ticker)}</div><div class="tip-sector">${stock.sector || "—"}</div><div class="tip-price">${BY.money(stock.price)} <span class="${changeClass}">${BY.pct(stock.chg_pct)}</span></div>`;
}

function showTip(stock, clientX, clientY) {
  clearTimeout(tipTimer);
  tip.dataset.ticker = stock.ticker;
  tip.innerHTML = tipHTML(stock);
  tip.style.display = "block";
  placeNearCursor(tip, clientX, clientY);
}

function placeNearCursor(el, clientX, clientY) {
  el.style.left = "0px";
  el.style.top = "0px";
  const width = el.offsetWidth, height = el.offsetHeight;
  let left = clientX + 14, top = clientY + 14;
  if (left + width > innerWidth - 8) left = Math.max(8, clientX - width - 14);
  if (top + height > innerHeight - 8) top = Math.max(8, clientY - height - 14);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function scheduleHideTip() { clearTimeout(tipTimer); tipTimer = setTimeout(hideTip, 160); }
function hideTip() { tip.style.display = "none"; delete tip.dataset.ticker; }

function fillCard(stock) {
  const changeClass = stock.chg_pct >= 0 ? "up" : "down";
  card.dataset.ticker = stock.ticker;
  card.innerHTML = `<div class="tooltip-head"><div><div class="card-ticker">${stock.ticker}</div><div class="card-name">${stock.name || stock.ticker}</div></div>${BY.starButton(stock.ticker)}</div><div class="card-price">${BY.money(stock.price)} <span class="${changeClass}">${BY.pct(stock.chg_pct)}</span></div><a class="button card-open" href="stock.html?t=${encodeURIComponent(stock.ticker)}">Open chart</a>`;
}

function showCard(stock, node) {
  selectedTicker = stock.ticker;
  document.querySelectorAll(".map-node.selected").forEach((el) => el.classList.remove("selected"));
  node.classList.add("selected");
  fillCard(stock);
  card.hidden = false;
  card.style.display = "block";
  anchorCard(node);
}

function anchorCard(node) {
  const rect = node.getBoundingClientRect();
  const width = card.offsetWidth, height = card.offsetHeight;
  let left = rect.left, top = rect.bottom + 8;
  if (top + height > innerHeight - 8) top = rect.top - height - 8;
  if (top < 8) top = 8;
  if (left + width > innerWidth - 8) left = innerWidth - width - 8;
  if (left < 8) left = 8;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function clearSelection() {
  selectedTicker = null;
  document.querySelectorAll(".map-node.selected").forEach((el) => el.classList.remove("selected"));
  card.hidden = true;
  card.style.display = "none";
  card.innerHTML = "";
  delete card.dataset.ticker;
}

function openStock(ticker) {
  location.href = `stock.html?t=${encodeURIComponent(ticker)}`;
}

function bindSectorZoom(el, name) {
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.setAttribute("aria-label", `Zoom into ${name}`);
  el.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    zoomSector(name);
  });
  el.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); zoomSector(name); }
  });
}

function zoomSector(name) {
  focusedSector = name;
  render();
}

function zoomOut() {
  focusedSector = null;
  render();
}

function updateChrome() {
  const back = document.querySelector("#map-back");
  const hint = document.querySelector("#map-hint");
  back.classList.toggle("visible", Boolean(focusedSector));
  back.hidden = !focusedSector;
  if (focusedSector) hint.textContent = `Viewing ${focusedSector}.`;
  else if (narrowMap.matches) hint.textContent = "Tap a box for details, or a sector name to zoom in.";
  else hint.textContent = "Hover any box for details. Click a sector name to zoom in.";
}
