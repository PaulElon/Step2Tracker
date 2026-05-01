import { useEffect, useMemo, useState } from "react";
import { RichTextEditor, richTextToPlain } from "../components/rich-text-editor";
import { formatSavedAt } from "../lib/datetime";
import { useAppStore } from "../state/app-store";
import type { NotebookPage } from "../types/models";

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

export function NotebookView() {
  const { state, persistenceStatus, lastSavedAt, setNotebookPages } = useAppStore();
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"order" | "updatedAt">("order");
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const notebookPages = state.preferences.notebookPages;
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

  const activePage = sortedPages.find((page) => page.id === activePageId) ?? sortedPages[0] ?? null;
  const trimmedSearchQuery = searchQuery.trim();
  const activePageShownInList = !!activePage && displayedPages.some((page) => page.id === activePage.id);
  const hasActiveContent = !!activePage && !!richTextToPlain(activePage.contentHtml).trim();
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
    updatePageById(pageId, (page) => ({
      ...page,
      favorited: page.favorited !== true,
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
      return;
    }

    const remainingPages = notebookPages.filter((page) => page.id !== activePage.id);
    const nextSortedPages = sortNotebookPages(remainingPages);
    void setNotebookPages(remainingPages);
    setActivePageId(nextSortedPages[0]?.id ?? null);
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-2">
      <section className="glass-panel flex min-h-0 flex-1 flex-col gap-3 p-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Study Notes</p>
            <p className="mt-1 text-sm text-slate-300">Use formatting shortcuts to capture details quickly.</p>
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
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
                      <span className="text-xs uppercase tracking-[0.14em] text-slate-500">Page title</span>
                      <input
                        type="text"
                        value={activePage.title}
                        onChange={(event) => renameActivePage(event.target.value)}
                        placeholder="Untitled"
                        className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={deleteActivePage}
                      className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
                    >
                      Delete page
                    </button>
                  </div>

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
