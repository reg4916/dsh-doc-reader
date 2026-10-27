# dsh-doc-reader

Read PDF, DOCX, XLSX, PPTX and text documents as agent tools for **DeepSeek Harness (dsh)**.

The built-in `read` tool returns file text, and `web_fetch` rejects `application/pdf` — so a PDF, a spreadsheet or a slide deck currently ends up as `curl` + `pip install pypdf` inside the session. This plugin closes that gap with five typed tools that return page-, sheet- and slide-aware text, including local OCR for scans and screenshots.

## Tools

| Tool | What it does | Key parameters |
|---|---|---|
| `doc_read` | Universal reader: PDF, DOCX, XLSX, PPTX, TXT/MD/CSV/HTML; auto-detects format by magic bytes | `path` \| `url`, `format`, `pages`, `sheet`, `maxRows`, `maxChars` |
| `pdf_read` | PDF page by page with `--- page N/M ---` markers, title/author metadata | `path` \| `url`, `pages` (e.g. `"1-3,7"`), `maxChars` |
| `xlsx_read` | One block per sheet, tab-separated rows, sheet by name or 1-based index | `path` \| `url`, `sheet`, `maxRows`, `maxChars` |
| `doc_meta` | Metadata only: format, size, PDF page count/title, DOCX props, XLSX sheets, PPTX slide count | `path` \| `url`, `format` |
| `doc_ocr` | OCR for scanned PDFs and images (PNG/JPEG/WebP/BMP/TIFF/GIF), per-page confidence | `path` \| `url`, `pages`, `langs`, `scale`, `maxChars` |

Every tool accepts a local path **or** an `http(s)` URL. Prefer `doc_meta` first for large files, then read the pages/sheets you need — output is capped by `maxChars` (default `60000`, hard cap `400000`).

## Example output

```text
# invoice.pdf — PDF · 184.2 KB
# source: /work/invoice.pdf
# pages 1, 2 of 7 · title: Invoice 2026-10

--- page 1/7 ---
ACME Ltd — Invoice 0042
...
```

```text
# budget.xlsx — XLSX · 12.4 KB
# source: https://example.com/budget.xlsx
# sheets: Data, Second

## sheet "Data" — 3 rows × 3 cols
1 | Year | Revenue | Note
2 | 2024 | 1000    | ok
3 | 2025 | 2000    | Привет
```

## OCR

`doc_ocr` handles what pure text extraction cannot: scanned PDFs, photos and screenshots.

- Engine: **tesseract.js 7** (WebAssembly, no native OCR binary) — runs fully locally, nothing is uploaded.
- PDF pages are rasterized with `pdf-to-img` (pdf.js + `@napi-rs/canvas`) at `scale` 2 (~200 DPI), then recognized with one shared worker.
- Fax-style **CCITT G4 and JBIG2** scans are decoded through pdf.js wasm/JS decoders (`wasmUrl` is wired to the installed `pdfjs-dist/wasm`), so two-tone scans rasterize instead of returning blank pages.
- Default languages: **`rus+eng`** (`langs` overrides, e.g. `"deu"`, `"eng"`). Order matters: with `eng+rus` tesseract reads uppercase Cyrillic as Latin lookalikes (`ПРИВЕТ` → `NMPUBET`); Cyrillic-first keeps Latin accuracy identical (measured 94–95% on both fixture sets).
- **First use downloads the language data** (~4 MB per language) into `~/.dsh/cache/dsh-doc-reader/tesseract`; later calls are fast (a page takes ~0.3–1 s). For offline machines set `DSH_DOC_READER_OCR_LANG_PATH` to a directory containing `<lang>.traineddata` (optionally `.gz`), and/or `DSH_DOC_READER_OCR_CACHE` for the cache location.
- At most **20 PDF pages per call**; narrow with `pages`. Use `scale: 1` for speed, `scale: 3` for small print.
- Rotation/handwriting/low-resolution scans are best-effort: tesseract has no layout magic, and confidence is reported per page so you can judge the result.

```text
# scan.pdf — PDF (OCR) · 1.8 MB
# source: /work/scan.pdf
# OCR: tesseract rus+eng · pages 1, 2 of 12

--- page 1/12 (ocr, 91.4%) ---
INVOICE 2026-042
...
```

## Limits and security

- Local files: up to **50 MB**; URLs: downloaded with a **20 s timeout** and the same 50 MB cap.
- **Private/local hosts are refused** (`localhost`, `127.0.0.1`, RFC1918, `.local`, `.internal`) so the tool cannot become an SSRF primitive. Download the file and pass a `path` instead.
- Only `http(s)` URLs.
- PDF text extraction is text-based: scanned PDFs (images only) return `(no extractable text on this page)`. OCR is on the roadmap.
- DOCX conversion is handled by `mammoth`; charts, comments and tracked changes are not materialized as text.
- XLSX returns displayed values, not formulas; rows are paged with `maxRows`.

## Install

From the market (once published) or manually into a profile:

```bash
cd ~/.dsh/profiles/desktop
npx pnpm add link:~/dsh-plugins/dsh-doc-reader   # local development
# or: npx pnpm add dsh-doc-reader                 # from npm
```

Then add the bundle to the profile's `package.json`:

```json
"dsh": { "profile": { "bundles": ["dsh-doc-reader", "..."] } }
```

Restart DSH (the plugin loads on boot; DSH composition is all-or-nothing). The four tools appear in the next session.

## Develop

```bash
npm install
npm test          # node --test, runs against test/fixtures
node --check index.js
```

The readers live in `lib/` and have no host dependency, so they can be exercised directly:

```js
import { readDocument, documentMeta } from "./lib/read.js";
await readDocument({ path: "report.pdf", pages: "1-3" });
```

`index.js` imports `@deepseek-ai/dsh-tools` for `defineTool`; outside a DSH host the import falls back to an identity definition (the registry consumes the plain object).

## Roadmap

- `.doc`, `.rtf`, `.odt`, `.epub` readers.
- Layout hints from OCR (word boxes, tables) and page-number citations.
- Page/sheet images for vision models (`presentResult` image parts).
- Caching of parsed documents within a session.

## License

MIT
