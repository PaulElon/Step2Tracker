const STORAGE_KEY = "tf-deleted-native-ids";
const MAX_ENTRIES = 2000;

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function writeSet(ids: Set<string>): void {
  try {
    // Trim to MAX_ENTRIES keeping the most recently added (last in iteration order)
    const arr = [...ids];
    const trimmed = arr.length > MAX_ENTRIES ? arr.slice(arr.length - MAX_ENTRIES) : arr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage errors
  }
}

export function addDeletedNativeId(id: string): void {
  const ids = readSet();
  ids.add(id);
  writeSet(ids);
}

export function removeDeletedNativeId(id: string): void {
  const ids = readSet();
  if (ids.delete(id)) {
    writeSet(ids);
  }
}

export function getDeletedNativeIds(): ReadonlySet<string> {
  return readSet();
}
