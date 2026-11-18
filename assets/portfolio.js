const order = [
    "Chips",
    "Chip equipment",
    "AI models and cloud",
    "AI connections",
    "AI power and storage",
  ],
  colors = ["#1769aa", "#6b4cad", "#0a8a3a", "#dc8a14", "#d04b3e", "#7c858e"];
shell("portfolio").then(async () => {
  let b = BY.basket,
    tbody = document.querySelector("tbody"),
    html = "",
    states = {};
  await Promise.all(
    b.positions.map(async (x) => {
      let history = await fetch(`data/history/${x.ticker}.json`).then((r) =>
        r.json(),
      );
      states[x.ticker] = BrooksPA.analyze(history).state.alwaysIn;
    }),
  );
  let label = (s) =>
    s === "long"
      ? "Always in long"
      : s === "short"
        ? "Always in short"
        : "Trading range";
  order.forEach((area) => {
    let rows = b.positions.filter((x) => x.area === area),
      sub = rows.reduce((a, x) => a + x.target_usd, 0);
    rows.forEach(
      (x, i) =>
        (html += `<tr><td class="text">${i ? "" : area}</td><td class="text"><a href="stock.html?t=${x.ticker}">${x.ticker}</a></td><td>${BY.money(x.target_usd)}</td><td>${BY.money(x.entry_price)}</td><td>${BY.money(x.price)}</td><td>${BY.fmt(x.shares)}</td><td>${BY.money(x.first_half_usd)}</td><td>${BY.money(x.second_half_usd)}</td><td class="${x.pct_vs_entry >= 0 ? "up" : "down"}">${BY.pct(x.pct_vs_entry)}</td><td>${BY.money(x.ma50)}</td><td class="${x.pct_vs_ma50 >= 0 ? "up" : "down"}">${BY.pct(x.pct_vs_ma50)}</td><td class="text"><span class="pill ${x.status.includes("Above") ? "green" : x.status.includes("10%") ? "amber" : ""}">${x.status}</span></td><td class="text">${x.flag || "—"}</td><td class="text brooks-ref"><a href="stock.html?t=${x.ticker}&amp;brooks=1">${label(states[x.ticker])}</a></td></tr>`),
    );
    html += `<tr><td class="text" colspan="2"><strong>${area} subtotal</strong></td><td><strong>${BY.money(sub)}</strong></td><td colspan="11"></td></tr>`;
  });
  html += `<tr><td class="text">Cash reserve</td><td class="text">Cash</td><td>${BY.money(b.cash_reserve)}</td><td colspan="11"></td></tr>`;
  tbody.innerHTML = html;
  document.querySelector("tfoot").innerHTML =
    `<tr><td class="text" colspan="2"><strong>Grand total</strong></td><td><strong>${BY.money(b.total)}</strong></td><td colspan="11"></td></tr>`;
  let groups = order.map((a) => [
    a,
    b.positions
      .filter((x) => x.area === a)
      .reduce((n, x) => n + x.target_usd, 0),
  ]);
  groups.push(["Cash reserve", b.cash_reserve]);
  allocation.innerHTML = `<div class="allocation">${groups.map((g, i) => `<span style="width:${(g[1] / b.total) * 100}%;background:${colors[i]}" title="${g[0]} ${BY.money(g[1])}"></span>`).join("")}</div><div class="alloc-legend">${groups.map((g, i) => `<span><i class="dot" style="background:${colors[i]}"></i>${g[0]} ${BY.money(g[1])}</span>`).join("")}</div>`;
});
