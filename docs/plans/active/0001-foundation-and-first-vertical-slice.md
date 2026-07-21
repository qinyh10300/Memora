# Foundation and first vertical slice

Status: in-progress

Owner: product team and coding agent

Last updated: 2026-07-21

## Outcome

将空仓库建设为可在本地和单台公网服务器运行的 Memora v0.1 基础，并交付一个最小端到端闭环：预置用户登录，记录默认私有的纯文本想法，主动共享给工作区，其他成员只能在授权后看到，并通过 Chatbot 获得带原记录引用的回答。

产品简报和 ADR 已于 2026-07-21 获得批准，M1 工程骨架已通过本地容器验收，下一步进入 M2 身份边界。

## Context and evidence

- 产品规则：`docs/product/brief.md`
- 系统架构：`docs/architecture/overview.md`
- 架构决策：`docs/adr/0001-initial-system-architecture.md`
- 仓库协作：`AGENTS.md`
- 已确认外部约束：四人、公网单服务器、纯文本、默认私有、外部 AI 可用、未来本地模型。

## Scope

### In scope

- monorepo 工程骨架和统一开发命令。
- Next.js Web、FastAPI API/worker、PostgreSQL/pgvector 和本地 Docker Compose。
- 四个 seed 用户、一个测试工作区、安全 Cookie 登录。
- 追加式 memory 创建、列表、详情、分享和删除。
- 可靠 embedding job、混合检索和供应商 adapter。
- Chatbot 个人/工作区范围、时间过滤、引用与证据不足行为。
- 基础个人/团队按需报告能力。
- 权限集成测试、RAG 评测起点、关键 Playwright 路径。
- 单服务器 HTTPS 部署、备份、健康检查和基础用量记录。

### Non-goals

- `docs/product/brief.md` 中列出的所有 v0.1 非目标。
- 通用 AI 产品平台、微服务和 Kubernetes。
- 没有真实使用证据支持的抽象和性能优化。

## Assumptions and open questions

- [x] 批准产品简报、架构 overview 和 ADR-0001。
- [ ] 提供四个测试账号的显示名和邮箱；初始密码通过安全渠道分发。
- [ ] 确定服务器 Linux 发行版、SSH 访问、域名和 DNS 控制权。
- [ ] 在云雾控制台创建 Memora 专用低额度测试 Key，不把 Key 发到聊天或提交 Git。
- [ ] 验证云雾实际 base URL、聊天模型、流式协议、embedding endpoint 和模型。
- [ ] 确定删除后的备份保留策略。
- [ ] 确定报告默认时间范围；在此之前 UI 必须要求用户选择范围。
- [ ] 决定 v0.1 是否启用 PostgreSQL RLS 作为纵深防御。

## Design and boundaries

- 以前后端 OpenAPI 契约和授权检索流水线为关键系统边界。
- 所有 AI 上下文由 retrieval 应用服务生成，adapter 不直接读取数据库。
- memory 写入与 job 创建同事务；外部 AI 调用不参与数据库事务。
- 先实现一个端到端用户路径，再增加报告和运维能力。
- 真实外部 AI 测试与离线 CI 分离，CI 使用 fake/contract adapter。

## Milestones

- [x] **M0 — Planning approval**：产品、架构、ADR 和活动计划获批准。验证：用户已明确批准进入 M1。
- [x] **M1 — Reproducible foundation**：本地一条命令启动 Web、API、worker 和数据库，`make check` 可在无真实 AI Key 时通过。
- [ ] **M2 — Identity boundary**：四个 seed 用户能登录；未登录和跨用户访问被拒绝。验证：API 集成测试和浏览器登录测试。
- [ ] **M3 — Private capture and sharing**：用户创建、浏览、补充、分享、取消分享和删除纯文本 memory；默认私有。验证：跨用户矩阵测试。
- [ ] **M4 — Reliable retrieval projection**：创建记录不等待 embedding，job 可重试，关键词和向量检索只返回授权记录。验证：真实 PostgreSQL 故障/重试测试和 expected memory ID 评测。
- [ ] **M5 — Cited chatbot slice**：用户能询问过去或类似想法，回答含可打开的引用；证据不足时明确说明。验证：产品简报代表问题和越权提示测试。
- [ ] **M6 — On-demand reports**：生成个人、同事和团队时间段报告，严格遵守共享范围。验证：固定数据集和人工有用性检查。
- [ ] **M7 — Public test deployment**：四人通过 HTTPS 使用测试环境，完成备份恢复演练和基础监控。验证：部署 smoke test、恢复记录和密钥扫描。

## Acceptance criteria

- [ ] 新记录始终默认为私有，且共享必须由作者显式触发。
- [ ] 用户 B 在任何接口中都无法发现用户 A 私有记录的正文或片段。
- [ ] 五类代表问题均返回来源，或明确说明没有足够证据。
- [ ] AI provider 不可用时记录不丢失，失败状态可见且可重试。
- [ ] 删除正文和 embedding 后，检索、引用和新报告不再返回该内容。
- [ ] 本地开发、CI 和公网部署均有可复现命令和文档。
- [ ] 四人两周测试所需的基本使用和用量指标可获取，但日志不保存私有正文。

## Verification

- 自动化：格式、lint、TypeScript/Python 类型检查、单元测试、构建。
- 集成：真实 PostgreSQL + pgvector、迁移、权限矩阵、job 重试、删除传播。
- 契约：OpenAPI diff、生成客户端、AI adapter 脱敏契约测试。
- 端到端：登录、私有记录、分享、跨用户可见、Chatbot 引用、取消分享。
- 安全：密钥扫描、依赖扫描、Cookie/HTTPS 检查、越权 ID 和提示注入测试。
- 部署：健康检查、数据库备份与恢复、AI 降级和请求用量观测。

## Rollout and recovery

- 首先只部署测试工作区和四个账号，不迁移真实生产数据。
- 数据库迁移在备份后执行，并记录当前 schema revision。
- AI 供应商变更通过配置和 adapter 完成；embedding 模型变化通过可重启的重建 job 处理。
- 部署失败时回退应用镜像；涉及不可逆 schema 变化时使用向前修复并从已验证备份恢复。

## Progress log

- 2026-07-21：完成产品访谈第一阶段，确认核心闭环、隐私边界、纯文本范围和四人测试方案。
- 2026-07-21：提出模块化单体、PostgreSQL/pgvector、可替换 AI provider 和单服务器部署方案。
- 2026-07-21：用户批准 M0，开始实施 M1 可复现工程骨架。
- 2026-07-21：完成 Next.js Web 骨架，格式、lint、类型检查、2 个测试和生产构建通过。
- 2026-07-21：完成 FastAPI、worker、Alembic 与 OpenAPI 骨架，严格 MyPy、6 个测试、离线迁移和真实健康请求通过。
- 2026-07-21：完成 Makefile、Docker Compose、Caddy、容器 smoke test 脚本和两阶段 CI 配置。本机没有 Docker CLI，容器构建与 Compose 运行等待 CI 或具备 Docker 的环境验证后再勾选 M1。
- 2026-07-21：最终 `make check` 通过，包括 2 个 Web 测试、10 个 API 测试、格式、lint、严格类型检查、OpenAPI 漂移检查和 Next.js 生产构建；生产配置会拒绝占位或少于 32 字符的会话密钥。
- 2026-07-21：在 Apple Silicon macOS 上安装 Docker CLI、Compose、Buildx 与 Colima，完整构建并启动 6 个 Compose 服务；迁移 `20260721_0001`、pgvector 0.8.5、Web/API/ready 路由和 `make e2e` 均通过，M1 验收完成。

## Decision log

- 2026-07-21：默认私有、主动共享；原因是个人记忆与团队共享需要显式信任边界。
- 2026-07-21：正文追加而非原地编辑；原因是观点变化分析依赖时间真实性。
- 2026-07-21：先模块化单体而非微服务；原因是当前规模需要更低部署和验证复杂度。
- 2026-07-21：将减少会议时间作为长期指标；两周四人测试先验证持续记录、检索可信和总结有用。

## Completion summary

M0 和 M1 已完成。仓库具备可复现的本地工程基础、离线质量门禁、OpenAPI 漂移检查、容器构建、真实 PostgreSQL/pgvector 迁移和同源 Web/API smoke test。当前计划继续执行，下一里程碑为 M2 四个预置账号与身份权限边界；公网 HTTPS、备份恢复和真实 AI 供应商验证仍属于后续里程碑。
