import { useState, useEffect, type ReactNode } from "react";
import { useTimeFolioStore } from "../../state/tf-store";
import {
  getDeviceMetadata,
  parseCloudLinkState,
  setCloudLink,
  clearCloudLink,
  loadNativeSnapshot,
  getLastSyncedAt,
  setLastSyncedAt,
} from "../../lib/native-persistence";
import {
  loginToCloud,
  refreshCloudToken,
  registerDevice,
  pushAllEntities,
} from "../../lib/cloud-sync-manager";

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
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
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
      <div className="text-[11px] font-medium text-slate-500">{title}</div>
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

  return "No local identity available";
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

  return "No local account snapshot is present.";
}

type CloudPhase = "loading" | "unlinked" | "connecting" | "expired" | "linked" | "syncing";

function getOrCreateLocalDeviceId(): string {
  try {
    const stored = localStorage.getItem("tf_device_id");
    if (stored) return stored;
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
          });
    localStorage.setItem("tf_device_id", id);
    return id;
  } catch {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
}

function CloudSyncSection() {
  const [phase, setPhase] = useState<CloudPhase>("loading");
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [nativeDeviceId] = useState<string>(() => getOrCreateLocalDeviceId());
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    getDeviceMetadata()
      .then(async (meta) => {
        const link = parseCloudLinkState(meta.cloudLinkState);
        if (link) {
          setLinkedEmail(link.email);
          if (link.cloudRefreshToken) {
            try {
              const refreshed = await refreshCloudToken(link.cloudRefreshToken);
              await setCloudLink(link.cloudUserId, link.email, refreshed.refreshToken);
              setToken(refreshed.token);
              setPhase("linked");
            } catch {
              await setCloudLink(link.cloudUserId, link.email, "");
              setToken(null);
              setPhase("expired");
            }
          } else {
            setToken(null);
            setPhase("expired");
          }
        } else {
          setPhase("unlinked");
        }
      })
      .catch((err: unknown) => {
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setPhase("unlinked");
      });
  }, []);

  async function handleConnect(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!email || !password) return;
    setPhase("connecting");
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const auth = await loginToCloud(email, password);
      await registerDevice(auth.token, nativeDeviceId);
      await setCloudLink(auth.cloudUserId, email, auth.refreshToken);
      setToken(auth.token);
      setLinkedEmail(email);
      setEmail("");
      setPassword("");
      setPhase("linked");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("unlinked");
    }
  }

  async function handleSync() {
    if (!token) {
      setErrorMsg("Session expired. Disconnect and reconnect to sync.");
      return;
    }
    setPhase("syncing");
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const lastSyncedAt = await getLastSyncedAt();
      const syncStartedAt = new Date().toISOString();
      const snapshot = await loadNativeSnapshot();
      const result = await pushAllEntities(token, nativeDeviceId, snapshot.state, lastSyncedAt);
      await setLastSyncedAt(syncStartedAt);
      setStatusMsg(result.pushed === 0 ? "Already up to date." : `Synced ${result.pushed} entities.`);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase("linked");
    }
  }

  async function handleDisconnect() {
    await clearCloudLink();
    setToken(null);
    setLinkedEmail(null);
    setEmail("");
    setPassword("");
    setStatusMsg(null);
    setErrorMsg(null);
    setPhase("unlinked");
  }

  async function handleReconnect(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!linkedEmail || !password) return;
    setPhase("connecting");
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const auth = await loginToCloud(linkedEmail, password);
      await setCloudLink(auth.cloudUserId, linkedEmail, auth.refreshToken);
      setToken(auth.token);
      setPassword("");
      setPhase("linked");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase("expired");
    }
  }

  const isLinked = phase === "linked" || phase === "syncing";
  const isReconnectMode = phase === "expired" || (phase === "connecting" && linkedEmail !== null && email === "");
  const isBusy = phase === "connecting" || phase === "syncing" || phase === "loading";

  return (
    <SectionCard title="Cloud sync" description="Connect your cloud account to push local data to the sync server.">
      {errorMsg && (
        <div className="mb-4">
          <StatusBanner tone="error" title="Error" message={errorMsg} />
        </div>
      )}
      {statusMsg && (
        <div className="mb-4">
          <StatusBanner tone="info" title="Done" message={statusMsg} />
        </div>
      )}

      {phase === "loading" && (
        <p className="text-sm text-slate-400">Loading cloud link state…</p>
      )}

      {isLinked && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-4">
            <div className="text-[11px] font-medium text-slate-500">Connected as</div>
            <div className="mt-2 text-sm font-semibold text-slate-100">{linkedEmail}</div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isBusy || !token}
              onClick={() => void handleSync()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {phase === "syncing" ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
          {!token && (
            <p className="text-xs text-slate-500">Session expired — disconnect and reconnect to enable sync.</p>
          )}
        </div>
      )}

      {isReconnectMode && (
        <div className="flex flex-col gap-3">
          <DetailCard label="Connected as" value={linkedEmail ?? "Unknown account"} />
          <StatusBanner
            tone="info"
            title="Session expired"
            message="Re-enter your password to reconnect."
          />
          <form onSubmit={(e) => void handleReconnect(e)} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isBusy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {phase === "connecting" ? "Reconnecting…" : "Reconnect"}
            </button>
          </form>
          <div>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleDisconnect()}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      {(phase === "unlinked" || (phase === "connecting" && !isReconnectMode)) && (
        <form onSubmit={(e) => void handleConnect(e)} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={isBusy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {phase === "connecting" ? "Connecting…" : "Connect"}
          </button>
        </form>
      )}
    </SectionCard>
  );
}

function AccountContent() {
  const { state, isLoading, error } = useTimeFolioStore();
  const account = state.account;

  if (isLoading) {
    return (
      <StatusBanner
        tone="loading"
        title="Loading local TimeFolio account state"
        message="Showing the current read-only account snapshot from local state."
      />
    );
  }

  if (error) {
    return (
      <StatusBanner
        tone="error"
        title="Unable to load account state"
        message={error}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {account === null ? (
        <StatusBanner
          tone="info"
          title="Not connected yet"
          message="This is a local-only, read-only account snapshot. TimeFolio local data continues to work offline."
        />
      ) : (
        <StatusBanner
          tone="info"
          title="Connected locally"
          message="This panel shows the local account snapshot only. No network account connection is active."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DetailCard
          label="Current local account state"
          value={account === null ? "No local account snapshot is present." : "Connected locally"}
          subtext="This is a read-only snapshot from the local TimeFolio store."
        />
        <DetailCard
          label="Identity"
          value={account ? getIdentityValue(account) : "No local identity available"}
          subtext={account ? getIdentitySubtext(account) : "No local account snapshot is present."}
        />
        <DetailCard
          label="Email verified"
          value={account ? (account.emailVerified ? "Verified" : "Not verified") : "Not available"}
          subtext="Verification status is shown only when an account snapshot exists."
        />
        <DetailCard
          label="Access tier"
          value={account ? (account.planTier === "pro" ? "Pro" : "Free") : "Not available"}
          subtext="Plan state is shown only as part of the local snapshot."
        />
        <DetailCard
          label="Sync ID"
          value={account?.syncId ?? "Not set"}
          subtext={account?.syncId ? "Local sync reference." : "No sync identifier is available yet."}
        />
        <DetailCard
          label="Customer reference"
          value={account?.billingCustomerId ?? "Not set"}
          subtext={
            account?.billingCustomerId
              ? "Stored as a local placeholder reference only."
              : "No customer reference is set yet."
          }
        />
      </div>

      <SectionCard
        title="Deferred"
        description={
          account === null
            ? "These surfaces are intentionally paused while the merge is in progress."
            : "These surfaces remain paused even when a local account snapshot is present."
        }
      >
        <ul className="space-y-2 text-sm leading-6 text-slate-300">
          <li>account snapshot sync</li>
          <li>access tier status</li>
          <li>Auto-Tracker availability checks</li>
        </ul>
      </SectionCard>

      <CloudSyncSection />
    </div>
  );
}

export function AccountPanel({ embedded = false }: { embedded?: boolean }) {
  const title = "Account";
  const subtitle = "Local-only, read-only account snapshot for this app. No network account connection is active.";

  if (embedded) {
    return (
      <section className="rounded-[24px] border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/15">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>
        <AccountContent />
      </section>
    );
  }

  return (
    <PanelShell title={title} subtitle={subtitle}>
      <AccountContent />
    </PanelShell>
  );
}
