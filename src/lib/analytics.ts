import {
  addDays,
  compareStudyBlocks,
  formatShortDate,
  minutesBetween,
  startOfWeek,
} from "./datetime";
import { getPracticeTestLabel } from "./practice-tests";
import { getStudyLane, isFixedBlock } from "./study-workflow";
import type { PracticeTest, StudyBlock, StudyStatus } from "../types/models";

export interface CategoryBreakdown {
  category: string;
  count: number;
  minutes: number;
  completedCount: number;
  completedMinutes: number;
}

export interface GoalAlert {
  tone: "info" | "warning" | "critical";
  title: string;
  body: string;
}

export interface TopicTrendSeries {
  topic: string;
  values: Array<{
    date: string;
    label: string;
    count: number;
  }>;
}

export interface RemediationLink {
  testId: string;
  assessment: string;
  date: string;
  weakTopics: string[];
  coveredTopics: string[];
  uncoveredTopics: string[];
  linkedBlocks: StudyBlock[];
  coverage: number;
}

export interface MomentumPoint {
  date: string;
  label: string;
  minutes: number;
  completedMinutes: number;
  categoryCount: number;
  overloadMinutes: number;
  blockCount: number;
}

export interface RedistributionSuggestion {
  blockId: string;
  task: string;
  minutes: number;
  toDate: string;
  toLabel: string;
  lane: ReturnType<typeof getStudyLane>;
}

export interface RedistributionPlan {
  isOverloaded: boolean;
  overflowMinutes: number;
  todayMinutes: number;
  targetMinutes: number;
  suggestions: RedistributionSuggestion[];
}

export interface WeakTopicPlannerInsight {
  id: string;
  topic: string;
  entryType: string;
  status: string;
  priority: string;
  notes: string;
  occurrenceCount: number;
  lastSeenAt: string;
  sourceLabel: string;
  linkedBlockCount: number;
  nextTouchDate: string;
}

export function getStudyBlockMinutes(block: StudyBlock) {
  const taskMinutes = block.durationHours * 60 + block.durationMinutes;
  if (taskMinutes > 0) {
    return taskMinutes;
  }

  return minutesBetween(block.startTime, block.endTime, block.isOvernight);
}

export function sumStudyMinutes(blocks: StudyBlock[]) {
  return blocks.reduce((total, block) => total + getStudyBlockMinutes(block), 0);
}

export function getDateRange(blocks: StudyBlock[]) {
  const sortedBlocks = [...blocks].sort(compareStudyBlocks);
  const first = sortedBlocks[0];
  const last = sortedBlocks.at(-1);

  return {
    startDate: first?.date ?? "",
    endDate: last?.date ?? "",
  };
}

export function getTodayBlocks(blocks: StudyBlock[], todayKey: string) {
  return [...blocks]
    .filter((block) => block.date === todayKey)
    .sort(compareStudyBlocks);
}

export function getUpcomingBlocks(blocks: StudyBlock[], fromDate: string, limit: number) {
  return [...blocks]
    .filter((block) => block.date >= fromDate)
    .sort(compareStudyBlocks)
    .slice(0, limit);
}

export function getDailyMinutes(blocks: StudyBlock[]) {
  const minutesByDate = new Map<string, number>();

  for (const block of blocks) {
    minutesByDate.set(block.date, (minutesByDate.get(block.date) ?? 0) + getStudyBlockMinutes(block));
  }

  return [...minutesByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, minutes]) => ({
      date,
      label: formatShortDate(date),
      minutes,
      hours: Number((minutes / 60).toFixed(2)),
    }));
}

export function getMinutesByDateMap(blocks: StudyBlock[]) {
  const minutesByDate: Record<string, number> = {};

  for (const block of blocks) {
    minutesByDate[block.date] = (minutesByDate[block.date] ?? 0) + getStudyBlockMinutes(block);
  }

  return minutesByDate;
}

export function getWeeklyMinutes(blocks: StudyBlock[]) {
  const minutesByWeek = new Map<string, number>();

  for (const block of blocks) {
    const weekKey = startOfWeek(block.date, 1);
    minutesByWeek.set(weekKey, (minutesByWeek.get(weekKey) ?? 0) + getStudyBlockMinutes(block));
  }

  return [...minutesByWeek.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, minutes]) => ({
      weekStart,
      label: formatShortDate(weekStart),
      minutes,
    }));
}

export function getCategoryBreakdown(blocks: StudyBlock[]) {
  const categories = new Map<string, CategoryBreakdown>();

  for (const block of blocks) {
    const existing = categories.get(block.category) ?? {
      category: block.category,
      count: 0,
      minutes: 0,
      completedCount: 0,
      completedMinutes: 0,
    };
    const blockMinutes = getStudyBlockMinutes(block);

    existing.count += 1;
    existing.minutes += blockMinutes;

    if (block.completed) {
      existing.completedCount += 1;
      existing.completedMinutes += blockMinutes;
    }

    categories.set(block.category, existing);
  }

  return [...categories.values()].sort((left, right) => right.minutes - left.minutes);
}

export function getStatusCounts(blocks: StudyBlock[]) {
  const base: Record<StudyStatus, number> = {
    "Not Started": 0,
    "In Progress": 0,
    Completed: 0,
    Skipped: 0,
  };

  for (const block of blocks) {
    base[block.completed ? "Completed" : "Not Started"] += 1;
  }

  return Object.entries(base).map(([status, count]) => ({
    status: status as StudyStatus,
    count,
  }));
}

export function getPracticeMetrics(tests: PracticeTest[]) {
  if (!tests.length) {
    return {
      averageScore: null as number | null,
      bestScore: null as number | null,
      latestScore: null as number | null,
      totalQuestions: 0,
      totalMinutes: 0,
    };
  }

  const sortedTests = [...tests].sort((left, right) => left.date.localeCompare(right.date));
  const totalQuestions = tests.reduce((total, test) => total + test.questionCount, 0);
  const totalMinutes = tests.reduce((total, test) => total + test.minutesSpent, 0);
  const totalScore = tests.reduce((total, test) => total + test.scorePercent, 0);

  return {
    averageScore: totalScore / tests.length,
    bestScore: Math.max(...tests.map((test) => test.scorePercent)),
    latestScore: sortedTests.at(-1)?.scorePercent ?? null,
    totalQuestions,
    totalMinutes,
  };
}

export function getPracticeTrend(tests: PracticeTest[]) {
  return [...tests]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((test) => ({
      id: test.id,
      date: test.date,
      label: `${getPracticeTestLabel(test)} · ${formatShortDate(test.date)}`,
      score: test.scorePercent,
    }));
}

function normalizeTopic(topic: string) {
  return topic.trim().toLowerCase();
}

export function blockMatchesTopic(block: StudyBlock, topic: string) {
  const haystack = `${block.category} ${block.task} ${block.notes}`.toLowerCase();
  const normalizedTopic = normalizeTopic(topic);
  if (!normalizedTopic) {
    return false;
  }

  if (haystack.includes(normalizedTopic)) {
    return true;
  }

  const parts = normalizedTopic.split(/\s+/).filter((part) => part.length > 2);
  return parts.length > 1 && parts.every((part) => haystack.includes(part));
}

function pushTopics(target: Map<string, number>, topics: string[]) {
  for (const topic of topics) {
    const normalized = topic.trim();
    if (!normalized) {
      continue;
    }
    target.set(normalized, (target.get(normalized) ?? 0) + 1);
  }
}

export function getTopicFrequency(
  tests: PracticeTest[],
  mode: "weak" | "strong" = "weak",
) {
  const topics = new Map<string, number>();

  for (const test of tests) {
    pushTopics(topics, mode === "weak" ? test.weakTopics : test.strongTopics);
  }

  return [...topics.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 8);
}

export function getTopicTrendSeries(
  tests: PracticeTest[],
  mode: "weak" | "strong" = "weak",
  limit = 4,
) {
  const rankedTopics = getTopicFrequency(tests, mode).slice(0, limit);
  const orderedTests = [...tests].sort((left, right) => left.date.localeCompare(right.date));

  return rankedTopics.map((topic) => ({
    topic: topic.topic,
    values: orderedTests.map((test) => {
      const topics = mode === "weak" ? test.weakTopics : test.strongTopics;
      const count = topics.filter((entry) => normalizeTopic(entry) === normalizeTopic(topic.topic)).length;
      return {
        date: test.date,
        label: formatShortDate(test.date),
        count,
      };
    }),
  })) satisfies TopicTrendSeries[];
}

export function getRemediationLinks(tests: PracticeTest[], blocks: StudyBlock[]) {
  return [...tests]
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((test) => {
      const weakTopics = [...new Set(test.weakTopics.map((topic) => topic.trim()).filter(Boolean))];
      const futureBlocks = blocks.filter((block) => block.date > test.date && !block.completed);
      const linkedBlocks = futureBlocks.filter((block) =>
        weakTopics.some((topic) => blockMatchesTopic(block, topic)),
      );
      const coveredTopics = weakTopics.filter((topic) =>
        linkedBlocks.some((block) => blockMatchesTopic(block, topic)),
      );
      const uncoveredTopics = weakTopics.filter((topic) => !coveredTopics.includes(topic));

      return {
        testId: test.id,
        assessment: getPracticeTestLabel(test),
        date: test.date,
        weakTopics,
        coveredTopics,
        uncoveredTopics,
        linkedBlocks,
        coverage: weakTopics.length ? coveredTopics.length / weakTopics.length : 1,
      } satisfies RemediationLink;
    });
}

export function getGoalAlerts(blocks: StudyBlock[], tests: PracticeTest[], dailyGoalMinutes: number) {
  if (!blocks.length) {
    return [
      {
        tone: "info",
        title: "No tasks scheduled",
        body: "Add daily tasks so the app can calculate pace, risk, and remediation coverage.",
      },
    ] satisfies GoalAlert[];
  }

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const outstandingBlocks = blocks.filter((block) => block.date >= todayKey && !block.completed);
  const outstandingMinutes = sumStudyMinutes(outstandingBlocks);
  const range = getDateRange(blocks);
  const finalDate = range.endDate || todayKey;
  const remainingDays = Math.max(
    Math.ceil((new Date(finalDate).getTime() - new Date(todayKey).getTime()) / 86_400_000) + 1,
    1,
  );
  const requiredDailyMinutes = outstandingMinutes / remainingDays;
  const todayMinutes = getTodayBlocks(blocks, todayKey).reduce(
    (total, block) => total + getStudyBlockMinutes(block),
    0,
  );
  const remediationLinks = getRemediationLinks(tests, blocks);
  const uncoveredTopics = remediationLinks.flatMap((link) => link.uncoveredTopics);
  const alerts: GoalAlert[] = [];

  if (requiredDailyMinutes > dailyGoalMinutes * 1.15) {
    alerts.push({
      tone: "critical",
      title: "Pace is above target",
      body: `You need about ${Math.round(requiredDailyMinutes / 60)}h/day to finish on time, which is above the current ${Math.round(dailyGoalMinutes / 60)}h goal.`,
    });
  } else if (requiredDailyMinutes > dailyGoalMinutes * 0.9) {
    alerts.push({
      tone: "warning",
      title: "Pace is tight",
      body: `The remaining plan needs roughly ${Math.round(requiredDailyMinutes / 60)}h/day, so slippage will immediately pressure the plan.`,
    });
  }

  if (todayMinutes > dailyGoalMinutes * 1.25) {
    alerts.push({
      tone: "warning",
      title: "Today is overloaded",
      body: `Today's agenda is ${Math.round(todayMinutes / 60)}h against an ${Math.round(dailyGoalMinutes / 60)}h goal.`,
    });
  }

  if (uncoveredTopics.length) {
    const sample = [...new Set(uncoveredTopics)].slice(0, 3).join(", ");
    alerts.push({
      tone: "critical",
      title: "Weak topics are not scheduled",
      body: `${sample}${uncoveredTopics.length > 3 ? " and more" : ""} do not have a clear future task tied to them yet.`,
    });
  } else if (tests.length) {
    alerts.push({
      tone: "info",
      title: "Weak topics are covered",
      body: "Recent weak-topic annotations all have matching future study tasks in the plan.",
    });
  }

  if (!tests.length) {
    alerts.push({
      tone: "info",
      title: "No baseline test logged",
      body: "Log a test so the app can compare the plan against actual performance signals.",
    });
  }

  return alerts.slice(0, 4);
}

export function getMomentumPoints(
  blocks: StudyBlock[],
  fromDate: string,
  limit = 12,
  dailyGoalMinutes = 8 * 60,
) {
  const grouped = new Map<
    string,
    {
      minutes: number;
      completedMinutes: number;
      categories: Set<string>;
      blockCount: number;
    }
  >();

  for (const block of blocks) {
    if (block.date < fromDate) {
      continue;
    }

    const entry = grouped.get(block.date) ?? {
      minutes: 0,
      completedMinutes: 0,
      categories: new Set<string>(),
      blockCount: 0,
    };
    const minutes = getStudyBlockMinutes(block);
    entry.minutes += minutes;
    entry.blockCount += 1;
    entry.categories.add(block.category);

    if (block.completed) {
      entry.completedMinutes += minutes;
    }

    grouped.set(block.date, entry);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, limit)
    .map(([date, entry]) => ({
      date,
      label: formatShortDate(date),
      minutes: entry.minutes,
      completedMinutes: entry.completedMinutes,
      categoryCount: entry.categories.size,
      overloadMinutes: Math.max(entry.minutes - dailyGoalMinutes, 0),
      blockCount: entry.blockCount,
    })) satisfies MomentumPoint[];
}

export function getLoadRedistributionPlan(
  blocks: StudyBlock[],
  todayKey: string,
  dailyGoalMinutes: number,
) {
  const todayBlocks = getTodayBlocks(blocks, todayKey);
  const todayMinutes = todayBlocks.reduce((total, block) => total + getStudyBlockMinutes(block), 0);
  const overflowMinutes = Math.max(todayMinutes - dailyGoalMinutes, 0);

  if (overflowMinutes <= 0) {
    return {
      isOverloaded: false,
      overflowMinutes: 0,
      todayMinutes,
      targetMinutes: dailyGoalMinutes,
      suggestions: [],
    } satisfies RedistributionPlan;
  }

  const futurePoints = getMomentumPoints(blocks, addDays(todayKey, 1), 10, dailyGoalMinutes).sort(
    (left, right) => left.minutes - right.minutes || left.date.localeCompare(right.date),
  );

  const suggestions: RedistributionSuggestion[] = [];
  const dateLoad = new Map(futurePoints.map((point) => [point.date, point.minutes]));
  let remainingOverflow = overflowMinutes;

  const moveableBlocks = [...todayBlocks]
    .filter((block) => !block.completed && !isFixedBlock(block))
    .sort((left, right) => {
      const laneOrder = { review: 0, content: 1, admin: 2, assessment: 3, recovery: 4 };
      return (
        laneOrder[getStudyLane(left)] - laneOrder[getStudyLane(right)] ||
        right.order - left.order
      );
    });

  for (const block of moveableBlocks) {
    if (remainingOverflow <= 0) {
      break;
    }

    const minutes = getStudyBlockMinutes(block);
    const destination = futurePoints.find((point) => {
      const nextLoad = dateLoad.get(point.date) ?? point.minutes;
      return nextLoad + minutes <= dailyGoalMinutes * 1.05;
    });

    if (!destination) {
      continue;
    }

    dateLoad.set(destination.date, (dateLoad.get(destination.date) ?? destination.minutes) + minutes);
    remainingOverflow -= minutes;
    suggestions.push({
      blockId: block.id,
      task: block.task,
      minutes,
      toDate: destination.date,
      toLabel: destination.label,
      lane: getStudyLane(block),
    });
  }

  return {
    isOverloaded: overflowMinutes > 0,
    overflowMinutes,
    todayMinutes,
    targetMinutes: dailyGoalMinutes,
    suggestions,
  } satisfies RedistributionPlan;
}

export function getWeakTopicPlannerInsights(
  entries: Array<{
    id: string;
    topic: string;
    entryType: string;
    status: string;
    priority: string;
    notes: string;
    lastSeenAt: string;
    sourceLabel: string;
  }>,
  tests: PracticeTest[],
  blocks: StudyBlock[],
) {
  return entries.map((entry) => {
    const occurrenceCount = tests.reduce(
      (total, test) =>
        total +
        test.weakTopics.filter((topic) => normalizeTopic(topic) === normalizeTopic(entry.topic)).length,
      0,
    );
    const linkedBlocks = blocks
      .filter(
        (block) =>
          !block.completed &&
          block.date > entry.lastSeenAt &&
          blockMatchesTopic(block, entry.topic),
      )
      .sort(compareStudyBlocks);

    return {
      id: entry.id,
      topic: entry.topic,
      entryType: entry.entryType,
      status: entry.status,
      priority: entry.priority,
      notes: entry.notes,
      occurrenceCount,
      lastSeenAt: entry.lastSeenAt,
      sourceLabel: entry.sourceLabel,
      linkedBlockCount: linkedBlocks.length,
      nextTouchDate: linkedBlocks[0]?.date ?? "",
    } satisfies WeakTopicPlannerInsight;
  });
}

export function getWeekDates(referenceDate: string) {
  const weekStart = startOfWeek(referenceDate, 1);
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}
