import { FETCH_TIMEOUT_MS, MAX_BYTES } from "./limits.js";

const BLOCKED_HOST = /^(localhost|\.localhost|.*\.local|.*\.internal)$/i;

function isPrivateAddress(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOST.test(h)) return true;
  if (h === "::1" || h === "0.0.0.0" || h === "::") return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h)) return true;
  return false;
}

/** Download a document with an explicit size cap, timeout and private-network block.
 *  Localhost/RFC1918 targets are refused: a tool that fetches URLs must not become
 *  an SSRF primitive for the agent. */
export async function fetchDocument(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported URL scheme "${parsed.protocol}": only http(s) is supported`);
  }
  if (isPrivateAddress(parsed.hostname)) {
    throw new Error(`refusing to fetch private/local address "${parsed.hostname}": download the file and pass a local path instead`);
  }

  const response = await fetch(parsed, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/pdf,application/vnd.openxmlformats-officedocument.*,text/*;q=0.9,*/*;q=0.5" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText} for ${parsed.href}`);

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error(`document is ${declared} bytes; limit is ${MAX_BYTES}`);

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > MAX_BYTES) throw new Error(`download exceeded ${MAX_BYTES} bytes; limit is ${MAX_BYTES}`);
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks, total);
  return { buffer, finalUrl: response.url || parsed.href, contentType: response.headers.get("content-type") ?? "" };
}
