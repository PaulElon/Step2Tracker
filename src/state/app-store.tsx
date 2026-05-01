import { createContext, startTransition, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getTodayKey } from "../lib/datetime";
import {
  duplicateNativeStudyBlock,
  exportNativeBackupArtifact,
  importNativeStudyBlocks,
  loadNativeSnapshot,
  migrateLegacyBrowserState,
  previewNativeBackupArtifact,
  restoreNativeBackupArtifact,
  restoreNativeSnapshot,
  restoreNativeTrashItem,
  saveNativePreferences,
  trashNativeErrorLogEntry,
  trashNativePracticeTest,
  trashNativeStudyBlock,
  trashNativeWeakTopic,
  upsertNativeErrorLogEntry,
  upsertNativePracticeTest,
  upsertNativeStudyBlock,
  upsertNativeWeakTopic,
} from "../lib/native-persistence";
import {
  createBootstrapState,
  getLegacyBrowserMigrationPayload,
  matchesBootstrapSeed,
} from "../lib/storage";
import type {
  AppState,
  BackupArtifactPreview,
  BackupMetadata,
  ErrorLogInput,
  ImportMode,
  NotebookFolder,
  NotebookPage,
  PersistenceSummary,
  PlannerFilters,
  PlannerMode,
  PlannerSort,
  PracticeTestInput,
  ResourceLink,
  SectionId,
  StudyBlockInput,
  ThemeId,
  TrashEntityType,
  TrashItem,
  WeakTopicInput,
} from "../types/models";

type PersistenceStatus = "booting" | "ready" | "error";

interface AppStoreValue {
  state: AppState;
  backups: BackupMetadata[];
  trashItems: TrashItem[];
  persistenceSummary: PersistenceSummary | null;
  persistenceStatus: PersistenceStatus;
  persistenceError: string | null;
  lastSavedAt: string | null;
  setActiveSection: (section: SectionId) => Promise<boolean>;
  setThemeId: (themeId: ThemeId) => Promise<boolean>;
  updatePlannerFilters: (patch: Partial<PlannerFilters>) => Promise<boolean>;
  setPlannerSort: (sort: PlannerSort) => Promise<boolean>;
  setPlannerMode: (mode: PlannerMode) => Promise<boolean>;
  setPlannerFocusDate: (date: string) => Promise<boolean>;
  setDailyGoalMinutes: (dailyGoalMinutes: number) => Promise<boolean>;
  toggleThemeEnhanced: (themeId: ThemeId) => Promise<boolean>;
  setCustomCategories: (categories: string[]) => Promise<boolean>;
  setResourceLinks: (links: ResourceLink[]) => Promise<boolean>;
  setExamTimers: (timers: import("../types/models").ExamTimer[]) => Promise<boolean>;
  setNotesHtml: (html: string) => Promise<boolean>;
  setNotebookFolders: (folders: NotebookFolder[]) => Promise<boolean>;
  setNotebookPages: (pages: NotebookPage[]) => Promise<boolean>;
  setScoreTrendOptions: (options: import("../types/models").ScoreTrendOptions) => Promise<boolean>;
  upsertStudyBlock: (block: StudyBlockInput & { id?: string }) => Promise<boolean>;
  duplicateStudyBlock: (id: string, targetDate?: string) => Promise<boolean>;
  trashStudyBlock: (id: string) => Promise<boolean>;
  importStudyBlocks: (blocks: StudyBlockInput[], mode: ImportMode) => Promise<boolean>;
  upsertPracticeTest: (test: PracticeTestInput & { id?: string }) => Promise<boolean>;
  trashPracticeTest: (id: string) => Promise<boolean>;
  upsertWeakTopic: (entry: WeakTopicInput & { id?: string }) => Promise<boolean>;
  trashWeakTopic: (id: string) => Promise<boolean>;
  upsertErrorLogEntry: (entry: ErrorLogInput & { id?: string }) => Promise<boolean>;
  trashErrorLogEntry: (id: string) => Promise<boolean>;
  restoreTrashItem: (entityType: TrashEntityType, id: string) => Promise<boolean>;
  exportBackup: () => Promise<string>;
  previewBackupArtifact: (raw: string) => Promise<BackupArtifactPreview>;
  restoreBackupArtifact: (raw: string, options?: { alertOnError?: boolean }) => Promise<boolean>;
  restoreBackupSnapshot: (backupId: string, options?: { alertOnError?: boolean }) => Promise<boolean>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "A local persistence operation failed.";
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => createBootstrapState());
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [persistenceSummary, setPersistenceSummary] = useState<PersistenceSummary | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("booting");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const stateRef = useRef(state);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function applySnapshot(snapshot: {
    state: AppState;
    backups: BackupMetadata[];
    trash: TrashItem[];
    persistence: PersistenceSummary;
  }) {
    stateRef.current = snapshot.state;
    setState(snapshot.state);
    setBackups(snapshot.backups);
    setTrashItems(snapshot.trash);
    setPersistenceSummary(snapshot.persistence);
    setPersistenceStatus("ready");
    setPersistenceError(null);
    setLastSavedAt(snapshot.persistence.lastSavedAt);
  }

  function enqueueSnapshotOperation(
    operation: () => Promise<{
      state: AppState;
      backups: BackupMetadata[];
      trash: TrashItem[];
      persistence: PersistenceSummary;
    }>,
    options: { alertOnError?: boolean } = {},
  ) {
    const { alertOnError = true } = options;
    const next = queueRef.current.then(async () => {
      try {
        const snapshot = await operation();
        startTransition(() => applySnapshot(snapshot));
        return true;
      } catch (error) {
        const message = getErrorMessage(error);
        setPersistenceStatus("error");
        setPersistenceError(message);
        if (alertOnError && typeof window !== "undefined") {
          window.alert(message);
        }
        return false;
      }
    });

    queueRef.current = next.then(() => undefined, () => undefined);
    return next;
  }

  function savePreferences(nextPreferences: AppState["preferences"]) {
    return enqueueSnapshotOperation(() => saveNativePreferences(nextPreferences));
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await loadNativeSnapshot();
        if (cancelled) {
          return;
        }

        startTransition(() => applySnapshot(snapshot));

        const legacyPayload = await getLegacyBrowserMigrationPayload();
        if (
          cancelled ||
          !legacyPayload ||
          snapshot.persistence.legacyMigrationCompletedAt ||
          !matchesBootstrapSeed(snapshot.state) ||
          matchesBootstrapSeed(legacyPayload.state)
        ) {
          return;
        }

        const migratedSnapshot = await migrateLegacyBrowserState(
          legacyPayload.legacySourceJson,
          legacyPayload.state,
        );

        if (cancelled) {
          return;
        }

        startTransition(() => applySnapshot(migratedSnapshot));
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPersistenceStatus("error");
        setPersistenceError(getErrorMessage(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value: AppStoreValue = {
    state,
    backups,
    trashItems,
    persistenceSummary,
    persistenceStatus,
    persistenceError,
    lastSavedAt,
    setActiveSection: (section) =>
      savePreferences({
        ...stateRef.current.preferences,
        activeSection: section,
        lastActiveDate: getTodayKey(),
      }),
    setThemeId: (themeId) =>
      savePreferences({
        ...stateRef.current.preferences,
        themeId,
        lastActiveDate: getTodayKey(),
      }),
    updatePlannerFilters: (patch) =>
      savePreferences({
        ...stateRef.current.preferences,
        plannerFilters: {
          ...stateRef.current.preferences.plannerFilters,
          ...patch,
        },
      }),
    setPlannerSort: (sort) =>
      savePreferences({
        ...stateRef.current.preferences,
        plannerSort: sort,
      }),
    setPlannerMode: (mode) =>
      savePreferences({
        ...stateRef.current.preferences,
        plannerMode: mode,
      }),
    setPlannerFocusDate: (date) =>
      savePreferences({
        ...stateRef.current.preferences,
        plannerFocusDate: date,
      }),
    setDailyGoalMinutes: (dailyGoalMinutes) =>
      savePreferences({
        ...stateRef.current.preferences,
        dailyGoalMinutes,
      }),
    toggleThemeEnhanced: (themeId) => {
      const current = stateRef.current.preferences.enhancedThemeIds;
      const next = current.includes(themeId)
        ? current.filter((id) => id !== themeId)
        : [...current, themeId];
      return savePreferences({ ...stateRef.current.preferences, enhancedThemeIds: next });
    },
    setCustomCategories: (categories) =>
      savePreferences({
        ...stateRef.current.preferences,
        customCategories: categories,
      }),
    setResourceLinks: (links) =>
      savePreferences({
        ...stateRef.current.preferences,
        resourceLinks: links,
      }),
    setExamTimers: (timers) =>
      savePreferences({
        ...stateRef.current.preferences,
        examTimers: timers,
      }),
    setNotesHtml: (notesHtml) =>
      savePreferences({
        ...stateRef.current.preferences,
        notesHtml,
      }),
    setNotebookFolders: (notebookFolders) =>
      savePreferences({
        ...stateRef.current.preferences,
        notebookFolders,
      }),
    setNotebookPages: (notebookPages) =>
      savePreferences({
        ...stateRef.current.preferences,
        notebookPages,
      }),
    setScoreTrendOptions: (scoreTrendOptions) =>
      savePreferences({
        ...stateRef.current.preferences,
        scoreTrendOptions,
      }),
    upsertStudyBlock: (block) => enqueueSnapshotOperation(() => upsertNativeStudyBlock(block)),
    duplicateStudyBlock: (id, targetDate) =>
      enqueueSnapshotOperation(() => duplicateNativeStudyBlock(id, targetDate)),
    trashStudyBlock: (id) => enqueueSnapshotOperation(() => trashNativeStudyBlock(id)),
    importStudyBlocks: (blocks, mode) =>
      enqueueSnapshotOperation(() => importNativeStudyBlocks(blocks, mode)),
    upsertPracticeTest: (test) => enqueueSnapshotOperation(() => upsertNativePracticeTest(test)),
    trashPracticeTest: (id) => enqueueSnapshotOperation(() => trashNativePracticeTest(id)),
    upsertWeakTopic: (entry) => enqueueSnapshotOperation(() => upsertNativeWeakTopic(entry)),
    trashWeakTopic: (id) => enqueueSnapshotOperation(() => trashNativeWeakTopic(id)),
    upsertErrorLogEntry: (entry) => enqueueSnapshotOperation(() => upsertNativeErrorLogEntry(entry)),
    trashErrorLogEntry: (id) => enqueueSnapshotOperation(() => trashNativeErrorLogEntry(id)),
    restoreTrashItem: (entityType, id) =>
      enqueueSnapshotOperation(() => restoreNativeTrashItem(entityType, id)),
    exportBackup: () => exportNativeBackupArtifact(),
    previewBackupArtifact: (raw) => previewNativeBackupArtifact(raw),
    restoreBackupArtifact: (raw, options) =>
      enqueueSnapshotOperation(() => restoreNativeBackupArtifact(raw), {
        alertOnError: options?.alertOnError ?? true,
      }),
    restoreBackupSnapshot: (backupId, options) =>
      enqueueSnapshotOperation(() => restoreNativeSnapshot(backupId), {
        alertOnError: options?.alertOnError ?? true,
      }),
  };

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const context = useContext(AppStoreContext);
  if (!context) {
    throw new Error("useAppStore must be used within an AppStoreProvider");
  }

  return context;
}
