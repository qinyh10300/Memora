# Live Chat Work Trace

Status: completed
Owner: Codex
Last updated: 2026-08-05

## Outcome

将 Memora 的记录对话升级为接近 InfMind、ChatGPT 和 Codex 的 Agent 交互体验：一轮请求
执行时，在消息流内实时展示可折叠的安全工作过程；结束后保留真实的附件读取、授权记忆
检索、模型调用、联网和保存工具结果。过程面板不展示供应商隐藏思维链，也不泄露提示词、
私有记忆正文、PDF 原文或密钥。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 要求 Conversation as the surface、显式保存、授权
  检索和失败时保留草稿；个人 Markdown MVP 继续保留右侧可编辑草稿。
- 相关架构与 ADR：`docs/architecture/overview.md` 要求可替换 AI 端口、OpenAPI 契约和服务端
  权限过滤；ADR-0002 规定 conversation 不是新的权限边界。
- 参照产品观察：InfMind 在助手消息中使用可展开的“思考/工作”区域、纵向过程线、工具标题、
  搜索结果和固定底部输入框。未登录访问专属会话会跳回官网，因此本计划只复刻用户提供截图及
  公开界面中可观察的交互，不复制其品牌、代码或不可见实现。
- 当前代码事实：Web 的过程步骤由客户端按 850ms 固定揭示；真实 `tool_events` 仅在同步
  `/drafts/chat` 完成后返回。云雾 OpenAI-compatible adapter 使用非流式 completions，且不返回
  可公开展示的隐藏思维链。
- GitNexus 影响分析：`chat_with_draft`、`_complete_with_draft_tools`、`DraftChatResponse`、
  `CaptureWorkspace` 和 `HomePage` 均为 LOW；现有路由图未识别 `/drafts/chat`，需以契约测试和
  Web 回归测试补足。

## Scope

### In scope

- 新增 SSE 流式 Chat 接口，按真实执行阶段发送安全过程事件，并以完整 `DraftChatResponse`
  结束；保留原同步接口兼容现有调用。
- 过程事件覆盖：请求理解、图片/PDF、授权记忆检索、embedding 降级、模型调用、`web_search`、
  `save_memory`、输出校验、Markdown 同步和失败保留。
- 过程事件只包含状态、耗时、数量、用户可见文件名、联网查询和安全摘要；不包含模型隐藏
  reasoning、系统提示词、私有证据正文、PDF 抽取正文或保存正文。
- Web 使用真实 SSE 事件更新运行中消息；连接中断时保留当前 Markdown，同步接口继续作为兼容入口。
- 将过程 UI 改为 InfMind 风格的可展开时间线和工具结果区，保持黑色为主、少量深蓝和淡蓝强调。
- 保留右侧 Markdown 草稿、显式保存、引用和联网来源交互。

### Non-goals

- 不声称或伪造供应商的完整思维链。
- 不复制 InfMind 品牌、文案、专有图标或前端源码。
- 不增加代码执行、浏览器控制、任意网页抓取或新工具权限。
- 不把聊天改成多 conversation 产品，也不移除当前个人记忆库与 Markdown 工作流。

## Design and boundaries

- 同步和流式路由调用同一个内部 Chat 编排函数。流式路由在独立数据库会话中执行阻塞模型
  调用，通过线程安全队列向 SSE 响应发送事件。
- 事件状态使用 `RUNNING | COMPLETED | SKIPPED | DEGRADED | REJECTED | FAILED`；事件 ID
  在同一轮中稳定，Web 以 ID 更新而不是重复追加。
- 保存工具仍由 `_has_explicit_save_request` 和服务端 `Principal` 决定；过程事件不能扩大权限。
- SSE 结果事件携带现有 OpenAPI `DraftChatResponse`。Web 仅为 SSE envelope 维护轻量协议类型，
  业务响应和过程步骤继续来自生成契约。
- 代理需关闭响应缓冲；客户端收到 `result` 前不得改写 Markdown。错误或断流时保留当前草稿。

## Milestones

- [x] M1 - 后端共享 Chat 编排和安全过程模型；验证：API 单元测试。
- [x] M2 - SSE 流式接口和真实工具事件；验证：流式集成测试、同步接口回归。
- [x] M3 - InfMind 风格可折叠过程面板和实时更新；验证：Web 组件测试。
- [x] M4 - 契约、构建、浏览器与本地部署验收；验证：`make check`、桌面/移动浏览器检查。

## Acceptance criteria

- [x] 发送消息后 1 秒内显示运行中的过程面板和已用秒数。
- [x] PDF、图片、记忆检索、联网和保存工具按真实执行状态更新。
- [x] 完成后过程默认可折叠，并显示模型、总耗时和 token 用量；工具和来源可继续展开查看。
- [x] 页面明确称为“工作过程/安全摘要”，不展示英文隐藏 reasoning 或供应商思维链。
- [x] SSE 中断、供应商超时或联网失败不覆盖右侧 Markdown，也不自动保存。
- [x] 现有图片、PDF、模型选择、联网、引用、显式保存和记忆库测试继续通过。
- [x] 主背景仍以黑色为主，深蓝只用于激活、当前步骤和发送按钮等少量强调。

## Verification

- 自动化检查：API tests、Web tests、OpenAPI 漂移、lint、typecheck、build、`make check`。
- 集成验证：SSE 事件顺序、同步路由兼容、工具成功/拒绝/失败和 timeout 降级。
- 手工或浏览器验证：本地登录后发送普通指令、PDF 指令和联网指令，检查展开/折叠、滚动、
  输入框和 Markdown 更新；桌面与移动 viewport 均无重叠。
- 安全与权限验证：事件体不含密钥、提示词、PDF 文本、私有记忆正文或保存正文。

## Rollout and recovery

- 无数据库迁移。旧 Web 可继续使用 `/drafts/chat`；新 Web 在流式接口异常时回退同步接口。
- 回滚只需恢复 Web 和 API 镜像，不影响已有记忆、资产和 embedding。

## Progress log

- 2026-08-05: 完成参照产品可观察交互、现有代码链路和 GitNexus 影响分析；开始实现。
- 2026-08-05: 完成安全过程模型、共享 Chat 编排、SSE 接口和前端增量解析；同步接口保持兼容。
- 2026-08-05: 完成 InfMind 风格纵向过程线、运行/完成/降级状态、模型与 token 摘要、工具与来源区。
- 2026-08-05: `make check` 通过，包括 30 个 Web 测试、81 个 API 测试、OpenAPI 漂移检查和生产构建。
- 2026-08-05: 本地部署通过真实云雾调用和无模型恢复路径验证；桌面与 390x844 移动视口无横向溢出，控制台无错误。

## Decision log

- 2026-08-05: 展示安全工作摘要而非隐藏思维链；原因是云雾兼容接口不提供完整思维链，直接
  暴露提示词或私有上下文也违反产品隐私边界。
- 2026-08-05: 保留同步接口并新增 SSE；原因是需要真实动态工具状态，同时保持兼容和降级能力。

## Completion summary

Memora 已使用真实 SSE 事件展示请求理解、附件、授权记忆检索、embedding、聊天模型、联网、
保存工具和输出校验状态。过程区只公开可验证的执行事实、耗时、数量、模型与 token，不公开模型
隐藏思维链、系统提示词或私有正文。前端保持黑色主背景，以少量深蓝和淡蓝表达当前步骤与操作。

本地 `http://localhost:8080/` 已重新部署并完成浏览器验收。真实调用确认当前聊天模型为
`gpt-5.6-terra`，embedding 为独立检索步骤；同步接口仍保留。剩余边界是云雾兼容接口本身不提供
可验证的完整隐藏 reasoning，因此界面展示的是 Memora 自己真实、可审计的工作过程，而不是伪造
思维链。
