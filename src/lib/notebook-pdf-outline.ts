export interface NotebookPdfOutlineTextItem {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  transformScaleY?: number;
}

export interface NotebookPdfOutlineTextPage {
  pageIndex: number;
  items: NotebookPdfOutlineTextItem[];
}

export interface NotebookPdfGeneratedOutlineEntry {
  title: string;
  pageIndex: number;
}

export interface NotebookPdfOutlineGenerationOptions {
  maxPagesToScan?: number;
  maxGeneratedEntries?: number;
  maxHeadingLength?: number;
  maxHeadingWords?: number;
  minHeadingLength?: number;
  minScaleMultiplier?: number;
  repeatedLineMinPages?: number;
}

interface OutlineLineFragment {
  x: number;
  text: string;
  scale: number;
}

interface OutlineLine {
  pageIndex: number;
  yBucket: number;
  rawText: string;
  normalizedText: string;
  scale: number;
}

const DEFAULT_MAX_PAGES_TO_SCAN = 36;
const DEFAULT_MAX_GENERATED_ENTRIES = 60;
const DEFAULT_MAX_HEADING_LENGTH = 90;
const DEFAULT_MAX_HEADING_WORDS = 12;
const DEFAULT_MIN_HEADING_LENGTH = 3;
const DEFAULT_MIN_SCALE_MULTIPLIER = 1.2;
const DEFAULT_REPEATED_LINE_MIN_PAGES = 3;
const LINE_Y_BUCKET_FACTOR = 2;

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const next = Math.trunc(value as number);
  return next > 0 ? next : fallback;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitleKey(value: string): string {
  return normalizeSpace(value).toLowerCase();
}

function normalizeScale(item: NotebookPdfOutlineTextItem): number {
  const fontSize = Number(item.fontSize);
  const transformScaleY = Number(item.transformScaleY);
  const candidates = [Math.abs(fontSize), Math.abs(transformScaleY)].filter(
    (candidate) => Number.isFinite(candidate) && candidate > 0,
  );
  if (candidates.length === 0) {
    return 0;
  }
  return Math.max(...candidates);
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function bucketY(y: number): number {
  return Math.round(y * LINE_Y_BUCKET_FACTOR) / LINE_Y_BUCKET_FACTOR;
}

function buildOutlineLines(pages: NotebookPdfOutlineTextPage[]): OutlineLine[] {
  const lines: OutlineLine[] = [];

  for (const page of pages) {
    const buckets = new Map<number, OutlineLineFragment[]>();

    for (const item of page.items) {
      const text = typeof item.text === "string" ? item.text : "";
      const normalizedText = normalizeSpace(text);
      const scale = normalizeScale(item);
      if (!normalizedText || !Number.isFinite(item.y) || scale <= 0) {
        continue;
      }
      const yBucket = bucketY(item.y);
      const fragments = buckets.get(yBucket) ?? [];
      fragments.push({
        x: Number.isFinite(item.x) ? item.x : Number.POSITIVE_INFINITY,
        text: normalizedText,
        scale,
      });
      buckets.set(yBucket, fragments);
    }

    for (const [yBucket, fragments] of buckets.entries()) {
      fragments.sort((left, right) => left.x - right.x);
      const rawText = normalizeSpace(fragments.map((fragment) => fragment.text).join(" "));
      if (!rawText) {
        continue;
      }
      lines.push({
        pageIndex: page.pageIndex,
        yBucket,
        rawText,
        normalizedText: normalizeTitleKey(rawText),
        scale: Math.max(...fragments.map((fragment) => fragment.scale)),
      });
    }
  }

  return lines;
}

function isPageNumberLike(text: string): boolean {
  const normalized = normalizeTitleKey(text);
  return (
    /^\d+$/.test(normalized) ||
    /^\d+\s*\/\s*\d+$/.test(normalized) ||
    /^page\s+\d+(?:\s+of\s+\d+)?$/.test(normalized) ||
    /^(?:p\.?\s*)?\d+$/.test(normalized) ||
    /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(normalized)
  );
}

function isLikelyHeadingText(text: string, options: Required<NotebookPdfOutlineGenerationOptions>): boolean {
  const normalized = normalizeSpace(text);
  if (!normalized) {
    return false;
  }
  if (normalized.length < options.minHeadingLength || normalized.length > options.maxHeadingLength) {
    return false;
  }
  if (isPageNumberLike(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > options.maxHeadingWords) {
    return false;
  }

  // Full sentence punctuation usually indicates body text, not a heading label.
  if (/[.!?]$/.test(normalized)) {
    return false;
  }

  return true;
}

function resolveOptions(options: NotebookPdfOutlineGenerationOptions): Required<NotebookPdfOutlineGenerationOptions> {
  return {
    maxPagesToScan: clampPositiveInteger(options.maxPagesToScan, DEFAULT_MAX_PAGES_TO_SCAN),
    maxGeneratedEntries: clampPositiveInteger(options.maxGeneratedEntries, DEFAULT_MAX_GENERATED_ENTRIES),
    maxHeadingLength: clampPositiveInteger(options.maxHeadingLength, DEFAULT_MAX_HEADING_LENGTH),
    maxHeadingWords: clampPositiveInteger(options.maxHeadingWords, DEFAULT_MAX_HEADING_WORDS),
    minHeadingLength: clampPositiveInteger(options.minHeadingLength, DEFAULT_MIN_HEADING_LENGTH),
    minScaleMultiplier: Number.isFinite(options.minScaleMultiplier) && (options.minScaleMultiplier as number) > 0
      ? (options.minScaleMultiplier as number)
      : DEFAULT_MIN_SCALE_MULTIPLIER,
    repeatedLineMinPages: clampPositiveInteger(options.repeatedLineMinPages, DEFAULT_REPEATED_LINE_MIN_PAGES),
  };
}

export function generateNotebookPdfOutline(
  pagesInput: NotebookPdfOutlineTextPage[],
  optionsInput: NotebookPdfOutlineGenerationOptions = {},
): NotebookPdfGeneratedOutlineEntry[] {
  if (!Array.isArray(pagesInput) || pagesInput.length === 0) {
    return [];
  }

  const options = resolveOptions(optionsInput);
  const pages = pagesInput
    .filter((page) => Number.isInteger(page.pageIndex) && page.pageIndex >= 0 && Array.isArray(page.items))
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .slice(0, options.maxPagesToScan);

  if (pages.length === 0) {
    return [];
  }

  const lines = buildOutlineLines(pages);
  if (lines.length === 0) {
    return [];
  }

  const bodyScale = median(lines.map((line) => line.scale).filter((scale) => scale > 0));
  const minHeadingScale = bodyScale > 0 ? bodyScale * options.minScaleMultiplier : 0;

  const linePageCounts = new Map<string, Set<number>>();
  for (const line of lines) {
    if (!line.normalizedText) {
      continue;
    }
    const pagesForText = linePageCounts.get(line.normalizedText) ?? new Set<number>();
    pagesForText.add(line.pageIndex);
    linePageCounts.set(line.normalizedText, pagesForText);
  }

  const seenTitles = new Set<string>();
  const generated: NotebookPdfGeneratedOutlineEntry[] = [];

  for (const line of lines) {
    if (generated.length >= options.maxGeneratedEntries) {
      break;
    }

    if (line.scale < minHeadingScale) {
      continue;
    }

    if (!isLikelyHeadingText(line.rawText, options)) {
      continue;
    }

    const repeatedOnPages = linePageCounts.get(line.normalizedText)?.size ?? 0;
    if (repeatedOnPages >= options.repeatedLineMinPages) {
      continue;
    }

    const titleKey = normalizeTitleKey(line.rawText);
    if (!titleKey || seenTitles.has(titleKey)) {
      continue;
    }

    seenTitles.add(titleKey);
    generated.push({
      title: line.rawText,
      pageIndex: line.pageIndex,
    });
  }

  return generated;
}
