import { core } from "@tauri-apps/api";

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
