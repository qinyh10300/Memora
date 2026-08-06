import type { components, paths } from "@memora/api-contract";
import createClient from "openapi-fetch";

export const api = createClient<paths>({
  baseUrl: "/api",
  credentials: "include",
});

type DraftChatRequest = components["schemas"]["DraftChatRequest"];
type DraftChatResponse = components["schemas"]["DraftChatResponse"];
export type DraftChatStreamEvent =
  | components["schemas"]["DraftChatStreamProgressEvent"]
  | components["schemas"]["DraftChatStreamResultEvent"]
  | components["schemas"]["DraftChatStreamErrorEvent"];

export class DraftChatStreamError extends Error {
  constructor(
    message: string,
    readonly trace?: components["schemas"]["DraftTraceResponse"],
  ) {
    super(message);
    this.name = "DraftChatStreamError";
  }
}

export async function streamDraftChat(
  payload: DraftChatRequest,
  onEvent: (event: DraftChatStreamEvent) => void,
): Promise<DraftChatResponse> {
  const response = await fetch("/api/drafts/chat/stream", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    throw new DraftChatStreamError("聊天请求没有成功建立。请稍后再试。");
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
    if (event.type === "error") throw new DraftChatStreamError(event.message, event.trace);
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
