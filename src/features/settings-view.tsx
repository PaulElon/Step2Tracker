import {
  Bell,
  BookmarkPlus,
  Check,
  Database,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  Info,
  Lock,
  Monitor,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Tag,
  Trash2,
  Upload,
  User,
  X,
  Zap,
} from "lucide-react";
import { changePassword } from "../lib/accounts";
import { launchResource } from "../lib/launcher";
import { useAuthSession } from "../state/auth-session";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { MetricStrip, MetricStripItem, NavigationButton, Panel } from "../components/ui";
import { FF } from "../lib/feature-flags";
import { themeAwareWarmAccent } from "../lib/ui";
import { TimeFolioStoreProvider } from "../state/tf-store";
import { AccountPanel } from "./timefolio/account-panel";
import { TrackerSettingsPanel } from "./timefolio/tracker-settings-panel";
import { themeList } from "../lib/themes";
import { cn, fieldClassName, secondaryButtonClassName } from "../lib/ui";
import type { BackupArtifactPreview, PersistenceSummary, ResourceLink, ThemeId } from "../types/models";

function generateId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getBackupFileName(date = new Date()) {
  return `timefolio-backup-${date.toISOString().slice(0, 10)}.json`;
}

function formatCountsLine(counts: BackupArtifactPreview["counts"]) {
  return `${counts.studyBlocks} tasks · ${counts.practiceTests} tests · ${counts.weakTopicEntries} topics`;
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
    <Panel
      title="Categories"
      subtitle="Organize study tasks with your own category labels."
    >
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
  const [openError, setOpenError] = useState<string | null>(null);

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
    setOpenError(null);
    try {
      await launchResource(url);
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  const canAdd = newName.trim().length > 0 && pendingUrl.trim().length > 0;

  return (
    <>
      <Panel
        title="Resources"
        subtitle="Quick launchers for your most-used study sites and apps."
      >
        <div className="space-y-2">
          {openError ? (
            <p className="rounded-lg bg-red-900/40 px-3 py-2 text-xs text-red-300">{openError}</p>
          ) : null}
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
                    onClick={() => {
                      void handleOpen(link.url);
                    }}
                    className="flex-1 text-left"
                  >
                    <p className="text-sm font-semibold text-white">{link.label}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{link.url}</p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Open ${link.label}`}
                    className="rounded-full p-2 text-slate-300 transition hover:text-white"
                    onClick={() => {
                      void handleOpen(link.url);
                    }}
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

function cpErrorText(code: string): string {
  switch (code) {
    case "INVALID_CREDENTIALS": return "Current password is incorrect.";
    case "PASSWORD_TOO_SHORT": return "New password must be at least 10 characters.";
    case "PASSWORD_REQUIRES_NUMBER": return "New password must include at least one number.";
    case "PASSWORD_REQUIRES_SPECIAL": return "New password must include at least one special character.";
    default: return code;
  }
}

function ChangePasswordPanel() {
  const authSession = useAuthSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!authSession.account) return;

    if (newPassword !== confirmPassword) {
      setMessage({ tone: "error", text: "New passwords do not match." });
      return;
    }

    setIsBusy(true);
    setMessage(null);

    try {
      await changePassword({
        accountId: authSession.account.id,
        currentPassword,
        newPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ tone: "success", text: "Password updated." });
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      setMessage({ tone: "error", text: cpErrorText(code) });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Panel title="Change Password" subtitle="Update your local account password.">
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="flex flex-col gap-3"
      >
        <div>
          <label className="block text-[11px] text-slate-500 mb-1" htmlFor="cp-current">
            Current password
          </label>
          <input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={fieldClassName}
            disabled={isBusy}
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1" htmlFor="cp-new">
            New password
          </label>
          <input
            id="cp-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={fieldClassName}
            disabled={isBusy}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            At least 10 characters · 1 number · 1 special character
          </p>
        </div>
        <div>
          <label className="block text-[11px] text-slate-500 mb-1" htmlFor="cp-confirm">
            Confirm new password
          </label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={fieldClassName}
            disabled={isBusy}
          />
        </div>
        {message ? (
          <div
            className={cn(
              "rounded-[14px] border px-3 py-2 text-sm",
              message.tone === "error"
                ? "border-rose-500/25 bg-rose-500/10 text-rose-100"
                : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
            )}
          >
            {message.text}
          </div>
        ) : null}
        <div>
          <button
            type="submit"
            className={secondaryButtonClassName}
            disabled={isBusy || !currentPassword || !newPassword || !confirmPassword}
          >
            <Lock className="h-4 w-4" />
            {isBusy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

interface UpdateCheckResult {
  available: boolean;
  current_version: string;
  latest_version?: string;
  notes?: string;
  date?: string;
}

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; checkedAt: string; currentVersion: string }
  | { kind: "available"; version: string; currentVersion: string; checkedAt: string }
  | { kind: "installing" }
  | { kind: "error"; message: string; checkedAt: string };

const LAST_CHECK_KEY = "timefolio:lastUpdateCheckAt";
const LAST_RESULT_KEY = "timefolio:lastUpdateCheckResult";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function formatCheckedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function readCachedStatus(): UpdateStatus {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return { kind: "idle" };
    const cached = JSON.parse(raw) as {
      available: boolean;
      version?: string;
      currentVersion?: string;
      checkedAt: string;
    };
    if (cached.available && cached.version) {
      return {
        kind: "available",
        version: cached.version,
        currentVersion: cached.currentVersion ?? "",
        checkedAt: cached.checkedAt,
      };
    }
    return {
      kind: "up-to-date",
      checkedAt: cached.checkedAt,
      currentVersion: cached.currentVersion ?? "",
    };
  } catch {
    return { kind: "idle" };
  }
}

function clearCachedStatus() {
  localStorage.removeItem(LAST_CHECK_KEY);
  localStorage.removeItem(LAST_RESULT_KEY);
}

function AboutPanel() {
  const [status, setStatus] = useState<UpdateStatus>(readCachedStatus);
  const [appVersion, setAppVersion] = useState<string>("");
  const hasAutoCheckedRef = useRef(false);

  const runCheck = useCallback(async (force: boolean) => {
    let shouldRun = true;
    setStatus((previous) => {
      if (!force && previous.kind === "checking") {
        shouldRun = false;
        return previous;
      }
      return { kind: "checking" };
    });
    if (!shouldRun) return;

    const now = new Date().toISOString();
    localStorage.setItem(LAST_CHECK_KEY, now);

    try {
      const result = await invoke<UpdateCheckResult>("check_for_update");
      const currentVersion = result.current_version;

      if (result.available && result.latest_version) {
        const next: UpdateStatus = {
          kind: "available",
          version: result.latest_version,
          currentVersion,
          checkedAt: now,
        };
        setStatus(next);
        localStorage.setItem(
          LAST_RESULT_KEY,
          JSON.stringify({
            available: true,
            version: result.latest_version,
            currentVersion,
            checkedAt: now,
          }),
        );
      } else {
        const next: UpdateStatus = { kind: "up-to-date", checkedAt: now, currentVersion };
        setStatus(next);
        localStorage.setItem(
          LAST_RESULT_KEY,
          JSON.stringify({ available: false, currentVersion, checkedAt: now }),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message, checkedAt: now });
    }
  }, []);

  useEffect(() => {
    getVersion()
      .then((version) => {
        setAppVersion(version);
        const cached = readCachedStatus();
        const cachedVersion =
          cached.kind === "available" || cached.kind === "up-to-date"
            ? cached.currentVersion
            : "";

        if (cachedVersion && cachedVersion !== version) {
          clearCachedStatus();
          setStatus({ kind: "idle" });
          hasAutoCheckedRef.current = true;
          void runCheck(true);
          return;
        }

        setStatus(cached);
      })
      .catch(() => {});
  }, [runCheck]);

  useEffect(() => {
    if (hasAutoCheckedRef.current) return;
    hasAutoCheckedRef.current = true;

    const lastCheckAt = localStorage.getItem(LAST_CHECK_KEY);
    const elapsed = lastCheckAt
      ? Date.now() - new Date(lastCheckAt).getTime()
      : Infinity;

    if (elapsed >= CHECK_INTERVAL_MS) {
      const timer = window.setTimeout(() => {
        void runCheck(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [runCheck]);

  async function handleInstall() {
    setStatus({ kind: "installing" });
    try {
      await invoke("install_update");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      clearCachedStatus();
      setStatus({ kind: "error", message, checkedAt: new Date().toISOString() });
      hasAutoCheckedRef.current = true;
      void runCheck(true);
    }
  }

  const displayVersion =
    status.kind === "up-to-date" || status.kind === "available"
      ? status.currentVersion || appVersion
      : appVersion;

  const isBusy = status.kind === "checking" || status.kind === "installing";

  let statusLine: React.ReactNode;
  if (status.kind === "idle") {
    statusLine = <span className="text-slate-400">Never checked</span>;
  } else if (status.kind === "checking") {
    statusLine = <span className="text-slate-300">Checking…</span>;
  } else if (status.kind === "installing") {
    statusLine = <span className="text-slate-300">Installing…</span>;
  } else if (status.kind === "up-to-date") {
    statusLine = (
      <span className="text-emerald-300">
        Up to date · checked {formatCheckedAt(status.checkedAt)}
      </span>
    );
  } else if (status.kind === "available") {
    statusLine = (
      <span className="text-cyan-300">
        Update available: v{status.version} · checked {formatCheckedAt(status.checkedAt)}
      </span>
    );
  } else {
    statusLine = (
      <span className="text-rose-300">
        Check failed · {formatCheckedAt(status.checkedAt)}
      </span>
    );
  }

  return (
    <Panel
      title="About TimeFolio"
      subtitle="Installed version and update status."
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[16px] border border-white/10 bg-slate-950/45 p-4">
            <p className="text-[11px] text-slate-500">Installed version</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {displayVersion ? `v${displayVersion}` : "—"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Built for disciplined, local-first study tracking.
            </p>
          </div>
          <div className="rounded-[16px] border border-white/10 bg-slate-950/45 p-4">
            <p className="text-[11px] text-slate-500">Update status</p>
            <p className="mt-2 text-sm">{statusLine}</p>
            <p className="mt-1 text-xs text-slate-400">
              Checked automatically once per day.
            </p>
          </div>
        </div>

        {status.kind === "error" ? (
          <div className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {status.message}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={isBusy}
            onClick={() => {
              void runCheck(true);
            }}
          >
            <RefreshCw className={`h-4 w-4 ${status.kind === "checking" ? "animate-spin" : ""}`} />
            Check for updates
          </button>

          {status.kind === "available" ? (
            <button
              type="button"
              className="rounded-lg border border-cyan-500/30 bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isBusy}
              onClick={() => {
                void handleInstall();
              }}
            >
              Install update v{status.version}
            </button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

type SettingsSection =
  | "appearance"
  | "defaults"
  | "categories"
  | "resources"
  | "tracker"
  | "account"
  | "reminders"
  | "data"
  | "about";

const SETTINGS_NAV: Array<{
  id: SettingsSection;
  label: string;
  icon: typeof Palette;
  group: "preferences" | "content" | "tracking" | "account" | "system";
  requireTimefolio?: true;
}> = [
  { id: "appearance", label: "Appearance", icon: Palette, group: "preferences" },
  { id: "defaults", label: "Study Defaults", icon: SlidersHorizontal, group: "preferences" },
  { id: "categories", label: "Categories", icon: Tag, group: "content" },
  { id: "resources", label: "Resources", icon: BookmarkPlus, group: "content" },
  { id: "tracker", label: "Tracker Rules", icon: Zap, group: "tracking", requireTimefolio: true },
  { id: "reminders", label: "Reminders", icon: Bell, group: "tracking" },
  { id: "account", label: "Account", icon: User, group: "account" },
  { id: "data", label: "Data & Safety", icon: Database, group: "system" },
  { id: "about", label: "About", icon: Info, group: "system" },
];

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
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  const authSession = useAuthSession();

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
        text: error instanceof Error && error.message ? error.message : "Unable to export TimeFolio data.",
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
        setStorageMessage({ tone: "success", text: "TimeFolio data imported." });
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

  const visibleNav = SETTINGS_NAV.filter((item) => !item.requireTimefolio || FF.timefolio);

  const groupOrder: Array<{ id: "preferences" | "content" | "tracking" | "account" | "system"; label: string }> = [
    { id: "preferences", label: "Preferences" },
    { id: "content", label: "Content" },
    { id: "tracking", label: "Tracking" },
    { id: "account", label: "Account" },
    { id: "system", label: "System" },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Settings</h2>
      <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="glass-panel h-fit p-3 xl:sticky xl:top-4">
          <nav className="space-y-4">
            {groupOrder.map((group) => {
              const groupItems = visibleNav.filter((item) => item.group === group.id);
              if (groupItems.length === 0) return null;
              return (
              <div key={group.id} className="space-y-0.5">
                <p className="px-3 pb-1 text-[0.6rem] text-slate-500">
                  {group.label}
                </p>
                {groupItems.map((item) => (
                  <NavigationButton
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    active={activeSection === item.id}
                    onClick={() => setActiveSection(item.id)}
                  />
                ))}
              </div>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          {activeSection === "appearance" ? (
            <Panel
              title="Appearance"
              subtitle="Choose your theme and toggle enhanced accents."
            >
              <div className="max-h-[420px] overflow-y-auto pr-1 scrollbar-subtle">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {themeList.map((theme) => {
                    const isEnhanced = enhancedThemeIds.includes(theme.id);
                    const isSelected = themeId === theme.id;
                    return (
                      <div
                        key={theme.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        className={`theme-option relative cursor-pointer ${isSelected ? "border-cyan-300/30 bg-cyan-300/[0.08] shadow-[0_0_0_1px_rgba(103,232,249,0.18)]" : "border-white/10 bg-slate-950/45"}`}
                        onClick={() => onThemeChange(theme.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") onThemeChange(theme.id);
                        }}
                      >
                        {isSelected ? (
                          <span className="absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/15 text-cyan-200">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
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
                                ? themeAwareWarmAccent(
                                    themeId,
                                    "border-orange-300/50 bg-orange-300/15 text-orange-300",
                                    "border-yellow-300/50 bg-yellow-300/15 text-yellow-300",
                                  )
                                : "border-white/10 text-slate-400 hover:text-white"
                            }`}
                          >
                            <Zap
                              className={`h-3.5 w-3.5 ${
                                isEnhanced
                                  ? themeAwareWarmAccent(themeId, "fill-orange-300", "fill-yellow-300")
                                  : ""
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
	                </div>
	              </div>
	            </Panel>
	          ) : null}
	          {activeSection === "defaults" ? (
            <Panel
              title="Study Defaults"
              subtitle="Targets used across Today, Plan, and progress views."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="panel-subtle">
                  <p className="text-[11px] text-slate-500">Daily target</p>
                  <p className="mt-2 text-3xl font-semibold text-white">
                    {Math.max(Math.round(dailyGoalMinutes / 60), 1)}h
                  </p>
                  <label
                    className="mt-5 block text-[11px] text-slate-500"
                    htmlFor="daily-goal-hours"
                  >
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
              </div>
            </Panel>
          ) : null}

          {activeSection === "categories" ? (
            <CategoriesPanel
              customCategories={customCategories}
              onSetCustomCategories={onSetCustomCategories}
            />
          ) : null}

          {activeSection === "resources" ? (
            <ResourcesPanel
              resourceLinks={resourceLinks}
              onSetResourceLinks={onSetResourceLinks}
            />
          ) : null}

          {activeSection === "reminders" ? (
            <Panel
              title="Reminders"
              subtitle="Local notifications for study sessions on this Mac."
            >
              <div className="flex flex-col gap-4">
                <div className="panel-subtle flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[11px] text-slate-500">Status</p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {notificationPermission === "granted"
                        ? "Enabled"
                        : notificationPermission === "denied"
                          ? "Blocked"
                          : notificationPermission === "unsupported"
                            ? "Unsupported"
                            : "Not enabled"}
                    </p>
                  </div>
                  <button type="button" className={secondaryButtonClassName} onClick={handleReminderClick}>
                    {reminderButtonLabel}
                  </button>
                </div>
                <div className="rounded-[14px] border border-cyan-300/15 bg-cyan-300/[0.08] px-3 py-2">
                  <p className="text-xs font-semibold text-cyan-100">
                    Reminders only run while the app is open.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-cyan-50/85">
                    Nothing is sent off your device.
                  </p>
                </div>
              </div>
            </Panel>
          ) : null}

          {activeSection === "data" ? (
            <div className="space-y-4">
              <Panel
                title="Data & Safety"
                subtitle="Manage your local TimeFolio data."
              >
                <div className="grid gap-4">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Database className="h-4 w-4 shrink-0 text-cyan-200" />
                    <span className="text-slate-200">Local-first storage</span>
                    <span aria-hidden className="text-slate-500">
                      •
                    </span>
                    <span>{persistenceCopy}</span>
                  </div>

                  <MetricStrip columns="sm:grid-cols-2 lg:grid-cols-4">
                    <MetricStripItem
                      label="Task count"
                      value={String(studyStorageCounts.studyBlocks)}
                      meta="Study tasks in local storage."
                    />
                    <MetricStripItem
                      label="Practice tests"
                      value={String(studyStorageCounts.practiceTests)}
                      meta="Saved practice test records."
                    />
                    <MetricStripItem
                      label="Weak topics"
                      value={String(studyStorageCounts.weakTopicEntries)}
                      meta="Tracked weak topic entries."
                    />
                    <MetricStripItem
                      label="Trash items"
                      value={String(studyStorageCounts.trashItems)}
                      meta="Recoverable records in trash."
                    />
                  </MetricStrip>

                  {storageMessage ? (
                    <div
                      className={cn(
                        "rounded-[16px] border px-4 py-3 text-sm",
                        storageMessage.tone === "error"
                          ? "border-rose-500/25 bg-rose-500/10 text-rose-100"
                          : "border-emerald-500/25 bg-emerald-500/10 text-emerald-100",
                      )}
                    >
                      {storageMessage.text}
                    </div>
                  ) : null}
                </div>
              </Panel>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel
                  title="Backup & Export"
                  subtitle="Save a JSON snapshot of your TimeFolio data."
                >
                  <div className="flex flex-col gap-3">
                    <p className="text-xs leading-5 text-slate-400">
                      Exports a single <code className="text-slate-300">.json</code> file with all study tasks,
                      practice tests, weak topics, and trashed items. Safe to run any time.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isStorageBusy}
                        onClick={() => {
                          void handleExportBackup();
                        }}
                      >
                        <Download className="h-4 w-4" />
                        Export JSON
                      </button>
                      <button
                        type="button"
                        className={secondaryButtonClassName}
                        onClick={onOpenRecoveryCenter}
                        disabled={isStorageBusy}
                      >
                        <FolderOpen className="h-4 w-4" />
                        Recovery Center
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">
                      Recovery Center lets you restore individual items from trash without affecting the rest of your data.
                    </p>
                  </div>
                </Panel>

                <Panel
                  title="Import & Restore"
                  subtitle="Replace local TimeFolio data from a backup file."
                  className="border-rose-500/20"
                >
                  <div className="flex flex-col gap-3">
                    <div className="rounded-[16px] border border-rose-500/25 bg-rose-500/5 p-4">
                      <div className="flex items-start gap-3">
                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                        <div className="space-y-1">
                          <p className="text-sm font-semibold text-rose-100">Destructive action</p>
                          <p className="text-xs leading-6 font-medium text-rose-50">
                            Importing replaces your current TimeFolio data with the contents of the backup file.
                            TimeFolio time-tracking data is untouched. Export a backup first if you want to keep your current state.
                          </p>
                        </div>
                      </div>
                    </div>

                    <label className="block text-[11px] text-slate-500">
                      Backup file
                    </label>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={(event) => {
                        void handleImportFileChange(event);
                      }}
                      disabled={isStorageBusy}
                      className="block w-full rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-200 file:mr-4 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-100 hover:file:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
                    />

                    {pendingImportPreview ? (
                      <div className="space-y-3">
                        <div className="rounded-[14px] border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-slate-200">
                          <p className="font-semibold text-white">
                            Backup snapshot · exported {pendingImportPreview.exportedAt.slice(0, 10)}
                          </p>
                          <p className="mt-1">{formatCountsLine(pendingImportPreview.counts)}</p>
                          <p className="mt-1 text-xs text-slate-300">
                            Schema {pendingImportPreview.schemaVersion} · App {pendingImportPreview.appVersion}
                          </p>
                        </div>
                        <div className="rounded-[16px] border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">
                          <p className="font-medium">
                            This will replace your current TimeFolio data. This cannot be undone.
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => {
                                void handleConfirmImport();
                              }}
                              disabled={isStorageBusy}
                            >
                              <Upload className="h-4 w-4" />
                              Confirm replace
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
                      </div>
                    ) : null}

                    <button
                      type="button"
                      className={`${secondaryButtonClassName} self-start`}
                      onClick={onOpenRecoveryCenter}
                      disabled={isStorageBusy}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Recover individual items
                    </button>
                    <p className="text-xs text-slate-500">
                      Looking to restore a single deleted task? Use Recovery Center instead of importing a full backup.
                    </p>
                  </div>
                </Panel>
              </div>

            </div>
          ) : null}

          {activeSection === "tracker" && FF.timefolio ? (
            <TimeFolioStoreProvider>
              <TrackerSettingsPanel embedded themeId={themeId} />
            </TimeFolioStoreProvider>
          ) : null}

          {activeSection === "account" ? (
            <div className="space-y-4">
              {FF.timefolio ? (
                <TimeFolioStoreProvider>
                  <AccountPanel embedded />
                </TimeFolioStoreProvider>
              ) : null}
              <Panel
                title="Session"
                subtitle="You are signed in to your local account."
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm text-slate-400">
                      {authSession.account?.email ?? ""}
                    </p>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={authSession.logout}
                    >
                      Log out
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-white/10 pt-3">
                    <div>
                      <p className="text-[11px] text-slate-500">This device</p>
                      <p className="mt-1 text-sm text-slate-300">
                        {authSession.isRemembered ? "Remembered — you will be signed in automatically" : "Not remembered on this device"}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button shrink-0"
                      onClick={() => {
                        if (authSession.isRemembered) {
                          void authSession.forgetDevice();
                        } else {
                          void authSession.rememberDevice();
                        }
                      }}
                    >
                      {authSession.isRemembered ? "Forget this device" : "Remember this device"}
                    </button>
                  </div>
                </div>
              </Panel>
              <ChangePasswordPanel />
            </div>
          ) : null}

          {activeSection === "about" ? <AboutPanel /> : null}
        </div>
      </div>
    </div>
  );
}
