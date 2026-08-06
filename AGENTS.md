# Memora Agent Guide

## Project intent

Memora 的目标、用户、范围和成功指标以 `docs/product/brief.md` 为准。系统边界和依赖方向以 `docs/architecture/overview.md` 及已接受的 ADR 为准。不要在本文件复制这些文档的全文。

## Repository map

- `docs/product/`: 产品目标、用户场景、验收指标和非目标。
- `docs/architecture/`: 当前系统架构和跨模块约束。
- `docs/adr/`: 已作出的重要架构决策；不要静默推翻。
- `docs/plans/active/`: 正在执行的计划。
- `docs/plans/completed/`: 已完成计划和执行记录。
- `apps/web/`: 规划中的 Web 前端。
- `apps/api/`: 规划中的 API 与后台任务实现。
- `packages/`: 规划中的共享工具或生成的 API 客户端；避免放置重复领域模型。

## Before changing anything

1. 阅读与任务相关的产品文档、架构文档、ADR、活动计划和现有测试。
2. 检查工作树，保留用户已有修改，不覆盖无关内容。
3. 对跨模块、数据库迁移、权限、AI 检索或部署变更，先按照 `PLANS.md` 创建或更新执行计划。
4. 如果需求与现有产品或 ADR 冲突，先指出冲突，不要自行选择新方向。

## Product invariants

- 新想法默认是 `PRIVATE`，只有用户主动操作才能变为工作区可见。
- AI 检索必须先应用身份、工作区和可见性过滤，再进行召回和生成。
- 私有记录不得出现在其他用户的检索候选、提示词、日志、引用或报告中。
- 事实性 AI 回答必须引用用户有权访问的原始记录，并包含作者和记录时间。
- 证据不足时明确说明不知道；不要推测同事的心理状态或未记录经历。
- 想法正文不原地编辑。修正或演进通过新的补充记录表达，可关联被补充记录。
- 删除后，正文和向量必须从活动数据及检索索引移除；审计记录只保留必要的非正文元数据。
- 不将真实密钥、密码、会话密钥或生产连接串写入 Git、测试快照或日志。

## Architecture invariants

- 先保持模块化单体和单服务器部署，不因假设性的未来需求拆分微服务。
- Web 与 API 通过 OpenAPI 契约通信；不要手工维护两套彼此独立的请求类型。
- 领域逻辑不得直接依赖某个 AI 供应商 SDK。聊天和 embedding 分别通过可替换端口调用。
- PostgreSQL 是 v0.1 的事实来源；向量库使用同库中的 pgvector，不引入第二个专用向量数据库。
- 工作区边界必须存在于数据模型和查询条件中，不能只依赖前端隐藏或提示词约束。
- 记录创建不能因 embedding 暂时失败而丢失；使用可观察、可重试的处理状态。

## Command contract

工程骨架建立后，仓库必须提供以下稳定入口；具体实现可以是 `Makefile` 或同等脚本：

- `make setup`: 安装或启动开发依赖。
- `make dev`: 启动本地完整开发环境。
- `make check`: 运行格式、lint、类型检查、单元测试和构建检查。
- `make test`: 运行自动化测试。
- `make e2e`: 运行关键用户路径的端到端测试。

在这些命令尚未实现前，不要声称项目已经完成工程初始化。

## Working style

- 描述结果、边界和完成条件，给实现保留合理自主空间。
- 优先交付小的端到端垂直切片，避免先建设大量未被使用的抽象。
- 修改行为时添加或更新测试；修复缺陷时优先添加回归测试。
- 不顺手重构无关代码，不批量更新无关依赖。
- 数据库变更必须使用迁移，并说明向前兼容、回滚或恢复方案。
- 对外部 AI 调用设置超时、重试边界、用量记录和错误降级。
- 未经明确要求，不提交、推送、部署、发送外部消息或执行破坏性操作。

## Agent delegation

可对边界清晰的只读任务使用子 Agent，例如代码探索、测试缺口分析、安全审查和独立 diff 审查。不要让多个 Agent 同时修改同一文件或同一迁移；主 Agent 负责整合、验证和最终结论。

## Definition of done

- 用户可观察行为满足活动计划的验收条件。
- 权限、失败路径和关键边界有自动化测试。
- 相关测试通过，且 `make check` 成功。
- 运行时行为已通过适当层级验证，不能只依赖静态阅读。
- diff 已复查，无无关修改、密钥或敏感日志。
- 产品行为、架构或运维方式变化时，相应文档与 ADR 已同步。
- 最终报告列出修改、验证证据、剩余风险和未完成事项。

## Review guidance

代码审查遵循 `docs/code-review.md`。优先报告正确性、越权访问、隐私泄露、无依据的 AI 结论、数据丢失和缺少回归测试；不要把纯风格偏好当成阻塞问题。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Memora** (2827 symbols, 3857 relationships, 30 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Memora/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Memora/clusters` | All functional areas |
| `gitnexus://repo/Memora/processes` | All execution flows |
| `gitnexus://repo/Memora/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
