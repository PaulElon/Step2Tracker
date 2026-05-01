import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RichTextEditor, richTextToPlain } from "../components/rich-text-editor";
import { formatSavedAt } from "../lib/datetime";
import { useAppStore } from "../state/app-store";
import type { NotebookPage } from "../types/models";

const NOTEBOOK_FAVORITES_STORAGE_KEY = "step2-command-center:notebook-favorites:v1";

function loadNotebookFavoriteMap() {
  if (typeof window === "undefined") {
    return {} as Record<string, true>;
  }

  try {
    const raw = window.localStorage.getItem(NOTEBOOK_FAVORITES_STORAGE_KEY);
    if (!raw) {
      return {} as Record<string, true>;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, true>;
    }
    const next: Record<string, true> = {};
    for (const [id, favorited] of Object.entries(parsed)) {
      if (typeof id === "string" && favorited === true) {
        next[id] = true;
      }
    }
    return next;
  } catch {
    return {} as Record<string, true>;
  }
}

function saveNotebookFavoriteMap(value: Record<string, true>) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (Object.keys(value).length === 0) {
      window.localStorage.removeItem(NOTEBOOK_FAVORITES_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(NOTEBOOK_FAVORITES_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // no-op: localStorage write failures should not block notebook edits
  }
}

function mapFavoritesFromPages(pages: NotebookPage[]) {
  const next: Record<string, true> = {};
  for (const page of pages) {
    if (page.favorited === true) {
      next[page.id] = true;
    }
  }
  return next;
}

function mergePageFavorites(pages: NotebookPage[], favorites: Record<string, true>) {
  return pages.map((page) => ({
    ...page,
    favorited: favorites[page.id] === true || page.favorited === true,
  }));
}

function sortNotebookPages(pages: NotebookPage[]) {
  return [...pages].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function createUntitledPage(order: number): NotebookPage {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "Untitled",
    contentHtml: "",
    order,
    createdAt: now,
    updatedAt: now,
  };
}

type NotebookExportFormat = "txt" | "html" | "markdown";
type ExportStatus = null | { kind: "success" | "error"; message: string };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeFileNameSegment(value: string) {
  const fallback = "notebook-page";
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || fallback;
}

function normalizeExportText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trimEnd();
}

function createTxtExport(page: NotebookPage) {
  const title = page.title.trim() || "Untitled";
  const plainBody = normalizeExportText(richTextToPlain(page.contentHtml));
  return plainBody ? `${title}\n\n${plainBody}\n` : `${title}\n`;
}

function createMarkdownExport(page: NotebookPage) {
  const title = page.title.trim() || "Untitled";
  const plainBody = normalizeExportText(richTextToPlain(page.contentHtml)).replace(/\n{3,}/g, "\n\n");
  return plainBody ? `# ${title}\n\n${plainBody}\n` : `# ${title}\n`;
}

function createHtmlExport(page: NotebookPage) {
  const title = page.title.trim() || "Untitled";
  const escapedTitle = escapeHtml(title);
  const contentHtml = page.contentHtml.trim();
  const bodyHtml = contentHtml ? contentHtml : "<p></p>";
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `  <title>${escapedTitle}</title>`,
    "</head>",
    "<body>",
    `  <h1>${escapedTitle}</h1>`,
    `  ${bodyHtml}`,
    "</body>",
    "</html>",
  ].join("\n");
}

export function NotebookView() {
  const { state, persistenceStatus, lastSavedAt, setNotebookPages } = useAppStore();
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"order" | "updatedAt">("order");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favoriteMap, setFavoriteMap] = useState<Record<string, true>>(() => loadNotebookFavoriteMap());
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<ExportStatus>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const notebookPages = useMemo(
    () => mergePageFavorites(state.preferences.notebookPages, favoriteMap),
    [favoriteMap, state.preferences.notebookPages],
  );
  const sortedPages = useMemo(() => sortNotebookPages(notebookPages), [notebookPages]);
  const displayedPages = useMemo(() => {
    const basePages =
      sortMode === "updatedAt"
        ? [...notebookPages].sort(
            (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
          )
        : sortNotebookPages(notebookPages);
    const pagesAfterFavoriteFilter = showFavoritesOnly ? basePages.filter((page) => page.favorited === true) : basePages;
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return pagesAfterFavoriteFilter;
    }
    return pagesAfterFavoriteFilter.filter((page) => {
      if (page.title.toLowerCase().includes(query)) {
        return true;
      }
      return richTextToPlain(page.contentHtml).toLowerCase().includes(query);
    });
  }, [notebookPages, searchQuery, showFavoritesOnly, sortMode]);

  useEffect(() => {
    const pageIds = new Set(state.preferences.notebookPages.map((page) => page.id));
    const favoritesFromPages = mapFavoritesFromPages(state.preferences.notebookPages);
    setFavoriteMap((current) => {
      const next: Record<string, true> = { ...favoritesFromPages };
      for (const pageId of Object.keys(current)) {
        if (pageIds.has(pageId)) {
          next[pageId] = true;
        }
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      if (currentKeys.length === nextKeys.length && currentKeys.every((key) => next[key] === true)) {
        return current;
      }
      saveNotebookFavoriteMap(next);
      return next;
    });
  }, [state.preferences.notebookPages]);

  useEffect(() => {
    if (sortedPages.length === 0) {
      if (activePageId !== null) {
        setActivePageId(null);
      }
      return;
    }
    if (!activePageId || !sortedPages.some((page) => page.id === activePageId)) {
      setActivePageId(sortedPages[0].id);
    }
  }, [activePageId, sortedPages]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
      }
    }

    if (isExportMenuOpen) {
      window.addEventListener("mousedown", handleOutsideClick);
      window.addEventListener("keydown", handleEscape);
      return () => {
        window.removeEventListener("mousedown", handleOutsideClick);
        window.removeEventListener("keydown", handleEscape);
      };
    }

    return undefined;
  }, [isExportMenuOpen]);

  const activePage = sortedPages.find((page) => page.id === activePageId) ?? sortedPages[0] ?? null;
  const trimmedSearchQuery = searchQuery.trim();
  const activePageShownInList = !!activePage && displayedPages.some((page) => page.id === activePage.id);
  const hasActiveContent = !!activePage && !!richTextToPlain(activePage.contentHtml).trim();
  const pageActionButtonClass =
    "inline-flex h-8 min-w-[6.25rem] items-center justify-center rounded-lg border px-3 text-xs font-medium transition";
  const saveCopy =
    persistenceStatus === "booting"
      ? "Opening local store…"
      : persistenceStatus === "error"
        ? "Local persistence issue detected."
        : lastSavedAt
          ? `Saved ${formatSavedAt(lastSavedAt)}`
          : "Saved locally.";

  function updatePageById(pageId: string, updater: (page: NotebookPage) => NotebookPage) {
    const updatedPages = notebookPages.map((page) => (page.id === pageId ? updater(page) : page));
    void setNotebookPages(updatedPages);
  }

  function createPage() {
    const nextOrder = notebookPages.reduce((maxOrder, page) => Math.max(maxOrder, page.order), -1) + 1;
    const page = createUntitledPage(nextOrder);
    void setNotebookPages([...notebookPages, page]);
    setActivePageId(page.id);
    setExportStatus(null);
  }

  function renameActivePage(title: string) {
    if (!activePage) {
      return;
    }
    updatePageById(activePage.id, (page) => ({
      ...page,
      title,
      updatedAt: new Date().toISOString(),
    }));
  }

  function togglePageFavorite(pageId: string) {
    const page = notebookPages.find((entry) => entry.id === pageId);
    if (!page) {
      return;
    }
    const nextFavorited = page.favorited !== true;
    setFavoriteMap((current) => {
      const next = { ...current };
      if (nextFavorited) {
        next[pageId] = true;
      } else {
        delete next[pageId];
      }
      saveNotebookFavoriteMap(next);
      return next;
    });
    updatePageById(pageId, (page) => ({
      ...page,
      favorited: nextFavorited,
      updatedAt: new Date().toISOString(),
    }));
  }

  function deleteActivePage() {
    if (!activePage) {
      return;
    }

    if (sortedPages.length <= 1) {
      const replacement = createUntitledPage(0);
      void setNotebookPages([replacement]);
      setActivePageId(replacement.id);
      setExportStatus(null);
      return;
    }

    const remainingPages = notebookPages.filter((page) => page.id !== activePage.id);
    const nextSortedPages = sortNotebookPages(remainingPages);
    void setNotebookPages(remainingPages);
    setActivePageId(nextSortedPages[0]?.id ?? null);
    setExportStatus(null);
  }

  async function exportActivePage(format: NotebookExportFormat) {
    setIsExportMenuOpen(false);

    if (!activePage) {
      setExportStatus({ kind: "error", message: "Select a page to export." });
      return;
    }

    try {
      const baseName = sanitizeFileNameSegment(activePage.title || "Untitled");
      const payload =
        format === "txt"
          ? {
              fileName: `${baseName}.txt`,
              content: createTxtExport(activePage),
              label: "TXT",
            }
          : format === "html"
            ? {
                fileName: `${baseName}.html`,
                content: createHtmlExport(activePage),
                label: "HTML",
              }
            : {
                fileName: `${baseName}.md`,
                content: createMarkdownExport(activePage),
                label: "Markdown",
              };

      const savedPath = await invoke<string>("export_notebook_page", {
        suggestedFileName: payload.fileName,
        contents: payload.content,
      });

      setExportStatus({
        kind: "success",
        message: `${payload.label} export saved to ${savedPath}.`,
      });
    } catch (error) {
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error && error.message
            ? error.message
            : "Unable to export this notebook page.";
      setExportStatus({
        kind: "error",
        message,
      });
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-1">
      <section className="glass-panel flex min-h-0 flex-1 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Study Notes</p>
          </div>
          <p className="text-xs text-slate-400">{saveCopy}</p>
        </div>

        {sortedPages.length === 0 ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-[18px] border border-dashed border-white/10 bg-slate-950/30 p-4">
            <p className="text-sm text-slate-300">No notebook pages yet. Create your first page to start writing.</p>
            <button
              type="button"
              onClick={createPage}
              className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
            >
              Create first page
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4">
            <aside className="flex w-64 min-w-[14rem] flex-col gap-3 rounded-[18px] border border-white/10 bg-slate-950/30 p-3">
              <button
                type="button"
                onClick={createPage}
                className="rounded-lg border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
              >
                + Create page
              </button>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search pages"
                    className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                  />
                  {trimmedSearchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="rounded-lg border border-white/15 bg-slate-900/60 px-2 py-2 text-xs text-slate-200 transition hover:border-white/30 hover:bg-slate-900/80"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSortMode("order")}
                    className={`rounded-lg border px-2 py-1 text-xs transition ${
                      sortMode === "order"
                        ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                        : "border-white/10 bg-slate-900/50 text-slate-300 hover:border-white/20 hover:bg-slate-900/70"
                    }`}
                  >
                    By order
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortMode("updatedAt")}
                    className={`rounded-lg border px-2 py-1 text-xs transition ${
                      sortMode === "updatedAt"
                        ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                        : "border-white/10 bg-slate-900/50 text-slate-300 hover:border-white/20 hover:bg-slate-900/70"
                    }`}
                  >
                    Last edited
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowFavoritesOnly((current) => !current)}
                  className={`w-full rounded-lg border px-2 py-1 text-xs transition ${
                    showFavoritesOnly
                      ? "border-amber-300/40 bg-amber-400/15 text-amber-50"
                      : "border-white/10 bg-slate-900/50 text-slate-300 hover:border-white/20 hover:bg-slate-900/70"
                  }`}
                >
                  {showFavoritesOnly ? "Favorites only: on" : "Favorites only: off"}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-subtle">
                {displayedPages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 bg-slate-950/20 p-3 text-xs text-slate-300">
                    {showFavoritesOnly && !trimmedSearchQuery ? <p>No favorited pages yet.</p> : <p>{`No pages match "${trimmedSearchQuery}".`}</p>}
                    {trimmedSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="mt-2 rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 transition hover:border-white/30 hover:bg-slate-900/80"
                      >
                        Clear search
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {displayedPages.map((page) => {
                      const isActive = activePage?.id === page.id;
                      const displayTitle = page.title.trim() || "Untitled";
                      return (
                        <li key={page.id}>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActivePageId(page.id)}
                              className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition ${
                                isActive
                                  ? "border-cyan-300/40 bg-cyan-400/15 text-cyan-50"
                                  : "border-white/10 bg-slate-900/50 text-slate-300 hover:border-white/20 hover:bg-slate-900/70"
                              }`}
                            >
                              {displayTitle}
                            </button>
                            <button
                              type="button"
                              aria-label={page.favorited ? "Unfavorite page" : "Favorite page"}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                togglePageFavorite(page.id);
                              }}
                              className={`rounded-lg border px-2 py-1 text-sm transition ${
                                page.favorited
                                  ? "border-amber-300/35 bg-amber-400/15 text-amber-50 hover:bg-amber-400/25"
                                  : "border-white/10 bg-slate-900/50 text-amber-100/90 hover:border-amber-300/30 hover:bg-amber-300/15 hover:text-amber-50"
                              }`}
                            >
                              {page.favorited ? "★" : "☆"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {activePage ? (
                <>
                  {!activePageShownInList ? (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-white/15 bg-slate-950/30 px-3 py-2 text-xs text-slate-300">
                      <p>This page is hidden by your current filters.</p>
                      <div className="flex items-center gap-2">
                        {trimmedSearchQuery ? (
                          <button
                            type="button"
                            onClick={() => setSearchQuery("")}
                            className="rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 transition hover:border-white/30 hover:bg-slate-900/80"
                          >
                            Clear search
                          </button>
                        ) : null}
                        {showFavoritesOnly ? (
                          <button
                            type="button"
                            onClick={() => setShowFavoritesOnly(false)}
                            className="rounded-lg border border-white/15 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 transition hover:border-white/30 hover:bg-slate-900/80"
                          >
                            Show all pages
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.14em] text-slate-500">Page title</span>
                      <input
                        type="text"
                        value={activePage.title}
                        onChange={(event) => renameActivePage(event.target.value)}
                        placeholder="Untitled"
                        className="h-8 rounded-lg border border-white/10 bg-slate-900/60 px-3 text-xs text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                      />
                    </label>
                    <div ref={exportMenuRef} className={`relative ${!activePage ? "pointer-events-none opacity-50" : ""}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setExportStatus(null);
                          setIsExportMenuOpen((current) => !current);
                        }}
                        className={`${pageActionButtonClass} border-white/15 bg-slate-900/60 text-slate-200 hover:border-white/30 hover:bg-slate-900/80`}
                      >
                        Export
                      </button>
                      {isExportMenuOpen ? (
                        <div className="absolute right-0 z-20 mt-1 flex w-[7.5rem] flex-col gap-1 rounded-lg border border-white/15 bg-slate-950/95 p-1 shadow-lg backdrop-blur select-none">
                          <button
                            type="button"
                            onClick={() => {
                              void exportActivePage("txt");
                            }}
                            className="rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-white/10"
                          >
                            TXT
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void exportActivePage("html");
                            }}
                            className="rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-white/10"
                          >
                            HTML
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void exportActivePage("markdown");
                            }}
                            className="rounded-md px-2 py-1 text-left text-xs text-slate-200 transition hover:bg-white/10"
                          >
                            Markdown
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={deleteActivePage}
                      className={`${pageActionButtonClass} border-rose-300/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20`}
                    >
                      Delete page
                    </button>
                  </div>
                  {exportStatus ? (
                    <p className={`text-xs ${exportStatus.kind === "error" ? "text-rose-200" : "text-cyan-100"}`}>{exportStatus.message}</p>
                  ) : null}

                  <RichTextEditor
                    value={activePage.contentHtml}
                    onChange={(html) => {
                      updatePageById(activePage.id, (page) => ({
                        ...page,
                        contentHtml: html,
                        updatedAt: new Date().toISOString(),
                      }));
                    }}
                    placeholder="Type freely. Cmd+B/I/U for bold/italic/underline. * → bullet, - → dashed, 1. → numbered."
                    className="min-h-[320px] flex-1 overflow-y-auto scrollbar-subtle"
                  />

                  {!hasActiveContent ? (
                    <div className="rounded-[18px] border border-dashed border-white/10 bg-slate-950/30 p-3 text-sm text-slate-300">
                      This page is empty. Start writing notes for this topic.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
