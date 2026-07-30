# Web-grounded Markdown Chatbot

Status: completed
Owner: Codex
Last updated: 2026-07-26

## Outcome

用户继续只面对一个 Chatbot，但可以控制当前轮是否联网。Memora 会先检索网页，
再结合当前对话、右侧 Markdown 和用户有权访问的个人记忆回答问题或更新草稿。
网页事实显示可点击来源；任何联网结果都不会自动保存为正式记忆。

## Product decisions

- 搜索不是独立页面或新导航，而是输入框中的轻量模式。
- 支持三种模式：
  - `AUTO`：默认。只有当前消息明显需要最新或外部信息时才联网。
  - `REQUIRED`：本轮强制联网，发送完成后恢复 `AUTO`。
  - `DISABLED`：不联网，只使用对话、当前 Markdown 和已授权个人记忆。
- 第一版不让搜索引擎自行读写数据库，也不允许网页指令覆盖系统规则。
- 搜索失败时继续保留当前 Markdown，并明确告诉用户本轮没有使用网页资料。

## Scope

### In scope

- 新增供应商无关的 `WebSearchPort`，由 OpenAI-compatible Responses adapter 实现。
- 使用原生 `web_search` 工具获取检索摘要、来源标题和 URL。
- 根据用户模式和确定性关键词决定是否搜索，并根据问题复杂度选择 `low` 或
  `medium` 搜索上下文。
- 把受长度和数量预算约束的网页证据交给现有结构化 Chat 模型，统一决定回答还是
  更新 Markdown。
- 模型更新右侧 Markdown 且使用网页证据时，附加可保存、可编辑的 Markdown 来源。
- API 返回搜索状态和实际使用的网页来源；Web 显示可点击引用。
- 记录搜索模型与 token 用量，但不记录查询、网页正文、提示词或密钥。
- 覆盖关闭联网、自动触发、强制联网、失败降级、恶意来源和非法 URL。

### Non-goals

- 通用浏览器自动化、登录付费网站、绕过访问限制或抓取任意 URL。
- 把完整网页、搜索缓存或图片落库。
- 后台深度研究任务、长时间异步爬取或全网持续监控。
- 团队记忆搜索、团队共享或跨用户检索。

## Design and boundaries

1. API 先完成身份校验和个人记忆权限过滤，再进行任何外部调用。
2. 搜索只收到当前用户查询，不收到其他用户的私有正文；搜索结果作为不可信证据。
3. `WebSearchPort` 只暴露查询、上下文深度、摘要、来源与用量。领域编排不依赖
   具体供应商 SDK 或 Responses JSON。
4. 搜索与最终草稿生成分为两阶段。第一阶段取网页证据，第二阶段继续复用现有
   Chat 模型的结构化 Markdown 输出。
5. 搜索摘要最多 12,000 字符，候选来源最多 8 个。最终模型只能返回搜索阶段提供的
   URL，API 再做白名单交集和 HTTP(S) 校验。
6. `REQUIRED` 或 `AUTO` 命中搜索意图但供应商不可用时，状态为 `DEGRADED`；
   最终模型不得假装已经联网。
7. 右侧仍是草稿。只有用户点击“保存为我的记忆”后，确认后的 Markdown 才进入
   PostgreSQL。

## Search intent

- 明确不搜索优先：如“不要联网”“只看我的记忆”。
- `REQUIRED` 总是搜索，`DISABLED` 从不搜索。
- `AUTO` 在“联网、搜索、查最新、新闻、官网、最近发布、当前价格”等明显需要外部
  或时效信息的表达中触发。
- “调研、综合、对比、多个来源、竞品、市场、详细”等复杂任务使用 `medium`；
  其他请求使用 `low`，避免每轮默认承担较高延迟和 token 成本。

## Acceptance criteria

- [x] 用户可以选择自动联网、本轮联网或关闭联网。
- [x] 自动模式的普通记忆编辑不调用搜索；明确的最新信息请求会调用搜索。
- [x] 强制联网的响应包含至少一个可点击 HTTP(S) 来源，且模式自动恢复为自动。
- [x] 用户要求把搜索结果整理到右侧时，Markdown 被更新并包含来源链接。
- [x] 搜索结果中的指令不能改变保存、权限或引用规则。
- [x] 模型返回未检索 URL 时，API 不向客户端暴露该 URL。
- [x] 搜索失败不覆盖当前 Markdown，页面明确展示降级状态。
- [x] 未点击保存时，搜索或生成内容不会创建 memory。
- [x] `make check` 通过，并在本地 Docker 中完成一次真实联网路径验证。

## Rollout and recovery

没有数据库迁移。可通过 `AI_WEB_SEARCH_ENABLED=false` 关闭搜索，Chatbot、图片理解、
个人记忆检索和 Markdown 保存继续工作。若供应商不支持 Responses `web_search`，
adapter 会降级而不会切换为未受控的网页抓取。

## Progress log

- 2026-07-26：确认云雾代理的 `gpt-5.6-terra` 支持 Responses API 原生
  `web_search`、`tool_choice=required`、来源明细和 URL citation。
- 2026-07-26：采用三态模式与两阶段编排，避免每条普通记忆都承担联网成本。
- 2026-07-26：实现 `WebSearchPort`、Responses adapter、搜索意图与深度选择、来源
  白名单、独立审计用量和失败降级。
- 2026-07-26：Web 输入框加入三态模式、联网中反馈与可点击网页来源；新增前后端
  回归测试并同步 OpenAPI 契约。
- 2026-07-26：`make check` 通过，包括 73 个 API 测试、19 个 Web 测试、契约检查
  和生产构建；`make e2e` 在真实 AI 配置下通过。
- 2026-07-26：本地 Docker 真实强制联网调用成功，生成含 3 个要点和 3 个 OpenAI
  来源的 Markdown；调用前后个人 memory 均为 3 条，确认没有自动保存。

## Completion summary

Memora 的个人 Markdown Chatbot 已支持可控联网。普通记录默认按意图自动判断，用户
也可以强制当前轮搜索或完全关闭联网。搜索结果经过独立证据阶段和结构化写作阶段，
只显示实际使用且经过白名单校验的 HTTP(S) 来源；搜索失败、无引用或模型失败都不会
覆盖当前草稿。没有数据库迁移，运维可以独立关闭搜索。
