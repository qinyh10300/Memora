# ADR-0002: Workspace and persistent conversation shell

Status: Accepted

Date: 2026-07-26

## Context

Memora v0.1 验证了单一暗黑对话入口、默认私有记录和授权证据问答，但临时页面状态无法支撑持续使用：

- 用户不能恢复或整理过去的 conversation。
- 所有 seed 用户只有一个团队工作区，无法验证个人空间和多个组织上下文。
- 原始 memory 只能通过当前页面状态或回答引用展开，缺少独立的授权浏览入口。
- 单页极简设计隐藏了当前空间和数据范围，团队用户容易误以为 AI 可以访问所有成员私有记录。

产品需要增加类似现代 AI 工作台的侧栏和 conversation 历史，同时不能让 UI 层级变成新的权限边界。

## Decision

1. 在现有模块化单体中扩展 workspace、conversation 和 message 模型，不新增服务或数据库。
2. 每个用户拥有一个 `PERSONAL` workspace，并可加入或创建 `TEAM` workspace。
3. 当前数据库会话保存一个活动 workspace；切换操作必须验证 membership 后才更新。
4. conversation 绑定一个 workspace 和一个用户，默认私有，不支持团队共享。
5. conversation 只是聊天上下文。memory 继续以 workspace、author 和 visibility 决定授权，不归属于某个 conversation。
6. Chat 和 capture 都可以追加到指定 conversation；capture 关联 memory，但 memory 写入、outbox 和默认私有规则保持不变。
7. Web 增加可收起侧栏、conversation 历史、统一记忆库和原文抽屉；所有原文仍通过服务端授权 API 获取。
8. 不实现跨 workspace 检索、邀请成员、共享 conversation 或删除 workspace。

## Why this option

- 复用现有 `workspace_id + author_id + visibility` 授权查询，减少新界面造成越权的风险。
- 将 conversation 与 memory 解耦后，同一条记录可以服务多个回顾问题，同时撤回和删除继续统一传播。
- 活动 workspace 保存在服务端会话中，现有 API 不需要信任客户端租户 header。
- 侧栏只承担上下文切换和历史导航，主输入仍保持“记录或询问”的单一心智模型。
- personal workspace 使用同一领域模型，避免为个人记录复制一套检索、报告和 AI 流水线。

## Alternatives considered

### Conversation owns memories

把 memory 放进 conversation 文件夹看似直观，但同一 memory 难以跨 conversation 回顾，删除和共享会产生重复权限规则，因此不采用。

### Client sends workspace header on every request

可以支持多标签并行空间，但所有接口都必须解析和验证额外租户参数，容易出现遗漏。v0.2 先保持服务端会话中的单一活动空间。

### Separate personal-memory subsystem

可以让个人空间看起来更轻量，但会复制 memory、embedding、检索和报告逻辑。使用 `PERSONAL` workspace 可以复用已经验证的边界。

### Shared team conversations in the first version

团队共享 conversation 会引入消息级权限、成员离开、来源撤回和历史导出生命周期。当前核心需求只要求共享 memory，因此推迟。

## Consequences

### Positive

- 用户可以按空间和 conversation 持续组织工作，不再依赖一次页面会话。
- 当前数据范围在 UI 中可见，同时权限仍由服务端统一强制。
- 原始 memory 浏览和 AI 引用使用同一个授权事实来源。
- 不改变部署拓扑和 AI 供应商边界。

### Negative

- 数据库会话的活动 workspace 使同一浏览器多标签共享最后一次选择。
- 新增 conversation 生命周期和 capture 关联需要迁移、契约和更多权限测试。
- 用户创建的新团队 workspace 在没有邀请能力前只有创建者一人。
- 侧栏和移动抽屉增加了前端状态复杂度。

## Revisit triggers

- 用户明确需要同时在多个浏览器标签操作不同 workspace。
- 团队需要共享、评论或协作编辑 conversation。
- 邀请、成员离开或企业组织树成为已验证需求。
- 出现跨 workspace 个人搜索的真实使用证据。
