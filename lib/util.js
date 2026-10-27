/** Small helpers shared by the readers. */
import { HARD_MAX_CHARS, HARD_MAX_ROWS } from "./limits.js";

const PAGE_SPEC = /^(\d+)(?:\s*-\s*(\d+))?$/;

/** Parse "1-3,5,7-8" into an ordered, de-duplicated page list clamped to [1, total]. */
export function parsePageSelection(spec, total) {
  if (spec === undefined || spec === null || String(spec).trim() === "") {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set();
  for (const raw of String(spec).split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const match = PAGE_SPEC.exec(part);
    if (!match) throw new Error(`invalid pages value "${part}": expected forms like "1-3,5"`);
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < from) throw new Error(`invalid pages range "${part}"`);
    for (let page = from; page <= Math.min(to, total); page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

export function clampMaxChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), HARD_MAX_CHARS);
}

export function clampMaxRows(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.floor(n), HARD_MAX_ROWS);
}

export function truncateText(text, limit) {
  if (limit === undefined || text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n\n… [truncated: ${text.length - limit} of ${text.length} chars not shown; raise maxChars or narrow pages/sheet]`,
    truncated: true,
  };
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extnameOf(name) {
  const base = String(name ?? "").split(/[?#]/)[0];
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function decodeXmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function firstTagText(xml, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(String(xml));
  return match ? decodeXmlEntities(match[1]).trim() || undefined : undefined;
}
