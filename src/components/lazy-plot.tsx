import { lazy, Suspense } from "react";
import type { CSSProperties, ComponentType } from "react";
import createPlotlyComponentModule from "react-plotly.js/factory";
import type { PlotParams } from "react-plotly.js";
import { cn } from "../lib/ui";

type PlotFactory = (plotly: object) => ComponentType<PlotParams>;

function isPlotFactory(value: unknown): value is PlotFactory {
  return typeof value === "function";
}

function resolvePlotFactory(value: unknown) {
  if (isPlotFactory(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "default" in value &&
    isPlotFactory((value as { default?: unknown }).default)
  ) {
    return (value as { default: PlotFactory }).default;
  }

  throw new Error("Unable to load the Plotly React factory.");
}

const plotFactory = resolvePlotFactory(createPlotlyComponentModule);

const PlotComponent = lazy(async () => {
  const plotlyModule = await import("plotly.js-basic-dist-min");

  return {
    default: plotFactory(plotlyModule.default),
  };
});

export function LazyPlot({
  className,
  style,
  config,
  ...props
}: PlotParams & { className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("min-w-0", className)}>
      <Suspense
        fallback={
          <div className="flex h-full min-h-[240px] items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.02] text-sm text-slate-500">
            Rendering analytics…
          </div>
        }
      >
        <PlotComponent
          {...props}
          style={{ width: "100%", height: "100%", ...style }}
          config={{
            displayModeBar: false,
            displaylogo: false,
            responsive: true,
            ...config,
          }}
          useResizeHandler
        />
      </Suspense>
    </div>
  );
}
