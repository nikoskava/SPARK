/* SPARK core: phage x antibiotic interaction analysis.
 * JavaScript port of spark_app_v3.py (analysis part). Pure functions, no DOM.
 * Works in the browser (window.SparkCore) and in Node (module.exports) for testing.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SparkCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const APP_VERSION = "8.0";
  const KINDS = ["Control", "Phage", "Antibiotic", "Combo"];
  const HEADER_RE = /^\s*(control|phage|antibiotic|combo)\s*(\d+)?\s*r\s*(\d+)\s*$/i;

  // ------------------------------------------------------------------ layout
  function colName(kind, rep, conc) {
    if (kind === "Control" || kind === "Phage") return `${kind} r${rep}`;
    return `${kind} ${conc} r${rep}`;
  }

  function gridColumns(nReps, nConc) {
    const cols = ["Time"];
    for (let r = 1; r <= nReps; r++) cols.push(colName("Control", r));
    for (let r = 1; r <= nReps; r++) cols.push(colName("Phage", r));
    for (let c = 1; c <= nConc; c++) {
      for (let r = 1; r <= nReps; r++) cols.push(colName("Antibiotic", r, c));
      for (let r = 1; r <= nReps; r++) cols.push(colName("Combo", r, c));
    }
    return cols;
  }

  function parseHeader(h) {
    const m = HEADER_RE.exec(String(h));
    if (!m) return null;
    const kind = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    let conc = m[2] ? parseInt(m[2], 10) : null;
    const rep = parseInt(m[3], 10);
    if ((kind === "Antibiotic" || kind === "Combo") && conc === null) conc = 1;
    if (kind === "Control" || kind === "Phage") conc = null;
    return { kind, conc, rep };
  }

  const isBlank = (v) => v === null || v === undefined || (typeof v === "number" && isNaN(v)) || String(v).trim() === "";

  // ------------------------------------------------------------------ parsing
  const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  function toNumber(v) {
    if (typeof v === "number") return v;
    if (isBlank(v)) return NaN;
    const t = String(v).replace(/ /g, "").replace(/ /g, "").replace(/,/g, ".");
    if (!NUM_RE.test(t)) {
      const low = t.toLowerCase();
      if (low === "nan") return NaN;
      return NaN;
    }
    return parseFloat(t);
  }

  const TIME_UNITS = ["Auto-detect", "h:mm:ss", "Hours", "Minutes", "Seconds", "Days (Excel serial)"];
  const UNIT_TO_HOURS = { Hours: 1, Minutes: 1 / 60, Seconds: 1 / 3600, "Days (Excel serial)": 24 };

  function clockToSeconds(v) {
    if (isBlank(v)) return NaN;
    let s = String(v).trim().replace(/,/g, ".");
    let days = 0;
    let m = /^(\d+)\s*days?\s*,?\s*(.*)$/i.exec(s);
    if (m) { days = parseInt(m[1], 10); s = m[2]; }
    else if ((m = /^(\d+)\.(\d+:\d+(:\d+(\.\d+)?)?)$/.exec(s))) { days = parseInt(m[1], 10); s = m[2]; }
    const neg = s.startsWith("-");
    if (neg) s = s.slice(1);
    m = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(s);
    if (!m) return NaN;
    const secs = days * 86400 + parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + (m[3] ? parseFloat(m[3]) : 0);
    return neg ? -secs : secs;
  }

  function parseTime(raw, unit) {
    const nonBlank = raw.filter((v) => !isBlank(v));
    if (!nonBlank.length) return { hours: raw.map(() => NaN), how: "no time values" };
    const clockFrac = nonBlank.filter((v) => String(v).includes(":")).length / nonBlank.length;
    if (unit === "h:mm:ss" || (unit === "Auto-detect" && clockFrac > 0.5)) {
      return { hours: raw.map((v) => clockToSeconds(v) / 3600), how: "h:mm:ss" };
    }
    const nums = raw.map(toNumber);
    if (UNIT_TO_HOURS[unit] !== undefined) return { hours: nums.map((x) => x * UNIT_TO_HOURS[unit]), how: unit.toLowerCase() };
    const finite = nums.filter(Number.isFinite);
    const mx = finite.length ? Math.max(...finite) : 0;
    const guess = mx <= 100 ? "Hours" : mx <= 6000 ? "Minutes" : "Seconds";
    return { hours: nums.map((x) => x * UNIT_TO_HOURS[guess]), how: `${guess.toLowerCase()} (auto-detected from the largest value, ${fmtG(mx)})` };
  }

  // ------------------------------------------------------------------ numerics
  function fmtG(x, p = 6) {
    if (!Number.isFinite(x)) return String(x);
    return String(parseFloat(x.toPrecision(p)));
  }
  function fmt3g(x) { return fmtG(x, 3); }

  function trapz(y, x) {
    if (y.length < 2) return NaN;
    let s = 0;
    for (let i = 1; i < y.length; i++) s += 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
    return s;
  }
  function cumtrapz(y, x) {
    const out = new Array(y.length).fill(0);
    for (let i = 1; i < y.length; i++) out[i] = out[i - 1] + 0.5 * (y[i] + y[i - 1]) * (x[i] - x[i - 1]);
    return out;
  }
  function nanMean(stack) { // stack: array of arrays (rows = replicates)
    const n = stack[0].length, out = new Array(n);
    for (let j = 0; j < n; j++) {
      let s = 0, k = 0;
      for (const row of stack) if (Number.isFinite(row[j])) { s += row[j]; k++; }
      out[j] = k ? s / k : NaN;
    }
    return out;
  }
  function nanSd(stack) {
    const n = stack[0].length, out = new Array(n);
    for (let j = 0; j < n; j++) {
      const v = stack.map((r) => r[j]).filter(Number.isFinite);
      if (v.length < 2) { out[j] = NaN; continue; }
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      out[j] = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    }
    return out;
  }
  function nanCount(stack) {
    const n = stack[0].length, out = new Array(n);
    for (let j = 0; j < n; j++) out[j] = stack.reduce((a, r) => a + (Number.isFinite(r[j]) ? 1 : 0), 0);
    return out;
  }
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

  // Student t distribution (regularized incomplete beta, Lentz continued fraction)
  function lgamma(x) {
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    const FPMIN = 1e-300;
    let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-15) break;
    }
    return h;
  }
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function tCdf(t, df) {
    const x = df / (df + t * t);
    const p = 0.5 * ibeta(x, df / 2, 0.5);
    return t >= 0 ? 1 - p : p;
  }
  function tPpf(p, df) {
    let lo = 0, hi = 1;
    while (tCdf(hi, df) < p) hi *= 2;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (tCdf(mid, df) < p) lo = mid; else hi = mid;
      if (hi - lo < 1e-13) break;
    }
    return (lo + hi) / 2;
  }
  function ttestP(x) {
    if (x.length < 2) return NaN;
    if (x.every((v) => Math.abs(v - x[0]) <= 1e-8 + 1e-5 * Math.abs(x[0]))) return NaN;
    const t = mean(x) / (sd(x) / Math.sqrt(x.length));
    return 2 * (1 - tCdf(Math.abs(t), x.length - 1));
  }

  // ------------------------------------------------------------------ analysis
  function label(settings, c) { return (settings.concLabels && settings.concLabels[c]) || `Conc ${c}`; }

  /**
   * grid: { columns: [...], rows: [[...], ...] } of text cells (first column = Time)
   * settings: { experiment, phageName, antibioticName, concLabels: {1: "...", ...}, timeUnit, evenSpacing }
   */
  function analyze(grid, nReps, nConc, settings) {
    const s = Object.assign({ experiment: "", phageName: "Phage", antibioticName: "Antibiotic", concLabels: {},
      timeUnit: "Auto-detect", evenSpacing: false }, settings || {});
    const warns = [], info = [];
    const nRows = grid.rows.length;
    const colIdx = {};
    grid.columns.forEach((c, i) => { colIdx[c] = i; });

    // ---- values
    let values = {};
    grid.columns.slice(1).forEach((c) => {
      if (!parseHeader(c)) return;
      const i = colIdx[c];
      const raw = grid.rows.map((r) => r[i]);
      const num = raw.map(toNumber);
      const badIdx = raw.map((v, k) => !isBlank(v) && isNaN(num[k]));
      const nBad = badIdx.filter(Boolean).length;
      if (nBad) warns.push(`${c}: ${nBad} non-numeric cell(s) ignored (e.g. '${String(raw[badIdx.indexOf(true)])}').`);
      values[c] = num;
    });

    // ---- time
    let { hours: tH, how } = parseTime(grid.rows.map((r) => r[0]), s.timeUnit);
    const hasData = new Array(nRows).fill(false);
    for (const v of Object.values(values)) v.forEach((x, k) => { if (Number.isFinite(x)) hasData[k] = true; });
    const noTime = hasData.map((h, k) => h && !Number.isFinite(tH[k]));
    const nNoTime = noTime.filter(Boolean).length;
    if (nNoTime) {
      const rows = noTime.map((b, k) => (b ? k + 1 : 0)).filter(Boolean).slice(0, 5);
      warns.push(`${nNoTime} row(s) have data but no readable time and were dropped (rows ${rows.join(", ")}${nNoTime > 5 ? "…" : ""}).`);
    }
    const keep = tH.map((t, k) => Number.isFinite(t) && hasData[k]);
    if (keep.filter(Boolean).length < 2) throw new Error("Need at least two rows with both a time value and data.");
    const sel = (a) => a.filter((_, k) => keep[k]);
    tH = sel(tH);
    for (const k of Object.keys(values)) values[k] = sel(values[k]);

    const diff = (a) => a.slice(1).map((x, i) => x - a[i]);
    if (how === "h:mm:ss" && diff(tH).some((d) => d < 0)) {
      let shift = 0;
      const out = tH.slice();
      for (let i = 1; i < out.length; i++) {
        if (tH[i] + shift < out[i - 1]) shift += 24;
        out[i] = tH[i] + shift;
      }
      tH = out;
      warns.push("Time went backwards (clock passing midnight); 24 h was added from that point on.");
    }
    if (diff(tH).some((d) => d < 0)) {
      const order = tH.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((p) => p[1]);
      tH = order.map((i) => tH[i]);
      for (const k of Object.keys(values)) values[k] = order.map((i) => values[k][i]);
      warns.push("Time values were not in increasing order; rows were sorted by time.");
    }
    const nRepeat = diff(tH).filter((d) => d === 0).length;
    if (nRepeat) warns.push(`${nRepeat} repeated time value(s); those intervals add nothing to AUC.`);

    const diffs = diff(tH);
    const pos = diffs.filter((d) => d > 0).sort((a, b) => a - b);
    const step = pos.length ? (pos.length % 2 ? pos[(pos.length - 1) / 2] : (pos[pos.length / 2 - 1] + pos[pos.length / 2]) / 2) : NaN;
    if (s.evenSpacing) {
      tH = tH.map((_, i) => i * step);
      how += "; replaced by an evenly spaced grid";
    } else if (pos.length) {
      const nIrr = diffs.filter((d) => Math.abs(d - step) > 0.1 * step).length;
      if (nIrr) info.push(`${nIrr} read interval(s) differ from the typical ${fmt3g(step * 60)} min step; real times are used, so AUCs account for it.`);
    }
    const T = tH.length;
    const timeNote = `Time read as ${how}: ${T} points, ${fmt3g(tH[0])}–${fmtG(tH[T - 1], 4)} h, typical step ${fmt3g(step * 60)} min.`;

    const get = (kind, rep, conc) => {
      const v = values[colName(kind, rep, conc)];
      if (!v || !v.some(Number.isFinite)) return null;
      return v;
    };

    const repsFound = [];
    for (let r = 1; r <= nReps; r++) {
      let any = false;
      for (const k of KINDS) {
        const cl = k === "Control" || k === "Phage" ? [null] : Array.from({ length: nConc }, (_, i) => i + 1);
        for (const c of cl) if (get(k, r, c)) any = true;
      }
      if (any) repsFound.push(r);
    }
    const concs = [];
    for (let c = 1; c <= nConc; c++) if (repsFound.some((r) => get("Antibiotic", r, c) || get("Combo", r, c))) concs.push(c);
    if (!repsFound.length) throw new Error("The table has no data.");
    if (!concs.length) throw new Error("No antibiotic / combination columns contain data.");
    info.push(`Replicates with data: ${repsFound.map((r) => "r" + r).join(", ")}.`);

    // ---- normalization
    const norm = {};
    const normOrder = [];
    for (const r of repsFound) {
      const ctrl = get("Control", r);
      if (!ctrl) {
        warns.push(`Replicate r${r}: no Control (untreated growth) data, so r${r} cannot be normalized and is excluded.`);
        continue;
      }
      const nb = ctrl.filter((x) => Number.isFinite(x) && x <= 0).length;
      if (nb) warns.push(`Control r${r}: ${nb} value(s) ≤ 0; fractions at those times set to blank.`);
      const denom = ctrl.map((x) => (x > 0 ? x : NaN));
      for (const [kind, cl] of [["Phage", [null]], ["Antibiotic", concs], ["Combo", concs]]) {
        for (const c of cl) {
          const v = get(kind, r, c);
          if (v) { const k = colName(kind, r, c); norm[k] = v.map((x, i) => x / denom[i]); normOrder.push(k); }
        }
      }
    }

    // ---- per replicate x concentration
    const perRep = [];
    const curves = {};
    const rollCols = {};
    const rollOrder = [];
    const nFinite = (a) => (a ? a.filter(Number.isFinite).length : 0);
    for (const c of concs) {
      const lab = label(s, c);
      const series = { Antibiotic: [], Phage: [], Combo: [], Expected: [] };
      const repCols = [];
      for (const r of repsFound) {
        const parts = { Antibiotic: norm[colName("Antibiotic", r, c)], Phage: norm[colName("Phage", r)], Combo: norm[colName("Combo", r, c)] };
        let missing = Object.keys(parts).filter((k) => nFinite(parts[k]) < 2);
        if (!(colName("Phage", r) in norm) && !get("Control", r)) missing = ["Control"].concat(missing);
        if (missing.length) {
          if (get("Control", r)) warns.push(`${lab}, r${r}: excluded, missing ${missing.join(", ")}.`);
          perRep.push({ Concentration: lab, Replicate: `r${r}`, Included: "no", Reason: "missing " + missing.join(", ") });
          continue;
        }
        const fA = parts.Antibiotic, fP = parts.Phage, fC = parts.Combo;
        const exp = fA.map((a, i) => a * fP[i]);
        const mask = fC.map((x, i) => Number.isFinite(x) && Number.isFinite(exp[i]));
        const either = fC.filter((x, i) => Number.isFinite(x) || Number.isFinite(exp[i])).length;
        const nMask = mask.filter(Boolean).length;
        const nDrop = either - nMask;
        if (nDrop) warns.push(`${lab}, r${r}: ${nDrop} time point(s) where only one of measured/expected exists were left out of both AUCs.`);
        if (nMask < 2) {
          warns.push(`${lab}, r${r}: fewer than 2 usable time points; excluded.`);
          perRep.push({ Concentration: lab, Replicate: `r${r}`, Included: "no", Reason: "fewer than 2 usable time points" });
          continue;
        }
        const pick = (a, m) => a.filter((_, i) => m[i]);
        const tm = pick(tH, mask);
        const aucC = trapz(pick(fC, mask), tm), aucE = trapz(pick(exp, mask), tm);
        const mA = fA.map(Number.isFinite), mP = fP.map(Number.isFinite);
        const dur = tm[tm.length - 1] - tm[0];
        const d = aucC - aucE;
        perRep.push({
          Concentration: lab, Replicate: `r${r}`, Included: "yes", Reason: "",
          "Time span (h)": dur,
          [`AUC ${s.antibioticName} alone`]: trapz(pick(fA, mA), pick(tH, mA)),
          [`AUC ${s.phageName} alone`]: trapz(pick(fP, mP), pick(tH, mP)),
          "AUC combination (measured)": aucC,
          "AUC SPARK expected": aucE,
          "ΔAUC (h)": d,
          "ΔAUC (% of expected)": aucE ? (100 * d) / aucE : NaN,
          "Mean Δ growth (fraction of control)": dur ? d / dur : NaN,
        });
        const arrs = { Antibiotic: fA, Phage: fP, Combo: fC, Expected: exp };
        for (const key of ["Antibiotic", "Phage", "Combo", "Expected"]) {
          series[key].push(arrs[key]);
          repCols.push([`${key} r${r}`, arrs[key]]);
        }
        const roll = new Array(T).fill(NaN);
        const cc = cumtrapz(pick(fC, mask), tm), ce = cumtrapz(pick(exp, mask), tm);
        let j = 0;
        mask.forEach((m, i) => { if (m) { roll[i] = cc[j] - ce[j]; j++; } });
        rollCols[`${lab} r${r}`] = roll;
        rollOrder.push(`${lab} r${r}`);
      }
      const cdf = { columns: ["Time (h)"], data: { "Time (h)": tH } };
      const add = (name, arr) => { cdf.columns.push(name); cdf.data[name] = arr; };
      for (const key of ["Antibiotic", "Phage", "Combo", "Expected"]) {
        const st = series[key];
        if (st.length) {
          add(`${key} mean`, nanMean(st));
          add(`${key} SD`, nanSd(st));
          add(`${key} n`, nanCount(st));
        }
      }
      // replicate columns in the order: Antibiotic r1.., Phage r1.., Combo r1.., Expected r1.. per replicate insertion
      // (matches pandas dict insertion order: per replicate, Antibiotic, Phage, Combo, Expected)
      for (const [name, arr] of repCols) add(name, arr);
      curves[c] = cdf;
    }

    // ---- summary
    const summary = [];
    for (const c of concs) {
      const lab = label(s, c);
      const sub = perRep.filter((p) => p.Concentration === lab && p.Included === "yes");
      const x = sub.map((p) => p["ΔAUC (h)"]);
      const n = x.length;
      const m = n ? mean(x) : NaN;
      const sdev = n > 1 ? sd(x) : NaN;
      const sem = n > 1 ? sdev / Math.sqrt(n) : NaN;
      const half = n > 1 ? tPpf(0.975, n - 1) * sem : NaN;
      const lo = m - half, hi = m + half;
      const p = n > 1 ? ttestP(x) : NaN;
      let call;
      if (n < 2) call = "n < 2: no call";
      else if (hi < 0) call = "Synergy";
      else if (lo > 0) call = "Antagonism";
      else call = "No significant interaction";
      const pct = sub.map((q) => q["ΔAUC (% of expected)"]);
      summary.push({
        Concentration: lab, n,
        "ΔAUC mean (h)": m, "ΔAUC SD": sdev, "ΔAUC SEM": sem,
        "95% CI low": lo, "95% CI high": hi, "p (t-test vs 0)": p,
        "ΔAUC % of expected (mean)": n ? mean(pct) : NaN,
        "AUC measured (mean)": n ? mean(sub.map((q) => q["AUC combination (measured)"])) : NaN,
        "AUC expected (mean)": n ? mean(sub.map((q) => q["AUC SPARK expected"])) : NaN,
        "Call (SPARK)": call,
      });
      if (n > 0 && n < 3) warns.push(`${lab}: only ${n} usable replicate(s); confidence interval is very wide or undefined.`);
    }

    // ---- rolling
    const rolling = { columns: ["Time (h)"], data: { "Time (h)": tH } };
    const addR = (name, arr) => { rolling.columns.push(name); rolling.data[name] = arr; };
    for (const c of concs) {
      const lab = label(s, c);
      const reps = rollOrder.filter((k) => k.startsWith(lab + " r"));
      if (!reps.length) continue;
      const st = reps.map((k) => rollCols[k]);
      addR(`${lab} ΔAUC mean`, nanMean(st));
      addR(`${lab} ΔAUC SD`, nanSd(st));
      addR(`${lab} n`, nanCount(st));
    }
    for (const k of rollOrder) addR(`${k} ΔAUC`, rollCols[k]);

    // ---- normalized + raw
    const normalized = { columns: ["Time (h)"], data: { "Time (h)": tH } };
    for (const k of normOrder) { normalized.columns.push(k + " / Control"); normalized.data[k + " / Control"] = norm[k]; }
    const raw = { columns: ["Time (h)"], data: { "Time (h)": tH } };
    for (const c of grid.columns.slice(1)) {
      if (values[c] && values[c].some(Number.isFinite)) { raw.columns.push(c); raw.data[c] = values[c]; }
    }

    return { timeH: tH, timeNote, repsFound, concs, perRep, summary, curves, rolling, normalized, raw,
      warnings: warns, info, settings: s };
  }

  // ------------------------------------------------------------------ table import
  function tableToGrid(aoa) {
    // aoa: array of rows of cell text (already converted), first row = headers
    const notes = [];
    const rows = aoa.filter((r) => r && r.some((v) => !isBlank(v)));
    if (!rows.length) throw new Error("The sheet is empty.");
    const headers = rows[0].map((h) => (isBlank(h) ? "" : String(h).trim()));
    const data = rows.slice(1);
    const mapping = {};
    headers.forEach((h, i) => { if (i > 0) { const p = parseHeader(h); if (p) mapping[i] = p; } });
    if (!Object.keys(mapping).length) {
      throw new Error("No recognisable column headers. Use the template: first column Time, then 'Control r1', 'Phage r1', 'Antibiotic 1 r1', 'Combo 1 r1', ...");
    }
    const ignored = headers.filter((h, i) => i > 0 && !(i in mapping) && h);
    if (ignored.length) notes.push(`Ignored ${ignored.length} column(s) not in the template layout: ${ignored.slice(0, 8).join(", ")}${ignored.length > 8 ? "…" : ""}.`);
    const maps = Object.values(mapping);
    const nReps = Math.max(...maps.map((m) => m.rep));
    const nConc = Math.max(1, ...maps.map((m) => m.conc || 0));
    const columns = gridColumns(nReps, nConc);
    const out = data.map(() => new Array(columns.length).fill(""));
    data.forEach((row, k) => { out[k][0] = isBlank(row[0]) ? "" : String(row[0]); });
    const seen = new Set();
    for (const [i, m] of Object.entries(mapping)) {
      const name = colName(m.kind, m.rep, m.conc);
      if (seen.has(name)) throw new Error(`'${name}' appears twice in the file; fix the headers and reload.`);
      seen.add(name);
      const j = columns.indexOf(name);
      data.forEach((row, k) => { out[k][j] = isBlank(row[i]) ? "" : String(row[i]); });
    }
    if (!out.length) out.push(new Array(columns.length).fill(""));
    return { grid: { columns, rows: out }, nReps, nConc, notes };
  }

  // ------------------------------------------------------------------ export tables
  function readme(res) {
    const s = res.settings;
    const now = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    return [
      ["Tool", `SPARK v${APP_VERSION} (web)`],
      ["Generated", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`],
      ["Experiment", s.experiment],
      ["Phage", s.phageName],
      ["Antibiotic", s.antibioticName],
      ["Concentrations", res.concs.map((c) => `${c} = ${label(s, c)}`).join("; ")],
      ["Replicates with data", res.repsFound.map((r) => "r" + r).join(", ")],
      ["Time", res.timeNote],
      ["", ""],
      ["Normalization", "f_X(t) = OD_X(t) / OD_Control(t), same replicate number."],
      ["SPARK expected", "Expected(t) = f_Antibiotic(t) x f_Phage(t)."],
      ["AUC", "Trapezoid integral over real time, in hours x fraction of control growth. Measured and expected use the same time points."],
      ["ΔAUC", "AUC(measured combination) - AUC(SPARK expected). Negative = less growth than expected (synergy); positive = more growth than expected (antagonism)."],
      ["Mean Δ growth", "ΔAUC / time span: average difference between measured and expected, as a fraction of untreated growth."],
      ["Call", "Synergy if the whole 95% CI of ΔAUC is < 0; Antagonism if > 0; otherwise no significant interaction. Needs n ≥ 2 replicates."],
      ["Rolling ΔAUC", "Cumulative ΔAUC from the first time point, per replicate; mean, SD and n per time."],
      ["", ""],
      ["Warnings", `${res.warnings.length} (see the Warnings sheet)`],
    ];
  }

  function recordsToTable(records) {
    const columns = [];
    for (const r of records) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
    return { columns, rows: records.map((r) => columns.map((c) => (c in r ? r[c] : NaN))) };
  }
  function colsToTable(t) {
    const n = t.data[t.columns[0]].length;
    return { columns: t.columns.slice(), rows: Array.from({ length: n }, (_, i) => t.columns.map((c) => t.data[c][i])) };
  }

  /** Ordered list of [sheetName, {columns, rows}] — same sheets as the Python version. */
  function sheetTables(res) {
    const s = res.settings;
    const tables = [
      ["Read me", { columns: ["Item", "Value"], rows: readme(res) }],
      ["Summary", recordsToTable(res.summary)],
      ["AUC per replicate", recordsToTable(res.perRep)],
    ];
    const used = new Set();
    for (const c of res.concs) {
      let nm = `Curves ${label(s, c)}`.replace(/[\[\]\*\?\/\\:]/g, "_").slice(0, 31);
      while (used.has(nm)) nm = nm.slice(0, 29) + `_${c}`;
      used.add(nm);
      tables.push([nm, colsToTable(res.curves[c])]);
    }
    tables.push(["Rolling ΔAUC", colsToTable(res.rolling)]);
    tables.push(["Normalized", colsToTable(res.normalized)]);
    tables.push(["Raw data", colsToTable(res.raw)]);
    tables.push(["Warnings", { columns: ["Warnings"], rows: (res.warnings.length ? res.warnings : ["None"]).map((w) => [w]) }]);
    return tables;
  }

  function toCsv(table) {
    const esc = (v) => {
      if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
      const t = String(v);
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    return [table.columns.map(esc).join(","), ...table.rows.map((r) => r.map(esc).join(","))].join("\r\n") + "\r\n";
  }

  // ------------------------------------------------------------------ minimal zip (store, no compression)
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function makeZip(files) { // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  function csvZip(res) {
    const enc = new TextEncoder();
    const files = sheetTables(res).map(([name, t]) => {
      const safe = name.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "");
      const body = enc.encode("﻿" + toCsv(t));
      return { name: `${safe}.csv`, data: body };
    });
    return makeZip(files);
  }

  // CSV / TSV text -> array of rows (delimiter sniffed: tab, semicolon or comma)
  function parseDelimited(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/).slice(0, 5).join("\n");
    const counts = { "\t": (first.match(/\t/g) || []).length, ";": (first.match(/;/g) || []).length, ",": (first.match(/,/g) || []).length };
    const delim = counts["\t"] ? "\t" : counts[";"] >= counts[","] && counts[";"] ? ";" : ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  return { APP_VERSION, TIME_UNITS, KINDS, colName, gridColumns, parseHeader, isBlank, toNumber, clockToSeconds,
    parseTime, analyze, tableToGrid, sheetTables, readme, toCsv, csvZip, makeZip, parseDelimited, label,
    tCdf, tPpf, ttestP, fmtG };
});
