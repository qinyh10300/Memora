# Memora Execution Plans

执行计划是长任务的动态事实来源，而不是编码前写完就不再更新的规格说明。

## When a plan is required

以下变更必须在 `docs/plans/active/` 中有活动计划：

- 跨越 Web、API、数据库或 AI 检索中两个及以上边界。
- 引入数据库迁移、公共 API 变化或部署变化。
- 改变身份、权限、共享或数据保留规则。
- 实现新的 AI 检索、报告或模型供应商能力。
- 预计无法在一个小而明确的修改中完成的任务。

小型文案、局部样式或显而易见的单文件修复不必创建计划，但仍需明确验收和验证方式。

## Plan lifecycle

1. 在 `docs/plans/active/NNNN-short-name.md` 创建计划。
2. 调研现有事实，区分已确认事实、假设和待决定事项。
3. 将任务拆成可独立验证的里程碑，每个里程碑尽量形成可运行状态。
4. 执行中更新进度、发现、决策和验证结果。
5. 完成后记录最终结果和遗留问题，并移至 `docs/plans/completed/`。

## Template

```markdown
# <Plan title>

Status: planning | approved | in-progress | blocked | completed
Owner: <person or agent>
Last updated: YYYY-MM-DD

## Outcome

描述用户可观察的结果，不以文件列表代替结果。

## Context and evidence

- 相关产品规则：
- 相关架构与 ADR：
- 当前代码事实：

## Scope

### In scope

- ...

### Non-goals

- ...

## Assumptions and open questions

- [ ] ...

## Design and boundaries

说明数据流、接口、权限边界、失败策略和必要取舍。

## Milestones

- [ ] M1 — 可验证结果；验证：`<command or observation>`
- [ ] M2 — 可验证结果；验证：`<command or observation>`

## Acceptance criteria

- [ ] ...

## Verification

- 自动化检查：
- 集成验证：
- 手工或浏览器验证：
- 安全与权限验证：

## Rollout and recovery

说明迁移顺序、兼容性、回滚或数据恢复方式。

## Progress log

- YYYY-MM-DD: ...

## Decision log

- YYYY-MM-DD: 决定；原因；被放弃的方案。

## Completion summary

完成后填写实际结果、验证证据、偏离计划之处和后续工作。
```
