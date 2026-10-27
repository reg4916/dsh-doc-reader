import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentMeta, readDocument } from "../lib/read.js";

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

async function fixtureExists(name) {
  try {
    await readFile(fixture(name));
    return true;
  } catch {
    return false;
  }
}

async function skipIfMissing(t, name) {
  if (await fixtureExists(name)) return false;
  t.skip(`fixture ${name} is not generated yet`);
  return true;
}

test("pdf: reads every page and keeps page markers", async (t) => {
  if (await skipIfMissing(t, "sample.pdf")) return;
  const out = await readDocument({ path: fixture("sample.pdf") });
  assert.match(out, /# sample\.pdf — PDF/);
  assert.match(out, /3 pages/);
  assert.match(out, /--- page 1\/3 ---/);
  assert.match(out, /PAGE-1-MARKER/);
  assert.match(out, /PAGE-2-MARKER/);
  assert.match(out, /PAGE-3-MARKER/);
});

test("pdf: page selection reads only requested pages", async (t) => {
  if (await skipIfMissing(t, "sample.pdf")) return;
  const out = await readDocument({ path: fixture("sample.pdf"), pages: "2-3" });
  assert.match(out, /pages 2, 3 of 3/);
  assert.doesNotMatch(out, /PAGE-1-MARKER/);
  assert.match(out, /PAGE-3-MARKER/);
});

test("pdf: invalid page selection is reported", async (t) => {
  if (await skipIfMissing(t, "sample.pdf")) return;
  await assert.rejects(() => readDocument({ path: fixture("sample.pdf"), pages: "abc" }), /invalid pages/);
});

test("docx: extracts headings, paragraphs, tables and cyrillic", async (t) => {
  if (await skipIfMissing(t, "sample.docx")) return;
  const out = await readDocument({ path: fixture("sample.docx") });
  assert.match(out, /DOCX-TITLE-MARKER/);
  assert.match(out, /ДОКУМЕНТ-МАРКЕР/);
  assert.match(out, /A1/);
  assert.match(out, /C2/);
});

test("xlsx: renders sheets as rows and keeps cyrillic", async (t) => {
  if (await skipIfMissing(t, "sample.xlsx")) return;
  const out = await readDocument({ path: fixture("sample.xlsx") });
  assert.match(out, /## sheet "Data"/);
  assert.match(out, /## sheet "Second"/);
  assert.match(out, /Year/);
  assert.match(out, /Привет/);
  assert.match(out, /MERGED-MARKER/);
});

test("xlsx: sheet selection by name", async (t) => {
  if (await skipIfMissing(t, "sample.xlsx")) return;
  const out = await readDocument({ path: fixture("sample.xlsx"), sheet: "Second" });
  assert.match(out, /## sheet "Second"/);
  assert.doesNotMatch(out, /## sheet "Data"/);
  assert.doesNotMatch(out, /Year/);
});

test("xlsx: unknown sheet lists available ones", async (t) => {
  if (await skipIfMissing(t, "sample.xlsx")) return;
  await assert.rejects(() => readDocument({ path: fixture("sample.xlsx"), sheet: "Nope" }), /available: Data, Second/);
});

test("pptx: reads slides, titles and speaker notes", async (t) => {
  if (await skipIfMissing(t, "sample.pptx")) return;
  const out = await readDocument({ path: fixture("sample.pptx") });
  assert.match(out, /3 slides/);
  assert.match(out, /--- slide 1\/3 ---/);
  assert.match(out, /SLIDE-1-TITLE/);
  assert.match(out, /SLIDE-3-TITLE/);
  assert.match(out, /\[notes\] NOTES-MARKER/);
});

test("text: decodes UTF-8 and cyrillic", async (t) => {
  if (await skipIfMissing(t, "sample.txt")) return;
  const out = await readDocument({ path: fixture("sample.txt") });
  assert.match(out, /Привет/);
});

test("html: strips tags and script bodies", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "dsh-doc-reader-"));
  const file = join(dir, "page.html");
  await writeFile(
    file,
    '<html><head><title>HTML-TITLE-MARKER</title><style>p{color:red}</style></head><body><h1>Heading</h1><p>Первый абзац</p><script>alert("x")</script></body></html>',
  );
  const out = await readDocument({ path: file });
  assert.match(out, /HTML-TITLE-MARKER/);
  assert.match(out, /Первый абзац/);
  assert.doesNotMatch(out, /alert\(/);
  assert.doesNotMatch(out, /color:red/);
});

test("empty text file is not an error", async (t) => {
  if (await skipIfMissing(t, "empty.txt")) return;
  const out = await readDocument({ path: fixture("empty.txt") });
  assert.match(out, /empty file/);
});

test("maxChars truncates with a visible note", async (t) => {
  if (await skipIfMissing(t, "sample.txt")) return;
  const out = await readDocument({ path: fixture("sample.txt"), maxChars: 40 });
  assert.match(out, /truncated/);
});

test("corrupt pdf is rejected with a clear message", async (t) => {
  if (await skipIfMissing(t, "corrupt.pdf")) return;
  await assert.rejects(() => readDocument({ path: fixture("corrupt.pdf") }), /not a valid PDF/);
});

test("text file renamed to .docx is rejected clearly", async (t) => {
  if (await skipIfMissing(t, "not-a-docx.docx")) return;
  await assert.rejects(() => readDocument({ path: fixture("not-a-docx.docx") }), /not a readable DOCX/);
});

test("missing file reports the absolute path", async () => {
  await assert.rejects(() => readDocument({ path: "/definitely/not/here.pdf" }), /file not found/);
});

test("requires exactly one of path/url", async () => {
  await assert.rejects(() => readDocument({}), /one of "path" or "url" is required/);
  await assert.rejects(() => readDocument({ path: "a", url: "https://example.com/a" }), /not both/);
});

test("doc_meta returns machine-readable metadata", async (t) => {
  if (await skipIfMissing(t, "sample.pdf")) return;
  const raw = await documentMeta({ path: fixture("sample.pdf") });
  const meta = JSON.parse(raw);
  assert.equal(meta.format, "pdf");
  assert.equal(meta.totalPages, 3);
  assert.ok(meta.bytes > 0);
});

test("doc_meta for xlsx lists sheets", async (t) => {
  if (await skipIfMissing(t, "sample.xlsx")) return;
  const meta = JSON.parse(await documentMeta({ path: fixture("sample.xlsx") }));
  assert.equal(meta.format, "xlsx");
  assert.deepEqual(meta.sheets, ["Data", "Second"]);
});
