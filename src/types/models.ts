export type StudyStatus = "Not Started" | "In Progress" | "Completed" | "Skipped";
export type StudyStatusFilter = StudyStatus | "All";
export type SectionId = "dashboard" | "planner" | "weakTopics" | "tests" | "settings" | "errorLog";
export type PlannerSortField = "date" | "order" | "category" | "task";
export type SortDirection = "asc" | "desc";
export type ImportMode = "merge" | "replace";
export type PlannerMode = "week" | "month";
export type ThemeId =
  | "aurora"
  | "ember"
  | "tide"
  | "bubblegum"
  | "signal"
  | "prism"
  | "maggiepink"
  | "light"
  | "paulblue"
  | "teslared";
export type WeakTopicPriority = "High" | "Medium" | "Low";
export type WeakTopicStatus = "Active" | "Improving" | "Resolved";
export type WeakTopicEntryType = "manual" | "practice-test";
export type StudyTaskCategory = string;

export interface StudyBlock {
  id: string;
  date: string;
  day: string;
  durationHours: number;
  durationMinutes: number;
  completed: boolean;
  order: number;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  category: StudyTaskCategory;
  task: string;
  status: StudyStatus;
  notes: string;
  reminderAt?: string;
  reminderSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyBlockInput {
  id?: string;
  date: string;
  day?: string;
  durationHours?: number;
  durationMinutes?: number;
  completed?: boolean;
  order?: number;
  startTime?: string;
  endTime?: string;
  isOvernight?: boolean;
  category: StudyTaskCategory;
  task: string;
  status?: StudyStatus;
  notes?: string;
  reminderAt?: string;
  reminderSentAt?: string | null;
}

export interface PracticeTest {
  id: string;
  date: string;
  source: string;
  form: string;
  questionCount: number;
  scorePercent: number;
  weakTopics: string[];
  strongTopics: string[];
  reflections: string;
  actionPlan: string;
  minutesSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeTestInput {
  id?: string;
  date: string;
  source: string;
  form: string;
  questionCount: number;
  scorePercent: number;
  weakTopics: string[];
  strongTopics: string[];
  reflections: string;
  actionPlan: string;
  minutesSpent: number;
}

export interface WeakTopicEntry {
  id: string;
  topic: string;
  entryType: WeakTopicEntryType;
  priority: WeakTopicPriority;
  status: WeakTopicStatus;
  notes: string;
  lastSeenAt: string;
  sourceLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface WeakTopicInput {
  id?: string;
  topic: string;
  entryType?: WeakTopicEntryType;
  priority: WeakTopicPriority;
  status: WeakTopicStatus;
  notes: string;
  lastSeenAt: string;
  sourceLabel: string;
}

export interface PlannerFilters {
  search: string;
  category: string;
  status: StudyStatusFilter;
  fromDate: string;
  toDate: string;
}

export interface PlannerSort {
  field: PlannerSortField;
  direction: SortDirection;
}

export interface ResourceLink {
  id: string;
  label: string;
  url: string;
  kind: "website" | "app";
}

export type ExamDisplayMode = "days" | "weeks+days" | "months+weeks+days";

export interface ExamTimer {
  id: string;
  label: string;
  examDate: string;
  examTime?: string;
  displayMode?: ExamDisplayMode;
}

export interface ScoreTrendOptions {
  showConnectionLine: boolean;
  showBestFitLine: boolean;
  showBestFitRSquared: boolean;
}

export interface Preferences {
  activeSection: SectionId;
  lastActiveDate: string;
  themeId: ThemeId;
  dailyGoalMinutes: number;
  plannerFilters: PlannerFilters;
  plannerSort: PlannerSort;
  plannerMode: PlannerMode;
  plannerFocusDate: string;
  enhancedThemeIds: string[];
  customCategories: string[];
  resourceLinks: ResourceLink[];
  examTimers: ExamTimer[];
  notesHtml: string;
  scoreTrendOptions: ScoreTrendOptions;
}

export type ErrorLogSource = "UWorld" | "TrueLearn" | "NBME" | "CMS Form" | "AMBOSS" | "COMSAE" | "Other";
export type ErrorLogSystem = "IM/FM" | "Surgery" | "OB/GYN" | "Pediatrics" | "Psychiatry" | "Ethics/Biostats" | "OMT" | "Other";
export type ErrorLogErrorType = "Knowledge Gap" | "Misread Question" | "Wrong Algorithm" | "Trap Answer";
export type ErrorLogPriority = "high" | "medium" | "low";

export interface ErrorLogEntry {
  id: string;
  source: ErrorLogSource;
  examBlock: string;
  system: ErrorLogSystem;
  topic: string;
  errorType: ErrorLogErrorType;
  // May contain inline HTML: <b>, <i>, <u>, <br> only (sanitized on save)
  missedPattern: string;
  // May contain inline HTML: <b>, <i>, <u>, <br> only (sanitized on save)
  fix: string;
  priority: ErrorLogPriority;
  entryDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorLogInput {
  id?: string;
  source: ErrorLogSource;
  examBlock: string;
  system: ErrorLogSystem;
  topic: string;
  errorType: ErrorLogErrorType;
  missedPattern: string;
  fix: string;
  priority: ErrorLogPriority;
  entryDate: string;
}

export interface AppState {
  version: number;
  studyBlocks: StudyBlock[];
  practiceTests: PracticeTest[];
  weakTopicEntries: WeakTopicEntry[];
  errorLogEntries: ErrorLogEntry[];
  preferences: Preferences;
}

export interface WorkbookImportPreview {
  studyBlocks: StudyBlockInput[];
  summary: {
    blockCount: number;
    categories: string[];
    startDate: string;
    endDate: string;
    warnings: string[];
  };
}

export interface BackupPayload {
  app: "step2-command-center";
  version: number;
  exportedAt: string;
  state: AppState;
}

export type TrashEntityType = "studyBlock" | "practiceTest" | "weakTopic";

export interface RecordCounts {
  studyBlocks: number;
  practiceTests: number;
  weakTopicEntries: number;
  trashedStudyBlocks: number;
  trashedPracticeTests: number;
  trashedWeakTopicEntries: number;
}

export interface BackupMetadata {
  id: string;
  createdAt: string;
  reason: string;
  schemaVersion: number;
  appVersion: string;
  counts: RecordCounts;
}

export interface BackupArtifactPreview {
  exportedAt: string;
  schemaVersion: number;
  appVersion: string;
  counts: RecordCounts;
}

export interface TrashItem {
  entityType: TrashEntityType;
  id: string;
  title: string;
  secondaryLabel: string;
  deletedAt: string;
}

export interface PersistenceSummary {
  storagePath: string;
  backupDirectory: string;
  schemaVersion: number;
  appVersion: string;
  lastSavedAt: string | null;
  recoveryMessage: string | null;
  legacyMigrationCompletedAt: string | null;
}

export interface PersistenceSnapshot {
  state: AppState;
  persistence: PersistenceSummary;
  backups: BackupMetadata[];
  trash: TrashItem[];
}
