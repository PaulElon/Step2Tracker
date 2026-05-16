import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Flame,
  Lightbulb,
  PieChart,
  Plus,
  TrendingUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { FF } from "../../lib/feature-flags";
import {
  getCategoryBreakdown,
  getPracticeMetrics,
  getPracticeTrend,
  getWeakTopicPlannerInsights,
  sumStudyMinutes,
} from "../../lib/analytics";
import { formatHoursValue, formatLongDate } from "../../lib/datetime";
import { cn } from "../../lib/ui";
import { useAppStore } from "../../state/app-store";
import type { PracticeTest, WeakTopicPriority } from "../../types/models";
import { OverviewActivityHeatmap } from "./overview-activity-heatmap";

export type PortfolioOverviewSectionTarget =
  | "sessionLog"
  | "tests"
  | "weakTopics"
  | "errorLog"
  | "analytics";

interface PortfolioOverviewProps {
  onNavigate: (section: PortfolioOverviewSectionTarget) => void;
}

const PRIORITY_DOT: Record<WeakTopicPriority, string> = {
  High: "bg-rose-400/90",
  Medium: "bg-amber-400/90",
  Low: "bg-emerald-400/80",
};

const PRIORITY_PILL_TONE: Record<WeakTopicPriority, string> = {
  High: "border-rose-300/25 bg-rose-300/10 text-rose-100",
  Medium: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  Low: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
};

const PRIORITY_ORDER: Record<WeakTopicPriority, number> = {
  High: 0,
  Medium: 1,
  Low: 2,
};

type TrendPoint = {
  id: string;
  date: string;
  label: string;
  score: number;
};

type TopErrorPattern =
  | { kind: "topic"; label: string; count: number }
  | { kind: "errorType"; label: string; count: number };

type TrendImprovement = {
  earlierAvg: number;
  laterAvg: number;
  delta: number;
};

type TopCategory = {
  name: string;
  minutes: number;
  sharePercent: number;
};

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatSignedPoints(delta: number) {
  const rounded = Math.round(delta * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "" : "";
  return `${sign}${rounded.toFixed(1)} pts`;
}

export function PortfolioOverview({ onNavigate }: PortfolioOverviewProps) {
  const { state } = useAppStore();
  const { practiceTests, errorLogEntries, weakTopicEntries, studyBlocks } = state;
  const dailyGoalMinutes = state.preferences.dailyGoalMinutes;

  const practiceMetrics = useMemo(
    () => getPracticeMetrics(practiceTests),
    [practiceTests],
  );
  const trend = useMemo(() => getPracticeTrend(practiceTests), [practiceTests]);
  const totalStudyMinutes = useMemo(
    () => sumStudyMinutes(studyBlocks),
    [studyBlocks],
  );
  const categoryBreakdown = useMemo(
    () => getCategoryBreakdown(studyBlocks),
    [studyBlocks],
  );

  const focusInsights = useMemo(() => {
    const insights = getWeakTopicPlannerInsights(
      weakTopicEntries,
      practiceTests,
      studyBlocks,
    )
      .filter((insight) => insight.status !== "Resolved")
      .sort((left, right) => {
        const leftPriority = PRIORITY_ORDER[left.priority as WeakTopicPriority] ?? 99;
        const rightPriority = PRIORITY_ORDER[right.priority as WeakTopicPriority] ?? 99;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }
        return right.occurrenceCount - left.occurrenceCount;
      });
    return insights.slice(0, 4);
  }, [weakTopicEntries, practiceTests, studyBlocks]);

  const trendImprovement = useMemo<TrendImprovement | null>(() => {
    if (practiceTests.length < 4) {
      return null;
    }
    const sorted = [...practiceTests].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
    const half = Math.floor(sorted.length / 2);
    const earlier = sorted.slice(0, half);
    const later = sorted.slice(half);
    if (!earlier.length || !later.length) {
      return null;
    }
    const avg = (tests: PracticeTest[]) =>
      tests.reduce((total, test) => total + test.scorePercent, 0) / tests.length;
    const earlierAvg = avg(earlier);
    const laterAvg = avg(later);
    return { earlierAvg, laterAvg, delta: laterAvg - earlierAvg };
  }, [practiceTests]);

  const topErrorPattern = useMemo<TopErrorPattern | null>(() => {
    if (!errorLogEntries.length) {
      return null;
    }
    const topicCounts = new Map<string, number>();
    for (const entry of errorLogEntries) {
      const topic = entry.topic.trim();
      if (!topic) continue;
      topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    if (topicCounts.size) {
      const [label, count] = [...topicCounts.entries()].sort(
        (left, right) => right[1] - left[1],
      )[0];
      if (count >= 2) {
        return { kind: "topic", label, count };
      }
      return null;
    }
    const errorTypeCounts = new Map<string, number>();
    for (const entry of errorLogEntries) {
      errorTypeCounts.set(
        entry.errorType,
        (errorTypeCounts.get(entry.errorType) ?? 0) + 1,
      );
    }
    const [label, count] = [...errorTypeCounts.entries()].sort(
      (left, right) => right[1] - left[1],
    )[0];
    return { kind: "errorType", label, count };
  }, [errorLogEntries]);

  const topCategory = useMemo<TopCategory | null>(() => {
    if (!categoryBreakdown.length || !totalStudyMinutes) {
      return null;
    }
    const top = categoryBreakdown[0];
    return {
      name: top.category,
      minutes: top.minutes,
      sharePercent: Math.round((top.minutes / totalStudyMinutes) * 100),
    };
  }, [categoryBreakdown, totalStudyMinutes]);

  const readinessValue = practiceMetrics.averageScore;
  const readinessTone: MetricTone =
    readinessValue == null ? "neutral" : readinessValue >= 70 ? "good" : "warn";
  const readinessMeta =
    readinessValue == null
      ? "Awaiting first test"
      : readinessValue >= 70
        ? "On track"
        : "Build pace";

  return (
    <div className="flex flex-col gap-4 pb-2">
      <h2 className="text-3xl font-semibold tracking-[-0.03em] text-white">Overview</h2>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <OverviewMetric
              label="Readiness"
              value={readinessValue == null ? "—" : formatPercent(readinessValue)}
              meta={readinessMeta}
              tone={readinessTone}
            />
            <OverviewMetric
              label="Tests Taken"
              value={String(practiceTests.length)}
              meta={
                practiceTests.length
                  ? `${practiceMetrics.totalQuestions || 0} questions`
                  : "Log your first test"
              }
            />
            <OverviewMetric
              label="Avg Score"
              value={
                practiceMetrics.averageScore == null
                  ? "—"
                  : formatPercent(practiceMetrics.averageScore)
              }
              meta={
                practiceMetrics.bestScore == null
                  ? "—"
                  : `Best ${formatPercent(practiceMetrics.bestScore)}`
              }
            />
            <OverviewMetric
              label="Missed Questions"
              value={String(errorLogEntries.length)}
              meta={errorLogEntries.length ? "Review needed" : "No entries"}
              tone={errorLogEntries.length ? "warn" : "neutral"}
            />
            <OverviewMetric
              label="Study Time"
              value={
                totalStudyMinutes ? formatHoursValue(totalStudyMinutes) : "0h 00m"
              }
              meta={
                studyBlocks.length
                  ? `${studyBlocks.length} block${studyBlocks.length === 1 ? "" : "s"}`
                  : "Add a study block"
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <FocusAreasPanel
              focusInsights={focusInsights}
              onNavigate={onNavigate}
            />
            <PerformanceTrendPanel trend={trend} onNavigate={onNavigate} />
          </div>

          <RecommendedNextActions
            errorCount={errorLogEntries.length}
            focusCount={focusInsights.length}
            practiceCount={practiceTests.length}
            dailyGoalMinutes={dailyGoalMinutes}
            onNavigate={onNavigate}
          />
        </div>

        <div className="flex flex-col gap-4">
          <InsightsRail
            topErrorPattern={topErrorPattern}
            trendImprovement={trendImprovement}
            topCategory={topCategory}
          />
          <QuickActions onNavigate={onNavigate} />
        </div>
      </div>
      {FF.timefolio ? <OverviewActivityHeatmap /> : null}
    </div>
  );
}

type MetricTone = "neutral" | "good" | "warn";

const METRIC_TONE_VALUE: Record<MetricTone, string> = {
  neutral: "text-white",
  good: "text-emerald-100",
  warn: "text-amber-100",
};

const METRIC_TONE_META: Record<MetricTone, string> = {
  neutral: "text-slate-400",
  good: "text-emerald-200/85",
  warn: "text-amber-200/85",
};

function OverviewMetric({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta?: string;
  tone?: MetricTone;
}) {
  return (
    <div className="panel-subtle flex min-w-0 flex-col gap-1.5 px-4 py-3.5">
      <p className="text-[0.6rem] uppercase tracking-[0.22em] text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "text-[1.45rem] font-semibold tracking-[-0.03em] tabular-nums",
          METRIC_TONE_VALUE[tone],
        )}
      >
        {value}
      </p>
      {meta ? (
        <p className={cn("text-[11px]", METRIC_TONE_META[tone])}>{meta}</p>
      ) : null}
    </div>
  );
}

function SectionPanel({
  title,
  subtitle,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel flex min-w-0 flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon ? <Icon className="h-4 w-4 text-cyan-200" /> : null}
            <h3 className="text-[0.95rem] font-semibold text-white">{title}</h3>
          </div>
          {subtitle ? (
            <p className="mt-1 text-[12px] text-slate-400">{subtitle}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function EmptyHint({
  text,
  cta,
  onClick,
}: {
  text: string;
  cta?: string;
  onClick?: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-center">
      <p className="text-[13px] text-slate-400">{text}</p>
      {cta && onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-cyan-200 transition-colors hover:text-cyan-100"
        >
          {cta}
          <ArrowRight className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function FocusAreasPanel({
  focusInsights,
  onNavigate,
}: {
  focusInsights: ReturnType<typeof getWeakTopicPlannerInsights>;
  onNavigate: (section: PortfolioOverviewSectionTarget) => void;
}) {
  return (
    <SectionPanel
      title="Focus Areas"
      subtitle="Where to focus next based on your performance."
      icon={Flame}
    >
      {focusInsights.length ? (
        <ul className="flex flex-col gap-2">
          {focusInsights.map((insight) => {
            const priority = insight.priority as WeakTopicPriority;
            const dotClass = PRIORITY_DOT[priority] ?? "bg-slate-400/70";
            const pillClass =
              PRIORITY_PILL_TONE[priority] ??
              "border-white/10 bg-white/[0.04] text-slate-300";
            const lastSeenLabel = insight.lastSeenAt
              ? formatLongDate(insight.lastSeenAt)
              : "No date";
            const occurrenceLabel =
              insight.occurrenceCount > 0
                ? `${insight.occurrenceCount} flag${insight.occurrenceCount === 1 ? "" : "s"}`
                : insight.entryType === "practice-test"
                  ? "From practice test"
                  : "Manual";
            return (
              <li
                key={insight.id}
                className="flex items-center gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.025] px-3 py-2.5"
              >
                <span
                  className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", dotClass)}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[13px] font-semibold text-white">
                      {insight.topic}
                    </p>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                        pillClass,
                      )}
                    >
                      {priority}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {occurrenceLabel} · Last seen {lastSeenLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate("weakTopics")}
                  className="shrink-0 rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors hover:border-white/20 hover:text-white"
                >
                  Review
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyHint
          text="No weak areas flagged yet."
          cta="Open Weak Topics"
          onClick={() => onNavigate("weakTopics")}
        />
      )}
      {focusInsights.length ? (
        <button
          type="button"
          onClick={() => onNavigate("weakTopics")}
          className="mt-1 flex w-full items-center justify-between rounded-[12px] border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[12px] text-slate-300 transition-colors hover:border-white/15 hover:text-white"
        >
          <span>View all weak topics</span>
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
      ) : null}
    </SectionPanel>
  );
}

function PerformanceTrendPanel({
  trend,
  onNavigate,
}: {
  trend: TrendPoint[];
  onNavigate: (section: PortfolioOverviewSectionTarget) => void;
}) {
  const hasEnoughTrendData = trend.length >= 3;
  return (
    <SectionPanel
      title="Performance Trend"
      subtitle="Average score over time"
      icon={TrendingUp}
    >
      {hasEnoughTrendData ? (
        <TrendSparkline trend={trend} />
      ) : (
        <EmptyHint
          text="Log at least 3 tests to see a performance trend."
          cta="Open Practice Tests"
          onClick={() => onNavigate("tests")}
        />
      )}
    </SectionPanel>
  );
}

function TrendSparkline({ trend }: { trend: TrendPoint[] }) {
  const width = 560;
  const height = 200;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const innerHeight = height - padTop - padBottom;
  const innerWidth = width - padLeft - padRight;

  const xs =
    trend.length === 1
      ? [padLeft + innerWidth / 2]
      : trend.map(
          (_, index) => padLeft + (index / (trend.length - 1)) * innerWidth,
        );
  const ys = trend.map(
    (point) => padTop + (1 - point.score / 100) * innerHeight,
  );

  const linePath = xs
    .map((x, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[index].toFixed(2)}`)
    .join(" ");

  const areaPath =
    trend.length > 1
      ? `${linePath} L ${xs[xs.length - 1].toFixed(2)} ${(padTop + innerHeight).toFixed(2)} L ${xs[0].toFixed(2)} ${(padTop + innerHeight).toFixed(2)} Z`
      : "";

  const goalY = padTop + (1 - 75 / 100) * innerHeight;
  const yTicks = [0, 25, 50, 75, 100];
  const firstLabel = trend[0]?.date ?? "";
  const lastLabel = trend[trend.length - 1]?.date ?? "";

  return (
    <div className="min-w-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[180px] w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Practice test score trend"
      >
        <defs>
          <linearGradient id="portfolio-trend-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(94,209,232,0.32)" />
            <stop offset="100%" stopColor="rgba(94,209,232,0)" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = padTop + (1 - tick / 100) * innerHeight;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="rgba(148,163,184,0.12)"
                strokeWidth={1}
              />
              <text
                x={padLeft - 6}
                y={y}
                fontSize="9"
                textAnchor="end"
                dominantBaseline="middle"
                fill="rgba(148,163,184,0.7)"
              >
                {tick}
              </text>
            </g>
          );
        })}
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={goalY}
          y2={goalY}
          stroke="rgba(94,209,232,0.45)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        {areaPath ? (
          <path d={areaPath} fill="url(#portfolio-trend-fill)" />
        ) : null}
        {trend.length > 1 ? (
          <path
            d={linePath}
            fill="none"
            stroke="rgba(94,209,232,0.9)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {xs.map((x, index) => (
          <circle
            key={trend[index].id}
            cx={x}
            cy={ys[index]}
            r={3}
            fill="rgba(94,209,232,0.95)"
            stroke="rgba(2,8,23,0.95)"
            strokeWidth={1.25}
          >
            <title>{trend[index].label}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-slate-500">
        <span>{firstLabel}</span>
        <span className="flex items-center gap-1 normal-case tracking-normal text-[11px] text-slate-400">
          <span className="inline-block h-[6px] w-[6px] rounded-full bg-cyan-300/80" />
          Average score
          <span className="mx-1 text-slate-600">·</span>
          <span className="inline-block h-[1px] w-3 border-t border-dashed border-cyan-300/60" />
          Goal 75%
        </span>
        <span>{lastLabel}</span>
      </div>
    </div>
  );
}

function InsightsRail({
  topErrorPattern,
  trendImprovement,
  topCategory,
}: {
  topErrorPattern: TopErrorPattern | null;
  trendImprovement: TrendImprovement | null;
  topCategory: TopCategory | null;
}) {
  return (
    <section className="glass-panel flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-cyan-200" />
        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
          Insights
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <InsightRow
          label={
            topErrorPattern?.kind === "errorType"
              ? "Most missed error type"
              : "Most missed topic"
          }
          value={topErrorPattern ? topErrorPattern.label : "—"}
          meta={
            topErrorPattern
              ? `${topErrorPattern.count} miss${topErrorPattern.count === 1 ? "" : "es"} logged`
              : "Log more missed topics to identify a pattern."
          }
          valueTone="violet"
        />
        <InsightRow
          label="Trending improvement"
          value={
            trendImprovement && trendImprovement.delta > 0
              ? formatSignedPoints(trendImprovement.delta)
              : trendImprovement
                ? formatSignedPoints(trendImprovement.delta)
                : "—"
          }
          meta={
            trendImprovement
              ? `Recent ${formatPercent(trendImprovement.laterAvg)} vs prior ${formatPercent(trendImprovement.earlierAvg)}`
              : "Log at least 4 tests to see a trend."
          }
          valueTone={
            trendImprovement && trendImprovement.delta > 0
              ? "good"
              : trendImprovement && trendImprovement.delta < 0
                ? "warn"
                : "neutral"
          }
          icon={trendImprovement && trendImprovement.delta > 0 ? TrendingUp : undefined}
        />
        <InsightRow
          label="Time allocation"
          value={topCategory ? topCategory.name : "—"}
          meta={
            topCategory
              ? `${topCategory.sharePercent}% · ${formatHoursValue(topCategory.minutes)}`
              : "Add study blocks to see allocation."
          }
          valueTone="violet"
          icon={topCategory ? PieChart : undefined}
        />
      </div>
    </section>
  );
}

const INSIGHT_VALUE_TONE: Record<
  "neutral" | "good" | "warn" | "violet",
  string
> = {
  neutral: "text-white",
  good: "text-emerald-200",
  warn: "text-rose-200",
  violet: "text-violet-200",
};

function InsightRow({
  label,
  value,
  meta,
  valueTone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  valueTone?: keyof typeof INSIGHT_VALUE_TONE;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-[14px] border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5 text-slate-300" /> : null}
        <p
          className={cn(
            "truncate text-[14px] font-semibold tabular-nums",
            INSIGHT_VALUE_TONE[valueTone],
          )}
        >
          {value}
        </p>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">{meta}</p>
    </div>
  );
}

function QuickActions({
  onNavigate,
}: {
  onNavigate: (section: PortfolioOverviewSectionTarget) => void;
}) {
  type QuickAction = {
    key: string;
    icon: LucideIcon;
    label: string;
    target: PortfolioOverviewSectionTarget;
  };

  const actions: QuickAction[] = [
    { key: "tests", icon: ClipboardCheck, label: "Log Practice Test", target: "tests" },
    { key: "errorLog", icon: AlertCircle, label: "Add Error", target: "errorLog" },
    { key: "weakTopics", icon: Flame, label: "Add Weak Topic", target: "weakTopics" },
  ];
  if (FF.timefolio) {
    actions.push({
      key: "sessionLog",
      icon: Clock,
      label: "Open Session Log",
      target: "sessionLog",
    });
  }

  return (
    <section className="glass-panel flex flex-col gap-2 p-4">
      <header className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-cyan-200" />
        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-slate-400">
          Quick Actions
        </p>
      </header>
      <div className="flex flex-col gap-1">
        {actions.map(({ key, icon: Icon, label, target }) => (
          <button
            key={key}
            type="button"
            onClick={() => onNavigate(target)}
            className="group flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left text-[13px] text-slate-300 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <Icon className="h-4 w-4 text-slate-500 transition-colors group-hover:text-cyan-200" />
            <span className="flex-1 truncate">{label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-600 transition-colors group-hover:text-slate-300" />
          </button>
        ))}
      </div>
    </section>
  );
}

type RecommendedAction = {
  key: string;
  icon: LucideIcon;
  title: string;
  description: string;
  target: PortfolioOverviewSectionTarget;
};

function RecommendedNextActions({
  errorCount,
  focusCount,
  practiceCount,
  dailyGoalMinutes,
  onNavigate,
}: {
  errorCount: number;
  focusCount: number;
  practiceCount: number;
  dailyGoalMinutes: number;
  onNavigate: (section: PortfolioOverviewSectionTarget) => void;
}) {
  const actions: RecommendedAction[] = [];

  if (errorCount > 0) {
    actions.push({
      key: "errors",
      icon: AlertCircle,
      title: `Review ${errorCount} missed question${errorCount === 1 ? "" : "s"}`,
      description: "Focus on recurring patterns",
      target: "errorLog",
    });
  }

  if (focusCount > 0) {
    actions.push({
      key: "weak",
      icon: Flame,
      title: "Schedule weak topic reviews",
      description: `${focusCount} topic${focusCount === 1 ? "" : "s"} need attention`,
      target: "weakTopics",
    });
  }

  if (practiceCount === 0) {
    actions.push({
      key: "first-test",
      icon: ClipboardCheck,
      title: "Log your first practice test",
      description: "Establish a baseline score",
      target: "tests",
    });
  } else if (FF.timefolio) {
    const weeklyHours = Math.max(1, Math.round((dailyGoalMinutes * 7) / 60));
    actions.push({
      key: "study-time",
      icon: Clock,
      title: `Target ${weeklyHours}h this week`,
      description: "Based on your daily goal",
      target: "sessionLog",
    });
  } else {
    actions.push({
      key: "log-test",
      icon: ClipboardCheck,
      title: "Log a fresh practice test",
      description: "Recalibrate readiness",
      target: "tests",
    });
  }

  if (!actions.length) {
    return null;
  }

  return (
    <section className="glass-panel flex flex-col gap-3 p-4">
      <header className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-cyan-200" />
        <h3 className="text-[0.95rem] font-semibold text-white">
          Recommended Next Actions
        </h3>
      </header>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {actions.slice(0, 3).map(({ key, icon: Icon, title, description, target }) => (
          <button
            key={key}
            type="button"
            onClick={() => onNavigate(target)}
            className="group flex items-center gap-3 rounded-[16px] border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-left transition-colors hover:border-white/15 hover:bg-white/[0.04]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-white/10 bg-slate-950/60 text-cyan-200">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-white">{title}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">{description}</p>
            </span>
            <ChevronRight className="h-4 w-4 text-slate-500 transition-colors group-hover:text-slate-200" />
          </button>
        ))}
      </div>
    </section>
  );
}
