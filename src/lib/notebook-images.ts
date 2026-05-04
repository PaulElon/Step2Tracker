import { core } from "@tauri-apps/api";
import type { NotebookDocument } from "../types/models";

const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadNotebookImage(file: File): Promise<string> {
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    throw new Error(
      `Unsupported image type: ${file.type || "(unknown)"}. Use PNG, JPEG, GIF, or WebP.`,
    );
  }
  if (file.size > MAX_BYTES) {
    throw new Error(
      `Image exceeds 10 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
    );
  }
  const dataB64 = await toBase64(file);
  return core.invoke<string>("save_notebook_image", { dataB64, ext });
}

export function getNotebookImageFilenameFromSrc(src: string): string | null {
  const prefix = "nbimg://localhost/";
  if (!src.startsWith(prefix)) {
    return null;
  }
  const filename = src.slice(prefix.length);
  return filename || null;
}

export interface EmbedNotebookImagesResult {
  html: string;
  missingImages: string[];
}

export async function embedNotebookImagesInHtml(html: string): Promise<EmbedNotebookImagesResult> {
  const uniqueSrcs = new Set<string>();
  for (const m of html.matchAll(/nbimg:\/\/localhost\/([^"'\s<>]+)/g)) {
    uniqueSrcs.add(`nbimg://localhost/${m[1]}`);
  }

  let result = html;
  const missingImages: string[] = [];

  for (const src of uniqueSrcs) {
    const filename = getNotebookImageFilenameFromSrc(src);
    if (!filename) {
      continue;
    }
    try {
      const { mime, data_b64 } = await core.invoke<{ mime: string; data_b64: string }>(
        "read_notebook_image_as_base64",
        { filename },
      );
      const dataUri = `data:${mime};base64,${data_b64}`;
      result = result.split(src).join(dataUri);
    } catch {
      missingImages.push(filename);
    }
  }

  return { html: result, missingImages };
}

export async function purgeOrphanedNotebookImages(
  documents: NotebookDocument[],
  dryRun: boolean,
): Promise<string[]> {
  return core.invoke<string[]>("purge_orphaned_notebook_images", {
    documentsJson: JSON.stringify(documents),
    dryRun,
  });
}

async function toBase64(file: File): Promise<string> {
  const CHUNK_SIZE = 8192;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
