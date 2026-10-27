/** Hard limits shared by every reader. Keep them explicit: a tool that silently
 *  reads a 2 GB file or downloads from an internal host is worse than a refusal. */
export const MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_CHARS = 60_000;
export const HARD_MAX_CHARS = 400_000;
export const FETCH_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_ROWS = 200;
export const HARD_MAX_ROWS = 5_000;

/** OCR: rasterize at 2x (~200 DPI), refuse unbounded page batches. */
export const OCR_MAX_PAGES = 20;
export const OCR_DEFAULT_SCALE = 2;
export const OCR_MAX_SCALE = 3;
// Cyrillic-first order: with "eng+rus" tesseract reads uppercase Cyrillic as
// Latin lookalikes (ПРИВЕТ -> NMPUBET). Latin text measures identically under
// "rus+eng", so the mixed default is Cyrillic-first.
export const OCR_DEFAULT_LANGS = "rus+eng";
