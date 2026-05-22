import type {
  AppState,
  ErrorLogEntry,
  ExamTimer,
  NotebookDocument,
  NotebookFolder,
  NotebookPage,
  PersistenceSnapshot,
  PracticeTest,
  Preferences,
  ResourceLink,
  StudyBlock,
  ThemeId,
  TfAppState,
  TfSessionLog,
  TfSessionLogTombstone,
  WeakTopicEntry,
} from "../types/models";
// @ts-expect-error TS5097: node --test needs the explicit .ts specifier in this runtime path.
import { buildCanonicalSessionLogExport } from "./tf-session-log-canonical-export.ts";
// @ts-expect-error TS5097: node --test needs the explicit .ts specifier in this runtime path.
import { getLocalDateKeyFromIso } from "./datetime.ts";
// @ts-expect-error TS5097: node --test needs the explicit .ts specifier in this runtime path.
import { methodKeyFromLabel } from "./tf-session-adapters.ts";
import type { CloudDeleteTombstone, CloudEntityType } from "./native-persistence";

type CloudPullEntityType =
  | CloudEntityType
  | "session_log"
  | "preferences"
  | "notebook_folder"
  | "notebook_document"
  | "notebook_page";

type NotebookCloudEntityType = "notebook_folder" | "notebook_document" | "notebook_page";

const SUPPORTED_THEME_IDS: ReadonlySet<ThemeId> = new Set<ThemeId>([
  "dark",
  "light",
  "paulblue",
  "maggiepink",
]);

const AUTH_URL = "https://timefolio-auth-v2.paulfreedman3.workers.dev";
const SYNC_URL = "https://timefolio-sync-v2.paulfreedman3.workers.dev";

type CloudPullOperation = "upsert" | "delete";

interface CloudPullEntry {
  entityType: string;
  entityId: string;
  operation: CloudPullOperation;
  payload: unknown;
  clientUpdatedAt: string;
}

interface CloudPullResponse {
  entries: CloudPullEntry[];
  cursor: number;
}

export interface CloudPullResult {
  received: number;
  applied: number;
  upserted: number;
  deleted: number;
  skipped: number;
  cursor: number;
}

interface CloudPullDependencies {
  fetchImpl?: typeof fetch;
  getCursor?: () => Promise<number | null>;
  setCursor?: (value: number) => Promise<void>;
  loadSnapshot?: () => Promise<PersistenceSnapshot>;
  loadTfState?: () => Promise<TfAppState>;
  getDeleteTombstones?: (after?: string | null) => Promise<CloudDeleteTombstone[]>;
  applyStudyBlock?: (block: StudyBlock) => Promise<void>;
  applyPracticeTest?: (test: PracticeTest) => Promise<void>;
  applyWeakTopic?: (entry: WeakTopicEntry) => Promise<void>;
  applyErrorLog?: (entry: ErrorLogEntry) => Promise<void>;
  applyDelete?: (
    entityType: CloudEntityType,
    entityId: string,
    deletedAt: string,
  ) => Promise<void>;
  applySessionLog?: (session: TfSessionLog) => Promise<void>;
  applySessionLogDelete?: (id: string, deletedAt: string) => Promise<void>;
  applyPreferences?: (preferences: Preferences) => Promise<void>;
}

interface CloudPushDependencies {
  loadTfState?: () => Promise<TfAppState>;
  getNow?: () => string;
}

type NativePersistenceModule = typeof import("./native-persistence");

async function importNativePersistence(): Promise<NativePersistenceModule> {
  return import("./native-persistence");
}

async function loadDefaultPullDependencies() {
  const native = await importNativePersistence();
  return {
    getCursor: native.getCloudPullCursor,
    setCursor: native.setCloudPullCursor,
    loadSnapshot: native.loadNativeSnapshot,
    loadTfState: native.loadNativeTfState,
    getDeleteTombstones: async (after?: string | null) => {
      const [coreTombstones, errorLogTombstones] = await Promise.all([
        native.getCoreEntityDeleteTombstones(after),
        native.getErrorLogDeleteTombstones(after),
      ]);
      return [...coreTombstones, ...errorLogTombstones];
    },
    applyStudyBlock: native.applyCloudStudyBlock,
    applyPracticeTest: native.applyCloudPracticeTest,
    applyWeakTopic: native.applyCloudWeakTopic,
    applyErrorLog: native.applyCloudErrorLogEntry,
    applyDelete: native.applyCloudDelete,
    applySessionLog: async (session: TfSessionLog) => {
      await native.applyCloudSessionLog(session);
    },
    applySessionLogDelete: async (id: string, deletedAt: string) => {
      await native.applyCloudSessionLogDelete(id, deletedAt);
    },
    applyPreferences: async (preferences: Preferences) => {
      await native.saveNativePreferences(preferences);
    },
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getPreferencesUpdatedAt(preferences: Preferences): string | null {
  return typeof preferences.updatedAt === "string" && preferences.updatedAt.trim()
    ? preferences.updatedAt
    : null;
}

function getCloudPreferencesUpdatedAt(
  entryClientUpdatedAt: string,
  payload: Record<string, unknown>,
): string {
  return typeof payload.updatedAt === "string" && payload.updatedAt.trim()
    ? payload.updatedAt
    : entryClientUpdatedAt;
}

// Cloud preferences carry only the subset of fields the web client owns.
// Desktop-only state (planner filters/sort/mode, notesHtml, notebookFolders/
// Pages/Documents, scoreTrendOptions, activeSection, lastActiveDate) must be
// preserved across a pull — never overwritten by missing/null cloud values.
// Web-only fields (remindersEnabled) and incompatible shapes are dropped.
export function mergeCloudPreferencesIntoDesktop(
  current: Preferences,
  cloud: Record<string, unknown>,
  updatedAt?: string,
): Preferences {
  const next: Preferences = { ...current };

  if (
    typeof cloud.dailyGoalMinutes === "number" &&
    Number.isFinite(cloud.dailyGoalMinutes) &&
    cloud.dailyGoalMinutes > 0
  ) {
    next.dailyGoalMinutes = Math.round(cloud.dailyGoalMinutes);
  }

  if (typeof cloud.themeId === "string" && SUPPORTED_THEME_IDS.has(cloud.themeId as ThemeId)) {
    next.themeId = cloud.themeId as ThemeId;
  }

  if (Array.isArray(cloud.enhancedThemeIds)) {
    next.enhancedThemeIds = cloud.enhancedThemeIds.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }

  if (typeof cloud.plannerFocusDate === "string" && cloud.plannerFocusDate.trim()) {
    next.plannerFocusDate = cloud.plannerFocusDate;
  }

  if (Array.isArray(cloud.examTimers)) {
    const existingById = new Map(current.examTimers.map((timer) => [timer.id, timer]));
    next.examTimers = cloud.examTimers.flatMap((raw): ExamTimer[] => {
      if (!isObjectRecord(raw)) return [];
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : "";
      const label = typeof raw.label === "string" ? raw.label : "";
      const examDate = typeof raw.examDate === "string" ? raw.examDate : "";
      if (!id || !label || !examDate) return [];
      const previous = existingById.get(id);
      // Preserve desktop-only optional fields (displayMode, showHrMin, color)
      // when the cloud doesn't carry them.
      return [
        {
          id,
          label,
          examDate,
          examTime: typeof raw.examTime === "string" ? raw.examTime : previous?.examTime,
          displayMode: previous?.displayMode,
          showHrMin: previous?.showHrMin,
          color: previous?.color,
        },
      ];
    });
  }

  if (Array.isArray(cloud.customCategories)) {
    next.customCategories = cloud.customCategories.flatMap((entry): string[] => {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        return trimmed ? [trimmed] : [];
      }
      if (isObjectRecord(entry) && typeof entry.label === "string") {
        const trimmed = entry.label.trim();
        return trimmed ? [trimmed] : [];
      }
      return [];
    });
  }

  if (Array.isArray(cloud.resourceLinks)) {
    next.resourceLinks = cloud.resourceLinks.flatMap((raw): ResourceLink[] => {
      if (!isObjectRecord(raw)) return [];
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : "";
      const label = typeof raw.label === "string" ? raw.label.trim() : "";
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!id || !label || !url) return [];
      // Web encodes link kind as `type: "Website" | "App" | "Other"`; desktop
      // accepts only `kind: "website" | "app"`. Map App→app; everything else
      // (Website, Other, unknown) becomes a generic website entry.
      const kind: ResourceLink["kind"] = raw.type === "App" ? "app" : "website";
      return [{ id, label, url, kind }];
    });
  }

  const mergedUpdatedAt =
    typeof updatedAt === "string" && updatedAt.trim()
      ? updatedAt
      : typeof cloud.updatedAt === "string" && cloud.updatedAt.trim()
        ? cloud.updatedAt
        : null;
  if (mergedUpdatedAt) {
    next.updatedAt = mergedUpdatedAt;
  }

  // Intentionally ignored from cloud payload:
  //   activeSection     — per-device navigation state
  //   remindersEnabled  — no desktop equivalent (reminders are per-block)
  // Any other unknown fields are dropped silently.

  return next;
}

async function loadDefaultPushDependencies(): Promise<Required<CloudPushDependencies>> {
  const native = await importNativePersistence();
  return {
    loadTfState: native.loadNativeTfState,
    getNow: () => new Date().toISOString(),
  };
}

function slugifyPreferenceLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildPreferenceChildId(prefix: string, label: string, index: number): string {
  const slug = slugifyPreferenceLabel(label);
  return slug ? `${prefix}-${slug}` : `${prefix}-${index + 1}`;
}

export function buildCloudPreferencesPayload(
  preferences: Preferences,
  updatedAt: string,
): Record<string, unknown> {
  const plannerFocusDate = preferences.plannerFocusDate.trim();

  return {
    dailyGoalMinutes: preferences.dailyGoalMinutes,
    themeId: preferences.themeId,
    enhancedThemeIds: preferences.enhancedThemeIds.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    ),
    ...(plannerFocusDate ? { plannerFocusDate } : {}),
    examTimers: preferences.examTimers.flatMap((timer) => {
      const id = timer.id.trim();
      const label = timer.label.trim();
      const examDate = timer.examDate.trim();
      if (!id || !label || !examDate) {
        return [];
      }
      return [
        {
          id,
          label,
          examDate,
          ...(typeof timer.examTime === "string" && timer.examTime.trim()
            ? { examTime: timer.examTime.trim() }
            : {}),
        },
      ];
    }),
    customCategories: preferences.customCategories.flatMap((label, index) => {
      const trimmed = label.trim();
      if (!trimmed) {
        return [];
      }
      return [
        {
          id: buildPreferenceChildId("custom-category", trimmed, index),
          label: trimmed,
        },
      ];
    }),
    resourceLinks: preferences.resourceLinks.flatMap((link) => {
      const id = link.id.trim();
      const label = link.label.trim();
      const url = link.url.trim();
      if (!id || !label || !url) {
        return [];
      }
      return [
        {
          id,
          label,
          url,
          type: link.kind === "app" ? "App" : "Website",
        },
      ];
    }),
    updatedAt,
  };
}

function parseJsonBody<T>(res: Response, fallbackMessage: string) {
  return res.json().catch(async () => {
    const text = await res.text().catch(() => "");
    throw new Error(text || fallbackMessage);
  }) as Promise<T>;
}

function compareTimestamps(left: string, right: string) {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    throw new Error("Cloud sync received an invalid timestamp.");
  }
  return leftMs - rightMs;
}

function indexLocalEntities(state: AppState) {
  return {
    study_block: new Map(state.studyBlocks.map((block) => [block.id, block])),
    practice_test: new Map(state.practiceTests.map((test) => [test.id, test])),
    weak_topic_entry: new Map(state.weakTopicEntries.map((entry) => [entry.id, entry])),
    error_log_entry: new Map(state.errorLogEntries.map((entry) => [entry.id, entry])),
  };
}

function indexDeleteTombstones(tombstones: CloudDeleteTombstone[]) {
  return {
    study_block: new Map(
      tombstones
        .filter((entry) => entry.entityType === "study_block")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    practice_test: new Map(
      tombstones
        .filter((entry) => entry.entityType === "practice_test")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    weak_topic_entry: new Map(
      tombstones
        .filter((entry) => entry.entityType === "weak_topic_entry")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
    error_log_entry: new Map(
      tombstones
        .filter((entry) => entry.entityType === "error_log_entry")
        .map((entry) => [entry.entityId, entry.deletedAt]),
    ),
  };
}

function isObjectPayload(payload: unknown): payload is Record<string, unknown> {
  return payload !== null && typeof payload === "object" && !Array.isArray(payload);
}

function coerceCloudPullPayload(payload: unknown): Record<string, unknown> | null {
  if (isObjectPayload(payload)) {
    return payload;
  }
  if (typeof payload !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as unknown;
    return isObjectPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSupportedCloudPullEntityType(entityType: string): entityType is CloudPullEntityType {
  return (
    entityType === "study_block" ||
    entityType === "practice_test" ||
    entityType === "weak_topic_entry" ||
    entityType === "error_log_entry" ||
    entityType === "preferences" ||
    entityType === "session_log" ||
    entityType === "notebook_folder" ||
    entityType === "notebook_document" ||
    entityType === "notebook_page"
  );
}

function isNotebookCloudEntityType(
  entityType: CloudPullEntityType,
): entityType is NotebookCloudEntityType {
  return (
    entityType === "notebook_folder" ||
    entityType === "notebook_document" ||
    entityType === "notebook_page"
  );
}

function isCoreCloudPullEntityType(entityType: CloudPullEntityType): entityType is CloudEntityType {
  return (
    entityType !== "session_log" &&
    entityType !== "preferences" &&
    entityType !== "notebook_folder" &&
    entityType !== "notebook_document" &&
    entityType !== "notebook_page"
  );
}

// A notebook page is considered to hold PDF/binary state when it has a
// non-tiptap kind or a stored PDF filename. We never push these to the cloud
// (no binary asset sync in this slice), and we never let a cloud upsert/delete
// destroy the local PDF metadata.
function notebookPageHasPdfContent(page: NotebookPage): boolean {
  return page.kind === "pdf" || typeof page.pdfFilename === "string";
}

function notebookDocumentHasPdfContent(doc: NotebookDocument): boolean {
  return doc.pages.some(notebookPageHasPdfContent);
}

function getStringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function getNumberField(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getBoolField(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function notebookFolderFromCloudPayload(
  payload: Record<string, unknown>,
  existing?: NotebookFolder,
): NotebookFolder | null {
  const id = (getStringField(payload, "id") ?? "").trim();
  if (!id) return null;
  return {
    id,
    name: getStringField(payload, "name") ?? existing?.name ?? "",
    parentFolderId: getStringField(payload, "parentFolderId") ?? existing?.parentFolderId,
    favorited: getBoolField(payload, "favorited") ?? existing?.favorited,
    order: getNumberField(payload, "order") ?? existing?.order ?? 0,
    createdAt: getStringField(payload, "createdAt") ?? existing?.createdAt ?? "",
    updatedAt: getStringField(payload, "updatedAt") ?? existing?.updatedAt ?? "",
  };
}

// Preserve every desktop-only PDF/rich field from the existing local record;
// the cloud payload only carries the text-compatible fields web understands.
function notebookPageFromCloudPayload(
  payload: Record<string, unknown>,
  existing?: NotebookPage,
): NotebookPage | null {
  const id = (getStringField(payload, "id") ?? "").trim();
  if (!id) return null;
  return {
    id,
    title: getStringField(payload, "title") ?? existing?.title ?? "",
    contentHtml: getStringField(payload, "contentHtml") ?? existing?.contentHtml ?? "",
    favorited: getBoolField(payload, "favorited") ?? existing?.favorited,
    folderId: getStringField(payload, "folderId") ?? existing?.folderId,
    order: getNumberField(payload, "order") ?? existing?.order ?? 0,
    createdAt: getStringField(payload, "createdAt") ?? existing?.createdAt ?? "",
    updatedAt: getStringField(payload, "updatedAt") ?? existing?.updatedAt ?? "",
    kind: existing?.kind,
    pdfFilename: existing?.pdfFilename,
    pdfOriginalName: existing?.pdfOriginalName,
    pdfPageCount: existing?.pdfPageCount,
    pdfAnnotations: existing?.pdfAnnotations,
    pdfViewMode: existing?.pdfViewMode,
    pdfOutline: existing?.pdfOutline,
  };
}

function notebookDocumentFromCloudPayload(
  payload: Record<string, unknown>,
  existing?: NotebookDocument,
): NotebookDocument | null {
  const id = (getStringField(payload, "id") ?? "").trim();
  if (!id) return null;
  return {
    id,
    title: getStringField(payload, "title") ?? existing?.title ?? "",
    folderId: getStringField(payload, "folderId") ?? existing?.folderId,
    favorited: getBoolField(payload, "favorited") ?? existing?.favorited,
    order: getNumberField(payload, "order") ?? existing?.order ?? 0,
    // Embedded pages are desktop-managed (may hold PDF state). The cloud
    // payload does not represent them, so we always preserve the local list.
    pages: existing?.pages ?? [],
    createdAt: getStringField(payload, "createdAt") ?? existing?.createdAt ?? "",
    updatedAt: getStringField(payload, "updatedAt") ?? existing?.updatedAt ?? "",
  };
}

function buildCloudNotebookFolderPayload(folder: NotebookFolder): Record<string, unknown> {
  return {
    id: folder.id,
    name: folder.name,
    ...(folder.parentFolderId ? { parentFolderId: folder.parentFolderId } : {}),
    ...(folder.favorited === true ? { favorited: true } : {}),
    order: folder.order,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

function buildCloudNotebookPagePayload(page: NotebookPage): Record<string, unknown> {
  return {
    id: page.id,
    title: page.title,
    contentHtml: page.contentHtml,
    ...(page.folderId ? { folderId: page.folderId } : {}),
    ...(page.favorited === true ? { favorited: true } : {}),
    order: page.order,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function buildCloudNotebookDocumentPayload(doc: NotebookDocument): Record<string, unknown> {
  return {
    id: doc.id,
    title: doc.title,
    ...(doc.folderId ? { folderId: doc.folderId } : {}),
    ...(doc.favorited === true ? { favorited: true } : {}),
    order: doc.order,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// Apply one cloud notebook pull entry to a working Preferences. Returns the
// next Preferences (with the modified notebook array) and a status describing
// whether the entry was applied or skipped. Notebook arrays live inside
// Preferences on desktop, so callers persist the result via applyPreferences.
//
// Skip rules:
//   - Missing/invalid payload.
//   - Local record's updatedAt >= entry.clientUpdatedAt (LWW).
//   - For upsert: an existing local notebook_page is PDF-kind — cloud has no
//     PDF representation, so refuse to overwrite.
//   - For delete: an existing local notebook_page is PDF-kind, or a
//     notebook_document contains any PDF page — refuse to drop binary data.
function applyCloudNotebookEntry(
  current: Preferences,
  entry: CloudPullEntry,
  entityType: NotebookCloudEntityType,
): { preferences: Preferences; applied: boolean; isDelete: boolean } {
  const skip = { preferences: current, applied: false, isDelete: entry.operation === "delete" };

  if (entityType === "notebook_folder") {
    const folders = current.notebookFolders;
    const existing = folders.find((f) => f.id === entry.entityId);
    if (entry.operation === "delete") {
      if (!existing) {
        return skip;
      }
      if (existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
        return skip;
      }
      return {
        preferences: { ...current, notebookFolders: folders.filter((f) => f.id !== entry.entityId) },
        applied: true,
        isDelete: true,
      };
    }
    const payload = coerceCloudPullPayload(entry.payload);
    if (!payload) return skip;
    if (existing && existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
      return skip;
    }
    const next = notebookFolderFromCloudPayload(payload, existing);
    if (!next) return skip;
    const nextFolders = existing
      ? folders.map((f) => (f.id === entry.entityId ? next : f))
      : [...folders, next];
    return {
      preferences: { ...current, notebookFolders: nextFolders },
      applied: true,
      isDelete: false,
    };
  }

  if (entityType === "notebook_document") {
    const docs = current.notebookDocuments;
    const existing = docs.find((d) => d.id === entry.entityId);
    if (entry.operation === "delete") {
      if (!existing) return skip;
      if (existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
        return skip;
      }
      // Refuse to drop a document that locally holds PDF-bearing pages —
      // cloud has no representation for them and a delete would destroy data.
      if (notebookDocumentHasPdfContent(existing)) return skip;
      return {
        preferences: { ...current, notebookDocuments: docs.filter((d) => d.id !== entry.entityId) },
        applied: true,
        isDelete: true,
      };
    }
    const payload = coerceCloudPullPayload(entry.payload);
    if (!payload) return skip;
    if (existing && existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
      return skip;
    }
    const next = notebookDocumentFromCloudPayload(payload, existing);
    if (!next) return skip;
    const nextDocs = existing
      ? docs.map((d) => (d.id === entry.entityId ? next : d))
      : [...docs, next];
    return {
      preferences: { ...current, notebookDocuments: nextDocs },
      applied: true,
      isDelete: false,
    };
  }

  const pages = current.notebookPages;
  const existing = pages.find((p) => p.id === entry.entityId);
  if (entry.operation === "delete") {
    if (!existing) return skip;
    if (existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
      return skip;
    }
    // PDF page deletes are not safe — the PDF file on disk would orphan.
    if (notebookPageHasPdfContent(existing)) return skip;
    return {
      preferences: { ...current, notebookPages: pages.filter((p) => p.id !== entry.entityId) },
      applied: true,
      isDelete: true,
    };
  }
  const payload = coerceCloudPullPayload(entry.payload);
  if (!payload) return skip;
  // Never let a cloud upsert turn a local PDF page into a text page.
  if (existing && notebookPageHasPdfContent(existing)) return skip;
  if (existing && existing.updatedAt && compareTimestamps(existing.updatedAt, entry.clientUpdatedAt) >= 0) {
    return skip;
  }
  const next = notebookPageFromCloudPayload(payload, existing);
  if (!next) return skip;
  const nextPages = existing
    ? pages.map((p) => (p.id === entry.entityId ? next : p))
    : [...pages, next];
  return {
    preferences: { ...current, notebookPages: nextPages },
    applied: true,
    isDelete: false,
  };
}

function indexSessionLogTombstones(tombstones: TfSessionLogTombstone[]) {
  return new Map(tombstones.map((entry) => [entry.id, entry.deletedAt]));
}

// Convert the canonical web/cloud session-log payload into the desktop's
// TfSessionLog shape. Date bucketing is re-derived from the local-time start
// timestamp when present, matching the post-05a0a49 desktop convention
// (`getSessionLogDateKey`). The payload's `date` field is the fallback only
// when no usable startAt was provided.
export function canonicalSessionLogPayloadToTfSessionLog(
  payload: Record<string, unknown>,
): TfSessionLog | null {
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return null;

  const titleRaw = typeof payload.title === "string" ? payload.title : "";
  const title = titleRaw.trim();
  const startAt = typeof payload.startAt === "string" ? payload.startAt : "";
  const endAt = typeof payload.endAt === "string" ? payload.endAt : "";
  const explicitDate = typeof payload.date === "string" ? payload.date.trim() : "";
  const derivedDate = startAt ? getLocalDateKeyFromIso(startAt) : null;
  const date = derivedDate ?? explicitDate;

  const durationMinutes =
    typeof payload.durationMinutes === "number" && Number.isFinite(payload.durationMinutes)
      ? Math.max(0, payload.durationMinutes)
      : 0;
  const hours = durationMinutes / 60;

  const notes = typeof payload.notes === "string" ? payload.notes : "";
  const isDistraction =
    typeof payload.isDistraction === "boolean" ? payload.isDistraction : false;
  const updatedAt =
    typeof payload.updatedAt === "string" && payload.updatedAt.trim()
      ? payload.updatedAt
      : "1970-01-01T00:00:00.000Z";

  const explicitCategory =
    typeof payload.category === "string" && payload.category.trim()
      ? payload.category.trim()
      : "";

  return {
    id,
    date,
    method: title || "Other",
    methodKey: explicitCategory || methodKeyFromLabel(title || "Other"),
    hours,
    startISO: startAt,
    endISO: endAt,
    notes,
    isDistraction,
    isLive: false,
    updatedAt,
  };
}

function formatPullUrl(deviceId: string, since: number) {
  const url = new URL(`${SYNC_URL}/sync/pull`);
  url.searchParams.set("since", String(since));
  url.searchParams.set("deviceId", deviceId);
  return url.toString();
}

export async function loginToCloud(
  email: string,
  password: string,
): Promise<{ cloudUserId: string; token: string; refreshToken: string }> {
  const res = await fetch(`${AUTH_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Login failed (${res.status})`);
  }
  return res.json() as Promise<{ cloudUserId: string; token: string; refreshToken: string }>;
}

export async function refreshCloudToken(
  refreshToken: string,
): Promise<{ token: string; refreshToken: string }> {
  const res = await fetch(`${AUTH_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Refresh failed (${res.status})`);
  }
  return res.json() as Promise<{ token: string; refreshToken: string }>;
}

export async function registerDevice(token: string, deviceId: string): Promise<void> {
  const res = await fetch(`${SYNC_URL}/sync/register-device`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, deviceName: "Desktop", platform: "macos" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Register device failed (${res.status})`,
    );
  }
}

export async function pushAllEntities(
  token: string,
  deviceId: string,
  state: AppState,
  lastSyncedAt: string | null,
  deleteTombstones: CloudDeleteTombstone[],
  dependencies: CloudPushDependencies = {},
): Promise<{ pushed: number; cursor: number | null }> {
  const after = lastSyncedAt;
  const needsDefaults = !dependencies.loadTfState || !dependencies.getNow;
  const defaults = needsDefaults ? await loadDefaultPushDependencies() : null;
  const loadTfState = dependencies.loadTfState ?? defaults?.loadTfState;
  const getNow = dependencies.getNow ?? defaults?.getNow;
  if (!loadTfState || !getNow) {
    throw new Error("Cloud push dependencies are unavailable.");
  }
  const tfState = await loadTfState();
  const preferencesUpdatedAt = getPreferencesUpdatedAt(state.preferences) ?? getNow();
  const canonicalSessionLogs = buildCanonicalSessionLogExport(tfState.sessionLogs);
  const sessionLogDeleteTombstones = tfState.sessionLogTombstones.filter(
    (entry): entry is TfSessionLogTombstone =>
      entry.syncEligible === true &&
      (entry.syncSource === "manual" || entry.syncSource === "imported") &&
      (!after || entry.deletedAt >= after),
  );
  const entities = [
    ...state.studyBlocks
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "study_block",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.practiceTests
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "practice_test",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.weakTopicEntries
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "weak_topic_entry",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...state.errorLogEntries
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "error_log_entry",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    {
      entityType: "preferences",
      entityId: "preferences",
      operation: "upsert" as const,
      payload: buildCloudPreferencesPayload(state.preferences, preferencesUpdatedAt),
      clientUpdatedAt: preferencesUpdatedAt,
    },
    ...state.preferences.notebookFolders
      .filter((folder) => Boolean(folder.updatedAt) && (!after || folder.updatedAt >= after))
      .map((folder) => ({
        entityType: "notebook_folder",
        entityId: folder.id,
        operation: "upsert" as const,
        payload: buildCloudNotebookFolderPayload(folder),
        clientUpdatedAt: folder.updatedAt,
      })),
    // Notebook pages: only push text/tiptap pages. PDF pages carry binary
    // metadata (filename, page count, annotations, outline) the web client
    // can't represent — skip them entirely from this slice.
    ...state.preferences.notebookPages
      .filter(
        (page) =>
          !notebookPageHasPdfContent(page) &&
          Boolean(page.updatedAt) &&
          (!after || page.updatedAt >= after),
      )
      .map((page) => ({
        entityType: "notebook_page",
        entityId: page.id,
        operation: "upsert" as const,
        payload: buildCloudNotebookPagePayload(page),
        clientUpdatedAt: page.updatedAt,
      })),
    // Notebook documents: skip any document whose embedded pages contain PDF
    // data. We do not strip pages from the desktop record and we do not push
    // partial PDF metadata to web.
    ...state.preferences.notebookDocuments
      .filter(
        (doc) =>
          !notebookDocumentHasPdfContent(doc) &&
          Boolean(doc.updatedAt) &&
          (!after || doc.updatedAt >= after),
      )
      .map((doc) => ({
        entityType: "notebook_document",
        entityId: doc.id,
        operation: "upsert" as const,
        payload: buildCloudNotebookDocumentPayload(doc),
        clientUpdatedAt: doc.updatedAt,
      })),
    ...canonicalSessionLogs
      .filter((entry) => !after || entry.updatedAt >= after)
      .map((entry) => ({
        entityType: "session_log",
        entityId: entry.id,
        operation: "upsert" as const,
        payload: entry as unknown as Record<string, unknown>,
        clientUpdatedAt: entry.updatedAt,
      })),
    ...sessionLogDeleteTombstones.map((entry) => ({
      entityType: "session_log",
      entityId: entry.id,
      operation: "delete" as const,
      payload: null,
      clientUpdatedAt: entry.deletedAt,
    })),
    ...deleteTombstones
      .filter((entry) => !after || entry.deletedAt >= after)
      .map((entry) => ({
        entityType: entry.entityType,
        entityId: entry.entityId,
        operation: "delete" as const,
        payload: null,
        clientUpdatedAt: entry.deletedAt,
      })),
  ];
  if (entities.length === 0) {
    return { pushed: 0, cursor: null };
  }
  const res = await fetch(`${SYNC_URL}/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceId, entities }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Sync push failed (${res.status})`);
  }
  const data = (await res.json()) as { cursor: number };
  return { pushed: entities.length, cursor: data.cursor };
}

export async function pullFromCloud(
  token: string,
  deviceId: string,
  dependencies: CloudPullDependencies = {},
): Promise<CloudPullResult> {
  const needsDefaults =
    !dependencies.getCursor ||
    !dependencies.setCursor ||
    !dependencies.loadSnapshot ||
    !dependencies.loadTfState ||
    !dependencies.getDeleteTombstones ||
    !dependencies.applyStudyBlock ||
    !dependencies.applyPracticeTest ||
    !dependencies.applyWeakTopic ||
    !dependencies.applyErrorLog ||
    !dependencies.applyDelete ||
    !dependencies.applySessionLog ||
    !dependencies.applySessionLogDelete ||
    !dependencies.applyPreferences;
  const defaults = needsDefaults ? await loadDefaultPullDependencies() : null;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const getCursor = dependencies.getCursor ?? defaults?.getCursor;
  const saveCursor = dependencies.setCursor ?? defaults?.setCursor;
  const loadSnapshot = dependencies.loadSnapshot ?? defaults?.loadSnapshot;
  const loadTfState: (() => Promise<TfAppState>) | undefined =
    dependencies.loadTfState ?? defaults?.loadTfState;
  const getDeleteTombstones = dependencies.getDeleteTombstones ?? defaults?.getDeleteTombstones;
  const applyStudyBlock = dependencies.applyStudyBlock ?? defaults?.applyStudyBlock;
  const applyPracticeTest = dependencies.applyPracticeTest ?? defaults?.applyPracticeTest;
  const applyWeakTopic = dependencies.applyWeakTopic ?? defaults?.applyWeakTopic;
  const applyErrorLog = dependencies.applyErrorLog ?? defaults?.applyErrorLog;
  const applyDelete = dependencies.applyDelete ?? defaults?.applyDelete;
  const applySessionLog = dependencies.applySessionLog ?? defaults?.applySessionLog;
  const applySessionLogDelete =
    dependencies.applySessionLogDelete ?? defaults?.applySessionLogDelete;
  const applyPreferences = dependencies.applyPreferences ?? defaults?.applyPreferences;
  if (
    !getCursor ||
    !saveCursor ||
    !loadSnapshot ||
    !loadTfState ||
    !getDeleteTombstones ||
    !applyStudyBlock ||
    !applyPracticeTest ||
    !applyWeakTopic ||
    !applyErrorLog ||
    !applyDelete ||
    !applySessionLog ||
    !applySessionLogDelete ||
    !applyPreferences
  ) {
    throw new Error("Cloud pull dependencies are unavailable.");
  }

  const since = (await getCursor()) ?? 0;
  const [snapshot, tombstones, res] = await Promise.all([
    loadSnapshot(),
    getDeleteTombstones(null),
    fetchImpl(formatPullUrl(deviceId, since), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Sync pull failed (${res.status})`);
  }

  const data = await parseJsonBody<CloudPullResponse>(res, "Sync pull returned invalid JSON.");
  const entities = indexLocalEntities(snapshot.state);
  const localDeletes = indexDeleteTombstones(tombstones);

  // TimeFolio session-log state is fetched lazily — only when the cloud pull
  // actually contains a session_log entry. This avoids hitting the native
  // tf_load_state command in flows that don't need it (and keeps existing
  // pullFromCloud tests passing without having to stub the new dependencies).
  // Preferences merges are serial within a single pull — successive cloud
  // entries layer onto the result of the previous merge so the final write
  // reflects every accepted field, not just the last entry's payload.
  let currentPreferences: Preferences = snapshot.state.preferences;

  let sessionLogs: Map<string, TfSessionLog> | null = null;
  let sessionLogTombstones: Map<string, string> | null = null;
  async function ensureSessionLogIndex(): Promise<{
    sessionLogs: Map<string, TfSessionLog>;
    sessionLogTombstones: Map<string, string>;
  }> {
    if (!sessionLogs || !sessionLogTombstones) {
      const tfState = await loadTfState!();
      sessionLogs = new Map(tfState.sessionLogs.map((entry) => [entry.id, entry]));
      sessionLogTombstones = indexSessionLogTombstones(tfState.sessionLogTombstones);
    }
    return { sessionLogs, sessionLogTombstones };
  }

  let applied = 0;
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;

  for (const entry of data.entries) {
    if (!isSupportedCloudPullEntityType(entry.entityType)) {
      skipped += 1;
      continue;
    }

    if (entry.entityType === "session_log") {
      const { sessionLogs: idx, sessionLogTombstones: tombIdx } = await ensureSessionLogIndex();
      const activeSession = idx.get(entry.entityId);
      const tombstoneDeletedAt = tombIdx.get(entry.entityId);

      if (entry.operation === "upsert") {
        const payload = coerceCloudPullPayload(entry.payload);
        if (!payload) {
          skipped += 1;
          continue;
        }
        if (
          tombstoneDeletedAt &&
          compareTimestamps(tombstoneDeletedAt, entry.clientUpdatedAt) >= 0
        ) {
          skipped += 1;
          continue;
        }
        if (
          activeSession &&
          compareTimestamps(activeSession.updatedAt ?? "1970-01-01T00:00:00.000Z", entry.clientUpdatedAt) >= 0
        ) {
          skipped += 1;
          continue;
        }

        const session = canonicalSessionLogPayloadToTfSessionLog(payload);
        if (!session) {
          skipped += 1;
          continue;
        }

        await applySessionLog(session);
        idx.set(entry.entityId, session);
        tombIdx.delete(entry.entityId);
        applied += 1;
        upserted += 1;
        continue;
      }

      if (
        tombstoneDeletedAt &&
        compareTimestamps(tombstoneDeletedAt, entry.clientUpdatedAt) >= 0
      ) {
        skipped += 1;
        continue;
      }
      if (
        activeSession &&
        compareTimestamps(activeSession.updatedAt ?? "1970-01-01T00:00:00.000Z", entry.clientUpdatedAt) >= 0
      ) {
        skipped += 1;
        continue;
      }

      await applySessionLogDelete(entry.entityId, entry.clientUpdatedAt);
      idx.delete(entry.entityId);
      tombIdx.set(entry.entityId, entry.clientUpdatedAt);
      applied += 1;
      deleted += 1;
      continue;
    }

    if (isNotebookCloudEntityType(entry.entityType)) {
      const result = applyCloudNotebookEntry(currentPreferences, entry, entry.entityType);
      if (!result.applied) {
        skipped += 1;
        continue;
      }
      await applyPreferences(result.preferences);
      currentPreferences = result.preferences;
      applied += 1;
      if (result.isDelete) {
        deleted += 1;
      } else {
        upserted += 1;
      }
      continue;
    }

    if (entry.entityType === "preferences") {
      // Cloud preferences delete is a no-op on desktop. Web does not currently
      // emit one, and treating a tombstone as "wipe desktop settings" would
      // destroy device-local state that has no cloud equivalent. Counted as
      // skipped so the metric stays honest.
      if (entry.operation === "delete") {
        skipped += 1;
        continue;
      }

      const payload = coerceCloudPullPayload(entry.payload);
      if (!payload) {
        skipped += 1;
        continue;
      }

      const cloudUpdatedAt = getCloudPreferencesUpdatedAt(entry.clientUpdatedAt, payload);
      const localUpdatedAt = getPreferencesUpdatedAt(currentPreferences);
      if (
        localUpdatedAt &&
        compareTimestamps(localUpdatedAt, cloudUpdatedAt) >= 0
      ) {
        skipped += 1;
        continue;
      }

      const merged = mergeCloudPreferencesIntoDesktop(currentPreferences, payload, cloudUpdatedAt);
      await applyPreferences(merged);
      currentPreferences = merged;
      applied += 1;
      upserted += 1;
      continue;
    }

    if (!isCoreCloudPullEntityType(entry.entityType)) {
      skipped += 1;
      continue;
    }

    const activeEntity =
      entry.entityType === "study_block"
        ? entities.study_block.get(entry.entityId)
        : entry.entityType === "practice_test"
          ? entities.practice_test.get(entry.entityId)
          : entry.entityType === "weak_topic_entry"
            ? entities.weak_topic_entry.get(entry.entityId)
            : entities.error_log_entry.get(entry.entityId);
    const deletedAt =
      entry.entityType === "study_block"
        ? localDeletes.study_block.get(entry.entityId)
        : entry.entityType === "practice_test"
          ? localDeletes.practice_test.get(entry.entityId)
          : entry.entityType === "weak_topic_entry"
            ? localDeletes.weak_topic_entry.get(entry.entityId)
            : localDeletes.error_log_entry.get(entry.entityId);

    if (entry.operation === "upsert") {
      const payload = coerceCloudPullPayload(entry.payload);
      if (!payload) {
        skipped += 1;
        continue;
      }
      if (deletedAt && compareTimestamps(deletedAt, entry.clientUpdatedAt) >= 0) {
        skipped += 1;
        continue;
      }
      if (activeEntity && compareTimestamps(activeEntity.updatedAt, entry.clientUpdatedAt) >= 0) {
        skipped += 1;
        continue;
      }

      if (entry.entityType === "study_block") {
        const block = payload as unknown as StudyBlock;
        await applyStudyBlock(block);
        entities.study_block.set(entry.entityId, block);
      } else if (entry.entityType === "practice_test") {
        const test = payload as unknown as PracticeTest;
        await applyPracticeTest(test);
        entities.practice_test.set(entry.entityId, test);
      } else if (entry.entityType === "weak_topic_entry") {
        const weakTopic = payload as unknown as WeakTopicEntry;
        await applyWeakTopic(weakTopic);
        entities.weak_topic_entry.set(entry.entityId, weakTopic);
      } else {
        const errorLog = payload as unknown as ErrorLogEntry;
        await applyErrorLog(errorLog);
        entities.error_log_entry.set(entry.entityId, errorLog);
      }

      if (entry.entityType === "study_block") {
        localDeletes.study_block.delete(entry.entityId);
      } else if (entry.entityType === "practice_test") {
        localDeletes.practice_test.delete(entry.entityId);
      } else if (entry.entityType === "weak_topic_entry") {
        localDeletes.weak_topic_entry.delete(entry.entityId);
      } else {
        localDeletes.error_log_entry.delete(entry.entityId);
      }
      applied += 1;
      upserted += 1;
      continue;
    }

    if (deletedAt && compareTimestamps(deletedAt, entry.clientUpdatedAt) >= 0) {
      skipped += 1;
      continue;
    }
    if (activeEntity && compareTimestamps(activeEntity.updatedAt, entry.clientUpdatedAt) >= 0) {
      skipped += 1;
      continue;
    }

    await applyDelete(entry.entityType, entry.entityId, entry.clientUpdatedAt);
    if (entry.entityType === "study_block") {
      entities.study_block.delete(entry.entityId);
      localDeletes.study_block.set(entry.entityId, entry.clientUpdatedAt);
    } else if (entry.entityType === "practice_test") {
      entities.practice_test.delete(entry.entityId);
      localDeletes.practice_test.set(entry.entityId, entry.clientUpdatedAt);
    } else if (entry.entityType === "weak_topic_entry") {
      entities.weak_topic_entry.delete(entry.entityId);
      localDeletes.weak_topic_entry.set(entry.entityId, entry.clientUpdatedAt);
    } else {
      entities.error_log_entry.delete(entry.entityId);
      localDeletes.error_log_entry.set(entry.entityId, entry.clientUpdatedAt);
    }
    applied += 1;
    deleted += 1;
  }

  await saveCursor(data.cursor);
  return {
    received: data.entries.length,
    applied,
    upserted,
    deleted,
    skipped,
    cursor: data.cursor,
  };
}
