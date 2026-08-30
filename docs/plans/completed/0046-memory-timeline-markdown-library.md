# Memory timeline and Markdown library redesign

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

将“我的记忆”和“团队记忆”统一为更清晰的记忆浏览体验：按成员筛选共享记录、按时间查看
新建/更新/新版本动态，点击记忆后直接阅读 Markdown，并在授权范围内查看修订记录。

## Context and evidence

- 产品规则：`docs/product/brief.md` 要求“我的记忆”展示当前用户记录，“团队共享”只展示成员
  主动共享的 `WORKSPACE` 记录，并能查看作者、时间、可见范围与补充关系。
- 架构与 ADR：ADR-0003 规定修订不可变且隐藏修订只对所有者开放；ADR-0004/0005 规定团队
  列表、搜索和详情必须先经过 workspace、作者与 visibility 授权。
- 当前代码事实：`Timeline` 已接收授权后的 `Memory[]` 和 `WorkspaceMember[]`；
  `MemoryDetail` 已加载当前详情与允许访问的 revisions；无需修改 API 或数据库。
- GitNexus：`TeamMemoryCenter`、`Timeline`、`MemoryDetail`、`MarkdownPreview` 与
  `WorkbenchShell` 的上游影响均为 LOW。

## Scope

### In scope

- 团队页面压缩页头，移除单选项的冗余页签，突出成员数量、共享记忆数量和问答入口。
- 团队时间线增加成员快捷筛选和新建/更新/新版本/共享状态。
- 个人与团队详情默认显示渲染后的 Markdown；作者可切换到编辑状态。
- 详情增加“Markdown 内容 / 修改记录”页签；非作者只看到当前共享版本说明。
- 桌面与窄屏响应式样式、组件回归测试和浏览器验收。

### Non-goals

- 不新增 API、数据库字段、协作编辑、评论、差异比较或版本恢复。
- 不改变记忆默认私有、共享、撤回、修改与删除权限。
- 不部署或提交代码，除非用户另行要求。

## Assumptions and open questions

- [x] 用户已认可“成员筛选 + 事件时间线 + Markdown 详情”的原型方向。
- [x] 修改动态使用现有 `revision_kind`、`shared_at`、作者与时间字段表达。
- [x] 他人隐藏修订历史继续不可见；团队页只展示当前可访问版本的状态。

## Design and boundaries

前端只消费服务端已授权的记录。成员筛选在当前已授权结果内完成，不创建新的权限路径。
`ROOT`、`UPDATE_CURRENT` 和 `NEW_VERSION` 分别显示为新建、更新和新增版本；共享范围以当前
`visibility` 显示。详情默认渲染 Markdown，作者点击“编辑 Markdown”后才进入现有编辑与保存
流程。修订页签直接使用已加载的 revisions；非作者只显示当前共享版本和权限说明。

## Milestones

- [x] M1 — 重构团队页头与时间线成员筛选、动态语义；验证：组件测试。
- [x] M2 — 重构 Markdown 阅读、编辑和修订页签；验证：组件测试与权限回归。
- [x] M3 — 完成桌面/移动样式与浏览器验收；验证：`make check`、实际页面截图与控制台。

## Acceptance criteria

- [x] 团队页可按全部成员或具体成员筛选当前授权的共享记忆。
- [x] 个人和团队列表按时间展示作者、动作、标题、时间和可见范围。
- [x] 点击记忆默认看到渲染后的 Markdown，不必先阅读原始 textarea。
- [x] 作者可进入编辑并继续使用 AI 修改、更新当前记忆、保存为新版本、共享与删除。
- [x] 非作者不能编辑、删除、撤回或查看隐藏修订正文。
- [x] 窄屏下时间线和详情上下排列且无页面级横向溢出；成员列表可横向滚动。

## Verification

- 自动化检查：Web 组件测试、格式、lint、类型检查、构建，最终 `make check`。
- 集成验证：现有 mock API 覆盖个人/团队切换、检索、修订和只读权限。
- 手工或浏览器验证：桌面和移动宽度检查成员筛选、时间线、Markdown、修订页签。
- 安全与权限验证：他人私有记录不进入团队列表；非作者不显示编辑和完整历史。

## Rollout and recovery

纯 Web 展示变更，无迁移。回退对应组件、样式和测试即可恢复旧界面；服务端数据与权限规则
不受影响。

## Progress log

- 2026-08-30: 完成产品、ADR、现有组件、测试和 GitNexus 影响分析。
- 2026-08-30: 完成成员筛选、动态语义、Markdown 阅读/编辑切换和授权修订记录。
- 2026-08-30: Web 13 个测试文件共 126 个测试通过；`make check` 完整通过（含 API 207
  个测试、检索评估、OpenAPI 检查与生产构建）。
- 2026-08-30: 在独立 3001 预览端口完成桌面和 390×844 移动端验收；团队成员筛选、
  Markdown 内容与非作者当前共享版本说明均符合预期。开发模式仍显示既有主题属性 hydration
  警告，本次生产构建不受影响。

## Decision log

- 2026-08-30: 不新增活动流 API；第一版从当前授权 Memory 字段派生动作状态。
- 2026-08-30: 完整修订历史继续仅对作者开放；避免 UI 绕过 ADR-0003 的权限边界。

## Completion summary

已在不新增 API、数据库字段或权限路径的前提下完成记忆库展示改版。团队页以成员和时间线
组织共享记忆，个人与团队详情默认阅读渲染后的 Markdown，并为作者保留显式编辑入口；修改
记录严格沿用服务端授权结果，非作者不展示隐藏修订。当前仅完成源码与独立预览验证，未重新
部署到 8080。
