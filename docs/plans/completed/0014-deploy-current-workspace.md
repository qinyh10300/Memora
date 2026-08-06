# Deploy current workspace

Status: completed
Owner: Codex
Last updated: 2026-08-06

## Outcome

将当前工作区代码和数据库迁移部署到现有 Docker Compose 服务，使用户能够从
`http://localhost:8080` 使用包含团队共享记忆在内的最新 Memora。

## Context and evidence

- 用户已明确授权将当前未提交工作区部署到现有服务。
- 当前 Compose 服务启动前仍在运行；命令行访问 `localhost:8080` 的 502 最终定位为本机
  `http_proxy` / `all_proxy` 错误代理 localhost，服务直连正常。
- 当前工作区包含待执行的 `0010` 和 `0011` 数据库迁移。
- 本次只做本地部署，不执行 Git commit 或 push。

## Scope

### In scope

- 校验 Compose 配置和现有数据库状态。
- 重新构建 API、worker 和 Web 镜像。
- 按 `migrate -> seed -> api/worker -> web -> proxy` 顺序启动服务。
- 验证数据库版本、容器健康、HTTP 路由和浏览器关键页面。

### Non-goals

- Git commit、Git push 或远程服务器发布。
- 清空现有数据库、重建 volume 或更改真实密钥。

## Assumptions and open questions

- 已确认：保留现有 PostgreSQL volume 和用户数据。
- 已确认：部署目标为当前 Compose 的 `localhost:8080` 服务。

## Design and boundaries

- 先运行非破坏性的 Compose 配置校验和数据库备份，再重建应用容器。
- Alembic 迁移先于新 API 启动；失败时停止后续发布并保留备份。
- 健康检查通过后再进行 HTTP 和真实浏览器验收。

## Milestones

- [x] M1 — 完成部署前检查和数据库备份。
- [x] M2 — 构建镜像并成功执行迁移、种子和服务切换。
- [x] M3 — 容器、HTTP 和浏览器验收通过。

## Acceptance criteria

- [x] `migrate` 与 `seed` 正常退出，数据库位于最新 revision。
- [x] `api`、`web`、`db` 健康，`worker` 与 `proxy` 正常运行。
- [x] `http://localhost:8080` 返回 200，不再返回 502。
- [x] 最新首页和登录后的团队入口可见。
- [x] 现有数据库 volume 未删除，Git 状态未被提交或推送。

## Verification

- 自动化检查：沿用本次部署前已通过的 `make check`；Dockerfile 实际生产构建通过。
- 集成验证：Alembic revision 为 `20260806_0011`，`migrate` / `seed` 退出码为 0，首页与
  API `/ready` 均返回 200。
- 手工或浏览器验证：真实访问首页并用种子账号登录，确认个人空间、空间切换、团队详情、
  团队号和成员目录均已上线；浏览器控制台无警告或错误。
- 安全与权限验证：未输出 `.env` 密钥、未重建数据库 volume；部署前后均为 4 个用户、5 个
  workspace 和 70 条 memory，所有团队均有团队号。

## Rollout and recovery

- 部署前使用 `pg_dump` 创建本地备份。
- 若新服务健康检查失败，保留数据库与备份，查看失败容器日志；不执行破坏性降级。
- 当前迁移的降级路径已在开发验证中通过，但线上恢复优先使用备份和旧镜像。

## Progress log

- 2026-08-06: 用户明确授权部署当前工作区，开始检查现有服务和 502 状态。
- 2026-08-06: 在 `/tmp/memora-predeploy-20260806-164609.dump` 完成 3.4 MB 数据库备份。
- 2026-08-06: 首次并行构建因 npm registry 超时中止，旧服务未切换；为 pnpm 增加持久缓存
  和更长重试窗口后，前后端生产镜像构建成功。
- 2026-08-06: 执行 `0011` 迁移和 seed，完成服务切换、代理重建与真实浏览器验收。

## Decision log

- 2026-08-06: 部署当前未提交工作区；不将 commit/push 与本地发布绑定。
- 2026-08-06: 保留部署前数据库备份；不做不必要的数据库降级或 volume 重建。

## Completion summary

当前工作区已部署到 `http://localhost:8080`。数据库升级到 `0011`，原有用户、workspace 和
memory 计数保持不变；API、Web、数据库健康，worker 与代理正常运行。首页、登录、空间切换
和团队详情已在真实浏览器验证。未执行 Git commit 或 push。
