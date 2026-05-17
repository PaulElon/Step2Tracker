import { TimeFolioStoreProvider } from "../state/tf-store";
import { SessionLogPanel } from "./timefolio/session-log-panel";

export function TimeFolioSessionLogView() {
  return (
    <TimeFolioStoreProvider>
      <SessionLogPanel
        pageTitle="Session Log"
        showOverviewMetrics
      />
    </TimeFolioStoreProvider>
  );
}
