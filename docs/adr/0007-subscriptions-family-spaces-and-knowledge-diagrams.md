# ADR-0007: Subscriptions, family spaces, and authorized knowledge diagrams

Status: Accepted

Date: 2026-08-07

## Context

Memora 已经具备用户、个人/团队 workspace、选择性共享、持久 conversation、受保护文档和
授权检索。产品现在需要 Plus / Pro / Ultra 套餐与 credits、家庭空间、可保存的思维导图和
流程图，以及深度调研、云知识库和历史对话入口。

这些能力会同时触及商业状态、AI 用量、workspace 权限和记忆引用。如果只在前端显示余额或
把图节点缓存为任意文本，用户可以绕过额度或在撤回共享后继续看到私有内容。另一方面，当前
规模不需要支付微服务、图数据库或另一套家庭成员模型。

## Decision

1. 在现有 PostgreSQL 中增加用户级 subscription 和 append-only credit ledger。套餐、余额和
   扣费在同一事务中更新；账本不保存 prompt、模型输出或记忆正文。
2. 第一版升级是内部套餐状态切换，不声称真实支付。支付供应商、webhook、发票和退款在选择
   明确供应商后另立 ADR。
3. credits 只限制需要付费计算的 AI 路径，不能改变身份、workspace、visibility、检索或图的
   权限结果。模型未调用或失败时不扣费。
4. `FAMILY` 扩展现有 workspace kind，并完整复用 TEAM 的 join code、申请审核、成员移除和
   `PRIVATE` / `WORKSPACE` 共享规则。服务端所有“协作空间”判断必须包含 TEAM 和 FAMILY。
5. 图继续存储在同一 PostgreSQL。图记录绑定 workspace、owner 和 visibility，节点/边使用
   经过结构验证的 JSON；节点只引用 memory id 和用户编辑的展示标签，不缓存正文。
6. 服务端每次读写图都重新应用 membership 和 memory 授权。共享图只能包含当前 workspace
   仍为 `WORKSPACE` 的记忆；撤回、删除或失去 membership 后，响应移除受保护标签并把节点
   标记为不可用。
7. 前端使用 React Flow 提供拖动、缩放和连线，但 React Flow 状态不构成权限或事实来源。
8. conversation 历史重新进入侧栏，但仍按 `workspace_id + user_id` 私有隔离。深度调研和
   云知识库复用现有 Agent、检索和受保护文档管线，不建立平行数据入口。

## Consequences

### Positive

- 套餐、额度和用量可以审计，刷新或重新登录后不会丢失。
- 家庭空间不复制权限代码，团队和家庭的安全测试可以共享。
- 图在当前撤权规则下保持可解释，不会成为私有正文的静态泄漏副本。
- 历史、调研和知识库仍围绕同一记忆事实来源工作。

### Negative

- 内部套餐升级不能代替真实商业支付，生产收费前仍需支付集成。
- JSON 图结构不支持复杂图查询或多人实时协作；当前只面向单人编辑和团队只读共享。
- FAMILY 扩展要求审查所有仅判断 `TEAM` 的业务和界面分支。
- 每次读取共享图需要重新解析引用授权，会增加少量查询成本。

## Alternatives considered

### 只在浏览器保存图和 credits

被拒绝。刷新、换设备和并发请求会丢失状态，也无法形成服务端权限边界。

### 引入 Stripe 和图数据库

暂缓。用户尚未指定支付供应商，当前图规模不需要第二事实来源和额外部署单元。

### FAMILY 复制一套 membership 表

被拒绝。家庭与团队只有语义差异，复制权限模型会制造不一致和越权风险。

## Rollback

旧应用可以忽略新增订阅、账本和图表；但旧代码不认识 FAMILY。应用回滚前停止创建家庭空间，
保留新增表以避免账本和图数据丢失。只有确认这些数据可丢弃后才执行 downgrade。
