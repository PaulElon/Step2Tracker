import { TimeFolioStoreProvider } from "../state/tf-store";
import { SessionLogPanel } from "./timefolio/session-log-panel";

export function TimeFolioSessionLogView() {
  return (
    <TimeFolioStoreProvider>
      <SessionLogPanel
        pageDescription="Track live study sessions, manual entries, and Auto-Tracking activity in one place."
        pageTitle="Session Log"
        showOverviewMetrics
      />
    </TimeFolioStoreProvider>
  );
}
