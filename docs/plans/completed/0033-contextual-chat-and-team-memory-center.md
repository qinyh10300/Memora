# Contextual Chat and Team Memory Center

Status: completed
Owner: Codex
Last updated: 2026-08-12

## Outcome

将 Memora 重组为三个清晰的一级工作入口：通用“新建聊天”、“我的记忆”和“团队记忆”。
通用聊天承载开放式问答、联网、调研与绘图；个人记忆页提供明确的整理助手入口；团队记忆页
集中承载团队共享记忆浏览、带引用问答、记忆图谱和记忆分析。对话始终默认仅创建者可见，
只有显式保存并选择团队共享后才形成团队记忆。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 已规定默认私有、团队成员只读取主动共享记录、事实回答
  必须引用作者和时间，以及 conversation 不因使用团队证据而自动共享。
- 相关架构与 ADR：`docs/architecture/overview.md`、ADR-0003、ADR-0005 和 ADR-0007 已提供
  不可变修订、授权检索、团队成员边界和授权图节点规则。
- 当前代码事实：
  - `Sidebar` 当前有五个入口：新对话、我的记忆、团队记忆、记忆分析和绘图。
  - `WorkbenchShell` 已能渲染通用 Chat、记忆库、知识库、框图/绘图和团队分析，但它们是平级页面。
  - `DraftChatRequest` 当前没有显式记忆范围；Draft Chat 默认只检索当前用户的记忆。
  - 团队空间已经返回本人私有记忆与成员主动共享的记忆；所有详情、引用和图节点均由服务端重新授权。
- GitNexus：计划修改的 Sidebar、WorkbenchShell、CaptureWorkspace、DraftChatRequest、
  chat_with_draft、Timeline 和 KnowledgeBaseWorkspace 上游影响均为 LOW。React/FastAPI 跨层关系
  未被图完全识别，因此仍按 OpenAPI、父子 props 和端到端测试整体验证。

## Scope

### In scope

- 侧边栏只保留“新建聊天 / 我的记忆 / 团队记忆”三个一级入口。
- 空间切换器继续作为 workspace 权限上下文，不改变 membership 和会话隔离。
- 团队记忆页增加“共享记忆 / 记忆图谱 / 记忆分析”页签，并复用现有授权组件。
- 团队记忆页提供“问团队”入口，进入带明确团队范围提示的 Chat。
- 我的记忆页提供“整理助手”入口，进入带明确个人范围提示的 Chat + Markdown 工作台。
- 为 Draft Chat 增加显式 `memory_scope`，至少区分不使用记忆、本人记忆和团队共享记忆。
- 团队范围只检索当前 workspace 中仍为 `WORKSPACE` 的活动记录；个人范围只检索当前用户记录。
- 更新 OpenAPI、生成客户端、产品/架构文档与权限回归测试。

### Non-goals

- 不实现多人共同编辑 conversation、公开聊天链接或把 conversation 自动共享给团队。
- 不实现跨 workspace 检索或把一条 memory 同时发布到多个空间。
- 不新增图数据库；记忆图谱继续引用受控 memory ID，不缓存正文。
- 不在本计划中实现团队结论审批、评论、通知或实时协作。

## Assumptions and open questions

- [x] 三个入口共用同一套 Chat 和 conversation 基础设施，而不是三套聊天系统。
- [x] 通用新聊天默认不自动使用记忆；用户可以从个人或团队页面进入带预设范围的 Chat。
- [x] 团队记忆、图谱和分析是团队中心内部页签，不再占用一级侧边栏。
- [x] 个人记忆仍称“记忆”，Markdown 是编辑格式而不是面向用户的文件类型名称。
- [ ] 后续是否在通用 Chat 输入框增加实时范围选择器；本计划先交付入口预设和清晰范围标识。

## Design and boundaries

### Information architecture

1. “新建聊天”启动通用模式；允许联网、附件、调研与绘图，不默认召回记忆。
2. “我的记忆”展示本人创建的记录；“整理助手”启动个人记忆模式并保留显式保存边界。
3. “团队记忆”只在协作空间提供共享知识能力；内部页签聚合共享记录、授权图和分析。
4. “问团队”启动团队记忆模式；conversation 仍为用户私有，回答只引用当前团队共享记录。

### Retrieval and permissions

- `memory_scope=NONE`：不构造 memory evidence。
- `memory_scope=PERSONAL`：使用统一授权查询后再限制 `author_id = principal.user_id`。
- `memory_scope=TEAM`：只允许协作 workspace，并限制 `visibility = WORKSPACE`。
- 语义和最近记录回退必须应用同样的 scope；最终引用落库前再次授权。
- scope 只控制召回候选，不改变 memory、conversation 或 workspace 的可见性。

### Compatibility and failure behavior

- API 为新增字段提供安全默认值，旧客户端继续使用个人范围；新 Web 始终显式发送范围。
- 个人空间请求团队范围返回 422，不静默降级到个人范围。
- 团队范围没有证据时明确说明未找到共享记录，不调用私有记录补全。
- 页面组合失败时保留已有侧栏和 Chat 能力，不删除或迁移现有数据。

## Milestones

- [x] M1 — 三入口侧边栏与团队记忆中心页签；验证：Web 组件测试和浏览器导航。
- [x] M2 — 个人整理助手与团队问答的上下文入口及范围提示；验证：Web 请求断言。
- [x] M3 — `memory_scope` OpenAPI 与服务端授权检索；验证：个人/团队/无记忆 API 回归测试。
- [x] M4 — 文档、全量检查、生产构建和本地运行验证。

## Acceptance criteria

- [x] 展开和收起侧边栏均只有三个一级入口，旧的绘图和分析入口不再出现。
- [x] 团队记忆页可以在共享记忆、记忆图谱和记忆分析之间切换。
- [x] 个人整理助手请求只使用本人记忆，团队问答请求只使用主动共享的团队记忆。
- [x] 通用新聊天默认不召回任何 memory，但联网、附件和绘图能力不受影响。
- [x] 每个 Chat 明确显示当前范围；conversation 仍为私有。
- [x] 私有团队空间记录不会进入团队 Chat 的候选、提示词、引用或分析。
- [x] 格式、lint、类型、Web/API 测试、OpenAPI、构建和浏览器验证全部通过。

## Verification

- 自动化检查：`make check`
- 集成验证：Draft Chat 的 NONE / PERSONAL / TEAM 检索范围与引用测试。
- 手工或浏览器验证：三个入口、团队页签、范围提示、移动端和收起侧栏。
- 安全与权限验证：团队范围不返回本人或他人的 PRIVATE 记忆；切换 workspace 后范围重置。

## Rollout and recovery

不涉及数据库迁移。Web 与 API 同步部署；API 新字段带兼容默认值，先部署 API 也不会影响旧 Web。
回滚 Web 可恢复五入口侧边栏；回滚 API 前需先回滚显式发送 `memory_scope` 的 Web。现有 memory、
conversation、diagram 和 report 数据无需恢复操作。

## Progress log

- 2026-08-12: 完成产品、架构、ADR、源码和 GitNexus 影响审查，开始 M1。
- 2026-08-12: 完成三入口导航、个人整理助手、团队记忆中心与显式检索范围。
- 2026-08-12: 浏览器验证发现并修复“团队助手切回个人空间仍保留团队范围”的状态问题。
- 2026-08-12: `make check` 全部通过：Web 90 tests、API 187 tests、检索权限评测、
  PostgreSQL 迁移往返、OpenAPI 契约和生产构建均成功。

## Decision log

- 2026-08-12: 采用“一套 Chat 基础设施 + 三个上下文入口”，避免维护三套 conversation 和消息模型。
- 2026-08-12: 图谱和分析收进团队记忆中心，不再作为一级侧边栏入口。
- 2026-08-12: 通用 Chat 默认 `NONE`，避免用户不知情地把个人或团队记忆发送给模型。

## Completion summary

已交付三个一级任务入口，并在同一 Chat 基础设施上增加 `GENERAL / PERSONAL / TEAM` 三种
明确上下文。通用聊天不召回记忆；个人整理助手只召回本人记录；团队助手只召回当前协作
空间中主动共享的记录，并在模型返回后再次应用同一授权范围。团队中心复用现有时间线、
图谱和分析组件，没有新增数据库或部署单元。

验证包括完整 `make check`、真实浏览器桌面与 390×844 移动端检查，以及空间切换回归。
GitNexus `detect_changes` 对整个共享脏工作树报告 CRITICAL（28 个文件、包含本计划之前的
conversation 生命周期等并行改动）；本计划开始前逐个审查的核心符号均为 LOW，且所有受影响
流程已由全量测试、权限评测、迁移评测和浏览器验证覆盖。本轮未执行提交、推送或部署。
