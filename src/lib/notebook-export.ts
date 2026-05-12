import JSZip from "jszip";
import { createNotebookPdfExport } from "./notebook-pdf-export";
import { sanitizeNotebookFileNameSegment } from "./notebook-io";
import type { NotebookDocument, NotebookFolder, NotebookPage } from "../types/models";

export interface NotebookDocumentExportResult {
  bytes: Uint8Array;
  isZip: boolean;
  suggestedFileName: string;
  pageCount: number;
  warnings: string[];
}

export interface NotebookFolderExportResult {
  bytes: Uint8Array;
  suggestedFileName: string;
  documentCount: number;
  warnings: string[];
}

function sortPagesByOrder(pages: NotebookPage[]): NotebookPage[] {
  return [...pages].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  });
}

async function exportPageToPdfBytes(
  page: NotebookPage,
): Promise<{ bytes: Uint8Array; missingImages: string[] }> {
  const result = await createNotebookPdfExport(page, null);
  return { bytes: result.bytes, missingImages: result.missingImages };
}

export async function exportNotebookDocumentToBytes(
  doc: NotebookDocument,
): Promise<NotebookDocumentExportResult> {
  const pages = sortPagesByOrder(doc.pages);
  const docSlug = sanitizeNotebookFileNameSegment(doc.title || "Untitled Document");
  const warnings: string[] = [];

  if (pages.length === 0) {
    throw new Error(`Document "${doc.title}" has no pages.`);
  }

  if (pages.length === 1) {
    const { bytes, missingImages } = await exportPageToPdfBytes(pages[0]);
    for (const img of missingImages) {
      warnings.push(`Image could not be embedded: ${img}`);
    }
    return {
      bytes,
      isZip: false,
      suggestedFileName: `${docSlug}.pdf`,
      pageCount: 1,
      warnings,
    };
  }

  // Multi-page document: one PDF per page inside a zip
  const zip = new JSZip();
  const padLen = String(pages.length).length;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNum = String(i + 1).padStart(padLen, "0");
    const pageSlug = sanitizeNotebookFileNameSegment(page.title || `Page ${i + 1}`);
    const { bytes, missingImages } = await exportPageToPdfBytes(page);
    if (missingImages.length > 0) {
      warnings.push(`"${page.title}": ${missingImages.length} image(s) could not be embedded.`);
    }
    zip.file(`${pageNum}-${pageSlug}.pdf`, bytes);
  }

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    bytes: zipBytes,
    isZip: true,
    suggestedFileName: `${docSlug}.zip`,
    pageCount: pages.length,
    warnings,
  };
}

export async function exportNotebookFolderToZip(
  folder: NotebookFolder,
  documents: NotebookDocument[],
): Promise<NotebookFolderExportResult> {
  const folderSlug = sanitizeNotebookFileNameSegment(folder.name || "Untitled Folder");
  const zip = new JSZip();
  const warnings: string[] = [];
  let documentCount = 0;

  for (const doc of documents) {
    const pages = sortPagesByOrder(doc.pages);
    if (pages.length === 0) continue;

    const docSlug = sanitizeNotebookFileNameSegment(doc.title || "Untitled Document");

    if (pages.length === 1) {
      const { bytes, missingImages } = await exportPageToPdfBytes(pages[0]);
      if (missingImages.length > 0) {
        warnings.push(`"${doc.title}": ${missingImages.length} image(s) could not be embedded.`);
      }
      zip.file(`${docSlug}.pdf`, bytes);
    } else {
      const padLen = String(pages.length).length;
      const docFolder = zip.folder(docSlug);
      if (!docFolder) continue;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageNum = String(i + 1).padStart(padLen, "0");
        const pageSlug = sanitizeNotebookFileNameSegment(page.title || `Page ${i + 1}`);
        const { bytes, missingImages } = await exportPageToPdfBytes(page);
        if (missingImages.length > 0) {
          warnings.push(`"${doc.title}/${page.title}": ${missingImages.length} image(s) could not be embedded.`);
        }
        docFolder.file(`${pageNum}-${pageSlug}.pdf`, bytes);
      }
    }
    documentCount++;
  }

  if (documentCount === 0) {
    throw new Error("This folder has no exportable documents.");
  }

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    bytes: zipBytes,
    suggestedFileName: `${folderSlug}.zip`,
    documentCount,
    warnings,
  };
}
