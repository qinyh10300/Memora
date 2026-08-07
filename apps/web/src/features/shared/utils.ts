let localId = 0;

export function nextId(prefix: string) {
  localId += 1;
  return `${prefix}-${Date.now()}-${localId}`;
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function readStoredNumber(key: string) {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === null || stored.trim() === "") return null;
    const value = Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeNumber(key: string, value: number) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences are optional and must never block the workspace.
  }
}

export function readStoredBoolean(key: string) {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(key);
    return value === "true" ? true : value === "false" ? false : null;
  } catch {
    return null;
  }
}

export function storeBoolean(key: string, value: boolean) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences are optional and must never block the workspace.
  }
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string") {
    return error.detail;
  }
  return fallback;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("file_read_failed"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function sourceHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

export function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "今天";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

export function memoryTitle(body: string) {
  const firstContentLine = body
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find(Boolean);
  if (!firstContentLine) return "未命名记忆";
  return firstContentLine.length > 34 ? `${firstContentLine.slice(0, 33)}…` : firstContentLine;
}

export function memoryExcerpt(body: string) {
  const normalized = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`[\]()~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}
