/* ============================================================
   app.js  —  UI wiring
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  const el = {
    input: $("input"), output: $("output"),
    synStrength: $("synStrength"), phrStrength: $("phrStrength"),
    resStrength: $("resStrength"), errRate: $("errRate"),
    outSyn: $("outSyn"), outPhr: $("outPhr"), outRes: $("outRes"), outErr: $("outErr"),
    optQuotes: $("optQuotes"), optCites: $("optCites"), optHighlight: $("optHighlight"),
    errTier: $("errTier"), contractionMode: $("contractionMode"),
    runBtn: $("runBtn"), shuffleBtn: $("shuffleBtn"), copyBtn: $("copyBtn"),
    downloadBtn: $("downloadBtn"), clearBtn: $("clearBtn"), sampleBtn: $("sampleBtn"),
    liveMode: $("liveMode"), stats: $("stats"), legend: $("legend"),
    inWords: $("inWords"), inChars: $("inChars"), outWords: $("outWords"),
    fileInput: $("fileInput"), fileMsg: $("fileMsg"),
    dropZone: $("dropZone"), themeBtn: $("themeBtn")
  };

  let seed = Math.floor(Math.random() * 4294967295);
  let lastResult = "";

  /* ---------------- presets ---------------- */
  const PRESETS = {
    light:    { syn: 30, phr: 45, res: 20, err: 10, tier: "1" },
    balanced: { syn: 55, phr: 70, res: 45, err: 25, tier: "2" },
    heavy:    { syn: 80, phr: 90, res: 70, err: 45, tier: "3" }
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    el.synStrength.value = p.syn;
    el.phrStrength.value = p.phr;
    el.resStrength.value = p.res;
    el.errRate.value = p.err;
    el.errTier.value = p.tier;
    syncLabels();
  }

  function setActivePreset(name) {
    document.querySelectorAll(".seg").forEach(b =>
      b.classList.toggle("is-active", b.dataset.preset === name));
  }

  document.querySelectorAll(".seg").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.preset;
      setActivePreset(name);
      if (name !== "custom") { applyPreset(name); run(); }
    });
  });

  /* ---------------- slider labels ---------------- */
  function syncLabels() {
    el.outSyn.textContent = el.synStrength.value + "%";
    el.outPhr.textContent = el.phrStrength.value + "%";
    el.outRes.textContent = el.resStrength.value + "%";
    const rate = (+el.errRate.value / 10).toFixed(1);
    el.outErr.textContent = +rate === 0 ? "off" : rate + " / 100 words";
  }

  [el.synStrength, el.phrStrength, el.resStrength, el.errRate].forEach(s => {
    s.addEventListener("input", () => { syncLabels(); setActivePreset("custom"); scheduleRun(); });
  });
  [el.optQuotes, el.optCites, el.errTier, el.contractionMode].forEach(c => {
    c.addEventListener("change", run);
  });
  el.optHighlight.addEventListener("change", () => { render(); });

  /* ---------------- options ---------------- */
  function readOptions() {
    return {
      seed: seed,
      useSynonyms: +el.synStrength.value > 0,
      synonymStrength: +el.synStrength.value / 100,
      usePhrases: +el.phrStrength.value > 0,
      phraseStrength: +el.phrStrength.value / 100,
      useRestructure: +el.resStrength.value > 0,
      restructureStrength: +el.resStrength.value / 100,
      errorRate: +el.errRate.value / 10,
      errorTier: +el.errTier.value,
      protectQuotes: el.optQuotes.checked,
      protectCitations: el.optCites.checked,
      contractionMode: el.contractionMode.value
    };
  }

  /* ---------------- run ---------------- */
  let timer = null;
  function scheduleRun() {
    if (!el.liveMode.checked) return;
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  }

  let current = null;

  function run() {
    const src = el.input.value;
    if (!src.trim()) {
      current = null;
      lastResult = "";
      el.output.textContent = "";
      el.outWords.textContent = "0";
      el.stats.innerHTML = "";
      return;
    }
    let res;
    try {
      res = paraphrase(src, readOptions());
    } catch (err) {
      el.output.textContent = "Something went wrong while paraphrasing: " + err.message;
      return;
    }
    current = { src: src, out: res.text, clean: res.clean, stats: res.stats };
    lastResult = res.text;
    render();
    renderStats(res.stats, src, res.text);
  }

  /* ---------------- rendering ---------------- */
  function render() {
    if (!current) return;
    el.outWords.textContent = countWords(current.out);

    if (!el.optHighlight.checked) {
      el.output.textContent = current.out;
      el.legend.style.visibility = "hidden";
      return;
    }
    el.legend.style.visibility = "visible";

    // Both diffs reconstruct the same final token sequence, so their
    // eq/ins entries line up index-for-index and can be zipped.
    const vsOriginal = diffWordsChunked(current.src, current.out).filter(o => o.type !== "del");
    const vsClean = diffWordsChunked(current.clean, current.out).filter(o => o.type !== "del");

    const frag = document.createDocumentFragment();
    for (let i = 0; i < vsOriginal.length; i++) {
      const tok = vsOriginal[i];
      const isError = vsClean[i] && vsClean[i].type === "ins" && vsClean[i].text === tok.text;
      const isChanged = tok.type === "ins";

      if (!isChanged && !isError) {
        frag.appendChild(document.createTextNode(tok.text));
      } else {
        const ins = document.createElement("ins");
        if (isError) ins.className = "err";
        ins.textContent = tok.text;
        frag.appendChild(ins);
      }
    }
    el.output.textContent = "";
    el.output.appendChild(frag);
  }

  function renderStats(stats, src, out) {
    const srcWords = countWords(src);
    const changedPct = srcWords ? Math.round((stats.replaced / srcWords) * 100) : 0;
    const parts = [
      "<span>words rewritten <b>" + stats.replaced + "</b> (" + changedPct + "%)</span>",
      "<span>sentences restructured <b>" + stats.restructured + "</b></span>",
      "<span>slips introduced <b>" + stats.errors + "</b></span>",
      "<span>similarity <b>" + similarity(src, out) + "%</b></span>"
    ];
    el.stats.innerHTML = parts.join("");
  }

  function countWords(s) {
    const m = s.match(/[A-Za-z0-9'’-]+/g);
    return m ? m.length : 0;
  }

  /* Rough lexical overlap, for a sense of how much actually moved. */
  function similarity(a, b) {
    const norm = s => (s.toLowerCase().match(/[a-z0-9']+/g) || []);
    const A = norm(a), B = norm(b);
    if (!A.length || !B.length) return 0;
    const counts = new Map();
    A.forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
    let shared = 0;
    B.forEach(w => {
      const c = counts.get(w);
      if (c > 0) { shared++; counts.set(w, c - 1); }
    });
    return Math.round((2 * shared / (A.length + B.length)) * 100);
  }

  /* ---------------- input events ---------------- */
  el.input.addEventListener("input", () => { updateCounts(); scheduleRun(); });

  function updateCounts() {
    el.inWords.textContent = countWords(el.input.value);
    el.inChars.textContent = el.input.value.length;
  }

  el.runBtn.addEventListener("click", run);
  el.shuffleBtn.addEventListener("click", () => {
    seed = Math.floor(Math.random() * 4294967295);
    run();
  });
  el.clearBtn.addEventListener("click", () => {
    el.input.value = "";
    updateCounts();
    run();
    hideMsg();
    el.input.focus();
  });

  /* ---------------- copy / download ---------------- */
  el.copyBtn.addEventListener("click", async () => {
    if (!lastResult) return;
    try {
      await navigator.clipboard.writeText(lastResult);
      flash(el.copyBtn, "Copied");
    } catch (e) {
      // Clipboard API is blocked on file:// in some browsers
      el.input.focus();
      const ta = document.createElement("textarea");
      ta.value = lastResult;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flash(el.copyBtn, "Copied"); }
      catch (e2) { flash(el.copyBtn, "Press Ctrl+C"); }
      document.body.removeChild(ta);
    }
  });

  el.downloadBtn.addEventListener("click", () => {
    if (!lastResult) return;
    const blob = new Blob([lastResult], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paraphrased.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.classList.add("ok");
    setTimeout(() => { btn.textContent = old; btn.classList.remove("ok"); }, 1400);
  }

  /* ---------------- file loading ---------------- */
  function showMsg(text, kind) {
    el.fileMsg.textContent = text;
    el.fileMsg.className = "file-msg" + (kind === "info" ? " info" : "");
    el.fileMsg.hidden = false;
  }
  function hideMsg() { el.fileMsg.hidden = true; }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      showMsg("That file is larger than 12 MB. Please use a smaller file or paste the text directly.");
      return;
    }
    showMsg("Reading " + file.name + "…", "info");
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) {
        showMsg("No readable text was found in " + file.name + ".");
        return;
      }
      el.input.value = text;
      updateCounts();
      run();
      showMsg("Loaded " + file.name + " — " + countWords(text) + " words.", "info");
      setTimeout(hideMsg, 4000);
    } catch (err) {
      showMsg(err.message || "That file could not be read.");
    }
  }

  el.fileInput.addEventListener("change", e => {
    loadFile(e.target.files[0]);
    e.target.value = ""; // allow re-selecting the same file
  });

  ["dragenter", "dragover"].forEach(ev => {
    el.dropZone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      el.dropZone.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach(ev => {
    el.dropZone.addEventListener(ev, e => {
      e.preventDefault(); e.stopPropagation();
      if (ev === "dragleave" && el.dropZone.contains(e.relatedTarget)) return;
      el.dropZone.classList.remove("is-over");
    });
  });
  el.dropZone.addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });
  // Stop the browser navigating away if a file misses the drop zone
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => e.preventDefault());

  /* ---------------- theme ---------------- */
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("pp-theme", t); } catch (e) { /* private mode */ }
  }
  el.themeBtn.addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme");
    setTheme(now === "dark" ? "light" : "dark");
  });
  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("pp-theme"); } catch (e) { /* ignore */ }
    if (saved) { document.documentElement.setAttribute("data-theme", saved); return; }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  })();

  /* ---------------- sample ---------------- */
  const SAMPLE =
"Artificial intelligence has become an important part of modern healthcare systems. " +
"Due to the fact that hospitals generate a large number of records every day, it is difficult " +
"for staff to analyse all of the information manually. Recent studies show that machine learning " +
"models can identify patterns in patient data more quickly than traditional methods.\n\n" +
"However, there are several problems that must be considered before these systems are used widely. " +
"The results of a study were affected by the quality of the training data, and researchers found " +
"that biased datasets often lead to unfair outcomes for certain groups of patients. In addition, " +
"many clinicians do not fully understand how the models reach their conclusions, which makes it " +
"difficult to build trust in the technology.\n\n" +
"In conclusion, artificial intelligence offers significant benefits for healthcare, but it is " +
"important to develop clear guidelines. Hospitals should carry out further research in order to " +
"make sure that these tools are safe, reliable and fair for everyone.";

  el.sampleBtn.addEventListener("click", () => {
    el.input.value = SAMPLE;
    updateCounts();
    run();
    hideMsg();
  });

  /* ---------------- keyboard ---------------- */
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });

  /* ---------------- boot ---------------- */
  syncLabels();
  updateCounts();
  el.legend.style.visibility = "hidden";
})();
