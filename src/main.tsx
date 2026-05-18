import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppStoreProvider } from "./state/app-store";
import { AuthSessionProvider, useAuthSession } from "./state/auth-session";
import { AuthGate } from "./features/auth-gate";

const isTauriShell =
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

function Root() {
  const auth = useAuthSession();
  if (auth.isHydrating) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-slate-500">Loading…</span>
      </div>
    );
  }
  if (!auth.isAuthenticated) return <AuthGate />;
  return (
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthSessionProvider>
      <Root />
    </AuthSessionProvider>
  </StrictMode>,
);

if (!isTauriShell && "serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    void navigator.serviceWorker.register("/sw.js");
  } else {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });
  }
}

if (!isTauriShell && !import.meta.env.PROD && "caches" in window) {
  void caches.keys().then((keys) => {
    keys.forEach((key) => {
      void caches.delete(key);
    });
  });
}
