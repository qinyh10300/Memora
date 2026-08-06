import type { components } from "@memora/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamDraftChat, type DraftChatStreamEvent } from "./api";

type DraftChatResponse = components["schemas"]["DraftChatResponse"];
type DraftTrace = components["schemas"]["DraftTraceResponse"];

const trace: DraftTrace = {
  duration_ms: 1420,
  model: "gpt-5.6-terra",
  input_tokens: 120,
  output_tokens: 32,
  steps: [
    {
      id: "model",
      kind: "MODEL",
      status: "COMPLETED",
      title: "gpt-5.6-terra 已返回",
      detail: "聊天调用已完成。",
      elapsed_ms: 1200,
      duration_ms: 900,
      item_count: null,
    },
  ],
};

const chatResponse: DraftChatResponse = {
  markdown: "# 流式结果",
  assistant_message: "已完成。",
  draft_changed: true,
  model_status: "AVAILABLE",
  model_id: "balanced",
  citations: [],
  web_search_status: "NOT_USED",
  web_citations: [],
  tool_events: [],
  saved_memory: null,
  trace,
};

function eventStreamResponse(events: DraftChatStreamEvent[]) {
  const encoded = new TextEncoder().encode(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
  );
  const midpoint = Math.floor(encoded.length / 2);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, midpoint));
        controller.enqueue(encoded.slice(midpoint));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("streamDraftChat", () => {
  it("跨网络分块解析过程事件和最终响应", async () => {
    const progress: DraftChatStreamEvent = {
      type: "progress",
      step: trace.steps[0],
    };
    const result: DraftChatStreamEvent = { type: "result", response: chatResponse };
    const fetchMock = vi.fn().mockResolvedValue(eventStreamResponse([progress, result]));
    vi.stubGlobal("fetch", fetchMock);
    const events: DraftChatStreamEvent[] = [];

    const response = await streamDraftChat(
      {
        markdown: "",
        messages: [{ role: "USER", content: "整理这段内容" }],
        web_search: "AUTO",
      },
      (event) => events.push(event),
    );

    expect(response).toEqual(chatResponse);
    expect(events).toEqual([progress, result]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/drafts/chat/stream",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("把服务端安全错误和已完成过程带回调用方", async () => {
    const errorEvent: DraftChatStreamEvent = {
      type: "error",
      code: "stream_failed",
      message: "请求未完成。",
      trace,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(eventStreamResponse([errorEvent])));

    await expect(
      streamDraftChat(
        {
          markdown: "# 保留",
          messages: [{ role: "USER", content: "继续整理" }],
          web_search: "DISABLED",
        },
        () => undefined,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "DraftChatStreamError",
        message: "请求未完成。",
        trace,
      }),
    );
  });
});
