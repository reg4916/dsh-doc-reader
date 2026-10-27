/** Hard limits shared by every reader. Keep them explicit: a tool that silently
 *  reads a 2 GB file or downloads from an internal host is worse than a refusal. */
export const MAX_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_CHARS = 60_000;
export const HARD_MAX_CHARS = 400_000;
export const FETCH_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_ROWS = 200;
export const HARD_MAX_ROWS = 5_000;
