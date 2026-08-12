import { describe, expect, it } from "vitest";

import type { DraftChatResponse, DraftMemoryScope } from "@/features/shared/contracts";

import { buildCompletedTrace } from "./trace";

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
