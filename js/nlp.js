/* ============================================================
   nlp.js  —  Tokenising, POS tagging, morphology, synonyms
   Pure rule-based / dictionary-driven. No model, no network.
   ============================================================ */

/* ---------- Seeded RNG (mulberry32) ---------------------------
   A seeded generator makes every run reproducible: the same text
   plus the same seed always yields the same paraphrase, which is
   essential for testing. Press "Shuffle" for a new seed.
--------------------------------------------------------------- */
function makeRng(seed) {
  let s = seed >>> 0;
  const rng = function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.chance = p => rng() < p;
  return rng;
}

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------- Tokenisation --------------------------------------
   Keeps whitespace and punctuation as their own tokens so the
   original spacing and layout can be rebuilt exactly.
--------------------------------------------------------------- */
function tokenize(text) {
  const tokens = [];
  // word (incl. internal apostrophes/hyphens) | whitespace | anything else
  const re = /([A-Za-z]+(?:['’-][A-Za-z]+)*)|(\s+)|([^A-Za-z\s]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) tokens.push({ t: "w", s: m[1] });
    else if (m[2]) tokens.push({ t: "ws", s: m[2] });
    else tokens.push({ t: "p", s: m[3] });
  }
  return tokens;
}

function detokenize(tokens) {
  return tokens.map(t => t.s).join("");
}

/* ---------- Sentence splitting --------------------------------
   Abbreviation-aware so "e.g." and "Dr." do not split a sentence.
--------------------------------------------------------------- */
const ABBREV = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "jr", "sr", "vs", "etc",
  "e.g", "i.e", "eg", "ie", "fig", "no", "vol", "al", "approx", "dept", "est", "inc", "ltd"]);

function splitSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?") continue;

    // Consume runs like "?!" or "..."
    let j = i;
    while (j + 1 < text.length && ".!?".includes(text[j + 1])) j++;

    const after = text[j + 1];
    if (after !== undefined && !/\s/.test(after)) { i = j; continue; }

    // Don't split on a known abbreviation or a single initial ("J. Smith")
    const before = text.slice(start, i);
    const lastWord = (before.match(/([A-Za-z.]+)$/) || ["", ""])[1].toLowerCase();
    if (c === "." && (ABBREV.has(lastWord) || /^[a-z]$/.test(lastWord))) { i = j; continue; }

    // Include trailing closing quote/bracket, then trailing whitespace
    let end = j + 1;
    while (end < text.length && /["'’”)\]]/.test(text[end])) end++;
    while (end < text.length && /\s/.test(text[end])) end++;

    out.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out.filter(s => s.length > 0);
}

/* ---------- Lightweight POS tagger ----------------------------
   Suffix rules + closed-class word lists + local context. This is
   the classic pre-statistical approach (Brill-style rules without
   the learned component). It only has to be good enough to stop a
   noun being swapped for a verb — not to build a full parse tree.
--------------------------------------------------------------- */
const DETERMINERS = new Set(["a", "an", "the", "this", "that", "these", "those", "some", "any",
  "each", "every", "no", "another", "such", "my", "your", "his", "her", "its", "our", "their"]);
const AUXILIARIES = new Set(["is", "are", "was", "were", "be", "been", "being", "am",
  "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should",
  "can", "could", "may", "might", "must"]);
const PREPOSITIONS = new Set(["of", "in", "on", "at", "by", "for", "with", "from", "to", "into",
  "onto", "upon", "about", "against", "between", "through", "during", "before", "after",
  "above", "below", "under", "over", "among", "across", "within", "without", "toward", "towards"]);
const PRONOUNS = new Set(["i", "you", "he", "she", "it", "we", "they", "me", "him", "her",
  "us", "them", "who", "which", "what", "this", "that", "these", "those"]);
/* Quantifiers act like determiners when tagging: whatever follows
   "many", "several" or "few" is a noun, never a verb. Without this,
   "many records" tags "records" as a verb and becomes "notes down". */
const QUANTIFIERS = new Set(["many", "several", "few", "more", "most", "much",
  "numerous", "various", "multiple", "countless", "all", "both", "other", "certain"]);

function tagTokens(tokens) {
  // Index of each word token, for context lookups
  const words = [];
  tokens.forEach((tk, i) => { if (tk.t === "w") words.push(i); });

  for (let k = 0; k < words.length; k++) {
    const tk = tokens[words[k]];
    const lower = tk.s.toLowerCase();
    const prev = k > 0 ? tokens[words[k - 1]].s.toLowerCase() : null;
    const next = k < words.length - 1 ? tokens[words[k + 1]].s.toLowerCase() : null;

    tk.lower = lower;
    tk.pos = guessPos(lower, prev, next, tk.s);
    tk.isProper = /^[A-Z]/.test(tk.s) && k > 0; // sentence-initial caps handled by caller
  }
  return tokens;
}

/* A thesaurus value is either ["pos", ...syns] or, for words with
   more than one part of speech, [["n", ...], ["v", ...]]. */
function entriesFor(word) {
  const e = THESAURUS[word];
  if (!e) return null;
  return Array.isArray(e[0]) ? e : [e];
}

function posesFor(word) {
  const es = entriesFor(word);
  return es ? es.map(x => x[0]) : [];
}

function guessPos(w, prev, next, raw) {
  if (DETERMINERS.has(w)) return "det";
  if (AUXILIARIES.has(w)) return "aux";
  if (PREPOSITIONS.has(w)) return "prep";
  if (PRONOUNS.has(w)) return "pron";
  if (["and", "or", "but", "nor", "so", "yet", "because", "although", "though",
       "while", "if", "unless", "until", "since", "whether"].includes(w)) return "conj";

  // A dictionary hit is the strongest signal we have
  const poses = posesFor(w).concat(posesFor(singularise(w))).concat(posesFor(verbBase(w)));
  const hasPos = p => poses.indexOf(p) !== -1;
  const dictPos = poses.length ? poses[0] : null;

  // A plural that is also a verb ("recent studies show") is a noun when
  // the word after it is itself a verb — i.e. it is the subject.
  if (/s$/.test(w) && !/ss$/.test(w) && hasPos("n") && next) {
    if (AUXILIARIES.has(next) ||
        posesFor(next).indexOf("v") !== -1 ||
        posesFor(verbBase(next)).indexOf("v") !== -1) return "n";
  }

  // --- contextual overrides ---
  // After a determiner, and not followed by a noun-ish word -> noun
  if (prev && (DETERMINERS.has(prev) || QUANTIFIERS.has(prev)) && !/ly$/.test(w)) {
    if (hasPos("adj") && next && !DETERMINERS.has(next)) return "adj";
    if (hasPos("n")) return "n";
    if (dictPos) return dictPos === "v" ? "n" : dictPos;
    return "n";
  }
  // After an auxiliary -> verb (participle or infinitive)
  if (prev && AUXILIARIES.has(prev)) {
    if (/ed$|ing$|en$/.test(w)) return "v";
    if (hasPos("adj")) return "adj";                       // "is important"
    if (hasPos("n") && !hasPos("v")) return "n";           // "is a factor"
    return "v";                                            // "will increase"
  }
  // "to <verb>"
  if (prev === "to" && hasPos("v")) return "v";

  // --- suffix rules ---
  if (/ly$/.test(w) && w.length > 4) return "adv";
  if (/(ous|ful|ive|able|ible|al|ic|ical|ish|less|ary|ent|ant)$/.test(w) && w.length > 5) {
    return dictPos === "n" ? dictPos : "adj";
  }
  if (/(tion|sion|ment|ness|ity|ance|ence|ship|hood|ism|ist|er|or|ure|age)$/.test(w) && w.length > 5) {
    return "n";
  }
  if (/(ise|ize|ify|ate)$/.test(w) && w.length > 5) return "v";
  if (/ing$/.test(w) && w.length > 5) return dictPos === "n" ? "n" : "v";
  if (/ed$/.test(w) && w.length > 4) return "v";

  // A word that can be either noun or verb, with no signal so far:
  // sitting after a preposition or another verb makes it the object,
  // so tag it a noun. Without this, "needs support" -> "needs uphold".
  if (hasPos("n") && hasPos("v") && prev) {
    if (PREPOSITIONS.has(prev)) return "n";
    const prevPoses = posesFor(prev).concat(posesFor(verbBase(prev)));
    const prevIsVerb = prevPoses.indexOf("v") !== -1 &&
      (prevPoses.indexOf("n") === -1 || /(s|ed|ing)$/.test(prev));
    if (prevIsVerb) return "n";
  }

  if (dictPos) return dictPos;
  if (/s$/.test(w) && !/ss$/.test(w)) return "n"; // plural-ish
  return "n";
}

/* ---------- Morphology ----------------------------------------
   Detect the inflection of the original word and apply the same
   inflection to the replacement, so tense and number survive.
--------------------------------------------------------------- */
function singularise(w) {
  for (const k in IRREGULAR_PLURALS) if (IRREGULAR_PLURALS[k] === w) return k;
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$|us$|is$/.test(w)) return w.slice(0, -1);
  return w;
}

function pluralise(w) {
  if (IRREGULAR_PLURALS[w]) return IRREGULAR_PLURALS[w];
  // "means", "series", "research" ... have no distinct plural form
  if (UNCOUNTABLE.has(w)) return w;
  // Already plural ("records", "figures") — pluralising again gives "recordses"
  if (singularise(w) !== w) return w;
  if (/(s|sh|ch|x|z)$/.test(w)) return w + "es";
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  // -f/-fe -> -ves is a closed list, not a rule: "leaf" becomes "leaves"
  // but "motif" becomes "motifs", not "motives".
  if (F_TO_VES.has(w)) return w.replace(/fe?$/, "ves");
  return w + "s";
}

const F_TO_VES = new Set(["leaf", "loaf", "half", "wolf", "shelf", "self", "calf",
  "thief", "elf", "sheaf", "knife", "life", "wife"]);

const IRREGULAR_PLURAL_FORMS = new Set(Object.keys(IRREGULAR_PLURALS).map(k => IRREGULAR_PLURALS[k]));

function isPluralForm(w) {
  return /s$/.test(w) || IRREGULAR_PLURAL_FORMS.has(w);
}

function verbBase(w) {
  for (const b in IRREGULAR_VERBS) {
    if (IRREGULAR_VERBS[b].includes(w)) return b;
  }
  if (/ying$/.test(w)) return w.slice(0, -4) + "ie";
  if (/ing$/.test(w) && w.length > 5) {
    const stem = w.slice(0, -3);
    if (/([^aeiou])\1$/.test(stem)) return stem.slice(0, -1); // running -> run
    return stem + (/[^aeiouy]$/.test(stem) && !/[aeiou][^aeiou]$/.test(stem) ? "" : "");
  }
  if (/ied$/.test(w)) return w.slice(0, -3) + "y";
  if (/ed$/.test(w) && w.length > 4) {
    const stem = w.slice(0, -2);
    if (/([^aeiou])\1$/.test(stem)) return stem.slice(0, -1);
    return /e$/.test(stem) ? stem : stem;
  }
  if (/(ies)$/.test(w)) return w.slice(0, -3) + "y";
  if (/es$/.test(w) && /(ch|sh|s|x|z)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

function toPast(v) {
  if (IRREGULAR_VERBS[v]) return IRREGULAR_VERBS[v][0];
  if (/e$/.test(v)) return v + "d";
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ied";
  if (isDoublingStem(v)) return v + v.slice(-1) + "ed";
  return v + "ed";
}

/* Final consonant doubles only after a single stressed vowel:
   stop -> stopped, but bear -> beared (not "bearred") because the
   vowel is a digraph, and visit -> visited because it is longer. */
function isDoublingStem(v) {
  return /[^aeiou][aeiou][^aeiouwxy]$/.test(v) && v.length <= 4;
}

function toGerund(v) {
  if (IRREGULAR_VERBS[v]) return IRREGULAR_VERBS[v][2];
  if (/ie$/.test(v)) return v.slice(0, -2) + "ying";
  if (/e$/.test(v) && !/ee$/.test(v)) return v.slice(0, -1) + "ing";
  if (isDoublingStem(v)) return v + v.slice(-1) + "ing";
  return v + "ing";
}

function toThird(v) {
  if (IRREGULAR_VERBS[v]) return IRREGULAR_VERBS[v][3];
  if (/(s|sh|ch|x|z|o)$/.test(v)) return v + "es";
  if (/[^aeiou]y$/.test(v)) return v.slice(0, -1) + "ies";
  return v + "s";
}

/* Work out how `original` is inflected, then inflect `replacement`
   the same way. Multi-word replacements inflect their first word. */
function toParticiple(v) {
  if (IRREGULAR_VERBS[v]) return IRREGULAR_VERBS[v][1];
  return toPast(v);
}

const PERFECT_AUX = ["has", "have", "had", "been", "having"];

function matchInflection(original, replacement, pos, prevWord) {
  const parts = replacement.split(" ");
  const head = parts[0];
  const tail = parts.slice(1).join(" ");
  const join = w => (tail ? w + " " + tail : w);
  const o = original.toLowerCase();

  if (pos === "n") {
    const isPlural = o !== singularise(o);
    return join(isPlural ? pluralise(head) : head);
  }
  if (pos === "v") {
    const base = verbBase(o);
    // "has become" needs the participle. Verbs whose base and participle
    // are identical ("become", "put", "read") only reveal this by context.
    if (prevWord && PERFECT_AUX.indexOf(prevWord) !== -1 && !/ing$/.test(o)) {
      return join(toParticiple(head));
    }
    if (o === base) return join(head);
    if (IRREGULAR_VERBS[base]) {
      const forms = IRREGULAR_VERBS[base];
      if (o === forms[0]) return join(toPast(head));
      if (o === forms[1]) return join(toPast(head));
      if (o === forms[2]) return join(toGerund(head));
      if (o === forms[3]) return join(toThird(head));
    }
    if (/ing$/.test(o)) return join(toGerund(head));
    if (/ed$/.test(o)) return join(toPast(head));
    if (/s$/.test(o) && !/ss$/.test(o)) return join(toThird(head));
    return join(head);
  }
  if (pos === "adj") {
    if (/er$/.test(o) && !THESAURUS[o]) return join(head + (/e$/.test(head) ? "r" : "er"));
    if (/est$/.test(o) && !THESAURUS[o]) return join(head + (/e$/.test(head) ? "st" : "est"));
    return join(head);
  }
  return join(head);
}

/* Preserve the original capitalisation shape. */
function matchCase(original, replacement) {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (/^[A-Z]/.test(original)) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/* Correct a/an in front of whatever word now follows it. */
function fixArticles(text) {
  return text.replace(/\b(a|an|A|An)(\s+)([A-Za-z][A-Za-z'-]*)/g, (m, art, sp, word) => {
    const needsAn = startsWithVowelSound(word);
    let fixed = needsAn ? "an" : "a";
    if (/^[A-Z]/.test(art)) fixed = fixed.charAt(0).toUpperCase() + fixed.slice(1);
    return fixed + sp + word;
  });
}

function startsWithVowelSound(word) {
  const w = word.toLowerCase();
  // Consonant sound despite a vowel letter
  if (/^(uni|use|user|usu|euro|eul|one|once|ubiq|ukul)/.test(w)) return false;
  // Vowel sound despite a consonant letter
  if (/^(hour|honest|honour|honor|heir)/.test(w)) return true;
  if (/^[aeiou]/.test(w)) return true;
  // Initialisms read letter-by-letter: FBI -> "an F", MRI -> "an M"
  if (/^[A-Z]{2,}$/.test(word) && /^[AEFHILMNORSX]/.test(word)) return true;
  return false;
}

/* ---------- Synonym substitution ------------------------------ */

/* Regions the user asked to leave alone: quotations, citations,
   numbers with units, URLs, and anything inside [brackets]. */
function buildProtectedMask(text, opts) {
  const mask = new Array(text.length).fill(false);
  const mark = (a, b) => { for (let i = a; i < b && i < mask.length; i++) mask[i] = true; };
  const apply = re => { let m; re.lastIndex = 0; while ((m = re.exec(text)) !== null) mark(m.index, m.index + m[0].length); };

  if (opts.protectQuotes) {
    apply(/"[^"]{0,600}"/g);
    apply(/“[^”]{0,600}”/g);
    apply(/'[^']{2,200}'/g);
  }
  if (opts.protectCitations) {
    apply(/\([^)]{0,120}\d{4}[^)]{0,40}\)/g);  // (Smith, 2019)
    apply(/\[[^\]]{0,120}\]/g);                 // [12]
    apply(/\b[A-Z][a-z]+\s+(?:et\s+al\.?)\s*\(?\d{4}\)?/g);
    apply(/\bdoi:\S+/gi);
  }
  apply(/https?:\/\/\S+/g);
  apply(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g);

  // Established multi-word terms are meaningless once split apart
  for (const term of PROTECTED_TERMS) {
    apply(new RegExp("\\b" + term.replace(/ /g, "\\s+") + "\\b", "gi"));
  }

  // Any phrase-bank entry the phrase pass chose NOT to rewrite must be
  // left whole, or word-level substitution mangles it: "in conclusion"
  // would otherwise become "in deduction".
  if (opts.maskPhraseKeys) {
    for (const key in PHRASES) {
      const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
      apply(new RegExp("\\b" + esc + "\\b", "gi"));
    }
  }
  return mask;
}

function isMasked(mask, start, len) {
  for (let i = start; i < start + len; i++) if (mask[i]) return true;
  return false;
}

/* Phrase-level replacement, longest match first. */
function replacePhrases(text, rng, strength, mask) {
  const keys = Object.keys(PHRASES).sort((a, b) => b.length - a.length);
  let result = text;
  const offsets = mask; // mask indices refer to the original string

  for (const key of keys) {
    const re = new RegExp("\\b" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    result = result.replace(re, (match, idx) => {
      if (offsets && isMasked(offsets, idx, match.length)) return match;
      if (!rng.chance(strength)) return match;
      const choice = rng.pick(PHRASES[key]);
      return matchCase(match, choice);
    });
  }
  return result;
}

/* Word-level replacement, POS-aware and morphology-aware. */
/* Pick a synonym, favouring the earlier entries. Lists are ordered
   closest-first, so this keeps the meaning tighter when substitution
   is running hard. */
function pickClosest(arr, rng) {
  const n = arr.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += n - i;
  let r = rng() * total;
  for (let i = 0; i < n; i++) { r -= (n - i); if (r <= 0) return arr[i]; }
  return arr[n - 1];
}

/* `keepMeaning` bundles three safeguards that let substitution run at
   high strength without the text turning into thesaurus soup:
     - termMemory : one word always maps to the same replacement
     - pickClosest: bias toward the nearest sense
     - run cap    : never rewrite more than 2 content words in a row
--------------------------------------------------------------- */
function replaceWords(text, rng, strength, mask, stats, keepMeaning, termMemory) {
  const tokens = tagTokens(tokenize(text));
  let cursor = 0;
  let sentenceStart = true;
  let prevWord = null;
  let run = 0;            // consecutive content words replaced

  // Keep-meaning mode decides every term BEFORE rewriting anything, so
  // the decision cannot depend on where the word happens to appear. A
  // term is then either always rewritten (the same way) or never.
  if (keepMeaning && termMemory) {
    let ss = true;
    let preRun = 0;   // consecutive content words already set to rewrite
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.t === "p") { if (/[.!?]/.test(tk.s)) ss = true; continue; }
      if (tk.t === "ws") continue;
      const wasSS = ss; ss = false;
      const lw = tk.s.toLowerCase();
      if (STOPWORDS.has(lw)) continue;
      if (!wasSS && /^[A-Z]/.test(tk.s)) continue;
      if (!["n", "v", "adj", "adv"].includes(tk.pos)) continue;
      const c = lookupSynonyms(lw, tk.pos);
      if (!c) continue;
      const k = c.base + "|" + tk.pos;

      if (termMemory.has(k)) {
        preRun = termMemory.get(k) === null ? 0 : preRun + 1;
        continue;
      }
      // Two different terms must not collapse onto the same word:
      // "systems" and "models" both becoming "frameworks" destroys the
      // distinction the original text was drawing.
      if (!termMemory.usedChoices) termMemory.usedChoices = new Set();
      const used = termMemory.usedChoices;
      used.add(c.base);
      const free = c.syns.filter(s => !used.has(s.toLowerCase()));

      // The run cap lives here, not in the rewriting pass: deciding it
      // once per term keeps the choice consistent everywhere, while
      // still stopping three rewritten words landing in a row.
      let decision = null;
      if (preRun < 2 && free.length && rng.chance(strength)) {
        decision = pickClosest(free, rng);
        used.add(decision.toLowerCase());
      }
      termMemory.set(k, decision);
      preRun = decision === null ? 0 : preRun + 1;
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const startIdx = cursor;
    cursor += tk.s.length;

    if (tk.t === "p") { if (/[.!?]/.test(tk.s)) sentenceStart = true; continue; }
    if (tk.t === "ws") continue;

    const wasSentenceStart = sentenceStart;
    sentenceStart = false;

    const lower = tk.s.toLowerCase();
    // Track the preceding word for every token, auxiliaries included,
    // before any of the skip conditions below can bail out.
    const before = prevWord;
    prevWord = lower;

    if (STOPWORDS.has(lower)) continue;

    // From here on this is a content word, so it participates in the
    // consecutive-replacement run count.
    const wasRun = run;
    run = 0;

    if (mask && isMasked(mask, startIdx, tk.s.length)) continue;
    // Proper nouns: capitalised but not at a sentence start
    if (!wasSentenceStart && /^[A-Z]/.test(tk.s)) continue;
    // Three rewritten content words in a row reads as thesaurus soup
    if (!keepMeaning && !rng.chance(strength)) continue;

    const pos = tk.pos;
    if (!["n", "v", "adj", "adv"].includes(pos)) continue;

    const cand = lookupSynonyms(lower, pos);
    if (!cand) continue;

    let choice;
    const memKey = cand.base + "|" + pos;
    if (termMemory && termMemory.has(memKey)) {
      // This term was already decided for the whole document
      choice = termMemory.get(memKey);
      if (choice === null) continue;   // decided: leave this one alone
    } else {
      // Not pre-decided (plain mode, or a word the pre-pass skipped):
      // three rewritten content words in a row reads as thesaurus soup.
      if (keepMeaning && wasRun >= 2) continue;
      choice = keepMeaning ? pickClosest(cand.syns, rng) : rng.pick(cand.syns);
      if (termMemory) termMemory.set(memKey, choice);
    }
    if (choice === cand.base) continue;

    let out = matchInflection(lower, choice, pos === "adv" ? "adv" : pos, before);

    // Reject a plural noun whose replacement has no plural form
    // ("studies" -> "research"), which would strand the verb in
    // disagreement: "New research show that ...".
    if (pos === "n" && lower !== singularise(lower) && !isPluralForm(out.split(" ")[0])) continue;
    // Only add -ly when the replacement came from the ADJECTIVE list
    // ("wide" -> "broadly"). Connectives such as "moreover" are already
    // adverbs, and adverbising them produces "moreoverly".
    if (cand.fromAdj && /ly$/.test(lower) && !/ly$/.test(out) && out.indexOf(" ") === -1) {
      out = adverbise(out);
    }
    out = matchCase(tk.s, out);
    if (out.toLowerCase() === tk.s.toLowerCase()) continue;

    // Never create an adjacent duplicate: "significant considerable"
    // must not become "considerable considerable".
    const outLower = out.toLowerCase();
    if (before && outLower === before) continue;
    let nextWord = null;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].t === "w") { nextWord = tokens[j].s.toLowerCase(); break; }
      if (tokens[j].t === "p" && /[.!?]/.test(tokens[j].s)) break;
    }
    if (nextWord && outLower === nextWord) continue;

    tk.s = out;
    stats.replaced++;
    run = wasRun + 1;
    // The next word compares against what we actually wrote, not the
    // word that used to be here, or two words can collide.
    prevWord = outLower;
  }
  return detokenize(tokens);
}

/* Adjectives whose adverb is the bare word ("run fast", not "fastly"),
   or whose -ly form means something else entirely ("hardly", "lately",
   "nearly"). These are never used to build an adverb. */
const FLAT_ADVERBS = new Set(["fast", "hard", "late", "early", "straight",
  "long", "far", "near", "good", "little", "much", "well"]);

function adverbise(adj) {
  if (/ly$/.test(adj)) return adj;
  if (/[^aeiou]y$/.test(adj)) return adj.slice(0, -1) + "ily";
  if (/le$/.test(adj)) return adj.slice(0, -1) + "y";
  if (/ic$/.test(adj)) return adj + "ally";
  return adj + "ly";
}

/* Find synonyms for a word, trying its base form if the surface
   form is inflected. Returns null when nothing is safe to use. */
function lookupSynonyms(word, pos) {
  const tryKeys = [word];
  if (pos === "n") tryKeys.push(singularise(word));
  if (pos === "v") tryKeys.push(verbBase(word));
  if (pos === "adv" && /ly$/.test(word)) {
    tryKeys.push(word.slice(0, -2));
    tryKeys.push(word.slice(0, -3) + "y"); // easily -> easy
  }
  if (pos === "adj") {
    if (/er$/.test(word)) tryKeys.push(word.slice(0, -2));
    if (/est$/.test(word)) tryKeys.push(word.slice(0, -3));
  }

  for (const k of tryKeys) {
    // Connectives are already adverbs — use them as-is, never adverbise
    if (pos === "adv" && CONNECTIVES[k]) {
      const syns = CONNECTIVES[k].filter(s => s.indexOf(" ") === -1);
      if (syns.length) return { base: k, syns, fromAdj: false };
    }
    const entries = entriesFor(k);
    if (!entries) continue;
    // Prefer an exact part-of-speech match; only fall back to the
    // adjective list when we are looking for an adverb.
    let chosen = entries.find(e => e[0] === pos);
    let fromAdj = false;
    if (!chosen && pos === "adv") {
      chosen = entries.find(e => e[0] === "adj");
      fromAdj = !!chosen;
    }
    if (!chosen) continue;
    let syns = chosen.slice(1);
    // Building an adverb from an adjective: drop anything that cannot
    // take -ly cleanly — "fast" would give "fastly", "wide-ranging"
    // would give "wide-rangingly".
    if (fromAdj) {
      syns = syns.filter(s => !FLAT_ADVERBS.has(s) && !/[\s-]/.test(s));
    }
    if (!syns.length) continue;
    // Adverb built from an adjective entry: "wide" -> "broad" -> "broadly"
    return { base: k, syns, fromAdj };
  }
  return null;
}
