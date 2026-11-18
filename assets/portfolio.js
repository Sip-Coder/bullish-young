const order = [
    "Chips",
    "Chip equipment",
    "AI models and cloud",
    "AI connections",
    "AI power and storage",
  ],
  colors = ["#1769aa", "#6b4cad", "#0a8a3a", "#dc8a14", "#d04b3e", "#7c858e"];
let crossFilter = "all", basket = null, states = {};

shell("portfolio").then(async () => {
  basket = BY.basket;
  const wrap = document.querySelector("#cross-filter-wrap");
  if (wrap && window.BYCross) {
    wrap.innerHTML = BYCross.filterControl("cross-filter");
    document.querySelector("#cross-filter").onchange = (event) => {
      crossFilter = event.target.value;
      drawPortfolio();
    };
  }
  await Promise.all(
    basket.positions.map(async (x) => {
      let history = await fetch(`data/history/${x.ticker}.json`).then((r) =>
        r.json(),
      );
      states[x.ticker] = BrooksPA.analyze(history).state.alwaysIn;
    }),
  );
  drawPortfolio();
});

function label(s) {
  return s === "long"
    ? "Always in long"
    : s === "short"
      ? "Always in short"
      : "Trading range";
}

function positionCross(x) {
  return BY.stock(x.ticker)?.cross || null;
}

function drawPortfolio() {
  let b = basket,
    tbody = document.querySelector("tbody"),
    html = "",
    visibleTotal = 0,
    visibleAny = false;
  const COLS = 15;
  order.forEach((area) => {
    let rows = b.positions.filter((x) => x.area === area);
    let shown = rows.filter((x) => !window.BYCross || BYCross.matches(positionCross(x), crossFilter));
    if (!shown.length) return;
    visibleAny = true;
    let sub = shown.reduce((a, x) => a + x.target_usd, 0);
    visibleTotal += sub;
    shown.forEach(
      (x, i) =>
        (html += `<tr><td class="text">${i ? "" : area}</td><td class="text"><a href="stock.html?t=${x.ticker}">${x.ticker}</a></td><td class="star-cell">${BY.starButton(x.ticker)}</td><td>${BY.money(x.target_usd)}</td><td>${BY.money(x.entry_price)}</td><td>${BY.money(x.price)}</td><td>${BY.fmt(x.shares)}</td><td>${BY.money(x.first_half_usd)}</td><td class="${x.pct_vs_entry >= 0 ? "up" : "down"}">${BY.pct(x.pct_vs_entry)}</td><td>${BY.money(x.ma50)}</td><td class="${x.pct_vs_ma50 >= 0 ? "up" : "down"}">${BY.pct(x.pct_vs_ma50)}</td><td class="text"><span class="pill ${x.status.includes("Above") ? "green" : x.status.includes("10%") ? "amber" : ""}">${x.status}</span></td><td class="text">${x.flag || "—"}</td><td class="text cross-col">${window.BYCross ? BYCross.html(positionCross(x)) : "—"}</td><td class="text brooks-ref"><a href="stock.html?t=${x.ticker}&amp;brooks=1">${label(states[x.ticker])}</a></td></tr>`),
    );
    html += `<tr><td class="text" colspan="3"><strong>${area} subtotal</strong></td><td><strong>${BY.money(sub)}</strong></td><td colspan="${COLS - 4}"></td></tr>`;
  });
  if (!visibleAny) {
    html = `<tr><td class="text" colspan="${COLS}">No stocks match this cross filter.</td></tr>`;
  }
  const showCash = crossFilter === "all";
  if (showCash) {
    html += `<tr><td class="text">Cash reserve</td><td class="text">Cash</td><td></td><td>${BY.money(b.cash_reserve)}</td><td colspan="${COLS - 4}"></td></tr>`;
    visibleTotal += b.cash_reserve;
  }
  tbody.innerHTML = html;
  const totalLabel = crossFilter === "all" ? "Grand total" : "Filtered total";
  const totalValue = crossFilter === "all" ? b.total : visibleTotal;
  document.querySelector("tfoot").innerHTML =
    `<tr><td class="text" colspan="3"><strong>${totalLabel}</strong></td><td><strong>${BY.money(totalValue)}</strong></td><td colspan="${COLS - 4}"></td></tr>`;
  let groups = order.map((a) => [
    a,
    b.positions
      .filter((x) => x.area === a)
      .reduce((n, x) => n + x.target_usd, 0),
  ]);
  groups.push(["Cash reserve", b.cash_reserve]);
  allocation.innerHTML = `<div class="allocation">${groups.map((g, i) => `<span style="width:${(g[1] / b.total) * 100}%;background:${colors[i]}" title="${g[0]} ${BY.money(g[1])}"></span>`).join("")}</div><div class="alloc-legend">${groups.map((g, i) => `<span><i class="dot" style="background:${colors[i]}"></i>${g[0]} ${BY.money(g[1])}</span>`).join("")}</div>`;
}
