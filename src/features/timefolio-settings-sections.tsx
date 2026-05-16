import { TimeFolioStoreProvider } from "../state/tf-store";
import { AccountPanel } from "./timefolio/account-panel";
import { TrackerSettingsPanel } from "./timefolio/tracker-settings-panel";

export function TimeFolioSettingsSections() {
  return (
    <TimeFolioStoreProvider>
      <div className="space-y-4">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.025] px-5 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Study Time</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Tracker & Account</h3>
          <p className="mt-1 text-sm text-slate-400">
            Manage local tracker rules and review the current device-only account snapshot without leaving Settings.
          </p>
        </div>
        <TrackerSettingsPanel embedded />
        <AccountPanel embedded />
      </div>
    </TimeFolioStoreProvider>
  );
}
