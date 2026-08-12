# ADR-0010: Private conversation history lifecycle

Status: Accepted

Date: 2026-08-10

## Context

ADR-0002 已确定 conversation 是绑定 `workspace_id + user_id` 的私人聊天上下文，与正式 memory
的授权和生命周期解耦。恢复侧栏历史后，用户还需要固定常用对话、整理标题，并从活动列表归档
或永久删除不再需要的聊天上下文。浏览器本地置顶无法跨登录保持一致，使用归档冒充删除也会
造成错误的数据保留预期。

## Decision

1. conversation 新增可空 `pinned_at`。非空代表置顶并记录最近置顶时间；活动列表先按置顶时间
   倒序，再按 `updated_at` 倒序展示普通对话。
2. 置顶、取消置顶、重命名、归档和删除都继续验证当前 principal 的 workspace 与 owner；
   越权 ID 与不存在 ID 一样返回 404。
3. 归档会清除 `pinned_at` 并从活动列表移除，但保留 conversation 和 messages。
4. 删除是用户二次确认后的硬删除，级联清除该 conversation 的 messages 与 message citations。
   memory 是独立事实记录，不因 conversation 删除而删除、撤回或改变可见性。
5. 共享 conversation、公开链接和导出不随本次菜单引入。共享仍需要独立的消息权限、成员离开
   和来源撤回设计。
6. Chat 或 Draft 在外部模型执行期间被归档或删除时，最终消息追加视为 conversation 不再可用并
   返回 404。Draft 的消息、引用与 credits 消耗在一个最终事务内提交，避免删除竞态产生孤立消息
   或误扣额度；真实供应商用量仍按既有观测语义记录。

## Consequences

- 置顶偏好在刷新、重新登录和不同客户端中保持一致，并继续受 workspace 隔离。
- 删除 conversation 不可恢复；界面必须明确后果，并说明已保存 memory 不受影响。
- 旧客户端可以忽略新增的可空响应字段和 DELETE 方法；旧应用版本也可以在迁移后继续读取
  conversation。
- 回滚迁移只丢失置顶偏好，不影响 conversation、message 或 memory 正文。
- 长耗时生成不会阻止用户管理 conversation；若生命周期操作先完成，生成结果不会重新创建或
  写回已归档/删除的对话，也不会收取 Draft credits。
