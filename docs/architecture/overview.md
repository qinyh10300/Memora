# Memora Initial Architecture

Status: Accepted baseline

Last updated: 2026-07-22

## Architecture goal

在单台公网服务器上交付安全、可验证的四人测试版本，同时保留未来扩展产品模块、替换 AI 供应商和接入本地模型的清晰路径。

架构选择遵循一个约束：只为已经确认的变化方向保留边界，不为未知产品预建分布式系统。

## System shape

```mermaid
flowchart LR
    U["Browser"] -->|HTTPS| P["Caddy / reverse proxy"]
    P --> W["Next.js web"]
    P --> A["FastAPI API"]
    W -->|OpenAPI client| A
    A --> D[("PostgreSQL + pgvector")]
    A --> J["Postgres job/outbox"]
    K["Worker<br/>same backend codebase"] --> J
    K --> D
    A --> G["AI provider ports"]
    K --> G
    G --> Y["Yunwu-compatible API"]
    G -. future .-> L["Local model endpoints"]
```

部署单位包括 `web`、`api`、`worker`、`postgres` 和反向代理。API 与 worker 来自同一后端代码库，因此仍属于模块化单体，不是微服务体系。

## Technology baseline

- **Web**：Next.js App Router、React、TypeScript。
- **API and worker**：Python、FastAPI、Pydantic、SQLAlchemy、Alembic。
- **Database**：PostgreSQL，使用 pgvector 保存 embedding，并结合 PostgreSQL 关键词检索。
- **API contract**：FastAPI 生成 OpenAPI，前端使用生成的 TypeScript client。
- **Deployment**：Docker Compose 部署到单台 Linux 服务器，Caddy 负责 HTTPS 和反向代理。
- **Testing**：前端单元/组件测试、API 单元与集成测试、真实 PostgreSQL 集成测试、Playwright 关键路径测试。
- **Developer commands**：通过仓库根目录的稳定命令统一环境和验证流程。

不在规划文档中锁定精确依赖版本。创建工程骨架时根据官方兼容矩阵固定版本和 lockfile。

## Backend module boundaries

后端按业务能力组织，而不是按 controller/service/repository 技术层平铺：

```text
apps/api/
└── memora/
    ├── identity/       # 登录、会话、密码哈希、当前用户
    ├── workspaces/     # 工作区与成员关系
    ├── memories/       # 追加式记录、分享、删除
    ├── retrieval/      # 权限过滤、关键词/向量召回、排序
    ├── conversations/  # 对话上下文和问题范围
    ├── reports/        # 个人/同事/团队报告编排
    ├── ai/             # ChatModelPort、EmbeddingModelPort 与 adapters
    ├── jobs/           # transactional outbox、重试和状态
    └── shared/         # 少量跨模块基础设施；禁止成为杂物目录
```

模块通过应用服务和明确类型协作。`retrieval` 可以读取已授权的 memory 投影，但 AI adapter 不得直接查询业务表或自行决定权限。

## Core data model

| Entity | Purpose | Important fields |
|---|---|---|
| `users` | 测试账号和身份 | id, email, password_hash, display_name, status |
| `workspaces` | 团队隔离边界 | id, name |
| `workspace_memberships` | 用户与工作区关系 | workspace_id, user_id, role |
| `memories` | 不可原地改写的想法 | id, author_id, workspace_id, body, visibility, created_at, supersedes_id |
| `memory_embeddings` | 可重建的检索投影 | memory_id, model, dimensions, embedding, status |
| `conversations` | Chatbot 会话及默认范围 | id, user_id, workspace_id, scope, created_at |
| `messages` | 问题、回答和生成元数据 | conversation_id, role, content, model, usage |
| `message_citations` | 回答到原记录的可审计引用 | message_id, memory_id, excerpt |
| `jobs` | embedding 等异步任务 | type, payload_ref, status, attempts, next_run_at |
| `audit_events` | 分享、删除和权限相关事件 | actor_id, action, resource_id, created_at |

`memories.visibility` v0.1 只有 `PRIVATE` 和 `WORKSPACE`。未来如果引入群组或点对点分享，必须通过新的 ADR 扩展，不能复用含义模糊的布尔字段。

## Memory lifecycle

1. API 验证当前用户和工作区成员关系。
2. 在同一数据库事务中写入 memory 和 embedding job。
3. 立即向用户返回已保存状态，不等待外部 AI。
4. worker 生成 embedding，记录模型、维度、状态和失败原因。
5. 失败任务按有上限的退避策略重试；记录仍可通过时间线和关键词找到。
6. 补充或修正通过新 memory 表达，并可设置 `supersedes_id`。
7. 删除操作清除正文和 embedding，使其不再进入检索；审计事件不保留正文。

## Authorized retrieval and generation

任何问答或报告都必须执行以下顺序：

```text
authenticate
  → resolve workspace membership
  → resolve requested scope and time range
  → build authorized candidate query
  → hybrid keyword/vector retrieval
  → rerank within authorized candidates
  → construct minimal evidence context
  → generate structured answer and citations
  → verify every citation is still authorized
  → persist answer, citations and usage metadata
```

权限过滤属于数据库查询和应用服务规则，不能依赖“请不要泄露私有记录”一类提示词。建议使用 `workspace_id + author_id + visibility` 明确构造候选集合，并评估 PostgreSQL Row-Level Security 作为纵深防御；RLS 是否在 v0.1 启用需在实现计划中用集成测试验证其复杂度。

## Retrieval strategy

v0.1 使用混合检索：

- PostgreSQL 全文/关键词检索处理明确词语、名称和短语。
- pgvector 处理“类似想法”和表达不同但语义接近的记录。
- 时间、作者、工作区和可见性是硬过滤条件，不是排序提示。
- 返回给模型的每个片段携带稳定 memory ID、作者、时间和可访问链接。
- 变化报告按时间排序证据，要求模型区分延续、改变、矛盾和未知。

embedding 模型切换会改变向量空间。`memory_embeddings` 必须记录模型和维度；迁移时创建可恢复的重建任务，不能混用不同模型的向量进行相似度比较。

M4 的投影列使用 pgvector 可变维度 `vector`，查询必须同时硬过滤模型和维度。四人测试阶段采用精确余弦距离扫描；在真实模型、维度和数据量确定前不创建可能不匹配的近似索引。后续只有在观测到查询性能问题时，才针对确定的模型/维度用表达式或分区索引优化。pgvector 的 [SQLAlchemy 集成](https://github.com/pgvector/pgvector-python#sqlalchemy) 和 [可变维度向量说明](https://github.com/pgvector/pgvector#can-i-store-vectors-with-different-dimensions-in-the-same-column) 是该实现约束的上游依据。

搜索请求使用 `POST /search` 和 JSON body，避免用户的私有搜索词进入反向代理与应用的 URL 访问日志。搜索响应明确标记语义能力为 `AVAILABLE`、`DISABLED` 或 `DEGRADED`；禁用或供应商失败时保留授权关键词结果。

## AI provider boundary

定义两个独立端口：

- `ChatModelPort`：流式或非流式生成、结构化输出、用量和错误归一化。
- `EmbeddingModelPort`：批量 embedding、模型标识、维度和用量。

基础设施 adapter 从环境变量读取 base URL、API Key、模型名、超时和重试配置。领域和应用模块只依赖端口，不引用云雾或任一模型 SDK 的专用类型。

当前兼容 adapter 按 OpenAI 的 [embeddings HTTP 契约](https://developers.openai.com/api/reference/resources/embeddings/methods/create) 发送请求并验证索引、有限浮点向量、模型与用量字段。配置为空时不构造 adapter，也不发起网络请求。

M5 的聊天 adapter 使用供应商兼容的 `v1/chat/completions` 端点；该端点仍被当前 OpenAI 文本模型列为支持的接口，例如 [Chat Latest 模型页](https://developers.openai.com/api/docs/models/chat-latest)。adapter 只负责 HTTP 契约和错误归一化，不读取数据库、不选择证据，也不决定引用。

`POST /chat/questions` 要求客户端显式传入范围和检索主题，问题与主题都放在 JSON body 中。服务端先用统一授权查询生成最多 12 条证据，再结束数据库事务并调用外部模型。模型输入中的 memory 正文被当作不可信数据；返回前重新授权所有证据，若生成期间发生撤回或删除，则丢弃模型答案并用剩余证据重建。无模型配置或供应商失败时使用确定性证据回答；没有证据时明确返回不知道。

回答、模型用量与引用分别写入 `messages` 和 `message_citations`。取消共享会使其他用户依赖该记录的历史回答失效并清空引用；删除会使所有依赖回答失效。这样持久化的旧引用不会在来源变回私有或消失后继续成为可用事实。

云雾公开快速开始文档给出了 OpenAI 兼容 base URL 和模型选择方式，但在实现前仍需用最低权限、最低额度的测试 Key 验证：

- 实际使用的 base URL。
- 聊天模型名称及流式响应兼容性。
- 是否提供满足需求的 embedding endpoint 和 embedding 模型。
- 错误格式、限流响应、用量字段和超时行为。

若聊天和 embedding 不能由同一服务可靠提供，两个端口允许分别配置供应商。未来本地模型只需实现同一端口，不应改变检索权限和产品逻辑。

## Authentication and authorization

- v0.1 由 seed 命令创建四个账号和一个工作区，不开放注册。
- 密码必须使用成熟的慢哈希算法保存，不能明文或可逆加密。
- 浏览器使用 Secure、HttpOnly、SameSite Cookie 会话；公网环境强制 HTTPS。
- 登录、AI 调用和敏感接口设置基础速率限制。
- 作者才可以分享或删除自己的记录。
- 用户只能查询自己的私有记录和工作区共享记录。
- 所有权限规则必须有正向和反向集成测试，尤其验证用户 B 无法通过 ID、搜索、Chatbot、引用 URL 或报告看到用户 A 的私有记录。

## Secrets and configuration

- 仓库提交 `.env.example`，真实 `.env` 和 `.env.*` 被忽略。
- AI Key 只存在于 API/worker 服务端，绝不能使用 `NEXT_PUBLIC_` 暴露。
- 开发、测试和生产使用不同 Key、数据库和会话密钥。
- 云雾控制台若支持额度限制，应为 Memora 创建独立令牌并设置预算/额度。
- 生产部署最终应使用 Docker secret、systemd EnvironmentFile 或托管密钥服务；v0.1 可先使用服务器上权限受限的 `.env`。

## Cost controls

初始预算目标为人民币 1000 元以内，但不是硬性产品约束。

- 记录每次请求的 provider、model、operation、token/usage、延迟和估算成本。
- embedding 只对新记录或明确需要重建的数据执行。
- 检索后只发送最小必要上下文，不把整个知识库发送给模型。
- 为单次报告设置最大检索条数、最大输出和超时。
- 配置软预算告警；达到阈值后提醒管理员，但不在没有产品决定时静默破坏数据写入。

## Deployment and operations

- 单台 Linux 服务器运行 Docker Compose。
- Caddy 自动管理 TLS，数据库不暴露到公网。
- 只暴露 80/443；管理访问使用 SSH 密钥和防火墙限制。
- 每日数据库备份到服务器外的位置，并定期演练恢复。
- 健康检查区分进程存活、数据库可用和 AI provider 降级状态。
- 日志使用结构化字段和 request ID；不得记录 memory 正文、完整提示词、密码、Cookie 或 API Key。
- v0.1 先使用单实例 API/worker。出现真实容量或隔离需求后再评估横向扩展。

## Quality strategy

- 领域单元测试覆盖追加式记录和分享规则。
- PostgreSQL 集成测试覆盖跨用户、跨工作区和删除后的检索隔离。
- AI adapter 使用契约测试和录制的脱敏响应，少量受控测试调用真实中转服务。
- 检索评测集从产品简报中的五类问题演化，记录 expected memory IDs 而不只比较自然语言。
- Playwright 覆盖登录、记录私有想法、主动分享、他人可见、Chatbot 引用和越权不可见。
- CI 必须能在没有真实生产 API Key 时运行；外部 AI 测试单独标记。

## Deferred decisions

- 精确依赖版本和 UI 组件库。
- 聊天与 embedding 的具体模型。
- PostgreSQL RLS 是否作为 v0.1 强制层。
- 报告是否长期保存以及导出格式。
- 备份恢复期和删除数据的备份淘汰策略。
- 域名、服务器发行版和部署供应商。
- 本地模型运行时和硬件规格。
