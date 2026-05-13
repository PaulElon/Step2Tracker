import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  UnderlineType,
  type IParagraphOptions,
  type ParagraphChild,
} from "docx";
import mammoth from "mammoth";
import type { NotebookImportedPageDraft } from "./notebook-io";

const DOCX_EXTENSION = ".docx";
const DOCX_ZIP_MAGIC_0 = 0x50;
const DOCX_ZIP_MAGIC_1 = 0x4b;
const DOCX_ZIP_MAGIC_2 = 0x03;
const DOCX_ZIP_MAGIC_3 = 0x04;

type InlineStyleState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
};

const DEFAULT_INLINE_STYLE: InlineStyleState = {
  bold: false,
  italic: false,
  underline: false,
};

function isDocxExtension(fileName: string) {
  return fileName.trim().toLowerCase().endsWith(DOCX_EXTENSION);
}

function hasZipMagic(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === DOCX_ZIP_MAGIC_0 &&
    bytes[1] === DOCX_ZIP_MAGIC_1 &&
    bytes[2] === DOCX_ZIP_MAGIC_2 &&
    bytes[3] === DOCX_ZIP_MAGIC_3
  );
}

function buildMammothInput(bytes: Uint8Array, arrayBuffer: ArrayBuffer) {
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: Uint8Array) => unknown } }).Buffer;
  if (maybeBuffer && typeof maybeBuffer.from === "function") {
    return { buffer: maybeBuffer.from(bytes) };
  }
  return { arrayBuffer };
}

function fileStem(fileName: string) {
  const normalized = fileName.trim();
  if (!normalized) return "Imported Notebook";
  const lastSegment = normalized.split(/[\\/]/).pop() ?? normalized;
  const dotIndex = lastSegment.lastIndexOf(".");
  const stem = dotIndex > 0 ? lastSegment.slice(0, dotIndex) : lastSegment;
  return stem.trim() || "Imported Notebook";
}

function normalizeImportHtml(value: string) {
  const trimmed = value.trim();
  return trimmed || "<p></p>";
}

function pushTextRun(
  sink: ParagraphChild[],
  text: string,
  style: InlineStyleState,
) {
  if (!text) return;
  sink.push(
    new TextRun({
      text,
      bold: style.bold || undefined,
      italics: style.italic || undefined,
      underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
    }),
  );
}

function parseInlineChildren(node: Node, style: InlineStyleState): ParagraphChild[] {
  const children: ParagraphChild[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
    if (text) {
      pushTextRun(children, text, style);
    }
    return children;
  }

  if (!(node instanceof HTMLElement)) {
    return children;
  }

  if (node.tagName === "BR") {
    children.push(new TextRun({ break: 1 }));
    return children;
  }

  const nextStyle: InlineStyleState = {
    bold: style.bold || node.tagName === "STRONG" || node.tagName === "B",
    italic: style.italic || node.tagName === "EM" || node.tagName === "I",
    underline: style.underline || node.tagName === "U",
  };

  if (node.tagName === "A") {
    const href = node.getAttribute("href")?.trim();
    const linkChildren = [...node.childNodes].flatMap((child) => parseInlineChildren(child, nextStyle));
    if (href && /^https?:\/\//i.test(href)) {
      children.push(
        new ExternalHyperlink({
          link: href,
          children: linkChildren.length > 0 ? linkChildren : [new TextRun({ text: href })],
        }),
      );
      return children;
    }
    children.push(...linkChildren);
    return children;
  }

  for (const child of node.childNodes) {
    children.push(...parseInlineChildren(child, nextStyle));
  }
  return children;
}

function paragraphFromNode(node: HTMLElement, options: Omit<IParagraphOptions, "children"> = {}) {
  const children = [...node.childNodes].flatMap((child) => parseInlineChildren(child, DEFAULT_INLINE_STYLE));
  if (children.length === 0) {
    children.push(new TextRun(""));
  }
  return new Paragraph({
    ...options,
    children,
  });
}

function headingLevelForTag(tagName: string): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (tagName) {
    case "H1":
      return HeadingLevel.HEADING_1;
    case "H2":
      return HeadingLevel.HEADING_2;
    case "H3":
      return HeadingLevel.HEADING_3;
    case "H4":
      return HeadingLevel.HEADING_4;
    case "H5":
      return HeadingLevel.HEADING_5;
    case "H6":
      return HeadingLevel.HEADING_6;
    default:
      return HeadingLevel.HEADING_2;
  }
}

function listLevelFromDepth(depth: number) {
  return Math.max(0, Math.min(8, depth));
}

function blocksFromListElement(
  list: HTMLElement,
  depth: number,
): Paragraph[] {
  const blocks: Paragraph[] = [];
  const isOrdered = list.tagName === "OL";
  const listItems = [...list.children].filter((child) => child.tagName === "LI");
  for (const li of listItems) {
    const liElement = li as HTMLElement;
    const nestedLists = [...liElement.children].filter((child) => child.tagName === "UL" || child.tagName === "OL");
    const textHost = liElement.cloneNode(true) as HTMLElement;
    for (const nested of [...textHost.children].filter((child) => child.tagName === "UL" || child.tagName === "OL")) {
      nested.remove();
    }
    const paragraph = paragraphFromNode(textHost, {
      ...(isOrdered
        ? {
            numbering: {
              reference: "notebook-numbered-list",
              level: listLevelFromDepth(depth),
            },
          }
        : {
            bullet: {
              level: listLevelFromDepth(depth),
            },
          }),
    });
    blocks.push(paragraph);
    for (const nested of nestedLists) {
      blocks.push(...blocksFromElement(nested as HTMLElement, depth + 1));
    }
  }
  return blocks;
}

function blocksFromElement(node: HTMLElement, listDepth = 0): Paragraph[] {
  const tag = node.tagName;
  if (tag === "UL" || tag === "OL") {
    return blocksFromListElement(node, listDepth);
  }
  if (tag === "P") {
    return [paragraphFromNode(node)];
  }
  if (/^H[1-6]$/.test(tag)) {
    return [
      paragraphFromNode(node, {
        heading: headingLevelForTag(tag),
      }),
    ];
  }
  if (tag === "BLOCKQUOTE") {
    return [
      paragraphFromNode(node, {
        indent: { left: 720 },
      }),
    ];
  }
  if (tag === "PRE") {
    return [
      paragraphFromNode(node, {
        style: "Code",
      }),
    ];
  }
  if (tag === "BR") {
    return [new Paragraph({ children: [new TextRun("")] })];
  }

  const childBlocks = [...node.children].flatMap((child) => blocksFromElement(child as HTMLElement, listDepth));
  if (childBlocks.length > 0) {
    return childBlocks;
  }

  const fallback = paragraphFromNode(node);
  return [fallback];
}

function bodyHtmlToParagraphs(bodyHtml: string): Paragraph[] {
  if (typeof DOMParser === "undefined") {
    const plainText = bodyHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
      .trim();
    return [new Paragraph({ children: [new TextRun({ text: plainText || "" })] })];
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<body>${bodyHtml.trim() || "<p></p>"}</body>`, "text/html");
  const body = parsed.body;
  const blocks = [...body.children].flatMap((child) => blocksFromElement(child as HTMLElement));
  return blocks.length > 0 ? blocks : [new Paragraph({ children: [new TextRun("")] })];
}

export async function parseNotebookDocxImport(file: File): Promise<NotebookImportedPageDraft> {
  if (!isDocxExtension(file.name)) {
    throw new Error("Notebook DOCX import requires a .docx file.");
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!hasZipMagic(bytes)) {
    throw new Error("This .docx file appears invalid or corrupted.");
  }

  try {
    const result = await mammoth.convertToHtml(buildMammothInput(bytes, buffer) as never);
    const contentHtml = normalizeImportHtml(result.value);
    return {
      documentTitle: fileStem(file.name),
      pageTitle: "Page 1",
      contentHtml,
    };
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    throw new Error(`Unable to import this .docx file.${detail}`.trim());
  }
}

export async function createNotebookDocxExport(
  documentTitle: string,
  pageTitle: string,
  bodyHtml: string,
): Promise<Uint8Array> {
  const normalizedDocumentTitle = documentTitle.trim() || "Untitled Document";
  const normalizedPageTitle = pageTitle.trim() || "Page 1";
  const bodyParagraphs = bodyHtmlToParagraphs(bodyHtml);

  const doc = new Document({
    title: normalizedDocumentTitle,
    numbering: {
      config: [
        {
          reference: "notebook-numbered-list",
          levels: Array.from({ length: 9 }, (_unused, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
          })),
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({
            text: normalizedDocumentTitle,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: normalizedPageTitle,
            heading: HeadingLevel.HEADING_2,
          }),
          ...bodyParagraphs,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}
