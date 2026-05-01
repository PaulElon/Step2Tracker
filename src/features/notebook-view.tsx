import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ModalShell } from "../components/modal-shell";
import { RichTextEditor, richTextToPlain } from "../components/rich-text-editor";
import { useAppStore } from "../state/app-store";
import type { NotebookDocument, NotebookFolder, NotebookPage } from "../types/models";

type NotebookExportFormat = "txt" | "html" | "markdown";
type ActionStatus = null | { kind: "success" | "error"; message: string };
type PromptState =
  | {
      kind: "create-folder";
      value: string;
    }
  | {
      kind: "create-document";
      value: string;
    }
  | {
      kind: "rename-folder";
      folderId: string;
      value: string;
    }
  | {
      kind: "rename-document";
      documentId: string;
      value: string;
    };

type TileActionMenuState =
  | {
      kind: "folder";
      folderId: string;
    }
  | {
      kind: "document";
      documentId: string;
    };

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sortByOrder<T extends { order: number; createdAt?: string; id?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    const createdAtCompare = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    if (createdAtCompare !== 0) {
      return createdAtCompare;
    }
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function createPage(title: string, order: number): NotebookPage {
  const now = nowIso();
  return {
    id: makeId("nb-page"),
    title,
    contentHtml: "",
    order,
    createdAt: now,
    updatedAt: now,
  };
}

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

function createTxtExport(document: NotebookDocument, page: NotebookPage) {
  const documentTitle = document.title.trim() || "Untitled Document";
  const pageTitle = page.title.trim() || "Page 1";
  const plainBody = normalizeExportText(richTextToPlain(page.contentHtml));
  return plainBody ? `${documentTitle}\n${pageTitle}\n\n${plainBody}\n` : `${documentTitle}\n${pageTitle}\n`;
}

function createMarkdownExport(document: NotebookDocument, page: NotebookPage) {
  const documentTitle = document.title.trim() || "Untitled Document";
  const pageTitle = page.title.trim() || "Page 1";
  const plainBody = normalizeExportText(richTextToPlain(page.contentHtml)).replace(/\n{3,}/g, "\n\n");
  return plainBody ? `# ${documentTitle}\n\n## ${pageTitle}\n\n${plainBody}\n` : `# ${documentTitle}\n\n## ${pageTitle}\n`;
}

function createHtmlExport(document: NotebookDocument, page: NotebookPage) {
  const documentTitle = document.title.trim() || "Untitled Document";
  const pageTitle = page.title.trim() || "Page 1";
  const escapedDocumentTitle = escapeHtml(documentTitle);
  const escapedPageTitle = escapeHtml(pageTitle);
  const contentHtml = page.contentHtml.trim();
  const bodyHtml = contentHtml ? contentHtml : "<p></p>";
  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "<head>",
    "  <meta charset=\"utf-8\" />",
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
    `  <title>${escapedDocumentTitle} - ${escapedPageTitle}</title>`,
    "</head>",
    "<body>",
    `  <h1>${escapedDocumentTitle}</h1>`,
    `  <h2>${escapedPageTitle}</h2>`,
    `  ${bodyHtml}`,
    "</body>",
    "</html>",
  ].join("\n");
}

function buildFolderOptionLabels(folders: NotebookFolder[]) {
  const byParent = new Map<string | null, NotebookFolder[]>();
  for (const folder of sortByOrder(folders)) {
    const parentId = folder.parentFolderId ?? null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(folder);
    byParent.set(parentId, siblings);
  }

  const options: Array<{ id: string; label: string }> = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number) {
    const children = byParent.get(parentId) ?? [];
    for (const folder of children) {
      if (visited.has(folder.id)) {
        continue;
      }
      visited.add(folder.id);
      options.push({
        id: folder.id,
        label: `${"  ".repeat(depth)}${folder.name.trim() || "Untitled Folder"}`,
      });
      walk(folder.id, depth + 1);
    }
  }

  walk(null, 0);

  for (const folder of sortByOrder(folders)) {
    if (!visited.has(folder.id)) {
      options.push({
        id: folder.id,
        label: folder.name.trim() || "Untitled Folder",
      });
    }
  }

  return options;
}

function isDocumentSearchMatch(document: NotebookDocument, query: string) {
  if (!query) {
    return true;
  }
  if (document.title.toLowerCase().includes(query)) {
    return true;
  }
  return document.pages.some((page) => richTextToPlain(page.contentHtml).toLowerCase().includes(query));
}

function deriveLegacyDocuments(pages: NotebookPage[]): NotebookDocument[] {
  return sortByOrder(pages).map((page) => ({
    id: `legacy-${page.id}`,
    title: page.title,
    folderId: page.folderId,
    favorited: page.favorited === true,
    order: page.order,
    pages: [{ ...page }],
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  }));
}

export function NotebookView() {
  const { state, setNotebookFolders, setNotebookDocuments } = useAppStore();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<ActionStatus>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [tileActionMenu, setTileActionMenu] = useState<TileActionMenuState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const tileActionMenuRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);

  const notebookFolders = state.preferences.notebookFolders;
  const notebookDocuments = state.preferences.notebookDocuments;
  const notebookPages = state.preferences.notebookPages;
  const derivedLegacyDocuments = useMemo(
    () => (notebookDocuments.length === 0 ? deriveLegacyDocuments(notebookPages) : []),
    [notebookDocuments, notebookPages],
  );
  const displayDocuments = notebookDocuments.length > 0 ? notebookDocuments : derivedLegacyDocuments;
  const isUsingLegacyDocuments = notebookDocuments.length === 0 && derivedLegacyDocuments.length > 0;

  const sortedFolders = useMemo(() => sortByOrder(notebookFolders), [notebookFolders]);
  const sortedDocuments = useMemo(() => sortByOrder(displayDocuments), [displayDocuments]);
  const folderById = useMemo(() => new Map(sortedFolders.map((folder) => [folder.id, folder])), [sortedFolders]);
  const currentFolder = currentFolderId ? folderById.get(currentFolderId) ?? null : null;
  const folderOptions = useMemo(() => buildFolderOptionLabels(sortedFolders), [sortedFolders]);

  const siblingFolders = useMemo(
    () => sortedFolders.filter((folder) => (folder.parentFolderId ?? null) === currentFolderId),
    [currentFolderId, sortedFolders],
  );
  const siblingDocuments = useMemo(
    () => sortedDocuments.filter((document) => (document.folderId ?? null) === currentFolderId),
    [currentFolderId, sortedDocuments],
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const visibleFolders = useMemo(() => {
    if (!normalizedSearchQuery) {
      return siblingFolders;
    }
    return siblingFolders.filter((folder) => folder.name.toLowerCase().includes(normalizedSearchQuery));
  }, [normalizedSearchQuery, siblingFolders]);
  const visibleDocuments = useMemo(() => {
    if (!normalizedSearchQuery) {
      return siblingDocuments;
    }
    return siblingDocuments.filter((document) => isDocumentSearchMatch(document, normalizedSearchQuery));
  }, [normalizedSearchQuery, siblingDocuments]);

  const activeDocument = useMemo(
    () => (activeDocumentId ? sortedDocuments.find((document) => document.id === activeDocumentId) ?? null : null),
    [activeDocumentId, sortedDocuments],
  );
  const activePages = useMemo(() => sortByOrder(activeDocument?.pages ?? []), [activeDocument]);
  const activePage = useMemo(
    () => activePages.find((page) => page.id === activePageId) ?? activePages[0] ?? null,
    [activePageId, activePages],
  );
  const editableDocuments = notebookDocuments.length > 0 ? notebookDocuments : derivedLegacyDocuments;

  useEffect(() => {
    if (currentFolderId && !folderById.has(currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folderById]);

  useEffect(() => {
    if (!activeDocumentId) {
      if (activePageId !== null) {
        setActivePageId(null);
      }
      return;
    }

    if (!activeDocument) {
      if (activePageId !== null) {
        setActivePageId(null);
      }
      setIsExportMenuOpen(false);
      return;
    }

    if (activePages.length === 0) {
      if (activePageId !== null) {
        setActivePageId(null);
      }
      return;
    }

    if (!activePageId || !activePages.some((page) => page.id === activePageId)) {
      setActivePageId(activePages[0].id);
    }
  }, [activeDocument, activeDocumentId, activePageId, activePages]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (!tileActionMenuRef.current?.contains(event.target as Node)) {
        setTileActionMenu(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsExportMenuOpen(false);
        setTileActionMenu(null);
      }
    }

    if (isExportMenuOpen || tileActionMenu) {
      window.addEventListener("mousedown", handleOutsideClick);
      window.addEventListener("keydown", handleEscape);
      return () => {
        window.removeEventListener("mousedown", handleOutsideClick);
        window.removeEventListener("keydown", handleEscape);
      };
    }

    return undefined;
  }, [isExportMenuOpen, tileActionMenu]);

  function closeTileActionMenu() {
    setTileActionMenu(null);
  }

  function updateDocument(documentId: string, updater: (document: NotebookDocument) => NotebookDocument) {
    const nextDocuments = editableDocuments.map((document) => (document.id === documentId ? updater(document) : document));
    void setNotebookDocuments(nextDocuments);
  }

  async function ensureLegacyDocumentsMaterialized() {
    if (!isUsingLegacyDocuments) {
      return true;
    }

    const saved = await setNotebookDocuments(derivedLegacyDocuments);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to restore legacy notebook pages into the document library.",
      });
      return false;
    }

    return true;
  }

  async function openDocument(document: NotebookDocument) {
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return;
    }

    const firstPage = sortByOrder(document.pages)[0] ?? null;
    setActiveDocumentId(document.id);
    setActivePageId(firstPage?.id ?? null);
    setIsExportMenuOpen(false);
    closeTileActionMenu();
    setStatus(null);
  }

  function goBackToParentFolder() {
    if (!currentFolder) {
      return;
    }
    setCurrentFolderId(currentFolder.parentFolderId ?? null);
    setSearchQuery("");
    closeTileActionMenu();
    setStatus(null);
  }

  function goBackToLibrary() {
    setCurrentFolderId(activeDocument?.folderId ?? currentFolderId ?? null);
    setActiveDocumentId(null);
    setActivePageId(null);
    setIsExportMenuOpen(false);
    closeTileActionMenu();
    setStatus(null);
  }

  async function createFolder(name: string) {
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return false;
    }

    const now = nowIso();
    const nextFolder: NotebookFolder = {
      id: makeId("nb-folder"),
      name,
      parentFolderId: currentFolderId ?? undefined,
      favorited: false,
      order: siblingFolders.reduce((maxOrder, folder) => Math.max(maxOrder, folder.order), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await setNotebookFolders([...notebookFolders, nextFolder]);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to create this folder.",
      });
      return false;
    }

    setStatus(null);
    return true;
  }

  async function handleToggleFolderFavorite(folderId: string) {
    const nextFolders = notebookFolders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            favorited: folder.favorited !== true,
            updatedAt: nowIso(),
          }
        : folder,
    );
    const saved = await setNotebookFolders(nextFolders);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to update this folder.",
      });
      return false;
    }

    setStatus(null);
    return true;
  }

  async function createDocument(title: string) {
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return false;
    }

    const sourceDocuments = editableDocuments;
    const now = nowIso();
    const firstPage = createPage("Page 1", 0);
    const nextDocument: NotebookDocument = {
      id: makeId("nb-document"),
      title,
      folderId: currentFolderId ?? undefined,
      favorited: false,
      order: sourceDocuments
        .filter((document) => (document.folderId ?? null) === currentFolderId)
        .reduce((maxOrder, document) => Math.max(maxOrder, document.order), -1) + 1,
      pages: [firstPage],
      createdAt: now,
      updatedAt: now,
    };
    const saved = await setNotebookDocuments([...sourceDocuments, nextDocument]);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to create this document.",
      });
      return false;
    }

    setActiveDocumentId(nextDocument.id);
    setActivePageId(firstPage.id);
    setIsExportMenuOpen(false);
    setStatus(null);
    return true;
  }

  function handleRenameFolder(folder: NotebookFolder) {
    closeTileActionMenu();
    setStatus(null);
    setPromptState({
      kind: "rename-folder",
      folderId: folder.id,
      value: folder.name,
    });
  }

  function handleDeleteFolder(folder: NotebookFolder) {
    closeTileActionMenu();
    const hasChildFolders = notebookFolders.some((entry) => entry.parentFolderId === folder.id);
    const hasChildDocuments = sortedDocuments.some((entry) => entry.folderId === folder.id);
    if (hasChildFolders || hasChildDocuments) {
      setStatus({
        kind: "error",
        message: "Move or remove items before deleting this folder.",
      });
      return;
    }
    if (!window.confirm(`Delete folder "${folder.name}"?`)) {
      return;
    }
    void setNotebookFolders(notebookFolders.filter((entry) => entry.id !== folder.id));
    if (currentFolderId === folder.id) {
      setCurrentFolderId(folder.parentFolderId ?? null);
    }
    setStatus(null);
  }

  function handleRenameDocument(document: NotebookDocument) {
    closeTileActionMenu();
    setStatus(null);
    setPromptState({
      kind: "rename-document",
      documentId: document.id,
      value: document.title,
    });
  }

  async function handleToggleDocumentFavorite(documentId: string) {
    closeTileActionMenu();
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return;
    }

    updateDocument(documentId, (current) => ({
      ...current,
      favorited: current.favorited !== true,
      updatedAt: nowIso(),
    }));
    setStatus(null);
  }

  async function handleDeleteDocument(document: NotebookDocument) {
    closeTileActionMenu();
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return;
    }

    if (!window.confirm(`Delete document "${document.title}"?`)) {
      return;
    }
    void setNotebookDocuments(editableDocuments.filter((entry) => entry.id !== document.id));
    if (activeDocumentId === document.id) {
      setActiveDocumentId(null);
      setActivePageId(null);
      setIsExportMenuOpen(false);
    }
    setStatus(null);
  }

  function updateActiveDocumentTitle(title: string) {
    if (!activeDocument) {
      return;
    }
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      title,
      updatedAt: nowIso(),
    }));
  }

  function updateActiveDocumentFolder(folderId: string) {
    if (!activeDocument) {
      return;
    }
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      folderId: folderId || undefined,
      updatedAt: nowIso(),
    }));
  }

  function addPageToDocument(document: NotebookDocument) {
    const nextOrder = document.pages.reduce((maxOrder, page) => Math.max(maxOrder, page.order), -1) + 1;
    const nextPage = createPage(`Page ${nextOrder + 1}`, nextOrder);
    updateDocument(document.id, (current) => ({
      ...current,
      pages: [...current.pages, nextPage],
      updatedAt: nowIso(),
    }));
    setActivePageId(nextPage.id);
    setStatus(null);
  }

  function updateActivePage(updater: (page: NotebookPage) => NotebookPage) {
    if (!activeDocument || !activePage) {
      return;
    }
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      pages: current.pages.map((page) => (page.id === activePage.id ? updater(page) : page)),
      updatedAt: nowIso(),
    }));
  }

  function deleteActivePage() {
    if (!activeDocument || !activePage) {
      return;
    }
    if (!window.confirm(`Delete page "${activePage.title.trim() || "Page"}"?`)) {
      return;
    }

    if (activePages.length <= 1) {
      const replacement = createPage("Page 1", 0);
      updateDocument(activeDocument.id, (current) => ({
        ...current,
        pages: [replacement],
        updatedAt: nowIso(),
      }));
      setActivePageId(replacement.id);
      setStatus(null);
      return;
    }

    const remainingPages = activePages.filter((page) => page.id !== activePage.id);
    const nextPage = remainingPages[0] ?? null;
    updateDocument(activeDocument.id, (current) => ({
      ...current,
      pages: current.pages.filter((page) => page.id !== activePage.id),
      updatedAt: nowIso(),
    }));
    setActivePageId(nextPage?.id ?? null);
    setStatus(null);
  }

  async function exportActivePage(format: NotebookExportFormat) {
    setIsExportMenuOpen(false);

    if (!activeDocument || !activePage) {
      setStatus({ kind: "error", message: "Select a document page to export." });
      return;
    }

    try {
      const baseName = sanitizeFileNameSegment(`${activeDocument.title || "Untitled Document"}-${activePage.title || "Page 1"}`);
      const payload =
        format === "txt"
          ? {
              fileName: `${baseName}.txt`,
              content: createTxtExport(activeDocument, activePage),
              label: "TXT",
            }
          : format === "html"
            ? {
                fileName: `${baseName}.html`,
                content: createHtmlExport(activeDocument, activePage),
                label: "HTML",
              }
            : {
                fileName: `${baseName}.md`,
                content: createMarkdownExport(activeDocument, activePage),
                label: "Markdown",
              };

      const savedPath = await invoke<string>("export_notebook_page", {
        suggestedFileName: payload.fileName,
        contents: payload.content,
      });

      setStatus({
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
      setStatus({
        kind: "error",
        message,
      });
    }
  }

  async function renameFolder(folderId: string, name: string) {
    const nextFolders = notebookFolders.map((folder) =>
      folder.id === folderId
        ? {
            ...folder,
            name,
            updatedAt: nowIso(),
          }
        : folder,
    );
    const saved = await setNotebookFolders(nextFolders);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to rename this folder.",
      });
      return false;
    }

    setStatus(null);
    return true;
  }

  async function renameDocument(documentId: string, title: string) {
    if (!(await ensureLegacyDocumentsMaterialized())) {
      return false;
    }

    const nextDocuments = editableDocuments.map((document) =>
      document.id === documentId
        ? {
            ...document,
            title,
            updatedAt: nowIso(),
          }
        : document,
    );
    const saved = await setNotebookDocuments(nextDocuments);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to rename this document.",
      });
      return false;
    }

    setStatus(null);
    return true;
  }

  async function submitPrompt() {
    if (!promptState) {
      return;
    }

    if (promptState.kind === "create-folder") {
      const name = promptState.value.trim();
      if (!name) {
        setPromptState(null);
        return;
      }
      if (await createFolder(name)) {
        setPromptState(null);
      }
      return;
    }

    if (promptState.kind === "create-document") {
      const title = promptState.value.trim() || "Untitled Document";
      if (await createDocument(title)) {
        setPromptState(null);
      }
      return;
    }

    if (promptState.kind === "rename-folder") {
      const name = promptState.value.trim();
      if (!name) {
        setPromptState(null);
        return;
      }
      if (await renameFolder(promptState.folderId, name)) {
        setPromptState(null);
      }
      return;
    }

    const title = promptState.value.trim();
    if (!title) {
      setPromptState(null);
      return;
    }
    if (await renameDocument(promptState.documentId, title)) {
      setPromptState(null);
    }
  }

  const promptCopy =
    promptState?.kind === "create-folder"
      ? {
          title: "New Folder",
          description: currentFolder ? "Create a folder inside the current folder." : "",
          label: "Folder name",
          confirmLabel: "Create Folder",
          placeholder: "Folder name",
        }
      : promptState?.kind === "create-document"
        ? {
            title: "New Document",
            description: currentFolder
              ? "Create a document inside the current folder."
              : "Create a document in the notebook library.",
            label: "Document title",
            confirmLabel: "Create Document",
            placeholder: "Untitled Document",
          }
        : promptState?.kind === "rename-folder"
          ? {
              title: "Rename Folder",
              description: "Update this folder name.",
              label: "Folder name",
              confirmLabel: "Save Folder",
              placeholder: "Folder name",
            }
          : promptState?.kind === "rename-document"
            ? {
                title: "Rename Document",
                description: "Update this document title.",
                label: "Document title",
                confirmLabel: "Save Document",
                placeholder: "Document title",
              }
            : null;

  const isLibraryMode = activeDocumentId === null;
  const hasLibraryResults = visibleFolders.length > 0 || visibleDocuments.length > 0;
  const statusClass =
    status?.kind === "error"
      ? "border-rose-400/25 bg-rose-500/10 text-rose-100"
      : "border-cyan-300/25 bg-cyan-400/10 text-cyan-50";

  return (
    <>
      <div className="flex h-full flex-col gap-3 overflow-hidden px-4 pb-4 pt-1">
      <section className="glass-panel flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
        {isLibraryMode ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">Library</span>
                  {currentFolder ? (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{currentFolder.name.trim() || "Untitled Folder"}</span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                {currentFolder ? (
                  <button
                    type="button"
                    onClick={goBackToParentFolder}
                    className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                  >
                    Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setPromptState({
                      kind: "create-folder",
                      value: "",
                    });
                  }}
                  className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  New Folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setPromptState({
                      kind: "create-document",
                      value: "Untitled Document",
                    });
                  }}
                  className="inline-flex h-10 items-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/20"
                >
                  New Document
                </button>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={currentFolder ? "Search this folder" : "Search library"}
                  className="h-10 w-[15rem] rounded-xl border border-white/10 bg-slate-950/40 px-3 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                />
              </div>
            </div>

            {status ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${statusClass}`}>{status.message}</div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-subtle">
              {hasLibraryResults ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7 pb-2">
                  {visibleFolders.map((folder) => (
                    <div
                      key={folder.id}
                      ref={tileActionMenu?.kind === "folder" && tileActionMenu.folderId === folder.id ? tileActionMenuRef : null}
                      className="group relative overflow-visible"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentFolderId(folder.id);
                          setSearchQuery("");
                          setStatus(null);
                        }}
                        className="relative z-0 flex w-full flex-col items-center gap-3 rounded-[28px] border border-transparent px-3 py-4 text-center transition hover:border-white/10 hover:bg-white/[0.04]"
                      >
                        <div className="relative h-20 w-24">
                          <div className="absolute left-3 top-2 h-4 w-11 rounded-t-2xl bg-amber-200/85" />
                          <div className="absolute inset-x-0 bottom-0 top-5 rounded-[22px] border border-amber-100/10 bg-gradient-to-br from-amber-200/95 via-amber-300/85 to-orange-300/70 shadow-[0_18px_40px_rgba(251,191,36,0.16)]" />
                        </div>
                        <div className="flex w-full min-w-0 items-center justify-center gap-1">
                          <span className="min-w-0 truncate text-sm font-medium text-slate-100">
                            {folder.name.trim() || "Untitled Folder"}
                          </span>
                          {folder.favorited === true ? (
                            <span aria-hidden="true" className="shrink-0 text-[0.7rem] leading-none text-rose-400">
                              ★
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Folder actions for ${folder.name.trim() || "Untitled Folder"}`}
                        aria-haspopup="menu"
                        aria-expanded={tileActionMenu?.kind === "folder" && tileActionMenu.folderId === folder.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTileActionMenu((current) =>
                            current?.kind === "folder" && current.folderId === folder.id ? null : { kind: "folder", folderId: folder.id },
                          );
                        }}
                        className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-none border-0 bg-transparent p-0 text-base leading-none text-slate-300 opacity-80 shadow-none transition hover:text-slate-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                      >
                        ⋯
                      </button>
                      {tileActionMenu?.kind === "folder" && tileActionMenu.folderId === folder.id ? (
                        <div
                          className="absolute right-2 top-12 z-20 w-40 rounded-2xl border border-white/10 bg-slate-950/95 p-1 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleRenameFolder(folder);
                            }}
                            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              void handleToggleFolderFavorite(folder.id);
                            }}
                            className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${
                              folder.favorited === true ? "text-rose-100 hover:bg-rose-500/10" : "text-slate-100 hover:bg-white/10"
                            }`}
                          >
                            {folder.favorited === true ? "Unfavorite" : "Favorite"}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleDeleteFolder(folder);
                            }}
                            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-rose-100 transition hover:bg-rose-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}

                  {visibleDocuments.map((document) => (
                    <div
                      key={document.id}
                      ref={tileActionMenu?.kind === "document" && tileActionMenu.documentId === document.id ? tileActionMenuRef : null}
                      className="group relative overflow-visible"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          void openDocument(document);
                        }}
                        className="relative z-0 flex w-full flex-col items-center gap-3 rounded-[28px] border border-transparent px-3 py-4 text-center transition hover:border-white/10 hover:bg-white/[0.04]"
                      >
                        <div className="relative flex h-20 w-20 items-center justify-center rounded-[24px] border border-white/10 bg-gradient-to-br from-slate-100/95 via-slate-200/90 to-slate-300/75 shadow-[0_18px_40px_rgba(148,163,184,0.16)]">
                          <div className="space-y-2">
                            <div className="h-[2px] w-8 rounded-full bg-slate-600/70" />
                            <div className="h-[2px] w-8 rounded-full bg-slate-600/45" />
                            <div className="h-[2px] w-6 rounded-full bg-slate-600/30" />
                          </div>
                        </div>
                        <div className="flex w-full min-w-0 items-center justify-center gap-1">
                          <span className="min-w-0 truncate text-sm font-medium text-slate-100">
                            {document.title.trim() || "Untitled Document"}
                          </span>
                          {document.favorited === true ? (
                            <span aria-hidden="true" className="shrink-0 text-[0.7rem] leading-none text-rose-400">
                              ★
                            </span>
                          ) : null}
                        </div>
                      </button>
                      <button
                        type="button"
                        aria-label={`Document actions for ${document.title.trim() || "Untitled Document"}`}
                        aria-haspopup="menu"
                        aria-expanded={tileActionMenu?.kind === "document" && tileActionMenu.documentId === document.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTileActionMenu((current) =>
                            current?.kind === "document" && current.documentId === document.id
                              ? null
                              : { kind: "document", documentId: document.id },
                          );
                        }}
                        className="absolute right-2 top-2 z-10 inline-flex h-6 w-6 items-center justify-center rounded-none border-0 bg-transparent p-0 text-base leading-none text-slate-300 opacity-80 shadow-none transition hover:text-slate-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                      >
                        ⋯
                      </button>
                      {tileActionMenu?.kind === "document" && tileActionMenu.documentId === document.id ? (
                        <div
                          className="absolute right-2 top-12 z-20 w-40 rounded-2xl border border-white/10 bg-slate-950/95 p-1 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleRenameDocument(document);
                            }}
                            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-slate-100 transition hover:bg-white/10"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              void handleToggleDocumentFavorite(document.id);
                            }}
                            className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${
                              document.favorited ? "text-rose-100 hover:bg-rose-500/10" : "text-slate-100 hover:bg-white/10"
                            }`}
                          >
                            {document.favorited ? "Unfavorite" : "Favorite"}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleDeleteDocument(document);
                            }}
                            className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-rose-100 transition hover:bg-rose-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-slate-950/20 px-6 text-center">
                  <p className="text-base font-medium text-slate-100">
                    {normalizedSearchQuery ? "No folders or documents match this search." : "This folder is empty."}
                  </p>
                  <p className="mt-2 max-w-md text-sm text-slate-300">
                    {normalizedSearchQuery
                      ? "Search only checks the current folder. Clear the query or open a different folder."
                      : "Create a folder or document to start building your notebook library."}
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={goBackToLibrary}
                  className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  Back to Library
                </button>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-300">
                  {activeDocument?.folderId ? folderById.get(activeDocument.folderId)?.name ?? "Library" : "Library"}
                </span>
                </div>
              {status ? (
                <div className={`rounded-2xl border px-4 py-3 text-sm ${statusClass}`}>{status.message}</div>
              ) : null}
            </div>

            {activeDocument ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_auto_auto_auto_auto]">
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Document title</span>
                    <input
                      type="text"
                      value={activeDocument.title}
                      onChange={(event) => updateActiveDocumentTitle(event.target.value)}
                      placeholder="Untitled Document"
                      className="h-11 rounded-xl border border-white/10 bg-slate-950/45 px-4 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                    />
                  </label>
                  <label className="flex min-w-[11rem] flex-col gap-1">
                    <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Folder</span>
                    <select
                      value={activeDocument.folderId ?? ""}
                      onChange={(event) => updateActiveDocumentFolder(event.target.value)}
                      className="h-11 rounded-xl border border-white/10 bg-slate-950/45 px-4 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                    >
                      <option value="">Library</option>
                      {folderOptions.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleToggleDocumentFavorite(activeDocument.id)}
                    className={`mt-auto inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm transition ${
                      activeDocument.favorited
                        ? "border-amber-300/35 bg-amber-400/15 text-amber-50 hover:bg-amber-400/25"
                        : "border-white/10 bg-white/[0.03] text-slate-100 hover:border-amber-300/30 hover:bg-amber-300/10"
                    }`}
                  >
                    {activeDocument.favorited ? "Favorited" : "Favorite"}
                  </button>
                  <div ref={exportMenuRef} className="relative mt-auto">
                    <button
                      type="button"
                      onClick={() => {
                        setStatus(null);
                        setIsExportMenuOpen((current) => !current);
                      }}
                      className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                    >
                      Export
                    </button>
                    {isExportMenuOpen ? (
                      <div className="absolute right-0 z-20 mt-2 flex w-36 flex-col gap-1 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-lg backdrop-blur">
                        <button
                          type="button"
                          onClick={() => {
                            void exportActivePage("txt");
                          }}
                          className="rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                        >
                          TXT
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void exportActivePage("html");
                          }}
                          className="rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                        >
                          HTML
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void exportActivePage("markdown");
                          }}
                          className="rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/10"
                        >
                          Markdown
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteDocument(activeDocument)}
                    className="mt-auto inline-flex h-11 items-center justify-center rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 text-sm text-rose-100 transition hover:bg-rose-400/20"
                  >
                    Delete Document
                  </button>
                </div>

                {activePages.length > 0 ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 scrollbar-subtle">
                        {activePages.map((page) => {
                          const isActive = page.id === activePage?.id;
                          return (
                            <button
                              key={page.id}
                              type="button"
                              onClick={() => setActivePageId(page.id)}
                              className={`shrink-0 rounded-xl border px-4 py-2 text-sm transition ${
                                isActive
                                  ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-50"
                                  : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/20 hover:bg-white/[0.06]"
                              }`}
                            >
                              {page.title.trim() || "Untitled Page"}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => addPageToDocument(activeDocument)}
                        className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
                      >
                        Add Page
                      </button>
                    </div>

                    {activePage ? (
                      <>
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
                            <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Page title</span>
                            <input
                              type="text"
                              value={activePage.title}
                              onChange={(event) =>
                                updateActivePage((page) => ({
                                  ...page,
                                  title: event.target.value,
                                  updatedAt: nowIso(),
                                }))
                              }
                              placeholder="Page title"
                              className="h-11 rounded-xl border border-white/10 bg-slate-950/45 px-4 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={deleteActivePage}
                            className="inline-flex h-11 items-center rounded-xl border border-rose-300/30 bg-rose-400/10 px-4 text-sm text-rose-100 transition hover:bg-rose-400/20"
                          >
                            Delete Page
                          </button>
                        </div>

                        <RichTextEditor
                          value={activePage.contentHtml}
                          onChange={(html) =>
                            updateActivePage((page) => ({
                              ...page,
                              contentHtml: html,
                              updatedAt: nowIso(),
                            }))
                          }
                          placeholder="Write inside this document. Each page stays nested under the current document."
                          className="min-h-[320px] flex-1 overflow-y-auto scrollbar-subtle"
                        />
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="flex flex-1 flex-col items-start justify-center rounded-[28px] border border-dashed border-white/10 bg-slate-950/20 p-6">
                    <p className="text-base font-medium text-slate-100">This document has no pages.</p>
                    <p className="mt-2 max-w-md text-sm text-slate-300">Existing data stays untouched until you explicitly create a new page.</p>
                    <button
                      type="button"
                      onClick={() => addPageToDocument(activeDocument)}
                      className="mt-4 inline-flex h-10 items-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/20"
                    >
                      Create First Page
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-slate-950/20 text-sm text-slate-300">
                This document is no longer available.
              </div>
            )}
          </>
        )}
      </section>
      </div>

      {promptState && promptCopy ? (
        <ModalShell
          onClose={() => setPromptState(null)}
          position="center"
          titleId="notebook-library-prompt-title"
          descriptionId="notebook-library-prompt-description"
          initialFocusRef={promptInputRef}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="notebook-library-prompt-title" className="mt-2 text-2xl font-semibold text-white">
                {promptCopy.title}
              </h3>
              {promptCopy.description ? (
                <p id="notebook-library-prompt-description" className="mt-2 text-sm text-slate-400">
                  {promptCopy.description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setPromptState(null)}
              className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
            >
              Cancel
            </button>
          </div>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submitPrompt();
            }}
          >
            <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-[0.16em] text-slate-500">{promptCopy.label}</span>
              <input
                ref={promptInputRef}
                type="text"
                value={promptState.value}
                onChange={(event) => setPromptState((current) => (current ? { ...current, value: event.target.value } : current))}
                placeholder={promptCopy.placeholder}
                className="h-11 rounded-xl border border-white/10 bg-slate-950/45 px-4 text-sm text-white outline-none transition focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPromptState(null)}
                className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex h-10 items-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/20"
              >
                {promptCopy.confirmLabel}
              </button>
            </div>
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}
