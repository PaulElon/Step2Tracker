import { core } from "@tauri-apps/api";
import type { NotebookDocument } from "../types/models";

const MAX_BYTES = 100 * 1024 * 1024;

export interface ImportedNotebookPdf {
  filename: string;
  originalName: string;
  bytes: Uint8Array;
}

export async function uploadNotebookPdf(file: File): Promise<ImportedNotebookPdf> {
  if (file.size > MAX_BYTES) {
    throw new Error(
      `PDF exceeds 100 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    );
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46
  ) {
    throw new Error("File is not a valid PDF (missing %PDF header).");
  }
  const dataB64 = bytesToBase64(bytes);
  const filename = await core.invoke<string>("save_notebook_pdf", { dataB64 });
  return { filename, originalName: file.name, bytes };
}

export async function readNotebookPdfBytes(filename: string): Promise<Uint8Array> {
  const { data_b64 } = await core.invoke<{ data_b64: string }>("read_notebook_pdf_as_base64", {
    filename,
  });
  return base64ToBytes(data_b64);
}

export async function exportNotebookPdfBytes(suggestedFileName: string, bytes: Uint8Array): Promise<string> {
  return core.invoke<string>("export_notebook_pdf", {
    suggestedFileName,
    dataB64: bytesToBase64(bytes),
  });
}

export async function exportNotebookZipBytes(suggestedFileName: string, bytes: Uint8Array): Promise<string> {
  return core.invoke<string>("export_notebook_zip", {
    suggestedFileName,
    dataB64: bytesToBase64(bytes),
  });
}

export async function exportNotebookDocxBytes(suggestedFileName: string, bytes: Uint8Array): Promise<string> {
  return core.invoke<string>("export_notebook_docx", {
    suggestedFileName,
    dataB64: bytesToBase64(bytes),
  });
}

export async function purgeOrphanedNotebookPdfs(
  documents: NotebookDocument[],
  dryRun: boolean,
): Promise<string[]> {
  return core.invoke<string[]>("purge_orphaned_notebook_pdfs", {
    documentsJson: JSON.stringify(documents),
    dryRun,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
