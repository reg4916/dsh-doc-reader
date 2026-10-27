#!/usr/bin/env node
// Fixture self-check for dsh-doc-reader.
//
//   node test/fixtures/verify.mjs
//
// Reads every file listed in expected.json through the plugin's own modules
// (lib/read.js -> mammoth / SheetJS / unpdf / jszip) and asserts that every
// documented substring, page count, sheet list and slide count really comes
// out, and that the "invalid" fixtures are rejected. Exits non-zero on failure.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readDocument, documentMeta } from "../../lib/read.js";
import { detectFormat } from "../../lib/detect.js";

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));
let failures = 0;
const check = (cond, msg) => {
  if (cond) return;
  failures += 1;
  console.log("FAIL:", msg);
};

const excerpts = {};
for (const [name, spec] of Object.entries(expected)) {
  const path = join(here, name);

  if (spec.invalid) {
    try {
      const out = await readDocument({ path });
      check(false, name + ": expected rejection, got " + out.length + " chars");
    } catch (error) {
      console.log("OK   " + name + ": rejected ->", String(error.message).split("\n")[0]);
    }
    continue;
  }

  try {
    const text = await readDocument({ path });
    excerpts[name] = text;
    for (const sub of spec.substrings ?? []) {
      check(text.includes(sub), name + ": missing substring " + JSON.stringify(sub));
    }
    console.log("OK   " + name + ": " + text.length + " chars");

    if (spec.pages !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(meta.totalPages === spec.pages, name + ": totalPages " + meta.totalPages + " != " + spec.pages);
      const blocks = text.split(/--- page (\d+)\/\d+ ---/);
      for (let page = 1; page <= spec.pages; page += 1) {
        const idx = blocks.indexOf(String(page));
        check(idx !== -1, name + ": missing page block " + page);
        const body = idx === -1 ? "" : blocks[idx + 1];
        check(body.includes("PAGE-" + page + "-MARKER"), name + ": marker not on page " + page);
      }
    }
    if (spec.sheets !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(
        JSON.stringify(meta.sheets) === JSON.stringify(spec.sheets),
        name + ": sheets " + JSON.stringify(meta.sheets),
      );
    }
    if (spec.slides !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(meta.slides === spec.slides, name + ": slides " + meta.slides);
    }
    if (spec.empty) {
      const body = text.slice(text.indexOf("\n\n") + 2);
      console.log("     empty fixture yields:", JSON.stringify(body.slice(0, 70)));
    }
  } catch (error) {
    check(false, name + ": threw " + error.message);
  }
}

for (const name of Object.keys(expected)) {
  const buffer = readFileSync(join(here, name));
  console.log("DETECT " + name.padEnd(16), "->", detectFormat(buffer, name));
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\nFAILURES: " + failures);
process.exitCode = failures === 0 ? 0 : 1;
