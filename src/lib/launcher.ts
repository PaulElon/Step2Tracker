import { invoke } from "@tauri-apps/api/core";

async function openWebUrl(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Opens a URL or local macOS app path.
 * - http/https URLs → browser via Tauri opener
 * - /path or ~/path or file:// → Rust `launch_path` (uses macOS `open` binary)
 * - bare domain → prepends https:// and opens in browser
 */
export async function launchResource(target: string): Promise<void> {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Resource path or URL is empty.");
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    await openWebUrl(trimmed);
    return;
  }

  if (trimmed.startsWith("file://")) {
    const path = trimmed.slice("file://".length);
    await invoke("launch_path", { path });
    return;
  }

  if (trimmed.startsWith("/") || trimmed.startsWith("~")) {
    await invoke("launch_path", { path: trimmed });
    return;
  }

  // Treat as a bare domain / URL fallback.
  await openWebUrl(`https://${trimmed}`);
}
