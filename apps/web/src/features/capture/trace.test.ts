import { describe, expect, it } from "vitest";

import type { DraftChatResponse, DraftMemoryScope } from "@/features/shared/contracts";

import { buildCompletedTrace, willSearchWeb } from "./trace";

const response: DraftChatResponse = {
  markdown: "",
  assistant_message: "已回答。",
  draft_changed: false,
  model_status: "AVAILABLE",
  model_id: "balanced",
  citations: [],
  web_search_status: "NOT_USED",
  web_citations: [],
  tool_events: [],
  saved_memory: null,
  credits_charged: 10,
  trace: null,
};

function completedTrace(memoryScope: DraftMemoryScope) {
  return buildCompletedTrace({
    modelLabel: "Balanced",
    images: [],
    documents: [],
    requestedWebSearch: false,
    memoryScope,
    response,
  });
}

describe("buildCompletedTrace", () => {
  it("does not claim that general chat retrieved personal memories", () => {
    const retrieval = completedTrace("NONE").steps.find((step) => step.id === "retrieval");

    expect(retrieval).toMatchObject({
      status: "SKIPPED",
      title: "本轮不使用记忆",
      item_count: 0,
    });
    expect(retrieval?.detail).not.toContain("个人记忆");
  });

  it("labels team retrieval as shared team memory", () => {
    const retrieval = completedTrace("TEAM").steps.find((step) => step.id === "retrieval");

    expect(retrieval).toMatchObject({
      status: "COMPLETED",
      title: "团队共享记忆已检索",
    });
  });
});

describe("willSearchWeb", () => {
  it("keeps memory-only search inside the authorized memory harness", () => {
    expect(willSearchWeb("搜索我的记忆并提炼关键点", "AUTO", "PERSONAL")).toBe(false);
    expect(willSearchWeb("搜索团队记忆里的项目决定", "AUTO", "TEAM")).toBe(false);
  });

  it("still recognizes explicit web intent and required mode", () => {
    expect(willSearchWeb("搜索我的记忆并联网补充最新消息", "AUTO", "PERSONAL")).toBe(true);
    expect(willSearchWeb("搜索我的记忆", "REQUIRED", "PERSONAL")).toBe(true);
    expect(willSearchWeb("搜索一下最新消息", "DISABLED", "NONE")).toBe(false);
  });
});
