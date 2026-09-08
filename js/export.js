/* ============================================================
   export.js  —  Client-side file generation, no libraries
   .txt / .md  : plain Blob
   .docx       : a ZIP built by hand (stored entries + CRC-32)
   .pdf        : written by hand, Helvetica with real glyph widths
                 so line wrapping is accurate
   Everything is produced in the browser; nothing is uploaded.
   ============================================================ */

/* ---------- shared download helper ---------------------------- */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportPlain(text, filename) {
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

/* ============================================================
   DOCX
   ============================================================ */

/* CRC-32, needed for every ZIP entry. */
const CRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function xmlEscape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          // strip control characters XML forbids
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

/* Build the ZIP container. Entries are STORED (uncompressed), which
   keeps this dependency-free and is fine for a text document. */
function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = enc.encode(e.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);   // local file header signature
    dv.setUint16(4, 20, true);           // version needed
    dv.setUint16(6, 0x0800, true);       // flags: UTF-8 names
    dv.setUint16(8, 0, true);            // method: stored
    dv.setUint16(10, 0, true);           // mod time
    dv.setUint16(12, 0x21, true);        // mod date (1980-01-01)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); // compressed size
    dv.setUint32(22, data.length, true); // uncompressed size
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);           // extra length
    local.set(nameBytes, 30);

    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);   // central directory signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0x0800, true);       // flags
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra
    cv.setUint16(32, 0, true);           // comment
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, offset, true);      // offset of local header
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // end of central directory
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);             // comment length

  return new Blob([...parts, ...central, eocd],
    { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function buildDocx(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const paras = lines.map(line => {
    if (!line.trim()) return "<w:p/>";
    return '<w:p><w:r><w:t xml:space="preserve">' + xmlEscape(line) + "</w:t></w:r></w:p>";
  }).join("");

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" + paras +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>' +
    "</w:body></w:document>";

  return buildZip([
    {
      name: "[Content_Types].xml",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>"
    },
    {
      name: "_rels/.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>"
    },
    {
      name: "word/_rels/document.xml.rels",
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
    },
    { name: "word/document.xml", content: documentXml }
  ]);
}

/* ============================================================
   PDF
   ============================================================ */

/* Helvetica advance widths (units per 1000), printable ASCII.
   Real widths mean the wrapping matches what the reader renders. */
const HELV_W = (function () {
  const w = {};
  const set = (chars, val) => { for (const c of chars) w[c] = val; };
  w[" "] = 278;
  set("!", 278); set('"', 355); set("#", 556); set("$", 556); set("%", 889);
  set("&", 667); set("'", 191); set("(", 333); set(")", 333); set("*", 389);
  set("+", 584); set(",", 278); set("-", 333); set(".", 278); set("/", 278);
  set("0123456789", 556);
  set(":", 278); set(";", 278); set("<", 584); set("=", 584); set(">", 584);
  set("?", 556); set("@", 1015);
  w.A = 667; w.B = 667; w.C = 722; w.D = 722; w.E = 667; w.F = 611; w.G = 778;
  w.H = 722; w.I = 278; w.J = 500; w.K = 667; w.L = 556; w.M = 833; w.N = 722;
  w.O = 778; w.P = 667; w.Q = 778; w.R = 722; w.S = 667; w.T = 611; w.U = 722;
  w.V = 667; w.W = 944; w.X = 667; w.Y = 667; w.Z = 611;
  set("[", 278); set("\\", 278); set("]", 278); set("^", 469); set("_", 556); set("`", 333);
  w.a = 556; w.b = 556; w.c = 500; w.d = 556; w.e = 556; w.f = 278; w.g = 556;
  w.h = 556; w.i = 222; w.j = 222; w.k = 500; w.l = 222; w.m = 833; w.n = 556;
  w.o = 556; w.p = 556; w.q = 556; w.r = 333; w.s = 500; w.t = 278; w.u = 556;
  w.v = 500; w.w = 722; w.x = 500; w.y = 500; w.z = 500;
  set("{", 334); set("|", 260); set("}", 334); set("~", 584);
  return w;
})();

function textWidth(str, size) {
  let total = 0;
  for (const ch of str) total += (HELV_W[ch] !== undefined ? HELV_W[ch] : 556);
  return total * size / 1000;
}

/* Reduce to characters the WinAnsi-encoded base font can actually show. */
function toWinAnsi(s) {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[•]/g, "-")
    .replace(/[^\x09\x0a\x20-\x7E\xA0-\xFF]/g, "");
}

function pdfEscape(s) {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLines(text, size, maxWidth) {
  const out = [];
  const paragraphs = text.replace(/\r\n?/g, "\n").split("\n");

  for (const para of paragraphs) {
    if (!para.trim()) { out.push(""); continue; }
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (let word of words) {
      // A single word longer than the column gets hard-broken
      while (textWidth(word, size) > maxWidth) {
        let cut = 1;
        while (cut < word.length && textWidth(word.slice(0, cut + 1), size) <= maxWidth) cut++;
        if (line) { out.push(line); line = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = line ? line + " " + word : word;
      if (textWidth(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function buildPdf(text) {
  const PAGE_W = 595, PAGE_H = 842;        // A4 in points
  const MARGIN = 57;                        // ~2 cm
  const SIZE = 11, LEADING = 15.5;
  const maxWidth = PAGE_W - MARGIN * 2;
  const linesPerPage = Math.floor((PAGE_H - MARGIN * 2) / LEADING);

  const lines = wrapLines(toWinAnsi(text), SIZE, maxWidth);

  // Split into pages
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  if (!pages.length) pages.push([""]);

  // Object layout: 1 catalog, 2 pages tree, 3 font, then page+content pairs
  const pageObjStart = 4;
  const objects = [];

  const kids = pages.map((_, i) => (pageObjStart + i * 2) + " 0 R").join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  pages.forEach((pageLines, i) => {
    const pageObj = pageObjStart + i * 2;
    const contentObj = pageObj + 1;

    let stream = "BT\n/F1 " + SIZE + " Tf\n" + LEADING + " TL\n" +
                 "1 0 0 1 " + MARGIN + " " + (PAGE_H - MARGIN - SIZE) + " Tm\n";
    pageLines.forEach(line => {
      stream += line ? "(" + pdfEscape(line) + ") Tj\nT*\n" : "T*\n";
    });
    stream += "ET";

    objects[pageObj] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] " +
      "/Resources << /Font << /F1 3 0 R >> >> /Contents " + contentObj + " 0 R >>";
    objects[contentObj] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream";
  });

  // Serialise, tracking byte offsets for the xref table
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += i + " 0 obj\n" + objects[i] + "\nendobj\n";
  }
  const xrefPos = pdf.length;
  const count = objects.length; // objects are 1..length-1, plus the free entry

  pdf += "xref\n0 " + count + "\n0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xrefPos + "\n%%EOF";

  // Every byte is < 256 by construction, so a direct char->byte map is safe
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
  return new Blob([bytes], { type: "application/pdf" });
}
