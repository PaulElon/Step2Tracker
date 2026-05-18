import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createQueuedTfStateSaver,
  deleteTfSessionLog,
  getEmptyTfAppState,
  loadTfState,
  saveTfState,
  upsertTfSessionLog,
} from "../lib/tf-storage";
import {
  reconcileNativeSpansToSessions,
  type NativeSpanAckKey,
  type NativeTrackerSpanInput,
} from "../lib/tf-native-span-reconciler";
import {
  addDeletedNativeId,
  getDeletedNativeIds,
  removeDeletedNativeId,
} from "../lib/tf-deleted-native-ids";
import type { TfAppState, TfSessionLog } from "../types/models";

interface TimeFolioStoreValue {
  state: TfAppState;
  isLoading: boolean;
  error: string | null;
  reload(): Promise<void>;
  reset(): Promise<void>;
  saveState(nextState: TfAppState): Promise<void>;
  upsertSessionLog(session: TfSessionLog): Promise<void>;
  deleteSessionLog(id: string): Promise<void>;
  importNativeSpans(
    spans: NativeTrackerSpanInput[]
  ): Promise<{ imported: number; skipped: number; ackKeys: NativeSpanAckKey[] }>;
}

const TimeFolioStoreContext = createContext<TimeFolioStoreValue | null>(null);

function toErrorString(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return "A TimeFolio storage operation failed.";
}

export function TimeFolioStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TfAppState>(() => getEmptyTfAppState());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  const queuedSaverRef = useRef(createQueuedTfStateSaver(saveTfState));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = useCallback((nextState: TfAppState) => {
    stateRef.current = nextState;
    if (mountedRef.current) {
      setState(nextState);
    }
  }, []);

  const persistQueuedState = useCallback(
    async (nextState: TfAppState) => {
      const result = await queuedSaverRef.current.enqueue(nextState);
      if (result.isLatest) {
        applyState(result.saved);
      }
      return result.saved;
    },
    [applyState],
  );

  const commitStateChange = useCallback(
    async (mutate: (prev: TfAppState) => TfAppState) => {
      setError(null);
      const previous = stateRef.current;
      const next = mutate(previous);
      applyState(next);

      try {
        return await persistQueuedState(next);
      } catch (err) {
        if (stateRef.current === next) {
          applyState(previous);
        }
        if (mountedRef.current) {
          setError(toErrorString(err));
        }
        throw err;
      }
    },
    [applyState, persistQueuedState],
  );

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await loadTfState();
      applyState(loaded);
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [applyState]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reset = useCallback(async () => {
    await commitStateChange(() => getEmptyTfAppState());
  }, [commitStateChange]);

  const saveState = useCallback(
    async (nextState: TfAppState) => {
      await commitStateChange(() => nextState);
    },
    [commitStateChange],
  );

  const upsertSessionLog = useCallback(
    async (session: TfSessionLog) => {
      if (session.id.startsWith("nat-")) {
        removeDeletedNativeId(session.id);
      }
      await commitStateChange((prev) => upsertTfSessionLog(prev, session));
    },
    [commitStateChange],
  );

  const deleteSessionLog = useCallback(
    async (id: string) => {
      if (id.startsWith("nat-")) {
        addDeletedNativeId(id);
      }
      await commitStateChange((prev) => deleteTfSessionLog(prev, id));
    },
    [commitStateChange],
  );

  const importNativeSpans = useCallback(
    async (spans: NativeTrackerSpanInput[]) => {
      setError(null);
      try {
        const currentState = stateRef.current;
        const { newEntries, skipped, ackKeys } = reconcileNativeSpansToSessions(
          spans,
          currentState.sessionLogs,
          getDeletedNativeIds(),
        );
        if (newEntries.length === 0) {
          return { imported: 0, skipped, ackKeys };
        }

        await commitStateChange((prev) => ({
          ...prev,
          sessionLogs: [...prev.sessionLogs, ...newEntries],
        }));
        return { imported: newEntries.length, skipped, ackKeys };
      } catch (err) {
        if (mountedRef.current) {
          setError(toErrorString(err));
        }
        throw err;
      }
    },
    [commitStateChange],
  );

  const value: TimeFolioStoreValue = {
    state,
    isLoading,
    error,
    reload,
    reset,
    saveState,
    upsertSessionLog,
    deleteSessionLog,
    importNativeSpans,
  };

  return (
    <TimeFolioStoreContext.Provider value={value}>
      {children}
    </TimeFolioStoreContext.Provider>
  );
}

export function useTimeFolioStore(): TimeFolioStoreValue {
  const context = useContext(TimeFolioStoreContext);
  if (!context) {
    throw new Error("useTimeFolioStore must be used within a TimeFolioStoreProvider");
  }
  return context;
}
