import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readDocument, documentMeta } from "../../lib/read.js";
import { detectFormat } from "../../lib/detect.js";

const here = dirname(fileURLToPath(import.meta.url));
const expected = JSON.parse(readFileSync(join(here, "expected.json"), "utf8"));
let failures = 0;
const check = (cond, msg) => { if (!cond) { failures += 1; console.log("FAIL:", msg); } };

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
    for (const sub of spec.substrings ?? []) check(text.includes(sub), name + ": missing substring " + JSON.stringify(sub));
    console.log("OK   " + name + ": " + text.length + " chars");

    if (spec.pages !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(meta.totalPages === spec.pages, name + ": totalPages " + meta.totalPages + " != " + spec.pages);
      const blocks = text.split(/--- page (\d+)\/3 ---/);
      for (let page = 1; page <= spec.pages; page += 1) {
        const idx = blocks.indexOf(String(page));
        check(idx !== -1, name + ": missing page block " + page);
        const body = idx === -1 ? "" : blocks[idx + 1];
        check(body.includes("PAGE-" + page + "-MARKER"), name + ": marker not on page " + page);
      }
    }
    if (spec.sheets !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(JSON.stringify(meta.sheets) === JSON.stringify(spec.sheets), name + ": sheets " + JSON.stringify(meta.sheets));
    }
    if (spec.slides !== undefined) {
      const meta = JSON.parse(await documentMeta({ path }));
      check(meta.slides === spec.slides, name + ": slides " + meta.slides);
    }
    if (spec.empty) console.log("     empty-fixture text:", JSON.stringify(text.slice(text.indexOf("\n\n") + 2, text.indexOf("\n\n") + 90)));
  } catch (error) {
    check(false, name + ": threw " + error.message);
  }
}

// format detection table (what the plugin actually sees)
for (const name of Object.keys(expected)) {
  const buffer = readFileSync(join(here, name));
  console.log("DETECT " + name.padEnd(16), "->", detectFormat(buffer, name));
}

// deep checks on the interesting fixtures
const docx = excerpts["sample.docx"] ?? "";
console.log("\n--- docx table cells as mammoth emits them ---");
console.log(JSON.stringify(docx.split("\n").filter((l) => /[ABC][12]/.test(l))));

const xlsx = excerpts["sample.xlsx"] ?? "";
console.log("\n--- xlsx extraction ---");
console.log(xlsx.split("\n").slice(0, 24).join("\n"));

const pptx = excerpts["sample.pptx"] ?? "";
console.log("\n--- pptx extraction ---");
console.log(pptx);

const pdf = excerpts["sample.pdf"] ?? "";
console.log("\n--- pdf extraction ---");
console.log(pdf);

console.log(failures === 0 ? "\nALL CHECKS PASSED" : "\nFAILURES: " + failures);
process.exitCode = failures === 0 ? 0 : 1;
