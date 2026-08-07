import type {
  DraftDocumentAttachment,
  DraftImageAttachment,
  DraftTrace,
  DraftTraceStep,
  WebSearchMode,
} from "@/features/shared/contracts";
import type { AgentExecution } from "@/lib/api";

import { upsertTraceStep } from "./trace";

export type CaptureAgentPhase =
  "IDLE" | "RUNNING" | "CANCELLING" | "RECOVERING" | "COMPLETED" | "FAILED" | "CANCELLED";

export type CaptureRetryRequest = {
  instruction: string;
  images: DraftImageAttachment[];
  documents: DraftDocumentAttachment[];
  webSearch: WebSearchMode;
  modelId: string | null;
};

export type CaptureAgentState = {
  phase: CaptureAgentPhase;
  executionId: string | null;
  trace: DraftTrace | null;
  lastSequence: number;
  savedMemoryId: string | null;
  errorCode: string | null;
  retryRequest: CaptureRetryRequest | null;
};

export const INITIAL_CAPTURE_AGENT_STATE: CaptureAgentState = {
  phase: "IDLE",
  executionId: null,
  trace: null,
  lastSequence: 0,
  savedMemoryId: null,
  errorCode: null,
  retryRequest: null,
};

export type CaptureAgentAction =
  | { type: "START"; trace: DraftTrace; request: CaptureRetryRequest }
  | { type: "EXECUTION_IDENTIFIED"; executionId: string }
  | { type: "PROGRESS"; step: DraftTraceStep; sequence?: number | null }
  | { type: "RESULT"; trace: DraftTrace; savedMemoryId?: string | null }
  | { type: "CANCEL_REQUESTED" }
  | { type: "RECOVERY_STARTED"; executionId: string }
  | { type: "RECOVERED"; execution: AgentExecution; trace: DraftTrace }
  | {
      type: "FAILED";
      trace: DraftTrace;
      errorCode?: string | null;
      executionId?: string | null;
      cancelled?: boolean;
    }
  | { type: "RESET" };

export function captureAgentReducer(
  state: CaptureAgentState,
  action: CaptureAgentAction,
): CaptureAgentState {
  switch (action.type) {
    case "START":
      return {
        phase: "RUNNING",
        executionId: null,
        trace: action.trace,
        lastSequence: 0,
        savedMemoryId: null,
        errorCode: null,
        retryRequest: action.request,
      };
    case "EXECUTION_IDENTIFIED":
      return { ...state, executionId: action.executionId };
    case "PROGRESS":
      if (!state.trace) return state;
      return {
        ...state,
        phase: state.phase === "CANCELLING" ? "CANCELLING" : "RUNNING",
        lastSequence: Math.max(state.lastSequence, action.sequence ?? 0),
        trace: {
          ...state.trace,
          duration_ms: Math.max(state.trace.duration_ms, action.step.elapsed_ms),
          steps: upsertTraceStep(state.trace.steps, action.step),
        },
      };
    case "RESULT":
      return {
        ...state,
        phase: "COMPLETED",
        trace: action.trace,
        savedMemoryId: action.savedMemoryId ?? null,
        errorCode: null,
      };
    case "CANCEL_REQUESTED":
      if (state.phase !== "RUNNING" && state.phase !== "RECOVERING") return state;
      return { ...state, phase: "CANCELLING" };
    case "RECOVERY_STARTED":
      return { ...state, phase: "RECOVERING", executionId: action.executionId };
    case "RECOVERED":
      return {
        ...state,
        phase: phaseFromExecution(action.execution.status),
        executionId: action.execution.id,
        trace: action.trace,
        lastSequence: Math.max(
          state.lastSequence,
          action.execution.next_event_sequence - 1,
          ...action.execution.events.map((event) => event.sequence),
        ),
        savedMemoryId: action.execution.saved_memory_id,
        errorCode: action.execution.error_code,
      };
    case "FAILED":
      return {
        ...state,
        phase: action.cancelled ? "CANCELLED" : "FAILED",
        executionId: action.executionId ?? state.executionId,
        trace: action.trace,
        errorCode: action.errorCode ?? null,
      };
    case "RESET":
      return INITIAL_CAPTURE_AGENT_STATE;
  }
}

export function isCaptureAgentActive(phase: CaptureAgentPhase) {
  return phase === "RUNNING" || phase === "CANCELLING" || phase === "RECOVERING";
}

export function traceFromExecution(execution: AgentExecution, fallback: DraftTrace): DraftTrace {
  const steps = execution.events.reduce<DraftTraceStep[]>((current, event) => {
    const step: DraftTraceStep = {
      id: event.step_id,
      kind: normalizeStepKind(event.kind),
      status: normalizeStepStatus(event.status),
      title: event.title,
      detail: event.detail,
      elapsed_ms: event.elapsed_ms,
      duration_ms: event.duration_ms,
      item_count: event.item_count,
    };
    return upsertTraceStep(current, step);
  }, fallback.steps);
  return {
    ...fallback,
    model: execution.model_id ?? fallback.model,
    duration_ms: Math.max(fallback.duration_ms, 0, ...steps.map((step) => step.elapsed_ms)),
    steps,
  };
}

function normalizeStepKind(kind: string): DraftTraceStep["kind"] {
  if (
    kind === "PLAN" ||
    kind === "ANALYSIS" ||
    kind === "ATTACHMENT" ||
    kind === "RETRIEVAL" ||
    kind === "MODEL" ||
    kind === "TOOL" ||
    kind === "OUTPUT"
  ) {
    return kind;
  }
  return "ANALYSIS";
}

function phaseFromExecution(status: AgentExecution["status"]): CaptureAgentPhase {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "FAILED") return "FAILED";
  if (status === "COMPLETED" || status === "DEGRADED") return "COMPLETED";
  if (status === "CANCEL_REQUESTED") return "CANCELLING";
  return "RECOVERING";
}

function normalizeStepStatus(status: string): DraftTraceStep["status"] {
  if (
    status === "RUNNING" ||
    status === "COMPLETED" ||
    status === "SKIPPED" ||
    status === "DEGRADED" ||
    status === "REJECTED" ||
    status === "FAILED"
  ) {
    return status;
  }
  if (status === "CANCELLED") return "FAILED";
  return "RUNNING";
}
