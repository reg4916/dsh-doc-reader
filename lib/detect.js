import { extnameOf } from "./util.js";

export const SUPPORTED_FORMATS = ["pdf", "docx", "xlsx", "pptx", "text", "html"];

const TEXT_EXTS = new Set([
  "txt", "text", "md", "markdown", "csv", "tsv", "json", "jsonl", "log",
  "yaml", "yml", "xml", "rtf", "tex", "srt", "vtt", "ini", "toml", "conf",
]);

export function isPdf(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
}

export function isZip(buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 3 || buffer[2] === 5 || buffer[2] === 7);
}

/** Magic bytes win over the extension; the extension breaks ties inside a zip container. */
export function detectFormat(buffer, name) {
  if (isPdf(buffer)) return "pdf";
  const ext = extnameOf(name);
  if (isZip(buffer)) {
    if (ext === "docx" || ext === "xlsx" || ext === "pptx") return ext;
    return "zip";
  }
  if (ext === "docx" || ext === "xlsx" || ext === "pptx") {
    // A zip-only format with non-zip bytes: let the reader produce the real error.
    return ext;
  }
  if (ext === "pdf") {
    // Not a PDF by magic bytes; resolveFormat turns this into an explicit error.
    return "pdf";
  }
  if (ext === "html" || ext === "htm") return "html";
  if (TEXT_EXTS.has(ext)) return "text";
  return looksLikeText(buffer) ? "text" : "unknown";
}

function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 512);
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length < 0.1;
}
