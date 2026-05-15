import { Download, ExternalLink, Laptop, Monitor, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, primaryButtonClassName } from "../lib/ui";

const MAC_DOWNLOAD_URL =
  "https://github.com/PaulElon/Step2Tracker/releases/latest/download/TimeFolio-Study-Tracker-macOS-Apple-Silicon.app.tar.gz";
const WINDOWS_DOWNLOAD_URL =
  "https://github.com/PaulElon/Step2Tracker/releases/latest/download/TimeFolio-Study-Tracker-Windows-x64-Setup.exe";
const RELEASES_URL = "https://github.com/PaulElon/Step2Tracker/releases/latest";

function DownloadCard({
  title,
  description,
  icon: Icon,
  href,
  buttonLabel,
  buttonAriaLabel,
  steps,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  buttonLabel: string;
  buttonAriaLabel: string;
  steps: Array<{ label: string; body?: string; code?: string }>;
}) {
  return (
    <article className="panel-subtle flex h-full flex-col gap-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] text-cyan-200">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">{title}</p>
          <p className="mt-2 text-sm text-slate-300">{description}</p>
        </div>
      </div>

      <a
        href={href}
        className={cn(primaryButtonClassName, "w-full")}
        aria-label={buttonAriaLabel}
      >
        <Download className="h-4 w-4" />
        {buttonLabel}
      </a>

      <div className="space-y-3 rounded-[22px] border border-white/10 bg-slate-950/45 p-4">
        <p className="text-sm font-semibold text-white">{title}</p>
        <ul className="space-y-3 text-sm text-slate-300">
          {steps.map((step) => (
            <li key={step.label} className="space-y-1">
              <p className="font-medium text-slate-100">{step.label}</p>
              {step.body ? <p>{step.body}</p> : null}
              {step.code ? (
                <code className="block overflow-x-auto rounded-[14px] border border-white/10 bg-slate-950/75 px-3 py-2 font-mono text-[12px] text-slate-200">
                  {step.code}
                </code>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function PublicLandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(96,243,223,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(122,184,255,0.14),transparent_28%),linear-gradient(180deg,var(--app-bg-1),var(--app-bg-2)_55%,var(--app-bg-3))] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(24,214,176,0.1),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(92,116,255,0.08),transparent_26%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-6 md:px-8 md:py-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.04] shadow-[0_12px_40px_rgba(2,8,18,0.45)]">
              <ShieldCheck className="h-5 w-5 text-cyan-200" />
            </div>
            <div>
              <p className="text-[0.62rem] uppercase tracking-[0.22em] text-slate-500">TimeFolio</p>
              <p className="text-sm font-semibold text-white">Study Tracker</p>
            </div>
          </div>

          <a
            href={RELEASES_URL}
            className="hidden items-center gap-1.5 text-sm text-slate-300 transition hover:text-white sm:inline-flex"
            aria-label="View all TimeFolio releases manually"
          >
            View all releases manually
            <ExternalLink className="h-4 w-4" />
          </a>
        </header>

        <main className="flex flex-1 flex-col justify-center py-8 md:py-12">
          <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="max-w-2xl space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200">
                <ShieldCheck className="h-3.5 w-3.5 text-cyan-200" />
                Local-first desktop app. No account required for core study tracking.
              </div>

              <div className="space-y-4">
                <h1 className="text-4xl font-semibold tracking-[-0.05em] text-white sm:text-5xl lg:text-6xl">
                  Download TimeFolio Study Tracker directly from the latest release.
                </h1>
                <p className="max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
                  Get the Mac or Windows desktop app with a direct asset link. Install steps are
                  listed below so the process stays clear without reading a README.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <a
                  href={MAC_DOWNLOAD_URL}
                  className={cn(primaryButtonClassName, "w-full sm:w-auto")}
                  aria-label="Download TimeFolio Study Tracker for Mac"
                >
                  <Download className="h-4 w-4" />
                  Download for Mac
                </a>
                <a
                  href={WINDOWS_DOWNLOAD_URL}
                  className={cn(primaryButtonClassName, "w-full sm:w-auto")}
                  aria-label="Download TimeFolio Study Tracker for Windows"
                >
                  <Monitor className="h-4 w-4" />
                  Download for Windows
                </a>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="panel-subtle">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Direct assets</p>
                  <p className="mt-2 text-sm text-slate-300">
                    Buttons fetch the release binaries directly, not the GitHub Releases page.
                  </p>
                </div>
                <div className="panel-subtle">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Manual fallback</p>
                  <p className="mt-2 text-sm text-slate-300">
                    Use the release listing if you want older builds or another artifact.
                  </p>
                </div>
              </div>

              <a
                href={RELEASES_URL}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white sm:hidden"
                aria-label="View all TimeFolio releases manually"
              >
                View all releases manually
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="glass-panel space-y-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Install center</p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Choose your desktop build</h2>
                </div>
                <div className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-100">
                  Latest release
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="text-sm font-semibold text-white">Mac</p>
                  <p className="mt-1 text-sm text-slate-300">Apple Silicon download for macOS.</p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-slate-950/35 p-4">
                  <p className="text-sm font-semibold text-white">Windows</p>
                  <p className="mt-1 text-sm text-slate-300">x64 installer for Windows desktop.</p>
                </div>
              </div>

              <div className="rounded-[22px] border border-white/10 bg-slate-950/45 p-4">
                <p className="text-sm font-semibold text-white">What you get</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  <li>Local-first desktop app with no core-study account requirement.</li>
                  <li>Direct release asset downloads from GitHub.</li>
                  <li>Installation notes for first launch warnings and SmartScreen prompts.</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-2">
            <DownloadCard
              title="Mac installation"
              description="Use this if you are installing on an Apple Silicon Mac."
              icon={Laptop}
              href={MAC_DOWNLOAD_URL}
              buttonLabel="Download for Mac"
              buttonAriaLabel="Download TimeFolio Study Tracker for Mac"
              steps={[
                {
                  label: "1. Download the Mac app.",
                },
                {
                  label: "2. Open the downloaded file and move TimeFolio Study Tracker to Applications if prompted.",
                },
                {
                  label: "3. Because the app is currently not Apple-notarized, macOS may warn on first launch.",
                },
                {
                  label: "4. If blocked, right-click TimeFolio Study Tracker.app and choose Open, then confirm.",
                },
                {
                  label: "5. If macOS still blocks it, run:",
                  code: 'xattr -dr com.apple.quarantine "/Applications/TimeFolio Study Tracker.app"',
                },
              ]}
            />

            <DownloadCard
              title="Windows installation"
              description="Use this for the Windows x64 desktop installer."
              icon={Monitor}
              href={WINDOWS_DOWNLOAD_URL}
              buttonLabel="Download for Windows"
              buttonAriaLabel="Download TimeFolio Study Tracker for Windows"
              steps={[
                {
                  label: "1. Download the Windows installer.",
                },
                {
                  label: "2. Open the downloaded installer.",
                },
                {
                  label: "3. If Windows SmartScreen appears, choose More info → Run anyway.",
                },
                {
                  label: "4. Follow the installer prompts.",
                },
                {
                  label: "5. Launch TimeFolio Study Tracker from the Start Menu or desktop shortcut if created.",
                },
              ]}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
