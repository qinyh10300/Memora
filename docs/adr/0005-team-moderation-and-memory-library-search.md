# ADR 0005: Team moderation and memory-library search

Status: Accepted

Date: 2026-08-06

## Context

ADR 0004 允许任何登录用户凭团队号立即创建 membership，并暂缓了成员移除。产品现在需要
团队所有者审核团队号申请、移除普通成员，并让个人和团队记忆库提供可组合筛选。同时，
筛选仍必须遵守私有优先和先授权后召回的系统不变量。

## Decision

1. 团队号只用于发现团队和创建待审核申请，不再直接创建 membership。申请存储在独立的
   `workspace_join_requests` 表中；pending 或 rejected 申请不构成任何 workspace 权限。
2. 只有当前团队 `OWNER` 可以列出、批准或拒绝申请。批准与创建 `MEMBER` membership 在
   同一事务完成；拒绝后申请人可以重新提交。
3. 保留所有者按已注册邮箱直接添加成员的现有能力，该路径立即生效，并将同一用户已有的
   待审核申请标记为批准。
4. 所有者可以移除 `MEMBER`，但不能移除自己或团队所有者。移除前把该用户仍以此团队为
   活动空间的 session 切回其个人 workspace。
5. 移除 membership 不删除历史 memory。该用户立即失去团队访问权；留在团队 workspace 的
   主动共享记录继续作为带作者信息的团队历史，私有记录不会对其他成员变得可见。
6. 在 memory 上保存由正文首个非空 Markdown 行派生的 nullable `title` 投影。标题不是新的
   可编辑正文，也不改变不可变修订规则；删除 memory 时与正文一并清除。
7. 记忆库筛选继续使用 `POST /search` JSON body。请求可以选择纯关键词模式以及全文或标题
   范围，并组合时间和作者过滤。服务端必须先应用 workspace、作者和 visibility 授权。
8. GPT、Claude 和 Gemini 作为现有供应商无关模型注册表中的配置项暴露。领域代码不依赖
   具体模型 SDK，embedding 模型选择仍与聊天模型独立。

## Consequences

### Positive

- 团队号泄露不再自动授予数据访问权。
- 待审核用户不会因错误的 membership 状态过滤而进入任何授权路径。
- 记忆库筛选即使 embedding 服务不可用也能工作。
- 模型切换复用现有端口和错误降级，不扩大供应商耦合。

### Negative

- 团队所有者需要处理申请队列，当前版本没有站外通知。
- 移除成员后保留其团队记录，需要后续产品决策才能支持内容转移或团队删除。
- title 投影需要迁移回填，并在所有新修订和删除路径中保持一致。

## Supersedes

本 ADR 覆盖 ADR 0004 中“凭团队号立即加入”以及“成员移除延期”的决定。ADR 0004 的
workspace 隔离、角色范围、按邮箱直接添加和共享可见性规则继续有效。

## Revisit triggers

- 团队需要管理员角色、所有权转移、成员主动退团、团队删除或加入通知。
- 团队需要在移除成员时转移、归档或删除其历史贡献。
- 数据规模要求专用全文索引、搜索分页或可配置 title 元数据。
