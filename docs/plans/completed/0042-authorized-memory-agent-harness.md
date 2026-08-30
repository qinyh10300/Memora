# Authorized memory agent harness and live progress

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

让 Memora Chatbot 在用户明确选择 PERSONAL 或 TEAM 记忆范围时，能够通过受控 Agent
工具在整个已授权 memory 语料库中执行一次或多次检索，选出关键证据后生成回答；检索、
模型、工具和输出校验过程以安全事件实时显示在聊天流中，并具有持续计时、运行态动画、
折叠详情和失败降级。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 要求默认不召回记忆、显式 memory scope、先授权过滤、
  事实回答引用原始记录以及证据不足时明确不知道。
- 相关架构与 ADR：`docs/architecture/overview.md` 要求 provider-independent AI ports；
  ADR-0005 要求模型切换不扩大权限；ADR-0008 禁止公开隐藏思维链。
- 当前代码事实：
  - OpenAI-compatible adapter 已提供最多 5 轮 `complete_with_tools` 循环。
  - `AgentToolRegistry` 已提供参数校验、策略、调用次数、超时、重试和安全结果。
  - `agent_executions / agent_events`、SSE progress、取消和断线恢复已经存在。
  - `ActivityTrace` 已在聊天流内显示公开步骤，但当前 memory 召回只在模型前静态准备
    最近或语义 Top-12；工具注册表只暴露 `web_search` 和 `save_memory`。

## Scope

### In scope

- 新增 `search_memories` 工具，只允许搜索本轮显式 PERSONAL 或 TEAM 范围。
- 工具在授权 SQL 候选上执行全文/精确/trigram 检索；模型不能指定用户、workspace、
  visibility 或绕过删除状态。
- 将工具找到的记录按 ID 去重并纳入统一 evidence budget，最终引用前再次授权。
- 每次 memory 工具调用生成独立、安全的 SSE 步骤，显示授权范围摘要、候选数量、耗时和状态。
- 优化聊天内工作过程的运行态动画、当前步骤摘要和可访问性；继续明确“不包含隐藏思维链”。
- 增加 API、Agent 工具和 Web 组件回归测试，更新 OpenAPI 生成产物（如契约变化）。

### Non-goals

- 不把全部 memory 正文一次性发送给模型，也不承诺无上限上下文。
- 不让 GENERAL 通用聊天自动读取 memory；“全库”仅表示本轮授权范围内的完整可搜索语料库。
- 不展示模型隐藏思维链、原始提示词、工具参数中的私密正文或未采用候选。
- 不新增微服务、第二个向量库或浏览器自动化 Agent。

## Assumptions and open questions

- [x] “搜索所有 memory”解释为搜索整个授权语料库后返回受预算约束的关键证据，而不是把
  全库原文塞入上下文。
- [x] PERSONAL 只搜索当前作者；TEAM 只搜索当前 workspace 中仍为 WORKSPACE 的活动记录。
- [x] GENERAL 继续保持 `memory_scope=NONE`，避免静默扩大数据使用范围。

## Design and boundaries

`search_memories(query, limit)` 由模型调用，但策略与范围由服务端固定。参数只包含查询文本和
有限的结果数量；服务端先构造 `authorized_memories_statement`，再追加 PERSONAL/TEAM
过滤并执行 PostgreSQL exact/full-text/trigram 搜索。返回给模型的每条结果只包含 memory ID、
作者、记录时间和截断正文。工具最多调用 3 次；外层 provider loop 最多 5 轮。

已有模型前召回保留为首轮候选和无工具模型的降级路径。工具结果与首轮候选按 memory ID
合并，并重新执行总条数/字符预算。模型只能从该 evidence 集合声明 `used_memory_ids`；持久化
前再次调用 `reauthorize_evidence`，授权变化则放弃本轮结果并保留草稿。

公开事件只描述“搜索什么、找到多少候选、正在综合关键点、引用校验是否完成”。不记录或
展示 chain-of-thought。SSE 中断后继续以持久化 agent events 恢复。

## Milestones

- [x] M1 — `search_memories` 工具、范围策略、预算合并和动态事件；验证：API 定向测试。
- [x] M2 — 聊天内运行态动效和步骤摘要；验证：Web 组件测试与浏览器观察。
- [x] M3 — 契约、完整检查和本地运行验证；验证：`make check`、本地 Chat 流程。

## Acceptance criteria

- [x] PERSONAL 查询不会返回其他作者的记录。
- [x] TEAM 查询只返回当前团队主动共享且仍可访问的记录。
- [x] GENERAL 不暴露或执行 memory 搜索工具。
- [x] 同轮多次 memory 查询有调用次数上限、去重和总 evidence budget。
- [x] 模型只能引用工具或首轮召回得到且最终仍授权的 memory ID。
- [x] 聊天框在运行中实时显示检索、模型和校验进度、耗时及状态动画。
- [x] UI 明确说明过程是安全摘要，不是隐藏思维链。
- [x] 搜索/模型/SSE 失败时保留当前 Markdown，不创建 memory。

## Verification

- 自动化检查：API drafts/agent tools 测试、Web activity trace/agent state 测试、类型检查、
  OpenAPI 漂移检查和构建。
- 集成验证：真实 PostgreSQL 授权检索、SSE 事件顺序、取消与断线恢复。
- 手工或浏览器验证：PERSONAL/TEAM 问答中观察多步检索动画、折叠详情和最终来源。
- 安全与权限验证：跨用户、跨 workspace、PRIVATE/WORKSPACE、撤回和删除路径。

## Rollout and recovery

该变更不需要数据库迁移。回滚时移除 `search_memories` 工具注册和 UI 运行态样式即可；
已有 execution/event 数据仍兼容，旧客户端会忽略新增的普通 TOOL/RETRIEVAL 步骤。

## Progress log

- 2026-08-30: 完成现状调研；确认可复用现有 5 轮 tool loop、AgentToolRegistry、SSE、
  agent events、取消/恢复和 ActivityTrace，主要缺口是授权 memory 搜索工具与交互动效。
- 2026-08-30: 完成 `search_memories` 工具、PERSONAL/TEAM 服务端范围固定、三次调用上限、
  evidence 去重/预算合并和逐次 SSE 事件；GENERAL 不暴露工具。
- 2026-08-30: 完成聊天内动态步骤数、当前步骤、持续计时、运行节点与新步骤动画；增加
  Node 25 测试环境的 localStorage 兼容兜底。
- 2026-08-30: 真实浏览器发现并修复“搜索我的记忆”误触发联网的问题；复测公开计划只包含
  memory harness，最终轨迹显示两次受限记忆搜索且没有网页搜索。
- 2026-08-30: `make check` 全部通过；本地 Docker API/Web/Worker 已重新构建并健康运行。

## Decision log

- 2026-08-30: 不把 GENERAL 默认改为 PERSONAL；原因是当前产品明确要求通用聊天不召回
  memory，用户必须通过“我的记忆/团队记忆”表达范围。
- 2026-08-30: 显示安全工作摘要而非模型隐藏思维链；原因是后者不可验证且可能泄露提示词、
  私有内容和供应商实现。

## Completion summary

已完成授权 memory agent harness 与动态工作过程。新增工具只能搜索服务端固定的本轮
PERSONAL 或 TEAM 语料库，GENERAL 不开放；工具结果继续受总证据预算和最终授权复核保护。
聊天 UI 现在实时显示步骤总数、完成数、当前步骤、总耗时和步骤耗时，并保留安全摘要边界。

验证包括 199 个 API 测试、118 个 Web 测试、类型/lint/格式、离线与 PostgreSQL 检索评测、
OpenAPI 漂移、生产构建、Compose 安全检查，以及本地真实浏览器 SSE 流程。无需数据库迁移。
