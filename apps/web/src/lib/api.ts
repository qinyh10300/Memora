import type { components, paths } from "@memora/api-contract";
import createClient from "openapi-fetch";

export const api = createClient<paths>({
  baseUrl: "/api",
  credentials: "include",
});

type DraftChatRequest = components["schemas"]["DraftChatRequest"];
type DraftChatResponse = components["schemas"]["DraftChatResponse"];
export type SpeechTranscription = components["schemas"]["SpeechTranscriptionResponse"];
export type AgentExecution = components["schemas"]["AgentExecutionResponse"];
export type DraftChatStreamEvent =
  | components["schemas"]["DraftChatStreamProgressEvent"]
  | components["schemas"]["DraftChatStreamResultEvent"]
  | components["schemas"]["DraftChatStreamErrorEvent"];

export class DraftChatStreamError extends Error {
  constructor(
    message: string,
    readonly trace?: components["schemas"]["DraftTraceResponse"],
    readonly code?: string,
    readonly executionId?: string,
  ) {
    super(message);
    this.name = "DraftChatStreamError";
  }
}

export class AudioTranscriptionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AudioTranscriptionError";
  }
}

export async function transcribeAudio(
  audio: Blob,
  signal?: AbortSignal,
): Promise<SpeechTranscription> {
  const response = await fetch("/api/audio/transcriptions", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": audio.type || "audio/webm",
    },
    body: audio,
    signal,
  });
  if (!response.ok) {
    let message = "语音转写没有成功，请稍后再试。";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string" && payload.detail.trim()) {
        message = payload.detail;
      }
    } catch {
      // Keep the safe fallback for non-JSON upstream failures.
    }
    throw new AudioTranscriptionError(message, response.status);
  }
  return (await response.json()) as SpeechTranscription;
}

export async function streamDraftChat(
  payload: DraftChatRequest,
  onEvent: (event: DraftChatStreamEvent) => void,
  options: {
    signal?: AbortSignal;
    onExecutionId?: (executionId: string) => void;
  } = {},
): Promise<DraftChatResponse> {
  const response = await fetch("/api/drafts/chat/stream", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });
  const executionId = response.headers.get("x-agent-execution-id") ?? undefined;
  if (executionId) options.onExecutionId?.(executionId);
  if (!response.ok || !response.body) {
    throw new DraftChatStreamError(
      "聊天请求没有成功建立。请稍后再试。",
      undefined,
      `http_${response.status}`,
      executionId,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new DraftChatStreamError("服务端没有返回可用的工作过程流。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DraftChatResponse | null = null;

  function consumeBlock(block: string) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const event = JSON.parse(data) as DraftChatStreamEvent;
    onEvent(event);
    if (event.type === "result") result = event.response;
    if (event.type === "error") {
      throw new DraftChatStreamError(
        event.message,
        event.trace,
        event.code,
        event.execution_id ?? executionId,
      );
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consumeBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
  if (buffer.trim()) consumeBlock(buffer);
  if (!result) throw new DraftChatStreamError("工作过程流在返回结果前结束了。");
  return result;
}

export async function getAgentExecution(
  executionId: string,
  afterSequence = 0,
): Promise<AgentExecution> {
  const query = new URLSearchParams({ after_sequence: String(afterSequence) });
  const response = await fetch(`/api/agent/executions/${executionId}?${query}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error("执行记录暂时无法读取。");
  return (await response.json()) as AgentExecution;
}

export async function cancelAgentExecution(executionId: string): Promise<AgentExecution> {
  const response = await fetch(`/api/agent/executions/${executionId}/cancel`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("这轮执行暂时无法取消。");
  return (await response.json()) as AgentExecution;
}
