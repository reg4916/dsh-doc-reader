import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { OCR_DEFAULT_LANGS, OCR_DEFAULT_SCALE, OCR_MAX_SCALE } from "./limits.js";
import { parsePageSelection } from "./util.js";

/**
 * OCR is deliberately lazy: tesseract.js (WASM) and pdf-to-img (pdfjs + napi-rs
 * canvas) are heavy, so a session that only reads DOCX never pays for them.
 * Node caches dynamic imports, so repeated calls reuse the same module instance.
 */
let tesseractModule;
let pdfToImgModule;

async function loadTesseract() {
  tesseractModule ??= await import("tesseract.js").catch((error) => {
    tesseractModule = undefined;
    throw new Error(`OCR engine is unavailable (tesseract.js): ${error.message ?? error}. Reinstall the plugin dependencies.`);
  });
  return tesseractModule;
}

async function loadPdfToImg() {
  pdfToImgModule ??= await import("pdf-to-img").catch((error) => {
    pdfToImgModule = undefined;
    throw new Error(`PDF rasterizer is unavailable (pdf-to-img): ${error.message ?? error}. Reinstall the plugin dependencies.`);
  });
  return pdfToImgModule;
}

export function ocrCacheDir() {
  return process.env.DSH_DOC_READER_OCR_CACHE || join(homedir(), ".dsh", "cache", "dsh-doc-reader", "tesseract");
}

export function ocrLanguages(requested) {
  const value = String(requested ?? process.env.DSH_DOC_READER_OCR_LANGS ?? OCR_DEFAULT_LANGS).trim();
  return value || OCR_DEFAULT_LANGS;
}

/**
 * pdf.js needs an explicit wasmUrl to locate its jbig2/openjpeg/qcms decoders.
 * Without it, CCITT/JBIG2 scans (common for faxes and plain two-tone scans) fail
 * to rasterize and every page comes back blank. The URL points at the installed
 * pdfjs-dist wasm folder; pdf.js falls back to its JS decoder when the runtime
 * cannot fetch the .wasm file.
 */
function rasterizerOptions(scale) {
  const require = createRequire(import.meta.url);
  let wasmUrl;
  try {
    const entry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    wasmUrl = pathToFileURL(join(dirname(entry), "..", "..", "wasm") + "/").href;
  } catch {
    wasmUrl = undefined;
  }
  return {
    scale,
    docInitParams: {
      ...(wasmUrl ? { wasmUrl, iccUrl: wasmUrl } : {}),
      // 0 = errors only: keep pdf.js warnings out of the host log.
      verbosity: 0,
      isEvalSupported: false,
    },
  };
}

function workerOptions() {
  const langPath = process.env.DSH_DOC_READER_OCR_LANG_PATH;
  return {
    cachePath: ocrCacheDir(),
    ...(langPath ? { langPath } : {}),
  };
}

async function createOcrWorker(langs) {
  const { createWorker } = await loadTesseract();
  await mkdir(ocrCacheDir(), { recursive: true }).catch(() => {});
  try {
    return await createWorker(langs, 1, workerOptions());
  } catch (error) {
    throw new Error(
      `OCR worker failed to start: ${error.message ?? error}. Tesseract downloads "${langs}" language data on first use into ${ocrCacheDir()}; for offline use point DSH_DOC_READER_OCR_LANG_PATH at a folder containing <lang>.traineddata (and <lang>.traineddata.gz is not required).`,
    );
  }
}

function normalizeRecognized(result) {
  const data = result?.data ?? {};
  return {
    text: String(data.text ?? "").trim(),
    confidence: typeof data.confidence === "number" ? Math.round(data.confidence * 10) / 10 : undefined,
  };
}

function normalizedScale(requested) {
  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) return OCR_DEFAULT_SCALE;
  return Math.min(Math.max(value, 1), OCR_MAX_SCALE);
}

/** OCR a single image (png/jpeg/webp/bmp/tiff/gif). */
export async function ocrImage(buffer, options = {}) {
  const langs = ocrLanguages(options.langs);
  const worker = await createOcrWorker(langs);
  try {
    const recognized = normalizeRecognized(await worker.recognize(Buffer.from(buffer)));
    return { ...recognized, langs };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

/** Rasterize PDF pages and OCR the selected ones with one shared worker. */
export async function ocrPdfPages(buffer, options = {}) {
  const { pdf } = await loadPdfToImg();
  let document;
  try {
    document = await pdf(Buffer.from(buffer), rasterizerOptions(normalizedScale(options.scale)));
  } catch (error) {
    throw new Error(`not a readable PDF (rasterization failed): ${error.message ?? error}`);
  }

  const totalPages = document.length;
  const requested = parsePageSelection(options.pages, totalPages);
  if (requested.length === 0) throw new Error(`no pages selected: the PDF has ${totalPages} page(s)`);
  const maxPages = Number.isFinite(options.maxPages) ? options.maxPages : requested.length;
  const selected = new Set(requested.slice(0, maxPages));
  const skipped = requested.length - selected.size;
  const lastWanted = Math.max(...selected);

  const langs = ocrLanguages(options.langs);
  const worker = await createOcrWorker(langs);
  try {
    const pages = [];
    let index = 0;
    for await (const pageBuffer of document) {
      index += 1;
      if (selected.has(index)) {
        const recognized = normalizeRecognized(await worker.recognize(pageBuffer));
        pages.push({ page: index, ...recognized });
      }
      if (index >= lastWanted) break;
    }
    return { totalPages, pages, langs, skipped };
  } finally {
    await worker.terminate().catch(() => {});
  }
}
