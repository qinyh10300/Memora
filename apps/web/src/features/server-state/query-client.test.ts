import { describe, expect, it, vi } from "vitest";

import { ServerStateClient, serverStateKeys } from "./query-client";

describe("ServerStateClient", () => {
  it("deduplicates active requests and reuses fresh values", async () => {
    const client = new ServerStateClient();
    let resolveRequest: ((value: string[]) => void) | undefined;
    const queryFn = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const key = serverStateKeys.memories("workspace-1");

    const first = client.query({ key, queryFn, staleTimeMs: 10_000 });
    const second = client.query({ key, queryFn, staleTimeMs: 10_000 });
    resolveRequest?.(["memory-1"]);

    await expect(first).resolves.toEqual(["memory-1"]);
    await expect(second).resolves.toEqual(["memory-1"]);
    await expect(client.query({ key, queryFn, staleTimeMs: 10_000 })).resolves.toEqual([
      "memory-1",
    ]);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("invalidates a key family without touching unrelated data", () => {
    const client = new ServerStateClient();
    client.set(serverStateKeys.memories("workspace-1"), ["memory-1"]);
    client.set(serverStateKeys.memories("workspace-2"), ["memory-2"]);
    client.set(serverStateKeys.members("workspace-1"), ["user-1"]);

    client.invalidate(["memories"]);

    expect(client.peek(serverStateKeys.memories("workspace-1"))).toBeUndefined();
    expect(client.peek(serverStateKeys.memories("workspace-2"))).toBeUndefined();
    expect(client.peek(serverStateKeys.members("workspace-1"))).toEqual(["user-1"]);
  });

  it("rolls back optimistic updates and exposes a normalized retry policy", async () => {
    const client = new ServerStateClient();
    const key = serverStateKeys.memory("memory-1");
    client.set(key, { visibility: "PRIVATE" });

    await expect(
      client.mutate({
        optimistic: () => {
          const previous = client.peek(key);
          client.set(key, { visibility: "WORKSPACE" });
          return () => client.set(key, previous);
        },
        mutationFn: async () => {
          throw { message: "provider unavailable", status: 503 };
        },
      }),
    ).rejects.toMatchObject({
      name: "ServerStateError",
      code: "http_503",
      status: 503,
      retryable: true,
    });
    expect(client.peek(key)).toEqual({ visibility: "PRIVATE" });
  });

  it("invalidates configured queries only after a successful mutation", async () => {
    const client = new ServerStateClient();
    const memoriesKey = serverStateKeys.memories("workspace-1");
    client.set(memoriesKey, ["memory-1"]);

    await expect(
      client.mutate({
        mutationFn: async () => "saved",
        invalidate: [memoriesKey],
      }),
    ).resolves.toBe("saved");
    expect(client.peek(memoriesKey)).toBeUndefined();
  });
});
