# Redeploy memory timeline library

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

将当前工作区中的“成员筛选 + 记忆动态时间线 + Markdown 内容/修改记录”Web 改版部署到
本机 `http://localhost:8080`，保持 API、worker、数据库和 PostgreSQL 数据卷不变。

## Context and evidence

- `0046-memory-timeline-markdown-library.md` 已完成源码、自动化测试和独立预览验收。
- `make check` 已通过：Web 126 个测试、API 207 个测试、检索评估、OpenAPI 和生产构建均通过。
- 当前 Compose 服务全部运行，Web、API 与数据库 healthy。

## Scope

### In scope

- 运行 Compose 安全检查并为当前 Web 镜像保留回退标签。
- 只重建和替换无状态 `web` 服务。
- 验证容器健康、HTTP 健康端点和浏览器中的新版团队记忆界面。

### Non-goals

- 不重建 API、worker、proxy 或数据库，不运行迁移，不删除数据卷。
- 不提交、推送或修改 `.env`。

## Milestones

- [x] M1 — Compose 安全检查与回退标签。
- [x] M2 — 构建并切换 Web 服务。
- [x] M3 — 健康端点与浏览器验收。

## Acceptance criteria

- [x] `web` 容器 healthy，`/`、`/health`、`/api/ready` 返回 200。
- [x] 团队记忆页面显示成员筛选、动态时间线、Markdown 内容和修改记录。
- [x] 数据库 volume 与其他服务保持运行。

## Rollout and recovery

部署前将 `memora-web:local` 保留为 `memora-web:pre-0047-20260830`。失败时恢复该镜像并仅重建
Web 容器；数据库不参与回退。

## Progress log

- 2026-08-30: 确认当前 Web、API、数据库均 healthy，准备执行仅 Web 部署。
- 2026-08-30: `make compose-check` 通过；旧 Web 镜像保留为
  `memora-web:pre-0047-20260830`。
- 2026-08-30: 使用 `docker compose up --detach --build --no-deps web` 完成 Web 构建与切换。
- 2026-08-30: 首页、`/health`、`/api/ready` 均返回 200；Web、API、数据库 healthy，
  `memora_postgres-data` 保持存在。
- 2026-08-30: 浏览器确认生产页面显示成员筛选、共享时间线、Markdown 内容与修改记录，控制台
  无 error 或 warning。

## Completion summary

当前工作区的记忆时间线与 Markdown 详情改版已部署到 `http://localhost:8080`。本次仅替换
无状态 Web 容器，API、worker、proxy 和数据库未重启；旧 Web 镜像已保留用于快速回退。
