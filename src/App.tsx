import {
  AlertCircle,
  CalendarDays,
  ClipboardCheck,
  Database,
  Flame,
  House,
  Plus,
  RotateCcw,
  Settings2,
  ShieldPlus,
  Trash2,
  Upload,
} from "lucide-react";
import { startTransition, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ModalShell } from "./components/modal-shell";
import { MobileNav, NavigationButton } from "./components/ui";
import { DashboardView } from "./features/dashboard-view";
import { ErrorLogView } from "./features/error-log-view";
import { PlannerView } from "./features/planner-view";
import { PracticeTestsView } from "./features/practice-tests-view";
import { SettingsView } from "./features/settings-view";
import { WeakTopicsView } from "./features/weak-topics-view";
import { getDateRange, sumStudyMinutes } from "./lib/analytics";
import { daysBetween, formatHoursValue, formatLongDate } from "./lib/datetime";
import {
  formatReminderBody,
  getDueStudyBlockReminders,
  getNotificationPermissionStatus,
  requestNotificationPermission,
  sendNativeReminder,
  sendReminderNotification,
} from "./lib/reminders";
import { primaryButtonClassName, secondaryButtonClassName } from "./lib/ui";
import { useAppStore } from "./state/app-store";
import type {
  BackupArtifactPreview,
  BackupMetadata,
  ExamDisplayMode,
  ExamTimer,
  PersistenceSummary,
  SectionId,
  TrashItem,
} from "./types/models";

const navigationItems = [
  {
    id: "dashboard" as const,
    label: "Today",
    icon: House,
  },
  {
    id: "planner" as const,
    label: "Planner",
    icon: CalendarDays,
  },
  {
    id: "weakTopics" as const,
    label: "Weak Topics",
    icon: Flame,
  },
  {
    id: "tests" as const,
    label: "Practice Tests",
    icon: ClipboardCheck,
  },
  {
    id: "errorLog" as const,
    label: "Exam Error Log",
    icon: AlertCircle,
  },
  {
    id: "settings" as const,
    label: "Settings",
    icon: Settings2,
  },
];

const sectionCopy: Record<SectionId, { title: string }> = {
  dashboard: { title: "Today" },
  planner: { title: "Planner" },
  weakTopics: { title: "Weak Topics" },
  tests: { title: "Practice Tests" },
  errorLog: { title: "Exam Error Log" },
  settings: { title: "Settings" },
};

function formatCountsLine(counts: BackupMetadata["counts"]) {
  return `${counts.studyBlocks} tasks · ${counts.practiceTests} tests · ${counts.weakTopicEntries} topics`;
}

function formatStoragePath(path?: string | null) {
  if (!path) {
    return "the app data folder";
  }

  return path.replace(/^\/Users\/[^/]+/, "~");
}

function StorageSafetyDialog({
  backups,
  trashItems,
  persistenceSummary,
  importedArtifactPreview,
  onClose,
  onChooseImport,
  onConfirmImportRestore,
  onRestoreSnapshot,
  onRestoreTrashItem,
}: {
  backups: BackupMetadata[];
  trashItems: TrashItem[];
  persistenceSummary: PersistenceSummary | null;
  importedArtifactPreview: BackupArtifactPreview | null;
  onClose: () => void;
  onChooseImport: () => void;
  onConfirmImportRestore: () => void;
  onRestoreSnapshot: (backup: BackupMetadata) => void;
  onRestoreTrashItem: (item: TrashItem) => void;
}) {
  return (
    <ModalShell onClose={onClose} position="center" titleId="storage-safety-title" contentClassName="max-w-[920px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Recovery center</p>
          <h3 id="storage-safety-title" className="mt-2 text-2xl font-semibold text-white">
            Storage safety controls
          </h3>
          <p className="mt-2 text-sm text-slate-400">
            Live restores snapshot the current database first. Imported files are previewed before restore.
          </p>
        </div>
        <button type="button" className={secondaryButtonClassName} onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-6">
          {persistenceSummary ? (
            <div className="panel-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Storage paths</p>
              <p className="mt-2 text-lg font-semibold text-white">Desktop-owned local data</p>
              <p className="mt-2 text-sm text-slate-300">
                Live data stays in {formatStoragePath(persistenceSummary.storagePath)}.
              </p>
              <p className="mt-1 text-sm text-slate-300">
                Automatic snapshots stay in {formatStoragePath(persistenceSummary.backupDirectory)}.
              </p>
            </div>
          ) : null}

          <div className="panel-subtle p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Portable import</p>
                <p className="mt-2 text-lg font-semibold text-white">Validate before restore</p>
              </div>
              <Upload className="mt-0.5 h-5 w-5 text-cyan-200" />
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Import a previously exported backup artifact. Nothing is applied until you confirm restore.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={secondaryButtonClassName} onClick={onChooseImport}>
                <Upload className="h-4 w-4" />
                Choose exported backup
              </button>
              {importedArtifactPreview ? (
                <button type="button" className={primaryButtonClassName} onClick={onConfirmImportRestore}>
                  <RotateCcw className="h-4 w-4" />
                  Restore imported backup
                </button>
              ) : null}
            </div>
            {importedArtifactPreview ? (
              <div className="mt-4 rounded-[18px] border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-slate-200">
                <p className="font-semibold text-white">
                  Exported {formatLongDate(importedArtifactPreview.exportedAt.slice(0, 10))}
                </p>
                <p className="mt-2">{formatCountsLine(importedArtifactPreview.counts)}</p>
                <p className="mt-1 text-slate-300">
                  Schema {importedArtifactPreview.schemaVersion} · App {importedArtifactPreview.appVersion}
                </p>
              </div>
            ) : null}
          </div>

          <div className="panel-subtle p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Automatic snapshots</p>
                <p className="mt-2 text-lg font-semibold text-white">Restore a native backup</p>
              </div>
              <Database className="mt-0.5 h-5 w-5 text-cyan-200" />
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Snapshots live outside the main database and are created before migrations, restores, and checkpoints.
            </p>
            <div className="mt-4 space-y-3">
              {backups.length ? (
                backups.map((backup) => (
                  <div key={backup.id} className="rounded-[18px] border border-white/10 bg-slate-950/45 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {formatLongDate(backup.createdAt.slice(0, 10))}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">{backup.reason}</p>
                      </div>
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={() => onRestoreSnapshot(backup)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        Restore
                      </button>
                    </div>
                    <p className="mt-3 text-sm text-slate-300">{formatCountsLine(backup.counts)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Schema {backup.schemaVersion} · App {backup.appVersion}
                    </p>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-white/10 bg-slate-950/45 p-4 text-sm text-slate-400">
                  No native snapshots yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="panel-subtle p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trash</p>
              <p className="mt-2 text-lg font-semibold text-white">Recover deleted items</p>
            </div>
            <Trash2 className="mt-0.5 h-5 w-5 text-cyan-200" />
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Deletes move records to trash. Recovery restores only the selected item.
          </p>
          <div className="mt-4 space-y-3">
            {trashItems.length ? (
              trashItems.map((item) => (
                <div key={`${item.entityType}-${item.id}`} className="rounded-[18px] border border-white/10 bg-slate-950/45 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{item.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
                        {item.entityType} · {item.secondaryLabel}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => onRestoreTrashItem(item)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Recover
                    </button>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">Deleted {formatLongDate(item.deletedAt.slice(0, 10))}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-dashed border-white/10 bg-slate-950/45 p-4 text-sm text-slate-400">
                Trash is empty.
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function computeCountdown(timer: ExamTimer): string {
  const examTime = timer.examTime ?? "23:59";
  const target = new Date(`${timer.examDate}T${examTime}`);
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return "";
  const totalMinutes = Math.floor(diffMs / 60_000);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const totalDays = Math.floor(totalHours / 24);
  const mode = timer.displayMode ?? "days";
  const hrMin = timer.showHrMin ? ` ${hours}h ${minutes}m` : "";
  if (mode === "days") {
    return `${totalDays}d${hrMin}`;
  }
  if (mode === "weeks+days") {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays % 7;
    return `${weeks}w ${days}d${hrMin}`;
  }
  const months = Math.floor(totalDays / 30);
  const remDays = totalDays - months * 30;
  const weeks = Math.floor(remDays / 7);
  const days = remDays % 7;
  return `${months}mo ${weeks}w ${days}d${hrMin}`;
}

function SidebarCountdown() {
  const { state, setExamTimers } = useAppStore();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("23:59");
  const [mode, setMode] = useState<ExamDisplayMode>("days");
  const [showHrMin, setShowHrMin] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const now = Date.now();
  const allTimers = state.preferences.examTimers;
  const activeTimers = allTimers
    .filter((t) => {
      const examTime = t.examTime ?? "23:59";
      return new Date(`${t.examDate}T${examTime}`).getTime() > now;
    })
    .slice(0, 5);

  function handleAdd() {
    if (!name.trim() || !date) return;
    const newTimer: ExamTimer = {
      id: crypto.randomUUID(),
      label: name.trim(),
      examDate: date,
      examTime: time,
      displayMode: mode,
      showHrMin,
    };
    void setExamTimers([...allTimers, newTimer]);
    setName("");
    setDate("");
    setTime("23:59");
    setMode("days");
    setShowHrMin(false);
    setShowModal(false);
  }

  function handleDelete(id: string) {
    void setExamTimers(allTimers.filter((t) => t.id !== id));
  }

  return (
    <>
      <div className="panel-subtle p-3">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Countdown</p>
        {activeTimers.length === 0 ? (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="mt-2 flex w-full items-center gap-2 rounded-[14px] border border-dashed border-white/10 p-3 text-sm text-slate-500 transition-colors hover:border-white/20 hover:text-slate-400"
          >
            <Plus className="h-4 w-4" />
            Add Countdown
          </button>
        ) : (
          <div className="mt-2 space-y-2">
            {activeTimers.map((t) => (
              <div key={t.id} className="rounded-[14px] border border-white/10 bg-slate-950/45 p-3">
                <div className="flex items-center justify-between gap-1">
                  <p className="truncate text-xs text-slate-400">{t.label}</p>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 text-slate-600 transition-colors hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <p className="mt-1 font-bold tabular-nums text-white" style={{ fontSize: "0.95rem" }}>
                  {computeCountdown(t)}
                </p>
              </div>
            ))}
            {allTimers.length < 5 ? (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="flex w-full items-center gap-2 rounded-[14px] border border-dashed border-white/10 p-2 text-xs text-slate-500 transition-colors hover:text-slate-400"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            ) : null}
          </div>
        )}
      </div>

      {showModal ? (
        <ModalShell onClose={() => setShowModal(false)} position="center" titleId="add-countdown-title">
          <h3 id="add-countdown-title" className="text-xl font-semibold text-white">
            Add Countdown
          </h3>
          <div className="mt-4 space-y-3">
            <input
              type="text"
              placeholder="Name"
              autoFocus
              className="field w-full bg-slate-950"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") setShowModal(false);
              }}
            />
            <input
              type="date"
              className="field w-full bg-slate-950"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <input
              type="time"
              className="field w-full bg-slate-950"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
            <div className="space-y-2">
              <div className="flex gap-4">
                {(["days", "weeks+days", "months+weeks+days"] as const).map((m) => (
                  <label key={m} className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-300">
                    <input
                      type="radio"
                      name="display-mode"
                      checked={mode === m}
                      onChange={() => setMode(m)}
                      className="accent-cyan-400"
                    />
                    {m === "days" ? "d" : m === "weeks+days" ? "w+d" : "mo+w+d"}
                  </label>
                ))}
              </div>
              <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-400">
                <input
                  type="checkbox"
                  checked={showHrMin}
                  onChange={(e) => setShowHrMin(e.target.checked)}
                  className="accent-cyan-400"
                />
                display hr + min
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={handleAdd}
                disabled={!name.trim() || !date}
              >
                Add
              </button>
              <button
                type="button"
                className={secondaryButtonClassName}
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}

export default function App() {
  const {
    state,
    backups,
    trashItems,
    persistenceSummary,
    persistenceStatus,
    persistenceError,
    lastSavedAt,
    setActiveSection,
    setDailyGoalMinutes,
    setThemeId,
    toggleThemeEnhanced,
    setCustomCategories,
    setResourceLinks,
    exportBackup,
    previewBackupArtifact,
    restoreBackupArtifact,
    restoreBackupSnapshot,
    restoreTrashItem,
    upsertStudyBlock,
  } = useAppStore();
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [showRecoveryCenter, setShowRecoveryCenter] = useState(false);
  const [pendingArtifactRaw, setPendingArtifactRaw] = useState<string | null>(null);
  const [pendingArtifactPreview, setPendingArtifactPreview] = useState<BackupArtifactPreview | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const reminderDispatchRef = useRef(new Set<string>());
  const activeSection = state.preferences.activeSection;
  const sectionMeta = sectionCopy[activeSection];
  const totalMinutes = sumStudyMinutes(state.studyBlocks);
  const dateRange = getDateRange(state.studyBlocks);
  const persistenceCopy =
    persistenceStatus === "booting"
      ? "Opening local store…"
      : persistenceStatus === "error"
        ? persistenceError ?? "Local persistence issue detected."
        : lastSavedAt
          ? new Date(lastSavedAt).toLocaleString([], {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "Local store ready.";
  const dateRangeMeta =
    dateRange.startDate && dateRange.endDate
      ? `${daysBetween(dateRange.startDate, dateRange.endDate) + 1} days`
      : "Add or import tasks.";

  useEffect(() => {
    document.documentElement.dataset.theme = state.preferences.themeId;
    document.documentElement.classList.toggle(
      "theme-light",
      state.preferences.themeId === "maggiepink",
    );
    document.documentElement.dataset.themeEnhanced = state.preferences.enhancedThemeIds.includes(
      state.preferences.themeId,
    )
      ? "true"
      : "";
  }, [state.preferences.themeId, state.preferences.enhancedThemeIds]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const permission = await getNotificationPermissionStatus();
      if (!cancelled) {
        setNotificationPermission(permission);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (persistenceStatus !== "ready") {
      return;
    }

    let cancelled = false;
    const flushDueReminders = async () => {
      const dueReminders = getDueStudyBlockReminders(state.studyBlocks).filter((block) => {
        const reminderKey = `${block.id}:${block.reminderAt ?? ""}`;
        return !reminderDispatchRef.current.has(reminderKey);
      });

      if (!dueReminders.length) {
        return;
      }

      const sentAt = new Date().toISOString();
      const reminderKeys = dueReminders.map((block) => `${block.id}:${block.reminderAt ?? ""}`);
      reminderKeys.forEach((key) => reminderDispatchRef.current.add(key));

      try {
        let deliveredNatively = false;
        if (notificationPermission === "granted") {
          try {
            for (const block of dueReminders) {
              if (cancelled) {
                return;
              }

              const delivered = sendReminderNotification(block);
              if (!delivered) {
                throw new Error("Native notification failed.");
              }
            }
            deliveredNatively = true;
          } catch {
            deliveredNatively = false;
          }
        }

        if (!deliveredNatively && !cancelled) {
          const reminderLines = dueReminders
            .map((block) => `• ${block.task} (${formatReminderBody(block)})`)
            .join("\n");
          window.alert(
            dueReminders.length === 1
              ? `Reminder due:\n${reminderLines}`
              : `Reminders due:\n${reminderLines}`,
          );
        }

        for (const block of dueReminders) {
          if (cancelled) {
            return;
          }

          await upsertStudyBlock({
            ...block,
            reminderSentAt: sentAt,
          });
        }
      } finally {
        reminderKeys.forEach((key) => reminderDispatchRef.current.delete(key));
      }
    };

    void flushDueReminders();
    const interval = window.setInterval(() => {
      void flushDueReminders();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [notificationPermission, persistenceStatus, state.studyBlocks, upsertStudyBlock]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("update-available", (event) => {
      setUpdateAvailable(event.payload);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  async function handleInstallUpdate() {
    await invoke("install_update");
  }

  async function handleSendTestAlert() {
    void sendNativeReminder("Step 2 Command Center", "Alerts are working.");
  }

  async function handleEnableNotifications() {
    const permission = await requestNotificationPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      void sendNativeReminder("Alerts enabled", "Task reminders will now alert on this Mac.");
      return;
    }

    if (permission === "denied") {
      try {
        await invoke("open_notification_settings");
      } catch {
        window.alert("Open System Settings > Notifications and allow alerts for Step 2 Command Center.");
      }
      return;
    }

    if (permission === "unsupported") {
      window.alert("Native alerts are unavailable in this build.");
    }
  }

  async function handleExportBackup() {
    const backup = await exportBackup();
    const blob = new Blob([backup], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `step2-command-center-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleBackupFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const preview = await previewBackupArtifact(raw);
      setPendingArtifactRaw(raw);
      setPendingArtifactPreview(preview);
      setShowRecoveryCenter(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to validate that backup file.");
    } finally {
      event.target.value = "";
    }
  }

  async function handleConfirmArtifactRestore() {
    if (!pendingArtifactRaw || !pendingArtifactPreview) {
      return;
    }

    const confirmed = window.confirm(
      `Restore the imported backup from ${formatLongDate(
        pendingArtifactPreview.exportedAt.slice(0, 10),
      )}? The current live database will be snapshotted first.`,
    );
    if (!confirmed) {
      return;
    }

    const restored = await restoreBackupArtifact(pendingArtifactRaw);
    if (restored) {
      setPendingArtifactRaw(null);
      setPendingArtifactPreview(null);
    }
  }

  async function handleRestoreSnapshot(backup: BackupMetadata) {
    const confirmed = window.confirm(
      `Restore the ${backup.reason} snapshot from ${formatLongDate(
        backup.createdAt.slice(0, 10),
      )}? The current live database will be snapshotted first.`,
    );
    if (!confirmed) {
      return;
    }

    await restoreBackupSnapshot(backup.id);
  }

  async function handleRestoreTrashItem(item: TrashItem) {
    await restoreTrashItem(item.entityType, item.id);
  }

  let sectionContent: JSX.Element | null;
  switch (activeSection) {
    case "dashboard":
      sectionContent = <DashboardView />;
      break;
    case "planner":
      sectionContent = <PlannerView />;
      break;
    case "weakTopics":
      sectionContent = <WeakTopicsView />;
      break;
    case "tests":
      sectionContent = <PracticeTestsView />;
      break;
    case "errorLog":
      sectionContent = <ErrorLogView />;
      break;
    case "settings":
      sectionContent = (
        <SettingsView
          themeId={state.preferences.themeId}
          dailyGoalMinutes={state.preferences.dailyGoalMinutes}
          notificationPermission={notificationPermission}
          persistenceCopy={persistenceCopy}
          persistenceSummary={persistenceSummary}
          enhancedThemeIds={state.preferences.enhancedThemeIds}
          customCategories={state.preferences.customCategories}
          resourceLinks={state.preferences.resourceLinks}
          onThemeChange={(themeId) => {
            startTransition(() => {
              void setThemeId(themeId);
            });
          }}
          onToggleThemeEnhanced={(themeId) => {
            startTransition(() => {
              void toggleThemeEnhanced(themeId);
            });
          }}
          onDailyGoalMinutesChange={(hours) => {
            startTransition(() => {
              void setDailyGoalMinutes(hours * 60);
            });
          }}
          onEnableNotifications={() => {
            void handleEnableNotifications();
          }}
          onSendTestAlert={() => {
            void handleSendTestAlert();
          }}
          onExportBackup={() => {
            void handleExportBackup();
          }}
          onImportBackup={() => restoreInputRef.current?.click()}
          onOpenRecoveryCenter={() => setShowRecoveryCenter(true)}
          onSetCustomCategories={(categories) => {
            startTransition(() => {
              void setCustomCategories(categories);
            });
          }}
          onSetResourceLinks={(links) => {
            startTransition(() => {
              void setResourceLinks(links);
            });
          }}
        />
      );
      break;
    default:
      sectionContent = null;
  }

  return (
    <>
      {updateAvailable ? (
        <div className="fixed inset-x-0 top-0 z-[9999] flex items-center justify-between gap-4 bg-cyan-500 px-6 py-3">
          <span className="text-sm font-semibold text-white">
            Version {updateAvailable} is available
          </span>
          <button
            type="button"
            onClick={() => {
              void handleInstallUpdate();
            }}
            className={primaryButtonClassName}
          >
            Update
          </button>
        </div>
      ) : null}
    <div className={`relative h-screen overflow-hidden${updateAvailable ? " pt-12" : ""}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(89,240,222,0.12),transparent_28%),radial-gradient(circle_at_top_right,rgba(104,200,255,0.10),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(92,116,255,0.08),transparent_24%)]" />

      <input
        ref={restoreInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          void handleBackupFileChange(event);
        }}
      />

      <div className="relative mx-auto flex h-full max-w-[1760px] gap-4 px-4 py-4 md:px-6 xl:px-8">
        <aside className="hidden w-[252px] shrink-0 xl:flex">
          <div className="glass-panel flex h-full w-full flex-col gap-6 p-4">
            <div className="rounded-[24px] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/10 to-blue-400/5 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-slate-900/65">
                  <ShieldPlus className="h-6 w-6 text-cyan-100" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Step 2</p>
                  <h1 className="mt-1 text-2xl font-semibold text-white">Command Center</h1>
                </div>
              </div>
            </div>

            <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-subtle">
              {navigationItems.map((item) => (
                <NavigationButton
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={item.id === activeSection}
                  onClick={() => {
                    startTransition(() => {
                      void setActiveSection(item.id);
                    });
                  }}
                />
              ))}
            </nav>

            <SidebarCountdown />

            <div className="panel-subtle p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Schedule</p>
              <p className="mt-2 text-2xl font-semibold text-white">{formatHoursValue(totalMinutes)}</p>
              <p className="mt-1 text-sm text-slate-300">{dateRangeMeta}</p>
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
          <header className="glass-panel p-4 md:p-5">
            <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Step 2</p>
                <h2 className="mt-1 text-3xl font-semibold tracking-[-0.05em] text-white md:text-4xl">
                  {sectionMeta.title}
                </h2>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 2xl:min-w-[480px]">
                <div className="muted-surface px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Planned</p>
                  <p className="mt-2 text-sm font-semibold text-white">{formatHoursValue(totalMinutes)}</p>
                </div>
                <div className="muted-surface px-4 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Saved</p>
                  <p className="mt-2 text-sm font-semibold text-white">{persistenceCopy}</p>
                </div>
              </div>
            </div>
          </header>

          <MobileNav
            items={navigationItems}
            activeSection={activeSection}
            onSelect={(section) => {
              startTransition(() => {
                void setActiveSection(section);
              });
            }}
          />

          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="h-full overflow-y-auto pr-1 scrollbar-subtle">{sectionContent}</div>
          </main>
        </div>
      </div>

      {showRecoveryCenter ? (
        <StorageSafetyDialog
          backups={backups}
          trashItems={trashItems}
          persistenceSummary={persistenceSummary}
          importedArtifactPreview={pendingArtifactPreview}
          onClose={() => setShowRecoveryCenter(false)}
          onChooseImport={() => restoreInputRef.current?.click()}
          onConfirmImportRestore={() => {
            void handleConfirmArtifactRestore();
          }}
          onRestoreSnapshot={(backup) => {
            void handleRestoreSnapshot(backup);
          }}
          onRestoreTrashItem={(item) => {
            void handleRestoreTrashItem(item);
          }}
        />
      ) : null}
    </div>
    </>
  );
}
