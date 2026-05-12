import type { NotebookDocument, NotebookPage } from "../types/models";

export type NotebookExportFormat = "txt" | "html" | "markdown" | "pdf";

export interface NotebookImportedPageDraft {
  documentTitle: string;
  pageTitle: string;
  contentHtml: string;
}

const INVALID_FILE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const LEADING_OR_TRAILING_DOTS = /^[.-]+|[.-]+$/g;
const COLLAPSE_MULTIPLE_DASHES = /-+/g;

function normalizeNotebookTitle(value: string, fallback: string) {
  const normalized = normalizeLineEndings(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value: string) {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|#39);/g, (_match, entity: string) => {
    switch (entity.toLowerCase()) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "#39":
        return "'";
      default: {
        if (entity.startsWith("#x")) {
          const codePoint = Number.parseInt(entity.slice(2), 16);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
        }
        if (entity.startsWith("#")) {
          const codePoint = Number.parseInt(entity.slice(1), 10);
          return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
        }
        return _match;
      }
    }
  });
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function getFileStem(fileName: string) {
  const normalized = fileName.trim();
  if (!normalized) {
    return "Imported Notebook";
  }

  const lastSegment = normalized.split(/[\\/]/).pop() ?? normalized;
  const lastDot = lastSegment.lastIndexOf(".");
  const stem = lastDot > 0 ? lastSegment.slice(0, lastDot) : lastSegment;
  return stem.trim() || "Imported Notebook";
}

function plainTextToHtml(value: string) {
  const normalized = normalizeLineEndings(value).replace(/\u00a0/g, " ").trim();
  if (!normalized) {
    return "<p></p>";
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function normalizeNotebookImportBody(html: string) {
  const normalized = html.trim();
  return normalized || "<p></p>";
}

function stripNotebookHtmlBodyTitles(bodyHtml: string) {
  return bodyHtml
    .replace(/^\s*<h1\b[^>]*>[\s\S]*?<\/h1>\s*/i, "")
    .replace(/^\s*<h2\b[^>]*>[\s\S]*?<\/h2>\s*/i, "");
}

function parseNotebookHtmlImport(fileName: string, contents: string): NotebookImportedPageDraft {
  const bodyMatch = contents.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const bodyHtml = bodyMatch ? bodyMatch[1] : contents;
  const titleMatch = bodyHtml.match(/^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>\s*([\s\S]*)$/i);

  if (titleMatch) {
    return {
      documentTitle: decodeHtml(titleMatch[1].trim()) || getFileStem(fileName),
      pageTitle: decodeHtml(titleMatch[2].trim()) || "Page 1",
      contentHtml: normalizeNotebookImportBody(stripNotebookHtmlBodyTitles(titleMatch[3])),
    };
  }

  return {
    documentTitle: getFileStem(fileName),
    pageTitle: "Page 1",
    contentHtml: normalizeNotebookImportBody(bodyHtml),
  };
}

function parseNotebookMarkdownImport(fileName: string, contents: string): NotebookImportedPageDraft {
  const lines = normalizeLineEndings(contents).replace(/^\uFEFF/, "").split("\n");
  let index = 0;

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  let documentTitle = getFileStem(fileName);
  if (lines[index]?.startsWith("# ")) {
    documentTitle = lines[index].slice(2).trim() || documentTitle;
    index += 1;
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  let pageTitle = "Page 1";
  if (lines[index]?.startsWith("## ")) {
    pageTitle = lines[index].slice(3).trim() || pageTitle;
    index += 1;
  }

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  return {
    documentTitle,
    pageTitle,
    contentHtml: plainTextToHtml(lines.slice(index).join("\n")),
  };
}

function parseNotebookTextImport(fileName: string, contents: string): NotebookImportedPageDraft {
  const lines = normalizeLineEndings(contents).replace(/^\uFEFF/, "").split("\n");
  let index = 0;

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  const documentTitle = (lines[index] ?? "").trim() || getFileStem(fileName);
  index += 1;

  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }

  const pageTitle = (lines[index] ?? "").trim() || "Page 1";
  index += 1;

  if (lines[index]?.trim() === "") {
    index += 1;
  }

  return {
    documentTitle,
    pageTitle,
    contentHtml: plainTextToHtml(lines.slice(index).join("\n")),
  };
}

export function sanitizeNotebookFileNameSegment(value: string) {
  const fallback = "notebook-page";
  const cleaned = value
    .trim()
    .replace(INVALID_FILE_NAME_CHARS, "")
    .replace(/\s+/g, "-")
    .replace(COLLAPSE_MULTIPLE_DASHES, "-")
    .replace(LEADING_OR_TRAILING_DOTS, "");
  return cleaned || fallback;
}

export function buildNotebookExportFileName(
  document: Pick<NotebookDocument, "title">,
  page: Pick<NotebookPage, "title">,
  format: NotebookExportFormat,
) {
  const baseName = sanitizeNotebookFileNameSegment(
    `${normalizeNotebookTitle(document.title, "Untitled Document")}-${normalizeNotebookTitle(page.title, "Page 1")}`,
  );
  return `${baseName}.${format === "markdown" ? "md" : format}`;
}

export function normalizeNotebookExportText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trimEnd();
}

export function createNotebookTxtExport(documentTitle: string, pageTitle: string, plainBody: string) {
  const normalizedDocumentTitle = normalizeNotebookTitle(documentTitle, "Untitled Document");
  const normalizedPageTitle = normalizeNotebookTitle(pageTitle, "Page 1");
  const body = normalizeNotebookExportText(plainBody);
  return body
    ? `${normalizedDocumentTitle}\n${normalizedPageTitle}\n\n${body}\n`
    : `${normalizedDocumentTitle}\n${normalizedPageTitle}\n`;
}

export function createNotebookMarkdownExport(documentTitle: string, pageTitle: string, plainBody: string) {
  const normalizedDocumentTitle = normalizeNotebookTitle(documentTitle, "Untitled Document");
  const normalizedPageTitle = normalizeNotebookTitle(pageTitle, "Page 1");
  const body = normalizeNotebookExportText(plainBody).replace(/\n{3,}/g, "\n\n");
  return body
    ? `# ${normalizedDocumentTitle}\n\n## ${normalizedPageTitle}\n\n${body}\n`
    : `# ${normalizedDocumentTitle}\n\n## ${normalizedPageTitle}\n`;
}

export function createNotebookHtmlExport(documentTitle: string, pageTitle: string, bodyHtml: string) {
  const escapedDocumentTitle = escapeHtml(normalizeNotebookTitle(documentTitle, "Untitled Document"));
  const escapedPageTitle = escapeHtml(normalizeNotebookTitle(pageTitle, "Page 1"));
  const normalizedBody = bodyHtml.trim() || "<p></p>";

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapedDocumentTitle} - ${escapedPageTitle}</title>`,
    "</head>",
    "<body data-notebook-export=\"page\">",
    `  <h1>${escapedDocumentTitle}</h1>`,
    `  <h2>${escapedPageTitle}</h2>`,
    `  ${normalizedBody}`,
    "</body>",
    "</html>",
  ].join("\n");
}

const SUPPORTED_IMPORT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".html", ".htm"]);

function getFileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  return lastDot >= 0 ? normalized.slice(lastDot) : "";
}

export type NotebookImportValidationResult = { ok: true } | { ok: false; reason: string };

export async function validateNotebookImportFile(file: File): Promise<NotebookImportValidationResult> {
  const ext = getFileExtension(file.name);

  if (ext === ".doc") {
    return { ok: false, reason: "Word documents are not supported yet. Please export the file as PDF or plain text before importing." };
  }
  if (ext === ".docx") {
    return { ok: false, reason: "Word documents are not supported yet. Please export the file as PDF or plain text before importing." };
  }
  if (ext === ".pdf") {
    return { ok: false, reason: "PDF import is coming soon. For now, import TXT, Markdown, or HTML files only." };
  }
  if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
    return { ok: false, reason: "Unsupported notebook import file. Please choose a TXT, Markdown, or HTML file." };
  }

  // Magic-byte check — catches mislabeled binaries.
  const headerBytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());

  // ZIP / DOCX / XLSX / ODT: PK\x03\x04
  if (headerBytes[0] === 0x50 && headerBytes[1] === 0x4b && headerBytes[2] === 0x03 && headerBytes[3] === 0x04) {
    return { ok: false, reason: "This file appears to be binary and cannot be imported as notebook text." };
  }
  // Legacy Office (DOC/XLS/PPT): D0 CF 11 E0
  if (headerBytes[0] === 0xd0 && headerBytes[1] === 0xcf && headerBytes[2] === 0x11 && headerBytes[3] === 0xe0) {
    return { ok: false, reason: "This file appears to be binary and cannot be imported as notebook text." };
  }
  // PDF: %PDF
  if (headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46) {
    return { ok: false, reason: "PDF import is coming soon. For now, import TXT, Markdown, or HTML files only." };
  }
  // PNG: \x89PNG
  if (headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4e && headerBytes[3] === 0x47) {
    return { ok: false, reason: "This file appears to be binary and cannot be imported as notebook text." };
  }
  // JPEG: FF D8 FF
  if (headerBytes[0] === 0xff && headerBytes[1] === 0xd8 && headerBytes[2] === 0xff) {
    return { ok: false, reason: "This file appears to be binary and cannot be imported as notebook text." };
  }
  // GIF: GIF8
  if (headerBytes[0] === 0x47 && headerBytes[1] === 0x49 && headerBytes[2] === 0x46 && headerBytes[3] === 0x38) {
    return { ok: false, reason: "This file appears to be binary and cannot be imported as notebook text." };
  }

  return { ok: true };
}

export function parseNotebookImport(fileName: string, contents: string): NotebookImportedPageDraft {
  const normalized = normalizeLineEndings(contents).replace(/^\uFEFF/, "");
  const lowerName = fileName.trim().toLowerCase();
  const htmlish = /<!doctype\s+html|<html\b|<body\b/i.test(normalized);

  if (htmlish || lowerName.endsWith(".html") || lowerName.endsWith(".htm")) {
    return parseNotebookHtmlImport(fileName, normalized);
  }

  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) {
    return parseNotebookMarkdownImport(fileName, normalized);
  }

  return parseNotebookTextImport(fileName, normalized);
}
