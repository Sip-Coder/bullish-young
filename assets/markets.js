const GLOBALX_DISTRIBUTIONS = "https://www.globalxetfs.com/funds/qyld#distributions";

shell("markets").then(async () => {
  const [markets, dividends] = await Promise.all([
    fetch("data/markets.json").then((r) => r.json()).catch(() => ({ series: {} })),
    fetch("data/markets/QYLD_dividends.json").then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  await Promise.all([
    mountMarket("qyld-root", "QYLD", {
      defaultRange: "1Y",
      defaultInterval: "daily",
      dividends: dividends?.dividends || [],
    }, markets),
    mountMarket("es-root", "ES=F", {
      defaultRange: "1Y",
      defaultInterval: "daily",
    }, markets),
  ]);
  renderDividends(dividends, markets?.series?.QYLD);
});

function slugFor(ticker) {
  return ticker.replace(/=/g, "-");
}

async function loadBars(ticker, kind) {
  const slug = slugFor(ticker);
  const path = kind === "daily" || kind === "weekly"
    ? `data/markets/${slug}_${kind}.json`
    : `data/intraday/${slug}_${kind}.json`;
  const payload = await fetch(path).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (!payload) return kind === "daily" || kind === "weekly" ? [] : null;
  if (payload.t) return BYChart.unpackIntraday(payload);
  return Array.isArray(payload) ? payload : [];
}

async function mountMarket(rootId, ticker, options, markets) {
  const root = document.getElementById(rootId);
  const series = markets?.series?.[ticker] || {};
  const priceEl = root.querySelector(`#${rootId === "qyld-root" ? "qyld" : "es"}-price`);
  const nameEl = root.querySelector(`#${rootId === "qyld-root" ? "qyld" : "es"}-name`);
  if (priceEl) priceEl.textContent = series.price != null ? BY.money(series.price) : "—";
  if (nameEl) nameEl.textContent = series.name || ticker;
  const [daily, weekly, m1, m5, h1] = await Promise.all([
    loadBars(ticker, "daily"),
    loadBars(ticker, "weekly"),
    loadBars(ticker, "1m"),
    loadBars(ticker, "5m"),
    loadBars(ticker, "1h"),
  ]);
  const intraday = {};
  if (m1?.length) intraday["1m"] = m1;
  if (m5?.length) intraday["5m"] = m5;
  if (h1?.length) intraday["1h"] = h1;
  BYChart.mount(root, {
    ticker,
    daily,
    weekly,
    intraday,
    defaultRange: options.defaultRange,
    defaultInterval: options.defaultInterval,
    dividends: options.dividends || [],
    intradayEligible: true,
  });
}

function fmtMoney(value, digits = 2) {
  if (value == null || !Number.isFinite(+value)) return "—";
  return `$${Number(value).toFixed(digits)}`;
}
function fmtPct(value) {
  if (value == null || !Number.isFinite(+value)) return "—";
  return `${Number(value).toFixed(2)}%`;
}
function fmtDate(iso) {
  if (!iso || iso === "N/A") return "—";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}, ${y}`;
}
function tipRow(label, value) {
  if (value == null || value === "" || value === "—") return "";
  return `<div class="tip-row"><span>${label}</span><span>${value}</span></div>`;
}

function renderDividends(payload, series) {
  const chartEl = document.querySelector("#qyld-div-chart");
  const headlines = document.querySelector("#qyld-div-headlines");
  const select = document.querySelector("#qyld-div-range");
  const tip = document.querySelector("#qyld-div-tip");
  const scroller = document.querySelector("#qyld-div-scroll");
  if (!chartEl || !headlines) return;
  if (!payload?.dividends?.length) {
    headlines.innerHTML = `<p class="muted">Dividend history is not available yet.</p>`;
    return;
  }
  const price = series?.price ?? payload.price;
  const priceDate = series?.price_date || payload.price_date;
  const rows = [...payload.dividends]
    .filter((row) => row.amount != null && Number.isFinite(+row.amount) && row.ex_date && row.ex_date !== "N/A")
    .sort((a, b) => a.ex_date.localeCompare(b.ex_date));
  const latest = payload.latest || rows.at(-1);
  const ttmTotal = series?.ttm_total ?? payload.ttm_total;
  const annualized = series?.annualized_payout ?? payload.annualized_payout;
  const ttmYield = price && ttmTotal != null ? (ttmTotal / price) * 100 : payload.ttm_yield;
  const distRate = price && annualized != null ? (annualized / price) * 100 : payload.distribution_rate;
  const gx = series?.globalx || payload.globalx;

  headlines.innerHTML = `
    <div class="dividend-stat">
      <div class="dividend-stat-label">Distribution rate (at market price)</div>
      <div class="dividend-stat-value">${fmtPct(distRate)}</div>
      <div class="dividend-stat-detail">${fmtMoney(latest?.amount, 4)} × 12 = ${fmtMoney(annualized, 4)}${price != null ? ` / ${fmtMoney(price, 2)}` : ""}${priceDate ? ` as of ${fmtDate(priceDate)}` : ""}</div>
    </div>
    <div class="dividend-stat">
      <div class="dividend-stat-label">12-month trailing yield (at market price)</div>
      <div class="dividend-stat-value">${fmtPct(ttmYield)}</div>
      <div class="dividend-stat-detail">${fmtMoney(ttmTotal, 4)} over the last 12 payments${price != null ? ` / ${fmtMoney(price, 2)}` : ""}${priceDate ? ` as of ${fmtDate(priceDate)}` : ""}</div>
    </div>`;

  const maxPct = Math.max(...rows.map((row) => +row.pct || 0), 0.01);

  function visibleRows(range) {
    if (range === "1Y") return rows.slice(-12);
    if (range === "MAX") return rows;
    const years = parseInt(range, 10);
    const end = rows.at(-1)?.ex_date || new Date().toISOString().slice(0, 10);
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() - years);
    const from = d.toISOString().slice(0, 10);
    return rows.filter((row) => row.ex_date >= from);
  }

  function tooltipHtml(row) {
    const parts = [
      tipRow("Ex-date", fmtDate(row.ex_date)),
      tipRow("Record date", fmtDate(row.record_date)),
      tipRow("Payable date", fmtDate(row.payable_date)),
      tipRow("Declared date", fmtDate(row.declared_date)),
      tipRow("Amount", fmtMoney(row.amount, 4)),
      tipRow("Monthly %", fmtPct(row.pct)),
    ];
    return `<div class="tip-title">QYLD distribution</div>${parts.join("")}`;
  }

  function placeTip(event, row) {
    tip.innerHTML = tooltipHtml(row);
    tip.hidden = false;
    const pad = 10;
    let x = event.clientX + 14, y = event.clientY + 14;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - pad) x = event.clientX - w - 12;
    if (y + h > window.innerHeight - pad) y = event.clientY - h - 12;
    tip.style.left = `${Math.max(pad, x)}px`;
    tip.style.top = `${Math.max(pad, y)}px`;
  }

  function render(range) {
    const visible = visibleRows(range);
    chartEl.replaceChildren();
    if (!visible.length) {
      chartEl.innerHTML = `<p class="muted">No distributions in this range.</p>`;
      return;
    }
    chartEl.style.setProperty("--bar-count", String(visible.length));
    visible.forEach((row) => {
      const bar = document.createElement("button");
      bar.type = "button";
      bar.className = "dividend-bar";
      const pct = Number(row.pct) || 0;
      const height = Math.max(8, (pct / maxPct) * 100);
      bar.innerHTML = `<span class="dividend-plot"><span class="dividend-col" style="height:${height}%"></span></span>
        <span class="dividend-label"><span class="dividend-pct">${fmtPct(pct)}</span><span class="dividend-amt">(${fmtMoney(row.amount, 4)})</span></span>
        <span class="dividend-month">${fmtDate(row.ex_date).replace(/, \d{4}$/, "")}</span>`;
      bar.setAttribute("aria-label", `${fmtDate(row.ex_date)} ${fmtPct(pct)} (${fmtMoney(row.amount, 4)})`);
      bar.addEventListener("pointerenter", (event) => placeTip(event, row));
      bar.addEventListener("pointermove", (event) => placeTip(event, row));
      bar.addEventListener("focus", (event) => {
        const rect = bar.getBoundingClientRect();
        placeTip({ clientX: rect.left + rect.width / 2, clientY: rect.top }, row);
      });
      bar.addEventListener("click", (event) => {
        event.preventDefault();
        placeTip(event, row);
      });
      chartEl.append(bar);
    });
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (!tip.hidden && !event.target.closest(".dividend-bar") && !event.target.closest(".dividend-tooltip")) {
      tip.hidden = true;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") tip.hidden = true;
  });
  const hideTip = () => { tip.hidden = true; };
  scroller?.addEventListener("scroll", hideTip, { passive: true });
  window.addEventListener("scroll", hideTip, { passive: true });
  select.onchange = () => render(select.value);
  render(select.value || "1Y");
}
