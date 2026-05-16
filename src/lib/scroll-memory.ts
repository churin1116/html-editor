const STORAGE_KEY = "htmlEditor.scrollPositions";
const MAX_ENTRIES = 50;

type Store = Record<string, { top: number; at: number }>;

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota exceeded or storage disabled — drop silently.
  }
}

export function loadScroll(path: string): number {
  const entry = read()[path];
  return entry?.top ?? 0;
}

export function saveScroll(path: string, top: number): void {
  if (!path) return;
  const store = read();
  store[path] = { top, at: Date.now() };
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    // LRU cap by `at` — keep the most recently touched MAX_ENTRIES.
    const sorted = keys.sort((a, b) => store[b].at - store[a].at);
    const trimmed: Store = {};
    for (const k of sorted.slice(0, MAX_ENTRIES)) trimmed[k] = store[k];
    write(trimmed);
    return;
  }
  write(store);
}
