import { createContext, useContext, useState } from "react";
import type { AccountSummary } from "../types/accounts";

interface AuthSession {
  account: AccountSummary | null;
  isAuthenticated: boolean;
  login: (account: AccountSummary) => void;
  logout: () => void;
}

const AuthSessionContext = createContext<AuthSession | null>(null);

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<AccountSummary | null>(null);

  return (
    <AuthSessionContext.Provider
      value={{
        account,
        isAuthenticated: account !== null,
        login: setAccount,
        logout: () => setAccount(null),
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
