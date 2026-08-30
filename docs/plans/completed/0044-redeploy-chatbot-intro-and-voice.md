# Redeploy Chatbot introduction and voice input

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

将当前工作区已验证的 Chatbot 介绍弹窗、语音输入及配套前后端代码重新部署到本机
`http://localhost:8080`，保留现有 PostgreSQL 数据与用户未提交修改。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 规定新对话统一入口、授权记忆范围和语音转文字行为。
- 相关架构与 ADR：`docs/architecture/overview.md` 规定本地使用 Docker Compose 单机部署。
- 当前代码事实：`make check` 已通过；现有 Web/API/DB 容器健康，但 Web 与 API 镜像早于当前工作区。

## Scope

### In scope

- 校验 Compose 安全配置并备份当前无状态应用镜像标签。
- 重建并切换 Web、API、worker；运行幂等迁移检查并保留 PostgreSQL volume。
- 验证容器健康、Web/API 健康端点和最新页面资源。

### Non-goals

- 不清空、删除或重建数据库卷。
- 不提交、推送代码，不修改 `.env`，不公开暴露本地端口。

## Assumptions and open questions

- [x] 用户的“重新部署”指当前 `localhost:8080` Docker Compose 环境。
- [x] 当前未提交工作区内容就是需要部署的版本。

## Design and boundaries

从当前工作区直接构建本地镜像，通过 Compose 重建无状态服务。迁移服务只执行向前幂等升级；
数据库 volume 不参与重建。旧镜像保留带时间戳标签用于应用级回退。

## Milestones

- [x] M1 — 部署边界和回退镜像已确认；验证：容器、镜像、volume 检查。
- [x] M2 — 最新 Web/API/worker 已构建并切换；验证：Compose 服务状态。
- [x] M3 — 页面和 API 已验收；验证：`/health`、`/api/ready` 与页面内容检查。

## Acceptance criteria

- [x] `http://localhost:8080` 返回 200。
- [x] `/health`、`/api/ready` 返回 200，Web/API/DB healthy。
- [x] 最新 Web bundle 包含 Chatbot 介绍弹窗文案。
- [x] 数据库 volume 保持存在且未被删除或重建。

## Verification

- 自动化检查：`make compose-check`；部署前 `make check` 已通过。
- 集成验证：Compose 状态、HTTP 健康端点、最新静态资源。
- 安全与权限验证：代理继续仅绑定 loopback，不输出 `.env` 内容。

## Rollout and recovery

部署前为当前 Web/API/worker 镜像创建回退标签。新版本异常时，用回退标签恢复无状态服务；
数据库与 volume 不变，无需数据恢复。

## Progress log

- 2026-08-30: 确认当前为 Docker Compose 本地部署，全部核心容器健康，数据库 volume 存在。
- 2026-08-30: Compose 安全检查通过，为 Web/API/worker 旧镜像创建 `pre-0044` 回退标签。
- 2026-08-30: 从当前工作区完成 Web/API/worker 构建和切换；迁移与 seed 任务正常退出。
- 2026-08-30: 首页、Web health、API ready 均返回 200；浏览器实测介绍弹窗可见、背景
  `blur(12px)`，控制台无 warning/error；OpenAPI 包含 `/audio/transcriptions`。

## Decision log

- 2026-08-30: 同步重建 Web、API、worker；原因是当前工作区包含语音输入的前后端配套改动。

## Completion summary

当前工作区已经部署到 `http://localhost:8080`。Web/API/DB 均 healthy，worker 正常运行；
Chatbot 介绍弹窗和语音转写接口均已进入运行版本。数据库继续挂载原有
`memora_postgres-data`，没有删除或重建数据卷。旧 Web/API/worker 镜像保留为
`pre-0044-20260830`，可用于应用级回退。
