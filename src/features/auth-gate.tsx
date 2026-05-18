import { useState, useEffect } from "react";
import { createAccount, verifyAccount, accountCount } from "../lib/accounts";
import { useAuthSession } from "../state/auth-session";
import { fieldClassName, primaryButtonClassName } from "../lib/ui";

type Mode = "welcome" | "signup" | "login";

function mapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("MULTI_PROFILE_NOT_READY")) return "This device already has a local TimeFolio account. Multi-profile support is coming soon. Please log in to continue.";
  if (msg.includes("EMAIL_IN_USE")) return "Email already in use.";
  if (msg.includes("INVALID_EMAIL")) return "Enter a valid email address.";
  if (msg.includes("PASSWORD_TOO_SHORT")) return "Password must be at least 10 characters.";
  if (msg.includes("PASSWORD_REQUIRES_NUMBER")) return "Password must include at least one number.";
  if (msg.includes("PASSWORD_REQUIRES_SPECIAL")) return "Password must include at least one special character.";
  if (msg.includes("INVALID_CREDENTIALS")) return "Incorrect email or password.";
  return msg || "Something went wrong. Please try again.";
}

function validatePasswordClient(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/\d/.test(password)) return "Password must include at least one number.";
  if (!/[^a-zA-Z0-9]/.test(password)) return "Password must include at least one special character.";
  return null;
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="rounded-[14px] border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
      {message}
    </p>
  );
}

export function AuthGate() {
  const auth = useAuthSession();
  const [mode, setMode] = useState<Mode>("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  // null = still loading; true = account already exists on this device
  const [accountExists, setAccountExists] = useState<boolean | null>(null);

  useEffect(() => {
    accountCount()
      .then((n) => setAccountExists(n > 0))
      .catch(() => setAccountExists(false));
  }, []);

  function reset(next: Mode) {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    setLoading(false);
    setMode(next);
  }

  async function handleSignUp() {
    setError(null);
    const clientErr = validatePasswordClient(password);
    if (clientErr) { setError(clientErr); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const account = await createAccount({ email, password });
      setSuccess(true);
      window.setTimeout(() => auth.login(account), 2000);
    } catch (err) {
      const mapped = mapError(err);
      setError(mapped);
      setLoading(false);
      if (String(err).includes("MULTI_PROFILE_NOT_READY")) {
        setAccountExists(true);
        window.setTimeout(() => reset("login"), 2000);
      }
    }
  }

  async function handleLogIn() {
    setError(null);
    setLoading(true);
    try {
      const account = await verifyAccount({ email, password });
      auth.login(account);
    } catch (err) {
      setError(mapError(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="glass-panel w-full max-w-sm">
        {mode === "welcome" && (
          <div className="flex flex-col items-center gap-6 text-center">
            <div>
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-white">
                Welcome to TimeFolio
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Your local-first study tracker.
              </p>
            </div>
            {accountExists ? (
              <div className="flex w-full flex-col gap-4">
                <p className="text-sm text-slate-300">
                  This device already has a local TimeFolio account. Multi-profile support is coming soon. Please log in to continue.
                </p>
                <button
                  type="button"
                  className={`${primaryButtonClassName} w-full`}
                  onClick={() => reset("login")}
                >
                  Log in
                </button>
              </div>
            ) : (
              <div className="flex w-full flex-col gap-3">
                <button
                  type="button"
                  className={`${primaryButtonClassName} w-full`}
                  onClick={() => reset("signup")}
                  disabled={accountExists === null}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  className="secondary-button w-full"
                  onClick={() => reset("login")}
                >
                  Log in
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "signup" && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                Create account
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Local to this device.
              </p>
            </div>

            {success ? (
              <div className="flex flex-col items-center gap-2 rounded-[16px] border border-emerald-500/25 bg-emerald-500/10 px-4 py-5 text-center">
                <p className="text-base font-semibold text-emerald-200">Account Created</p>
                <p className="text-sm text-emerald-100">Welcome to TimeFolio!</p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <input
                    type="email"
                    placeholder="Email"
                    autoComplete="email"
                    value={email}
                    className={fieldClassName}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSignUp(); }}
                    disabled={loading}
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    autoComplete="new-password"
                    value={password}
                    className={fieldClassName}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSignUp(); }}
                    disabled={loading}
                  />
                  <input
                    type="password"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    className={fieldClassName}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleSignUp(); }}
                    disabled={loading}
                  />
                </div>

                <p className="text-xs leading-5 text-slate-500">
                  Password: 10+ characters, at least one number, at least one special character.
                </p>

                {error ? <InlineError message={error} /> : null}

                <button
                  type="button"
                  className={`${primaryButtonClassName} w-full`}
                  onClick={() => void handleSignUp()}
                  disabled={loading}
                >
                  {loading ? "Creating account…" : "Create account"}
                </button>

                <div className="rounded-[14px] border border-white/8 bg-slate-950/30 px-3 py-2.5">
                  <p className="text-xs leading-5 text-slate-500">
                    Email verification will be added in a future update. This account is local to this device for now.
                  </p>
                </div>
              </>
            )}

            <button
              type="button"
              className="text-sm text-slate-400 hover:text-slate-200 transition"
              onClick={() => reset("welcome")}
              disabled={loading || success}
            >
              ← Back
            </button>
          </div>
        )}

        {mode === "login" && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-white">
                Log in
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Welcome back.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="Email"
                autoComplete="email"
                value={email}
                className={fieldClassName}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleLogIn(); }}
                disabled={loading}
              />
              <input
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={password}
                className={fieldClassName}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleLogIn(); }}
                disabled={loading}
              />
            </div>

            {error ? <InlineError message={error} /> : null}

            <button
              type="button"
              className={`${primaryButtonClassName} w-full`}
              onClick={() => void handleLogIn()}
              disabled={loading}
            >
              {loading ? "Logging in…" : "Log in"}
            </button>

            <button
              type="button"
              className="text-sm text-slate-400 hover:text-slate-200 transition"
              onClick={() => reset("welcome")}
              disabled={loading}
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
