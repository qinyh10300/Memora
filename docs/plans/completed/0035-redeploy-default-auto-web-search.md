# Redeploy default automatic web search UI

Status: completed
Owner: Codex
Last updated: 2026-08-12

## Outcome

把隐藏联网模式控件、普通聊天固定自动联网的当前工作区部署到本机 Docker Compose 服务
`http://localhost:8080`，保留现有 PostgreSQL 数据卷与用户数据。

## Scope

- 部署前校验 Compose、数据库 revision、核心数据计数和持久卷。
- 创建并验证 PostgreSQL 备份。
- 重建 migrate、seed、API、worker 与 Web，并恢复 proxy 对外服务。
- 验证容器健康、HTTP 路由、数据计数、日志与实际页面。

不执行 Git commit、push、数据库清空、volume 重建或活动数据库 downgrade。

## Milestones

- [x] M1 — 部署前基线与备份完成。
- [x] M2 — 镜像构建、迁移和服务切换完成。
- [x] M3 — 健康、数据、日志和页面验收完成。

## Rollout and recovery

迁移在应用服务前执行。失败时保留数据库、备份与 volume，不对活动数据库执行 downgrade；
需要回滚时优先恢复旧应用镜像并保留向前兼容 schema。

## Progress log

- 2026-08-12: 用户明确要求重新部署当前版本；开始部署前检查。
- 2026-08-12: Compose 与 secret 权限检查通过；确认复用 `memora_postgres-data`，部署前
  revision 为 `20260810_0023`，核心计数为 users 5、workspaces 7、memories 81、
  conversations 66、messages 216、assets 6。
- 2026-08-12: 创建 `artifacts/backups/memora-20260812T041114Z.dump`（6,459,513
  bytes），并在隔离 PostgreSQL 中成功恢复验证。
- 2026-08-12: `docker compose up --detach --build` 成功；migrate 与 seed 退出码均为 0，
  db、API 和 Web 健康，worker 与 proxy 正常运行。
- 2026-08-12: `/health` 与 `/api/ready` 均返回 200；部署后 revision 与全部核心数据计数
  和部署前一致，近期服务日志未发现异常。
- 2026-08-12: 在 `http://localhost:8080` 以真实登录态验收，联网模式 combobox 与辅助说明
  均为 0 个，输入区只保留添加内容、模型和发送；浏览器控制台无 error/warn。
