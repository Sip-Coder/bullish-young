/**
 * Al Brooks price action indicator for TradingView Lightweight Charts.
 * Input: candles [{time, open, high, low, close}] oldest first (daily works fine).
 * Output: { ema20: [{time, value}], markers: [...], state: {...} }
 *
 * Concepts (Brooks Trading Course, brookstradingcourse.com/brooks-price-action-abbreviations/):
 *  - EMA: 20-bar exponential moving average, his one chart indicator.
 *  - Trend bar vs doji: body >= 50% of range = trend bar; body <= 25% = doji (range bar).
 *  - Always In: direction a trader would be in if forced to hold a position. Here: flips long on
 *    2 consecutive bull trend bars closing above the EMA (or a bull trend bar closing above the
 *    prior 10-bar high), flips short on the mirror image.
 *  - H1/H2/H3 (L1/L2/L3): in an Always In Long market, after a pullback starts (a bar with a lower
 *    high), each bar whose high goes above the prior bar's high counts up; a new leg down (bar with
 *    a lower low) is required between counts. H2 = two-legged pullback buy, H3 = wedge bull flag.
 *    The bar before the trigger is the signal bar.
 *  - Signal bar quality: a good bull signal bar closes in its upper third (bear: lower third).
 *  - EMA test: the pullback touched or came within 1% of the EMA, Brooks' classic H2/L2 location.
 */
(function (root) {
  function ema(vals, n) {
    const k = 2 / (n + 1), out = [];
    vals.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
    return out;
  }
  function analyze(c, opts = {}) {
    const n = opts.emaLength || 20, near = opts.emaNearPct ?? 0.01;
    const e = ema(c.map(b => b.close), n);
    const markers = [];
    const bar = b => {
      const r = b.high - b.low || 1e-9, body = Math.abs(b.close - b.open);
      return { r, body, bull: b.close > b.open && body / r >= 0.5, bear: b.close < b.open && body / r >= 0.5,
               doji: body / r <= 0.25, closePos: (b.close - b.low) / r };
    };
    let ai = 0;               // Always In: 1 long, -1 short, 0 unclear
    let count = 0, inPB = false, needLeg = false, pbExtreme = null, pbTouchedEma = false, trendExtreme = null;
    for (let i = 1; i < c.length; i++) {
      const b = c[i], p = c[i - 1], B = bar(b), P = bar(p);
      const hi10 = Math.max(...c.slice(Math.max(0, i - 10), i).map(x => x.high));
      const lo10 = Math.min(...c.slice(Math.max(0, i - 10), i).map(x => x.low));
      const prevAi = ai;
      if ((B.bull && P.bull && b.close > e[i] && p.close > e[i - 1]) || (B.bull && b.close > hi10)) ai = 1;
      if ((B.bear && P.bear && b.close < e[i] && p.close < e[i - 1]) || (B.bear && b.close < lo10)) ai = -1;
      if (ai !== prevAi) {
        markers.push({ time: b.time, position: ai > 0 ? 'belowBar' : 'aboveBar', color: ai > 0 ? '#16a34a' : '#dc2626',
                       shape: 'circle', text: ai > 0 ? 'AIL' : 'AIS' });
        count = 0; inPB = false; needLeg = false; trendExtreme = ai > 0 ? b.high : b.low;
        continue;
      }
      if (ai === 0) continue;
      const s = ai; // 1 long (count H), -1 short (count L)
      const newExtreme = s > 0 ? b.high > trendExtreme : b.low < trendExtreme;
      if (newExtreme && !(inPB && count > 0 && !needLeg)) {
        trendExtreme = s > 0 ? b.high : b.low; count = 0; inPB = false; needLeg = false; pbTouchedEma = false;
      }
      const startsPB = s > 0 ? b.high < p.high : b.low > p.low;
      if (!inPB && startsPB) { inPB = true; needLeg = false; pbTouchedEma = false; pbExtreme = s > 0 ? b.low : b.high; }
      if (!inPB) continue;
      pbExtreme = s > 0 ? Math.min(pbExtreme, b.low) : Math.max(pbExtreme, b.high);
      if (s > 0 ? b.low <= e[i] * (1 + near) : b.high >= e[i] * (1 - near)) pbTouchedEma = true;
      if (needLeg && (s > 0 ? b.low < p.low : b.high > p.high)) needLeg = false;   // new leg of the pullback
      const trigger = s > 0 ? b.high > p.high : b.low < p.low;
      if (trigger && !needLeg) {
        count++; needLeg = true;
        if (count >= 1 && count <= 4) {
          const goodSignal = s > 0 ? P.closePos >= 0.66 : P.closePos <= 0.34;
          const label = (s > 0 ? 'H' : 'L') + count;
          const strong = count >= 2 && goodSignal && pbTouchedEma;
          markers.push({ time: b.time, position: s > 0 ? 'belowBar' : 'aboveBar',
            color: strong ? (s > 0 ? '#16a34a' : '#dc2626') : '#9ca3af',
            shape: count >= 2 ? (s > 0 ? 'arrowUp' : 'arrowDown') : 'circle',
            text: label + (count === 3 ? ' wedge' : '') + (strong ? '' : '') ,
            meta: { setup: label, goodSignalBar: goodSignal, emaTest: pbTouchedEma, strong,
                    signalBarTime: p.time, entry: s > 0 ? p.high : p.low, stop: s > 0 ? pbExtreme : pbExtreme } });
        }
      }
    }
    const last = c.length - 1;
    return {
      ema20: c.map((b, i) => ({ time: b.time, value: +e[i].toFixed(2) })),
      markers,
      state: { alwaysIn: ai > 0 ? 'long' : ai < 0 ? 'short' : 'unclear', pullbackCount: count,
               aboveEma: c[last].close > e[last], ema20: +e[last].toFixed(2) },
    };
  }
  const api = { analyze, ema };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BrooksPA = api;
})(this);
