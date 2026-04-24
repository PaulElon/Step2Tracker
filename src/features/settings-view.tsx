import { Bell, Database, Download, Palette, RotateCcw, Upload } from "lucide-react";
import { Panel } from "../components/ui";
import { themeList } from "../lib/themes";
import { fieldClassName, secondaryButtonClassName } from "../lib/ui";
import type { PersistenceSummary, ThemeId } from "../types/models";

function formatStoragePath(path?: string | null) {
  if (!path) {
    return "the app data folder";
  }

  return path.replace(/^\/Users\/[^/]+/, "~");
}

export function SettingsView({
  themeId,
  dailyGoalMinutes,
  notificationPermission,
  persistenceCopy,
  persistenceSummary,
  onThemeChange,
  onDailyGoalMinutesChange,
  onEnableNotifications,
  onExportBackup,
  onImportBackup,
  onOpenRecoveryCenter,
}: {
  themeId: ThemeId;
  dailyGoalMinutes: number;
  notificationPermission: NotificationPermission | "unsupported";
  persistenceCopy: string;
  persistenceSummary: PersistenceSummary | null;
  onThemeChange: (themeId: ThemeId) => void;
  onDailyGoalMinutesChange: (hours: number) => void;
  onEnableNotifications: () => void;
  onExportBackup: () => void;
  onImportBackup: () => void;
  onOpenRecoveryCenter: () => void;
}) {
  const reminderButtonLabel =
    notificationPermission === "granted"
      ? "Send test alert"
      : notificationPermission === "denied"
        ? "Open System Settings"
        : notificationPermission === "unsupported"
          ? "Alerts unavailable"
          : "Enable alerts on this Mac";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel
          title="Appearance"
          action={
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
              <Palette className="h-4 w-4 text-cyan-200" />
              Theme
            </div>
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            {themeList.map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={`theme-option ${themeId === theme.id ? "border-white/20 bg-white/[0.07]" : ""}`}
                onClick={() => onThemeChange(theme.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{theme.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{theme.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.primary }} />
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.secondary }} />
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.chart.tertiary }} />
                  </div>
                </div>
              </button>
            ))}
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

      <Panel
        title="Reminders"
        action={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/55 px-3 py-2 text-sm text-slate-300">
            <Bell className="h-4 w-4 text-cyan-200" />
            Alerts
          </div>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm text-slate-300">
              Enable alerts for due tasks. The app uses native notifications when allowed and falls back to an alert if
              they are blocked.
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              Status:{" "}
              {notificationPermission === "granted"
                ? "enabled"
                : notificationPermission === "denied"
                  ? "blocked"
                  : notificationPermission === "unsupported"
                    ? "unsupported"
                  : "not enabled"}
            </p>
          </div>
          <button type="button" className={secondaryButtonClassName} onClick={onEnableNotifications}>
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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Paths</p>
            <p className="mt-3 text-sm text-slate-200">
              Live data: {formatStoragePath(persistenceSummary?.storagePath)}
            </p>
            <p className="mt-2 text-sm text-slate-200">
              Snapshots: {formatStoragePath(persistenceSummary?.backupDirectory)}
            </p>
            <p className="mt-4 text-sm text-slate-300">{persistenceCopy}</p>
            {persistenceSummary?.recoveryMessage ? (
              <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-slate-200">
                {persistenceSummary.recoveryMessage}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <button type="button" className="panel-subtle text-left transition hover:border-white/15" onClick={onImportBackup}>
              <Upload className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Import backup</p>
              <p className="mt-2 text-sm text-slate-400">Preview before restore.</p>
            </button>

            <button type="button" className="panel-subtle text-left transition hover:border-white/15" onClick={onExportBackup}>
              <Download className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Export backup</p>
              <p className="mt-2 text-sm text-slate-400">Create a portable snapshot.</p>
            </button>

            <button
              type="button"
              className="panel-subtle text-left transition hover:border-white/15"
              onClick={onOpenRecoveryCenter}
            >
              <RotateCcw className="h-5 w-5 text-cyan-200" />
              <p className="mt-4 text-sm font-semibold text-white">Recovery center</p>
              <p className="mt-2 text-sm text-slate-400">Restore snapshots or trash.</p>
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="App">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Theme</p>
            <p className="mt-2 text-lg font-semibold text-white">{themeList.find((theme) => theme.id === themeId)?.label}</p>
          </div>
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Goal</p>
            <p className="mt-2 text-lg font-semibold text-white">{Math.max(Math.round(dailyGoalMinutes / 60), 1)} hours</p>
          </div>
          <div className="panel-subtle">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Storage</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {persistenceSummary ? formatStoragePath(persistenceSummary.storagePath) : "Loading"}
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
