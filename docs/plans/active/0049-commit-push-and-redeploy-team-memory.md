# Commit, push, and redeploy team memory release

Status: in-progress
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

- [ ] M1 — 暂存并复查当前完整工作区，创建 Git 提交。
- [ ] M2 — 推送当前分支到配置的 origin 上游。
- [ ] M3 — 保留回退镜像并重建 Web、API、worker。
- [ ] M4 — 验证容器、健康端点和浏览器中的新版团队记忆页面。

## Acceptance criteria

- [ ] 工作区产品改动已提交，远端分支包含该提交。
- [ ] `http://localhost:8080`、`/health` 和 `/api/ready` 返回 200。
- [ ] Web、API、worker、数据库服务正常，数据库 volume 保持存在。
- [ ] 浏览器中可见团队统计、搜索和“问团队记忆”迷你对话入口。

## Rollout and recovery

部署前为当前 Web、API、worker 镜像创建 `pre-0049-20260830` 回退标签。新版本异常时恢复这些
无状态镜像；数据库不参与回退，不运行 downgrade。

## Progress log

- 2026-08-30: 已确认分支、上游、累计 diff 和全量 `make check` 结果。

## Completion summary

完成后填写。
