/**
 * Host half of dsh-doc-reader.
 *
 * Registers four tools that turn documents into model-readable text:
 *   doc_read, pdf_read, xlsx_read, doc_meta
 *
 * The readers are pure library code (lib/), so they can be tested without a host.
 */
import { documentMeta, readDocument } from "./lib/read.js";

/**
 * The host resolves @deepseek-ai/dsh-tools for mounted plugins (profile
 * resolution). Outside the host (node --test) the package is absent, so fall
 * back to the identity definition: the registry consumes the plain object, and
 * only schema-based argument validation is skipped.
 */
let defineTool;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {
  defineTool = (definition) => definition;
}

const textOutput = {
  schema: { type: "string" },
  render: (_args, value) => [{ type: "text", text: value }],
};

const PATH = {
  type: "string",
  description: "Path to a local document (absolute, or relative to the current working directory).",
};
const URL_PARAM = {
  type: "string",
  description: "http(s) URL to download the document from. Private/local hosts are refused; download and pass a path instead.",
};

const tools = [
  defineTool({
    name: "doc_read",
    description:
      "Read a document as text. Supports PDF, DOCX, XLSX (sheets rendered as tab-separated rows), PPTX (slides with speaker notes), and TXT/MD/CSV/HTML. " +
      "Use this instead of web_fetch for PDFs — web_fetch rejects application/pdf. " +
      "For PDFs pass pages to read a subset; for workbooks pass sheet to pick one sheet. " +
      "Large output is truncated at maxChars (default 60000), so narrow the selection instead of re-reading.",
    parameters: {
      path: PATH,
      url: URL_PARAM,
      format: {
        type: "string",
        enum: ["auto", "pdf", "docx", "xlsx", "pptx", "text", "html"],
        description: 'Force a reader when the extension is misleading. Default "auto" sniffs magic bytes.',
      },
      pages: {
        type: "string",
        description: 'PDF page selection, e.g. "1-3,5". Default: all pages.',
      },
      sheet: {
        type: "string",
        description: 'XLSX sheet by name or 1-based index, or "all". Default: all sheets.',
      },
      maxRows: {
        type: "number",
        description: "XLSX rows per sheet (default 200, hard cap 5000).",
      },
      maxChars: {
        type: "number",
        description: "Output character cap (default 60000, hard cap 400000).",
      },
    },
    output: textOutput,
    timeoutMs: 120_000,
    async execute(args) {
      try {
        return await readDocument(args);
      } catch (error) {
        return `doc_read: ${error?.message ?? error}`;
      }
    },
  }),

  defineTool({
    name: "pdf_read",
    description:
      "Read a PDF page by page. Returns per-page blocks with a '--- page N/M ---' marker, plus document metadata (title, author). " +
      "Prefer doc_read for a whole document; use pdf_read when you need specific pages or page boundaries (citations, quotes).",
    parameters: {
      path: PATH,
      url: URL_PARAM,
      pages: { type: "string", description: 'Pages to read, e.g. "1-3,7". Default: all pages.' },
      maxChars: { type: "number", description: "Output character cap (default 60000)." },
    },
    output: textOutput,
    timeoutMs: 120_000,
    async execute(args) {
      try {
        return await readDocument({ ...args, format: "pdf" });
      } catch (error) {
        return `pdf_read: ${error?.message ?? error}`;
      }
    },
  }),

  defineTool({
    name: "xlsx_read",
    description:
      "Read a spreadsheet as text: one block per sheet with a header row count and tab-separated rows. " +
      "Use sheet to read one sheet by name or 1-based index; use maxRows to page through large sheets. " +
      "Formulas are returned as displayed values.",
    parameters: {
      path: PATH,
      url: URL_PARAM,
      sheet: { type: "string", description: 'Sheet name, 1-based index, or "all". Default: all sheets.' },
      maxRows: { type: "number", description: "Rows per sheet (default 200, hard cap 5000)." },
      maxChars: { type: "number", description: "Output character cap (default 60000)." },
    },
    output: textOutput,
    timeoutMs: 120_000,
    async execute(args) {
      try {
        return await readDocument({ ...args, format: "xlsx" });
      } catch (error) {
        return `xlsx_read: ${error?.message ?? error}`;
      }
    },
  }),

  defineTool({
    name: "doc_meta",
    description:
      "Inspect a document without extracting its body: format, size, PDF page count and title/author, DOCX properties, XLSX sheet list, PPTX slide count. " +
      "Use it first when a file is large, or to decide which pages/sheets to read.",
    parameters: {
      path: PATH,
      url: URL_PARAM,
      format: {
        type: "string",
        enum: ["auto", "pdf", "docx", "xlsx", "pptx", "text", "html"],
        description: 'Force a reader when the extension is misleading. Default "auto".',
      },
    },
    output: textOutput,
    timeoutMs: 60_000,
    async execute(args) {
      try {
        return await documentMeta(args);
      } catch (error) {
        return `doc_meta: ${error?.message ?? error}`;
      }
    },
  }),
];

export const name = "dsh-doc-reader";
export const inject = ["tools"];

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(tool));
    console.log(`[dsh-doc-reader] registered tools: ${tools.map((tool) => tool.name).join(", ")}`);
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose?.();
        } catch {
          /* keep unloading */
        }
      }
      console.log("[dsh-doc-reader] plugin unloaded");
    };
  });
}

export { tools };
