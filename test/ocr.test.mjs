import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { ocrDocument } from "../lib/read.js";

const fixture = (name) => new URL(`./fixtures/ocr/${name}`, import.meta.url).pathname;

async function skipIfMissing(t, ...names) {
  for (const name of names) {
    try {
      await access(fixture(name));
    } catch {
      t.skip(`OCR fixture ${name} is not generated yet`);
      return true;
    }
  }
  return false;
}

test("ocr image: reads a latin marker and a number", async (t) => {
  if (await skipIfMissing(t, "ocr-image.png")) return;
  const out = await ocrDocument({ path: fixture("ocr-image.png") });
  assert.match(out, /image\/png \(OCR\)/);
  assert.match(out, /OCR.IMAGE.MARKER/i);
  assert.match(out, /12345/);
  assert.match(out, /confidence \d/);
});

test("ocr image: reads cyrillic", async (t) => {
  if (await skipIfMissing(t, "ocr-image-ru.png")) return;
  const out = await ocrDocument({ path: fixture("ocr-image-ru.png") });
  assert.match(out, /ПРИВЕТ/i);
  assert.match(out, /2026/);
});

test("ocr scanned pdf: both pages with page markers", async (t) => {
  if (await skipIfMissing(t, "ocr-scan.pdf")) return;
  const out = await ocrDocument({ path: fixture("ocr-scan.pdf") });
  assert.match(out, /PDF \(OCR\)/);
  assert.match(out, /pages 1, 2 of 2/);
  assert.match(out, /--- page 1\/2 \(ocr/);
  assert.match(out, /SCAN.PAGE.1.MARKER/i);
  assert.match(out, /SCAN.PAGE.2.MARKER/i);
});

test("ocr scanned pdf: page selection limits the batch", async (t) => {
  if (await skipIfMissing(t, "ocr-scan.pdf")) return;
  const out = await ocrDocument({ path: fixture("ocr-scan.pdf"), pages: "2" });
  assert.match(out, /pages 2 of 2/);
  assert.match(out, /SCAN.PAGE.2.MARKER/i);
  assert.doesNotMatch(out, /SCAN.PAGE.1.MARKER/i);
});

test("ocr rejects text documents with a pointer to doc_read", async () => {
  await assert.rejects(() => ocrDocument({ path: fixture("../sample.txt") }), /supports PDF scans and images/);
});

test("ocr reports a missing file clearly", async () => {
  await assert.rejects(() => ocrDocument({ path: "/definitely/not/here.png" }), /file not found/);
});

test("ocr rejects an unsupported binary blob", async (t) => {
  if (await skipIfMissing(t, "../corrupt.pdf")) return;
  await assert.rejects(() => ocrDocument({ path: fixture("../corrupt.pdf") }), /not a valid PDF/);
});
