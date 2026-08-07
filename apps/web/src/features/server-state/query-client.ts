export type QueryKeyPart = string | number | boolean | null | undefined;
export type QueryKey = readonly QueryKeyPart[];

type CacheEntry<T> = {
  key: QueryKey;
  value: T;
  updatedAt: number;
};

export class ServerStateError extends Error {
  constructor(
    message: string,
    readonly code = "server_state_failed",
    readonly status: number | null = null,
    readonly retryable = true,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ServerStateError";
  }
}

export const serverStateKeys = {
  workspaces: () => ["workspaces"] as const,
  models: () => ["draft-models"] as const,
  memories: (workspaceId: string) => ["memories", workspaceId] as const,
  memory: (memoryId: string) => ["memory", memoryId] as const,
  revisions: (memoryId: string) => ["memory-revisions", memoryId] as const,
  members: (workspaceId: string) => ["workspace-members", workspaceId] as const,
  search: (workspaceId: string, fingerprint: string) =>
    ["memory-search", workspaceId, fingerprint] as const,
};

export class ServerStateClient {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async query<T>({
    key,
    queryFn,
    staleTimeMs = 0,
    force = false,
  }: {
    key: QueryKey;
    queryFn: () => Promise<T>;
    staleTimeMs?: number;
    force?: boolean;
  }): Promise<T> {
    const serialized = serializeKey(key);
    const cached = this.cache.get(serialized) as CacheEntry<T> | undefined;
    if (!force && cached && Date.now() - cached.updatedAt <= staleTimeMs) return cached.value;

    const active = this.inFlight.get(serialized) as Promise<T> | undefined;
    if (active) return active;

    const request = queryFn()
      .then((value) => {
        this.cache.set(serialized, { key: [...key], value, updatedAt: Date.now() });
        return value;
      })
      .catch((error) => {
        throw normalizeServerStateError(error);
      })
      .finally(() => {
        this.inFlight.delete(serialized);
      });
    this.inFlight.set(serialized, request);
    return request;
  }

  peek<T>(key: QueryKey): T | undefined {
    return this.cache.get(serializeKey(key))?.value as T | undefined;
  }

  set<T>(key: QueryKey, value: T): void {
    this.cache.set(serializeKey(key), { key: [...key], value, updatedAt: Date.now() });
  }

  update<T>(key: QueryKey, updater: (current: T | undefined) => T): T {
    const next = updater(this.peek<T>(key));
    this.set(key, next);
    return next;
  }

  invalidate(prefix: QueryKey): void {
    for (const [serialized, entry] of this.cache) {
      if (keyStartsWith(entry.key, prefix)) this.cache.delete(serialized);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  async mutate<T>({
    mutationFn,
    optimistic,
    invalidate = [],
  }: {
    mutationFn: () => Promise<T>;
    optimistic?: () => void | (() => void);
    invalidate?: QueryKey[];
  }): Promise<T> {
    const rollback = optimistic?.();
    try {
      const result = await mutationFn();
      invalidate.forEach((key) => this.invalidate(key));
      return result;
    } catch (error) {
      rollback?.();
      throw normalizeServerStateError(error);
    }
  }
}

export function normalizeServerStateError(error: unknown): ServerStateError {
  if (error instanceof ServerStateError) return error;
  if (error && typeof error === "object") {
    const status =
      "status" in error && typeof error.status === "number"
        ? error.status
        : "response" in error &&
            error.response &&
            typeof error.response === "object" &&
            "status" in error.response &&
            typeof error.response.status === "number"
          ? error.response.status
          : null;
    const message =
      "message" in error && typeof error.message === "string"
        ? error.message
        : "请求失败，请稍后重试。";
    return new ServerStateError(
      message,
      status ? `http_${status}` : "server_state_failed",
      status,
      status === null || status === 408 || status === 429 || status >= 500,
      error,
    );
  }
  return new ServerStateError("请求失败，请稍后重试。", "server_state_failed", null, true, error);
}

function serializeKey(key: QueryKey) {
  return JSON.stringify(key);
}

function keyStartsWith(key: QueryKey, prefix: QueryKey) {
  return prefix.every((part, index) => key[index] === part);
}
