import mammoth from "mammoth";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { DEFAULT_MAX_ROWS } from "./limits.js";
import { clampMaxRows, decodeXmlEntities, firstTagText, parsePageSelection, plural } from "./util.js";

/* ------------------------------------------------------------------ PDF --- */

export async function readPdf(buffer, options = {}) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const totalPages = pdf.numPages;
  const selected = parsePageSelection(options.pages, totalPages);

  const extracted = await extractText(pdf, { mergePages: false });
  const pageTexts = Array.isArray(extracted?.text) ? extracted.text : [String(extracted?.text ?? "")];

  const blocks = selected.map((page) => {
    const body = String(pageTexts[page - 1] ?? "").replace(/\r\n/g, "\n").trim();
    return `--- page ${page}/${totalPages} ---\n${body || "(no extractable text on this page)"}`;
  });

  const info = { totalPages, selectedPages: selected };
  try {
    const meta = await getMeta(pdf);
    const raw = meta?.info ?? {};
    info.title = raw.Title || undefined;
    info.author = raw.Author || undefined;
    info.producer = raw.Producer || undefined;
    info.creationDate = raw.CreationDate || undefined;
  } catch {
    /* metadata is optional */
  }

  return { text: blocks.join("\n\n"), info };
}

/* ----------------------------------------------------------------- DOCX --- */

export async function readDocx(buffer) {
  let extracted;
  try {
    extracted = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
  } catch (error) {
    throw new Error(`not a readable DOCX file (ZIP container expected): ${error.message ?? error}`);
  }
  const props = await readCoreProperties(buffer);
  const text = String(extracted.value ?? "").replace(/\r\n/g, "\n").trim();
  const warnings = (extracted.messages ?? []).filter((m) => m.type === "warning").length;
  return {
    text: text || "(no extractable text in this document)",
    info: { paragraphs: text ? text.split(/\n{2,}/).length : 0, warnings, props },
  };
}

async function readCoreProperties(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const file = zip.file("docProps/core.xml");
    if (!file) return {};
    const xml = await file.async("string");
    return {
      title: firstTagText(xml, "dc:title"),
      creator: firstTagText(xml, "dc:creator"),
      lastModifiedBy: firstTagText(xml, "cp:lastModifiedBy"),
      modified: firstTagText(xml, "dcterms:modified"),
    };
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------- XLSX --- */

export function readXlsx(buffer, options = {}) {
  let workbook;
  try {
    workbook = XLSX.read(Buffer.from(buffer), { type: "buffer", cellDates: true, cellFormula: false });
  } catch (error) {
    throw new Error(`not a readable XLSX file (ZIP container expected): ${error.message ?? error}`);
  }
  const names = workbook.SheetNames ?? [];
  if (names.length === 0) throw new Error("workbook has no sheets");

  const chosen = selectSheets(names, options.sheet);
  const maxRows = clampMaxRows(options.maxRows) ?? DEFAULT_MAX_ROWS;
  const blocks = [];
  const sizes = {};

  for (const name of chosen) {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false, blankrows: false });
    const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    sizes[name] = { rows: rows.length, columns };

    const shown = rows.slice(0, maxRows);
    const width = String(shown.length + 1).length;
    const lines = shown.map((row, index) => {
      const cells = row.map((cell) => (cell === null || cell === undefined ? "" : String(cell).replace(/\t/g, " ")));
      return `${String(index + 1).padStart(width, " ")} | ${cells.join(" | ")}`;
    });
    const notice = rows.length > maxRows ? `\n… (${rows.length - maxRows} more rows; raise maxRows or pick another sheet)` : "";
    blocks.push(
      `## sheet "${name}" — ${plural(rows.length, "row", "rows")} × ${plural(columns, "col", "cols")}\n${lines.join("\n") || "(empty sheet)"}${notice}`,
    );
  }

  return {
    text: blocks.join("\n\n"),
    info: { sheets: names, selectedSheets: chosen, sizes, props: workbook.Props ?? {} },
  };
}

function selectSheets(names, requested) {
  if (requested === undefined || requested === null || String(requested).trim() === "" || requested === "all") return names;
  const value = String(requested).trim();
  if (names.includes(value)) return [value];
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= names.length) return [names[index - 1]];
  throw new Error(`unknown sheet "${value}"; available: ${names.join(", ")}`);
}

/* ---------------------------------------------------------------- PPTX --- */

export async function readPptx(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new Error(`not a readable PPTX file (ZIP container expected): ${error.message ?? error}`);
  }
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (slidePaths.length === 0) throw new Error("not a PPTX presentation (no ppt/slides entries)");

  const notesByNumber = new Map();
  for (const path of Object.keys(zip.files)) {
    const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(path);
    if (match) notesByNumber.set(Number(match[1]), path);
  }

  const blocks = [];
  for (const [index, path] of slidePaths.entries()) {
    const xml = await zip.file(path).async("string");
    const body = extractDrawingText(xml);
    const notesPath = notesByNumber.get(index + 1);
    let notes = "";
    if (notesPath) {
      const notesXml = await zip.file(notesPath).async("string");
      notes = extractDrawingText(notesXml);
    }
    blocks.push(
      `--- slide ${index + 1}/${slidePaths.length} ---\n${body || "(no text on this slide)"}${
        notes ? `\n[notes] ${notes}` : ""
      }`,
    );
  }

  const props = await readCoreProperties(buffer);
  return { text: blocks.join("\n\n"), info: { slides: slidePaths.length, props } };
}

function slideNumber(path) {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** Extract visible text runs from DrawingML, keeping paragraph boundaries. */
function extractDrawingText(xml) {
  const paragraphs = [];
  for (const paragraph of String(xml).split(/<\/a:p>/)) {
    const runs = [...paragraph.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXmlEntities(match[1]));
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n");
}

/* ------------------------------------------------------- TEXT / HTML ----- */

export function readPlainText(buffer) {
  const text = Buffer.from(buffer).toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  return {
    text: text || "(empty file)",
    info: { lines: text ? text.split("\n").length : 0, chars: text.length },
  };
}

export function readHtml(buffer) {
  const raw = Buffer.from(buffer).toString("utf8");
  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  const text = decodeXmlEntities(stripped).trim();
  return { text: text || "(no extractable text in this HTML)", info: { chars: text.length } };
}

/* ------------------------------------------------------- UNKNOWN ZIP ----- */

export async function readZipAsDocument(buffer, name) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  if (names.some((path) => path === "word/document.xml")) return { ...(await readDocx(buffer)), format: "docx" };
  if (names.some((path) => path === "xl/workbook.xml")) return { ...readXlsx(buffer), format: "xlsx" };
  if (names.some((path) => path === "ppt/presentation.xml")) return { ...(await readPptx(buffer)), format: "pptx" };
  throw new Error(`unsupported ZIP document "${name}": not a DOCX/XLSX/PPTX container`);
}
