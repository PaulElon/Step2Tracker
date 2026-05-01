export function NotebookView() {
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-4">
      <section className="glass-panel overflow-hidden">
        <div className="rounded-[24px] border border-cyan-300/15 bg-gradient-to-br from-cyan-300/10 to-blue-400/5 p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Notebook</p>
          <h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">Notebook</h3>
          <p className="mt-2 text-base text-slate-300">Coming soon</p>
        </div>
      </section>

      <section className="panel-subtle flex min-h-[240px] items-center justify-center rounded-[22px] border border-dashed border-white/10 text-center">
        <div>
          <p className="text-lg font-semibold text-white">Notebook workspace is in progress.</p>
          <p className="mt-2 max-w-lg text-sm text-slate-300">
            This placeholder keeps navigation and gating stable while editing and storage are implemented in later
            phases.
          </p>
        </div>
      </section>
    </div>
  );
}
