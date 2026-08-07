import { describe, expect, it } from "vitest";

import type { DraftTrace } from "@/features/shared/contracts";
import type { AgentExecution } from "@/lib/api";

import {
  captureAgentReducer,
  INITIAL_CAPTURE_AGENT_STATE,
  isCaptureAgentActive,
  traceFromExecution,
} from "./agent-state";

const trace: DraftTrace = {
  duration_ms: 0,
  model: "gpt",
  input_tokens: 0,
  output_tokens: 0,
  steps: [
    {
      id: "analysis",
      kind: "ANALYSIS",
      status: "RUNNING",
      title: "理解请求",
      detail: null,
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    },
  ],
};

const retryRequest = {
  instruction: "整理这段内容",
  images: [],
  documents: [],
  webSearch: "AUTO" as const,
  modelId: "gpt",
};

function execution(overrides: Partial<AgentExecution> = {}): AgentExecution {
  return {
    id: "00000000-0000-4000-8000-000000000111",
    status: "MODEL_RUNNING",
    model_id: "gpt",
    saved_memory_id: null,
    error_code: null,
    created_at: "2026-08-07T00:00:00Z",
    started_at: "2026-08-07T00:00:01Z",
    completed_at: null,
    next_event_sequence: 2,
    events: [],
    ...overrides,
  };
}

describe("captureAgentReducer", () => {
  it("tracks start, execution identity and ordered progress", () => {
    let state = captureAgentReducer(INITIAL_CAPTURE_AGENT_STATE, {
      type: "START",
      trace,
      request: retryRequest,
    });
    state = captureAgentReducer(state, {
      type: "EXECUTION_IDENTIFIED",
      executionId: "execution-1",
    });
    state = captureAgentReducer(state, {
      type: "PROGRESS",
      sequence: 3,
      step: { ...trace.steps[0], status: "COMPLETED", elapsed_ms: 18 },
    });

    expect(state).toMatchObject({
      phase: "RUNNING",
      executionId: "execution-1",
      lastSequence: 3,
      retryRequest,
    });
    expect(state.trace?.steps[0]).toMatchObject({ status: "COMPLETED", elapsed_ms: 18 });
    expect(isCaptureAgentActive(state.phase)).toBe(true);
  });

  it("represents cancellation without losing the retry payload", () => {
    const running = captureAgentReducer(INITIAL_CAPTURE_AGENT_STATE, {
      type: "START",
      trace,
      request: retryRequest,
    });
    const cancelling = captureAgentReducer(running, { type: "CANCEL_REQUESTED" });
    const cancelled = captureAgentReducer(cancelling, {
      type: "FAILED",
      trace,
      errorCode: "cancelled",
      cancelled: true,
    });

    expect(cancelling.phase).toBe("CANCELLING");
    expect(cancelled).toMatchObject({
      phase: "CANCELLED",
      errorCode: "cancelled",
      retryRequest,
    });
    expect(isCaptureAgentActive(cancelled.phase)).toBe(false);
  });

  it("recovers persisted events and a save receipt", () => {
    const running = captureAgentReducer(INITIAL_CAPTURE_AGENT_STATE, {
      type: "START",
      trace,
      request: retryRequest,
    });
    const recoveredExecution = execution({
      status: "COMPLETED",
      saved_memory_id: "memory-1",
      next_event_sequence: 5,
      events: [
        {
          sequence: 4,
          step_id: "output",
          kind: "OUTPUT",
          status: "COMPLETED",
          execution_status: "COMPLETED",
          title: "已保存",
          detail: "保存完成",
          elapsed_ms: 42,
          duration_ms: 3,
          item_count: 1,
          created_at: "2026-08-07T00:00:02Z",
        },
      ],
    });
    const recoveredTrace = traceFromExecution(recoveredExecution, trace);
    const recovered = captureAgentReducer(running, {
      type: "RECOVERED",
      execution: recoveredExecution,
      trace: recoveredTrace,
    });

    expect(recovered).toMatchObject({
      phase: "COMPLETED",
      lastSequence: 4,
      savedMemoryId: "memory-1",
    });
    expect(recovered.trace?.steps.at(-1)).toMatchObject({ id: "output", status: "COMPLETED" });
  });

  it("keeps failures retryable and resets explicitly", () => {
    const running = captureAgentReducer(INITIAL_CAPTURE_AGENT_STATE, {
      type: "START",
      trace,
      request: retryRequest,
    });
    const failed = captureAgentReducer(running, {
      type: "FAILED",
      trace,
      errorCode: "provider_timeout",
    });

    expect(failed).toMatchObject({ phase: "FAILED", errorCode: "provider_timeout" });
    expect(failed.retryRequest).toEqual(retryRequest);
    expect(captureAgentReducer(failed, { type: "RESET" })).toEqual(INITIAL_CAPTURE_AGENT_STATE);
  });
});
