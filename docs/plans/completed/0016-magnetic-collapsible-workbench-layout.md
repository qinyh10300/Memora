# Magnetic collapsible workbench layout

Status: completed
Owner: Codex
Last updated: 2026-08-06

## Outcome

Memora 桌面工作台的导航、对话、Markdown 和记忆详情分栏可以连续拖动，并在接近边界时
以可预测的阻尼和磁吸方式收起。隐藏后保留紧凑、可发现的恢复控制，布局偏好跨会话保存；
移动端继续使用当前覆盖式导航和纵向工作流。

## Context and evidence

- 当前 `ResizableSplit` 已支持指针、键盘、双击恢复和 localStorage，但最小宽度是硬边界，
  无法把任一 pane 拖到隐藏。
- 当前侧栏只有按钮收展，宽度固定，不能通过拖动连续调整。
- Allotment 的 `snap` pane 和 react-resizable-panels 的 `collapsible` pane 都采用“低于最小宽度
  后归零”的成熟模式；VS Code 工作台同时提供布局持久化、显式恢复和默认布局。
- WAI-ARIA Window Splitter 模式要求可聚焦 separator 提供当前值、方向键调整、`Home` / `End`
  到边界，以及 `Enter` 收起或恢复。

## Scope

### In scope

- 左侧导航可拖动调整宽度，向左越过阈值后吸附到现有 68px 品牌窄栏。
- 对话 / Markdown、记忆时间线 / 详情、Markdown 编辑 / 预览均可从任一方向吸附隐藏。
- 隐藏状态在分隔条边缘显示方向提示；单击或 `Enter` 恢复，双击恢复默认比例。
- 分隔条扩大无形命中区，悬停、聚焦、拖动和吸附提供克制的蓝色反馈。
- 保存最后有效宽度与隐藏状态；窗口变化后保持有效布局。
- 补充组件测试和桌面、移动真实浏览器验收。

### Non-goals

- 任意拖放面板顺序、弹出独立窗口、标签化 dock、用户自定义快捷键。
- 修改移动端为横向分栏，或改变现有黑色主视觉与信息架构。
- 引入 Golden Layout 等完整 IDE 窗口管理器。

## Design boundaries

- 隐藏只改变前端布局，不卸载草稿、消息或记忆状态。
- 同一 split 始终至少保留一个 pane，避免整个主工作区成为空白。
- 桌面侧栏最小态保持 Logo 与展开按钮，不缩为零；移动端不启用拖动 separator。
- localStorage 失败不能阻塞工作台，沿用现有可选偏好策略。

## Milestones

- [x] M1 - 实现磁吸式 `ResizableSplit`、恢复控制和持久化。
- [x] M2 - 实现可拖动侧栏及按钮 / 键盘状态同步。
- [x] M3 - 完成微交互样式、响应式保护和自动化测试。
- [x] M4 - 完成生产构建与真实浏览器桌面 / 移动验收。

## Acceptance criteria

- [x] 侧栏拖至左侧极限后进入现有品牌窄栏，向右拖、点击或键盘操作均可恢复。
- [x] 对话和 Markdown 任一侧均可拖到完全隐藏，并能从边缘恢复。
- [x] 记忆库与 Markdown 内部分栏复用相同行为，不出现双层卡片或内容溢出。
- [x] separator 具备正确 ARIA 数值与键盘行为，命中区不造成布局抖动。
- [x] 刷新后恢复最近布局；移动端仍是完整抽屉和纵向工作台。
- [x] `make check` 与真实浏览器控制台检查通过。

## Rollout and recovery

- 仅 Web 前端状态与 CSS 变化，无数据迁移和 API 契约变化。
- 回滚时删除新增侧栏 separator，并恢复 `ResizableSplit` 的硬最小宽度算法；旧的 localStorage
  数值仍是合法百分比，不影响旧版加载。

## Progress log

- 2026-08-06: 完成 react-resizable-panels、Allotment、Golden Layout、VS Code 工作台和 WAI
  Window Splitter 模式调研；选择在现有轻量分栏上实现磁吸收起，避免引入重型布局依赖。
- 2026-08-06: 完成导航、对话 / Markdown、记忆列表 / 详情和 Markdown 编辑 / 预览四层
  可拖动布局；加入磁吸阻尼、边缘恢复、键盘、双击复位和 localStorage 持久化。
- 2026-08-06: `make check` 通过，包括 45 个 Web 测试、92 个 API 测试、OpenAPI 漂移检查
  和 Next.js 生产构建。
- 2026-08-06: 在 `http://localhost:19080` 完成真实指针拖拽、左右隐藏、边缘 / Enter 恢复、
  刷新持久化和 390 x 844 移动视口验收；浏览器控制台无警告或错误。

## Completion summary

M1-M4 与全部验收条件已完成。布局只影响本地 Web 偏好，不改变草稿、记忆或 workspace
权限；隔离预览保留在 `http://localhost:19080`。
