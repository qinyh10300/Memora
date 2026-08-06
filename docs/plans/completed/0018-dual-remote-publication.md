# Dual-remote publication

Status: completed
Owner: Codex
Last updated: 2026-08-07

## Outcome

将已完成的可拖动工作台与移动端适配按可审查的提交边界记录到 Git，并把 `main` 同步到 `origin` 和 `future` 两个远端仓库。

## Context and evidence

- 发布前本地、`origin/main`、`future/main` 均指向 `fb72d574f54f1a9bda8ff7d5d9a3f72aa6a9b83a`。
- 工作树包含前端实现与测试、产品/架构文档，以及已完成计划 `0016`、`0017`。
- `make check` 已于 2026-08-07 发布前通过：45 个 Web 测试、92 个 API 测试，以及格式、lint、类型、契约和生产构建检查。

## Scope

### In scope

- 审查并提交当前 Memora 工作树中的预期修改。
- 使用多个语义明确的提交保留实现、文档和发布过程。
- 推送 `main` 到 `origin` 与 `future`，并核对两个远端最终哈希。

### Non-goals

- 不改写远端历史，不强制推送。
- 不修改产品行为、API、数据库或部署配置。
- 不提交 `.env`、密钥、密码、会话或生产连接信息。

## Milestones

- [x] M1 — diff、测试和敏感信息检查完成。
- [x] M2 — 实现与测试提交完成。
- [x] M3 — 产品、架构和计划记录提交完成。
- [x] M4 — 两个远端推送成功并核对哈希。

## Publication commits

- `7079387` — `feat(web): add magnetic responsive workspace layout`
- `45ac8b9` — `docs: record responsive workspace rollout`

## Verification

- 自动化检查：`make check`。
- Git 检查：`git diff --check`、GitNexus `detect_changes`、逐提交 `git show --stat`。
- 远端检查：`git ls-remote origin refs/heads/main` 与 `git ls-remote future refs/heads/main`。

## Rollout and recovery

只执行普通 fast-forward push。若任一远端在发布过程中前进，停止推送并重新评估，不使用 force push。提交可通过标准 revert 独立回退。

## Progress log

- 2026-08-07: 拉取两个远端并确认本地、`origin/main`、`future/main` 基线一致，无领先或落后提交。
- 2026-08-07: `git diff --check`、凭据特征扫描和 GitNexus 变更检测通过；GitNexus 对实现提交评估为 medium、无 HIGH/CRITICAL 风险，剩余文档变更为 low。
- 2026-08-07: 创建实现提交 `7079387` 和文档提交 `45ac8b9`，逐笔复核提交文件范围。
- 2026-08-07: 创建发布记录提交 `29e3249`；普通 fast-forward push 到 `origin/main` 和 `future/main` 均成功。
- 2026-08-07: 使用 `git ls-remote` 确认两个远端均指向 `29e3249be855380a1aa4aaad8da41c759b76e7b1`，随后归档本记录。

## Completion summary

实现、测试、产品文档和执行记录已拆分为可独立审查的提交，并通过普通 fast-forward push 同步到两个 GitHub 远端。发布过程中没有强制推送、历史改写、密钥提交或未解决的远端分叉。归档提交将继续以 fast-forward 方式同步到两个远端，使最终仓库同时包含本发布审计记录。
