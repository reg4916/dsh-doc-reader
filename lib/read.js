import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { getDocumentProxy, getMeta } from "unpdf";
import { detectFormat, isPdf } from "./detect.js";
import { fetchDocument } from "./fetch.js";
import { DEFAULT_MAX_CHARS, MAX_BYTES } from "./limits.js";
import {
  readDocx,
  readHtml,
  readPdf,
  readPlainText,
  readPptx,
  readXlsx,
  readZipAsDocument,
} from "./readers.js";
import { clampMaxChars, formatBytes, plural, truncateText } from "./util.js";

const FORMAT_LABEL = { pdf: "PDF", docx: "DOCX", xlsx: "XLSX", pptx: "PPTX", text: "text", html: "HTML" };

/** Load bytes from a local path or an http(s) URL, enforcing the same limits for both. */
async function loadSource({ path, url }) {
  if (path !== undefined && url !== undefined) throw new Error('pass either "path" or "url", not both');
  if (path === undefined && url === undefined) throw new Error('one of "path" or "url" is required');

  if (url !== undefined) {
    const fetched = await fetchDocument(url);
    return { buffer: fetched.buffer, source: fetched.finalUrl, kind: "url" };
  }

  const absolute = resolve(String(path));
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new Error(`file not found: ${absolute}`);
  }
  if (!info.isFile()) throw new Error(`not a regular file: ${absolute}`);
  if (info.size > MAX_BYTES) throw new Error(`file is ${formatBytes(info.size)}; limit is ${formatBytes(MAX_BYTES)}`);
  return { buffer: await readFile(absolute), source: absolute, kind: "path" };
}

function resolveFormat(buffer, name, requested) {
  const format = requested && requested !== "auto" ? String(requested).toLowerCase() : detectFormat(buffer, name);
  if (format === "pdf" && !isPdf(buffer)) {
    throw new Error(`"${basename(name)}" is not a valid PDF (missing %PDF signature)`);
  }
  return format;
}

/** Read a document and return model-facing text with a short header. */
export async function readDocument(input) {
  const { buffer, source } = await loadSource(input);
  const format = resolveFormat(buffer, source, input.format);
  const maxChars = clampMaxChars(input.maxChars ?? DEFAULT_MAX_CHARS) ?? DEFAULT_MAX_CHARS;

  let result;
  let label = FORMAT_LABEL[format] ?? format;
  switch (format) {
    case "pdf":
      result = await readPdf(buffer, { pages: input.pages });
      break;
    case "docx":
      result = await readDocx(buffer);
      break;
    case "xlsx":
      result = readXlsx(buffer, { sheet: input.sheet, maxRows: input.maxRows });
      break;
    case "pptx":
      result = await readPptx(buffer);
      break;
    case "text":
      result = readPlainText(buffer);
      break;
    case "html":
      result = readHtml(buffer);
      break;
    case "zip": {
      result = await readZipAsDocument(buffer, basename(source));
      label = FORMAT_LABEL[result.format] ?? result.format;
      break;
    }
    default:
      throw new Error(
        `unsupported format "${format}". Supported: pdf, docx, xlsx, pptx, text, html. Pass "format" explicitly only when the extension is misleading.`,
      );
  }

  const details = describeInfo(format === "zip" ? result.format : format, result.info);
  const { text, truncated } = truncateText(result.text, maxChars);
  const header = [
    `# ${basename(source)} — ${label} · ${formatBytes(buffer.length)}`,
    `# source: ${source}`,
    ...(details ? [`# ${details}`] : []),
    truncated ? "# note: output truncated by maxChars" : undefined,
  ].filter(Boolean);

  return `${header.join("\n")}\n\n${text}`;
}

function describeInfo(format, info = {}) {
  switch (format) {
    case "pdf": {
      const pages = info.selectedPages?.length === info.totalPages
        ? plural(info.totalPages, "page", "pages")
        : `pages ${info.selectedPages?.join(", ")} of ${info.totalPages}`;
      const meta = [info.title && `title: ${info.title}`, info.author && `author: ${info.author}`].filter(Boolean).join(" · ");
      return meta ? `${pages} · ${meta}` : pages;
    }
    case "docx":
      return `${plural(info.paragraphs ?? 0, "paragraph", "paragraphs")}${info.warnings ? ` · ${info.warnings} conversion warnings` : ""}`;
    case "xlsx":
      return `sheets: ${(info.selectedSheets ?? info.sheets ?? []).join(", ")}`;
    case "pptx":
      return plural(info.slides ?? 0, "slide", "slides");
    case "text":
      return `${plural(info.lines ?? 0, "line", "lines")}, ${info.chars ?? 0} chars`;
    case "html":
      return `${info.chars ?? 0} chars extracted`;
    default:
      return "";
  }
}

/** Metadata-only probe: no body text, cheap for large files. */
export async function documentMeta(input) {
  const { buffer, source } = await loadSource(input);
  const format = resolveFormat(buffer, source, input.format);
  const base = {
    source,
    format: format === "zip" ? "unknown-zip" : format,
    bytes: buffer.length,
    size: formatBytes(buffer.length),
  };

  let info = {};
  switch (format) {
    case "pdf": {
      const pdf = await getPdfInfo(buffer);
      info = pdf;
      base.format = "pdf";
      break;
    }
    case "docx": {
      const result = await readDocx(buffer);
      info = result.info;
      break;
    }
    case "xlsx": {
      const result = readXlsx(buffer, { maxRows: 1 });
      info = result.info;
      break;
    }
    case "pptx": {
      const result = await readPptx(buffer);
      info = result.info;
      break;
    }
    case "text":
    case "html": {
      const result = format === "html" ? readHtml(buffer) : readPlainText(buffer);
      info = result.info;
      break;
    }
    case "zip": {
      const result = await readZipAsDocument(buffer, basename(source));
      base.format = result.format;
      info = result.info;
      break;
    }
    default:
      throw new Error(`unsupported format "${format}"`);
  }

  return JSON.stringify({ ...base, ...stripEmpty(info) }, null, 2);
}

async function getPdfInfo(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    const meta = await getMeta(pdf);
    const raw = meta?.info ?? {};
    return {
      totalPages: pdf.numPages,
      title: raw.Title || undefined,
      author: raw.Author || undefined,
      producer: raw.Producer || undefined,
      creationDate: raw.CreationDate || undefined,
    };
  } finally {
    try {
      await pdf.destroy();
    } catch {
      /* proxy cleanup is best-effort */
    }
  }
}

function stripEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}
