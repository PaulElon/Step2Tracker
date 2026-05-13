import type JSZip from "jszip";
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
  folderCount: number;
  warnings: string[];
}

async function loadJSZip(): Promise<typeof JSZip> {
  const { default: JSZip } = await import("jszip");
  return JSZip;
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
  const JSZip = await loadJSZip();
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

// Maps zip directory path → set of already-claimed entry names (files + dirs).
type NameRegistry = Map<string, Set<string>>;

function claimFileName(registry: NameRegistry, dirPath: string, base: string, ext: string): string {
  let bucket = registry.get(dirPath);
  if (!bucket) {
    bucket = new Set();
    registry.set(dirPath, bucket);
  }
  let candidate = `${base}.${ext}`;
  if (!bucket.has(candidate)) {
    bucket.add(candidate);
    return candidate;
  }
  let n = 2;
  while (true) {
    candidate = `${base} (${n}).${ext}`;
    if (!bucket.has(candidate)) {
      bucket.add(candidate);
      return candidate;
    }
    n++;
  }
}

function claimDirName(registry: NameRegistry, dirPath: string, base: string): string {
  let bucket = registry.get(dirPath);
  if (!bucket) {
    bucket = new Set();
    registry.set(dirPath, bucket);
  }
  if (!bucket.has(base)) {
    bucket.add(base);
    return base;
  }
  let n = 2;
  while (true) {
    const candidate = `${base} (${n})`;
    if (!bucket.has(candidate)) {
      bucket.add(candidate);
      return candidate;
    }
    n++;
  }
}

async function addFolderContentsToZip(
  zipNode: JSZip,
  zipDirPath: string,
  targetFolder: NotebookFolder,
  allFolders: NotebookFolder[],
  allDocuments: NotebookDocument[],
  registry: NameRegistry,
  warnings: string[],
): Promise<{ documentCount: number; folderCount: number }> {
  let documentCount = 0;
  let folderCount = 1; // count the folder we are currently processing

  const childDocuments = allDocuments.filter((doc) => doc.folderId === targetFolder.id);
  const childFolders = allFolders.filter((f) => f.parentFolderId === targetFolder.id);

  for (const doc of childDocuments) {
    const pages = sortPagesByOrder(doc.pages);
    if (pages.length === 0) continue;

    const docSlug = sanitizeNotebookFileNameSegment(doc.title || "Untitled Document");

    if (pages.length === 1) {
      const { bytes, missingImages } = await exportPageToPdfBytes(pages[0]);
      if (missingImages.length > 0) {
        warnings.push(`"${doc.title}": ${missingImages.length} image(s) could not be embedded.`);
      }
      const fileName = claimFileName(registry, zipDirPath, docSlug, "pdf");
      zipNode.file(fileName, bytes);
    } else {
      const dirName = claimDirName(registry, zipDirPath, docSlug);
      const docFolder = zipNode.folder(dirName);
      if (!docFolder) continue;
      const docPath = `${zipDirPath}/${dirName}`;
      const padLen = String(pages.length).length;
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const pageNum = String(i + 1).padStart(padLen, "0");
        const pageSlug = sanitizeNotebookFileNameSegment(page.title || `Page ${i + 1}`);
        const { bytes, missingImages } = await exportPageToPdfBytes(page);
        if (missingImages.length > 0) {
          warnings.push(`"${doc.title}/${page.title}": ${missingImages.length} image(s) could not be embedded.`);
        }
        const pageFileName = claimFileName(registry, docPath, `${pageNum}-${pageSlug}`, "pdf");
        docFolder.file(pageFileName, bytes);
      }
    }
    documentCount++;
  }

  for (const childFolder of childFolders) {
    const childSlug = sanitizeNotebookFileNameSegment(childFolder.name || "Untitled Folder");
    const childDirName = claimDirName(registry, zipDirPath, childSlug);
    const childZipNode = zipNode.folder(childDirName);
    if (!childZipNode) continue;
    const childPath = `${zipDirPath}/${childDirName}`;
    const counts = await addFolderContentsToZip(
      childZipNode,
      childPath,
      childFolder,
      allFolders,
      allDocuments,
      registry,
      warnings,
    );
    documentCount += counts.documentCount;
    folderCount += counts.folderCount;
  }

  return { documentCount, folderCount };
}

export async function exportNotebookFolderToZip(
  folder: NotebookFolder,
  allFolders: NotebookFolder[],
  allDocuments: NotebookDocument[],
): Promise<NotebookFolderExportResult> {
  const folderSlug = sanitizeNotebookFileNameSegment(folder.name || "Untitled Folder");
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const warnings: string[] = [];
  const registry: NameRegistry = new Map();

  // Zip root is represented by an empty string path.
  const { documentCount, folderCount } = await addFolderContentsToZip(
    zip,
    "",
    folder,
    allFolders,
    allDocuments,
    registry,
    warnings,
  );

  if (documentCount === 0) {
    throw new Error("This folder has no exportable documents.");
  }

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    bytes: zipBytes,
    suggestedFileName: `${folderSlug}.zip`,
    documentCount,
    folderCount,
    warnings,
  };
}
