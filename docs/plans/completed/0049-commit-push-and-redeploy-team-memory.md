# Commit, push, and redeploy team memory release

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

将当前工作区中已通过 `make check` 的累计产品改动提交到
`codex/core-platform-optimization`，推送至该分支配置的 `origin` 上游，然后重新部署到本机
`http://localhost:8080`。

## Context and boundaries

- 当前分支比 `origin/codex/core-platform-optimization` 领先 13 个既有提交；推送会同步这些提交。
- 当前工作区包含 Web、API、worker、Compose 和 OpenAPI 变更，因此不能只替换 Web 服务。
- 部署只重建无状态应用服务并运行向前幂等迁移，不删除或重建 PostgreSQL 数据卷。
- 提交前复查 staged diff、敏感信息和 GitNexus 影响；部署前保留现有应用镜像标签。

## Milestones

- [x] M1 — 暂存并复查当前完整工作区，创建 Git 提交。
- [x] M2 — 推送当前分支到配置的 origin 上游。
- [x] M3 — 保留回退镜像并重建 Web、API、worker。
- [x] M4 — 验证容器、健康端点和浏览器中的新版团队记忆页面。

## Acceptance criteria

- [x] 工作区产品改动已提交，远端分支包含该提交。
- [x] `http://localhost:8080`、`/health` 和 `/api/ready` 返回 200。
- [x] Web、API、worker、数据库服务正常，数据库 volume 保持存在。
- [x] 浏览器中可见团队统计、搜索和“问团队记忆”迷你对话入口。

## Rollout and recovery

部署前为当前 Web、API、worker 镜像创建 `pre-0049-20260830` 回退标签。新版本异常时恢复这些
无状态镜像；数据库不参与回退，不运行 downgrade。

## Progress log

- 2026-08-30: 已确认分支、上游、累计 diff 和全量 `make check` 结果。
- 2026-08-30: 提交 `8a61f6a` 并推送至 `origin/codex/core-platform-optimization`。
- 2026-08-30: 为 Web、API、worker 保留 `pre-0049-20260830` 镜像，Compose 安全检查通过。
- 2026-08-30: 完成 Web、API、worker 重建；迁移与 seed 正常退出，数据库 volume 保持不变。
- 2026-08-30: 首页、Web/API 健康端点均返回 200；浏览器确认统计、更新动态、搜索、迷你对话
  和 TEAM 跳转均正常，背景保持 `rgb(7, 7, 7)`，控制台无日志。

## Completion summary

提交 `8a61f6a` 对应的完整产品改动已推送并部署到 `http://localhost:8080`。Web 和 API
healthy，worker 正常运行，PostgreSQL 数据卷未删除或重建。部署前应用镜像已保留，可使用
`pre-0049-20260830` 标签回退无状态服务。
