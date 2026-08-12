# Simplified primary navigation

Status: completed
Owner: Codex
Last updated: 2026-08-11

## Outcome

将左侧主导航精简为“新对话、我的记忆、团队记忆、记忆分析、绘图”五项，其他现有功能
入口暂时隐藏但不删除实现或数据。

## Scope and mapping

- `CAPTURE` → 新对话
- `LIBRARY` → 我的记忆
- `KNOWLEDGE` → 团队记忆
- `INSIGHTS` → 记忆分析
- `DIAGRAMS` → 绘图
- 从主导航隐藏 `RESEARCH` 和收起状态下额外的团队成员入口。
- 不修改 API、数据库、权限、功能页面或数据模型。

## Acceptance criteria

- [x] 展开与收起状态的主导航均严格展示五项，顺序一致。
- [x] 五个入口仍打开各自已有页面或功能。
- [x] 旧导航名称和深度调研入口不再出现在侧栏。
- [x] 相关测试、完整工程检查和本地浏览器验证通过。
- [x] 本地 Web 重新构建并通过健康检查。

## Verification

- Sidebar 相关组件测试、类型检查与 lint。
- `make check`。
- 本地浏览器展开/收起及入口点击验证。
- Compose 健康检查。

## Completion summary

展开和收起状态的主导航现在都只显示五个指定功能。浏览器逐项验证了“我的记忆、团队
记忆、记忆分析、绘图”仍分别进入已有功能页面；深度调研等入口仅从导航隐藏。`make
check` 通过（Web 86、API 184），本地 Web 已重新部署且健康。
