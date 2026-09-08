# Rule-Based Paraphraser &amp; Humanizer

Two text-rewriting tools that use **no AI and no machine learning**. Every change is
produced by a dictionary lookup or a grammar rule you could trace by hand. There is no
model, no training data, no API key and no network request — the whole engine is plain
JavaScript running in the visitor's browser.

| Tool | Page | For |
|---|---|---|
| **Paraphraser** | `index.html` | Full control — four sliders, side-by-side comparison, change highlighting, protection toggles. |
| **Humanizer** | `humanize.html` | One field, three levels, one button. Paste or upload, get text back, download as `.txt` `.docx` `.pdf` or `.md`. |

Both run on the same engine (`js/data.js`, `js/nlp.js`, `js/transform.js`), so a fix to
the rules improves both at once. Each has its own page, interface and URL; a link in the
header switches between them.

---

## Running it

**Locally — no install of any kind.** Double-click `index.html`. That is the whole setup.

If you would rather test over `http://` (identical to how the live site will behave):

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8080>. Press `Ctrl+C` in that window to stop it.
`serve.ps1` is a test convenience only — it is **not** needed in production.

---

## Putting it live

The site is fully static: no backend, no build step, no dependencies. Upload these files
to any static host and it works as-is.

| Host | How |
|---|---|
| **GitHub Pages** | Push the folder to a repo, then Settings → Pages → deploy from `main` / root |
| **Netlify** | Drag the folder onto <https://app.netlify.com/drop> |
| **Vercel** | `vercel deploy` in this folder, or import the repo |
| **Cloudflare Pages** | Connect the repo, leave build command empty, output directory `/` |
| **Any shared host** | Upload via FTP into `public_html` |

Do **not** upload `serve.ps1` — it is local tooling.

Because everything runs client-side, hosting costs nothing, there is no server to
maintain, and no user text is ever transmitted or stored.

---

## Files

```
index.html         Paraphraser page
humanize.html      Humanizer page

css/style.css      shared design system, light + dark themes
css/humanize.css   Humanizer-specific layout

js/data.js         SHARED  knowledge base: phrases, thesaurus, error patterns
js/nlp.js          SHARED  tokeniser, POS tagger, morphology, synonyms
js/transform.js    SHARED  restructuring rules + error injector + diff
js/readers.js      SHARED  .txt / .docx / .pdf text extraction
js/export.js       SHARED  .txt / .md / .docx / .pdf file generation

js/app.js          Paraphraser UI wiring
js/humanizer.js    Humanizer UI wiring

serve.ps1          local test server (not for production)
```

Deploying the folder gives you both tools: `/` is the Paraphraser and `/humanize.html`
is the Humanizer. To host them as two completely independent sites, copy the folder
twice and delete the page and UI script you do not want from each copy — the shared
`js/` files are needed by both.

---

## How the engine works

The pipeline runs six stages over each paragraph.

**1. Phrase bank.** ~190 set expressions are matched longest-first and swapped for stored
equivalents: *"due to the fact that"* → *"because"*, *"in order to"* → *"so as to"*.
Phrase-level rewriting is what makes the result read as genuinely restructured rather than
word-swapped.

**2. POS tagging.** A rule-based tagger labels each word using suffix patterns, closed-class
word lists and local context — the classic pre-statistical approach. It only has to be good
enough to stop a noun being swapped for a verb. Words with two parts of speech carry both,
so *"the **change**"* is tagged a noun and *"to **change**"* a verb.

**3. Thesaurus lookup.** ~600 hand-curated head words supply synonyms filtered by part of
speech. Morphology rules carry the original inflection across, so *studied* → *examined* and
*has become* → *has grown*, not *has grow*.

**4. Structural rules.** At most one per sentence, since stacking them is where rule-based
paraphrasers usually produce nonsense:

- passive → active — *"The data were analysed by the team"* → *"The team analysed the data"*
- clause fronting — *"X rose because Y fell"* → *"Because Y fell, X rose"*
- `There is/are X that Y` → `X Y`
- splitting long coordinated sentences
- discourse connective swaps — *however* → *nevertheless*
- adverb repositioning

**5. Error injection.** A weighted pool of twelve realistic slips, applied within a strict
per-sentence budget so no sentence turns into a mess:

| Tier | Slips |
|---|---|
| Mild | dropped articles, *its/it's*, *their/there*, *then/than*, missing apostrophes, comma added or dropped, double space, missing space after a comma |
| Moderate | adds subject–verb agreement slips, preposition swaps, wrong *a/an*, mass-noun plurals (*informations*) |
| Noticeable | adds comma splices and doubled words |

**6. Repair pass.** *a/an* is corrected against whatever word now follows it and sentence
capitalisation is restored, so only the intended slips survive.

### What is deliberately protected

Never altered: quoted text, citations (`(Smith, 2019)`, `[14]`, `doi:`), URLs, email
addresses, proper nouns, numbers, and ~45 fixed technical terms such as *machine learning*
and *climate change* — which lose their meaning if the words are swapped individually.

Any phrase-bank entry the phrase stage chose *not* to rewrite is also locked, so
*"in conclusion"* can never degrade into *"in deduction"*.

---

## Controls

| Control | Effect |
|---|---|
| Synonyms | how often an eligible word is swapped |
| Phrases | how often a set expression is rewritten |
| Restructuring | how often a structural rule is attempted |
| Human errors | slips per 100 words; `0` leaves the output fully correct |
| Severity | which tiers from the table above are allowed — Mild, Moderate or Noticeable |
| Contractions | Unchanged, Casual (*do not* → *don't*) or Formal (*don't* → *do not*) |
| Keep quotes / Keep citations | exclude quoted text and references from every change |
| Highlight changes | show what the engine altered, or view the plain result |
| Preset | Light, Balanced, Heavy — or Custom, which any slider selects automatically |
| Shuffle | re-runs with a new random seed for a different variation |

Each slider has a tooltip explaining it; hover to read. The six-step breakdown of the
engine sits behind **How this works** at the foot of the page.

Results are **reproducible**: the same text with the same seed always gives the same output,
which matters if you are generating a dataset. Shuffle picks a new seed.

The output highlights <span style="color:#0d7a5f">reworded</span> text in green and
<span style="color:#b0450d">injected slips</span> in orange, so you can always see exactly
what the engine did.

---

## The Humanizer

A simpler front end for the same engine: paste or drop a file, choose the settings, press
**Humanize**. Four controls, no sliders.

**How hard it rewrites** and **how human it reads** are deliberately separate. Bundling
them is what makes a single "Heavy" button drift off-meaning — you cannot ask for a harder
rewrite without also asking for more mistakes.

| Rewrite | What it does |
|---|---|
| **Subtle** | Barely touched — a few stiff phrases loosened. |
| **Light** | Keeps your wording, loosens the phrasing. |
| **Balanced** | Reworded and restructured, close to the original. |
| **Strong** | Heavily reworded and reshaped, meaning intact. |
| **Maximum** | Hardest rewrite — most sentences reshaped, meaning preserved. |

| Human slips | Rate |
|---|---|
| **Off** | none — output stays fully correct |
| **Few** | ~1.2 per 100 words, mild kinds only |
| **Natural** | ~2.6 per 100 words |
| **Many** | ~4.8 per 100 words, including comma splices and doubled words |

**Tone** switches contractions: Casual (*it is* → *it's*), Neutral (leave alone) or
Formal (*it's* → *it is*).

**Regenerate** re-runs with a new seed. Changing any setting re-runs automatically.
Quotes and citations stay protected, exactly as in the Paraphraser.

### Preserve meaning

On by default, and the reason **Maximum** stays readable. Heavy rewriting normally
degrades meaning because more substitution means more chances to pick a loose synonym.
This setting attacks that directly with four guarantees:

- **Consistent terminology.** Every term is decided once for the whole document, before
  any rewriting starts, so a word is either always rewritten the same way or never. The
  text never says both "systems" and "structures" for the same thing. *Measured: 0/80 runs
  with mixed terminology, against 80/80 without it.*
- **No term collisions.** Two different words can never collapse onto the same one, and a
  rewrite never introduces a word the document already uses for something else — with
  "framework" already present, "system" will not become "framework". *Measured: 0/100 runs
  with a collision, against 80/100 without.*
- **Closest sense first.** Synonym lists are ordered nearest-first, and selection is
  weighted toward the front instead of picking uniformly at random.
- **No thesaurus soup.** Never more than two rewritten content words in a row. *Measured:
  max run of 2, against 10 without.*

Because rewrites are reserved rather than reused, Maximum substitutes about 22% of words
instead of 30% — but it pairs that with 97% phrase rewriting and 82% restructuring, both
of which cannot change meaning by construction. The result is a harder rewrite that still
says the same thing.

Turn it off if you want maximum variation and do not mind the drift.

### Download formats

The result can be saved as `.txt`, `.md`, `.docx` or `.pdf`, all generated in the browser
with **zero libraries**:

- **`.docx`** — a ZIP container assembled by hand: local headers, central directory, EOCD
  and a CRC-32 for each entry, with stored (uncompressed) parts. Verified to open with an
  independent ZIP implementation.
- **`.pdf`** — written directly: A4 pages, Helvetica with the real AFM glyph widths so line
  wrapping matches what the reader draws, WinAnsi encoding, correct xref offsets and
  automatic pagination.

Downloads are named after the uploaded file where there is one
(`my thesis draft.docx` → `my thesis draft-humanized.pdf`), otherwise `humanized.*`.

---

## File upload

`.txt`, `.md`, `.csv`, `.rtf`, `.docx` and `.pdf`, read entirely in the browser with **zero
libraries**:

- **.docx** is a ZIP container. The ZIP central directory is parsed by hand and entries are
  decompressed with the browser's native `DecompressionStream`.
- **.pdf** content streams are inflated the same way, then text is pulled out of the `Tj`/`TJ`
  drawing operators.

Limits worth knowing: `.doc` (the pre-2007 binary format) is not supported — save as `.docx`.
Scanned PDFs contain images rather than text and need OCR; the tool detects this and says so
instead of returning nothing. Encrypted PDFs are rejected with a clear message. Maximum file
size is 12 MB.

---

## Performance

A 6,500-word document paraphrases in roughly 110 ms and renders with full change
highlighting in about 35 ms, on a normal laptop. The change diff runs per paragraph, so
cost stays linear in document length rather than quadratic.

---

## Extending it

Everything lives in `js/data.js` and needs no code changes:

```js
// add a synonym set — "pos" is n, v, adj or adv
"benefit": ["n", "advantage", "gain", "upside", "merit"],

// a word with two parts of speech
"change": [["n", "shift", "alteration"], ["v", "alter", "modify"]],

// add a phrase rewrite
"due to the fact that": ["because", "since", "as"],

// protect a term from being split apart
PROTECTED_TERMS.push("supply chain");
```

To add a new kind of slip, write a function in `js/transform.js` that takes a sentence and
returns the modified sentence (or `null` if it does not apply), then add it to `ERROR_TYPES`
with a weight and a tier.

---

## A note on intended use

Deliberately introducing errors is genuinely useful for generating test data, building
grammar-checker corpora, and studying how text detectors behave.

If you are submitting the text as your own academic work, check the rules that apply to you
first. Paraphrasing a source without citing it is still plagiarism regardless of which tool
produced it, and many institutions treat deliberately disguised text as a separate offence.
That is your call to make — the tool simply does what you configure it to do.
