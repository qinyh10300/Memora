# Foundation and first vertical slice

Status: in-progress

Owner: product team and coding agent

Last updated: 2026-07-22

## Outcome

将空仓库建设为可在本地和单台公网服务器运行的 Memora v0.1 基础，并交付一个最小端到端闭环：预置用户登录，记录默认私有的纯文本想法，主动共享给工作区，其他成员只能在授权后看到，并通过 Chatbot 获得带原记录引用的回答。

产品简报和 ADR 已于 2026-07-21 获得批准，M1 至 M6 本地第一版均已通过离线测试、真实 PostgreSQL/pgvector、完整 Docker Compose 和浏览器验收。M7 公网测试等待服务器、域名、生产凭据和专用 AI Key。

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
- [x] 在真实名单确定前使用四个可由环境变量覆盖的 seed 账号；生产初始密码只通过服务器环境变量注入。
- [ ] 确定服务器 Linux 发行版、SSH 访问、域名和 DNS 控制权。
- [ ] 在云雾控制台创建 Memora 专用低额度测试 Key，不把 Key 发到聊天或提交 Git。
- [ ] 验证云雾实际 base URL、聊天模型、流式协议、embedding endpoint 和模型。
- [ ] 确定删除后的备份保留策略。
- [x] v0.1 报告不猜测默认范围，UI 和 API 都要求显式时间范围。
- [x] v0.1 暂不启用 PostgreSQL RLS；统一授权查询和真实 PostgreSQL 反向测试是主边界，获得更复杂租户需求后再评估 RLS。

## Design and boundaries

- 以前后端 OpenAPI 契约和授权检索流水线为关键系统边界。
- 所有 AI 上下文由 retrieval 应用服务生成，adapter 不直接读取数据库。
- memory 写入与 job 创建同事务；外部 AI 调用不参与数据库事务。
- 先实现一个端到端用户路径，再增加报告和运维能力。
- 真实外部 AI 测试与离线 CI 分离，CI 使用 fake/contract adapter。
- 身份使用数据库持久化的随机不透明会话；浏览器只持有 HttpOnly、SameSite Cookie，数据库只保存带服务端密钥的 token 摘要。
- 密码使用 Argon2 慢哈希；四个 seed 账号默认值只服务本地开发，生产环境拒绝本地占位密码。
- Web 只通过同源 `/api` 和 OpenAPI 生成类型调用后端，不在客户端复制领域请求模型。

## Milestones

- [x] **M0 — Planning approval**：产品、架构、ADR 和活动计划获批准。验证：用户已明确批准进入 M1。
- [x] **M1 — Reproducible foundation**：本地一条命令启动 Web、API、worker 和数据库，`make check` 可在无真实 AI Key 时通过。
- [x] **M2 — Identity boundary**：四个 seed 用户能登录；未登录和跨用户访问被拒绝。验证：15 个 API 测试、真实 PostgreSQL 会话验证和浏览器登录/恢复/退出测试。
- [x] **M3 — Private capture and sharing**：用户创建、浏览、补充、分享、取消分享和删除纯文本 memory；默认私有。验证：跨用户矩阵测试、真实 PostgreSQL E2E 和浏览器交互测试。
- [x] **M4 — Reliable retrieval projection**：创建记录不等待 embedding，job 可重试，关键词和向量检索只返回授权记录。验证：32 个 API 测试、真实 PostgreSQL/pgvector 反向权限查询、Docker worker 降级 E2E 和浏览器检索验收。
- [x] **M5 — Cited chatbot slice**：用户能询问过去或类似想法，回答含可打开的引用；证据不足时明确说明。验证：41 个 API 测试、外部模型最小证据捕获测试、真实 PostgreSQL 撤回引用检查、Docker E2E 和浏览器引用跳转。
- [x] **M6 — On-demand reports**：生成个人、同事和团队时间段报告，严格遵守共享范围。验证：45 个 API 测试、固定权限数据集、Docker E2E、10 个 Web 测试和浏览器人工检查。
- [ ] **M7 — Public test deployment**：四人通过 HTTPS 使用测试环境，完成备份恢复演练和基础监控。验证：部署 smoke test、恢复记录和密钥扫描。

## Acceptance criteria

- [x] 新记录始终默认为私有，且共享必须由作者显式触发。
- [x] 用户 B 在任何已实现的记录接口中都无法发现用户 A 私有记录的正文、片段或补充目标 ID；搜索、Chatbot 和报告将在各自里程碑继续验证。
- [x] 五类代表问题均返回来源，或明确说明没有足够证据；M5 覆盖问题 1、2、4，M6 覆盖问题 3、5。
- [x] AI provider 不可用时记录不丢失，失败状态可见且可重试。
- [x] 删除正文和 embedding 后，检索、引用和新报告不再返回该内容。
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
- `20260722_0003` 只新增 memories、jobs、audit_events 与索引，旧版 M2 应用可在保留新表时回退；其 Alembic downgrade 会删除记录数据，只用于空测试库，不作为生产回滚手段。已有数据环境优先回退应用镜像、保留 schema 并向前修复，必要时从迁移前备份恢复。
- `20260722_0004` 增加可重建的 `memory_embeddings` 投影及 job 租约字段，并为活动记录回填待处理状态。旧版 M3 应用可忽略新增表/列；生产回滚优先回退应用并保留 schema。downgrade 会丢弃向量投影，只能通过正文重建，不影响 memory 事实数据。
- `20260722_0005` 增加 conversations、messages 和 message_citations。旧版 M4 可忽略新增表；downgrade 会删除对话历史和引用，但不影响原始 memory。生产环境优先回退应用并保留表，以免丢失审计线索。
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
- 2026-07-22：开始 M2–M6 第一版连续交付；确定 seed 账号、Argon2、数据库不透明会话、统一授权查询和显式报告时间范围。
- 2026-07-22：完成 M2。四个可配置 seed 用户写入真实 PostgreSQL，密码使用 Argon2，不透明会话仅在数据库保存摘要，登录限流与即时注销生效；OpenAPI 生成 TypeScript 客户端并由 Web 同源调用。
- 2026-07-22：完成 M2 浏览器验收。Alex 登录后显示四位成员，刷新恢复会话，退出后回到登录页，浏览器控制台无错误；`make check` 覆盖 4 个 Web 测试和 15 个 API 测试。
- 2026-07-22：完成 M3 数据与权限边界。迁移 `20260722_0003` 增加追加式 memories、embedding outbox jobs 和不含正文的 audit events；创建、列表、详情、补充、分享、取消共享和删除 API 统一使用工作区与可见性过滤。
- 2026-07-22：真实 PostgreSQL 首次 E2E 暴露出无 ORM relationship 时 job 可能先于 memory flush 的外键错误。实现改为同一事务中先 flush memory 再写 outbox，并强制 SQLite 测试启用外键，防止数据库差异再次漏检。
- 2026-07-22：完成 M3 浏览器验收。新记录显示“仅自己”，作者主动分享后 Blair 可见且没有作者操作，取消共享立即生效，删除要求二次确认；真实 PostgreSQL `make e2e` 和浏览器控制台检查均通过。
- 2026-07-22：完成 M4 AI 供应商边界、可靠 worker 和检索投影。记录与 job 同事务提交，worker 使用行锁、失效租约恢复和有上限退避；空模型配置进入 `WAITING_CONFIGURATION`，外部失败不阻塞记录写入。
- 2026-07-22：真实 Docker worker 首次运行暴露独立进程没有加载完整 ORM metadata，外键排序失败。增加显式模型注册入口供 API、worker 和 Alembic 共用，避免测试进程的偶然 import 顺序掩盖问题。
- 2026-07-22：将搜索从 GET query 改为 POST JSON，避免私有搜索词出现在 Uvicorn/Caddy URL 日志。真实 PostgreSQL/pgvector 反向测试确认 Blair 只能召回 Alex 共享向量，私有向量泄露为零；浏览器验证了待配置状态和关键词降级。
- 2026-07-22：完成 M5 显式范围 Chat。个人范围可引用自己的私有记录，同事范围强制目标成员且只读取共享记录，工作区范围只使用当前用户已授权的集合；模糊主题或缺失的“这段时间”范围会要求补充。
- 2026-07-22：加入兼容 Chat Completions adapter、最小证据上下文、提示注入边界和生成后再次授权。无 Key 或供应商错误时使用确定性带引用回答，证据为空时明确不知道；访问日志只显示 POST 路径，不包含问题或主题。
- 2026-07-22：取消共享会失效其他用户依赖该来源的历史回答，删除会失效所有依赖回答并清空引用。真实 PostgreSQL 检查确认已删除或已转私有的跨用户 dangling citation 为零；浏览器验证了作者、时间、摘录和原记录锚点。
- 2026-07-22：完成 M6 显式时间段报告。个人报告读取自己的全部记录，同事报告只读取目标成员共享内容，团队报告只读取所有成员共享内容，刻意排除当前用户自己的私有记录。
- 2026-07-22：报告固定返回时间线、延续、变化、矛盾和证据缺口，基础模式不将文本差异自动解释为观点改变。外部模型只增强摘要，生成后再次按相同范围授权；报告本身不持久化，只记录不含正文的审计事件。
- 2026-07-22：真实 Docker E2E 验证个人私有报告、未共享同事零证据、共享团队报告五段结构和取消共享后零引用。浏览器用两条私有记录验证快速时间范围、作者计数、五段报告和可打开来源，并清理验收数据。

## Decision log

- 2026-07-21：默认私有、主动共享；原因是个人记忆与团队共享需要显式信任边界。
- 2026-07-21：正文追加而非原地编辑；原因是观点变化分析依赖时间真实性。
- 2026-07-21：先模块化单体而非微服务；原因是当前规模需要更低部署和验证复杂度。
- 2026-07-21：将减少会议时间作为长期指标；两周四人测试先验证持续记录、检索可信和总结有用。
- 2026-07-22：v0.1 不启用 RLS；原因是当前单工作区规模下，集中授权查询加真实数据库反向测试更容易审计，RLS 保留为企业隔离增强而非替代应用授权。
- 2026-07-22：使用服务端数据库会话而非 JWT；原因是四人单体产品更需要即时注销、可审计和简单撤销，而不需要跨服务无状态令牌。
- 2026-07-22：M4 使用可变维度 pgvector 列与精确扫描；原因是外部 embedding 模型尚未验证，必须先按模型和维度隔离，避免提前锁定错误的索引维度。
- 2026-07-22：搜索使用 POST JSON；原因是搜索问题本身可能是个人私密上下文，不应出现在 URL、浏览器历史和默认访问日志。
- 2026-07-22：Chat 要求显式 scope 和 topic；原因是产品不能可靠猜测“这个”“类似”或“同事”指代，错误扩大范围比多一个输入字段风险更高。
- 2026-07-22：无模型配置时仍提供确定性证据回答；原因是第一版必须可离线验收，同时让模型流畅度不成为引用和权限正确性的前置条件。
- 2026-07-22：团队报告只包含 `WORKSPACE` 记录；原因是团队报告可能被当成可共享产物，不能把生成者自己的私有内容静默混入团队叙事。
- 2026-07-22：第一版报告不持久化和导出；原因是按需查看已满足四人验证闭环，长期保存会引入来源撤回、文件权限和删除传播的新生命周期。

## Completion summary

M0 至 M6 的本地第一版已完成。仓库具备可复现的本地工程基础、四个预置账号、默认私有的追加式记录、主动分享/取消共享、可靠 embedding worker、授权混合检索、显式范围且带可撤回引用的 Chatbot、个人/同事/团队证据报告、OpenAPI 生成客户端，以及真实 PostgreSQL 和同源浏览器验收。M7 公网 HTTPS、备份恢复和真实 AI 供应商验证需要服务器、域名、生产凭据和专用 Key，当前未擅自部署。
