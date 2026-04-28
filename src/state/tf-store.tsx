import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  deleteTfSessionLog,
  getEmptyTfAppState,
  loadTfState,
  resetTfState,
  saveTfState,
  upsertTfSessionLog,
} from "../lib/tf-storage";
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const loaded = await loadTfState();
      if (mountedRef.current) {
        setState(loaded);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const reset = useCallback(async () => {
    setError(null);
    try {
      const empty = await resetTfState();
      if (mountedRef.current) {
        setState(empty);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    }
  }, []);

  const saveState = useCallback(async (nextState: TfAppState) => {
    setError(null);
    try {
      const saved = await saveTfState(nextState);
      if (mountedRef.current) {
        setState(saved);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    }
  }, []);

  const upsertSessionLog = useCallback(async (session: TfSessionLog) => {
    setError(null);
    try {
      setState((prev) => {
        const next = upsertTfSessionLog(prev, session);
        saveTfState(next).catch((err) => {
          if (mountedRef.current) {
            setError(toErrorString(err));
            setState(prev);
          }
        });
        return next;
      });
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    }
  }, []);

  const deleteSessionLog = useCallback(async (id: string) => {
    setError(null);
    try {
      setState((prev) => {
        const next = deleteTfSessionLog(prev, id);
        saveTfState(next).catch((err) => {
          if (mountedRef.current) {
            setError(toErrorString(err));
            setState(prev);
          }
        });
        return next;
      });
    } catch (err) {
      if (mountedRef.current) {
        setError(toErrorString(err));
      }
    }
  }, []);

  const value: TimeFolioStoreValue = {
    state,
    isLoading,
    error,
    reload,
    reset,
    saveState,
    upsertSessionLog,
    deleteSessionLog,
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
