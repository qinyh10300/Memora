# Conversation history management

Status: Completed

Owner: coding agent

Last updated: 2026-08-10

## Outcome

左侧“历史对话”占满主要导航与账户卡片之间的剩余高度并独立滚动。每条对话的更多菜单支持
置顶/取消置顶、重命名、归档和删除；置顶对话与最近对话分组展示，状态在刷新和重新登录后
保留。

## Context and evidence

- 产品规则：`docs/product/brief.md` 已批准当前 workspace 的 conversation 历史、新建、恢复和
  生命周期管理；conversation 仍仅属于创建者。
- 架构与 ADR：`docs/architecture/overview.md`、ADR-0002 与 ADR-0010 要求 conversation 绑定
  `workspace_id + user_id`，不支持共享 conversation，且 memory 授权与 conversation 生命周期
  解耦。
- 变更前代码事实：`PATCH /conversations/{conversation_id}` 已支持重命名和归档，但没有置顶
  字段、conversation 删除接口或持久化置顶排序；侧栏只展示前 8 条且滚动区被限制为 210px。
- GitNexus 影响分析：`Sidebar`、`WorkbenchShell`、会话模型与路由入口均为 LOW；既有
  `Conversation.title` 与 `updated_at` 属性的图谱影响为 HIGH，但本实现没有改变这两个字段或
  `_touch_conversation` 的既有语义，只新增 `pinned_at` 并扩展生命周期接口。

## Scope

### In scope

- conversation 增加可空 `pinned_at`，列表按置顶时间和最近更新时间稳定排序。
- 更新接口支持置顶/取消置顶；新增仅限所有者和当前 workspace 的永久删除接口。
- 删除 conversation 时级联删除其消息与引用，但不删除独立的 memory 记录。
- 侧栏历史区填充可用高度、展示全部已加载对话、区分“已置顶”和“最近”。
- 更多菜单、重命名对话框和删除二次确认；删除项使用危险色。
- API 权限/生命周期/并发测试、Web 交互测试、OpenAPI 生成契约和迁移验证。

### Non-goals

- conversation 导出、分享、公开链接或多人共同编辑。
- 已归档对话管理页、批量操作、拖拽排序或跨 workspace 置顶。
- 删除 conversation 时删除或改变任何 memory、asset、embedding 或共享可见性。

## Design and boundaries

- 所有读取和变更继续通过 `get_owned_conversation` 或同等
  `workspace_id + user_id` 条件验证，越权 ID 统一返回 404。
- `pinned_at` 为空代表未置顶，时间戳同时表达状态和置顶组内顺序；API 对外暴露时间戳与
  `pinned` 更新意图。归档会清除置顶状态。
- conversation 删除依赖现有外键级联清除 messages 和 message citations。由于 memory 外键方向
  是 message 指向 memory，删除 conversation 不会反向删除 memory。
- Chat/Draft 在最终写回前重新锁定活动 conversation。生成期间被归档或删除时返回 404；Draft
  消息、引用与 credits 在同一最终事务提交，避免误扣额度或留下孤立消息。
- Web 切换 workspace 时立即清空旧列表，以 workspace、请求、视图和生命周期版本丢弃延迟返回
  的旧列表、详情和动作响应；同一 conversation 的管理动作串行化。首次发送在创建 conversation
  前即锁定整轮请求，并与 workspace 切换使用同步互斥，避免慢网下重复创建或把 conversation
  写进界面尚未完成切换的空间。切换未确认期间整个工作台不可写；若服务端激活后刷新失败，
  Web 进入安全停止页，重新同步当前 workspace 前不恢复写操作。已有 conversation、草稿或记忆
  变更尚未结束时不允许开始切换，避免旧空间响应回写新空间界面。
- API 先发布兼容的可空响应字段和新方法，再由 Web 使用；旧客户端可忽略新增字段。

## Milestones

- [x] M1 — 数据模型、迁移、API 与权限测试完成；验证：会话定向 API 测试和 Alembic 升降级。
- [x] M2 — 侧栏布局、分组与动作交互完成；验证：Web 定向组件测试和浏览器检查。
- [x] M3 — 契约、完整检查和运行时布局验证完成；验证：`make check`、`make e2e` 和桌面/移动
      断点检查。

## Acceptance criteria

- [x] 历史列表从标题下方延伸到账户卡片上方，条目超出时只滚动列表。
- [x] 未置顶对话显示“置顶”，置顶对话显示“取消置顶”，刷新后分组与状态不丢失。
- [x] 重命名成功后列表立即更新，空标题不能提交。
- [x] 归档后对话离开活动列表；置顶对话归档后不保留置顶状态。
- [x] 删除项为红色且要求二次确认；成功后对话和消息不可读取，但关联 memory 仍存在。
- [x] 其他用户和其他 workspace 不能置顶、重命名、归档或删除该 conversation。
- [x] 对话在生成期间被归档或删除时返回 404，Draft 不扣 credits 且不残留消息。
- [x] 切换 workspace 后旧列表/详情/动作响应不能写入新空间；同一对话的并发菜单动作不会乱序。

## Verification

- `make check`：格式、ESLint/Ruff、TypeScript/Mypy、Web 86 项、API 184 项、检索评估、OpenAPI
  契约检查和生产构建全部通过。
- PostgreSQL 验证：迁移从 `20260809_0022` 升级到 `20260810_0023`，完整 downgrade/re-upgrade
  通过，Alembic autogenerate 无 schema drift。
- `make e2e`：Docker 构建、迁移、seed、API、worker、Web、proxy 健康，关键记忆/报告/对齐/
  科研绘图路径通过。
- 浏览器验证：2016×1242 下历史区高度 751px 并延伸到账户卡片上方；1280×720 下列表
  `clientHeight=190`、`scrollHeight=262`、`overflow-y:auto`。四项菜单、上下定位、置顶分组、
  重命名、删除确认和 Escape 焦点恢复均实际检查，无控制台错误。
- 390×844 E2E 断点检查通过；粗指针设备始终显示三点入口，浅色主题危险色满足可读性要求。
- 权限与竞态回归：跨用户/跨 workspace PATCH/DELETE 返回 404；删除/归档与同步/流式生成竞态
  返回受控 404，不产生 Draft credit ledger；延迟列表/详情/动作响应被丢弃，行级动作互斥，首次
  conversation 创建期间重复发送与空间切换被阻止；workspace 切换刷新期间输入不会丢失且所有
  workspace 写入口被锁定，激活后刷新失败会进入安全停止页并可重新同步；已有记忆变更进行中
  时不能开始切换。

## Rollout and recovery

迁移只增加可空时间戳和索引，不回填、不改变现有 title/updated_at 语义。应用回滚时旧版本会
忽略该列；迁移 downgrade 删除索引和列，只丢失置顶偏好，不影响 conversation、message 或
memory 正文。删除属于用户显式确认后的不可恢复操作，部署前以权限测试和数据库备份策略兜底。

## Decision log

- 2026-08-10：不实现 conversation 分享或导出；分享与 ADR-0002 冲突，导出没有已批准的权限与
  撤回生命周期。
- 2026-08-10：采用服务端 `pinned_at` 而非 localStorage；置顶应在重新登录和不同客户端中保持。
- 2026-08-10：conversation 删除不触碰 memory；删除聊天上下文不应造成事实记录丢失。
- 2026-08-10：最终写回重新确认活动 conversation，并把 Draft 持久化与 credits 消耗原子提交；
  不为同步最终化引入跨事务 credit reservation 生命周期。

## Completion summary

交付了持久置顶/取消置顶、稳定分组排序、重命名、归档、硬删除、全高可滚动历史区、键盘可用
的四项菜单与安全确认。数据库、API、OpenAPI、Web、产品/架构/ADR 和回归测试同步完成。分享、
导出和归档管理页按既定边界保留为非目标；工作树中任务开始前已有的其它视觉样式修改未被覆盖。
