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
  tone: "loading" | "error" | "info";
  title: string;
  message: string;
}) {
  const toneClass =
    tone === "error"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
      : tone === "info"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
        : "border-slate-700 bg-slate-900/60 text-slate-100";
  const messageClass =
    tone === "error" ? "text-rose-100/90" : tone === "info" ? "text-amber-100/90" : "text-slate-300";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${toneClass}`}>
      <p className="font-medium">{title}</p>
      <p className={`mt-1 ${messageClass}`}>{message}</p>
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

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-5">
      <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function getIdentityValue(account: {
  email: string | null;
  username: string | null;
}) {
  if (account.email) {
    return account.email;
  }

  if (account.username) {
    return account.username;
  }

  return "No email or username connected";
}

function getIdentitySubtext(account: {
  email: string | null;
  username: string | null;
}) {
  if (account.email && account.username) {
    return `Email and username are both present. Username: ${account.username}`;
  }

  if (account.email) {
    return "Username is not set in the local snapshot.";
  }

  if (account.username) {
    return "Email is not set in the local snapshot.";
  }

  return "Signed out / no account connected.";
}

export function AccountPanel() {
  const { state, isLoading, error } = useTimeFolioStore();
  const account = state.account;

  if (isLoading) {
    return (
      <PanelShell
        title="Account"
        subtitle="Local-only account snapshot for this app. No billing, cloud sync, or network account connection is active yet."
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
        title="Account"
        subtitle="Local-only account snapshot for this app. No billing, cloud sync, or network account connection is active yet."
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
      title="Account"
      subtitle="Local-only account snapshot for this app. No billing, cloud sync, or network account connection is active yet."
    >
      <div className="flex flex-col gap-5">
        {account === null ? (
          <StatusBanner
            tone="info"
            title="Not connected yet"
            message="This is a local-only, read-only account snapshot. Study Tracker and TimeFolio local data continue to work offline."
          />
        ) : (
          <StatusBanner
            tone="info"
            title="Connected locally"
            message="This panel is reading the local account snapshot only. No billing, cloud sync, or network calls are wired in."
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <DetailCard
            label="Current local account state"
            value={account === null ? "Signed out / no account connected" : "Connected locally"}
            subtext="This is a read-only snapshot from the local TimeFolio store."
          />
          <DetailCard
            label="Identity"
            value={account ? getIdentityValue(account) : "No email or username connected"}
            subtext={account ? getIdentitySubtext(account) : "Signed out / no account connected."}
          />
          <DetailCard
            label="Email verified"
            value={account ? (account.emailVerified ? "Verified" : "Not verified") : "Not available"}
            subtext="Verification status is shown only when an account snapshot exists."
          />
          <DetailCard
            label="Plan tier"
            value={account ? (account.planTier === "pro" ? "Pro" : "Free") : "Not available"}
            subtext="Plan state is shown only as part of the local snapshot."
          />
          <DetailCard
            label="Sync ID"
            value={account?.syncId ?? "Not set"}
            subtext={account?.syncId ? "Local sync reference." : "No sync identifier is available yet."}
          />
          <DetailCard
            label="Billing customer ID"
            value={account?.billingCustomerId ?? "Not set"}
            subtext={
              account?.billingCustomerId
                ? "Stored as a local placeholder reference only."
                : "No billing customer is linked yet."
            }
          />
        </div>

        {account === null ? (
          <SectionCard
            title="Planned later"
            description="These surfaces are intentionally paused while the merge is in progress."
          >
            <ul className="space-y-2 text-sm leading-6 text-slate-300">
              <li>account sync</li>
              <li>billing / plan status</li>
              <li>Auto-Tracker entitlement checks</li>
            </ul>
          </SectionCard>
        ) : (
          <SectionCard
            title="Planned later"
            description="These surfaces remain paused even when a local account snapshot is present."
          >
            <ul className="space-y-2 text-sm leading-6 text-slate-300">
              <li>account sync</li>
              <li>billing / plan status</li>
              <li>Auto-Tracker entitlement checks</li>
            </ul>
          </SectionCard>
        )}
      </div>
    </PanelShell>
  );
}
