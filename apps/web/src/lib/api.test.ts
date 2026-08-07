import type { components } from "@memora/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelAgentExecution,
  getAgentExecution,
  streamDraftChat,
  type AgentExecution,
  type DraftChatStreamEvent,
} from "./api";

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

function eventStreamResponse(events: DraftChatStreamEvent[], executionId?: string) {
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
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        ...(executionId ? { "x-agent-execution-id": executionId } : {}),
      },
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("streamDraftChat", () => {
  it("跨网络分块解析过程事件和最终响应", async () => {
    const executionId = "00000000-0000-4000-8000-000000000101";
    const progress: DraftChatStreamEvent = {
      type: "progress",
      execution_id: executionId,
      sequence: 1,
      step: trace.steps[0],
    };
    const result: DraftChatStreamEvent = {
      type: "result",
      execution_id: executionId,
      response: { ...chatResponse, execution_id: executionId },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(eventStreamResponse([progress, result], executionId));
    vi.stubGlobal("fetch", fetchMock);
    const events: DraftChatStreamEvent[] = [];
    const onExecutionId = vi.fn();

    const response = await streamDraftChat(
      {
        markdown: "",
        messages: [{ role: "USER", content: "整理这段内容" }],
        web_search: "AUTO",
      },
      (event) => events.push(event),
      { onExecutionId },
    );

    expect(response).toEqual({ ...chatResponse, execution_id: executionId });
    expect(events).toEqual([progress, result]);
    expect(onExecutionId).toHaveBeenCalledWith(executionId);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/drafts/chat/stream",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("把服务端安全错误和已完成过程带回调用方", async () => {
    const executionId = "00000000-0000-4000-8000-000000000102";
    const errorEvent: DraftChatStreamEvent = {
      type: "error",
      execution_id: executionId,
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
        code: "stream_failed",
        executionId,
      }),
    );
  });
});

describe("agent execution recovery", () => {
  const execution: AgentExecution = {
    id: "00000000-0000-4000-8000-000000000103",
    status: "MODEL_RUNNING",
    model_id: "gemini",
    saved_memory_id: null,
    error_code: null,
    created_at: "2026-08-07T00:00:00Z",
    started_at: "2026-08-07T00:00:01Z",
    completed_at: null,
    next_event_sequence: 3,
    events: [],
  };

  it("按事件序号增量恢复并发起取消", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(execution), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...execution, status: "CANCEL_REQUESTED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getAgentExecution(execution.id, 2)).resolves.toEqual(execution);
    await expect(cancelAgentExecution(execution.id)).resolves.toEqual({
      ...execution,
      status: "CANCEL_REQUESTED",
    });
    expect(fetchMock.mock.calls[0]?.[0].toString()).toContain(
      `/api/agent/executions/${execution.id}?after_sequence=2`,
    );
    expect(fetchMock.mock.calls[1]?.[0].toString()).toContain(
      `/api/agent/executions/${execution.id}/cancel`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: "POST" }));
  });
});
