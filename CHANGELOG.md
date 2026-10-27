# Changelog

## 0.2.0 — 2026-10-27

- **`doc_ocr`** — local OCR for scanned PDFs and images (tesseract.js WebAssembly, nothing uploaded):
  - PDF pages rasterized with `pdf-to-img` at ~200 DPI, `scale` 1–3, up to 20 pages per call;
  - per-page confidence, page selection (`pages: "1-3,7"`), language selection (`langs`, default `rus+eng`);
  - CCITT G4 / JBIG2 scans decode through pdf.js `wasmUrl` — without it fax-style scans rasterized blank;
  - language data cached in `~/.dsh/cache/dsh-doc-reader/tesseract`, `DSH_DOC_READER_OCR_LANG_PATH` for offline.
- OCR fixture corpus (latin/cyrillic PNG, two-page CCITT scan, rotated image) and 7 OCR tests; 28 tests total.
- Published to npm as `dsh-doc-reader`; repository metadata, screenshot manifest and CI added.

## 0.1.0 — 2026-10-26

- First release: `doc_read`, `pdf_read`, `xlsx_read`, `doc_meta` for PDF, DOCX, XLSX, PPTX, TXT/MD/CSV/HTML.
- Page/sheet selection, character caps, 50 MB limit, 20 s fetch timeout, SSRF guard for private hosts.
- 21 tests over a generated fixture corpus (`node:test`, no host required).
