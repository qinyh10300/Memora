# Redeploy current contextual memory workspace

Status: completed
Owner: Codex
Last updated: 2026-08-12

## Outcome

把当前未提交工作区重新构建并部署到本机现有 Docker Compose 服务 `http://localhost:8080`，
保留 PostgreSQL 数据卷和现有用户数据，并验证三入口导航、个人整理助手和团队记忆中心。

## Scope

- 部署前校验 Compose、数据库 revision、核心数据计数和持久卷。
- 创建受限权限的 PostgreSQL 备份。
- 重建并切换 migrate、seed、API、worker、Web 和 proxy。
- 验证迁移、容器健康、HTTP 路由、错误日志和真实浏览器页面。

不执行 Git commit、push、数据库清空、volume 重建或 Alembic downgrade。

## Milestones

- [x] M1 — 部署前状态与备份完成。
- [x] M2 — 镜像构建、迁移和服务切换完成。
- [x] M3 — 数据、健康检查、日志和浏览器验收完成。

## Rollout and recovery

数据库迁移在应用进程前运行。任何迁移或健康检查失败都停止继续发布，保留数据库、备份和
现有 volume；不在活动数据库执行 downgrade。需要回滚时优先恢复旧应用镜像并保留向前兼容
schema，灾难恢复才使用已验证备份。

## Progress log

- 2026-08-12: 用户明确要求重新部署当前工作区；开始部署前审计。
- 2026-08-12: `make compose-check` 与 `make secret-permissions-check` 通过；确认复用
  `memora_postgres-data`，部署前 revision 为 `20260810_0023`，核心计数为 users 5、
  workspaces 7、memories 81、conversations 66、messages 216、assets 6。
- 2026-08-12: 创建备份
  `artifacts/backups/memora-20260812T024231Z.dump`（6,459,509 bytes），并在隔离
  PostgreSQL 中成功恢复验证；revision 和数据计数一致。
- 2026-08-12: `docker compose up --detach --build` 成功；migrate 与 seed 退出码均为 0，
  db、API 和 Web 健康，worker 与 proxy 正常运行。
- 2026-08-12: `/health` 与 `/api/ready` 均返回 200；部署后 revision 和全部核心计数与
  部署前一致，近期服务日志未发现异常。
- 2026-08-12: 在 `http://localhost:8080` 以真实登录态完成浏览器验收：三入口导航、
  通用助手、个人整理助手、团队共享记忆、记忆图谱、记忆分析和团队问答均可访问；控制台
  无 error/warn，验收后恢复 Alex 的个人空间。
