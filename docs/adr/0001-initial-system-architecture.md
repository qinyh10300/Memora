# ADR-0001: Modular web and AI architecture on PostgreSQL

Status: Accepted

Date: 2026-07-21

## Context

Memora v0.1 需要在一台公网服务器上支持四位测试者记录、分享和通过 AI 检索想法。产品未来可能扩展到其他 AI 产品、更多组织能力和本地模型，但当前需求和团队规模不支持提前承担微服务及专用向量基础设施的成本。

需要同时满足：

- 前后端 Web 产品体验。
- 可靠的权限隔离和可追溯引用。
- 语义检索与按时间总结。
- 外部兼容 API 先行、未来本地模型可替换。
- 清晰、可自动测试、适合 Coding Agent 工作的工程边界。

## Decision

采用以下基线：

1. 使用 monorepo 管理代码和文档。
2. Web 使用 Next.js App Router 和 TypeScript。
3. 后端使用 FastAPI 构建模块化单体，API 与 worker 共用同一 Python 代码库。
4. PostgreSQL 作为唯一事实来源，pgvector 保存向量，PostgreSQL 全文检索参与混合召回。
5. FastAPI 的 OpenAPI 是前后端契约来源，生成 TypeScript client，避免手工复制类型。
6. AI 调用拆分为聊天与 embedding 两个供应商无关端口。
7. 初始使用 Docker Compose 部署在单台 Linux 服务器，Caddy 提供 HTTPS。
8. 使用 PostgreSQL job/outbox 支持 embedding 的可靠重试，v0.1 不引入 Redis 或独立消息队列。

## Why this option

- Python 后端便于后续接入检索、评测和本地模型生态。
- TypeScript/Next.js 适合构建交互式 Web 产品，App Router 是新项目的官方主路径。
- FastAPI 基于 OpenAPI 和 JSON Schema，可自动生成文档与多语言客户端，适合作为前后端边界。
- pgvector 将业务数据、权限条件和向量检索保留在同一事务数据库中，避免早期的数据同步和越权风险。
- 模块化单体能保留清晰领域边界，同时让部署、调试、迁移和 Agent 验证保持简单。

## Alternatives considered

### Full-stack Next.js only

优点是单语言、初期文件更少。没有采用的主要原因是本项目明确需要演进 AI 检索、评测和本地模型能力，独立 Python 后端提供更清晰的长期边界。代价是需要维护 TypeScript 和 Python 两套工具链，因此必须依靠 OpenAPI 生成客户端和统一命令降低复杂度。

### Microservices from the start

可以独立扩展身份、检索和 AI 服务，但四人测试阶段会引入服务发现、分布式追踪、跨服务事务和更多部署失败面。当前没有真实负载或组织边界证明这些成本合理。

### Dedicated vector database

专用向量数据库可能在超大规模检索下更有优势，但 v0.1 更需要与工作区和可见性条件安全联查。PostgreSQL + pgvector 已支持精确和近似向量搜索，并保留关系数据库事务能力。

### Provider-specific AI SDK throughout the codebase

开发起步可能更快，但会把中转站响应、模型名称和本地模型迁移成本扩散到领域代码，因此只允许在 adapter 内使用供应商专用 SDK 或协议。

## Consequences

### Positive

- 单服务器即可完整运行和备份。
- 关键权限规则可以在真实数据库中进行端到端测试。
- AI 供应商切换范围被限制在 adapter 与配置层。
- 前后端契约可生成、可审查并纳入 CI。
- 将来可以按实际瓶颈拆分 worker 或检索服务，而无需现在支付分布式成本。

### Negative

- 团队需要维护 Python 与 TypeScript 两套依赖和开发环境。
- worker 与 API 共用代码库，需要严格模块边界避免后台任务绕过应用规则。
- pgvector 索引和 embedding 模型迁移需要专门运维流程。
- 单服务器不是高可用架构，服务器故障会导致服务中断。

## Revisit triggers

出现以下证据时重新评估：

- 单库检索性能无法满足经测量的延迟目标。
- AI worker 负载影响 API 可用性，需要独立扩展或隔离。
- 新产品与 Memora 存在真正独立的发布周期或团队所有权。
- 企业合规要求强制本地模型、数据驻留或更严格租户隔离。
- 单服务器恢复时间不能满足正式商业 SLA。

## References

- Next.js App Router: https://nextjs.org/docs/app
- FastAPI features and OpenAPI: https://fastapi.tiangolo.com/features/
- pgvector: https://github.com/pgvector/pgvector
- Yunwu API quick start: https://s.apifox.cn/apidoc/docs-site/5427167/doc-5459030
