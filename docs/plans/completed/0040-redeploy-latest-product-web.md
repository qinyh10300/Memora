# Redeploy latest product web locally

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

在本机恢复 Memora 的 Docker Compose 运行环境，并确保 `http://localhost:8080` 提供
`future/codex/core-platform-optimization` 提交 `9593a70194600b054e2de19cd82fc21fa5dca3c2`
对应的最新产品网页，同时保留现有 PostgreSQL 数据卷和用户未提交的工作区修改。

## Context and evidence

- 产品规则：公开首页与个人/团队 Markdown 工作台继续遵守默认私有、显式共享和授权引用边界。
- 架构与 ADR：`docs/architecture/overview.md` 与 ADR-0001 规定本地部署使用 Next.js、FastAPI、
  PostgreSQL/pgvector、worker 和 Caddy 组成的单机 Docker Compose 环境。
- 当前代码事实：本地 HEAD 与 `future/codex/core-platform-optimization` 最新远端提交一致；
  `apps/web` 没有 tracked 工作树修改，两个远端的 `main` 与 `origin` 同名功能分支均更旧。
- 当前运行事实：`.env` 存在且权限检查通过，Compose 配置检查通过；Colima 未运行，
  `http://localhost:8080` 当前不可访问。

## Scope

### In scope

- 启动本机 Colima/Docker 运行时并核对既有 Compose 容器、镜像和持久卷。
- 从当前 HEAD 构建并切换最新 Web 镜像；仅在依赖服务缺失时恢复现有 Compose 服务。
- 验证 Web/API 健康、首页响应、最新记忆星座页面和浏览器控制台。
- 复查工作树，确认没有覆盖用户现有修改。

### Non-goals

- 不拉取或合并其他分支，不提交、推送或公开部署。
- 不清空数据库、不删除或重建持久卷、不执行 Alembic downgrade。
- 不修改产品功能、API 契约、权限逻辑或真实 `.env` 内容。

## Assumptions and open questions

- [x] “最新产品网页”指 Futura 功能分支的最新 Web 界面提交 `9593a70`。
- [x] Colima 启动后既有 Compose 容器和 `memora_postgres-data` 卷仍然存在。

## Design and boundaries

本次为本地无状态 Web 重部署，不包含 schema、API 或数据迁移。优先恢复既有容器并只重建
`web` 服务；数据库、API 和 worker 不因网页构建而重建。若既有依赖服务不存在，才使用仓库
标准 Compose 启动路径恢复完整环境。失败时保留旧镜像、数据库卷和工作区文件。

## Milestones

- [x] M1 — Docker 运行时和现有数据边界核验完成；验证：Compose 容器、volume、数据库健康。
- [x] M2 — 最新 Web 镜像构建并切换；验证：Web 容器 healthy，首页和健康端点返回 200。
- [x] M3 — 浏览器验收完成；验证：记忆星座、页面可见内容和控制台无阻塞错误。

## Acceptance criteria

- [x] `http://localhost:8080` 可访问并展示提交 `9593a70` 对应的最新页面。
- [x] `/health` 和 `/api/ready` 返回 HTTP 200。
- [x] Web 容器健康，数据库持久卷未删除或重建。
- [x] 首页记忆星座在支持 Canvas 的浏览器中进入 animated 或静态降级状态。
- [x] 用户原有未提交文件保持不变。

## Verification

- 自动化检查：Compose 配置与 secret 权限检查；最新页面定向 Web 测试和生产镜像构建。
- 集成验证：Compose 服务状态、Web/API 健康端点、首页 HTML。
- 手工或浏览器验证：首页内容、Canvas 状态、页面截图和控制台错误。
- 安全与权限验证：不输出 `.env` 值，不重建数据库卷，不改变授权或 API 服务代码。

## Rollout and recovery

先启动 Colima 并核对既有资源，再构建 `memora-web:local`，最后仅重建 `web` 容器；必要时
恢复无状态 `proxy`。若新页面失败，保留数据库和后台服务，重新使用先前 Web 镜像即可回退。

## Progress log

- 2026-08-30: 完成远端与本地 ref 核验；确认最新目标为 `9593a70`，工作区 Web 代码无修改。
- 2026-08-30: Compose 与 secret 权限检查通过；发现 Colima 未运行，开始恢复本机运行时。
- 2026-08-30: Colima 启动后原 Compose 容器和 `memora_postgres-data` 卷均存在；数据库 revision
  为 `20260810_0023`，六项核心表计数均为 0。本次未运行迁移或 seed，也未重建数据库服务。
- 2026-08-30: 使用 Node.js 24 运行首页、主题和记忆星座定向回归，3 个测试文件、83 项测试通过；
  从当前 HEAD 构建 `memora-web:local` 并只重建 `web` 容器，旧镜像保留为
  `memora-web:pre-0040-20260830`。
- 2026-08-30: 将 Caddy 运行时限制到 `127.0.0.1:8080/8443`；首页、`/health` 和
  `/api/ready` 均返回 200，Web/API/DB healthy。
- 2026-08-30: 浏览器验证首页、注册入口和实际视觉布局；Canvas 为 `animated`、尺寸
  2560 × 1298，控制台没有 warning/error。

## Decision log

- 2026-08-30: 从当前 HEAD 直接构建，不 checkout/merge；原因是 HEAD 已是目标提交且工作区有用户修改。
- 2026-08-30: 优先只重建 Web；原因是目标差异不含迁移、Compose 或 OpenAPI 变化。
- 2026-08-30: 不向空数据库写入开发 seed；原因是公开注册入口可用，而用户没有要求创建测试账号。
- 2026-08-30: 通过本次 Compose 运行时覆盖限制 Caddy 为 loopback，不改写 `.env`；原因是任务明确为本地部署。

## Completion summary

提交 `9593a70` 对应的最新 Memora 产品网页已部署至 `http://localhost:8080`。最新 Web
容器 healthy，Web/API 健康端点均返回 200，浏览器实测首页记忆星座正常动画且无控制台错误。
数据库卷和 revision 保持不变，当前库为空且未写入 seed；旧 Web 镜像已保留用于回退。用户
原有 `AGENTS.md`、`CLAUDE.md` 和未跟踪部署记录未被覆盖。
