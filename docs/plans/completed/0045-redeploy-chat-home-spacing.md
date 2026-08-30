# Redeploy Chat home spacing and copy

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

将新对话首页最新的标题间距和输入框占位文案部署到本机 `http://localhost:8080`，保留现有
API、worker、数据库和 PostgreSQL 数据卷。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 的统一 Chatbot 与授权记忆边界保持不变。
- 相关架构：`docs/architecture/overview.md` 规定本地 Docker Compose 单机部署。
- 当前代码事实：本次部署后的新增差异只位于 Web 文案、样式和测试，`make check` 已通过。

## Scope

### In scope

- 校验 Compose 安全配置并保留当前 Web 镜像回退标签。
- 只重建并切换 `web` 服务。
- 验证健康端点、生产 bundle 和浏览器页面。

### Non-goals

- 不重建 API、worker、数据库，不运行迁移，不删除数据卷。
- 不提交、推送或修改 `.env`。

## Assumptions and open questions

- [x] 用户要求部署当前工作区中的最新网页版本。

## Design and boundaries

使用 Compose `--no-deps` 只替换无状态 Web 容器；旧 Web 镜像保留回退标签。代理、API 和
数据库继续运行，避免无关服务切换。

## Milestones

- [x] M1 — 安全检查与回退标签完成。
- [x] M2 — 最新 Web 镜像构建并切换。
- [x] M3 — 健康端点、bundle 和浏览器验收通过。

## Acceptance criteria

- [x] 首页与 `/health` 返回 200，Web 容器 healthy。
- [x] 生产 bundle 包含最新占位文案和间距样式。
- [x] 浏览器实际页面显示最新占位文案。
- [x] 数据库 volume 保持原样。

## Verification

- 自动化检查：`make compose-check`；部署前 `make check` 已通过。
- 集成验证：Compose 状态、HTTP 200、生产 bundle 内容。
- 浏览器验证：刷新 localhost 后读取输入框 placeholder 和标题/输入框位置。

## Rollout and recovery

异常时将 `memora-web:pre-0045-20260830` 恢复为 `memora-web:local` 并重建 Web 容器；数据库
不参与回退。

## Progress log

- 2026-08-30: 确认当前服务健康，数据库仍挂载 `memora_postgres-data`。
- 2026-08-30: `make compose-check` 通过，并将旧 Web 镜像保留为
  `memora-web:pre-0045-20260830`。
- 2026-08-30: 使用 `docker compose up --detach --build --no-deps web` 构建并切换 Web。
- 2026-08-30: 首页、`/health`、`/api/ready` 均返回 200，Web 容器 healthy。
- 2026-08-30: 生产 bundle 包含最新占位文案及标题定位规则；浏览器读取到新文案，标题到输入框
  间距为 25px，控制台无 error 或 warning。

## Decision log

- 2026-08-30: 只重建 Web；原因是上次部署后的新增差异仅为前端样式、文案和测试。

## Completion summary

最新 Web 已在 `http://localhost:8080` 生效。部署只替换 Web 容器，API、worker、proxy 和数据库
持续运行；PostgreSQL 仍使用 `memora_postgres-data`。旧 Web 镜像回退标签已保留。
