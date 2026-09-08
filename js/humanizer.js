/* ============================================================
   humanizer.js  —  UI for the Humanizer page
   Uses the same rule-based engine as the Paraphraser; only the
   presets and the interface differ.
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  const el = {
    input: $("hInput"), output: $("hOutput"),
    words: $("hWords"), outWords: $("hOutWords"),
    run: $("hRun"), regen: $("hRegen"), copy: $("hCopy"),
    file: $("hFile"), msg: $("hMsg"), dropZone: $("dropZone"),
    resultPane: $("hResultPane"), levelNote: $("hLevelNote"), keep: $("hKeep"),
    themeBtn: $("themeBtn")
  };

  /* ---------- settings ---------------------------------------
     Rewrite strength and "how human" are deliberately separate.
     Bundling them is what makes a single Heavy setting drift off
     meaning: you cannot ask for a harder rewrite without also
     asking for more mistakes.

     Heavy rewriting leans on the two transformations that cannot
     change meaning by construction — phrase-bank swaps and
     structural rules — and pairs them with the Preserve-meaning
     safeguards, rather than simply swapping more words.
  ------------------------------------------------------------ */
  const LEVELS = {
    subtle:   { synonymStrength: .12, phraseStrength: .30, restructureStrength: .10,
                note: "Barely touched — a few stiff phrases loosened." },
    light:    { synonymStrength: .28, phraseStrength: .55, restructureStrength: .25,
                note: "Light touch — keeps your wording, loosens the phrasing." },
    balanced: { synonymStrength: .48, phraseStrength: .75, restructureStrength: .45,
                note: "Reworded and restructured, close to the original meaning." },
    strong:   { synonymStrength: .66, phraseStrength: .90, restructureStrength: .65,
                note: "Heavily reworded and reshaped, meaning still intact." },
    maximum:  { synonymStrength: .82, phraseStrength: .97, restructureStrength: .82,
                note: "Hardest rewrite — most sentences reshaped, meaning preserved." }
  };

  const SLIPS = {
    off:     { errorRate: 0,   errorTier: 1, note: "no mistakes" },
    few:     { errorRate: 1.2, errorTier: 1, note: "a few light slips" },
    natural: { errorRate: 2.6, errorTier: 2, note: "a natural rate of slips" },
    many:    { errorRate: 4.8, errorTier: 3, note: "plenty of visible slips" }
  };

  const TONES = {
    casual:  "contract",   // do not -> don't
    neutral: "keep",
    formal:  "expand"      // don't -> do not
  };

  let level = "balanced";
  let slip = "natural";
  let tone = "casual";
  let seed = Math.floor(Math.random() * 4294967295);
  let result = "";
  let baseName = "humanized";

  function options() {
    const L = LEVELS[level];
    const S = SLIPS[slip];
    return {
      seed: seed,
      useSynonyms: true,    synonymStrength: L.synonymStrength,
      usePhrases: true,     phraseStrength: L.phraseStrength,
      useRestructure: true, restructureStrength: L.restructureStrength,
      errorRate: S.errorRate,
      errorTier: S.errorTier,
      protectQuotes: true,
      protectCitations: true,
      contractionMode: TONES[tone],
      keepMeaning: el.keep.checked
    };
  }

  function updateNote() {
    el.levelNote.textContent = LEVELS[level].note + " With " + SLIPS[slip].note + ".";
  }

  /* Wire a group of segmented buttons to a setting. */
  function group(selector, attr, onPick) {
    document.querySelectorAll(selector).forEach(btn => {
      btn.addEventListener("click", () => {
        onPick(btn.dataset[attr]);
        document.querySelectorAll(selector).forEach(b =>
          b.classList.toggle("is-active", b === btn));
        updateNote();
        if (result) run();      // already have output — refresh it in place
      });
    });
  }

  group(".lvl",  "level", v => { level = v; });
  group(".slip", "slip",  v => { slip = v; });
  group(".tone", "tone",  v => { tone = v; });

  el.keep.addEventListener("change", () => { if (result) run(); });

  /* ---------- run ---------- */
  function run() {
    const src = el.input.value;
    if (!src.trim()) {
      showMsg("Add some text first — paste it above or upload a file.");
      el.input.focus();
      return;
    }
    hideMsg();

    let res;
    try {
      res = paraphrase(src, options());
    } catch (e) {
      showMsg("Something went wrong: " + e.message);
      return;
    }

    result = res.text;
    el.output.textContent = result;
    el.outWords.textContent = countWords(result);
    el.resultPane.hidden = false;
    el.resultPane.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  el.run.addEventListener("click", run);
  el.regen.addEventListener("click", () => {
    seed = Math.floor(Math.random() * 4294967295);
    run();
  });

  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });

  /* ---------- counts ---------- */
  function countWords(s) {
    const m = s.match(/[A-Za-z0-9'’-]+/g);
    return m ? m.length : 0;
  }
  el.input.addEventListener("input", () => {
    el.words.textContent = countWords(el.input.value);
  });

  /* ---------- copy ---------- */
  el.copy.addEventListener("click", async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      flash(el.copy, "Copied");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = result;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); flash(el.copy, "Copied"); }
      catch (e2) { flash(el.copy, "Press Ctrl+C"); }
      document.body.removeChild(ta);
    }
  });

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.classList.add("ok");
    setTimeout(() => { btn.textContent = old; btn.classList.remove("ok"); }, 1400);
  }

  /* ---------- downloads ---------- */
  document.querySelectorAll(".dl-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!result) return;
      const fmt = btn.dataset.fmt;
      try {
        if (fmt === "txt")  exportPlain(result, baseName + ".txt");
        if (fmt === "md")   exportPlain(result, baseName + ".md");
        if (fmt === "docx") downloadBlob(buildDocx(result), baseName + ".docx");
        if (fmt === "pdf")  downloadBlob(buildPdf(result), baseName + ".pdf");
        flash(btn, "Saved");
      } catch (e) {
        showMsg("Could not create the " + fmt.toUpperCase() + " file: " + e.message);
      }
    });
  });

  /* ---------- file loading ---------- */
  function showMsg(text, kind) {
    el.msg.textContent = text;
    el.msg.className = "file-msg" + (kind === "info" ? " info" : "");
    el.msg.hidden = false;
  }
  function hideMsg() { el.msg.hidden = true; }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      showMsg("That file is larger than 12 MB. Use a smaller one, or paste the text in.");
      return;
    }
    showMsg("Reading " + file.name + "…", "info");
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim()) { showMsg("No readable text was found in " + file.name + "."); return; }
      el.input.value = text;
      el.words.textContent = countWords(text);
      // Name downloads after the uploaded file
      baseName = (file.name.replace(/\.[^.]+$/, "") || "humanized") + "-humanized";
      showMsg("Loaded " + file.name + " — " + countWords(text) + " words.", "info");
      setTimeout(hideMsg, 3500);
    } catch (err) {
      showMsg(err.message || "That file could not be read.");
    }
  }

  el.file.addEventListener("change", e => {
    loadFile(e.target.files[0]);
    e.target.value = "";
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
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => e.preventDefault());

  /* ---------- theme (shared with the Paraphraser) ---------- */
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

  /* ---------- boot ---------- */
  updateNote();
})();
