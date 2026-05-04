import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ModalShell } from "../components/modal-shell";
import { NotebookEditorAdapter } from "../components/notebook-editor-adapter";
import { richTextToPlain } from "../components/rich-text-editor";
import { embedNotebookImagesInHtml } from "../lib/notebook-images";
import { useAppStore } from "../state/app-store";
import type { NotebookDocument, NotebookFolder, NotebookPage } from "../types/models";

type NotebookExportFormat = "txt" | "html" | "markdown";
type NotebookSaveStatus = "idle" | "saving" | "saved" | "error";
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
  const { state, setNotebookFolders, setNotebookDocuments: saveNotebookDocuments } = useAppStore();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [status, setStatus] = useState<ActionStatus>(null);
  const [saveStatus, setSaveStatus] = useState<NotebookSaveStatus>("idle");
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [tileActionMenu, setTileActionMenu] = useState<TileActionMenuState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const tileActionMenuRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const pendingDocumentsRef = useRef<NotebookDocument[] | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRevisionRef = useRef(0);
  const lastNotebookSaveResultRef = useRef<"idle" | "saved" | "error">("idle");
  const isMountedRef = useRef(true);

  const notebookFolders = state.preferences.notebookFolders;
  const persistedNotebookDocuments = state.preferences.notebookDocuments;
  const notebookPages = state.preferences.notebookPages;
  const derivedLegacyDocuments = useMemo(
    () => (persistedNotebookDocuments.length === 0 ? deriveLegacyDocuments(notebookPages) : []),
    [persistedNotebookDocuments, notebookPages],
  );
  const isUsingLegacyDocuments = persistedNotebookDocuments.length === 0 && derivedLegacyDocuments.length > 0;
  const [isLegacyFallbackActive, setIsLegacyFallbackActive] = useState(isUsingLegacyDocuments);
  const isLegacyFallbackActiveRef = useRef(isUsingLegacyDocuments);
  const [notebookDocuments, setNotebookDocuments] = useState<NotebookDocument[]>(
    () => (isUsingLegacyDocuments ? derivedLegacyDocuments : persistedNotebookDocuments),
  );
  const displayDocuments = notebookDocuments;

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void flushPendingNotebookSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingDocumentsRef.current !== null) {
      return;
    }

    const nextDocuments = isLegacyFallbackActive
      ? persistedNotebookDocuments.length > 0
        ? persistedNotebookDocuments
        : derivedLegacyDocuments
      : persistedNotebookDocuments;
    setNotebookDocuments(nextDocuments);
  }, [derivedLegacyDocuments, isLegacyFallbackActive, persistedNotebookDocuments]);

  function setSaveIndicator(next: NotebookSaveStatus) {
    if (isMountedRef.current) {
      setSaveStatus(next);
    }
  }

  function setLegacyFallbackActive(next: boolean) {
    isLegacyFallbackActiveRef.current = next;
    if (isMountedRef.current) {
      setIsLegacyFallbackActive(next);
    }
  }

  function scheduleNotebookDocumentsSave(nextDocuments: NotebookDocument[]) {
    pendingDocumentsRef.current = nextDocuments;
    lastNotebookSaveResultRef.current = "idle";
    saveRevisionRef.current += 1;
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
    }
    setSaveIndicator("saving");
    const revision = saveRevisionRef.current;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushPendingNotebookSave(revision);
    }, 500);
  }

  async function flushPendingNotebookSave(expectedRevision = saveRevisionRef.current): Promise<void> {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const docs = pendingDocumentsRef.current;
    if (!docs) {
      return;
    }

    setSaveIndicator("saving");
    try {
      const saved = await saveNotebookDocuments(docs);
      if (expectedRevision !== saveRevisionRef.current) {
        return;
      }
      lastNotebookSaveResultRef.current = saved ? "saved" : "error";
      if (saved) {
        pendingDocumentsRef.current = null;
        if (isLegacyFallbackActiveRef.current) {
          setLegacyFallbackActive(false);
        }
        setSaveIndicator("saved");
      } else {
        setSaveIndicator("error");
      }
    } catch {
      if (expectedRevision !== saveRevisionRef.current) {
        return;
      }
      lastNotebookSaveResultRef.current = "error";
      setSaveIndicator("error");
    }
  }

  function replaceNotebookDocuments(nextDocuments: NotebookDocument[]) {
    setNotebookDocuments(nextDocuments);
    scheduleNotebookDocumentsSave(nextDocuments);
  }

  async function persistNotebookDocuments(nextDocuments: NotebookDocument[]) {
    replaceNotebookDocuments(nextDocuments);
    await flushPendingNotebookSave();
    return lastNotebookSaveResultRef.current !== "error";
  }

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
    const nextDocuments = notebookDocuments.map((document) => (document.id === documentId ? updater(document) : document));
    replaceNotebookDocuments(nextDocuments);
  }

  async function ensureLegacyDocumentsMaterialized() {
    if (!isLegacyFallbackActiveRef.current) {
      return true;
    }

    const saved = await persistNotebookDocuments(notebookDocuments);
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
    await flushPendingNotebookSave();
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

  async function goBackToLibrary() {
    await flushPendingNotebookSave();
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

    await flushPendingNotebookSave();
    const sourceDocuments = notebookDocuments;
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
    const saved = await persistNotebookDocuments([...sourceDocuments, nextDocument]);
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

    await flushPendingNotebookSave();
    const nextDocuments = notebookDocuments.map((document) =>
      document.id === documentId
        ? {
            ...document,
            favorited: document.favorited !== true,
            updatedAt: nowIso(),
          }
        : document,
    );
    const saved = await persistNotebookDocuments(nextDocuments);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to update this document.",
      });
      return;
    }
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
    await flushPendingNotebookSave();
    const nextDocuments = notebookDocuments.filter((entry) => entry.id !== document.id);
    await persistNotebookDocuments(nextDocuments);
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
    void (async () => {
      await flushPendingNotebookSave();
      const nextDocuments = notebookDocuments.map((document) =>
        document.id === activeDocument.id
          ? {
              ...document,
              folderId: folderId || undefined,
              updatedAt: nowIso(),
            }
          : document,
      );
      const saved = await persistNotebookDocuments(nextDocuments);
      if (!saved) {
        setStatus({
          kind: "error",
          message: "Unable to update this document.",
        });
      } else {
        setStatus(null);
      }
    })();
  }

  async function addPageToDocument(document: NotebookDocument) {
    await flushPendingNotebookSave();
    const nextOrder = document.pages.reduce((maxOrder, page) => Math.max(maxOrder, page.order), -1) + 1;
    const nextPage = createPage(`Page ${nextOrder + 1}`, nextOrder);
    const nextDocuments = notebookDocuments.map((current) =>
      current.id === document.id
        ? {
            ...current,
            pages: [...current.pages, nextPage],
            updatedAt: nowIso(),
          }
        : current,
    );
    const saved = await persistNotebookDocuments(nextDocuments);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to add a page to this document.",
      });
      return;
    }
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

  async function deleteActivePage() {
    if (!activeDocument || !activePage) {
      return;
    }
    if (!window.confirm(`Delete page "${activePage.title.trim() || "Page"}"?`)) {
      return;
    }

    await flushPendingNotebookSave();
    if (activePages.length <= 1) {
      const replacement = createPage("Page 1", 0);
      const nextDocuments = notebookDocuments.map((current) =>
        current.id === activeDocument.id
          ? {
              ...current,
              pages: [replacement],
              updatedAt: nowIso(),
            }
          : current,
      );
      const saved = await persistNotebookDocuments(nextDocuments);
      if (!saved) {
        setStatus({
          kind: "error",
          message: "Unable to delete this page.",
        });
        return;
      }
      setActivePageId(replacement.id);
      setStatus(null);
      return;
    }

    const remainingPages = activePages.filter((page) => page.id !== activePage.id);
    const nextPage = remainingPages[0] ?? null;
    const nextDocuments = notebookDocuments.map((current) =>
      current.id === activeDocument.id
        ? {
            ...current,
            pages: current.pages.filter((page) => page.id !== activePage.id),
            updatedAt: nowIso(),
          }
        : current,
    );
    const saved = await persistNotebookDocuments(nextDocuments);
    if (!saved) {
      setStatus({
        kind: "error",
        message: "Unable to delete this page.",
      });
      return;
    }
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

      let fileName: string;
      let content: string;
      let label: string;
      let missingImages: string[] = [];

      if (format === "txt") {
        fileName = `${baseName}.txt`;
        content = createTxtExport(activeDocument, activePage);
        label = "TXT";
      } else if (format === "html") {
        fileName = `${baseName}.html`;
        const embedded = await embedNotebookImagesInHtml(createHtmlExport(activeDocument, activePage));
        content = embedded.html;
        missingImages = embedded.missingImages;
        label = "HTML";
      } else {
        fileName = `${baseName}.md`;
        content = createMarkdownExport(activeDocument, activePage);
        label = "Markdown";
      }

      const savedPath = await invoke<string>("export_notebook_page", {
        suggestedFileName: fileName,
        contents: content,
      });

      setStatus({
        kind: "success",
        message:
          missingImages.length > 0
            ? `${label} export saved to ${savedPath}. ${missingImages.length} local image(s) could not be embedded.`
            : `${label} export saved to ${savedPath}.`,
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

    await flushPendingNotebookSave();
    const nextDocuments = notebookDocuments.map((document) =>
      document.id === documentId
        ? {
            ...document,
            title,
            updatedAt: nowIso(),
        }
        : document,
    );
    const saved = await persistNotebookDocuments(nextDocuments);
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
          label: "Folder name",
          confirmLabel: "Create Folder",
          placeholder: "Folder name",
        }
      : promptState?.kind === "create-document"
        ? {
            title: "New Document",
            label: "Document title",
            confirmLabel: "Create Document",
            placeholder: "Untitled Document",
          }
        : promptState?.kind === "rename-folder"
          ? {
              title: "Rename Folder",
              label: "Folder name",
              confirmLabel: "Save Folder",
              placeholder: "Folder name",
            }
          : promptState?.kind === "rename-document"
            ? {
                title: "Rename Document",
                label: "Document title",
                confirmLabel: "Save Document",
                placeholder: "Document title",
              }
            : null;

  const isLibraryMode = activeDocumentId === null;
  const hasLibraryResults = visibleFolders.length > 0 || visibleDocuments.length > 0;
  const saveIndicatorClass =
    saveStatus === "error"
      ? "border-rose-400/20 bg-rose-500/8 text-rose-100"
      : saveStatus === "saved"
        ? "border-emerald-300/20 bg-emerald-400/8 text-emerald-50"
        : "border-cyan-300/20 bg-cyan-400/8 text-cyan-50";
  const saveIndicatorLabel =
    saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : saveStatus === "error" ? "Save failed" : null;
  const statusClass =
    status?.kind === "error"
      ? "border-rose-400/20 bg-rose-500/8 text-rose-100"
      : "border-cyan-300/20 bg-cyan-400/8 text-cyan-50";
  const compactStatusClass = "inline-flex max-w-full rounded-lg border px-2.5 py-1 text-xs font-medium leading-4";
  const toolbarButtonClass =
    "inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]";
  const libraryToolbarButtonClass =
    "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm text-slate-200 transition hover:border-white/15 hover:bg-white/[0.05]";
  const libraryToolbarPrimaryButtonClass =
    "inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/20";
  const libraryToolbarSearchClass =
    "h-9 min-w-[18rem] flex-1 rounded-xl border border-white/10 bg-slate-950/35 px-4 text-sm text-white outline-none transition focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-400/25";
  const libraryBreadcrumbPillClass =
    "inline-flex h-8 items-center rounded-full border border-white/10 bg-white/[0.025] px-3 text-xs font-medium text-slate-200";
  const libraryBreadcrumbCurrentClass =
    "inline-flex h-8 max-w-[14rem] items-center rounded-full border border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-slate-100";
  const libraryGridClass = "grid grid-cols-[repeat(auto-fill,minmax(156px,176px))] justify-start gap-6 pb-2 pt-2";
  const libraryTileButtonClass =
    "relative z-0 flex w-full flex-col items-center gap-2 rounded-[20px] border border-transparent bg-transparent px-2.5 py-2.5 text-center shadow-none transition duration-200 ease-out hover:border-white/10 hover:bg-white/[0.025] hover:shadow-[0_8px_20px_rgba(15,23,42,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/25";
  const libraryFolderIconClass = "relative h-16 w-20";
  const libraryDocumentIconClass =
    "relative flex h-16 w-16 items-center justify-center rounded-[18px] border border-slate-200/35 bg-gradient-to-br from-slate-100/92 via-slate-200/86 to-slate-300/72 shadow-[0_10px_24px_rgba(148,163,184,0.1)]";
  const libraryEmptyStateClass =
    "max-w-[20rem] rounded-[20px] border border-dashed border-white/10 bg-slate-950/18 px-5 py-6 text-left";
  const editorFieldClass =
    "h-9 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/35 focus:ring-2 focus:ring-cyan-400/25";
  const editorTitleFieldClass = `${editorFieldClass} min-w-0 truncate font-semibold tracking-[-0.02em]`;
  const editorActionButtonClass =
    "inline-flex h-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06]";
  const editorDangerButtonClass =
    "inline-flex h-9 items-center justify-center rounded-xl border border-rose-300/18 bg-rose-400/6 px-3.5 text-sm text-rose-100 transition hover:border-rose-300/30 hover:bg-rose-400/12";
  const modalActionButtonClass =
    "inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-slate-100 transition hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 focus-visible:ring-offset-0";
  const modalPrimaryActionButtonClass =
    "inline-flex h-10 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 px-4 text-sm font-medium text-cyan-50 transition hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 focus-visible:ring-offset-0";
  const compactMenuClass =
    "absolute right-0 top-1.5 z-20 w-36 origin-bottom-right -translate-y-[calc(100%+0.5rem)] rounded-2xl border border-white/10 bg-slate-950/96 p-1.5 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur";
  const compactMenuItemClass =
    "flex min-h-8 w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm font-medium leading-5 text-slate-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 focus-visible:ring-offset-0";
  const compactMenuDangerItemClass =
    "flex min-h-8 w-full items-center rounded-lg px-2.5 py-1.5 text-left text-sm font-medium leading-5 text-rose-100 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30 focus-visible:ring-offset-0";
  const editorTabStripClass =
    "flex min-w-0 items-center gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.02] p-0.5 scrollbar-subtle";
  const editorTabButtonClass =
    "inline-flex h-8 max-w-[12rem] shrink-0 items-center overflow-hidden rounded-lg border px-3 text-sm font-medium transition whitespace-nowrap text-ellipsis";
  const emptyStateMessage = normalizedSearchQuery
    ? `No results for "${searchQuery.trim()}".`
    : currentFolder
      ? "This folder is empty."
      : "No documents yet.";

  return (
    <>
      <div className="flex h-full flex-col gap-2 overflow-hidden px-3 pb-3 pt-1.5">
        <section className="glass-panel flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3.5">
          {isLibraryMode ? (
            <div className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col gap-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                  {currentFolder ? (
                    <button type="button" onClick={goBackToParentFolder} className={libraryToolbarButtonClass}>
                      Back
                    </button>
                  ) : null}
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={libraryBreadcrumbPillClass}>
                      Library
                    </span>
                    {currentFolder ? (
                      <>
                        <span aria-hidden="true" className="text-[10px] text-slate-500">
                          &gt;
                        </span>
                        <span className={libraryBreadcrumbCurrentClass}>
                          <span className="truncate">{currentFolder.name.trim() || "Untitled Folder"}</span>
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-w-0 flex-nowrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStatus(null);
                      setPromptState({
                        kind: "create-folder",
                        value: "",
                      });
                    }}
                    className={libraryToolbarButtonClass}
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
                    className={libraryToolbarPrimaryButtonClass}
                  >
                    New Document
                  </button>
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={currentFolder ? "Search this folder" : "Search library"}
                    className={libraryToolbarSearchClass}
                  />
                </div>
              </div>

              {status ? <div className={`${compactStatusClass} ${statusClass}`}>{status.message}</div> : null}

              <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-subtle">
                {hasLibraryResults ? (
                  <div className={libraryGridClass}>
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
                        className={libraryTileButtonClass}
                      >
                        <div className={libraryFolderIconClass}>
                          <div className="absolute left-3 top-2 h-3.5 w-9 rounded-t-2xl bg-gradient-to-r from-amber-100/90 to-amber-200/75" />
                          <div className="absolute inset-x-0 bottom-0 top-[18px] rounded-[20px] border border-amber-50/10 bg-gradient-to-br from-amber-100/90 via-amber-200/78 to-amber-300/58 shadow-[0_14px_30px_rgba(180,128,16,0.14)]" />
                        </div>
                        <div className="flex w-full min-w-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap">
                          <span className="min-w-0 truncate text-[13px] font-medium leading-5 tracking-[0.01em] text-slate-100">
                            {folder.name.trim() || "Untitled Folder"}
                          </span>
                          {folder.favorited === true ? (
                            <span aria-hidden="true" className="shrink-0 translate-y-[-0.5px] text-[0.7rem] leading-none text-rose-400">
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
                        className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-slate-950/35 p-0 text-base leading-none text-slate-400 opacity-80 shadow-none transition hover:bg-white/[0.08] hover:text-slate-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                      >
                        ⋯
                      </button>
                      {tileActionMenu?.kind === "folder" && tileActionMenu.folderId === folder.id ? (
                        <div
                          className={compactMenuClass}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleRenameFolder(folder);
                            }}
                            className={compactMenuItemClass}
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
                            className={`${compactMenuItemClass} ${
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
                            className={`${compactMenuDangerItemClass} hover:bg-rose-500/10`}
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
                        className={libraryTileButtonClass}
                      >
                        <div className={libraryDocumentIconClass}>
                          <div className="space-y-1.5">
                            <div className="h-[1.5px] w-7 rounded-full bg-slate-600/68" />
                            <div className="h-[1.5px] w-7 rounded-full bg-slate-600/42" />
                            <div className="h-[1.5px] w-5 rounded-full bg-slate-600/28" />
                          </div>
                        </div>
                        <div className="flex w-full min-w-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap">
                          <span className="min-w-0 truncate text-[13px] font-medium leading-5 tracking-[0.01em] text-slate-100">
                            {document.title.trim() || "Untitled Document"}
                          </span>
                          {document.favorited === true ? (
                            <span aria-hidden="true" className="shrink-0 translate-y-[-0.5px] text-[0.7rem] leading-none text-rose-400">
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
                        className="absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-transparent bg-slate-950/35 p-0 text-base leading-none text-slate-400 opacity-80 shadow-none transition hover:bg-white/[0.08] hover:text-slate-100 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/30"
                      >
                        ⋯
                      </button>
                      {tileActionMenu?.kind === "document" && tileActionMenu.documentId === document.id ? (
                        <div
                          className={compactMenuClass}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTileActionMenu();
                              handleRenameDocument(document);
                            }}
                            className={compactMenuItemClass}
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
                            className={`${compactMenuItemClass} ${
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
                            className={`${compactMenuDangerItemClass} hover:bg-rose-500/10`}
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  </div>
                ) : (
                  <div className="flex min-h-[9rem] items-start justify-start px-1 py-2">
                    <div className={libraryEmptyStateClass}>
                      <p className="text-sm font-medium leading-6 text-slate-100">{emptyStateMessage}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {activeDocument ? (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                  <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
                    <button type="button" onClick={() => void goBackToLibrary()} className={toolbarButtonClass}>
                      Back to Library
                    </button>
                    <label className="min-w-0 flex-[2]">
                      <span className="sr-only">Document title</span>
                      <input
                        type="text"
                        value={activeDocument.title}
                        onChange={(event) => updateActiveDocumentTitle(event.target.value)}
                        placeholder="Untitled Document"
                        className={editorTitleFieldClass}
                      />
                    </label>
                    <label className="min-w-[11rem] flex-[0.95]">
                      <span className="sr-only">Folder</span>
                      <select
                        value={activeDocument.folderId ?? ""}
                        onChange={(event) => updateActiveDocumentFolder(event.target.value)}
                        className={editorFieldClass}
                      >
                        <option value="">Library</option>
                        {folderOptions.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleDocumentFavorite(activeDocument.id)}
                        className={`${editorActionButtonClass} ${activeDocument.favorited ? "border-amber-300/30 bg-amber-400/12 text-amber-50 hover:bg-amber-400/22" : ""}`}
                      >
                        {activeDocument.favorited ? "Favorited" : "Favorite"}
                      </button>
                      <div ref={exportMenuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setStatus(null);
                            setIsExportMenuOpen((current) => !current);
                          }}
                          className={editorActionButtonClass}
                        >
                          Export
                        </button>
                        {isExportMenuOpen ? (
                          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 flex w-36 flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/96 p-1.5 shadow-[0_18px_40px_rgba(2,6,23,0.45)] backdrop-blur">
                            <button
                              type="button"
                              onClick={() => {
                                void exportActivePage("txt");
                              }}
                              className={compactMenuItemClass}
                            >
                              TXT
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void exportActivePage("html");
                              }}
                              className={compactMenuItemClass}
                            >
                              HTML
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void exportActivePage("markdown");
                              }}
                              className={compactMenuItemClass}
                            >
                              Markdown
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button type="button" onClick={() => void handleDeleteDocument(activeDocument)} className={editorDangerButtonClass}>
                        Delete Document
                      </button>
                    </div>
                    {saveIndicatorLabel ? (
                      <div className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium leading-none ${saveIndicatorClass}`}>
                        {saveIndicatorLabel}
                      </div>
                    ) : null}
                  </div>

                  {status ? <div className={`self-start ${compactStatusClass} ${statusClass}`}>{status.message}</div> : null}

                  {activePages.length > 0 ? (
                    <>
                      <div className={editorTabStripClass}>
                        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-subtle">
                          {activePages.map((page) => {
                            const isActive = page.id === activePage?.id;
                            return (
                              <button
                                key={page.id}
                                type="button"
                                onClick={() => setActivePageId(page.id)}
                                className={`${editorTabButtonClass} ${
                                  isActive
                                    ? "border-cyan-300/25 bg-cyan-400/12 text-cyan-50 shadow-[0_1px_0_rgba(255,255,255,0.04)]"
                                    : "border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.05] hover:text-slate-200"
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
                          className={`${editorTabButtonClass} border-dashed border-white/12 bg-transparent px-3.5 text-slate-300 hover:border-white/18 hover:bg-white/[0.04] hover:text-slate-100`}
                        >
                          Add Page
                        </button>
                      </div>

                      {activePage ? (
                        <div className="flex min-h-0 flex-1 flex-col gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap">
                            <label className="min-w-0 flex-1">
                              <span className="sr-only">Page title</span>
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
                                className={editorTitleFieldClass}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void deleteActivePage()}
                              className="ml-auto inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-transparent bg-transparent px-2 text-xs font-medium text-rose-300 transition hover:border-rose-300/15 hover:bg-rose-400/8 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/20 focus-visible:ring-offset-0"
                            >
                              Delete Page
                            </button>
                          </div>

                          <div className="flex min-h-0 flex-1">
                            <NotebookEditorAdapter
                              value={activePage.contentHtml}
                              onChange={(html) =>
                                updateActivePage((page) => ({
                                  ...page,
                                  contentHtml: html,
                                  updatedAt: nowIso(),
                                }))
                              }
                              editorKey={activePage.id}
                              placeholder="Write inside this document. Each page stays nested under the current document."
                              className="min-h-0 flex-1 overflow-y-auto scrollbar-subtle"
                            />
                          </div>
                        </div>
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
          initialFocusRef={promptInputRef}
          contentClassName="max-w-[460px] p-5 sm:p-6"
        >
          <div className="space-y-1">
            <h3 id="notebook-library-prompt-title" className="text-xl font-semibold tracking-[-0.02em] text-white">
              {promptCopy.title}
            </h3>
          </div>

          <form
            className="mt-5 space-y-4"
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
                className="h-10 rounded-xl border border-white/10 bg-slate-950/45 px-4 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/40 focus:ring-2 focus:ring-cyan-400/30"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPromptState(null)}
                className={modalActionButtonClass}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={modalPrimaryActionButtonClass}
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
