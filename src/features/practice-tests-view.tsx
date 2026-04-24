import { Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PlotRelayoutEvent } from "plotly.js";
import { LazyPlot } from "../components/lazy-plot";
import { getPracticeMetrics, getPracticeTrend, getTopicFrequency } from "../lib/analytics";
import { formatHoursValue, formatShortDate } from "../lib/datetime";
import { getEmptyPracticeTestDraft, validatePracticeTestInput } from "../lib/storage";
import {
  getPracticeTestLabel,
  getPracticeTestSourceOptions,
} from "../lib/practice-tests";
import { useAppStore } from "../state/app-store";
import { ModalShell } from "../components/modal-shell";
import { EmptyState, MetricCard, Panel } from "../components/ui";
import {
  fieldClassName,
  iconButtonClassName,
  cn,
  primaryButtonClassName,
  secondaryButtonClassName,
} from "../lib/ui";
import type { PracticeTest, PracticeTestInput } from "../types/models";

interface TrendRegression {
  slope: number;
  intercept: number;
  rSquared: number;
  points: number[];
}

function getTrendRegression(scores: number[]) {
  if (scores.length < 2) {
    return null;
  }

  const xs = scores.map((_, index) => index);
  const xMean = xs.reduce((total, value) => total + value, 0) / xs.length;
  const yMean = scores.reduce((total, value) => total + value, 0) / scores.length;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < scores.length; index += 1) {
    const centeredX = xs[index] - xMean;
    numerator += centeredX * (scores[index] - yMean);
    denominator += centeredX * centeredX;
  }

  if (denominator === 0) {
    return null;
  }

  const slope = numerator / denominator;
  const intercept = yMean - slope * xMean;
  const points = xs.map((value) => intercept + slope * value);

  const totalSumSquares = scores.reduce((total, value) => total + (value - yMean) ** 2, 0);
  const residualSumSquares = scores.reduce((total, value, index) => total + (value - points[index]) ** 2, 0);
  const rSquared = totalSumSquares === 0 ? 1 : Math.max(0, 1 - residualSumSquares / totalSumSquares);

  return {
    slope,
    intercept,
    rSquared,
    points,
  } satisfies TrendRegression;
}

function readAxisRanges(eventData: PlotRelayoutEvent): { xRange?: [string, string]; yRange?: [number, number] } {
  const nextRanges: { xRange?: [string, string]; yRange?: [number, number] } = {};

  const xStart = eventData["xaxis.range[0]"];
  const xEnd = eventData["xaxis.range[1]"];
  if (typeof xStart === "string" && typeof xEnd === "string") {
    nextRanges.xRange = [xStart, xEnd];
  } else if (eventData["xaxis.autorange"]) {
    nextRanges.xRange = undefined;
  }

  const yStart = eventData["yaxis.range[0]"];
  const yEnd = eventData["yaxis.range[1]"];
  if (typeof yStart === "number" && typeof yEnd === "number") {
    nextRanges.yRange = [yStart, yEnd];
  } else if (eventData["yaxis.autorange"]) {
    nextRanges.yRange = undefined;
  }

  return nextRanges;
}

function createInitialDraft(test?: PracticeTest) {
  if (!test) {
    const emptyDraft = getEmptyPracticeTestDraft();
    return {
      ...emptyDraft,
      questionCount: String(emptyDraft.questionCount),
      scorePercent: String(emptyDraft.scorePercent),
      minutesSpent: String(emptyDraft.minutesSpent),
      weakTopicsText: "",
      strongTopicsText: "",
    };
  }

  return {
    id: test.id,
    date: test.date,
    source: test.source,
    form: test.form,
    questionCount: String(test.questionCount),
    scorePercent: String(test.scorePercent),
    weakTopicsText: test.weakTopics.join(", "),
    strongTopicsText: test.strongTopics.join(", "),
    reflections: test.reflections,
    actionPlan: test.actionPlan,
    minutesSpent: String(test.minutesSpent),
  };
}

function splitTopics(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function PracticeTestEditorSheet({
  test,
  onClose,
  onSave,
}: {
  test?: PracticeTest;
  onClose: () => void;
  onSave: (draft: PracticeTestInput & { id?: string }) => void;
}) {
  const [draft, setDraft] = useState(createInitialDraft(test));
  const [errors, setErrors] = useState<
    Partial<Record<"date" | "questionCount" | "scorePercent" | "minutesSpent", string>>
  >({});
  const id = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const dateId = `${id}-date`;
  const dateErrorId = `${id}-date-error`;
  const sourceId = `${id}-source`;
  const formId = `${id}-form`;
  const questionCountId = `${id}-question-count`;
  const questionCountErrorId = `${id}-question-count-error`;
  const scorePercentId = `${id}-score-percent`;
  const scorePercentErrorId = `${id}-score-percent-error`;
  const minutesSpentId = `${id}-minutes-spent`;
  const minutesErrorId = `${id}-minutes-error`;
  const weakTopicsId = `${id}-weak-topics`;
  const strongTopicsId = `${id}-strong-topics`;
  const reflectionId = `${id}-reflection`;
  const actionPlanId = `${id}-action-plan`;

  return (
    <ModalShell
      onClose={onClose}
      position="side"
      titleId={titleId}
      descriptionId={descriptionId}
      initialFocusRef={dateRef}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
            {test ? "Edit test" : "New test"}
          </p>
          <h3 id={titleId} className="mt-2 text-2xl font-semibold text-white">
            {test ? getPracticeTestLabel(test) : "Log test"}
          </h3>
          <p id={descriptionId} className="mt-2 text-sm text-slate-400">
            Score, topics, follow-up.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={secondaryButtonClassName}
          aria-label="Close practice test editor"
        >
          Close
        </button>
      </div>

      <form
        noValidate
        className="mt-8 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          const payload = {
            id: draft.id,
            date: draft.date,
            source: draft.source,
            form: draft.form,
            questionCount: Number(draft.questionCount),
            scorePercent: Number(draft.scorePercent),
            weakTopics: splitTopics(draft.weakTopicsText),
            strongTopics: splitTopics(draft.strongTopicsText),
            reflections: draft.reflections,
            actionPlan: draft.actionPlan,
            minutesSpent: Number(draft.minutesSpent),
          };
          const nextErrors = validatePracticeTestInput(payload);

          if (Object.keys(nextErrors).length) {
            setErrors(nextErrors);
            return;
          }

          onSave(payload);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={dateId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Date
            </label>
            <input
              ref={dateRef}
              id={dateId}
              type="date"
              value={draft.date}
              onChange={(event) => {
                setDraft((current) => ({ ...current, date: event.target.value }));
                setErrors((current) => ({ ...current, date: undefined }));
              }}
              aria-describedby={errors.date ? dateErrorId : undefined}
              aria-invalid={Boolean(errors.date)}
              className={`${fieldClassName} mt-2`}
            />
            {errors.date ? (
              <p id={dateErrorId} className="mt-2 text-sm text-rose-300">
                {errors.date}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={sourceId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Source
            </label>
            <select
              id={sourceId}
              value={draft.source}
              onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
              className={`${fieldClassName} mt-2`}
            >
              {getPracticeTestSourceOptions().map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={formId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Form
            </label>
            <input
              id={formId}
              value={draft.form}
              onChange={(event) => setDraft((current) => ({ ...current, form: event.target.value }))}
              className={`${fieldClassName} mt-2`}
              placeholder="13, UWSA 2"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={questionCountId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Questions
            </label>
            <input
              id={questionCountId}
              type="number"
              min={1}
              value={draft.questionCount}
              onChange={(event) => {
                setDraft((current) => ({ ...current, questionCount: event.target.value }));
                setErrors((current) => ({ ...current, questionCount: undefined }));
              }}
              aria-describedby={errors.questionCount ? questionCountErrorId : undefined}
              aria-invalid={Boolean(errors.questionCount)}
              className={`${fieldClassName} mt-2`}
            />
            {errors.questionCount ? (
              <p id={questionCountErrorId} className="mt-2 text-sm text-rose-300">
                {errors.questionCount}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={scorePercentId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Score %
            </label>
            <input
              id={scorePercentId}
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={draft.scorePercent}
              onChange={(event) => {
                setDraft((current) => ({ ...current, scorePercent: event.target.value }));
                setErrors((current) => ({ ...current, scorePercent: undefined }));
              }}
              aria-describedby={errors.scorePercent ? scorePercentErrorId : undefined}
              aria-invalid={Boolean(errors.scorePercent)}
              className={`${fieldClassName} mt-2`}
            />
            {errors.scorePercent ? (
              <p id={scorePercentErrorId} className="mt-2 text-sm text-rose-300">
                {errors.scorePercent}
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor={minutesSpentId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
              Minutes
            </label>
            <input
              id={minutesSpentId}
              type="number"
              min={0}
              value={draft.minutesSpent}
              onChange={(event) => {
                setDraft((current) => ({ ...current, minutesSpent: event.target.value }));
                setErrors((current) => ({ ...current, minutesSpent: undefined }));
              }}
              aria-describedby={errors.minutesSpent ? minutesErrorId : undefined}
              aria-invalid={Boolean(errors.minutesSpent)}
              className={`${fieldClassName} mt-2`}
            />
            {errors.minutesSpent ? (
              <p id={minutesErrorId} className="mt-2 text-sm text-rose-300">
                {errors.minutesSpent}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <label htmlFor={weakTopicsId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Weak topics
          </label>
          <input
            id={weakTopicsId}
            value={draft.weakTopicsText}
            onChange={(event) => setDraft((current) => ({ ...current, weakTopicsText: event.target.value }))}
            className={`${fieldClassName} mt-2`}
            placeholder="Cardio murmurs, ethics"
          />
        </div>

        <div>
          <label htmlFor={strongTopicsId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Strong topics
          </label>
          <input
            id={strongTopicsId}
            value={draft.strongTopicsText}
            onChange={(event) => setDraft((current) => ({ ...current, strongTopicsText: event.target.value }))}
            className={`${fieldClassName} mt-2`}
            placeholder="Renal, ID"
          />
        </div>

        <div>
          <label htmlFor={reflectionId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Reflection
          </label>
          <textarea
            id={reflectionId}
            value={draft.reflections}
            onChange={(event) => setDraft((current) => ({ ...current, reflections: event.target.value }))}
            className={`${fieldClassName} mt-2 min-h-[120px] resize-none`}
          />
        </div>

        <div>
          <label htmlFor={actionPlanId} className="text-xs uppercase tracking-[0.18em] text-slate-500">
            Action plan
          </label>
          <textarea
            id={actionPlanId}
            value={draft.actionPlan}
            onChange={(event) => setDraft((current) => ({ ...current, actionPlan: event.target.value }))}
            className={`${fieldClassName} mt-2 min-h-[140px] resize-none`}
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-4">
          <button type="button" className={secondaryButtonClassName} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClassName}>
            Save test
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function PracticeTestsView() {
  const { state, trashPracticeTest, upsertPracticeTest } = useAppStore();
  const [editorTest, setEditorTest] = useState<PracticeTest | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [showChartSettings, setShowChartSettings] = useState(false);
  const [showConnectionLine, setShowConnectionLine] = useState(true);
  const [showBestFitLine, setShowBestFitLine] = useState(false);
  const [showBestFitRSquared, setShowBestFitRSquared] = useState(false);
  const [chartRanges, setChartRanges] = useState<{ xRange?: [string, string]; yRange?: [number, number] }>({});
  const settingsRef = useRef<HTMLDivElement>(null);
  const metrics = getPracticeMetrics(state.practiceTests);
  const scoreTrend = useMemo(() => getPracticeTrend(state.practiceTests), [state.practiceTests]);
  const trendRegression = useMemo(
    () => getTrendRegression(scoreTrend.map((point) => point.score)),
    [scoreTrend],
  );
  const weakPatterns = useMemo(() => getTopicFrequency(state.practiceTests, "weak"), [state.practiceTests]);
  const strongPatterns = useMemo(() => getTopicFrequency(state.practiceTests, "strong"), [state.practiceTests]);
  const orderedTests = useMemo(
    () => [...state.practiceTests].sort((left, right) => right.date.localeCompare(left.date)),
    [state.practiceTests],
  );

  useEffect(() => {
    if (!showChartSettings) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (settingsRef.current?.contains(event.target as Node)) {
        return;
      }

      setShowChartSettings(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showChartSettings]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Average"
          value={metrics.averageScore == null ? "Awaiting log" : `${metrics.averageScore.toFixed(1)}%`}
          meta={metrics.averageScore == null ? "No tests yet" : `${state.practiceTests.length} logged`}
        />
        <MetricCard
          label="Best"
          value={metrics.bestScore == null ? "—" : `${metrics.bestScore.toFixed(1)}%`}
          meta="Highest score"
        />
        <MetricCard
          label="Latest"
          value={metrics.latestScore == null ? "—" : `${metrics.latestScore.toFixed(1)}%`}
          meta="Most recent result"
        />
        <MetricCard
          label="Load"
          value={metrics.totalQuestions ? `${metrics.totalQuestions} Qs` : "0 Qs"}
          meta={metrics.totalMinutes ? formatHoursValue(metrics.totalMinutes) : "No time logged"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Panel
          title={
            <div ref={settingsRef} className="relative flex items-center gap-2">
              <span>Score trend</span>
              <button
                type="button"
                className={cn(iconButtonClassName, "h-9 w-9")}
                aria-label="Open score trend chart settings"
                aria-haspopup="dialog"
                aria-expanded={showChartSettings}
                onClick={() => setShowChartSettings((current) => !current)}
              >
                <Settings2 className="h-4 w-4" />
              </button>
              {showChartSettings ? (
                <div className="absolute left-0 top-full z-20 mt-3 w-[248px] rounded-[20px] border border-white/10 bg-[#081220]/95 p-4 shadow-[0_18px_48px_rgba(2,8,23,0.5)] backdrop-blur-xl">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Chart settings</p>
                  <div className="mt-4 space-y-3">
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-200">
                      <span>Connect dots</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cyan-300"
                        checked={showConnectionLine}
                        onChange={(event) => setShowConnectionLine(event.target.checked)}
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-200">
                      <span>Line of best fit</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cyan-300"
                        checked={showBestFitLine}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setShowBestFitLine(checked);
                          if (!checked) {
                            setShowBestFitRSquared(false);
                          }
                        }}
                        disabled={!trendRegression}
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-200">
                      <span>Show R²</span>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-cyan-300"
                        checked={showBestFitRSquared}
                        onChange={(event) => setShowBestFitRSquared(event.target.checked)}
                        disabled={!showBestFitLine || !trendRegression}
                      />
                    </label>
                  </div>
                  {!trendRegression ? (
                    <p className="mt-3 text-xs text-slate-500">Log at least two tests to enable regression.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          }
          action={
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                setEditorTest(undefined);
                setShowEditor(true);
              }}
            >
              <Plus className="h-4 w-4" />
              Log test
            </button>
          }
        >
          {scoreTrend.length ? (
            <div className="relative">
              {showBestFitLine && showBestFitRSquared && trendRegression ? (
                <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full border border-cyan-300/20 bg-slate-950/80 px-3 py-1 text-xs font-medium tracking-[0.04em] text-cyan-100">
                  R² {trendRegression.rSquared.toFixed(3)}
                </div>
              ) : null}
              <LazyPlot
                className="h-[280px]"
                data={[
                  {
                    x: scoreTrend.map((point) => point.date),
                    y: scoreTrend.map((point) => point.score),
                    customdata: scoreTrend.map((point) => point.label),
                    type: "scatter" as const,
                    mode: showConnectionLine ? ("lines+markers" as const) : ("markers" as const),
                    line: {
                      color: "#67e8f9",
                      width: 3,
                    },
                    marker: {
                      color: "#f8fafc",
                      size: 8,
                      line: {
                        color: "#67e8f9",
                        width: 2,
                      },
                    },
                    hovertemplate: "%{customdata}<br>%{y:.1f}%<extra></extra>",
                  },
                  ...(showBestFitLine && trendRegression
                    ? [
                        {
                          x: scoreTrend.map((point) => point.date),
                          y: trendRegression.points,
                          type: "scatter" as const,
                          mode: "lines" as const,
                          line: {
                            color: "#f59e0b",
                            width: 2,
                            dash: "dash" as const,
                          },
                          hovertemplate:
                            "Best fit<br>%{x|%b %-d}<br>%{y:.1f}%<extra></extra>",
                        },
                      ]
                    : []),
                ]}
                layout={{
                  autosize: true,
                  paper_bgcolor: "transparent",
                  plot_bgcolor: "transparent",
                  margin: { l: 44, r: 16, t: 12, b: 44 },
                  showlegend: false,
                  dragmode: "zoom",
                  xaxis: {
                    type: "date",
                    range: chartRanges.xRange,
                    tickfont: { color: "#94a3b8", size: 11 },
                    gridcolor: "rgba(148, 163, 184, 0.08)",
                    automargin: true,
                    fixedrange: false,
                    tickformat: "%b %-d",
                  },
                  yaxis: {
                    range: chartRanges.yRange ?? [0, 100],
                    ticksuffix: "%",
                    tickfont: { color: "#94a3b8", size: 11 },
                    gridcolor: "rgba(148, 163, 184, 0.08)",
                    zeroline: false,
                    fixedrange: false,
                  },
                }}
                config={{
                  scrollZoom: true,
                  doubleClick: "reset",
                }}
                onRelayout={(eventData) => {
                  setChartRanges((current) => ({
                    ...current,
                    ...readAxisRanges(eventData),
                  }));
                }}
              />
            </div>
          ) : (
            <EmptyState title="No tests yet" description="Log a test to start the score line." compact />
          )}
        </Panel>

        <Panel title="Topic patterns">
          {weakPatterns.length || strongPatterns.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="panel-subtle p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Weak topics</p>
                <div className="mt-4 space-y-3">
                  {weakPatterns.length ? (
                    weakPatterns.slice(0, 5).map((topic) => (
                      <div key={`weak-${topic.topic}`} className="flex items-center justify-between gap-4">
                        <p className="text-sm text-slate-200">{topic.topic}</p>
                        <p className="text-sm font-semibold text-white">{topic.count}x</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">No weak-topic signal yet.</p>
                  )}
                </div>
              </div>
              <div className="panel-subtle p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Strong topics</p>
                <div className="mt-4 space-y-3">
                  {strongPatterns.length ? (
                    strongPatterns.slice(0, 5).map((topic) => (
                      <div key={`strong-${topic.topic}`} className="flex items-center justify-between gap-4">
                        <p className="text-sm text-slate-200">{topic.topic}</p>
                        <p className="text-sm font-semibold text-white">{topic.count}x</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-slate-400">No strong-topic signal yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title="No topic patterns yet" description="Topics will stack up as you log tests." compact />
          )}
        </Panel>
      </div>

      <Panel title="History">
          {orderedTests.length ? (
            <div className="max-h-[calc(100vh-22rem)] overflow-auto scrollbar-subtle rounded-[24px] border border-white/10 bg-slate-950/35">
              <table className="w-full min-w-[960px] text-left">
                <thead className="sticky top-0 border-b border-white/10 bg-[#081220]/95 text-xs uppercase tracking-[0.18em] text-slate-400">
                  <tr>
                    <th className="px-4 py-4 font-medium">Date</th>
                    <th className="px-4 py-4 font-medium">Test</th>
                    <th className="px-4 py-4 font-medium">Score</th>
                    <th className="px-4 py-4 font-medium">Weak topics</th>
                    <th className="px-4 py-4 font-medium">Action plan</th>
                    <th className="px-4 py-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedTests.map((test) => (
                    <tr key={test.id} className="border-b border-white/6 align-top text-sm last:border-none">
                      <td className="px-4 py-4 text-slate-300">{formatShortDate(test.date)}</td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-white">{getPracticeTestLabel(test)}</div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-white">{test.scorePercent.toFixed(1)}%</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {test.questionCount} questions · {test.minutesSpent} min
                        </div>
                      </td>
                      <td className="px-4 py-4 text-slate-400">
                        <p className="max-w-[240px] whitespace-pre-wrap">{test.weakTopics.join(", ") || "—"}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-400">
                        <p className="max-w-[280px] whitespace-pre-wrap">{test.actionPlan || "—"}</p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className={secondaryButtonClassName}
                            aria-label={`Edit practice test ${getPracticeTestLabel(test)}`}
                            onClick={() => {
                              setEditorTest(test);
                              setShowEditor(true);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={iconButtonClassName}
                            onClick={() => {
                              if (window.confirm(`Move ${getPracticeTestLabel(test)} to trash?`)) {
                                void trashPracticeTest(test.id);
                              }
                            }}
                            aria-label={`Delete practice test ${getPracticeTestLabel(test)}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="History is empty" description="Logged tests will appear here." compact />
          )}
      </Panel>

      {showEditor ? (
        <PracticeTestEditorSheet
          key={editorTest?.id ?? "new-test"}
          test={editorTest}
          onClose={() => setShowEditor(false)}
          onSave={(draft) => {
            void (async () => {
              const saved = await upsertPracticeTest(draft);
              if (saved) {
                setShowEditor(false);
              }
            })();
          }}
        />
      ) : null}
    </div>
  );
}
