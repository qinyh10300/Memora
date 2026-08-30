# Deploy latest Futura interface

Status: completed
Owner: Codex
Last updated: 2026-08-13

## Outcome

将 `future/codex/core-platform-optimization` 的最新页面版本 `9593a70` 部署到本机现有
Docker Compose 服务 `http://localhost:8080`，保留 PostgreSQL 数据卷、用户数据和现有 API
行为，并验证深浅主题、蓝色强调色与首页记忆星座页面可以正常加载。

## Context and evidence

- 相关产品与架构规则：默认私有、workspace 隔离、显式共享和引用规则不因本次视觉部署改变。
- 当前代码事实：Futura 比原本地 HEAD 多 13 个提交；变更集中于 Web token、主题、响应式页面、
  首页 canvas 背景和截图测试，另有 API Dockerfile 的可选 PyPI index 构建参数；没有数据库迁移。
- 当前运行事实：现有 `db`、`api`、`worker`、`web` 和 `proxy` 均在运行，数据库使用
  `memora_postgres-data` 持久卷；本地分支已 fast-forward 到 `9593a70`。

## Scope

### In scope

- 校验 Compose、secret 权限、数据库 revision、数据计数与持久卷。
- 创建并隔离验证 PostgreSQL 备份。
- 运行仓库检查后重建 Web 页面服务，保持数据库与后台服务不被重建。
- 验证容器健康、HTTP 健康端点、首页响应、日志和实际页面。

### Non-goals

- 不提交、推送、清空数据库、重建 volume 或执行 Alembic downgrade。
- 不修改产品功能、权限、API 契约或生产环境。

## Design and boundaries

本次没有 schema 或 API 行为变化，部署只切换 Web 镜像；数据库、API 和 worker 保持现状。
部署前备份并验证，页面构建或健康检查失败时保留旧数据和持久卷，并可从目标提交重新构建 Web
镜像。

## Milestones

- [x] M1 — 部署前基线与备份完成；验证：Compose/权限、revision/计数、恢复验证。
- [x] M2 — 最新 Web 镜像构建并切换；验证：容器健康与 HTTP 200。
- [x] M3 — 页面、日志和数据不变性验收完成；验证：浏览器检查与部署后计数。

## Acceptance criteria

- [x] 本机页面运行提交 `9593a70` 对应的最新 Web 代码。
- [x] `/health` 和 `/api/ready` 返回 200，Web 容器健康。
- [x] 数据库 revision、核心数据计数与部署前一致。
- [x] 深色/浅色页面可用，首页记忆星座存在且控制台无错误。

## Verification

- 自动化检查：使用 Node.js 24 运行 `make check`，Web 108 个测试、API 188 个测试、检索评估、
  OpenAPI 契约检查和生产构建全部通过。
- 集成验证：Web/API 健康端点均返回 200；Web 容器为 healthy；首页返回 HTML 200。
- 浏览器验证：公开首页 canvas 的 `data-constellation=animated`，尺寸 2560 × 1298；工作台深浅
  主题切换正常，测试后恢复原深色主题；浏览器控制台无 warning/error。
- 安全与权限验证：未重建 API/worker，未执行迁移；备份恢复验证通过；数据卷保持不变。

## Rollout and recovery

已在验证数据库备份后构建 `memora-web:local`，仅替换 Web 容器，并重启无状态 Caddy 代理。
数据库、API、worker 和持久卷未切换。若需回退页面，可检出此前提交并重新构建 Web 镜像；数据库
备份保留在 `artifacts/backups/memora-20260813T033956Z.dump`。

## Progress log

- 2026-08-13: 用户要求部署 Futura 最新页面；确认 13 个新增提交且没有迁移，本地分支已快进到
  `9593a70`，Compose 和 secret 权限检查通过，现有服务健康。
- 2026-08-13: 部署前 revision 为 `20260810_0023`；核心计数 users 5、workspaces 7、
  memories 81、conversations 66、messages 216、assets 6。创建备份
  `artifacts/backups/memora-20260813T033956Z.dump`（6,459,513 bytes），隔离恢复验证通过。
- 2026-08-13: 本机默认 Node.js 25 的内建 `localStorage` 与 Vitest 环境不兼容；改用工作区 Node.js
  24 后主题定向测试 13/13 通过，完整 `make check` 随后通过。
- 2026-08-13: 构建镜像 `sha256:7f6a5b5ea5e8fdde07e57bcaa3e357bcba25b557ba47ef80f265cd8586b1a39a`
  并替换 Web 容器。宿主首次 HTTP 检查受到本机 `http_proxy` 影响产生假 502；使用
  `--noproxy '*'` 及容器内请求确认实际 Caddy、Web、API 链路均为 200。
- 2026-08-13: 部署后 revision 与六项数据计数逐项等于基线；浏览器验证最新公开首页、星座动画、
  工作台主题切换和零控制台错误，部署完成。

## Decision log

- 2026-08-13: 只重建 Web 页面服务；原因是差异没有运行时 API 或数据库变化，降低服务切换风险。
- 2026-08-13: 不修改测试代码以兼容 Node.js 25；使用稳定 Node.js 24 执行门禁，避免把本机运行时
  问题混入本次页面部署。

## Completion summary

提交 `9593a70` 对应的最新 Futura 页面已部署至 `http://localhost:8080`。Web 容器健康，API
保持健康，数据库未迁移且核心数据计数无变化。完整自动化门禁与浏览器验收均通过；保留已验证的
数据库备份与恢复报告用于恢复。本次没有提交或推送部署记录。
