/* SPARK web app: user interface. Analysis lives in spark_core.js. */
(function () {
  "use strict";
  const C = window.SparkCore;
  const $ = (id) => document.getElementById(id);

  // ================================================================ state
  const state = {
    nReps: 3, nConc: 1, nRows: 150,
    concLabels: {},
    grid: null,          // {columns, rows}
    results: null,
    resSig: null,
    workbook: null,      // pending upload {name, kind, sheets: {name: aoa}}
  };

  // ================================================================ helpers
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  function download(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function settings() {
    const labels = {};
    for (let c = 1; c <= state.nConc; c++) labels[c] = state.concLabels[c] || `Conc ${c}`;
    return {
      experiment: $("experiment").value.trim(),
      phageName: $("phageName").value.trim() || "Phage",
      antibioticName: $("antibioticName").value.trim() || "Antibiotic",
      concLabels: labels,
      timeUnit: $("timeUnit").value,
      evenSpacing: $("evenSpacing").checked,
    };
  }
  const signature = () => JSON.stringify([state.grid.rows, state.nReps, state.nConc, settings()]);
  const fileStem = () => (settings().experiment.replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "SPARK");

  // ================================================================ grid model
  function emptyRows(n, w) { return Array.from({ length: n }, () => new Array(w).fill("")); }

  function reshapeGrid(old, nReps, nConc, nRows) {
    const columns = C.gridColumns(nReps, nConc);
    let need = nRows;
    if (old) {
      let last = -1;
      old.rows.forEach((r, i) => { if (r.some((v) => !C.isBlank(v))) last = i; });
      need = Math.max(nRows, last + 1);
    }
    const rows = emptyRows(need, columns.length);
    if (old) {
      columns.forEach((c, j) => {
        const oj = old.columns.indexOf(c);
        if (oj < 0) return;
        for (let i = 0; i < Math.min(need, old.rows.length); i++) rows[i][j] = old.rows[i][oj] ?? "";
      });
    }
    return { columns, rows };
  }

  function applyLayout() {
    state.grid = reshapeGrid(state.grid, state.nReps, state.nConc, state.nRows);
    renderGrid();
    markStale();
  }

  // ================================================================ grid view
  const sel = { a: null, b: null, dragging: false }; // a/b = [row, col]

  function renderGrid() {
    const g = state.grid;
    const kinds = g.columns.map((c) => (C.parseHeader(c) || { kind: "Time" }).kind);
    let h = "<thead><tr><th class='rn'></th>";
    g.columns.forEach((c, j) => { h += `<th class="${j === 0 ? "tcol" : "k-" + kinds[j]}">${esc(c)}</th>`; });
    h += "</tr></thead><tbody>";
    for (let i = 0; i < g.rows.length; i++) {
      h += `<tr><td class="rn">${i + 1}</td>`;
      for (let j = 0; j < g.columns.length; j++) {
        h += `<td${j === 0 ? " class='tcol'" : ""}><input data-r="${i}" data-c="${j}" value="${esc(g.rows[i][j] ?? "")}" spellcheck="false" autocomplete="off"></td>`;
      }
      h += "</tr>";
    }
    h += "</tbody>";
    $("grid").innerHTML = h;
    updateGridNote();
  }

  function updateGridNote() {
    const g = state.grid;
    let filled = 0;
    g.rows.forEach((r) => { if (r.some((v, j) => j > 0 && !C.isBlank(v))) filled++; });
    $("gridNote").textContent = `${g.columns.length - 1} data columns · ${filled} of ${g.rows.length} rows contain data`;
  }

  const cellInput = (r, c) => $("grid").querySelector(`input[data-r="${r}"][data-c="${c}"]`);

  function selRange() {
    if (!sel.a || !sel.b) return null;
    return { r0: Math.min(sel.a[0], sel.b[0]), r1: Math.max(sel.a[0], sel.b[0]), c0: Math.min(sel.a[1], sel.b[1]), c1: Math.max(sel.a[1], sel.b[1]) };
  }
  function paintSel() {
    $("grid").querySelectorAll("input.sel").forEach((el) => el.classList.remove("sel"));
    const R = selRange();
    if (!R || (R.r0 === R.r1 && R.c0 === R.c1)) return;
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) { const el = cellInput(r, c); if (el) el.classList.add("sel"); }
  }
  const multiSel = () => { const R = selRange(); return R && (R.r0 !== R.r1 || R.c0 !== R.c1); };

  function setupGridEvents() {
    const tbl = $("grid");
    tbl.addEventListener("input", (e) => {
      const t = e.target; if (t.tagName !== "INPUT") return;
      state.grid.rows[+t.dataset.r][+t.dataset.c] = t.value;
      markStale(); updateGridNote();
    });
    tbl.addEventListener("mousedown", (e) => {
      const t = e.target; if (t.tagName !== "INPUT") return;
      const p = [+t.dataset.r, +t.dataset.c];
      if (e.shiftKey && sel.a) { sel.b = p; e.preventDefault(); t.focus(); }
      else { sel.a = p; sel.b = p; sel.dragging = true; }
      paintSel();
    });
    tbl.addEventListener("mouseover", (e) => {
      if (!sel.dragging) return;
      const t = e.target; if (t.tagName !== "INPUT") return;
      sel.b = [+t.dataset.r, +t.dataset.c];
      if (multiSel()) window.getSelection()?.removeAllRanges();
      paintSel();
    });
    document.addEventListener("mouseup", () => { sel.dragging = false; });
    tbl.addEventListener("focusin", (e) => {
      const t = e.target; if (t.tagName !== "INPUT" || sel.dragging) return;
      if (!multiSel()) { sel.a = [+t.dataset.r, +t.dataset.c]; sel.b = sel.a; paintSel(); }
    });
    tbl.addEventListener("keydown", (e) => {
      const t = e.target; if (t.tagName !== "INPUT") return;
      const r = +t.dataset.r, c = +t.dataset.c;
      const move = (dr, dc) => {
        const el = cellInput(r + dr, c + dc);
        if (el) { e.preventDefault(); sel.a = [r + dr, c + dc]; sel.b = sel.a; paintSel(); el.focus(); el.select(); }
      };
      if ((e.key === "Delete" || e.key === "Backspace") && multiSel()) {
        e.preventDefault();
        const R = selRange();
        for (let i = R.r0; i <= R.r1; i++) for (let j = R.c0; j <= R.c1; j++) { state.grid.rows[i][j] = ""; const el = cellInput(i, j); if (el) el.value = ""; }
        markStale(); updateGridNote();
        return;
      }
      if (e.key === "Enter" || e.key === "ArrowDown") return move(1, 0);
      if (e.key === "ArrowUp") return move(-1, 0);
      if (e.key === "ArrowRight" && t.selectionStart === t.value.length) return move(0, 1);
      if (e.key === "ArrowLeft" && t.selectionStart === 0 && t.selectionEnd === 0) return move(0, -1);
      if (e.key === "Escape") { sel.b = sel.a; paintSel(); }
    });
    tbl.addEventListener("copy", (e) => {
      if (!multiSel()) return;
      const R = selRange();
      const lines = [];
      for (let i = R.r0; i <= R.r1; i++) lines.push(state.grid.rows[i].slice(R.c0, R.c1 + 1).join("\t"));
      e.clipboardData.setData("text/plain", lines.join("\n"));
      e.preventDefault();
    });
    tbl.addEventListener("paste", (e) => {
      const t = e.target; if (t.tagName !== "INPUT") return;
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      if (!/[\t\n\r]/.test(text.replace(/[\r\n]+$/, ""))) return; // single value: let the input handle it
      e.preventDefault();
      pasteBlock(text, +t.dataset.r, +t.dataset.c);
    });
  }

  function pasteBlock(text, r0, c0) {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n").map((l) => l.split("\t"));
    // A block that starts with template headers replaces the whole table layout.
    if (lines[0].some((h) => C.parseHeader(h))) {
      try {
        const out = C.tableToGrid(lines);
        loadGrid(out, "Pasted table with headers.");
      } catch (err) { showLoadNotes([`❌ ${err.message}`]); }
      return;
    }
    const g = state.grid;
    const need = r0 + lines.length;
    if (need > g.rows.length) {
      g.rows.push(...emptyRows(need - g.rows.length, g.columns.length));
      state.nRows = Math.max(state.nRows, g.rows.length);
      $("nRows").value = state.nRows;
    }
    let clipped = 0;
    lines.forEach((cells, i) => cells.forEach((v, j) => {
      if (c0 + j < g.columns.length) g.rows[r0 + i][c0 + j] = v.trim(); else clipped++;
    }));
    renderGrid();
    markStale();
    const w = Math.max(...lines.map((l) => l.length));
    $("gridNote").textContent = `Pasted ${lines.length} × ${w} cells` + (clipped ? ` · ${clipped} cell(s) beyond the last column were dropped` : "") + ".";
    sel.a = [r0, c0]; sel.b = [r0 + lines.length - 1, Math.min(c0 + w - 1, g.columns.length - 1)]; paintSel();
  }

  // ================================================================ sidebar
  function renderConcLabels() {
    const box = $("concLabels");
    let h = "";
    for (let c = 1; c <= state.nConc; c++) {
      const v = state.concLabels[c] ?? `Conc ${c}`;
      h += `<div class="field"><label for="cl${c}">Concentration ${c}</label><input type="text" id="cl${c}" data-c="${c}" value="${esc(v)}" placeholder="e.g. 0.5 µg/mL"></div>`;
    }
    box.innerHTML = h;
    if (state.nConc > 1) $("concBox").open = true;
  }

  function setupSidebar() {
    $("timeUnit").innerHTML = C.TIME_UNITS.map((u) => `<option>${esc(u)}</option>`).join("");
    $("versionFoot").textContent = `SPARK v${C.APP_VERSION} (web)`;
    const clampInt = (el, lo, hi) => Math.min(hi, Math.max(lo, parseInt(el.value, 10) || lo));
    $("nReps").addEventListener("change", () => { state.nReps = clampInt($("nReps"), 1, 24); $("nReps").value = state.nReps; applyLayout(); });
    $("nConc").addEventListener("change", () => { state.nConc = clampInt($("nConc"), 1, 12); $("nConc").value = state.nConc; renderConcLabels(); applyLayout(); });
    $("nRows").addEventListener("change", () => { state.nRows = clampInt($("nRows"), 10, 5000); $("nRows").value = state.nRows; applyLayout(); });
    $("concLabels").addEventListener("input", (e) => { if (e.target.dataset.c) { state.concLabels[+e.target.dataset.c] = e.target.value; markStale(); } });
    ["experiment", "phageName", "antibioticName"].forEach((id) => $(id).addEventListener("input", markStale));
    ["timeUnit", "evenSpacing"].forEach((id) => $(id).addEventListener("change", markStale));
    $("clearBtn").addEventListener("click", () => {
      state.grid = null; state.results = null; state.resSig = null;
      applyLayout(); $("results").innerHTML = ""; showLoadNotes([]);
    });
    document.querySelectorAll("input[name=figfmt]").forEach((el) => el.addEventListener("change", () => { if (state.results) renderResults(); }));
  }
  const figFmt = () => document.querySelector("input[name=figfmt]:checked").value;

  // ================================================================ file loading
  function showLoadNotes(notes) {
    $("loadNotes").innerHTML = notes.map((n) => `<p class="note">${esc(n)}</p>`).join("");
  }

  function excelCellText(v) {
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return { date: v };
    if (typeof v === "object") {
      if ("result" in v) return excelCellText(v.result);
      if (v.richText) return v.richText.map((t) => t.text).join("");
      if ("text" in v) return String(v.text);
      if ("error" in v) return String(v.error);
      return "";
    }
    if (typeof v === "number") return String(v);
    return String(v).trim();
  }
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  function secsToClock(secs) {
    const t = Math.round(secs);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function finishTimeColumn(aoa) {
    // Dates from Excel: time-of-day / [h]:mm:ss cells come as dates near 1899-12-30; real date-times as modern dates.
    const dates = aoa.slice(1).map((r) => r[0]).filter((v) => v && v.date);
    const modern = dates.filter((d) => d.date.getUTCFullYear() > 1900);
    const base = modern.length ? Math.min(...modern.map((d) => d.date.getTime())) : null;
    aoa.forEach((r, i) => {
      r.forEach((v, j) => {
        if (v && v.date) {
          const ms = v.date.getTime();
          if (j === 0 && i > 0) r[j] = secsToClock((v.date.getUTCFullYear() > 1900 ? ms - base : ms - EXCEL_EPOCH) / 1000);
          else r[j] = v.date.toISOString();
        }
      });
    });
    return aoa;
  }

  async function readFile(file) {
    const name = file.name;
    const lower = name.toLowerCase();
    if (lower.endsWith(".xls")) throw new Error("Old .xls files are not supported. Save the file as .xlsx (Excel: File › Save As) and load it again.");
    if (/\.(csv|txt|tsv)$/.test(lower)) {
      const text = await file.text();
      return { name, sheets: { [name]: C.parseDelimited(text) }, order: [name] };
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheets = {}, order = [];
    wb.worksheets.forEach((ws) => {
      const aoa = [];
      ws.eachRow({ includeEmpty: true }, (row, rn) => {
        const vals = row.values; // 1-based
        const arr = [];
        for (let c = 1; c < vals.length; c++) arr.push(excelCellText(vals[c]));
        aoa[rn - 1] = arr;
      });
      for (let i = 0; i < aoa.length; i++) if (!aoa[i]) aoa[i] = [];
      sheets[ws.name] = finishTimeColumn(aoa);
      order.push(ws.name);
    });
    return { name, sheets, order };
  }

  async function onFileChosen(file) {
    if (!file) return;
    $("fileName").textContent = file.name;
    try {
      state.workbook = await readFile(file);
    } catch (err) {
      state.workbook = null;
      showLoadNotes([`❌ Could not read the file: ${err.message}`]);
      $("sheetSel").hidden = true; $("loadBtn").hidden = true;
      return;
    }
    const order = state.workbook.order;
    $("sheetSel").innerHTML = order.map((n) => `<option>${esc(n)}</option>`).join("");
    $("sheetSel").hidden = order.length < 2;
    $("loadBtn").hidden = false;
    showLoadNotes([]);
  }

  function loadGrid(out, source) {
    state.nReps = out.nReps; state.nConc = out.nConc;
    state.nRows = Math.min(Math.max(out.grid.rows.length, 20), 5000);
    $("nReps").value = state.nReps; $("nConc").value = state.nConc; $("nRows").value = state.nRows;
    state.grid = reshapeGrid(out.grid, state.nReps, state.nConc, state.nRows);
    state.results = null; state.resSig = null; $("results").innerHTML = "";
    renderConcLabels();
    renderGrid();
    $("howto").open = false;
    showLoadNotes([`✅ ${source} ${out.grid.rows.length} rows, ${out.nReps} replicate(s), ${out.nConc} concentration(s).`, ...out.notes]);
  }

  function setupFile() {
    const input = $("fileInput");
    $("chooseBtn").addEventListener("click", () => input.click());
    input.addEventListener("change", () => onFileChosen(input.files[0]));
    const drop = $("drop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => onFileChosen(e.dataTransfer.files[0]));
    $("loadBtn").addEventListener("click", () => {
      const wb = state.workbook; if (!wb) return;
      const sheet = $("sheetSel").hidden ? wb.order[0] : $("sheetSel").value;
      try {
        loadGrid(C.tableToGrid(wb.sheets[sheet]), `Loaded from ${wb.name}${wb.order.length > 1 ? ` (${sheet})` : ""}:`);
      } catch (err) { showLoadNotes([`❌ Could not load: ${err.message}`]); }
    });
    $("templateBtn").addEventListener("click", downloadTemplate);
  }

  // ================================================================ Excel export (ExcelJS)
  function styleHeader(ws) {
    const r = ws.getRow(1);
    r.font = { bold: true };
    r.alignment = { wrapText: true, vertical: "top" };
    r.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } }; });
  }

  async function downloadTemplate() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
    const cols = C.gridColumns(state.nReps, state.nConc);
    ws.addRow(cols);
    ws.columns.forEach((c) => { c.width = 16; });
    styleHeader(ws);
    const hw = wb.addWorksheet("How to fill in");
    [["How to fill in"],
     ["Column A: time (h:mm:ss, or plain numbers in hours / minutes / seconds; choose the unit in the app)."],
     ["Control rN: untreated growth for replicate N (used to normalize everything in replicate N)."],
     ["Phage rN: phage alone. Antibiotic c rN: antibiotic alone at concentration c."],
     ["Combo c rN: phage + antibiotic at concentration c."],
     ["Leave unused columns empty. Decimal commas are fine."]].forEach((r) => hw.addRow(r));
    hw.getColumn(1).width = 110; styleHeader(hw);
    const buf = await wb.xlsx.writeBuffer();
    download(`SPARK_template_${state.nReps}rep_${state.nConc}conc.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  }

  async function excelResults(res) {
    const wb = new ExcelJS.Workbook();
    wb.creator = `SPARK v${C.APP_VERSION}`;
    for (const [name, t] of C.sheetTables(res)) {
      const frozenB = !(name === "Read me" || name === "Warnings");
      const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: frozenB ? 1 : 0, ySplit: 1 }] });
      ws.addRow(t.columns);
      for (const row of t.rows) ws.addRow(row.map((v) => (typeof v === "number" && !Number.isFinite(v) ? null : v)));
      styleHeader(ws);
      t.columns.forEach((col, j) => {
        const c = ws.getColumn(j + 1);
        if (name === "Read me") c.width = j === 0 ? 24 : 110;
        else if (name === "Warnings") c.width = 120;
        else c.width = Math.max(11, Math.min(28, String(col).length + 2));
        const isFloat = t.rows.some((r) => typeof r[j] === "number" && Number.isFinite(r[j]) && !Number.isInteger(r[j]));
        if (isFloat) c.eachCell({ includeEmpty: false }, (cell, rn) => { if (rn > 1) cell.numFmt = "0.0000"; });
      });
      if (name === "Read me") ws.getColumn(2).eachCell((cell, rn) => { if (rn > 1) cell.alignment = { wrapText: true, vertical: "top" }; });
    }
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ================================================================ charts (Plotly)
  const INK = "#000000";
  const C_ANTIBIOTIC = "#eb6834", C_PHAGE = "#2a78d6", C_COMBO = "#1baf7a", C_EXPECTED = "#52514e";
  const C_SYN = "#2a78d6", C_ANT = "#e34948", C_NS = "#a3a29b";
  const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
  const FONT = { family: "Inter, Segoe UI, Helvetica, Arial, sans-serif", size: 13, color: INK };
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  const nn = (a) => a.map((v) => (Number.isFinite(v) ? v : null));

  function axisStyle(title) {
    return {
      title: { text: title, font: { color: INK, size: 14 } }, gridcolor: "#e4e3df", zeroline: false, showline: true,
      linecolor: INK, linewidth: 1, ticks: "outside", tickcolor: INK, tickfont: { color: INK, size: 13 }, automargin: true,
    };
  }
  function baseLayout(title, ytitle, xtitle = "Time (h)", height = 380) {
    return {
      font: FONT, height, title: { text: `<b>${title}</b>`, font: { size: 15, color: INK }, x: 0, xanchor: "left", xref: "paper" },
      margin: { l: 60, r: 20, t: 60, b: 50 }, hovermode: "x unified",
      legend: { orientation: "h", yanchor: "bottom", y: 1.0, xanchor: "right", x: 1, font: { color: INK } },
      plot_bgcolor: "#fcfcfb", paper_bgcolor: "#ffffff",
      xaxis: axisStyle(xtitle), yaxis: axisStyle(ytitle), annotations: [], shapes: [],
    };
  }
  function band(traces, x, mean, sd, color, name, dash, axes, showLegend = true) {
    const ax = axes ? { xaxis: axes.x, yaxis: axes.y } : {};
    if (sd && sd.some(Number.isFinite)) {
      const s0 = sd.map((v) => (Number.isFinite(v) ? v : 0));
      const up = mean.map((m, i) => m + s0[i]), lo = mean.map((m, i) => m - s0[i]);
      traces.push(Object.assign({ type: "scatter", x: x.concat(x.slice().reverse()), y: nn(up.concat(lo.reverse())), fill: "toself",
        fillcolor: rgba(color, 0.15), line: { width: 0 }, hoverinfo: "skip", showlegend: false, legendgroup: name }, ax));
    }
    traces.push(Object.assign({ type: "scatter", mode: "lines", x, y: nn(mean), name, legendgroup: name, showlegend: showLegend,
      line: { color, width: 2, dash: dash || "solid" }, hovertemplate: "%{y:.3f}" }, ax));
  }
  function facetLayout(layout, titles, ncols) {
    const n = titles.length, nrows = Math.ceil(n / ncols);
    const hs = 0.04, vs = nrows > 1 ? 0.14 : 0.1;
    const w = (1 - hs * (ncols - 1)) / ncols, hgt = (1 - vs * (nrows - 1)) / nrows;
    const axes = [];
    delete layout.xaxis; delete layout.yaxis;
    titles.forEach((t, i) => {
      const r = Math.floor(i / ncols), c = i % ncols, k = i === 0 ? "" : String(i + 1);
      const x0 = c * (w + hs), y1 = 1 - r * (hgt + vs);
      const xa = axisStyle(r === nrows - 1 || i + ncols >= n ? "Time (h)" : ""), ya = axisStyle(c === 0 ? "" : "");
      xa.domain = [x0, x0 + w]; xa.anchor = "y" + k;
      ya.domain = [y1 - hgt, y1]; ya.anchor = "x" + k;
      if (i > 0) { ya.matches = "y"; if (c > 0) ya.showticklabels = false; }
      layout["xaxis" + k] = xa; layout["yaxis" + k] = ya;
      layout.annotations.push({ text: esc(t), x: x0 + w / 2, y: y1, xref: "paper", yref: "paper", xanchor: "center", yanchor: "bottom",
        showarrow: false, font: { size: 15, color: INK } });
      axes.push({ x: "x" + k, y: "y" + k, row: r, col: c });
    });
    return { axes, nrows };
  }
  function topLegend(layout, height) {
    const plotH = height - 110 - 50;
    layout.margin.t = 110;
    layout.title.y = 0.99; layout.title.yanchor = "top"; layout.title.yref = "container";
    Object.assign(layout.legend, { y: 1 + 45 / plotH, yanchor: "bottom", x: 0, xanchor: "left" });
  }
  function plotConfig() {
    return { displaylogo: false, responsive: true, toImageButtonOptions: { format: figFmt(), scale: 3, filename: fileStem() } };
  }

  function figDeltaAuc(el, res) {
    const sm = res.summary, s = res.settings;
    const colors = sm.map((r) => (r["Call (SPARK)"] === "Synergy" ? C_SYN : r["Call (SPARK)"] === "Antagonism" ? C_ANT : C_NS));
    const x = sm.map((r) => r.Concentration);
    const m = sm.map((r) => r["ΔAUC mean (h)"]);
    const errHi = sm.map((r) => (Number.isFinite(r["95% CI high"]) ? r["95% CI high"] - r["ΔAUC mean (h)"] : 0));
    const errLo = sm.map((r) => (Number.isFinite(r["95% CI low"]) ? r["ΔAUC mean (h)"] - r["95% CI low"] : 0));
    const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : "–");
    const traces = [{
      type: "bar", x, y: nn(m), marker: { color: colors, cornerradius: 4 }, width: 0.55, showlegend: false, name: "Mean ΔAUC",
      error_y: { type: "data", symmetric: false, array: errHi, arrayminus: errLo, color: INK, thickness: 1.5 },
      customdata: sm.map((r) => [r.n, f(r["95% CI low"]), f(r["95% CI high"]), r["Call (SPARK)"]]),
      hovertemplate: "<b>%{x}</b><br>ΔAUC %{y:.3f} h<br>95% CI %{customdata[1]} to %{customdata[2]}<br>n = %{customdata[0]}<br>%{customdata[3]}<extra></extra>",
    }];
    const inc = res.perRep.filter((p) => p.Included === "yes");
    if (inc.length) traces.push({
      type: "scatter", mode: "markers", name: "Replicates", x: inc.map((p) => p.Concentration), y: inc.map((p) => p["ΔAUC (h)"]),
      marker: { size: 9, color: "#ffffff", line: { color: INK, width: 1.5 } }, customdata: inc.map((p) => p.Replicate),
      hovertemplate: "%{customdata}: %{y:.3f} h<extra></extra>",
    });
    const L = baseLayout("SPARK ΔAUC (measured − expected), mean ± 95% CI", "ΔAUC (h × fraction of control)", `${s.antibioticName} concentration`);
    L.hovermode = "closest"; L.bargap = 0.4;
    L.xaxis.type = "category";
    L.shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: INK, width: 1 } });
    L.annotations.push({ text: "↑ antagonism", xref: "paper", yref: "paper", x: 1, y: 1, showarrow: false, xanchor: "right", yanchor: "top", font: { size: 12, color: INK } });
    L.annotations.push({ text: "↓ synergy", xref: "paper", yref: "paper", x: 1, y: 0, showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 12, color: INK } });
    Plotly.newPlot(el, traces, L, plotConfig());
  }

  function figRolling(el, res) {
    const R = res.rolling, x = R.data["Time (h)"];
    const traces = [];
    res.concs.forEach((c, i) => {
      const lab = C.label(res.settings, c);
      if (!R.data[`${lab} ΔAUC mean`]) return;
      band(traces, x, R.data[`${lab} ΔAUC mean`], R.data[`${lab} ΔAUC SD`], SERIES[i % SERIES.length], lab);
    });
    const L = baseLayout("Cumulative ΔAUC over time (mean ± SD)", "Cumulative ΔAUC (h × fraction)");
    L.shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: INK, width: 1 } });
    Plotly.newPlot(el, traces, L, plotConfig());
  }

  function figCurves(el, res, showReps) {
    const s = res.settings, concs = res.concs;
    const ncols = Math.min(3, concs.length), nrows = Math.ceil(concs.length / ncols), height = 320 * nrows + 80;
    const L = baseLayout("Growth relative to untreated control (mean ± SD)", "", "Time (h)", height);
    const { axes } = facetLayout(L, concs.map((c) => C.label(s, c)), ncols);
    const series = [["Antibiotic", `${s.antibioticName} alone`, C_ANTIBIOTIC, null], ["Phage", `${s.phageName} alone`, C_PHAGE, null],
      ["Combo", "Combination (measured)", C_COMBO, null], ["Expected", "SPARK expected", C_EXPECTED, "dash"]];
    const traces = [];
    concs.forEach((c, i) => {
      const cd = res.curves[c], x = cd.data["Time (h)"];
      for (const [key, name, color, dash] of series) {
        if (!cd.data[`${key} mean`]) continue;
        if (showReps) {
          cd.columns.filter((k) => new RegExp(`^${key} r\\d+$`).test(k)).forEach((rc) => traces.push({
            type: "scatter", mode: "lines", x, y: nn(cd.data[rc]), showlegend: false, legendgroup: name, xaxis: axes[i].x, yaxis: axes[i].y,
            line: { color: rgba(color, 0.45), width: 1, dash: dash || "solid" }, hovertemplate: `${rc}: %{y:.3f}<extra></extra>`,
          }));
        }
        band(traces, x, cd.data[`${key} mean`], cd.data[`${key} SD`], color, name, dash, axes[i], i === 0);
      }
    });
    axes.forEach((a) => { if (a.col === 0) L[a.y === "y" ? "yaxis" : "yaxis" + a.y.slice(1)].title.text = "Fraction of control"; });
    topLegend(L, height);
    Plotly.newPlot(el, traces, L, plotConfig());
  }

  function figRaw(el, res) {
    const s = res.settings, concs = res.concs, raw = res.raw, x = raw.data["Time (h)"];
    const ncols = Math.min(3, concs.length), nrows = Math.ceil(concs.length / ncols), height = 320 * nrows + 80;
    const L = baseLayout("Raw OD (mean ± SD)", "", "Time (h)", height);
    const { axes } = facetLayout(L, concs.map((c) => C.label(s, c)), ncols);
    const traces = [];
    const meanSd = (fn) => {
      const cols = res.repsFound.map(fn).filter((k) => raw.data[k]);
      if (!cols.length) return null;
      const st = cols.map((k) => raw.data[k]);
      const n = st[0].length, m = [], sd = [];
      for (let j = 0; j < n; j++) {
        const v = st.map((r) => r[j]).filter(Number.isFinite);
        const mu = v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
        m.push(mu);
        sd.push(v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1)) : NaN);
      }
      return [m, sd];
    };
    concs.forEach((c, i) => {
      for (const [fn, name, color, dash] of [
        [(r) => C.colName("Control", r), "Untreated control", "#0b0b0b", "dot"],
        [(r) => C.colName("Antibiotic", r, c), `${s.antibioticName} alone`, C_ANTIBIOTIC, null],
        [(r) => C.colName("Phage", r), `${s.phageName} alone`, C_PHAGE, null],
        [(r) => C.colName("Combo", r, c), "Combination", C_COMBO, null]]) {
        const ms = meanSd(fn);
        if (ms) band(traces, x, ms[0], ms[1], color, name, dash, axes[i], i === 0);
      }
    });
    axes.forEach((a) => { if (a.col === 0) L[a.y === "y" ? "yaxis" : "yaxis" + a.y.slice(1)].title.text = "OD"; });
    topLegend(L, height);
    Plotly.newPlot(el, traces, L, plotConfig());
  }

  // ================================================================ results view
  function cellHtml(v) {
    if (typeof v === "number") return Number.isFinite(v) ? `<td class="num">${Number.isInteger(v) ? v : v.toFixed(4)}</td>` : `<td></td>`;
    if (v === null || v === undefined) return "<td></td>";
    return `<td>${esc(v)}</td>`;
  }
  function tableHtml(t, maxRows = 400) {
    let h = "<div class='tablewrap'><table class='data'><thead><tr>" + t.columns.map((c) => `<th>${esc(c)}</th>`).join("") + "</tr></thead><tbody>";
    t.rows.slice(0, maxRows).forEach((r) => { h += "<tr>" + r.map(cellHtml).join("") + "</tr>"; });
    h += "</tbody></table>";
    if (t.rows.length > maxRows) h += `<div class="more">Showing ${maxRows} of ${t.rows.length} rows. All rows are in the downloads.</div>`;
    return h + "</div>";
  }

  function renderResults() {
    const res = state.results;
    const box = $("results");
    if (!res) { box.innerHTML = ""; return; }
    const tables = C.sheetTables(res);
    const T = Object.fromEntries(tables);
    const w = res.warnings;
    let h = `<div id="staleMsg"></div><hr><h3 class="step">2 · Results</h3>
      <p class="meta">${esc(res.timeNote)} ${esc(res.info.join(" "))}</p>`;
    if (w.length) {
      h += `<details class="box warn"${w.length <= 6 ? " open" : ""}><summary>⚠ ${w.length} warning(s)</summary><div class="inner"><ul>${w.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></details>`;
    }
    h += `<div class="dl"><button class="btn primary" id="dlXlsx">⬇ All tables (Excel)</button><button class="btn" id="dlZip">⬇ All tables (CSV, zip)</button></div>`;
    h += "<div class='cards'>";
    for (const r of res.summary) {
      const d = r["ΔAUC mean (h)"], call = r["Call (SPARK)"];
      const cls = call === "Synergy" ? "syn" : call === "Antagonism" ? "ant" : "ns";
      const p = r["p (t-test vs 0)"], pct = r["ΔAUC % of expected (mean)"];
      const ci = r.n > 1 ? `95% CI ${r["95% CI low"].toFixed(2)} to ${r["95% CI high"].toFixed(2)}` : "n = 1";
      h += `<div class="card" title="n = ${r.n}; ${ci}"><div class="k">${esc(r.Concentration)} · ΔAUC (h)</div>
        <div class="v">${Number.isFinite(d) ? (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(3) : "–"}</div>
        <div class="c"><span class="call ${cls}">${esc(call)}</span> · n = ${r.n}${Number.isFinite(p) ? ` · p = ${C.fmtG(p, 3)}` : ""}${Number.isFinite(pct) ? ` · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% of expected` : ""}</div></div>`;
    }
    h += "</div>";
    h += `<div class="charts2"><div class="chart" id="chDelta"></div><div class="chart" id="chRoll"></div></div>
      <label class="toggle"><input type="checkbox" id="showReps"> Show individual replicates on growth curves</label>
      <div class="chart" id="chCurves"></div>
      <details class="box" id="rawBox"><summary>Raw OD curves</summary><div class="inner"><div class="chart" id="chRaw"></div></div></details>
      <h4>Summary across replicates</h4>${tableHtml(T["Summary"])}
      <h4>ΔAUC per replicate</h4>${tableHtml(T["AUC per replicate"])}
      <details class="box" style="margin-top:22px"><summary>All other tables (also in the Excel download)</summary><div class="inner">`;
    for (const [name, t] of tables) {
      if (name === "Summary" || name === "AUC per replicate") continue;
      h += `<h4>${esc(name)}</h4>${tableHtml(t, 200)}`;
    }
    h += "</div></details>";
    box.innerHTML = h;

    figDeltaAuc($("chDelta"), res);
    figRolling($("chRoll"), res);
    figCurves($("chCurves"), res, false);
    $("showReps").addEventListener("change", (e) => figCurves($("chCurves"), res, e.target.checked));
    let rawDrawn = false;
    $("rawBox").addEventListener("toggle", (e) => { if (e.target.open && !rawDrawn) { figRaw($("chRaw"), res); rawDrawn = true; } });
    $("dlXlsx").addEventListener("click", async () => download(`${fileStem()}_SPARK_results.xlsx`, await excelResults(res)));
    $("dlZip").addEventListener("click", () => download(`${fileStem()}_SPARK_results_csv.zip`, C.csvZip(res), "application/zip"));
    markStale();
  }

  function markStale() {
    const el = $("staleMsg");
    if (!el) return;
    el.innerHTML = state.results && state.resSig !== signature()
      ? `<div class="msg info">The table or settings changed since the last run. Press <b>Run analysis</b> to update the results.</div>` : "";
  }

  function run() {
    $("runError").innerHTML = "";
    try {
      state.results = C.analyze(state.grid, state.nReps, state.nConc, settings());
      state.resSig = signature();
      renderResults();
      $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      state.results = null; $("results").innerHTML = "";
      $("runError").innerHTML = `<div class="msg err">${esc(err.message)}</div>`;
    }
  }

  // ================================================================ init
  function init() {
    if (!window.Plotly || !window.ExcelJS) {
      document.querySelector(".wrap").insertAdjacentHTML("afterbegin",
        "<div class='msg err'>The chart or Excel library did not load. Check that the <code>lib</code> folder was uploaded next to index.html.</div>");
    }
    setupSidebar();
    renderConcLabels();
    setupGridEvents();
    setupFile();
    $("runBtn").addEventListener("click", run);
    applyLayout();
  }
  init();
})();
