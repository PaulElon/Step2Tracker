import { Bell, Check, Database, Download, ExternalLink, Globe, Monitor, Palette, Pencil, Plus, RotateCcw, Trash2, X, Zap } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Panel } from "../components/ui";
import { themeList } from "../lib/themes";
import { fieldClassName, secondaryButtonClassName } from "../lib/ui";
import type { BackupArtifactPreview, PersistenceSummary, ResourceLink, ThemeId } from "../types/models";

function generateId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getBackupFileName(date = new Date()) {
  return `step2-command-center-backup-${date.toISOString().slice(0, 10)}.json`;
}

function formatCountsLine(counts: BackupArtifactPreview["counts"]) {
  return `${counts.studyBlocks} tasks · ${counts.practiceTests} tests · ${counts.weakTopicEntries} topics`;
}

function StorageStatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-slate-950/45 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function CategoriesPanel({
  customCategories,
  onSetCustomCategories,
}: {
  customCategories: string[];
  onSetCustomCategories: (categories: string[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [newCategory, setNewCategory] = useState("");

  function commitEdit(index: number) {
    const next = editingValue.trim();
    if (!next) {
      setEditingIndex(null);
      setEditingValue("");
      return;
    }
    const updated = [...customCategories];
    updated[index] = next;
    onSetCustomCategories(updated);
    setEditingIndex(null);
    setEditingValue("");
  }

  function handleAdd() {
    const value = newCategory.trim();
    if (!value) {
      return;
    }
    onSetCustomCategories([...customCategories, value]);
    setNewCategory("");
  }

  function handleDelete(index: number) {
    if (customCategories.length <= 1) {
      return;
    }
    onSetCustomCategories(customCategories.filter((_, i) => i !== index));
  }

  return (
    <Panel title="Categories">
      <div className="space-y-2">
        {customCategories.map((category, index) => (
          <div
            key={`${category}-${index}`}
            className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-slate-950/35 px-3 py-2"
          >
            {editingIndex === index ? (
              <>
                <input
                  autoFocus
                  value={editingValue}
                  onChange={(event) => setEditingValue(event.target.value)}
                  onBlur={() => commitEdit(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      setEditingIndex(null);
                      setEditingValue("");
                    }
                  }}
                  className={`${fieldClassName} flex-1`}
                />
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => commitEdit(index)}
                >
                  <Check className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <p className="flex-1 text-sm text-white">{category}</p>
                <button
                  type="button"
                  aria-label={`Edit ${category}`}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white"
                  onClick={() => {
                    setEditingIndex(index);
                    setEditingValue(category);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${category}`}
                  disabled={customCategories.length <= 1}
                  className="rounded-full p-2 text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => handleDelete(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 rounded-[16px] border border-dashed border-white/10 bg-slate-950/20 px-3 py-2">
          <input
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleAdd();
              }
            }}
            placeholder="New category"
            className={`${fieldClassName} flex-1`}
          />
          <button type="button" className={secondaryButtonClassName} onClick={handleAdd}>
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>
    </Panel>
  );
}

function ResourcesPanel({
  resourceLinks,
  onSetResourceLinks,
}: {
  resourceLinks: ResourceLink[];
  onSetResourceLinks: (links: ResourceLink[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editUrl, setEditUrl] = useState("");

  const [newName, setNewName] = useState("");
  const [pendingUrl, setPendingUrl] = useState("");
  const [pendingKind, setPendingKind] = useState<"website" | "app" | null>(null);

  const [showWebsiteModal, setShowWebsiteModal] = useState(false);
  const [showAppModal, setShowAppModal] = useState(false);
  const [modalInput, setModalInput] = useState("");

  function beginEdit(link: ResourceLink) {
    setEditingId(link.id);
    setEditLabel(link.label);
    setEditUrl(link.url);
  }

  function commitEdit() {
    if (!editingId) return;
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) {
      setEditingId(null);
      return;
    }
    onSetResourceLinks(
      resourceLinks.map((link) =>
        link.id === editingId
          ? { ...link, label: editLabel.trim() || trimmedUrl, url: trimmedUrl }
          : link,
      ),
    );
    setEditingId(null);
  }

  function handleWebsiteDone() {
    const url = modalInput.trim();
    if (!url) return;
    setPendingUrl(url);
    setPendingKind("website");
    setShowWebsiteModal(false);
    setModalInput("");
  }

  function handleAppDone() {
    const path = modalInput.trim();
    if (!path) return;
    setPendingUrl(path);
    setPendingKind("app");
    setShowAppModal(false);
    setModalInput("");
  }

  function handleAdd() {
    const name = newName.trim();
    const url = pendingUrl.trim();
    if (!name || !url) return;
    onSetResourceLinks([
      ...resourceLinks,
      { id: generateId("link"), label: name, url, kind: pendingKind ?? "website" },
    ]);
    setNewName("");
    setPendingUrl("");
    setPendingKind(null);
  }

  function handleDelete(id: string) {
    onSetResourceLinks(resourceLinks.filter((link) => link.id !== id));
  }

  async function handleOpen(url: string) {
    try {
      const isPath = url.startsWith("/") || url.startsWith("file://");
      if (isPath) {
        const { openPath } = await import("@tauri-apps/plugin-opener");
        await openPath(url.replace(/^file:\/\//, ""));
      } else {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(url);
      }
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  const canAdd = newName.trim().length > 0 && pendingUrl.trim().length > 0;

  return (
    <>
      <Panel
        title="Resources"
        action={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
            <ExternalLink className="h-4 w-4 text-cyan-200" />
            Links
          </div>
        }
      >
        <div className="space-y-2">
          {resourceLinks.length === 0 ? (
            <p className="text-sm text-slate-400">No saved resources yet.</p>
          ) : null}
          {resourceLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 rounded-[16px] border border-white/10 bg-slate-950/35 px-3 py-2"
            >
              {editingId === link.id ? (
                <>
                  <input
                    value={editLabel}
                    onChange={(event) => setEditLabel(event.target.value)}
                    placeholder="Name"
                    className={`${fieldClassName} flex-1`}
                  />
                  <input
                    value={editUrl}
                    onChange={(event) => setEditUrl(event.target.value)}
                    placeholder="https://…"
                    className={`${fieldClassName} flex-1`}
                  />
                  <button type="button" className={secondaryButtonClassName} onClick={commitEdit}>
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel"
                    className="rounded-full p-2 text-slate-300 transition hover:text-white"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleOpen(link.url)}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-semibold text-white">{link.label}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{link.url}</p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Open ${link.label}`}
                    className="rounded-full p-2 text-slate-300 transition hover:text-white"
                    onClick={() => handleOpen(link.url)}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${link.label}`}
                    className="rounded-full p-2 text-slate-300 transition hover:text-white"
                    onClick={() => beginEdit(link)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${link.label}`}
                    className="rounded-full p-2 text-slate-300 transition hover:text-white"
                    onClick={() => handleDelete(link.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-dashed border-white/10 bg-slate-950/20 px-3 py-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Name"
              className={`${fieldClassName} flex-1 min-w-[160px]`}
            />
            <button
              type="button"
              className={`${secondaryButtonClassName} ${pendingKind === "website" ? "border-cyan-400/40 text-cyan-300" : ""}`}
              onClick={() => {
                setModalInput(pendingKind === "website" ? pendingUrl : "");
                setShowWebsiteModal(true);
              }}
            >
              <Globe className="h-4 w-4" />
              Website{pendingKind === "website" ? " ✓" : ""}
            </button>
            <button
              type="button"
              className={`${secondaryButtonClassName} ${pendingKind === "app" ? "border-cyan-400/40 text-cyan-300" : ""}`}
              onClick={() => {
                setModalInput(pendingKind === "app" ? pendingUrl : "");
                setShowAppModal(true);
              }}
            >
              <Monitor className="h-4 w-4" />
              App{pendingKind === "app" ? " ✓" : ""}
            </button>
            <button
              type="button"
              className={secondaryButtonClassName}
              disabled={!canAdd}
              onClick={handleAdd}
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
          {pendingUrl ? (
            <p className="truncate px-1 text-xs text-slate-400">{pendingUrl}</p>
          ) : null}
        </div>
      </Panel>

      {showWebsiteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowWebsiteModal(false)}
        >
          <div
            className="glass-panel mx-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-white">
              Paste the URL for the {newName.trim() || "resource"} website
            </h3>
            <input
              autoFocus
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleWebsiteDone();
                if (e.key === "Escape") setShowWebsiteModal(false);
              }}
              placeholder="https://..."
              className={`${fieldClassName} mt-4 placeholder:opacity-30`}
            />
            <div className="mt-4 flex justify-end">
              <button type="button" className={secondaryButtonClassName} onClick={handleWebsiteDone}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {showAppModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowAppModal(false)}
        >
          <div
            className="glass-panel mx-4 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-slate-200">Steps to add app (in order):</p>
            <p className="mt-2 text-sm text-slate-200">1. Open Finder (or press the search icon button at top of desktop)</p>
            <p className="mt-1 text-sm text-slate-200">2. Click on Applications and find the App</p>
            <p className="mt-1 text-sm text-slate-200">3. Right click on app and hold the option key ⌥</p>
            <p className="mt-1 text-sm text-slate-200">4. Choose Copy “App” as Pathname, then paste it in the field below.</p>
            <input
              autoFocus
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAppDone();
                if (e.key === "Escape") setShowAppModal(false);
              }}
              placeholder="/Pathname"
              className={`${fieldClassName} mt-4 placeholder:opacity-30`}
            />
            <div className="mt-4 flex justify-end">
              <button type="button" className={secondaryButtonClassName} onClick={handleAppDone}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function SettingsView({
  themeId,
  dailyGoalMinutes,
  notificationPermission,
  persistenceCopy,
  persistenceSummary: _persistenceSummary,
  enhancedThemeIds,
  customCategories,
  resourceLinks,
  onThemeChange,
  onToggleThemeEnhanced,
  onDailyGoalMinutesChange,
  onEnableNotifications,
  onSendTestAlert,
  onExportBackup,
  onPreviewBackupImport,
  onRestoreBackupImport,
  onOpenRecoveryCenter,
  onSetCustomCategories,
  onSetResourceLinks,
  studyStorageCounts,
}: {
  themeId: ThemeId;
  dailyGoalMinutes: number;
  notificationPermission: NotificationPermission | "unsupported";
  persistenceCopy: string;
  persistenceSummary: PersistenceSummary | null;
  enhancedThemeIds: string[];
  customCategories: string[];
  resourceLinks: ResourceLink[];
  onThemeChange: (themeId: ThemeId) => void;
  onToggleThemeEnhanced: (themeId: ThemeId) => void;
  onDailyGoalMinutesChange: (hours: number) => void;
  onEnableNotifications: () => void;
  onSendTestAlert: () => void;
  onExportBackup: () => Promise<string>;
  onPreviewBackupImport: (raw: string) => Promise<BackupArtifactPreview>;
  onRestoreBackupImport: (raw: string) => Promise<boolean>;
  onOpenRecoveryCenter: () => void;
  onSetCustomCategories: (categories: string[]) => void;
  onSetResourceLinks: (links: ResourceLink[]) => void;
  studyStorageCounts: {
    studyBlocks: number;
    practiceTests: number;
    weakTopicEntries: number;
    trashItems: number;
  };
}) {
  const reminderButtonLabel =
    notificationPermission === "granted"
      ? "Send test alert"
      : notificationPermission === "denied"
        ? "Open System Settings"
        : notificationPermission === "unsupported"
          ? "Alerts unavailable"
          : "Enable alerts on this Mac";

  const handleReminderClick =
    notificationPermission === "granted" ? onSendTestAlert : onEnableNotifications;
  const [isStorageBusy, setIsStorageBusy] = useState(false);
  const [storageMessage, setStorageMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pendingImportRaw, setPendingImportRaw] = useState<string | null>(null);
  const [pendingImportPreview, setPendingImportPreview] = useState<BackupArtifactPreview | null>(null);

  async function handleExportBackup() {
    setIsStorageBusy(true);
    setStorageMessage(null);

    try {
      const backup = await onExportBackup();
      const fileName = getBackupFileName();
      const blob = new Blob([backup], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStorageMessage({ tone: "success", text: `Downloaded ${fileName}.` });
    } catch (error) {
      setStorageMessage({
        tone: "error",
        text: error instanceof Error && error.message ? error.message : "Unable to export TimeFolio Study Tracker data.",
      });
    } finally {
      setIsStorageBusy(false);
    }
  }

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setIsStorageBusy(true);
    setStorageMessage(null);

    try {
      const raw = await file.text();
      const preview = await onPreviewBackupImport(raw);
      setPendingImportRaw(raw);
      setPendingImportPreview(preview);
      setStorageMessage({
        tone: "success",
        text: "Backup validated. Review the snapshot details and confirm import.",
      });
    } catch (error) {
      setPendingImportRaw(null);
      setPendingImportPreview(null);
      setStorageMessage({
        tone: "error",
        text: error instanceof Error && error.message ? error.message : "Unable to validate that backup file.",
      });
    } finally {
      setIsStorageBusy(false);
    }
  }

  function handleCancelPendingImport() {
    if (isStorageBusy) {
      return;
    }

    setPendingImportRaw(null);
    setPendingImportPreview(null);
    setStorageMessage(null);
  }

  async function handleConfirmImport() {
    if (!pendingImportRaw) {
      return;
    }

    setIsStorageBusy(true);
    setStorageMessage(null);
    try {
      const restored = await onRestoreBackupImport(pendingImportRaw);
      if (restored) {
        setPendingImportRaw(null);
        setPendingImportPreview(null);
        setStorageMessage({ tone: "success", text: "TimeFolio Study Tracker data imported." });
      } else {
        setStorageMessage({ tone: "error", text: "Unable to import the selected backup." });
      }
    } catch (error) {
      setStorageMessage({
        tone: "error",
        text: error instanceof Error && error.message ? error.message : "Unable to import the selected backup.",
      });
    } finally {
      setIsStorageBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Appearance"
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
              <Palette className="h-4 w-4 text-cyan-200" />
              Theme
            </div>
          }
        >
          <div className="h-[172px] overflow-y-scroll scrollbar-subtle">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {themeList.map((theme) => {
                const isEnhanced = enhancedThemeIds.includes(theme.id);
                return (
                  <div
                    key={theme.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={themeId === theme.id}
                    className={`theme-option cursor-pointer ${themeId === theme.id ? "border-white/20 bg-white/[0.07]" : ""}`}
                    onClick={() => onThemeChange(theme.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") onThemeChange(theme.id);
                    }}
                  >
                    <p className="text-sm font-semibold text-white">{theme.label}</p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.primary }} />
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.secondary }} />
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.tertiary }} />
                      </div>
                      <button
                        type="button"
                        aria-label={isEnhanced ? `Disable enhanced ${theme.label}` : `Enhance ${theme.label}`}
                        aria-pressed={isEnhanced}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleThemeEnhanced(theme.id);
                        }}
                        className={`rounded-full border p-1.5 transition ${
                          isEnhanced
                            ? "border-yellow-300/50 bg-yellow-300/15 text-yellow-300"
                            : "border-white/10 text-slate-400 hover:text-white"
                        }`}
                      >
                        <Zap className={`h-3.5 w-3.5 ${isEnhanced ? "fill-yellow-300" : ""}`} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel title="Study Defaults">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Daily target</p>
            <p className="mt-2 text-3xl font-semibold text-white">{Math.max(Math.round(dailyGoalMinutes / 60), 1)}h</p>
            <label className="mt-5 block text-xs uppercase tracking-[0.16em] text-slate-500" htmlFor="daily-goal-hours">
              Goal hours
            </label>
            <input
              id="daily-goal-hours"
              type="number"
              min={1}
              max={16}
              step={1}
              inputMode="numeric"
              key={dailyGoalMinutes}
              defaultValue={Math.max(Math.round(dailyGoalMinutes / 60), 1)}
              onBlur={(event) => {
                const parsed = Number.parseInt(event.target.value.trim(), 10);
                const nextHours = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 16) : 1;
                onDailyGoalMinutesChange(nextHours);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className={`${fieldClassName} mt-2`}
            />
            <p className="mt-2 text-sm text-slate-400">Saved range: 1 to 16 hours.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <CategoriesPanel
          customCategories={customCategories}
          onSetCustomCategories={onSetCustomCategories}
        />
        <ResourcesPanel resourceLinks={resourceLinks} onSetResourceLinks={onSetResourceLinks} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2.6fr)]">
        <Panel
          title="Reminders"
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
              <Bell className="h-4 w-4 text-cyan-200" />
              Alerts
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Status:{" "}
              {notificationPermission === "granted"
                ? "enabled"
                : notificationPermission === "denied"
                  ? "blocked"
                  : notificationPermission === "unsupported"
                    ? "unsupported"
                  : "not enabled"}
            </p>
            <button type="button" className={secondaryButtonClassName} onClick={handleReminderClick}>
              {reminderButtonLabel}
            </button>
          </div>
        </Panel>

        <Panel
          title="Storage"
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
              <Database className="h-4 w-4 text-cyan-200" />
              Local
            </div>
          }
        >
          <div className="grid gap-4">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <StorageStatCard
                  label="Task count"
                  value={String(studyStorageCounts.studyBlocks)}
                  detail="Study tasks in local Study Tracker storage."
                />
                <StorageStatCard
                  label="Practice tests"
                  value={String(studyStorageCounts.practiceTests)}
                  detail="Saved practice test records."
                />
                <StorageStatCard
                  label="Weak topics"
                  value={String(studyStorageCounts.weakTopicEntries)}
                  detail="Tracked weak topic entries."
                />
                <StorageStatCard
                  label="Trash items"
                  value={String(studyStorageCounts.trashItems)}
                  detail="Recoverable records in Study Tracker trash."
                />
              </div>

              {storageMessage ? (
                <div
                  className={`rounded-[16px] border px-4 py-3 text-sm ${
                    storageMessage.tone === "error"
                      ? "border-rose-500/25 bg-rose-500/10 text-rose-100"
                      : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  {storageMessage.text}
                </div>
              ) : null}

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                <div className="rounded-[16px] border border-white/10 bg-slate-950/45 p-4">
                  <div className="text-sm font-semibold text-white">Import JSON</div>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    Select a `.json` TimeFolio Study Tracker backup artifact. TimeFolio data is untouched.
                  </p>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => {
                      void handleImportFileChange(event);
                    }}
                    disabled={isStorageBusy}
                    className="mt-3 block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 file:mr-4 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  {pendingImportPreview ? (
                    <div className="mt-3 rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-slate-200">
                      <p className="font-semibold text-white">
                        Exported {pendingImportPreview.exportedAt.slice(0, 10)}
                      </p>
                      <p className="mt-1">{formatCountsLine(pendingImportPreview.counts)}</p>
                      <p className="mt-1 text-xs text-slate-300">
                        Schema {pendingImportPreview.schemaVersion} · App {pendingImportPreview.appVersion}
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    className="rounded-lg border border-cyan-500/30 bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isStorageBusy}
                    onClick={() => {
                      void handleExportBackup();
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Download className="h-4 w-4" />
                      Export JSON
                    </div>
                  </button>

                  <button
                    type="button"
                    className="rounded-lg border border-white/10 bg-slate-900/70 px-4 py-3 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={onOpenRecoveryCenter}
                    disabled={isStorageBusy}
                  >
                    <div className="flex items-center gap-2">
                      <RotateCcw className="h-4 w-4" />
                      Recovery center
                    </div>
                  </button>

                  {pendingImportPreview ? (
                    <div className="rounded-[16px] border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-100">
                      <p className="font-medium">Import will replace Study Tracker local data only.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border border-rose-400/40 bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => {
                            void handleConfirmImport();
                          }}
                          disabled={isStorageBusy}
                        >
                          Confirm import
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={handleCancelPendingImport}
                          disabled={isStorageBusy}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <p className="text-xs text-slate-500">{persistenceCopy}</p>
            </div>
          </div>
        </Panel>
      </div>

    </div>
  );
}
