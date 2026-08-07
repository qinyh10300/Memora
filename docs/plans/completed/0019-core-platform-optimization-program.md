# Memora core platform optimization program

Status: completed

Owner: Codex

Last updated: 2026-08-07

## Outcome

在不改变 Memora 当前产品定位、黑色主视觉、模块化单体部署和隐私规则的前提下，完成一轮
可量化、可回滚的核心升级：检索结果更准确且可解释，Chatbot 具备受控 Agent 执行能力，
前端可以按业务模块持续演进，PDF 等文档能可靠转化为带页码引用的记忆草稿，并且关键用户
路径具备浏览器级回归、运行指标、备份恢复和部署回滚证据。

本计划同时是开发文档和执行清单。只有代码、自动化测试与适当层级的运行验证均完成后，
对应任务才允许从 `[ ]` 改为 `[x]`。

## Context and evidence

### Product and architecture rules

- 产品规则以 `docs/product/brief.md` 为准；本轮不扩展为通用网盘、通用代码代理或企业级
  多租户平台。
- `docs/architecture/overview.md` 和 ADR-0001 要求继续使用模块化单体、Next.js、FastAPI、
  PostgreSQL 与 pgvector，不为假设性的规模拆分微服务。
- ADR-0003 要求正式记忆保持追加式修订；文档解析或 Agent 都只能先修改草稿，不能静默
  覆盖已保存记忆。
- ADR-0005 要求检索先应用身份、workspace、作者与 visibility 过滤，再执行召回和排序。
- 聊天模型和 embedding 模型继续通过独立、可替换的端口调用，不让领域逻辑依赖具体供应商
  SDK。

### Current code facts

- `apps/api/src/memora/retrieval/service.py` 的关键词检索主要依赖 `icontains`，混合排序使用
  简单分数合并；还没有固定评测集、RRF、全文检索排名或检索解释记录。
- `apps/api/src/memora/api/drafts.py` 同时承担请求校验、附件读取、工具循环、草稿更新和响应
  组装，核心聊天路径超过两千行，继续增加工具会放大回归风险。
- `apps/web/src/app/page.tsx` 超过五千行，`HomePage` 接近一千行；`globals.css` 超过七千行，
  工作台布局、业务状态和视觉规则彼此耦合。
- PDF 当前只抽取有限文本进入单轮上下文，还没有异步解析状态、页级分块、OCR、重试和
  用户确认入库闭环。
- 现有 `scripts/e2e_smoke.py` 主要覆盖 API，缺少稳定的真实浏览器主路径；运行时也缺少统一
  request ID、Agent trace、AI 延迟/错误/用量指标和自动恢复演练。

## Scope

### In scope

- 建立离线、确定性的检索质量、引用正确性与权限泄漏评测。
- 使用 PostgreSQL 全文检索、trigram 和 pgvector 构建授权后的混合召回，并以 RRF 排序；
  在有明确收益时增加可关闭的 reranker。
- 为每次检索保留不含私有正文的诊断信息：采用了哪些召回器、候选数量、过滤阶段、最终
  引用原因和耗时。
- 从现有草稿聊天路径提炼 planner、tool registry、执行状态机、事件流和模型路由器。
- 保留当前 API 兼容性，同时让 Web 能消费规范化的 Agent 事件并展示真实工作进度。
- 按 capture、library、team、settings、workspaces 和 workbench 垂直切片拆分前端。
- 构建异步 PDF 解析、必要时 OCR、页/标题/章节分块、页级引用、重试和确认保存闭环。
- 建立 Playwright 浏览器回归、请求追踪、AI 指标、前端错误采集、数据库备份恢复和部署
  回滚演练。

### Non-goals

- 不公开模型隐藏推理或声称展示完整思维链；前端只展示可审计的计划、工具调用、状态、
  来源和结果摘要。
- 不引入第二个向量数据库，不把 PostgreSQL 事实数据复制到未经授权的新检索系统。
- 不拆分微服务，不引入 Kubernetes，也不为当前规模建设分布式工作流平台。
- 不一次性重写整个 Web 或 API；所有重构保持可运行并按垂直切片迁移。
- 不让 Agent 自主扩大 workspace、visibility、作者或保存权限。
- 不在没有真实召回收益和延迟预算证据时默认启用昂贵 reranker 或 OCR。

## Assumptions and open questions

- [x] 继续以 PostgreSQL/pgvector 为唯一事实来源和向量检索存储。
- [x] 检索质量先建立评测基线，再改变排名算法。
- [x] Agent UI 展示可审计过程事件，不展示隐藏思维链。
- [x] 正式记忆仍需用户明确保存；解析结果先进入可编辑草稿。
- [x] 用固定评测集确认中文全文检索配置应采用内置 `simple` 配置、trigram 补充，还是需要
  额外分词扩展；第一版不得依赖数据库镜像中不存在的扩展。
- [x] 用基准数据决定 reranker 是否进入默认路径；没有显著质量收益时保持关闭。
- [x] 用真实文档样本确认 OCR 的默认触发阈值和单文档资源上限。
- [x] 在部署环境确认错误监控接收端；未配置外部接收端时保留本地结构化日志与健康指标。

## Design and boundaries

### Authorized retrieval pipeline

检索始终按以下顺序执行：

1. 从已认证 `Principal` 生成 workspace、membership、author、visibility、deleted 和 timeline
   过滤条件。
2. 只在该授权关系中运行全文、trigram、标题和向量召回，不允许先全库召回再在 Python 中
   过滤。
3. 各召回器返回候选排名；RRF 只融合已授权列表，不以不可比较的原始分数直接相加。
4. 可选 reranker 只能看到授权后的最小候选内容，并受超时、数量和失败降级约束。
5. 生成前和引用持久化前再次验证来源仍可访问；取消共享或删除继续使历史引用失效。

### Agent execution model

Agent Runtime 使用显式状态而不是把所有逻辑塞进单次路由调用：

`RECEIVED -> PLANNING -> TOOL_PENDING -> TOOL_RUNNING -> MODEL_RUNNING -> COMPLETED`

任一步都可以进入 `FAILED`、`CANCELLED` 或受控 `DEGRADED`。每个事件包含执行 ID、事件
序号、公开状态、工具名、耗时和安全摘要；不包含隐藏推理、密钥、PDF 原文或私有提示词。
工具参数由 schema 校验，身份、workspace、visibility 和保存意图由服务端注入或裁决。

### Frontend migration strategy

前端按业务能力逐块迁移，旧页面在每个阶段仍可构建和运行。共享设计 token、图标按钮、
拖动布局和响应式断点留在 workbench/design-system 层；数据请求、缓存 key 与 mutation
失效规则集中管理；复杂草稿/执行状态迁到 reducer 或显式状态机，避免继续增加散落的
`useState`。

### Document lifecycle

上传资产与正式记忆分离。PDF 进入受保护资产后创建解析作业，保存页码、章节、文本质量和
错误状态；解析结果可被当前用户预览、重试并生成 Markdown 草稿。只有明确保存动作才创建
正式 `Memory`，并通过可追溯引用连接回资产页码。解析或 embedding 失败不能丢失原资产和
草稿。

### Reliability and privacy

- 日志、指标和 trace 只记录 ID、枚举状态、耗时、大小、token 与费用估算，不记录私有正文。
- request ID 在 Web/API/worker/AI adapter 间传播；Agent execution ID 连接同一轮工具事件。
- PostgreSQL 备份需包含事实数据、受保护 `BYTEA` 资产和迁移版本；恢复演练在隔离数据库
  执行，不用生产库做破坏性验证。
- 任何 schema 变更优先向前兼容；应用回滚保留新增表列，数据修复优先向前迁移。

## Milestones and checklist

### M0 - Program baseline and guardrails

- [x] **M0.1** 创建本开发文档，记录范围、顺序、边界、验收和回滚原则。
- [x] **M0.2** 记录当前自动化测试数量、关键文件规模、检索实现和本地运行基线。
- [x] **M0.3** 建立机器可运行的分层命令，能分别执行检索评测、API 测试、Web 测试、浏览器
  E2E 和完整检查。
- [x] **M0.4** 确认后续迁移编号、当前 PostgreSQL 扩展和测试数据库能力，避免 SQLite 单测
  掩盖 PostgreSQL 行为差异。

验证：开发文档可在本地读取；基线命令和结果写入本计划 Progress log。

### M1 - Retrieval evaluation baseline

- [x] **M1.1** 定义版本化评测案例 schema，覆盖 query、scope、时间、期望来源、禁止来源、
  引用要求和最小证据行为。
- [x] **M1.2** 建立不含真实用户正文的代表性中文数据集，覆盖标题、同义表达、错别字、时间、
  个人/团队和删除/取消共享。
- [x] **M1.3** 实现确定性评测 runner，输出 Recall@K、MRR、nDCG、citation precision、
  unauthorized candidate count 和 no-evidence accuracy。
- [x] **M1.4** 为评测 runner 添加单元测试、固定 JSON 报告和失败阈值；默认离线运行。
- [x] **M1.5** 运行现有算法并记录基线，不为得到漂亮数字修改期望答案。

验证：`make eval-retrieval`；评测报告不包含真实用户数据；权限泄漏计数必须为零。

### M2 - Retrieval quality and explainability

- [x] **M2.1** 增加 PostgreSQL 全文检索/trigram 所需迁移、索引和兼容回滚说明。
- [x] **M2.2** 将关键词召回升级为标题加权全文检索，并用 trigram 处理部分匹配与轻微拼写
  偏差；纯筛选查询保持稳定。
- [x] **M2.3** 为全文、标题、trigram 和 semantic 候选实现 RRF，保留稳定 tie-break 和分页
  行为。
- [x] **M2.4** 增加可配置、可超时、失败可降级的 reranker 端口；仅在评测证明有收益时默认
  启用。
- [x] **M2.5** 返回并记录安全的检索解释：召回器、rank、融合分数、候选数量、过滤和耗时。
- [x] **M2.6** 增加跨用户、跨 workspace、待审核成员、取消共享、删除和提示注入回归测试。
- [x] **M2.7** 对比 M1 基线；质量指标达到约定阈值且 unauthorized candidate count 仍为零。

验证：`make eval-retrieval`、API 测试、真实 PostgreSQL/pgvector 权限反向测试和迁移升降级。

### M3 - Agent Runtime and model routing

- [x] **M3.1** 用 characterization tests 锁定当前草稿聊天、PDF、联网、保存意图和错误降级
  行为。
- [x] **M3.2** 提炼类型化 tool registry，统一工具 schema、权限策略、超时、重试和安全结果。
- [x] **M3.3** 提炼执行状态机与持久化/可恢复 execution record，生成有序公开事件。
- [x] **M3.4** 提炼 planner，让计划只表达可公开任务步骤，不保存或暴露隐藏推理。
- [x] **M3.5** 实现 model router，按 chat/vision/web/tool 能力、超时、成本预算和降级顺序
  选择 GPT、Claude 或 Gemini 配置。
- [x] **M3.6** 支持客户端取消、工具失败重试边界、幂等保存和断线后的事件恢复。
- [x] **M3.7** 保持现有 API 兼容，增加流式事件契约并重新生成 Web 客户端。
- [x] **M3.8** 用集成测试验证模型不可用、工具拒绝、重复请求、超时和权限撤回。

验证：API 测试、OpenAPI 漂移检查、fake provider 完整执行流和至少一次受控真实 provider
smoke test（仅在安全测试 Key 可用时）。

### M4 - Frontend modularization and interaction state

- [x] **M4.1** 建立 design tokens 与 workbench 布局层，保持当前黑色主视觉和 PC 布局像素级
  稳定。
- [x] **M4.2** 抽离 `features/capture`，包含 composer、附件、模型选择与发送状态。
- [x] **M4.3** 抽离 `features/library`，包含个人/团队检索、筛选、结果与详情。
- [x] **M4.4** 抽离 `features/team`、`features/settings` 和 `features/workspaces`。
- [x] **M4.5** 将草稿与 Agent 事件迁入 reducer/状态机，覆盖取消、重试、断线恢复和保存回执。
- [x] **M4.6** 统一 server-state query/cache、错误模型、mutation 失效和乐观更新边界。
- [x] **M4.7** 拆分全局 CSS 为 token、workbench 和 feature 样式，去除泄漏的全局选择器。
- [x] **M4.8** 验证左/中/右面板拖动到隐藏、键盘操作、焦点、reduced motion、移动端抽屉和
  桌面布局不回归。

验证：Web 单元/组件测试、生产构建、Playwright 桌面与移动截图、拖动及键盘交互。

### M5 - Document-to-memory pipeline

- [x] **M5.1** 设计解析作业、页、chunk、citation 和状态数据模型，迁移保持资产读取兼容。
- [x] **M5.2** 将 PDF 文本抽取移入可重试 worker，限制文件大小、页数、执行时间和并发。
- [x] **M5.3** 以页码、标题和章节边界分块，保留字符范围、页码与资产来源。
- [x] **M5.4** 对低文本质量页面按需触发 OCR；没有 OCR 运行时给出可操作的降级信息。
- [x] **M5.5** 在 Web 展示上传、排队、解析、OCR、完成和失败状态，支持取消与重试。
- [x] **M5.6** 让 Agent 检索文档 chunk 并生成带页码引用的 Markdown 草稿。
- [x] **M5.7** 用户确认后才把草稿保存为正式记忆，并保留可授权验证的页级引用。
- [x] **M5.8** 验证删除资产、移除成员、取消共享和解析失败不会留下可访问的孤立正文或向量。

验证：数字 PDF、扫描 PDF、混合页面、损坏文件、超限文件、跨用户访问与删除传播测试。

### M6 - Production reliability and browser coverage

- [x] **M6.1** 增加 request ID 中间件与传播，连接 API、worker、Agent execution 和 provider
  调用。
- [x] **M6.2** 增加结构化指标：请求延迟/错误、AI 延迟/错误/token/费用估算、工具耗时、
  解析队列、检索候选与降级率。
- [x] **M6.3** 增加脱敏结构化日志和本地 metrics endpoint；配置外部接收端时不改变领域逻辑。
- [x] **M6.4** 接入前端 error boundary、错误上报适配器和用户可恢复状态。
- [x] **M6.5** 建立 Playwright 主路径：注册/登录、上传 PDF、聊天、工具事件、确认保存、检索、
  团队权限和移动端。
- [x] **M6.6** 建立 PostgreSQL 自动备份脚本、保留策略、校验和与隔离恢复脚本。
- [x] **M6.7** 完成一次备份恢复演练，验证用户、workspace、记忆、资产、引用和 migration
  revision。
- [x] **M6.8** 文档化并演练应用回滚；迁移后的 schema 保留，失败优先回退应用并向前修复。

验证：浏览器 E2E、指标 smoke test、日志敏感信息测试、备份校验、隔离恢复和回滚记录。

### M7 - Final integration and closeout

- [x] **M7.1** 运行 `make check`、`make test`、`make e2e`、`make eval-retrieval` 和浏览器 E2E。
- [x] **M7.2** 对身份、workspace、可见性、引用、资产和 Agent 工具做独立权限审查。
- [x] **M7.3** 记录桌面/移动性能基线、API/检索延迟和资源上限，解决阻塞性回归。
- [x] **M7.4** 复查 diff、迁移、生成契约、密钥扫描、日志脱敏和恢复文档。
  - [x] **M7.4.1** 阻止 SQLAlchemy/traceback 输出绑定参数，并增加私有正文与密码异常回归。
  - [x] **M7.4.2** 将开发 seed 设为显式 opt-in，生产配置不得创建验收账号或测试工作区。
  - [x] **M7.4.3** 消除 ORM 与 Alembic metadata 漂移，并把真实 PostgreSQL `alembic check`
    纳入发布门禁。
  - [x] **M7.4.4** 将大型 FTS/trigram 索引改为 PostgreSQL 在线创建/删除，并验证迁移事务边界。
  - [x] **M7.4.5** 让 metrics 默认关闭且启用后必须使用独立 Bearer token，避免公网裸露。
  - [x] **M7.4.6** 隔离 API E2E 数据，确保检索评测、浏览器测试的临时容器、卷和网络均清理。
  - [x] **M7.4.7** 为 Compose 增加可覆盖镜像入口，并演练承载服务无需改文件即可切换旧 digest。
  - [x] **M7.4.8** 定义并验证备份离机时的传输加密、静态加密、密钥管理和访问审计边界。
  - [x] **M7.4.9** 同步 Agent schema 架构文档，复跑密钥、日志、迁移、契约、diff 与资源审计。
- [x] **M7.5** 填写 Completion summary，将本计划移动到 `docs/plans/completed/`。

验证：全部验收命令通过；没有未解释的高风险变更、权限泄漏或未恢复的测试数据。

## Acceptance criteria

- [x] 固定评测集可以重复运行并对比版本，权限泄漏候选始终为零。
- [x] 混合检索在代表性查询上优于或不劣于基线，并为结果提供安全、可读的匹配解释。
- [x] Agent 工具执行具备有序公开事件、取消、超时、失败降级和幂等保存，不暴露隐藏推理。
- [x] GPT、Claude、Gemini 由能力路由而非 UI 文案决定可用工具，供应商失败不会覆盖草稿。
- [x] 前端主要业务模块不再依赖单个超大页面组件，桌面视觉不变且移动端可用。
- [x] PDF 能异步解析为带页码来源的可编辑 Markdown，且未经明确确认不会创建正式记忆。
- [x] 私有记录、资产、chunk、提示词和引用在任何检索、日志、指标或 trace 中均不越权泄漏。
- [x] 关键用户路径有真实浏览器自动化；数据库备份可在隔离环境成功恢复。
- [x] `make check`、`make test`、`make e2e` 和新增质量命令全部通过。

## Verification

- 自动化检查：格式、lint、Python/TypeScript 类型检查、单元测试、契约生成和生产构建。
- 检索评测：固定离线数据、真实 PostgreSQL 全文/pgvector 集成、质量差异报告。
- 集成验证：fake AI provider、工具失败/超时、worker 重试、迁移、删除与权限撤回。
- 浏览器验证：Playwright 桌面和移动路径、截图、拖动布局、键盘与 reduced-motion。
- 安全验证：跨用户/workspace 反向查询、未批准成员、引用二次授权、日志脱敏和密钥扫描。
- 运维验证：健康与指标 endpoint、备份校验、隔离恢复、应用回滚和迁移版本检查。

## Rollout and recovery

1. 先合入评测与观测，不改变生产排名或用户行为。
2. 全文索引和新表使用向前兼容迁移；迁移前备份，应用回滚时保留新增 schema。
3. 新检索器、reranker、Agent Runtime 和流式事件分别使用配置开关，先在本地和测试环境
   对比，再逐项切换默认值。
4. 文档解析先只处理新上传资产；历史资产按显式后台任务回填，不阻塞部署。
5. 前端按 feature 路由/组件逐块迁移，任何阶段都能切回现有页面实现。
6. 若质量、延迟或错误率超阈值，关闭对应开关并回到上一稳定路径；事实数据不回滚删除。
7. schema 恢复只用于隔离环境演练或灾难恢复；常规发布失败优先回退应用镜像并向前修复。

## Progress log

- 2026-08-07: 创建核心平台优化计划，确认执行顺序为“基线与评测 -> 检索 -> Agent Runtime
  -> 前端模块化 -> 文档管线 -> 生产可靠性 -> 总体验收”。
- 2026-08-07: 记录当前主要复杂度：关键词检索为 `icontains`、混合分数为简单合并、草稿
  API/首页/全局样式文件体积过大、PDF 为单轮同步抽取、浏览器 E2E 与运行追踪不足。
- 2026-08-07: 基线 `make check` 通过：Web 4 个测试文件、45 项测试；API 13 个测试文件、
  92 项测试，语句/分支综合覆盖率 82%；OpenAPI 漂移检查和 Next.js 生产构建通过。
- 2026-08-07: 关键文件基线为 `page.tsx` 5,373 行、`globals.css` 7,472 行、`drafts.py`
  2,163 行、`retrieval/service.py` 159 行、API smoke E2E 602 行。当前 Docker Web/API/DB
  健康，入口为 `http://localhost:8080/`。
- 2026-08-07: Alembic head 为 `20260806_0012`，下一迁移使用 `20260807_0013`；运行库为
  PostgreSQL 17 镜像，已启用 `vector 0.8.5`，尚未启用 `pg_trgm`。现有 API 单元测试默认
  使用 SQLite，因此所有 FTS/trigram/RRF SQL 必须增加真实 PostgreSQL 集成验证。
- 2026-08-07: 完成 M1。新增 14 个合成中文评测案例和确定性 runner，指标覆盖 Recall@K、
  MRR、nDCG、引用精度、无证据准确率与越权候选数；`make eval-retrieval` 已并入
  `make check`。当前 `icontains` 基线为 Recall/MRR/nDCG `0.778`、引用精度 `1.000`、
  无证据准确率 `1.000`、越权候选 `0`；失败集中在中文近义表达和英文错别字。
- 2026-08-07: M1 验证通过：95 项 API 测试、45 项 Web 测试、严格 mypy/TypeScript、
  Ruff/ESLint、OpenAPI 漂移检查、评测阈值和 Next.js 生产构建全部通过。
- 2026-08-07: 完成 M2。迁移 `20260807_0013` 启用 `pg_trgm` 并为活动记忆建立标题/正文
  trigram 与标题加权 FTS GIN 索引；检索使用精确匹配、`simple` FTS、trigram/
  `word_similarity` 和 pgvector 候选，再以 RRF 融合并稳定排序。SQLite 保留离线兼容路径。
- 2026-08-07: `POST /search` 保留旧 `score`/`match_reasons`，新增召回器、rank、候选数量、
  授权状态、过滤器、RRF、reranker 状态和耗时。结构化日志不记录 query 或正文；回归测试
  验证敏感查询文本不会出现在日志。
- 2026-08-07: 新增授权后 reranker 端口，候选正文上限 2,000 字，调用方传入 3 秒默认超时；
  provider 失败、非法分数、重复 ID 或候选集外 ID 均退回 RRF。固定 PostgreSQL 评测已满分，
  因此生产默认保持 `DISABLED`，待扩展数据集证明净收益后再配置真实 provider。
- 2026-08-07: M2 验证通过：一次性 PostgreSQL 17/pgvector 容器从空库升级到 `0013`，
  Recall/MRR/nDCG/引用精度/无证据准确率均为 `1.000`、越权候选 `0`，并成功执行
  `0013 -> 0012 -> 0013`。完整 `make check` 通过 99 项 API、45 项 Web、严格类型、契约和
  生产构建；GitNexus diff 风险为 LOW。
- 2026-08-07: 完成 M3.1-M3.2。23 项草稿聊天/PDF/联网/保存/流式回归锁定原行为；新增
  类型化 Agent tool registry，统一 Pydantic 参数校验、服务端权限策略、单轮调用上限、超时
  预算、最多两次联网尝试和脱敏错误结果。相关 Agent/草稿测试共 29 项通过，并验证联网首轮
  超时后恢复、重复保存不产生第二条记忆。
- 2026-08-07: 完成 M3.3-M3.4。Agent execution 使用受约束公开状态机，事件持久化记录当时的
  execution phase，支持按序恢复与账号/workspace 隔离；公开 planner 只接收能力布尔值并输出
  固定任务步骤，不接收正文或隐藏推理。PostgreSQL 17 已验证 execution/event 写读和
  `0014 -> 0013 -> 0014` 升降级。
- 2026-08-07: 完成 M3.5-M3.8。模型注册表兼容旧配置并增加 provider family、成本层级、
  优先级、单模型超时和显式 fallback；路由按本轮 capability 与预算选择 GPT/Claude/Gemini。
  流式请求支持执行中取消、增量事件恢复和幂等保存，Web 已生成 execution 契约与恢复/取消
  helper。`make check` 通过 API 119 项、Web 46 项、82% 总覆盖率、契约和生产构建；真实云雾
  `gpt-5.6-terra` 最小 smoke 成功（28 input / 9 output token，未记录响应正文）。
- 2026-08-07: 完成 M4。`page.tsx` 从 5,373 行缩减到约 1,700 行，capture、library、team、
  settings、workspaces、workbench 与 shared contract 已按垂直切片拆分；`globals.css` 的规则
  迁入 7 个按职责加载的样式文件。Agent reducer 覆盖运行、取消、恢复、失败、重试和保存
  回执，server-state client 覆盖请求去重、缓存失效、统一错误与乐观回滚。
- 2026-08-07: M4 自动化验证通过：Web ESLint、TypeScript、生产构建和 6 个测试文件共 56 项
  测试全部通过。浏览器在 1440x900 下验证导航与主内容分栏可拖动吸附隐藏、键盘
  Home/End/Enter 可折叠恢复且无页面溢出；390x844 下验证导航抽屉、记忆库、记录区和
  Markdown 编辑区，无横向溢出及控制台 error/warn。截图保存在
  `artifacts/browser/m4-desktop-workbench.png`、`m4-mobile-library.png` 和
  `m4-mobile-capture.png`；`prefers-reduced-motion` 会关闭入口动画和压缩过渡时长。
- 2026-08-07: 完成 M5。迁移 `20260807_0015` 增加受保护 PDF 解析作业、页、chunk 与
  记忆页级引用；Worker 支持有界解析、按需 Tesseract OCR、取消、退避重试和独立 chunk
  embedding。草稿 Agent 只读取授权后的已完成 chunk，并只接受服务器提供的 chunk ID；
  明确保存才创建记忆引用，删除资产会清除正文、页、chunk、向量和引用。
- 2026-08-07: M5 自动化验证通过：Ruff、严格 mypy、127 项 API 测试（82% 覆盖）、56 项
  Web 测试、ESLint、TypeScript 与 Next.js 生产构建。一次性 PostgreSQL 17 从空库升级到
  `0015`，成功执行 `0015 -> 0014 -> 0015` 并核对表清理。容器内真实 Tesseract 对无文本层
  扫描 PDF 识别为 OCR、生成 2 个第 1 页 chunk；浏览器验证等待状态禁用发送，完成后显示
  `1/1 页` 并恢复发送，控制台无错误。当前云雾聊天请求走安全降级，未把降级结果冒充真实
  页码引用；引用与确认保存由 fake provider 集成测试覆盖。
- 2026-08-07: 完成 M6.1-M6.4。API 中间件生成或校验 `X-Request-ID`，流式 Agent 线程显式
  继承 request/execution ID，worker 每轮建立独立追踪上下文，OpenAI-compatible adapter 将
  两个 ID 传播至 provider。Prometheus 文本指标覆盖 HTTP、AI 延迟/错误/token/显式价格
  估算、工具、检索和数据库队列；日志处理器递归脱敏正文、query、prompt、凭证和会话字段。
  `/metrics` 不记录 URL query，前端错误端点只接受受限类型、digest 和恢复动作，并可选转发
  到配置的外部接收器。Next.js 增加局部/全局 error boundary；相关 31 项 API/Agent 测试和
  全部 57 项 Web 测试、Ruff、mypy、ESLint、TypeScript 均通过。
- 2026-08-07: 完成 M6.5。新增隔离 Docker 浏览器环境和确定性 OpenAI-compatible fake
  provider；Playwright 在 9.2 秒内通过双账号注册、真实 PDF worker 解析、Agent 工具保存、
  页码引用、个人检索、团队申请/审核/移除、390x844 移动端无横向溢出和 metrics 脱敏主路径。
- 2026-08-07: 完成 M6.6。`db-backup.sh` 原子生成 PostgreSQL custom archive、SHA-256、UTC
  manifest，并同时执行 14 天/14 份保留策略；`db-restore-verify.sh` 在无公开端口的临时
  pgvector 数据库校验 revision、核心计数、BYTEA 资产字节与引用完整性。当前 3,756,165
  字节备份已成功恢复并验证 5 users、7 workspaces、72 memories、5 assets 和 revision 0015。
- 2026-08-07: 完成 M6.7。浏览器主路径生成含真实 PDF 页级引用的隔离源库，随后创建 87,895
  字节备份并恢复至第二个临时 pgvector 数据库；强门槛验证 6 users、8 workspaces、1 memory、
  1 asset、1 citation、资产存储字节、零孤儿引用和 Alembic `20260807_0015` 全部通过。报告写入
  `artifacts/recovery-drill-report.json`，源库、恢复容器及其卷均已清理。
- 2026-08-07: 完成 M6.8。使用 2026-08-06 构建的旧 API、worker、web 镜像 digest 在恢复的
  `0015` schema 上启动完整隔离栈，经 Caddy 登录并读取 2 个 workspace 和 1 条个人记忆；
  revision 前后均为 `20260807_0015`，未执行 downgrade。报告写入
  `artifacts/application-rollback-drill.json`，临时容器、网络与卷全部清理。
- 2026-08-07: 完成 M7.1。`make check`、独立 `make test`、`make e2e`、
  `make eval-retrieval`、`make eval-retrieval-postgres` 和 `make browser-e2e` 全部通过；共 57 项
  Web、134 项 API 测试，Python 覆盖率 82%。离线检索 recall/MRR/NDCG 为 0.778，真实
  PostgreSQL 均为 1.000，两者 citation precision 与 no-evidence accuracy 均为 1.000，
  unauthorized candidates 均为 0；最终 Playwright 主路径 8.5 秒通过。
- 2026-08-07: 完成 M7.3，并部署当前代码至 `http://localhost:19082`。30 次本地 API 样本
  p95 为 1.86-5.08ms，5 次端到端混合检索 p95 为 1.93s；桌面/390px 公开页与登录工作台
  LCP 为 104-136ms、CLS 均为 0，初始脚本约 234KB。五个长期容器空闲内存合计约 273MiB，
  单容器低于 80MiB；上传、检索、AI、OCR、解析并发和引用均有应用层上限。版本化结果与
  发布预算记录在 `docs/evaluation/performance-baseline-v1.md`。
- 2026-08-07: 完成 M7.2 独立权限审查。逐层复核 session/principal、workspace membership、
  记忆可见性、授权后检索、资产、PDF chunk、页级引用、Agent 工具与 execution 所有权，确认
  身份和 workspace 均由服务端注入与过滤。70 项专项回归全部通过；真实 PostgreSQL 评测
  Recall/MRR/nDCG/引用精度均为 1.000、越权候选为 0，并再次验证 `0015 -> 0012 -> 0013`
  迁移路径。审计矩阵与剩余控制记录在 `docs/evaluation/privacy-boundary-review-v1.md`。
- 2026-08-07: M7.4 独立发布审计首次判定不通过。发现 SQLAlchemy 异常参数泄漏和默认创建
  开发 seed 两项 P1，以及 Alembic metadata 漂移、阻塞式索引、公开 metrics、测试数据/卷
  残留、真实服务回滚入口、离机备份加密边界和 Agent schema 文档八类收口问题；已拆为
  M7.4.1-M7.4.9，全部修复和重新验证前不关闭计划。
- 2026-08-07: 完成 M7.4.1-M7.4.2。所有 SQLAlchemy engine 强制
  `hide_parameters=True`，唯一约束回归证明私有正文标记不会进入异常字符串；开发 seed 改为
  `SEED_DEVELOPMENT_DATA_ENABLED=false` 默认 no-op，生产配置禁止启用，只有隔离 E2E 显式
  opt-in。数据库/设置/身份专项共 22 项通过。
- 2026-08-07: 完成 M7.4.3-M7.4.4。新增 `20260807_0016` 移除重复 Agent 唯一约束并稳定
  文档任务资产约束名称；早期用户/会话/workspace 唯一约束和会话复合索引的 ORM metadata
  已与数据库对齐，手写表达式索引由 Alembic 明确排除。0013 三枚现有记忆索引改用
  `CREATE/DROP INDEX CONCURRENTLY`。真实 PostgreSQL 空库升级、`alembic check`、降至 0012
  再升级均通过，三枚索引 ready/valid；该门禁已加入 `make check`。
- 2026-08-07: 完成 M7.4.6。`make e2e` 改为独立 Compose 项目，在临时 PostgreSQL、fake
  provider、API、worker、Web 与代理中通过全部 API 主路径，并在退出 trap 中清除容器、网络
  和卷；检索评测的匿名 PostgreSQL 卷也随容器删除。清理本轮演练产生的 8 个匿名悬空卷，
  保留用户既有 7 月卷与 `memoraqa` 本地 QA 栈。
- 2026-08-07: 完成 M7.4.8。备份 manifest 明确标记受限用户内容和离机加密要求；策略门禁校验
  SHA-256、目录 `0700`、文件 `0600`，并在离机场景强制要求传输加密、存储静态加密、独立
  KMS key reference 与访问审计声明。当前 3,761,474 字节备份的本地策略和模拟离机证明均
  通过；生产运行手册补充了密钥分离、轮换、最小权限和保留期边界。
- 2026-08-07: 完成 M7.4.5。`/metrics` 默认关闭并返回 404；显式启用时配置层强制要求至少
  32 字符的独立 token，无凭证返回 401，正确 Bearer token 才返回脱敏指标。15 项设置与
  可观测性专项测试通过，Playwright 在 9.2 秒内复测完整主路径和 metrics 鉴权；退出后隔离
  容器、网络和卷均为零残留。
- 2026-08-07: 完成 M7.4.7。Compose 的 API、worker、Web 镜像均可由环境变量覆盖；承载服务
  在不修改 Compose 文件、不回退数据库的情况下从当前版切至三枚旧 digest，再切回当前版。
  两次均验证容器实际 image ID、worker、公开首页、API ready 与 revision；数据库始终保持
  `20260807_0016`。切换流程会刷新 Caddy 上游并绕过宿主机 HTTP proxy，最终首页/health/
  ready 为 200、metrics 默认 404，报告写入 `artifacts/application-image-switch.json`。
- 2026-08-07: 最终数据恢复门禁使用发布后的 `20260807_0016` 创建 3,761,090 字节备份，并在
  无公开端口的隔离 PostgreSQL 中恢复验证 5 users、7 workspaces、81 memories、5 assets、
  3,577,660 资产字节和零孤儿引用；临时容器、卷、网络均清理。部署环境未配置外部错误接收
  端，已确认保留脱敏结构化日志、`/api/health` 与 `/api/ready`，生产接收端仍由运维提供。
- 2026-08-07: 最终质量门禁通过：`make check`、独立 `make test`、隔离 `make e2e` 和
  `make browser-e2e` 均成功；58 项 Web、140 项 API 测试全部通过，覆盖率 82%，数据库资源
  警告已用 `-W error::ResourceWarning` 回归消除。离线检索为 0.778，真实 PostgreSQL
  Recall/MRR/nDCG/引用精度/无证据准确率均为 1.000、越权候选 0；最终 Playwright 为 9.2 秒。
- 2026-08-07: M7.4 二次独立审计发现 PostgreSQL server `DETAIL` 仍可在约束错误中包含正文，
  且本机真实 `.env` 为 `0644`。所有应用与 Alembic engine 现统一在 `handle_error` 阶段移除
  psycopg PGresult、缓存异常文本、statement 和 params，同时保留异常类型与 SQLSTATE；真实
  `memories.visibility` CHECK 的 `str`、`repr`、traceback 和 diag 均验证无正文标记。`.env`
  已收紧为 `0600`，`make setup` 会创建或修复权限，`make check` 会拒绝宽松权限。
- 2026-08-07: 独立终审进一步发现开发指南仍有直接 `cp .env.example .env` 的 P2，现已统一为
  `make setup`。终审复核全仓危险复制命令为零、真实 PostgreSQL 脱敏/迁移/检索门禁通过、
  当前 `.env` 为 `0600`、临时资源为零，最终结论为 **APPROVE**，无 P0/P1/P2 阻塞。

## Decision log

- 2026-08-07: 先建立检索评测再优化算法；原因是没有固定基线就无法区分真实提升和主观
  感觉。
- 2026-08-07: 将可公开执行事件与隐藏推理分开；原因是用户需要可信工作反馈，但系统不应
  伪造或泄漏模型内部思维链。
- 2026-08-07: 采用渐进式垂直切片重构；原因是当前产品已可用，整页或整套 API 重写会扩大
  行为回归和权限风险。
- 2026-08-07: 文档解析结果先进入草稿；原因是“用户确认后保存”是 Memora 的事实数据和
  隐私边界。
- 2026-08-07: 运维能力纳入产品完成定义；原因是文档、引用和共享记忆只有在可恢复、可追踪
  时才真正可靠。
- 2026-08-07: PostgreSQL 使用内置 `simple` FTS 配合 trigram，而不增加中文分词扩展；原因
  是当前标准 pgvector 镜像可直接部署，合成中文近义与英文错拼评测已达到满分。数据规模或
  语义集扩展后再重新评估专用分词。
- 2026-08-07: reranker 端口落地但默认禁用；原因是授权 FTS/trigram 已达到当前评测上限，
  此时启用外部 reranker 只会增加延迟、成本和数据出站，没有可量化收益。
- 2026-08-07: PDF 采用 PostgreSQL 内异步页级管线并记录受控引用快照；原因是聊天请求不应
  承担 OCR 延迟，且页码来源、删除传播和取消共享必须继续使用同一数据库授权边界。

## Completion summary

Status: completed

- 检索：建立确定性离线与真实 PostgreSQL 评测，落地授权后 FTS/trigram/pgvector 候选、RRF、
  可选 reranker 和安全诊断；真实 PostgreSQL 指标均为 1.000，越权候选为 0。
- Agent 与文档：交付可取消/恢复的公开事件状态机、GPT/Claude/Gemini 能力路由、受控工具、
  异步 PDF/OCR/chunk embedding、页级引用、明确保存和删除传播闭环，不展示隐藏思维链。
- Web：按 capture/library/team/settings/workspaces/workbench 拆分超大页面与样式，保留黑色主
  视觉，并验证桌面可拖动布局、键盘、reduced-motion 与 390px 移动端路径。
- 可靠性：交付 request/execution trace、受保护 metrics、脱敏日志、隔离 E2E、备份/恢复、
  旧镜像切换、离机备份策略、性能基线和生产安全默认值；数据库异常与本地 secret 文件均有
  持续门禁。
- 最终证据：58 项 Web、140 项 API 测试和 82% 覆盖率；`make check`、`make test`、
  `make e2e`、`make browser-e2e`、契约、Gitleaks、迁移与恢复检查全部通过。发布后的 0016
  备份在隔离库恢复 5 users、7 workspaces、81 memories、5 assets，零孤儿引用。
- 当前部署：`http://localhost:19082` 运行最终 API/worker/Web 镜像，首页、health、ready 为
  200，metrics 默认 404，Alembic revision 为 `20260807_0016`。

Remaining non-blocking operations:

- 当前部署未配置外部错误接收端，暂由脱敏结构化日志和 health/ready 承担本地观测；生产环境
  仍需提供接收端与 token。
- 离机备份的传输、KMS 和访问审计门禁已验证声明与策略，尚需生产对象存储/KMS 的真实凭据
  和审计证据；旧 manifest 在使用前必须重新通过当前策略门禁。
- `memoraqa` QA 栈和两枚 7 月旧卷是用户既有资源，已明确保留；本计划创建的临时容器、网络
  与卷均已清理。
- GitNexus 因本轮跨 47 个已跟踪文件、400 个符号和 17 条执行流将整体 diff 评为 CRITICAL；
  该范围由上述分层测试、真实 PostgreSQL、浏览器 E2E、恢复演练和独立终审覆盖。本计划范围
  内无未完成项。
