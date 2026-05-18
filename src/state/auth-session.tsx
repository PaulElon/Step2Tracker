import { createContext, useContext, useEffect, useState } from "react";
import type { AccountSummary } from "../types/accounts";
import { clearRememberedSession, loadRememberedSession, rememberSession } from "../lib/accounts";

interface AuthSession {
  account: AccountSummary | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  login: (account: AccountSummary) => void;
  loginAndRemember: (account: AccountSummary) => Promise<void>;
  logout: () => void;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);

  useEffect(() => {
    loadRememberedSession()
      .then((remembered) => {
        if (remembered) setAccount(remembered);
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
        login: setAccount,
        loginAndRemember: async (acc) => {
          try {
            await rememberSession(acc.id);
          } catch {
            // non-blocking; still authenticate
          }
          setAccount(acc);
        },
        logout: () => {
          void clearRememberedSession();
          setAccount(null);
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
