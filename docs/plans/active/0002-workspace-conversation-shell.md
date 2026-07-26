# Workspace and conversation shell

Status: in-progress

Owner: Yihua Qin and coding agent

Last updated: 2026-07-26

## Outcome

将 Memora 从单一临时对话页升级为可持续使用的工作台：用户可以在左侧切换自己有权访问的空间，在每个空间中创建和恢复独立对话，通过同一聊天框记录或询问记忆，并在记忆库中核对个人原始记录与团队主动共享的原始记录。

## Context and evidence

- 产品基线：`docs/product/brief.md` 当前仍以单测试工作区和单对话入口为 v0.1 范围。
- 架构基线：`docs/architecture/overview.md` 已有 `workspaces`、`workspace_memberships`、`conversations`、`messages` 和授权 memory 查询。
- 已接受 ADR：`docs/adr/0001-initial-system-architecture.md` 要求模块化单体、OpenAPI 契约和服务端权限过滤，本计划不改变这些选择。
- 当前代码事实：
  - 登录会话记录一个活动工作区，所有 memory、检索、Chat 和报告路径已经按该工作区过滤。
  - 每次问答都会新建 conversation，尚无会话列表、恢复、重命名或归档 API。
  - 记录动作只存在于浏览器当前状态，重新加载后不会出现在聊天历史中。
  - Web 只有一个页面级对话组件，暂无侧栏、空间切换、记忆库或来源抽屉。

## Scope

### In scope

- 为每个 seed 用户提供独立个人空间，并允许用户创建只有自己作为初始所有者的团队空间。
- 列出当前用户加入的空间，并通过当前安全会话显式切换活动空间。
- 在活动空间内创建、列出、读取、重命名和归档用户自己的 conversation。
- 允许多轮问答追加到指定 conversation；记录成功后也把记录与保存回执写入指定 conversation。
- Web 增加可收起左侧栏、空间切换器、新建对话、对话历史和统一记忆库。
- 记忆库区分“我的记忆”和“团队共享”，点击记录或回答引用后在右侧抽屉显示当前仍有权访问的原文。
- 桌面端、移动端、键盘和基本无障碍交互。
- 工作区、conversation、memory 直接 ID、引用和切换竞态的正反权限测试。

### Non-goals

- 邀请成员、移除成员、复杂角色管理、企业 SSO 或公开注册。
- 共享 conversation、跨工作区搜索或跨工作区报告。
- 删除工作区、转移工作区所有权或细粒度群组分享。
- 改变 `PRIVATE` 与 `WORKSPACE` 两级 memory 可见性语义。
- 引入微服务、第二数据库、Redis 或新的 AI 供应商。

## Assumptions and open questions

- [x] 对外使用“空间”作为个人空间和团队工作区的统一名称，后端继续使用 workspace 领域术语。
- [x] conversation 是用户私有的交互上下文，不是权限容器，也不自动共享给工作区成员。
- [x] 所有 Chat、记录和记忆库操作只作用于当前活动空间；切换空间时清除未提交草稿和客户端待确认状态。
- [x] 团队页签只展示 `WORKSPACE` 记录，名称使用“团队共享”而不是容易误导的“团队记忆”。
- [x] v0.2 工作区切换通过数据库会话的活动 `workspace_id` 实现；多浏览器标签页会共享最后一次选择，未来若出现真实并行空间需求再改为路径级上下文。

## Design and boundaries

### Workspace boundary

- `GET /workspaces` 只返回当前用户存在 membership 的空间。
- `POST /workspaces` 只创建 `TEAM` 空间，并把创建者写为 `OWNER`。
- `POST /workspaces/{workspace_id}/activate` 必须先验证 membership，再更新当前数据库会话的活动工作区。
- 每个 seed 用户通过幂等 seed 获得一个确定 slug 的 `PERSONAL` 空间，个人空间不提供邀请入口。
- 空间切换后，现有 memory、Chat、报告和检索服务继续使用统一 `Principal.workspace_id`，不在前端复制权限判断。

### Conversation boundary

- conversation 始终绑定 `workspace_id + user_id`；列表和详情不允许访问同工作区其他用户的 conversation。
- 新增 `title`、`updated_at`、`archived_at`，旧 conversation 以 topic 回填标题。
- Chat 请求可携带 `conversation_id`；指定时只能追加到当前用户在当前空间内的未归档 conversation。
- 记录请求可携带 `conversation_id`；memory、outbox、审计与 capture 消息在同一事务内写入。
- `messages.memory_id` 只用于把保存回执关联到原始 memory，不改变 memory 的事实来源和删除语义。
- conversation 详情返回引用前重新应用当前授权查询；撤回或删除的来源不会因历史消息重新泄露。

### Web interaction

- 左栏是上下文切换器，不把内部权限参数铺成多组表单。
- 新对话默认 `PERSONAL` 范围；用户问题明确提到团队或成员时仍按现有路由扩大范围。
- 普通陈述继续先询问“仅自己”或“共享团队”，明确选择前不写入。
- 回答引用与记忆库记录共用右侧原文抽屉；抽屉每次打开都通过授权详情接口取原文。
- 移动端侧栏和原文详情使用覆盖式抽屉，主输入区保持可用。

## Milestones

- [ ] M1 — 产品 brief、架构说明、ADR 和本计划同步；验证：文档交叉引用和 diff 复查。
- [ ] M2 — 多空间 API 与个人空间 seed 完成；验证：API 单元测试、跨成员激活反向测试和真实迁移。
- [ ] M3 — 持久化多轮 conversation 与 capture 记录完成；验证：API 测试覆盖列表、详情、追加、归档、跨用户和跨空间隔离。
- [ ] M4 — Web 工作台完成；验证：组件测试覆盖空间切换、新建/恢复对话、记忆库、来源抽屉和原有默认私有闭环。
- [ ] M5 — 契约、完整检查和本地运行验收；验证：`make check`、`make e2e`、Docker 重建和桌面/移动浏览器检查。

## Acceptance criteria

- [ ] 用户能看到个人空间和自己加入的团队空间，不能发现或激活未加入的空间。
- [ ] 切换空间后，聊天历史、成员、记忆库和后续检索全部切到同一服务端工作区边界。
- [ ] 用户能在每个空间创建多个 conversation，刷新页面后恢复消息。
- [ ] 记录和问答都能出现在所选 conversation 中；记录仍默认私有并且分享必须显式确认。
- [ ] “我的记忆”只展示当前用户在当前空间的记录；“团队共享”只展示当前空间所有成员的 `WORKSPACE` 记录。
- [ ] 点击来源或记忆记录只能打开当前用户仍有权访问的原文；取消共享或删除后立即不可读。
- [ ] 其他用户不能通过 conversation ID、memory ID、空间 ID 或历史引用获得私有内容。
- [ ] 桌面和 390×844 移动视口完成关键路径，浏览器控制台无错误。

## Verification

- 自动化检查：`make format-check lint typecheck test contract-check build`。
- 集成验证：Alembic 升级到新 revision，真实 PostgreSQL 跨空间和跨用户权限矩阵。
- 端到端验证：`make e2e`，并扩展 smoke 覆盖空间切换与 conversation 恢复。
- 浏览器验证：桌面与移动端执行空间切换、新建对话、私有记录、团队共享、问答引用和原文抽屉。
- 安全验证：检查 Git 历史与 diff 不包含 `.env`、密码、API Key、Cookie 或私有测试正文。

## Rollout and recovery

- 新迁移仅增加 workspace 类型、conversation 生命周期字段和 message-memory 可选关联，不移动或删除现有 memory。
- 旧 workspace 统一回填为 `TEAM`；旧 conversation 用已有 topic 回填 title，并用 created_at 回填 updated_at。
- personal workspace 由幂等 seed 创建，不复制旧 memory；原测试工作区数据保持原位。
- 应用回滚时优先回退镜像并保留新增列；Alembic downgrade 会删除新增 personal workspace 及其数据，只允许用于空测试环境，不作为有真实数据环境的恢复方案。
- 公网部署前必须先备份数据库、运行迁移和权限 smoke，再切换 Web 镜像。

## Progress log

- 2026-07-26：用户批准工作区侧栏、多 conversation、个人/团队原始记忆浏览方向，并明确允许 feature 分支与多个过程提交。
- 2026-07-26：完成现有模型、权限查询、Chat 持久化和 Web 状态机调研；创建 `codex/v0.2-workspace-shell` 分支并开始实施。

## Decision log

- 2026-07-26：conversation 不作为 memory 文件夹或权限边界；原因是同一 memory 应可被当前空间内多个对话引用，权限必须由 workspace、作者和 visibility 决定。
- 2026-07-26：个人空间也使用 workspace 模型；原因是这样可复用现有授权流水线，同时保持跨空间默认隔离。
- 2026-07-26：工作区切换更新当前数据库会话，而不是信任客户端 workspace header；原因是 v0.2 先保持单一可审计 principal，避免每个业务接口重复接受租户参数。
- 2026-07-26：不在本阶段实现邀请和共享对话；原因是它们会引入新的权限与撤销生命周期，超出本次可验证垂直切片。

## Completion summary

实施完成后填写。
