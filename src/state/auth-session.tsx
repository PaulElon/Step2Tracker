import { createContext, useContext, useEffect, useState } from "react";
import type { AccountSummary } from "../types/accounts";
import { clearRememberedSession, loadRememberedSession, rememberSession } from "../lib/accounts";

interface AuthSession {
  account: AccountSummary | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  isRemembered: boolean;
  login: (account: AccountSummary) => void;
  loginAndRemember: (account: AccountSummary) => Promise<void>;
  rememberDevice: () => Promise<void>;
  forgetDevice: () => Promise<void>;
  logout: () => void;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isRemembered, setIsRemembered] = useState(false);

  useEffect(() => {
    loadRememberedSession()
      .then((remembered) => {
        if (remembered) {
          setAccount(remembered);
          setIsRemembered(true);
        }
      })
      .catch(() => {/* treat load failure as no session */})
      .finally(() => setIsHydrating(false));
  }, []);

  return (
    <AuthSessionContext.Provider
      value={{
        account,
        isAuthenticated: account !== null,
        isHydrating,
        isRemembered,
        login: setAccount,
        loginAndRemember: async (acc) => {
          try {
            await rememberSession(acc.id);
            setIsRemembered(true);
          } catch {
            // non-blocking; still authenticate
          }
          setAccount(acc);
        },
        rememberDevice: async () => {
          if (!account) return;
          try {
            await rememberSession(account.id);
            setIsRemembered(true);
          } catch {
            // non-blocking
          }
        },
        forgetDevice: async () => {
          try {
            await clearRememberedSession();
          } catch {
            // non-blocking
          }
          setIsRemembered(false);
        },
        logout: () => {
          void clearRememberedSession();
          setAccount(null);
          setIsRemembered(false);
        },
      }}
    >
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession(): AuthSession {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) throw new Error("useAuthSession must be used inside AuthSessionProvider");
  return ctx;
}
