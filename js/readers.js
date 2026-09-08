/* ============================================================
   readers.js  —  Client-side file text extraction, no libraries
   .txt/.md  : read directly
   .docx     : a ZIP container; unzipped with the browser's native
               DecompressionStream, then word/document.xml is
               stripped of tags
   .pdf      : FlateDecode streams inflated natively, then text
               pulled out of the Tj / TJ drawing operators
   ============================================================ */

async function extractTextFromFile(file) {
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".docx")) return extractDocx(file);
  if (name.endsWith(".pdf")) return extractPdf(file);
  if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc files are not supported. Please save as .docx or .txt and try again.");
  }
  // .txt, .md, .csv, .rtf-ish and anything else: treat as plain text
  const text = await file.text();
  if (name.endsWith(".rtf")) return stripRtf(text);
  return text;
}

/* ---------- Shared: raw DEFLATE via native browser API --------- */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot unzip files. Please use a recent Chrome, Edge, Firefox or Safari, or paste the text directly.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/* ============================================================
   DOCX
   ============================================================ */
async function extractDocx(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const entry = await findZipEntry(buf, "word/document.xml");
  if (!entry) throw new Error("This does not look like a valid .docx file (word/document.xml was not found).");

  const xml = new TextDecoder("utf-8").decode(entry);
  return docxXmlToText(xml);
}

function docxXmlToText(xml) {
  let s = xml;
  // Paragraph and line structure -> real newlines, before tags are stripped
  s = s.replace(/<w:tab[^>]*\/>/g, "\t");
  s = s.replace(/<w:br[^>]*\/>/g, "\n");
  s = s.replace(/<\/w:p>/g, "\n\n");
  // Table cells read better separated
  s = s.replace(/<\/w:tc>/g, "\t");
  s = s.replace(/<\/w:tr>/g, "\n");
  // Drop everything else
  s = s.replace(/<[^>]+>/g, "");
  s = decodeXmlEntities(s);
  // Collapse the runaway blank lines the paragraph rule creates
  s = s.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n");
  return s.trim();
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
          .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
          .replace(/&amp;/g, "&");
}

/* Minimal ZIP reader: locate the End of Central Directory, walk the
   central directory, then decompress the one entry we want. */
async function findZipEntry(buf, wantedName) {
  const eocd = findEOCD(buf);
  if (eocd < 0) throw new Error("The file is not a readable ZIP/DOCX archive.");

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let count = dv.getUint16(eocd + 10, true);
  let dirOffset = dv.getUint32(eocd + 16, true);

  // ZIP64: the real values live in a separate record
  if (dirOffset === 0xFFFFFFFF || count === 0xFFFF) {
    const z64 = findSig(buf, [0x50, 0x4B, 0x06, 0x06], eocd - 200, eocd);
    if (z64 >= 0) {
      count = Number(dv.getBigUint64(z64 + 32, true));
      dirOffset = Number(dv.getBigUint64(z64 + 48, true));
    }
  }

  let p = dirOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));

    if (name === wantedName) {
      const lh = localOffset;
      if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error("Corrupt archive entry.");
      const lNameLen = dv.getUint16(lh + 26, true);
      const lExtraLen = dv.getUint16(lh + 28, true);
      const dataStart = lh + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return data;            // stored
      if (method === 8) return inflateRaw(data); // deflated
      throw new Error("Unsupported compression inside the .docx file.");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function findEOCD(buf) {
  const max = Math.min(buf.length, 66000);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4B && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) return i;
  }
  return -1;
}

function findSig(buf, sig, from, to) {
  from = Math.max(0, from);
  for (let i = from; i < to && i + sig.length <= buf.length; i++) {
    let ok = true;
    for (let k = 0; k < sig.length; k++) if (buf[i + k] !== sig[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/* ============================================================
   PDF
   Handles the common case: text-based PDFs whose content streams
   are FlateDecode-compressed. Scanned/image PDFs contain no text
   layer at all and will correctly report that.
   ============================================================ */
async function extractPdf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const latin = bytesToLatin1(bytes);

  if (latin.slice(0, 1024).indexOf("/Encrypt") !== -1) {
    throw new Error("This PDF is password-protected or encrypted. Please unlock it, or copy the text and paste it in.");
  }

  const pieces = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const dictStart = latin.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? latin.slice(dictStart, m.index) : "";
    const start = m.index + m[0].length;
    const end = latin.indexOf("endstream", start);
    if (end < 0) continue;
    re.lastIndex = end;

    // Only content streams are worth decoding
    if (/\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|\/Font(?!Descriptor)|\/XObject\s*<</.test(dict)) continue;

    let data = bytes.subarray(start, end);
    // Trim the EOL that precedes "endstream"
    while (data.length && (data[data.length - 1] === 0x0a || data[data.length - 1] === 0x0d)) {
      data = data.subarray(0, data.length - 1);
    }
    if (!data.length) continue;

    let decoded;
    if (/\/FlateDecode/.test(dict)) {
      try { decoded = bytesToLatin1(await inflateRaw(data)); }
      catch (e) { continue; }
    } else if (/\/Filter/.test(dict)) {
      continue; // LZW, RunLength, ASCII85 etc. are not handled
    } else {
      decoded = bytesToLatin1(data);
    }

    if (decoded.indexOf("Tj") === -1 && decoded.indexOf("TJ") === -1) continue;
    pieces.push(extractPdfTextOperators(decoded));
  }

  const text = pieces.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    throw new Error("No text layer could be read from this PDF. It is most likely a scan (images of text), which needs OCR. Please paste the text in directly.");
  }
  return text;
}

/* Pull strings out of the text-drawing operators in a content stream. */
function extractPdfTextOperators(content) {
  let out = "";
  let i = 0;
  const n = content.length;

  while (i < n) {
    const ch = content[i];

    if (ch === "(") {
      // A PDF literal string, with balanced parentheses and escapes
      let depth = 1, j = i + 1, s = "";
      while (j < n && depth > 0) {
        const c = content[j];
        if (c === "\\") {
          const nx = content[j + 1];
          const simple = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
          if (nx in simple) { s += simple[nx]; j += 2; continue; }
          if (/[0-7]/.test(nx)) {
            let oct = "";
            let k = j + 1;
            while (k < n && oct.length < 3 && /[0-7]/.test(content[k])) { oct += content[k]; k++; }
            s += String.fromCharCode(parseInt(oct, 8));
            j = k; continue;
          }
          if (nx === "\n") { j += 2; continue; } // line continuation
          s += nx; j += 2; continue;
        }
        if (c === "(") { depth++; s += c; j++; continue; }
        if (c === ")") { depth--; if (depth > 0) s += c; j++; continue; }
        s += c; j++;
      }
      out += s;
      i = j;
      continue;
    }

    if (ch === "<" && content[i + 1] !== "<") {
      // Hex string
      const close = content.indexOf(">", i);
      if (close > 0) {
        const hex = content.slice(i + 1, close).replace(/\s+/g, "");
        let s = "";
        for (let k = 0; k + 1 < hex.length; k += 2) {
          s += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
        }
        out += s;
        i = close + 1;
        continue;
      }
    }

    // Line-positioning operators mean a new line of text
    if ((ch === "T" && (content[i + 1] === "d" || content[i + 1] === "D" || content[i + 1] === "*")) ||
        (ch === "'" || ch === '"')) {
      out += "\n";
      i += 2;
      continue;
    }
    if (ch === "E" && content.substr(i, 2) === "ET") { out += "\n"; i += 2; continue; }

    i++;
  }

  return cleanPdfText(out);
}

function cleanPdfText(s) {
  // Common ligatures that PDFs embed as single glyphs
  s = s.replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl")
       .replace(/ﬀ/g, "ff").replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl");
  // Curly punctuation -> straight, so the rules match reliably
  s = s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"')
       .replace(/[–—]/g, "-").replace(/…/g, "...");
  // Strip control characters left over from font encodings
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  // Rejoin words hyphenated across a line break
  s = s.replace(/([a-z])-\n([a-z])/g, "$1$2");
  // A single newline inside a paragraph is a wrap, not a break
  s = s.replace(/([^\n.!?:;])\n(?=[a-z(])/g, "$1 ");
  s = s.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function bytesToLatin1(bytes) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}

/* ---------- RTF (best effort) ---------------------------------- */
function stripRtf(rtf) {
  let s = rtf.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\par[d]?\b/g, "\n");
  s = s.replace(/\{\\\*[^{}]*\}/g, "");
  s = s.replace(/\\[a-z]+-?\d*\s?/gi, "");
  s = s.replace(/[{}]/g, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
