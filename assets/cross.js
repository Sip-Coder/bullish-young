(() => {
  "use strict";

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const FILTERS = [
    { value: "all", label: "All" },
    { value: "gc30", label: "Golden cross (≤30 trading days)" },
    { value: "gc90", label: "Golden cross (≤90 trading days)" },
    { value: "dc30", label: "Death cross (≤30 trading days)" },
    { value: "dc90", label: "Death cross (≤90 trading days)" },
    { value: "above", label: "50-day above the 200-day" },
    { value: "near", label: "Within 3% of a cross" },
  ];

  function fmtDate(iso) {
    if (!iso) return "—";
    const [y, m, d] = String(iso).split("-");
    if (!y || !m || !d) return iso;
    return `${MONTHS[Number(m) - 1]} ${Number(d)}, ${y}`;
  }

  function gapWords(cross) {
    if (cross?.gap_pct == null || !Number.isFinite(+cross.gap_pct)) return null;
    const abs = Math.abs(+cross.gap_pct).toFixed(1);
    if (cross.state === "above") return `50 is ${abs}% above 200`;
    if (cross.state === "below") return `50 is ${abs}% below 200`;
    return "50 is even with 200";
  }

  function label(cross) {
    if (!cross || !cross.enough_history) {
      return { text: "Not enough history", className: "cross-muted" };
    }
    const rel = gapWords(cross);
    if (!cross.type || !cross.date) {
      return {
        text: rel ? `No cross in available history · ${rel}` : "No cross in available history",
        className: "cross-muted",
      };
    }
    const kind = cross.type === "golden" ? "Golden cross" : "Death cross";
    const days = cross.trading_days_since;
    const daysPart = days == null ? "" : ` (${days} trading day${days === 1 ? "" : "s"})`;
    return {
      text: `${kind} · ${fmtDate(cross.date)}${daysPart}${rel ? ` · ${rel}` : ""}`,
      className: cross.type === "golden" ? "cross-golden" : "cross-death",
    };
  }

  function html(cross) {
    const info = label(cross);
    return `<span class="${info.className}">${info.text}</span>`;
  }

  function matches(cross, filter) {
    if (!filter || filter === "all") return true;
    if (!cross || !cross.enough_history) return false;
    const days = cross.trading_days_since;
    if (filter === "gc30") return cross.type === "golden" && days != null && days <= 30;
    if (filter === "gc90") return cross.type === "golden" && days != null && days <= 90;
    if (filter === "dc30") return cross.type === "death" && days != null && days <= 30;
    if (filter === "dc90") return cross.type === "death" && days != null && days <= 90;
    if (filter === "above") return cross.state === "above";
    if (filter === "near") return cross.gap_pct != null && Math.abs(+cross.gap_pct) <= 3;
    return true;
  }

  function isBuy(kind) {
    return kind === "BUY" || kind === "Dip buy";
  }

  function tags(cross, signalKind) {
    const out = [];
    if (!cross || !cross.enough_history) return out;
    const days = cross.trading_days_since;
    if (cross.type === "golden" && days != null && days <= 30 && isBuy(signalKind)) {
      out.push({ text: "Golden cross", className: "signal-tag signal-tag-gc" });
    }
    if (cross.type === "death" && days != null && days <= 30) {
      out.push({ text: "Caution", className: "signal-tag signal-tag-caution" });
    }
    return out;
  }

  function tagsHtml(cross, signalKind) {
    return tags(cross, signalKind)
      .map((t) => `<span class="${t.className}">${t.text}</span>`)
      .join("");
  }

  function filterControl(id) {
    const options = FILTERS.map((f) => `<option value="${f.value}">${f.label}</option>`).join("");
    return `<div class="filters cross-filters"><label>Cross filter<select id="${id}">${options}</select></label><span class="filter-note">Day counts are trading days, not calendar days.</span></div>`;
  }

  window.BYCross = { FILTERS, fmtDate, label, html, matches, tags, tagsHtml, filterControl, gapWords };
})();
