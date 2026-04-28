import type { ReactNode } from "react";
import { useTimeFolioStore } from "../../state/tf-store";

function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="p-8">
      <div className="flex flex-col gap-6 rounded-2xl border border-slate-700 bg-slate-900/80 p-6 shadow-lg shadow-black/20">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          <p className="text-sm leading-6 text-slate-400">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBanner({
  tone,
  title,
  message,
}: {
  tone: "loading" | "error";
  title: string;
  message: string;
}) {
  const toneClass =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
      : "border-slate-700 bg-slate-900/60 text-slate-100";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-slate-300">{message}</p>
    </div>
  );
}

function DetailCard({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string;
  subtext?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-sm font-semibold text-slate-100">{value}</div>
      {subtext ? <div className="mt-1 text-xs leading-5 text-slate-500">{subtext}</div> : null}
    </div>
  );
}

function DisabledChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-medium text-slate-400">
      {children}
    </span>
  );
}

export function AccountPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
  const account = state.account;

  if (isLoading) {
    return (
      <PanelShell
        title="Account / Billing"
        subtitle="Read-only account status for the TimeFolio integration."
      >
        <StatusBanner
          tone="loading"
          title="Loading local TimeFolio account state"
          message="Fetching the current account snapshot from the local store."
        />
      </PanelShell>
    );
  }

  if (error) {
    return (
      <PanelShell
        title="Account / Billing"
        subtitle="Read-only account status for the TimeFolio integration."
      >
        <StatusBanner
          tone="error"
          title="Unable to load account state"
          message={error}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell
      title="Account / Billing"
      subtitle="Read-only account status for the TimeFolio integration. Auth, billing, and sync actions will arrive later."
    >
      {account === null ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-5">
            <div className="text-sm font-semibold text-slate-100">Not signed in</div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Account sync and billing controls will be added later. This panel only
              shows local status for now.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <DisabledChip>Sign in coming soon</DisabledChip>
            <DisabledChip>Upgrade coming soon</DisabledChip>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">
              Planned capabilities
            </div>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
              <li>Account sync</li>
              <li>Plan &amp; billing</li>
              <li>Tracker access gating</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailCard
              label="Account"
              value={account.email ?? account.username ?? "Unknown account"}
              subtext={
                account.email
                  ? account.username
                    ? `Username: ${account.username}`
                    : "Email is the current display identity."
                  : account.username
                    ? "Username is the current display identity."
                    : "No email or username is available."
              }
            />
            <DetailCard
              label="Email verified"
              value={account.emailVerified ? "Verified" : "Not verified"}
              subtext="Read-only status from the TimeFolio account snapshot."
            />
            <DetailCard
              label="Plan tier"
              value={account.planTier.toUpperCase()}
              subtext="Billing changes will be added later."
            />
            <DetailCard
              label="Sync ID"
              value={account.syncId ?? "Not set"}
              subtext={account.syncId ? "Local sync reference." : "No sync identifier is available yet."}
            />
            <DetailCard
              label="Billing customer ID"
              value={account.billingCustomerId ?? "Not set"}
              subtext={
                account.billingCustomerId
                  ? "Placeholder billing reference only."
                  : "No billing customer has been linked yet."
              }
            />
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">
              Planned capabilities
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <DisabledChip>Account sync</DisabledChip>
              <DisabledChip>Plan &amp; billing</DisabledChip>
              <DisabledChip>Tracker access gating</DisabledChip>
            </div>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
