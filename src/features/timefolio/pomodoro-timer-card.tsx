import {
  Bell,
  BellOff,
  Coffee,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Timer,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { requestNotificationPermission, sendNativeReminder } from "../../lib/reminders";
import { cn, fieldClassName, primaryButtonClassName, secondaryButtonClassName } from "../../lib/ui";
import {
  DEFAULT_CUSTOM_POMODORO_CONFIG,
  DEFAULT_POMODORO_PRESET_ID,
  POMODORO_PRESETS,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroPresetId,
  advancePomodoroPhase,
  clampInteger,
  formatPomodoroTime,
  getNextPomodoroPhaseLabel,
  getPomodoroAlertCopy,
  getPomodoroPhaseDurationMs,
  getPomodoroPhaseLabel,
  validatePomodoroConfig,
} from "./pomodoro-timer-model";
import { listenForPomodoroTrayEvent, syncPomodoroTray } from "./pomodoro-tray-bridge";

const STORAGE_KEY = "tf-pomodoro-preferences-v1";

const PRESET_OPTIONS: Array<{ id: PomodoroPresetId; label: string }> = [
  { id: "deepWork", label: "Deep Work" },
  { id: "classic", label: "Classic" },
  { id: "fiftyTwoSeventeen", label: "52/17" },
  { id: "sprint", label: "Sprint" },
  { id: "custom", label: "Custom" },
];

interface StoredPomodoroPreferences {
  presetId?: PomodoroPresetId;
  customConfig?: Partial<PomodoroConfig>;
  soundEnabled?: boolean;
  notificationsEnabled?: boolean;
}

interface ResolvedPomodoroPreferences {
  presetId: PomodoroPresetId;
  customConfig: PomodoroConfig;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
}

interface PomodoroTimerContextValue {
  presetId: PomodoroPresetId;
  customConfig: PomodoroConfig;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  notificationError: string | null;
  phase: PomodoroPhase;
  roundIndex: number;
  isRunning: boolean;
  displayRemainingMs: number;
  inlineAlert: string | null;
  activeConfig: PomodoroConfig;
  configError: string | null;
  isStopped: boolean;
  canStart: boolean;
  phaseLabel: string;
  nextPhaseLabel: string;
  routineLabel: string;
  maxRoundLabel: string;
  handlePresetChange: (nextPresetId: PomodoroPresetId) => void;
  updateCustomConfig: (nextConfig: PomodoroConfig) => void;
  handleStart: () => void;
  handlePause: () => void;
  handleReset: () => void;
  handleSkipToBreak: () => void;
  handleSkipToFocus: () => void;
  toggleNotifications: () => Promise<void>;
  toggleSound: () => void;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PomodoroTimerContext = createContext<PomodoroTimerContextValue | null>(null);

function getPresetConfig(presetId: PomodoroPresetId, customConfig: PomodoroConfig) {
  return presetId === "custom" ? customConfig : POMODORO_PRESETS[presetId];
}

function sanitizeConfig(input: Partial<PomodoroConfig> | undefined, fallback: PomodoroConfig): PomodoroConfig {
  return {
    name: typeof input?.name === "string" && input.name.trim() ? input.name : fallback.name,
    focusMinutes: clampInteger(Number(input?.focusMinutes ?? fallback.focusMinutes), 1, 180),
    shortBreakMinutes: clampInteger(Number(input?.shortBreakMinutes ?? fallback.shortBreakMinutes), 1, 60),
    longBreakMinutes: clampInteger(Number(input?.longBreakMinutes ?? fallback.longBreakMinutes), 1, 90),
    roundsBeforeLongBreak: clampInteger(
      Number(input?.roundsBeforeLongBreak ?? fallback.roundsBeforeLongBreak),
      1,
      12,
    ),
    longBreakEnabled: typeof input?.longBreakEnabled === "boolean" ? input.longBreakEnabled : fallback.longBreakEnabled,
  };
}

function readStoredPreferences(): ResolvedPomodoroPreferences {
  const fallback: ResolvedPomodoroPreferences = {
    presetId: DEFAULT_POMODORO_PRESET_ID,
    customConfig: DEFAULT_CUSTOM_POMODORO_CONFIG,
    soundEnabled: true,
    notificationsEnabled: false,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as StoredPomodoroPreferences;
    const presetId = PRESET_OPTIONS.some((option) => option.id === parsed.presetId)
      ? parsed.presetId
      : DEFAULT_POMODORO_PRESET_ID;

    return {
      presetId: presetId ?? DEFAULT_POMODORO_PRESET_ID,
      customConfig: sanitizeConfig(parsed.customConfig, DEFAULT_CUSTOM_POMODORO_CONFIG),
      soundEnabled: typeof parsed.soundEnabled === "boolean" ? parsed.soundEnabled : true,
      notificationsEnabled: typeof parsed.notificationsEnabled === "boolean" ? parsed.notificationsEnabled : false,
    };
  } catch {
    return fallback;
  }
}

function persistPreferences(preferences: Required<StoredPomodoroPreferences>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are optional; timer behavior remains local and functional.
  }
}

function usePomodoroChime() {
  const audioContextRef = useRef<AudioContext | null>(null);

  return useCallback(() => {
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, context.currentTime + 0.16);
      gain.gain.setValueAtTime(0.001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.38);
    } catch {
      // Audio is a nice-to-have local alert.
    }
  }, []);
}

function ToggleButton({
  active,
  icon: Icon,
  offIcon: OffIcon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Volume2;
  offIcon: typeof VolumeX;
  label: string;
  onClick: () => void;
}) {
  const DisplayIcon = active ? Icon : OffIcon;
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-10 min-w-[44px] items-center justify-center rounded-full border text-slate-300 transition hover:text-white",
        active
          ? "border-cyan-300/35 bg-cyan-300/12 shadow-[0_10px_30px_rgba(34,211,238,0.14)]"
          : "border-white/10 bg-white/[0.04]",
      )}
      onClick={onClick}
      title={`${label}: ${active ? "on" : "off"}`}
      aria-label={`${label}: ${active ? "on" : "off"}`}
    >
      <DisplayIcon className="h-4 w-4" />
    </button>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="1"
        className={cn(fieldClassName, "h-11 rounded-[16px] px-3 py-0 disabled:cursor-not-allowed disabled:opacity-60")}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function usePomodoroTimerController(): PomodoroTimerContextValue {
  const initialPreferences = useMemo(() => readStoredPreferences(), []);
  const [presetId, setPresetId] = useState<PomodoroPresetId>(initialPreferences.presetId);
  const [customConfig, setCustomConfig] = useState<PomodoroConfig>(initialPreferences.customConfig);
  const [soundEnabled, setSoundEnabled] = useState(initialPreferences.soundEnabled);
  const [notificationsEnabled, setNotificationsEnabled] = useState(initialPreferences.notificationsEnabled);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [phase, setPhase] = useState<PomodoroPhase>("focus");
  const [roundIndex, setRoundIndex] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [phaseStartedAt, setPhaseStartedAt] = useState<number | null>(null);
  const [remainingMsWhenPaused, setRemainingMsWhenPaused] = useState(() =>
    getPomodoroPhaseDurationMs("focus", getPresetConfig(initialPreferences.presetId, initialPreferences.customConfig)),
  );
  const [displayRemainingMs, setDisplayRemainingMs] = useState(remainingMsWhenPaused);
  const [inlineAlert, setInlineAlert] = useState<string | null>(null);
  const playChime = usePomodoroChime();
  const completionGuardRef = useRef(false);
  const lastTrayPayloadRef = useRef("");

  const activeConfig = useMemo(() => getPresetConfig(presetId, customConfig), [customConfig, presetId]);
  const durationMs = useMemo(() => getPomodoroPhaseDurationMs(phase, activeConfig), [activeConfig, phase]);
  const configError = validatePomodoroConfig(activeConfig);
  const isStopped = !isRunning && phase === "focus" && roundIndex === 1 && remainingMsWhenPaused === durationMs;
  const canStart = !isRunning && !configError;
  const phaseLabel = getPomodoroPhaseLabel(phase);
  const nextPhaseLabel = getNextPomodoroPhaseLabel(phase, roundIndex, activeConfig);
  const routineLabel = activeConfig.name.trim() || "Custom routine";
  const maxRoundLabel = activeConfig.longBreakEnabled ? ` of ${activeConfig.roundsBeforeLongBreak}` : "";

  useEffect(() => {
    completionGuardRef.current = false;
  }, [phase, phaseStartedAt]);

  useEffect(() => {
    persistPreferences({
      presetId,
      customConfig,
      soundEnabled,
      notificationsEnabled,
    });
  }, [customConfig, notificationsEnabled, presetId, soundEnabled]);

  const triggerAlert = useCallback(
    (completedPhase: PomodoroPhase) => {
      const copy = getPomodoroAlertCopy(completedPhase);
      const message = `${copy.title} - ${copy.body}`;

      setInlineAlert(message);
      window.setTimeout(() => setInlineAlert(null), 4200);

      if (soundEnabled) {
        playChime();
      }

      if (notificationsEnabled) {
        const sent = sendNativeReminder(copy.title, copy.body);
        if (!sent) {
          setNotificationError("Desktop alert unavailable. Showing the in-app alert instead.");
        }
      }
    },
    [notificationsEnabled, playChime, soundEnabled],
  );

  const moveToPhase = useCallback(
    (nextPhase: PomodoroPhase, nextRoundIndex: number, shouldRun: boolean) => {
      const nextDurationMs = getPomodoroPhaseDurationMs(nextPhase, activeConfig);
      setPhase(nextPhase);
      setRoundIndex(nextRoundIndex);
      setDisplayRemainingMs(nextDurationMs);
      setRemainingMsWhenPaused(nextDurationMs);
      setPhaseStartedAt(shouldRun ? Date.now() : null);
      setIsRunning(shouldRun);
    },
    [activeConfig],
  );

  const completePhase = useCallback(
    (completedPhase: PomodoroPhase, completedRoundIndex: number) => {
      triggerAlert(completedPhase);
      const next = advancePomodoroPhase(completedPhase, completedRoundIndex, activeConfig);
      moveToPhase(next.phase, next.roundIndex, true);
    },
    [activeConfig, moveToPhase, triggerAlert],
  );

  useEffect(() => {
    if (!isRunning || phaseStartedAt === null) {
      return;
    }

    const tick = () => {
      const nextRemainingMs = Math.max(0, durationMs - (Date.now() - phaseStartedAt));
      setDisplayRemainingMs(nextRemainingMs);
      if (nextRemainingMs <= 0) {
        if (completionGuardRef.current) {
          return;
        }
        completionGuardRef.current = true;
        completePhase(phase, roundIndex);
      }
    };

    tick();
    const intervalId = window.setInterval(tick, 250);
    return () => window.clearInterval(intervalId);
  }, [completePhase, durationMs, isRunning, phase, phaseStartedAt, roundIndex]);

  const resetTimer = useCallback(
    (nextPresetId = presetId, nextCustomConfig = customConfig) => {
      const nextConfig = getPresetConfig(nextPresetId, nextCustomConfig);
      const nextDurationMs = getPomodoroPhaseDurationMs("focus", nextConfig);
      setPhase("focus");
      setRoundIndex(1);
      setIsRunning(false);
      setPhaseStartedAt(null);
      setRemainingMsWhenPaused(nextDurationMs);
      setDisplayRemainingMs(nextDurationMs);
      setInlineAlert(null);
    },
    [customConfig, presetId],
  );

  const handlePresetChange = useCallback(
    (nextPresetId: PomodoroPresetId) => {
      if (isRunning) {
        return;
      }

      setPresetId(nextPresetId);
      resetTimer(nextPresetId, customConfig);
    },
    [customConfig, isRunning, resetTimer],
  );

  const updateCustomConfig = useCallback(
    (nextConfig: PomodoroConfig) => {
      setCustomConfig(nextConfig);
      if (!isRunning && presetId === "custom") {
        resetTimer("custom", nextConfig);
      }
    },
    [isRunning, presetId, resetTimer],
  );

  const handleStart = useCallback(() => {
    if (configError) {
      return;
    }

    setInlineAlert(null);
    setNotificationError(null);
    setPhaseStartedAt(Date.now() - (durationMs - remainingMsWhenPaused));
    setIsRunning(true);
  }, [configError, durationMs, remainingMsWhenPaused]);

  const handlePause = useCallback(() => {
    if (!isRunning || phaseStartedAt === null) {
      return;
    }

    const nextRemainingMs = Math.max(0, durationMs - (Date.now() - phaseStartedAt));
    setRemainingMsWhenPaused(nextRemainingMs);
    setDisplayRemainingMs(nextRemainingMs);
    setPhaseStartedAt(null);
    setIsRunning(false);
  }, [durationMs, isRunning, phaseStartedAt]);

  const handleReset = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  const handleSkipToBreak = useCallback(() => {
    moveToPhase(
      activeConfig.longBreakEnabled && roundIndex >= activeConfig.roundsBeforeLongBreak ? "longBreak" : "shortBreak",
      roundIndex,
      isRunning,
    );
  }, [activeConfig.longBreakEnabled, activeConfig.roundsBeforeLongBreak, isRunning, moveToPhase, roundIndex]);

  const handleSkipToFocus = useCallback(() => {
    moveToPhase("focus", phase === "longBreak" ? 1 : roundIndex + 1, isRunning);
  }, [isRunning, moveToPhase, phase, roundIndex]);

  const toggleNotifications = useCallback(async () => {
    setNotificationError(null);

    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      return;
    }

    const permission = await requestNotificationPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      return;
    }

    setNotificationsEnabled(false);
    setNotificationError(
      permission === "unsupported"
        ? "Desktop alerts are unavailable here. In-app alerts will still show."
        : "Notifications were not enabled. In-app alerts will still show.",
    );
  }, [notificationsEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((value) => !value);
  }, []);

  const handleStartPauseFromTray = useCallback(() => {
    if (isRunning) {
      handlePause();
      return;
    }

    handleStart();
  }, [handlePause, handleStart, isRunning]);

  useEffect(() => {
    const trayTitle =
      isStopped ? "Idle" : `${phase === "focus" ? "🍅" : "☕"} ${formatPomodoroTime(displayRemainingMs)}`;
    const statusLabel = isStopped
      ? `Pomodoro idle · ${routineLabel}`
      : !isRunning
        ? `Paused · ${phaseLabel} · ${formatPomodoroTime(displayRemainingMs)}`
        : `${phaseLabel} · ${formatPomodoroTime(displayRemainingMs)} remaining`;
    const actionLabel = isRunning ? "Pause Pomodoro" : isStopped ? "Start Pomodoro" : "Resume Pomodoro";
    const payload = {
      trayTitle,
      statusLabel,
      actionLabel,
      actionEnabled: !configError,
      resetEnabled: !isStopped,
    };
    const signature = JSON.stringify(payload);

    if (signature === lastTrayPayloadRef.current) {
      return;
    }

    lastTrayPayloadRef.current = signature;
    void syncPomodoroTray(payload);
  }, [configError, displayRemainingMs, isRunning, isStopped, phase, phaseLabel, routineLabel]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFns: Array<() => void> = [];

    void (async () => {
      const listeners = await Promise.all([
        listenForPomodoroTrayEvent("pomodoro-tray-start-pause", handleStartPauseFromTray),
        listenForPomodoroTrayEvent("pomodoro-tray-reset", handleReset),
      ]);

      if (cancelled) {
        listeners.forEach((unlisten) => {
          unlisten();
        });
        return;
      }

      unlistenFns = listeners;
    })();

    return () => {
      cancelled = true;
      unlistenFns.forEach((unlisten) => {
        unlisten();
      });
    };
  }, [handleReset, handleStartPauseFromTray]);

  return {
    presetId,
    customConfig,
    soundEnabled,
    notificationsEnabled,
    notificationError,
    phase,
    roundIndex,
    isRunning,
    displayRemainingMs,
    inlineAlert,
    activeConfig,
    configError,
    isStopped,
    canStart,
    phaseLabel,
    nextPhaseLabel,
    routineLabel,
    maxRoundLabel,
    handlePresetChange,
    updateCustomConfig,
    handleStart,
    handlePause,
    handleReset,
    handleSkipToBreak,
    handleSkipToFocus,
    toggleNotifications,
    toggleSound,
  };
}

function usePomodoroTimer() {
  const context = useContext(PomodoroTimerContext);
  if (!context) {
    throw new Error("PomodoroTimerCard must be used within a PomodoroTimerProvider.");
  }
  return context;
}

export function PomodoroTimerProvider({ children }: { children: ReactNode }) {
  const value = usePomodoroTimerController();
  return <PomodoroTimerContext.Provider value={value}>{children}</PomodoroTimerContext.Provider>;
}

export function PomodoroTimerCard() {
  const {
    presetId,
    customConfig,
    soundEnabled,
    notificationsEnabled,
    notificationError,
    phase,
    roundIndex,
    isRunning,
    displayRemainingMs,
    inlineAlert,
    activeConfig,
    configError,
    isStopped,
    canStart,
    phaseLabel,
    nextPhaseLabel,
    routineLabel,
    maxRoundLabel,
    handlePresetChange,
    updateCustomConfig,
    handleStart,
    handlePause,
    handleReset,
    handleSkipToBreak,
    handleSkipToFocus,
    toggleNotifications,
    toggleSound,
  } = usePomodoroTimer();

  return (
    <section
      className="glass-panel relative min-w-0 shrink-0 overflow-hidden p-5 sm:p-6"
      aria-label="Pomodoro Timer"
      data-testid="pomodoro-timer-card"
    >
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/18 to-transparent" aria-hidden="true" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[0_18px_48px_rgba(34,211,238,0.12)]">
            {phase === "focus" ? <Timer className="h-5 w-5" /> : <Coffee className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-lg font-semibold text-white">Pomodoro timer</h3>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {phaseLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">Stay in rhythm with a focused study block that matches your theme.</p>
            <p className="mt-2 truncate text-xs uppercase tracking-[0.16em] text-slate-500">{routineLabel}</p>
          </div>
        </div>

        <div className="panel-subtle flex shrink-0 items-center gap-3 px-3 py-2">
          <div className="hidden text-right sm:block">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Alerts</p>
            <p className="text-xs text-slate-400">Sound and desktop reminders</p>
          </div>
          <div className="flex items-center gap-2">
            <ToggleButton active={soundEnabled} icon={Volume2} offIcon={VolumeX} label="Sound" onClick={toggleSound} />
            <ToggleButton
              active={notificationsEnabled}
              icon={Bell}
              offIcon={BellOff}
              label="Notifications"
              onClick={() => {
                void toggleNotifications();
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 rounded-[20px] border border-white/10 bg-white/[0.03] p-2">
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={cn(
              "inline-flex min-w-0 items-center rounded-full border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition",
              presetId === option.id
                ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-100 shadow-[0_12px_30px_rgba(34,211,238,0.12)]"
                : "border-white/10 bg-transparent text-slate-400 hover:border-white/20 hover:bg-white/[0.05] hover:text-slate-200",
              isRunning && "cursor-not-allowed opacity-50",
            )}
            disabled={isRunning}
            onClick={() => handlePresetChange(option.id)}
          >
            <span className="block truncate">{option.label}</span>
          </button>
        ))}
      </div>

      <div className="panel-subtle mt-5 overflow-hidden px-5 py-6 text-center">
        <div className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">
          <span>{phaseLabel}</span>
          <span className="h-1 w-1 rounded-full bg-slate-600" />
          <span>
            Round {roundIndex}
            {maxRoundLabel}
          </span>
        </div>
        <p className="mt-4 font-display text-[clamp(3.4rem,10vw,5rem)] font-semibold leading-none tracking-[-0.05em] tabular-nums text-white">
          {formatPomodoroTime(displayRemainingMs)}
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-400">
          <span>Next: {nextPhaseLabel}</span>
          <span className="hidden h-1 w-1 rounded-full bg-slate-600 sm:block" />
          <span>{activeConfig.focusMinutes} min focus cadence</span>
        </div>
      </div>

      {presetId === "custom" ? (
        <div className="quiet-panel mt-5 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Custom routine</p>
              <p className="mt-1 text-sm text-slate-400">Fine-tune your focus, short breaks, and long-break cadence.</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
              Theme-safe
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">Routine name</span>
              <input
                type="text"
                className={cn(fieldClassName, "h-11 rounded-[16px] px-3 py-0 disabled:cursor-not-allowed disabled:opacity-60")}
                value={customConfig.name}
                disabled={isRunning}
                onChange={(event) => updateCustomConfig({ ...customConfig, name: event.target.value })}
              />
            </label>
            <NumberField
              label="Focus"
              value={customConfig.focusMinutes}
              min={1}
              max={180}
              disabled={isRunning}
              onChange={(value) => updateCustomConfig({ ...customConfig, focusMinutes: value })}
            />
            <NumberField
              label="Short break"
              value={customConfig.shortBreakMinutes}
              min={1}
              max={60}
              disabled={isRunning}
              onChange={(value) => updateCustomConfig({ ...customConfig, shortBreakMinutes: value })}
            />
            <NumberField
              label="Long break"
              value={customConfig.longBreakMinutes}
              min={1}
              max={90}
              disabled={isRunning || !customConfig.longBreakEnabled}
              onChange={(value) => updateCustomConfig({ ...customConfig, longBreakMinutes: value })}
            />
            <NumberField
              label="Rounds"
              value={customConfig.roundsBeforeLongBreak}
              min={1}
              max={12}
              disabled={isRunning || !customConfig.longBreakEnabled}
              onChange={(value) => updateCustomConfig({ ...customConfig, roundsBeforeLongBreak: value })}
            />
          </div>

          <div className="muted-surface mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">Long break enabled</p>
              <p className="text-xs text-slate-400">Keeps longer resets in the rotation after your chosen round count.</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                className="h-4 w-4 accent-cyan-300"
                checked={customConfig.longBreakEnabled}
                disabled={isRunning}
                onChange={(event) => updateCustomConfig({ ...customConfig, longBreakEnabled: event.target.checked })}
              />
              <span className="font-medium uppercase tracking-[0.12em] text-slate-400">Enabled</span>
            </label>
          </div>
        </div>
      ) : null}

      {configError ? <p className="mt-3 text-xs text-rose-200">{configError}</p> : null}
      {inlineAlert ? (
        <p className="mt-3 rounded-[12px] border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs text-cyan-100">
          {inlineAlert}
        </p>
      ) : null}
      {notificationError ? (
        <p className="mt-3 rounded-[12px] border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
          {notificationError}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {isRunning ? (
          <button type="button" className={`${secondaryButtonClassName} h-11 px-4`} onClick={handlePause}>
            <Pause className="h-3.5 w-3.5" />
            Pause
          </button>
        ) : (
          <button type="button" className={`${primaryButtonClassName} h-11 px-4`} onClick={handleStart} disabled={!canStart}>
            <Play className="h-3.5 w-3.5" />
            {isStopped ? "Start" : "Resume"}
          </button>
        )}
        <button type="button" className={`${secondaryButtonClassName} h-11 px-4`} onClick={handleReset}>
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
        {phase === "focus" ? (
          <button type="button" className={`${secondaryButtonClassName} h-11 px-4`} onClick={handleSkipToBreak}>
            <SkipForward className="h-3.5 w-3.5" />
            Skip to break
          </button>
        ) : (
          <button type="button" className={`${secondaryButtonClassName} h-11 px-4`} onClick={handleSkipToFocus}>
            <SkipBack className="h-3.5 w-3.5" />
            Skip to focus
          </button>
        )}
      </div>
    </section>
  );
}
