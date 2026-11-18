const narrowMap = matchMedia("(max-width: 700px)");
let selectedTicker = null;

shell("map").then(render);
addEventListener("resize", () => {
  clearTimeout(window.rt);
  window.rt = setTimeout(render, 100);
});

function render() {
  const box = document.querySelector("#treemap"), tip = document.querySelector("#tip"), stocks = BY.stats.stocks.filter((s) => s.market_cap > 0), groups = d3.group(stocks, (s) => s.sector || "Other");
  box.innerHTML = "";
  selectedTicker = null;
  updateInfo();
  if (narrowMap.matches) {
    box.classList.add("treemap-stacked");
    [...groups].sort((a, b) => d3.sum(b[1], (s) => s.market_cap) - d3.sum(a[1], (s) => s.market_cap)).forEach(([name, children]) => {
      const section = document.createElement("section"), header = document.createElement("h2"), canvas = document.createElement("div");
      section.className = "map-sector";
      header.className = "sector-heading";
      header.textContent = name;
      header.title = name;
      canvas.className = "sector-map";
      canvas.style.height = `${Math.min(820, Math.max(140, 56 + children.length * 34))}px`;
      section.append(header, canvas);
      box.append(section);
      drawTree(canvas, children, tip);
    });
  } else {
    box.classList.remove("treemap-stacked");
    const root = d3.hierarchy({ children: [...groups].map(([name, children]) => ({ name, children })) }).sum((d) => d.market_cap || 0).sort((a, b) => b.value - a.value);
    d3.treemap().tile(d3.treemapSquarify).size([box.clientWidth, box.clientHeight]).paddingOuter(2).paddingTop((d) => (d.depth === 1 ? 18 : 0)).paddingInner(1)(root);
    root.children.forEach((g) => {
      const label = document.createElement("div");
      label.className = "sector-label";
      label.textContent = g.data.name;
      label.title = g.data.name;
      label.style.cssText = `left:${g.x0 + 3}px;top:${g.y0 + 2}px;max-width:${Math.max(0, g.x1 - g.x0 - 6)}px`;
      box.append(label);
    });
    drawLeaves(box, root.leaves(), tip);
  }
}

function drawTree(canvas, stocks, tip) {
  const root = d3.hierarchy({ children: stocks }).sum((d) => d.market_cap || 0).sort((a, b) => b.value - a.value);
  d3.treemap().tile(d3.treemapSquarify).size([canvas.clientWidth, canvas.clientHeight]).paddingOuter(1).paddingInner(1)(root);
  drawLeaves(canvas, root.leaves(), tip);
}

function drawLeaves(box, leaves, tip) {
  const color = d3.scaleLinear().domain([-3, 0, 3]).range(["#d0282e", "#858b91", "#0a8a3a"]).clamp(true);
  leaves.forEach((d) => {
    const s = d.data, w = d.x1 - d.x0, h = d.y1 - d.y0, node = document.createElement("div"), mobile = narrowMap.matches;
    const font = mobile ? Math.max(11, Math.min(22, Math.floor(Math.min(w / 3.2, h / 2.4)))) : 13;
    const showTicker = mobile ? w > 28 && h > 18 : w > 42 && h > 26;
    const showPct = mobile ? w > 32 && h > font + 14 : w > 65 && h > 40;
    node.className = "map-node";
    node.tabIndex = 0;
    node.setAttribute("role", "link");
    node.setAttribute("aria-label", `${s.ticker}, ${s.name || s.ticker}, ${BY.pct(s.chg_pct)}`);
    node.style.cssText = `left:${d.x0}px;top:${d.y0}px;width:${w}px;height:${h}px;background:${color(s.chg_pct || 0)}${mobile ? `;font-size:${font}px` : ""}`;
    if (showTicker) node.innerHTML = `<span>${s.ticker}</span>${showPct ? `<small${mobile ? ` style="font-size:${Math.max(11, Math.round(font * 0.72))}px"` : ""}>${BY.pct(s.chg_pct)}</small>` : ""}`;
    node.onclick = () => {
      if (narrowMap.matches && selectedTicker !== s.ticker) {
        selectedTicker = s.ticker;
        updateInfo(s);
        return;
      }
      location.href = `stock.html?t=${encodeURIComponent(s.ticker)}`;
    };
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); node.click(); }
    };
    node.onmousemove = (e) => {
      if (narrowMap.matches) return;
      tip.style.display = "block";
      tip.style.left = `${e.clientX + 12}px`;
      tip.style.top = `${e.clientY + 12}px`;
      tip.innerHTML = `${s.name || s.ticker}<br>${BY.money(s.price)} &nbsp; ${BY.change(s.change)} (${BY.pct(s.chg_pct)})<br>Mkt Cap ${BY.big(s.market_cap)}`;
    };
    node.onmouseleave = () => (tip.style.display = "none");
    box.append(node);
  });
}

function updateInfo(s) {
  const info = document.querySelector("#map-info");
  if (!s) { info.hidden = true; info.innerHTML = ""; return; }
  info.hidden = false;
  info.innerHTML = `<span><strong>${s.ticker}</strong> · ${s.name || s.ticker} · <span class="${s.chg_pct >= 0 ? "up" : "down"}">${BY.pct(s.chg_pct)}</span></span><a href="stock.html?t=${encodeURIComponent(s.ticker)}">View stock</a>`;
}
