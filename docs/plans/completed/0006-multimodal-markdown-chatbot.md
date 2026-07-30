# Multimodal Markdown Chatbot

Status: completed
Owner: Codex
Last updated: 2026-07-26

## Outcome

“记录想法”支持在同一 Chatbot 中附加图片。模型可以理解图片、提取图片文字、
回答问题，并按用户要求更新右侧 Markdown；图片本身不进入正式记忆，用户仍需点击
“保存为我的记忆”才能保存确认后的 Markdown。

## Context

- 当前运行模型是 `gpt-4o-mini`，只通过文本 `ChatMessage` 调用。
- 云雾当前账号提供 `gpt-5.6-terra`，实际兼容 `v1/chat/completions` 的图片输入。
- OpenAI 官方 vision 契约允许通过 Base64 data URL 向 Chat Completions 传入图片。
- 产品文档此前把图片上传列为非目标，本计划按用户的新决定更新该边界。

## Scope

### In scope

- 把默认聊天模型升级到 `gpt-5.6-terra`。
- Chat 模型端口增加供应商无关的图片输入类型，兼容 adapter 负责转换协议。
- capture Chatbot 每轮最多附加 3 张 PNG、JPEG 或 WEBP 图片。
- Web 提供图片选择、预览、移除、仅图片发送和错误提示。
- 模型可以 OCR、理解图片、回答问题或修改当前 Markdown。
- 继续检索当前用户整个授权个人记忆语料；只向模型发送受预算限制的相关证据。
- 图片大小、类型、魔数、总量、身份、失败降级和不自动保存均有测试。

### Non-goals

- 把原图、缩略图或 OCR 中间结果保存到数据库或对象存储。
- PDF、文档、音频、视频、动图或图片生成。
- 跨页面持久化图片和对话历史。
- 把全部个人记忆正文无上限塞进一次模型调用。

## Design and boundaries

1. Web 在本地读取图片为 Base64，只在当前发送动作中提交；不调用独立上传存储接口。
2. API 重新校验 MIME、Base64、文件魔数、单图大小、图片数量和总大小。
3. `ChatModelPort` 使用 `ChatImageInput` 描述图片；OpenAI-compatible adapter 才知道
   `image_url` data URL 的具体协议。
4. 模型收到当前会话、当前 Markdown、授权记忆证据和本轮图片。图片与其中的文字均
   视为不可信输入，不能覆盖系统规则。
5. 模型输出仍使用现有结构化草稿响应；失败时保留右侧 Markdown。
6. 审计只记录模型和 token 用量，不记录图片、Base64、OCR 正文或提示词。
7. 图片原始字节不持久化；只有用户检查后的 Markdown 可以走现有保存接口。

## Limits

- 类型：PNG、JPEG、WEBP。
- 每轮最多 3 张。
- 单张最多 8 MiB。
- 每轮解码后总计最多 16 MiB。
- 模型使用 `high` 图片细节，以支持截图和文字识别，同时避免 `original` 的不可控成本。

## Acceptance criteria

- [x] 用户可附加、预览、移除并发送图片。
- [x] 没有文字时也可以发送图片，系统提供明确的默认 OCR 指令。
- [x] 模型能读取图片，并根据要求回答或更新右侧 Markdown。
- [x] 后续文本轮次仍携带本次会话和当前 Markdown，但不会重复发送旧图片字节。
- [x] 非法类型、伪造 MIME、损坏 Base64、超限图片在服务端被拒绝。
- [x] 图片和生成内容都不会自动写入 memory。
- [x] AI 失败时当前 Markdown 不丢失。
- [x] 其他用户私有 memory 不进入模型上下文或引用。
- [x] `make check` 和真实 Docker 图片路径通过。

## Rollout and recovery

没有数据库迁移。回退时可把 `AI_CHAT_MODEL` 改回原模型，并隐藏 Web 附件按钮；
文本 Chatbot、Markdown 草稿和记忆保存接口保持兼容。

## Progress log

- 2026-07-26：确认本地实际运行 `gpt-4o-mini`，云雾模型列表包含
  `gpt-5.6-terra`。
- 2026-07-26：使用现有云雾代理和真实截图探测 `gpt-5.6-terra` 的
  Chat Completions 图片输入，成功识别产品名 “Memora”。
- 2026-07-26：扩展供应商无关 Chat 端口、OpenAI-compatible adapter、草稿 API、
  OpenAPI 契约和 Web 附件交互。
- 2026-07-26：真实页面上传 619,035 字节图片请求，模型识别 3 条用户气泡并更新
  Markdown；下一轮纯文本请求为 693 字节，证明旧图片未重复发送。
- 2026-07-26：两次真实调用的审计模型均为 `gpt-5.6-terra`；未点击保存，匹配
  OCR 内容的 memory 数量为 0。
- 2026-07-26：`make check` 通过，包括 65 个 API 测试、18 个 Web 测试、
  OpenAPI 契约和生产构建。

## Completion summary

Memora capture 已成为支持图片理解和 OCR 的多模态 Markdown Chatbot。用户可以在
同一输入框附加图片、提问或要求改稿，右侧继续显示可手动编辑的 Markdown。原图只在
当前轮短暂传给模型，后续轮次不重复发送，也不进入数据库；正式记忆仍需要用户点击
保存。当前本地默认模型已升级为 `gpt-5.6-terra`，没有数据库迁移。
