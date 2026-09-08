/* ============================================================
   transform.js  —  Sentence restructuring + human-error injection
   All deterministic rules. Nothing here is learned or generated.
   ============================================================ */

/* ============================================================
   PART A — SYNTACTIC RESTRUCTURING
   Word swapping alone leaves the original sentence skeleton
   intact. These rules change the skeleton itself, which is what
   separates a real paraphrase from a thesaurus find-and-replace.
   ============================================================ */

/* Split a sentence into [body, trailingPunctAndSpace] so rules can
   work on the body and put the punctuation back untouched. */
function peelSentence(s) {
  const m = s.match(/^([\s\S]*?)([.!?]+["'’”)\]]*\s*)$/);
  if (!m) return [s, ""];
  return [m[1], m[2]];
}

function capFirst(s) {
  const i = s.search(/[A-Za-z]/);
  if (i === -1) return s;
  return s.slice(0, i) + s.charAt(i).toUpperCase() + s.slice(i + 1);
}
function lowerFirst(s) {
  const i = s.search(/[A-Za-z]/);
  if (i === -1) return s;
  // Never lowercase a proper noun or the pronoun "I"
  const rest = s.slice(i);
  if (/^I\b/.test(rest)) return s;
  const word = (rest.match(/^[A-Za-z]+/) || [""])[0];
  if (word.length > 1 && word === word.toUpperCase()) return s; // acronym
  return s.slice(0, i) + s.charAt(i).toLowerCase() + s.slice(i + 1);
}

/* --- Rule 1: swap the opening discourse connective ------------ */
function ruleConnective(body, rng) {
  const m = body.match(/^(\s*)([A-Za-z]+)(\s*,\s*)([\s\S]+)$/);
  if (!m) return null;
  const key = m[2].toLowerCase();
  if (!CONNECTIVES[key]) return null;
  const choice = rng.pick(CONNECTIVES[key]);
  if (choice.toLowerCase() === key) return null;
  return m[1] + capFirst(choice) + m[3] + m[4];
}

/* --- Rule 2: front a trailing subordinate clause --------------
   "X increased because Y fell"  ->  "Because Y fell, X increased" */
function ruleFrontClause(body, rng) {
  const m = body.match(/^([\s\S]{15,}?)\s*,?\s+\b(because|since|although|though|while|whereas|when|if|after|before|unless|until)\b\s+([\s\S]{12,})$/i);
  if (!m) return null;
  let main = m[1].trim();
  const conj = m[2].toLowerCase();
  const sub = m[3].trim();
  // Both halves must look like clauses (contain a verb-ish token)
  if (!looksLikeClause(main) || !looksLikeClause(sub)) return null;
  if (sub.includes(",")) return null; // too complex to move safely

  // If the main clause opens with a connective ("However, there are ..."),
  // keep it at the very front instead of stranding it mid-sentence.
  let lead = "";
  const cm = main.match(/^([A-Za-z]+)\s*,\s*([\s\S]+)$/);
  if (cm && CONNECTIVES[cm[1].toLowerCase()]) {
    lead = capFirst(cm[1]) + ", ";
    main = cm[2].trim();
  }
  const front = lead
    ? lead + lowerFirst(conj) + " " + lowerFirst(sub)
    : capFirst(conj) + " " + lowerFirst(sub);
  return front + ", " + lowerFirst(main);
}

function looksLikeClause(s) {
  const words = s.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length < 3) return false;
  return words.some(w =>
    AUXILIARIES.has(w) || /(ed|ing|s)$/.test(w) ||
    (THESAURUS[w] && THESAURUS[w][0] === "v") ||
    (THESAURUS[verbBase(w)] && THESAURUS[verbBase(w)][0] === "v"));
}

/* --- Rule 3: passive -> active --------------------------------
   "The data were analysed by the team" -> "The team analysed the data" */
function rulePassiveToActive(body, rng) {
  const m = body.match(/^(\s*)([A-Z]?[\s\S]{3,80}?)\s+\b(was|were|is|are)\b\s+([a-z]+(?:ed|n))\s+by\s+([\s\S]{3,60})$/);
  if (!m) return null;
  const subject = m[2].trim();
  const beVerb = m[3];
  const participle = m[4];
  let agent = m[5].trim();
  if (/\b(and|or)\b|[,;]/.test(agent)) return null; // compound agent — skip
  if (agent.split(/\s+/).length > 8) return null;

  const base = verbBase(participle);
  if (!base || base === participle && !/ed$/.test(participle)) return null;

  const past = beVerb === "was" || beVerb === "were";
  const agentPlural = /\b(they|we|people|data|children|men|women)\b/i.test(agent) ||
    (/s$/.test(agent.split(/\s+/).pop()) && !/ss$/.test(agent));

  let verb;
  if (past) verb = toPast(base);
  else verb = agentPlural ? base : toThird(base);

  return m[1] + capFirst(lowerFirst(agent)) + " " + verb + " " + lowerFirst(subject);
}

/* --- Rule 4: dissolve "There is/are X that Y" ------------------ */
function ruleThereIs(body, rng) {
  // Allow an opening connective: "However, there are problems that ..."
  const m = body.match(/^(\s*)(?:([A-Za-z]+)\s*,\s*)?There\s+(is|are|was|were)\s+([\s\S]{3,70}?)\s+(that|which|who)\s+([\s\S]{5,})$/i);
  if (!m) return null;
  if (m[2] && !CONNECTIVES[m[2].toLowerCase()]) return null;
  const lead = m[2] ? capFirst(m[2]) + ", " : "";
  const core = m[4].trim();
  return m[1] + lead + (lead ? lowerFirst(core) : capFirst(core)) + " " + m[6].trim();
}

/* --- Rule 5: split a long coordinated sentence ----------------- */
function ruleSplit(body, rng) {
  if (body.split(/\s+/).length < 14) return null;
  const m = body.match(/^([\s\S]{25,})\s*,\s+\b(and|but|so|yet)\b\s+([\s\S]{20,})$/);
  if (!m) return null;
  const left = m[1].trim();
  const right = m[3].trim();
  if (!looksLikeClause(left) || !looksLikeClause(right)) return null;
  if (/^(the|a|an)\s+\w+$/i.test(right)) return null;

  const opener = { and: ["Also, ", "In addition, ", ""], but: ["However, ", "That said, "],
                   so: ["As a result, ", "Consequently, "], yet: ["Even so, ", "Still, "] }[m[2]];
  const lead = rng.pick(opener);
  return left + ". " + (lead ? lead + lowerFirst(right) : capFirst(right));
}

/* --- Rule 6: move a leading adverb to mid-position -------------
   "Clearly, the results improved" -> "The results clearly improved" */
function ruleMoveAdverb(body, rng) {
  const m = body.match(/^(\s*)([A-Za-z]+ly)\s*,\s+([\s\S]+)$/);
  if (!m) return null;
  const adv = m[2].toLowerCase();
  const rest = m[3];
  // Insert after the first auxiliary if there is one, else before the verb
  const am = rest.match(/^([\s\S]{3,60}?\s)\b(is|are|was|were|has|have|had|will|would|can|could|may|might)\b(\s)/);
  if (!am) return null;
  return m[1] + capFirst(am[1]) + am[2] + " " + adv + am[3] + rest.slice(am[0].length);
}

/* --- Rule 7: contraction toggling ------------------------------ */
function ruleContract(body, rng, direction) {
  let out = body;
  let changed = false;
  if (direction === "contract") {
    for (const full in CONTRACTIONS) {
      const re = new RegExp("\\b" + full.replace(" ", "\\s+") + "\\b", "gi");
      if (re.test(out)) {
        out = out.replace(re, m => { changed = true; return matchCase(m, CONTRACTIONS[full]); });
      }
    }
  } else {
    for (const full in CONTRACTIONS) {
      const short = CONTRACTIONS[full];
      const re = new RegExp("\\b" + short.replace("'", "['’]") + "\\b", "gi");
      if (re.test(out)) {
        out = out.replace(re, m => { changed = true; return matchCase(m, full); });
      }
    }
  }
  return changed ? out : null;
}

const RESTRUCTURE_RULES = [
  { name: "connective", fn: ruleConnective, weight: 3 },
  { name: "frontClause", fn: ruleFrontClause, weight: 3 },
  { name: "passiveToActive", fn: rulePassiveToActive, weight: 3 },
  { name: "thereIs", fn: ruleThereIs, weight: 2 },
  { name: "split", fn: ruleSplit, weight: 2 },
  { name: "moveAdverb", fn: ruleMoveAdverb, weight: 2 }
];

/* Apply at most one structural rule per sentence — stacking them
   is where rule-based paraphrasers usually produce garbage. */
function restructureSentence(sentence, rng, strength, stats) {
  if (!rng.chance(strength)) return sentence;
  const [body, tail] = peelSentence(sentence);
  if (body.trim().length < 12) return sentence;

  // Weighted shuffle, then take the first rule that fires
  const pool = [];
  RESTRUCTURE_RULES.forEach(r => { for (let i = 0; i < r.weight; i++) pool.push(r); });
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const tried = new Set();
  for (const rule of pool) {
    if (tried.has(rule.name)) continue;
    tried.add(rule.name);
    let out = null;
    try { out = rule.fn(body, rng); } catch (e) { out = null; }
    if (out && out.trim() && out !== body) {
      stats.restructured++;
      stats.rules[rule.name] = (stats.rules[rule.name] || 0) + 1;
      return out + tail;
    }
  }
  return sentence;
}

/* ============================================================
   PART B — HUMAN-ERROR INJECTION
   Realistic small slips a rushed but competent writer makes.
   Every error type is deliberately minor: the text must stay
   fully readable and the meaning must never change.
   ============================================================ */

/* Each injector returns the modified sentence, or null if it
   found nothing to change. */

/* Drop a "the" or "a" — the single most common ESL/rushed slip. */
function errDropArticle(s, rng) {
  const matches = [...s.matchAll(/\s\b(the|a|an)\b\s/gi)];
  if (!matches.length) return null;
  const m = rng.pick(matches);
  if (m.index === 0) return null;
  return s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
}

/* Subject-verb agreement slip. */
function errAgreement(s, rng) {
  const variants = [
    [/\b(he|she|it)\s+(is)\b/gi, (m, p, v) => p + " " + (v[0] === "I" ? "Are" : "are")],
    [/\b(they|we|you)\s+(are)\b/gi, (m, p) => p + " was"],
    [/\b(they|we)\s+(were)\b/gi, (m, p) => p + " was"],
    [/\b(he|she|it)\s+(was)\b/gi, (m, p) => p + " were"],
    [/\b(he|she|it)\s+([a-z]+)s\b/g, (m, p, v) =>
      (["is", "wa", "ha", "doe", "goe"].includes(v) ? m : p + " " + v)],
    [/\b(does)\s+not\b/gi, () => "do not"],
    [/\b(has)\s+been\b/gi, () => "have been"]
  ];
  for (let attempt = 0; attempt < 6; attempt++) {
    const [re, fn] = rng.pick(variants);
    const all = [...s.matchAll(re)];
    if (!all.length) continue;
    const chosen = rng.pick(all);
    const replaced = fn(chosen[0], chosen[1], chosen[2]);
    if (!replaced || replaced === chosen[0]) continue;
    return s.slice(0, chosen.index) + replaced + s.slice(chosen.index + chosen[0].length);
  }
  return null;
}

/* its/it's, their/there, then/than ... */
function errConfusable(s, rng) {
  const total = CONFUSABLES.reduce((a, c) => a + c.w, 0);
  for (let attempt = 0; attempt < 8; attempt++) {
    let r = rng() * total;
    let pair = CONFUSABLES[0];
    for (const c of CONFUSABLES) { r -= c.w; if (r <= 0) { pair = c; break; } }
    const re = new RegExp("\\b" + pair.a.replace("'", "['’]") + "\\b", "gi");
    const all = [...s.matchAll(re)];
    if (!all.length) continue;
    const chosen = rng.pick(all);
    return s.slice(0, chosen.index) + matchCase(chosen[0], pair.b) + s.slice(chosen.index + chosen[0].length);
  }
  return null;
}

/* Missing apostrophe in a contraction. */
function errApostrophe(s, rng) {
  const keys = Object.keys(APOSTROPHE_DROPS);
  for (let attempt = 0; attempt < 6; attempt++) {
    const k = rng.pick(keys);
    const re = new RegExp("\\b" + k.replace("'", "['’]") + "\\b", "gi");
    const all = [...s.matchAll(re)];
    if (!all.length) continue;
    const chosen = rng.pick(all);
    return s.slice(0, chosen.index) + matchCase(chosen[0], APOSTROPHE_DROPS[k]) + s.slice(chosen.index + chosen[0].length);
  }
  return null;
}

/* Drop the comma before a coordinating conjunction. */
function errDropComma(s, rng) {
  const all = [...s.matchAll(/,(\s+(?:and|but|or|so|which|while)\b)/gi)];
  if (!all.length) return null;
  const m = rng.pick(all);
  return s.slice(0, m.index) + m[1] + s.slice(m.index + m[0].length);
}

/* Add a comma where a careful writer would not put one. */
function errAddComma(s, rng) {
  const all = [...s.matchAll(/\b(that|because|when|if)\b/gi)];
  if (!all.length) return null;
  const m = rng.pick(all);
  if (m.index === 0) return null;
  if (s[m.index - 2] === ",") return null;
  return s.slice(0, m.index - 1) + ", " + s.slice(m.index);
}

/* Comma splice: replace a full stop between two clauses with a comma. */
function errCommaSplice(s, rng) {
  const m = s.match(/^([\s\S]{20,}?[a-z])\.\s+([A-Z][\s\S]{15,})$/);
  if (!m) return null;
  return m[1] + ", " + lowerFirst(m[2]);
}

/* Preposition slip. */
function errPreposition(s, rng) {
  const swaps = { "in": ["on", "at"], "on": ["in", "at"], "at": ["in", "on"],
                  "to": ["for"], "for": ["to"], "with": ["by"], "by": ["with"],
                  "among": ["between"], "between": ["among"] };
  const keys = Object.keys(swaps);
  for (let attempt = 0; attempt < 8; attempt++) {
    const k = rng.pick(keys);
    const all = [...s.matchAll(new RegExp("\\b" + k + "\\b", "gi"))];
    if (!all.length) continue;
    const chosen = rng.pick(all);
    if (chosen.index === 0) continue;
    return s.slice(0, chosen.index) + matchCase(chosen[0], rng.pick(swaps[k])) + s.slice(chosen.index + chosen[0].length);
  }
  return null;
}

/* Typing slips: double space, or a missing space after a comma. */
function errSpacing(s, rng) {
  if (rng.chance(0.5)) {
    const all = [...s.matchAll(/(\w) (\w)/g)];
    if (!all.length) return null;
    const m = rng.pick(all);
    return s.slice(0, m.index) + m[1] + "  " + m[2] + s.slice(m.index + m[0].length);
  }
  const all = [...s.matchAll(/, (\w)/g)];
  if (!all.length) return null;
  const m = rng.pick(all);
  return s.slice(0, m.index) + "," + m[1] + s.slice(m.index + m[0].length);
}

/* Accidentally typing a short word twice. */
function errDoubleWord(s, rng) {
  const all = [...s.matchAll(/\s\b(the|a|of|to|in|is|that|and)\b\s/gi)];
  if (!all.length) return null;
  const m = rng.pick(all);
  return s.slice(0, m.index) + " " + m[1] + " " + m[1] + " " + s.slice(m.index + m[0].length);
}

/* Plural slip on a mass noun. */
function errPluralSlip(s, rng) {
  const mass = { "information": "informations", "research": "researches",
                 "equipment": "equipments", "advice": "advices", "evidence": "evidences",
                 "knowledge": "knowledges", "software": "softwares", "feedback": "feedbacks" };
  const keys = Object.keys(mass);
  for (let attempt = 0; attempt < 5; attempt++) {
    const k = rng.pick(keys);
    const re = new RegExp("\\b" + k + "\\b", "gi");
    const all = [...s.matchAll(re)];
    if (!all.length) continue;
    const chosen = rng.pick(all);
    return s.slice(0, chosen.index) + matchCase(chosen[0], mass[k]) + s.slice(chosen.index + chosen[0].length);
  }
  return null;
}

/* Wrong a/an before the following word. */
function errArticleAgreement(s, rng) {
  const all = [...s.matchAll(/\b(a|an)(\s+)([A-Za-z][A-Za-z'-]*)/gi)];
  if (!all.length) return null;
  const m = rng.pick(all);
  const wrong = m[1].toLowerCase() === "a" ? "an" : "a";
  return s.slice(0, m.index) + matchCase(m[1], wrong) + m[2] + m[3] + s.slice(m.index + m[0].length);
}

/* Weighted error pool. Higher weight = more frequently chosen,
   tuned so the common, believable slips dominate. */
const ERROR_TYPES = [
  { name: "article",     fn: errDropArticle,      w: 16, tier: 1 },
  { name: "confusable",  fn: errConfusable,       w: 15, tier: 1 },
  { name: "comma",       fn: errDropComma,        w: 12, tier: 1 },
  { name: "agreement",   fn: errAgreement,        w: 12, tier: 2 },
  { name: "apostrophe",  fn: errApostrophe,       w: 10, tier: 1 },
  { name: "preposition", fn: errPreposition,      w:  9, tier: 2 },
  { name: "addComma",    fn: errAddComma,         w:  8, tier: 1 },
  { name: "spacing",     fn: errSpacing,          w:  7, tier: 1 },
  { name: "articleAgr",  fn: errArticleAgreement, w:  6, tier: 2 },
  { name: "pluralSlip",  fn: errPluralSlip,       w:  5, tier: 2 },
  { name: "commaSplice", fn: errCommaSplice,      w:  4, tier: 3 },
  { name: "doubleWord",  fn: errDoubleWord,       w:  3, tier: 3 }
];

/* Inject roughly `rate` errors per 100 words, spread across
   sentences, capped per sentence so no single sentence turns into
   a mess. maxTier limits how disruptive the allowed slips are. */
function injectErrors(sentences, rng, rate, maxTier, stats) {
  if (rate <= 0) return sentences;

  const totalWords = sentences.join(" ").split(/\s+/).filter(Boolean).length;
  let budget = Math.round((totalWords / 100) * rate);
  if (budget <= 0) return sentences;

  const allowed = ERROR_TYPES.filter(e => e.tier <= maxTier);
  const totalW = allowed.reduce((a, e) => a + e.w, 0);
  const out = sentences.slice();

  // Visit sentences in random order so errors are not front-loaded
  const order = out.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  let guard = 0;
  while (budget > 0 && guard < order.length * 4) {
    guard++;
    const idx = order[guard % order.length];
    const sentence = out[idx];
    const wordCount = sentence.split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) continue;
    // No more than one slip per 12 words in any single sentence
    const perSentenceCap = Math.max(1, Math.floor(wordCount / 12));
    if ((stats.perSentence[idx] || 0) >= perSentenceCap) continue;

    // Pick an error type by weight, then try a few until one applies
    let applied = null, appliedName = null;
    for (let attempt = 0; attempt < 5 && !applied; attempt++) {
      let r = rng() * totalW;
      let chosen = allowed[0];
      for (const e of allowed) { r -= e.w; if (r <= 0) { chosen = e; break; } }
      let res = null;
      try { res = chosen.fn(sentence, rng); } catch (e) { res = null; }
      if (res && res !== sentence) { applied = res; appliedName = chosen.name; }
    }
    if (!applied) continue;

    out[idx] = applied;
    stats.perSentence[idx] = (stats.perSentence[idx] || 0) + 1;
    stats.errors++;
    stats.errorTypes[appliedName] = (stats.errorTypes[appliedName] || 0) + 1;
    budget--;
  }
  return out;
}

/* ============================================================
   PART C — PIPELINE
   ============================================================ */
function paraphrase(text, opts) {
  const rng = makeRng(opts.seed);
  const stats = {
    replaced: 0, restructured: 0, errors: 0,
    rules: {}, errorTypes: {}, perSentence: {}
  };

  if (!text || !text.trim()) return { text: "", stats };

  // Work paragraph by paragraph so blank-line layout survives
  const paragraphs = text.split(/(\n\s*\n)/);
  const outParas = [];
  const cleanParas = []; // same output but with no errors injected

  // Shared across every paragraph so a term is rewritten consistently
  // throughout the whole document, not re-rolled per paragraph.
  const termMemory = opts.keepMeaning ? new Map() : null;

  // Reserve every term the document already uses, so a rewrite never
  // introduces a word that already carries its own meaning here — with
  // "framework" present, "system" must not become "framework" too.
  if (termMemory) {
    const used = new Set();
    const words = text.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
    for (const w of words) {
      for (const form of [w, singularise(w), verbBase(w)]) {
        if (THESAURUS[form]) used.add(form);
      }
    }
    termMemory.usedChoices = used;
  }

  for (const para of paragraphs) {
    if (/^\n\s*\n$/.test(para) || !para.trim()) { outParas.push(para); cleanParas.push(para); continue; }

    const mask = buildProtectedMask(para, opts);

    // 1. Phrase-level rewriting (longest match first)
    let work = opts.usePhrases ? replacePhrases(para, rng, opts.phraseStrength, mask) : para;

    // 2. Word-level synonym substitution (POS + morphology aware)
    // Mask indices shifted after step 1, so recompute against the new
    // string — and additionally protect any fixed phrase left in place.
    const mask2 = buildProtectedMask(work, Object.assign({}, opts, { maskPhraseKeys: true }));
    if (opts.useSynonyms) {
      work = replaceWords(work, rng, opts.synonymStrength, mask2, stats,
                          !!opts.keepMeaning, termMemory);
    }

    // 3. Structural rules, one per sentence at most
    let sentences = splitSentences(work);
    if (opts.useRestructure) {
      sentences = sentences.map(s => restructureSentence(s, rng, opts.restructureStrength, stats));
    }

    // 4. Contraction style
    if (opts.contractionMode !== "keep") {
      sentences = sentences.map(s => {
        const [b, t] = peelSentence(s);
        const r = ruleContract(b, rng, opts.contractionMode);
        return r ? r + t : s;
      });
    }

    // 5. Tidy up grammar the earlier steps may have disturbed
    sentences = sentences.map(s => fixArticles(s));
    cleanParas.push(sentences.join(""));

    // 6. Inject human slips last, so nothing "fixes" them afterwards
    const localStats = { errors: 0, errorTypes: stats.errorTypes, perSentence: {} };
    sentences = injectErrors(sentences, rng, opts.errorRate, opts.errorTier, localStats);
    stats.errors += localStats.errors;

    outParas.push(sentences.join(""));
  }

  return { text: outParas.join(""), clean: cleanParas.join(""), stats };
}

/* ---------- Diff for the change highlighter -------------------
   Word-level longest-common-subsequence. Used only for display.
--------------------------------------------------------------- */
/* The pipeline emits exactly one output paragraph per input paragraph,
   so the two texts can be diffed paragraph by paragraph. That keeps the
   quadratic cost tiny and lets highlighting work on long documents. */
function diffWordsChunked(a, b) {
  const A = a.split(/(\n\s*\n)/);
  const B = b.split(/(\n\s*\n)/);
  if (A.length !== B.length) return diffWords(a, b);

  const ops = [];
  for (let i = 0; i < A.length; i++) {
    if (A[i] === B[i]) {
      if (B[i]) ops.push({ type: "eq", text: B[i] });
    } else {
      const part = diffWords(A[i], B[i]);
      for (const op of part) ops.push(op);
    }
  }
  return ops;
}

function diffWords(a, b) {
  const A = a.match(/\S+|\s+/g) || [];
  const B = b.match(/\S+|\s+/g) || [];
  const n = A.length, m = B.length;

  // Guard against pathological memory use on very large inputs
  if (n * m > 4000000) return [{ type: "eq", text: b }];

  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = A[i] === B[j]
        ? dp[at(i + 1, j + 1)] + 1
        : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ type: "eq", text: B[j] }); i++; j++; }
    else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) { ops.push({ type: "del", text: A[i] }); i++; }
    else { ops.push({ type: "ins", text: B[j] }); j++; }
  }
  while (i < n) { ops.push({ type: "del", text: A[i] }); i++; }
  while (j < m) { ops.push({ type: "ins", text: B[j] }); j++; }
  return ops;
}
