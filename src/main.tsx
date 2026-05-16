import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { AppStoreProvider } from "./state/app-store";

const isTauriShell =
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppStoreProvider>
      <App />
    </AppStoreProvider>
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
