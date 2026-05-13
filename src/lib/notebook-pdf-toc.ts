import type { NotebookPdfOutlineTextPage } from "./notebook-pdf-outline";

export interface NotebookPdfTocLineInput {
  text: string;
  pageIndex: number;
  x?: number;
  y?: number;
  scale?: number;
}

export interface NotebookPdfTocOutlineEntry {
  title: string;
  pageIndex: number;
  depth: number;
  children?: NotebookPdfTocOutlineEntry[];
}

export interface NotebookPdfTocGenerationOptions {
  totalPages: number;
  maxGeneratedEntries: number;
  textPages?: NotebookPdfOutlineTextPage[];
}

export interface NotebookPdfTocGenerationResult {
  entries: NotebookPdfTocOutlineEntry[];
  isStrong: boolean;
  mappingMode: "direct" | "offset" | "approximate";
  pageNumberOffset: number;
  warning?: string;
}

interface TocLineRecord extends NotebookPdfTocLineInput {
  order: number;
}

interface ParsedTocCandidate {
  title: string;
  printedPageNumber: number;
  sourcePageIndex: number;
  order: number;
  x?: number;
}

interface MappedTocCandidate extends ParsedTocCandidate {
  depthHint: number;
  pageIndex: number;
}

const LINE_Y_BUCKET_FACTOR = 2;
const MAX_TOC_LINE_LENGTH = 150;
const MAX_TOC_WORDS = 22;
const MIN_STRONG_TOC_ENTRIES = 3;
const INDENT_CHILD_THRESHOLD = 14;
const MAX_SAFE_OFFSET = 120;
const MIN_TITLE_MATCH_LENGTH = 4;

interface OffsetInferenceResult {
  offset: number;
  evidenceCount: number;
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitleKey(value: string): string {
  return normalizeSpace(value).toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRomanNumeral(value: string): boolean {
  return /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv)$/i.test(value);
}

function isPageNumberLike(text: string): boolean {
  const normalized = normalizeTitleKey(text);
  return (
    /^\d+$/.test(normalized) ||
    /^(?:p|pg|page)\.?\s*\d+$/.test(normalized) ||
    /^\d+\s*\/\s*\d+$/.test(normalized) ||
    isRomanNumeral(normalized)
  );
}

function containsLikelySentencePunctuation(value: string): boolean {
  return /[.!?]\s+[A-Z0-9]/.test(value);
}

function cleanTocTitle(value: string): string {
  return normalizeSpace(
    value
      .replace(/[·•]/g, ".")
      .replace(/\s*[;:]+$/g, ""),
  );
}

function parseTocLine(text: string): { title: string; printedPageNumber: number } | null {
  const normalized = normalizeSpace(text.replace(/[·•]/g, "."));
  if (!normalized || normalized.length > MAX_TOC_LINE_LENGTH || isPageNumberLike(normalized)) {
    return null;
  }

  // Common TOC row forms: "Title .... p.123", "Title p.123", "Title 123"
  const patterns = [
    /^(.+?)\s*(?:\.{2,}|…{1,}|-{2,})\s*(?:p(?:age)?\.?\s*)?(\d{1,4})$/i,
    /^(.+?)\s+(?:p(?:age)?\.?\s*)(\d{1,4})$/i,
    /^(.+?)\s+(\d{1,4})$/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }
    const rawTitle = cleanTocTitle(match[1] ?? "");
    const pageNumber = Number(match[2]);
    if (!rawTitle || !Number.isInteger(pageNumber) || pageNumber <= 0) {
      continue;
    }
    if (!/[A-Za-z]/.test(rawTitle) || isPageNumberLike(rawTitle)) {
      continue;
    }
    const words = rawTitle.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > MAX_TOC_WORDS) {
      continue;
    }
    if (containsLikelySentencePunctuation(rawTitle)) {
      continue;
    }
    return { title: rawTitle, printedPageNumber: pageNumber };
  }

  return null;
}

function inferPageNumberOffset(candidates: ParsedTocCandidate[]): OffsetInferenceResult {
  // Use low printed-page anchors when present; this catches front-matter offsets while
  // staying deterministic and conservative.
  const anchorOffsets = candidates
    .filter((candidate) => candidate.printedPageNumber <= 40 && candidate.sourcePageIndex <= 80)
    .map((candidate) => candidate.sourcePageIndex - (candidate.printedPageNumber - 1))
    .filter((offset) => Number.isInteger(offset) && Math.abs(offset) <= MAX_SAFE_OFFSET);

  if (anchorOffsets.length < 2) {
    return { offset: 0, evidenceCount: anchorOffsets.length };
  }

  anchorOffsets.sort((left, right) => left - right);
  const middle = Math.floor(anchorOffsets.length / 2);
  if (anchorOffsets.length % 2 === 1) {
    return { offset: anchorOffsets[middle] ?? 0, evidenceCount: anchorOffsets.length };
  }
  const left = anchorOffsets[middle - 1] ?? 0;
  const right = anchorOffsets[middle] ?? 0;
  return { offset: Math.round((left + right) / 2), evidenceCount: anchorOffsets.length };
}

function normalizeMatchKey(value: string): string {
  return normalizeTitleKey(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesLikelyMatch(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  return shorter.length >= MIN_TITLE_MATCH_LENGTH && longer.startsWith(shorter);
}

function inferOffsetFromTitleMatches(
  candidates: ParsedTocCandidate[],
  textPages: NotebookPdfOutlineTextPage[],
): OffsetInferenceResult {
  if (!Array.isArray(textPages) || textPages.length === 0 || candidates.length === 0) {
    return { offset: 0, evidenceCount: 0 };
  }

  const tocSourcePages = new Set<number>(candidates.map((candidate) => candidate.sourcePageIndex));
  const lines = collectNotebookPdfTocLinesFromTextPages(textPages)
    .filter((line) => !tocSourcePages.has(line.pageIndex))
    .map((line) => ({
      pageIndex: line.pageIndex,
      key: normalizeMatchKey(cleanTocTitle(line.text)),
    }))
    .filter((line) => line.key.length >= MIN_TITLE_MATCH_LENGTH);

  if (lines.length === 0) {
    return { offset: 0, evidenceCount: 0 };
  }

  const offsetVotes = new Map<number, number>();
  let evidenceCount = 0;

  for (const candidate of candidates) {
    const titleKey = normalizeMatchKey(candidate.title);
    if (titleKey.length < MIN_TITLE_MATCH_LENGTH) {
      continue;
    }
    const printedTargetPageIndex = candidate.printedPageNumber - 1;
    let bestOffset: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      if (!titlesLikelyMatch(titleKey, line.key)) {
        continue;
      }
      const offset = line.pageIndex - printedTargetPageIndex;
      if (!Number.isInteger(offset) || Math.abs(offset) > MAX_SAFE_OFFSET) {
        continue;
      }
      const distance = Math.abs(offset);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestOffset = offset;
      }
    }
    if (bestOffset === null) {
      continue;
    }
    evidenceCount += 1;
    offsetVotes.set(bestOffset, (offsetVotes.get(bestOffset) ?? 0) + 1);
  }

  if (evidenceCount < 2 || offsetVotes.size === 0) {
    return { offset: 0, evidenceCount };
  }

  let winningOffset = 0;
  let winningVotes = -1;
  for (const [offset, votes] of offsetVotes.entries()) {
    if (votes > winningVotes) {
      winningOffset = offset;
      winningVotes = votes;
      continue;
    }
    if (votes === winningVotes) {
      if (Math.abs(offset) < Math.abs(winningOffset)) {
        winningOffset = offset;
        continue;
      }
      if (Math.abs(offset) === Math.abs(winningOffset) && offset < winningOffset) {
        winningOffset = offset;
      }
    }
  }

  return { offset: winningOffset, evidenceCount: winningVotes };
}

function inferDepthHint(candidate: ParsedTocCandidate, minXByPage: Map<number, number>): number {
  const title = candidate.title;
  const numberedChild = /^\d{1,3}\s*[-.]\s*\d{1,3}\b/.test(title);
  let depth = numberedChild ? 1 : 0;
  if (Number.isFinite(candidate.x)) {
    const minX = minXByPage.get(candidate.sourcePageIndex);
    if (Number.isFinite(minX)) {
      const indent = (candidate.x as number) - (minX as number);
      if (indent >= INDENT_CHILD_THRESHOLD) {
        depth = Math.max(depth, 1);
      }
    }
  }
  return depth;
}

function sortCandidates(left: MappedTocCandidate, right: MappedTocCandidate): number {
  if (left.pageIndex !== right.pageIndex) {
    return left.pageIndex - right.pageIndex;
  }
  if (left.printedPageNumber !== right.printedPageNumber) {
    return left.printedPageNumber - right.printedPageNumber;
  }
  if (left.sourcePageIndex !== right.sourcePageIndex) {
    return left.sourcePageIndex - right.sourcePageIndex;
  }
  return left.order - right.order;
}

function buildHierarchy(candidates: MappedTocCandidate[], maxGeneratedEntries: number): NotebookPdfTocOutlineEntry[] {
  const deduped: MappedTocCandidate[] = [];
  const seenTitleKeys = new Set<string>();

  const sorted = [...candidates].sort(sortCandidates);
  for (const candidate of sorted) {
    if (deduped.length >= maxGeneratedEntries) {
      break;
    }
    const titleKey = normalizeTitleKey(candidate.title);
    if (!titleKey || seenTitleKeys.has(titleKey)) {
      continue;
    }
    seenTitleKeys.add(titleKey);
    deduped.push(candidate);
  }

  if (deduped.length === 0) {
    return [];
  }

  const roots: NotebookPdfTocOutlineEntry[] = [];
  let lastRoot: NotebookPdfTocOutlineEntry | null = null;

  for (const candidate of deduped) {
    if (candidate.depthHint <= 0 || !lastRoot) {
      const root: NotebookPdfTocOutlineEntry = {
        title: candidate.title,
        pageIndex: candidate.pageIndex,
        depth: 0,
      };
      roots.push(root);
      lastRoot = root;
      continue;
    }

    const child: NotebookPdfTocOutlineEntry = {
      title: candidate.title,
      pageIndex: candidate.pageIndex,
      depth: 1,
    };
    const children = lastRoot.children ?? [];
    children.push(child);
    lastRoot.children = children;
  }

  return roots;
}

function isStrongTocResult(entries: NotebookPdfTocOutlineEntry[], parsedCandidateCount: number): boolean {
  const flatTitles: NotebookPdfTocOutlineEntry[] = [];
  let hasChildren = false;
  const walk = (items: NotebookPdfTocOutlineEntry[]) => {
    for (const item of items) {
      flatTitles.push(item);
      if (item.children && item.children.length > 0) {
        hasChildren = true;
        walk(item.children);
      }
    }
  };
  walk(entries);

  if (flatTitles.length < MIN_STRONG_TOC_ENTRIES) {
    return false;
  }
  if (hasChildren) {
    return true;
  }
  return parsedCandidateCount >= MIN_STRONG_TOC_ENTRIES;
}

function toTocLineRecords(lines: NotebookPdfTocLineInput[]): TocLineRecord[] {
  const records: TocLineRecord[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !Number.isInteger(line.pageIndex) || line.pageIndex < 0) {
      continue;
    }
    const text = typeof line.text === "string" ? normalizeSpace(line.text) : "";
    if (!text) {
      continue;
    }
    records.push({
      text,
      pageIndex: line.pageIndex,
      x: Number.isFinite(line.x) ? line.x : undefined,
      y: Number.isFinite(line.y) ? line.y : undefined,
      scale: Number.isFinite(line.scale) ? line.scale : undefined,
      order: index,
    });
  }
  return records;
}

export function generateNotebookPdfOutlineFromTocLines(
  linesInput: NotebookPdfTocLineInput[],
  options: NotebookPdfTocGenerationOptions,
): NotebookPdfTocGenerationResult {
  const totalPages = Math.max(1, Math.trunc(options.totalPages));
  const maxGeneratedEntries = Math.max(1, Math.trunc(options.maxGeneratedEntries));
  const lines = toTocLineRecords(linesInput);

  const parsedCandidates: ParsedTocCandidate[] = [];
  for (const line of lines) {
    const parsed = parseTocLine(line.text);
    if (!parsed) {
      continue;
    }
    parsedCandidates.push({
      title: parsed.title,
      printedPageNumber: parsed.printedPageNumber,
      sourcePageIndex: line.pageIndex,
      order: line.order,
      x: line.x,
    });
  }

  if (parsedCandidates.length === 0) {
    return {
      entries: [],
      isStrong: false,
      mappingMode: "approximate",
      pageNumberOffset: 0,
      warning: "Unable to map printed page numbers from the table of contents.",
    };
  }

  const minXByPage = new Map<number, number>();
  for (const candidate of parsedCandidates) {
    if (!Number.isFinite(candidate.x)) {
      continue;
    }
    const currentMin = minXByPage.get(candidate.sourcePageIndex);
    if (currentMin === undefined || (candidate.x as number) < currentMin) {
      minXByPage.set(candidate.sourcePageIndex, candidate.x as number);
    }
  }

  const titleMatchOffset = inferOffsetFromTitleMatches(parsedCandidates, options.textPages ?? []);
  const anchorOffset = inferPageNumberOffset(parsedCandidates);
  const hasConfidentTitleOffset = titleMatchOffset.evidenceCount >= 2;
  const hasConfidentAnchorOffset = anchorOffset.evidenceCount >= 2;
  const resolvedOffset = hasConfidentTitleOffset
    ? titleMatchOffset.offset
    : hasConfidentAnchorOffset
      ? anchorOffset.offset
      : 0;
  const mappingMode: "direct" | "offset" | "approximate" =
    hasConfidentTitleOffset || hasConfidentAnchorOffset
      ? resolvedOffset === 0
        ? "direct"
        : "offset"
      : "approximate";

  const mappedCandidates: MappedTocCandidate[] = parsedCandidates.map((candidate) => {
    const mapped = candidate.printedPageNumber - 1 + resolvedOffset;
    return {
      ...candidate,
      depthHint: inferDepthHint(candidate, minXByPage),
      pageIndex: clamp(mapped, 0, totalPages - 1),
    };
  });

  const entries = buildHierarchy(mappedCandidates, maxGeneratedEntries);
  const warning =
    mappingMode === "approximate"
      ? "Printed TOC page numbers could not be calibrated exactly; page mapping is approximate."
      : undefined;
  return {
    entries,
    isStrong: isStrongTocResult(entries, parsedCandidates.length),
    mappingMode,
    pageNumberOffset: resolvedOffset,
    warning,
  };
}

function bucketY(y: number): number {
  return Math.round(y * LINE_Y_BUCKET_FACTOR) / LINE_Y_BUCKET_FACTOR;
}

export function collectNotebookPdfTocLinesFromTextPages(pages: NotebookPdfOutlineTextPage[]): NotebookPdfTocLineInput[] {
  const result: NotebookPdfTocLineInput[] = [];

  for (const page of pages) {
    if (!Number.isInteger(page.pageIndex) || page.pageIndex < 0 || !Array.isArray(page.items)) {
      continue;
    }

    const lineBuckets = new Map<number, { text: string; x: number; scale: number }[]>();
    for (const item of page.items) {
      const text = typeof item.text === "string" ? normalizeSpace(item.text) : "";
      if (!text || !Number.isFinite(item.y)) {
        continue;
      }
      const yBucket = bucketY(item.y);
      const bucket = lineBuckets.get(yBucket) ?? [];
      bucket.push({
        text,
        x: Number.isFinite(item.x) ? item.x : Number.POSITIVE_INFINITY,
        scale: Math.max(
          typeof item.fontSize === "number" && Number.isFinite(item.fontSize) ? Math.abs(item.fontSize) : 0,
          typeof item.transformScaleY === "number" && Number.isFinite(item.transformScaleY)
            ? Math.abs(item.transformScaleY)
            : 0,
        ),
      });
      lineBuckets.set(yBucket, bucket);
    }

    for (const [yBucket, fragments] of lineBuckets.entries()) {
      fragments.sort((left, right) => left.x - right.x);
      const text = normalizeSpace(fragments.map((fragment) => fragment.text).join(" "));
      if (!text) {
        continue;
      }
      const x = fragments.find((fragment) => Number.isFinite(fragment.x))?.x;
      const scale = Math.max(...fragments.map((fragment) => fragment.scale));
      result.push({
        text,
        pageIndex: page.pageIndex,
        x: Number.isFinite(x) ? x : undefined,
        y: yBucket,
        scale: Number.isFinite(scale) ? scale : undefined,
      });
    }
  }

  return result;
}
