#!/usr/bin/env python3
"""Deterministic OpenAI-compatible provider used only by browser E2E tests."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = 18081


def _chat_context(messages: list[object]) -> tuple[str, str, list[str]]:
    latest_message = ""
    current_markdown = ""
    chunk_ids: list[str] = []
    for raw_message in messages:
        if not isinstance(raw_message, dict) or raw_message.get("role") != "user":
            continue
        content = raw_message.get("content")
        if not isinstance(content, str):
            continue
        try:
            decoded = json.loads(content)
        except json.JSONDecodeError:
            latest_message = content
            continue
        if not isinstance(decoded, dict) or "CONVERSATION_JSON" not in decoded:
            continue
        current_markdown_value = decoded.get("CURRENT_MARKDOWN")
        if isinstance(current_markdown_value, str):
            current_markdown = current_markdown_value
        conversation = decoded.get("CONVERSATION_JSON")
        if isinstance(conversation, list):
            for turn in conversation:
                if (
                    isinstance(turn, dict)
                    and turn.get("role") == "USER"
                    and isinstance(turn.get("content"), str)
                ):
                    latest_message = turn["content"]
        attachments = decoded.get("ATTACHMENT_CONTEXT_JSON")
        if isinstance(attachments, list):
            for attachment in attachments:
                chunks = attachment.get("chunks") if isinstance(attachment, dict) else None
                if not isinstance(chunks, list):
                    continue
                for chunk in chunks:
                    chunk_id = chunk.get("chunk_id") if isinstance(chunk, dict) else None
                    if isinstance(chunk_id, str):
                        chunk_ids.append(chunk_id)
    return latest_message, current_markdown, chunk_ids[:24]


def _draft_result(markdown: str, chunk_ids: list[str], *, saved: bool) -> str:
    body = markdown.strip() or (
        "# Browser E2E PDF 记忆\n\n- Memora 已完成真实 PDF 解析。\n- 这条内容由受控模型工具保存。"
    )
    return json.dumps(
        {
            "assistant_message": "已整理并保存到个人记忆。" if saved else "已整理到右侧草稿。",
            "markdown": body,
            "draft_changed": True,
            "used_memory_ids": [],
            "used_web_source_urls": [],
            "used_document_chunk_ids": chunk_ids,
        },
        ensure_ascii=False,
    )


class ProviderHandler(BaseHTTPRequestHandler):
    server_version = "MemoraFakeAI/1.0"

    def log_message(self, format: str, *args: object) -> None:
        del format, args

    def _json_response(self, status: int, body: dict[str, object]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._json_response(200, {"status": "ok"})
            return
        self._json_response(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            content_length = min(int(self.headers.get("Content-Length", "0")), 20 * 1024 * 1024)
            decoded = json.loads(self.rfile.read(content_length))
        except (ValueError, json.JSONDecodeError):
            self._json_response(400, {"error": "invalid_json"})
            return
        if not isinstance(decoded, dict):
            self._json_response(400, {"error": "invalid_payload"})
            return

        if self.path.endswith("/embeddings"):
            inputs = decoded.get("input")
            input_count = len(inputs) if isinstance(inputs, list) else 1
            self._json_response(
                200,
                {
                    "data": [
                        {"index": index, "embedding": [0.1, 0.2, 0.3]}
                        for index in range(input_count)
                    ],
                    "model": decoded.get("model", "e2e-embedding"),
                    "usage": {"prompt_tokens": input_count * 4, "total_tokens": input_count * 4},
                },
            )
            return

        if self.path.endswith("/responses"):
            self._json_response(
                200,
                {
                    "output": [
                        {
                            "type": "web_search_call",
                            "action": {
                                "sources": [
                                    {
                                        "url": "https://example.com/memora-e2e",
                                        "title": "Memora E2E source",
                                    }
                                ]
                            },
                        },
                        {
                            "type": "message",
                            "content": [
                                {
                                    "type": "output_text",
                                    "text": "Deterministic browser E2E evidence.",
                                    "annotations": [
                                        {
                                            "type": "url_citation",
                                            "url": "https://example.com/memora-e2e",
                                            "title": "Memora E2E source",
                                        }
                                    ],
                                }
                            ],
                        },
                    ],
                    "model": decoded.get("model", "e2e-search"),
                    "usage": {"input_tokens": 10, "output_tokens": 5},
                },
            )
            return

        if not self.path.endswith("/chat/completions"):
            self._json_response(404, {"error": "not_found"})
            return

        messages = decoded.get("messages")
        normalized_messages = messages if isinstance(messages, list) else []
        latest_message, current_markdown, chunk_ids = _chat_context(normalized_messages)
        has_tool_result = any(
            isinstance(message, dict) and message.get("role") == "tool"
            for message in normalized_messages
        )
        tools = decoded.get("tools")
        explicit_save = any(
            marker in latest_message.casefold()
            for marker in ("帮我保存", "保存这个", "保存这条", "save this", "remember this")
        )
        markdown = current_markdown.strip() or (
            "# Browser E2E PDF 记忆\n\n"
            "- Memora 已完成真实 PDF 解析。\n"
            "- 页面引用由服务端授权后生成。"
        )

        if isinstance(tools, list) and explicit_save and not has_tool_result:
            self._json_response(
                200,
                {
                    "choices": [
                        {
                            "message": {
                                "role": "assistant",
                                "content": "",
                                "tool_calls": [
                                    {
                                        "id": "e2e-save-memory",
                                        "type": "function",
                                        "function": {
                                            "name": "save_memory",
                                            "arguments": json.dumps(
                                                {
                                                    "body": markdown,
                                                    "document_chunk_ids": chunk_ids,
                                                },
                                                ensure_ascii=False,
                                            ),
                                        },
                                    }
                                ],
                            }
                        }
                    ],
                    "model": decoded.get("model", "e2e-chat"),
                    "usage": {"prompt_tokens": 24, "completion_tokens": 8},
                },
            )
            return

        self._json_response(
            200,
            {
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": _draft_result(markdown, chunk_ids, saved=has_tool_result),
                        }
                    }
                ],
                "model": decoded.get("model", "e2e-chat"),
                "usage": {"prompt_tokens": 36, "completion_tokens": 18},
            },
        )


def main() -> None:
    ThreadingHTTPServer((HOST, PORT), ProviderHandler).serve_forever()


if __name__ == "__main__":
    main()
