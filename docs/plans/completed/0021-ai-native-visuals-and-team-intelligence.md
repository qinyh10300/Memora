# AI Native visuals and team intelligence

Status: completed

Owner: Codex

Last updated: 2026-08-08

## Outcome

Memora 增加两个可独立使用、又能互相衔接的工作区：

1. **科研绘图**：通过提示词或授权记忆生成科研图片、思维导图、流程图和时间线；结构图可编辑，
   所有记忆来源可追溯。
2. **团队智能**：生成个人、成员、团队和项目报告；识别候选分歧，由成员确认观点，最终形成
   可追溯的团队决策和复盘记录。

最终用户可以完成以下闭环：

```text
个人/团队记忆
-> 报告或候选分歧
-> 成员确认
-> 团队决定
-> 思维导图/流程图/科研图片
-> 保存为新记忆并持续复盘
```

## 确认后采用的默认选择

除非用户提出不同意见，开发按以下默认值执行：

1. 图片模型通过新的 OpenAI-compatible `ImageGenerationPort` 接入；首批产品选项为 GPT Image 2、
   Nano Banana、Nano Banana 2 和 Nano Banana Pro。真实供应商模型 ID 由环境变量配置，未配置时
   界面显示不可用，不伪造结果。
2. “成员贡献报告”只使用该成员主动共享到当前 workspace 的记忆。报告默认仅生成者可见，
   每次生成写审计记录，不做绩效、心理或性格判断。
3. 所有成员都可以创建对齐议题；成员只能确认自己的观点。第一版由 workspace OWNER 发布最终
   决策，未确认成员和保留意见必须保留在决策记录中。
4. P0 科研模板优先支持通用科研插画、思维导图、流程图和时间线；生命科学等专业模板后续增加。
5. credits 价格使用配置项，不在代码中写死。长任务先预留额度，成功后结算，失败或取消后释放。
6. P0 继续复用 PostgreSQL `assets` 的受保护二进制存储，并限制图片大小、数量和保留策略；达到
   观测阈值后再通过 ADR 决定是否引入对象存储。

用户于 2026-08-07 已确认以上六点并批准开始开发。新增模型与生成设置按同日补充要求执行：

- 聊天模型：Claude 4.5 Haiku、GPT 5.6 Luna、Gemini 3 Flash、GPT 5.6 Terra、Claude 5 Sonnet、
  Gemini 3.1 Pro、GPT 5.6 Sol、Claude 5 Opus。
- 生图设置：1:1 等受支持比例、1–4 张、科研风格增强、水印处理、输出语言（默认 Auto）。
- 套餐门槛、模型能力与真实 provider model ID 均由服务端注册表返回，前端不自行假定可用性。

用户只需确认以上六点，即可开始开发；不需要现在提供生产密钥。

## Context and evidence

### 产品与架构

- 产品需求：[AI Native 工作台需求](../../product/ai-native-workspace-requirements.md)。
- `docs/product/brief.md` 仍把该能力定义为手动知识框图，实施前需同步更新。
- ADR-0007 只覆盖 React Flow 图和来源权限，未覆盖图片模型、持久报告、观点确认和决策记录。
- 继续遵守模块化单体、单服务器部署、OpenAPI 契约和 PostgreSQL 事实来源。

### 当前代码事实

- `reports/service.py` 和 `POST /reports` 已支持 PERSONAL、COLLEAGUE、WORKSPACE 三种授权报告，
  但报告只即时返回，没有持久化、历史或独立前端页面。
- `diagrams` 已有 workspace、owner、visibility、memory/person 节点和撤权时标签隐藏规则，可作为
  结构图编辑器继续使用。
- `assets` 已将图片/PDF 作为受保护 `BYTEA` 保存，并校验 owner、workspace、MIME、哈希和删除状态。
- worker 已处理 PDF、memory embedding 和 document embedding，可增加可重试的 visual job。
- billing 已有行锁、幂等账本和成功扣费，但没有长任务额度预留。
- AI 端口只有 Chat、Embedding 和 WebSearch，没有图片生成端口。
- Web 工作台已有科研绘图入口和 React Flow 页面，但 `page.tsx` 已超过 2,200 行，新功能不能继续
  堆入同一组件。

## Scope

### P0

- 科研绘图画廊、模板、提示词、模型、比例、数量和 credits 预估。
- 从授权记忆选择内容并生成思维导图、流程图和时间线。
- 调用真实图片模型生成科研图片候选。
- 结构预览、来源确认、React Flow 精修、版本、历史和导出。
- 持久化个人、成员、团队和项目报告。
- 候选分歧、观点本人确认、共识/差异、最终决策和复盘日期。
- 报告或决策一键转为结构图。
- 桌面与移动端完整主流程。

### P1

- “我错过了什么”、会前简报、交接报告和新人 onboarding。
- 知识缺口、过期决定和单点知识风险。
- 参考图、局部重绘、高清化和专业科研模板。
- 周期订阅式报告和图形生成。

### Non-goals

- 多人实时共同编辑。
- 自动替团队作出决定。
- 个人绩效、情绪、性格或忠诚度分析。
- 无鉴权公开图片链接。
- 第一版真实支付和按供应商账单对账。

## Design and boundaries

### 1. Web 结构

先把现有工作台拆成不改变行为的 `WorkbenchShell`、认证/首页和独立 feature view，再加入：

```text
apps/web/src/features/
├── visuals/       # 画廊、生成器、任务过程、结构编辑和历史
├── insights/      # 报告、团队速览和知识缺口
├── alignment/     # 分歧议题、观点确认和决策
├── diagrams/      # 保留现有 React Flow 编辑器
└── workspaces/    # 继续提供统一空间和导航状态
```

侧栏只新增一个“团队智能”入口，内部使用“报告 / 对齐 / 决策”标签，避免继续增加一级导航密度。
个人空间显示“我的洞察”；团队和家庭空间显示“团队智能”。

### 2. AI provider boundary

新增供应商无关的 `ImageGenerationPort`：

```text
ImageGenerationRequest
  prompt, model_id, aspect_ratio, count, quality,
  scientific_style, watermark_mode, output_language

ImageGenerationResult
  images, revised_prompt, model_id, usage
```

adapter 只处理供应商 HTTP 契约、超时、重试和错误归一化。应用层负责权限、来源、credits、
任务状态、图片格式校验和保存。图片响应只接受受限 Base64 或可信供应商返回，下载 URL 必须防止
SSRF，并再次验证 MIME、文件魔数、尺寸和大小。

结构图继续使用 `ChatModelPort`，通过受限 JSON schema 和 Pydantic 校验节点、关系、来源 ID；
解析失败最多重试一次，不把未验证 JSON 保存为正式图。

### 3. Visual data model

新增：

| Entity | Purpose |
| --- | --- |
| `visual_projects` | workspace、owner、模式、图类型、visibility 和当前状态 |
| `visual_versions` | 每次结构或图片生成版本、模型、prompt 摘要和输出 asset/diagram |
| `visual_sources` | 版本到 memory、report 或 decision 的来源映射 |
| `visual_generation_jobs` | 排队、运行、待确认、成功、失败、取消、重试和阶段进度 |
| `credit_reservations` | 长任务额度预留、成功结算和失败释放 |

现有 `diagrams` 不删除。结构化 visual version 通过 `diagram_id` 关联；已有 diagram 通过可回滚的
数据迁移创建对应 visual project，旧 API 在过渡期继续可用。

P0 模板使用代码内受版本控制的 JSON 和本地缩略图，不先建设模板后台。

### 4. Visual generation flow

```text
POST visual project
-> 服务端重新授权所有 source IDs
-> 事务内创建 job 并预留 credits
-> worker 调用结构模型或图片模型
-> 校验 graph/image
-> 再次授权来源
-> 保存受保护版本和 asset
-> 结算 credits
-> 发布完成事件
```

- 结构图在 graph 生成后进入 `WAITING_CONFIRMATION`；用户确认后才创建正式 diagram version。
- 图片生成成功前不产生账本扣费；worker 崩溃可按 job id 幂等恢复。
- 任务过程只显示“检索来源、提炼结构、调用模型、渲染、保存”等公开阶段，不显示隐藏推理。
- 共享 visual 每次读取和导出都重新检查所有 sources；任何来源撤权时隐藏整个衍生结果，避免
  已固化在图片中的信息继续泄漏。

### 5. Persistent reports

扩展现有报告服务，增加：

| Entity | Purpose |
| --- | --- |
| `generated_reports` | 类型、范围、主题、时间、visibility、状态和报告正文 |
| `report_sources` | 报告到 memory 的引用、作者、时间和用途 |

报告类型：PERSONAL、MEMBER、WORKSPACE、PROJECT。继续复用现有授权查询和生成后再授权逻辑。

- 报告默认私有。
- “保存为记忆”创建新的 immutable memory，不修改来源。
- “生成图表”只传 report ID 和 sources，由服务端重新解析授权，不让前端上传正文冒充报告。
- 来源撤权后，未授权用户不能读取旧报告正文或缓存摘要。

### 6. Alignment and decisions

新增：

| Entity | Purpose |
| --- | --- |
| `alignment_topics` | 议题、范围、参与者和状态 |
| `alignment_positions` | AI 提议或成员确认的明确观点 |
| `alignment_position_sources` | 观点到原始共享 memory 的引用 |
| `decision_records` | 决定、理由、备选方案、owner、复盘时间和最终 memory_id |

对齐流程必须满足：

1. AI 只能从已授权、明确表达的记忆中提出“候选观点”。
2. 每位成员只能确认、修正或撤回自己的观点。
3. 未表达观点的人显示 `NO_RECORDED_POSITION`。
4. 共识、差异和证据缺口由服务端验证引用后返回。
5. OWNER 发布决定时，创建一条新的 WORKSPACE decision memory，并让 decision record 引用它。
6. 旧决定被替代时创建新记录并关联 `supersedes_id`，不原地改写历史。

### 7. Credits

现有余额公式扩展为：

```text
available = granted - used - reserved
```

- 入队时预留；成功时 `settle`；失败、取消或超时后 `release`。
- reservation、job 和 ledger 共用稳定幂等键。
- report、alignment extraction、structured visual 和 image generation 使用不同配置价格。
- provider usage 只记录元数据，不记录 prompt、报告正文或图片内容。

### 8. API contract

计划新增或扩展的主要端点：

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /visuals` | 作品历史与创建项目 |
| `POST /visuals/{id}/generate` | 校验来源、预留额度并排队 |
| `GET /visual-jobs/{id}` | 当前状态和安全阶段 |
| `GET /visual-jobs/{id}/events` | SSE 动态进度 |
| `POST /visuals/{id}/confirm-structure` | 确认结构并创建 diagram version |
| `GET /visuals/{id}/export` | 权限校验后导出 |
| `GET/POST /reports` | 历史和持久化报告；保留现有生成能力 |
| `POST /reports/{id}/save-memory` | 用户确认后保存新记忆 |
| `POST /reports/{id}/create-visual` | 从报告创建 visual project |
| `GET/POST /alignments` | 对齐议题列表与创建 |
| `POST /alignments/{id}/positions/{position_id}/confirm` | 本人确认或修正观点 |
| `POST /alignments/{id}/decisions` | OWNER 发布决定 |

所有请求类型由 FastAPI/OpenAPI 生成，前端不手写第二套契约。

## Milestones

- [x] **M0 文档与架构确认**：确认本计划六项默认值；更新 Product Brief，新增 AI visuals/team
  intelligence ADR。验证：文档审查，无代码行为变化。
- [x] **M1 工程基础**：拆分 Web shell；新增 ImageGenerationPort、fake adapter、visual jobs、
  credit reservation 和 additive migrations。验证：单元测试、迁移升降级和旧 UI 回归。
- [x] **M2 结构图垂直切片**：记忆选择 -> AI graph -> 用户确认 -> React Flow 编辑 -> PNG/SVG。
  验证：个人/团队权限 API 测试和桌面/移动浏览器路径。
- [x] **M3 科研图片垂直切片**：模板画廊、图片模型、候选版本、受保护 asset、历史和 credits。
  验证：fake provider e2e、超时/坏图片/重试/幂等测试。
- [x] **M4 报告中心**：持久化 PERSONAL/MEMBER/WORKSPACE/PROJECT 报告、来源、历史、保存记忆
  和生成图表。验证：撤权、删除、无证据和跨成员回归测试。
- [x] **M5 分歧对齐**：候选观点、本人确认、无记录状态、共识/差异和决策 memory。验证：不能
  替他人确认、不能引用私有记忆、旧决定不可原地覆盖。
- [x] **M6 团队智能 P1**：我错过了什么、会前简报、onboarding、交接和知识缺口。验证：范围、
  时间、来源和订阅任务测试。
- [x] **M7 体验与发布**：动画、空/错/取消/恢复状态、可访问性、性能、全量检查和本地部署。
  验证：`make check`、`make e2e`、浏览器桌面/移动截图和容器健康。

每个里程碑完成后更新本文件的复选框、进度日志、实际验证和偏差；不能等到最后一次性勾选。

## Progress log

### 2026-08-07 · M1 / M4 / M5 / M6

- `page.tsx` 已收敛为路由挂载，工作台状态与布局迁入独立 `WorkbenchShell`；旧页面回归 43 项通过。
- 新增图片生成端口、模型注册表、visual job、额度预留和 additive migrations `0020`、`0021`。
- 独立 PostgreSQL 已完成全量升级、回退到 `0019`、再升级；Alembic schema drift 为 0。
- 持久报告、撤权后不可读、保存为新记忆、从报告创建图表的 API 与界面已完成。
- 候选观点、本人确认、OWNER 决策、新 decision memory 与来源撤权边界已完成。
- 五类报告预设和日/周/月订阅已完成；worker 只使用当前授权来源，暂停任务不会执行。
- 当前验证：Web 66 项、API 168 项通过；PostgreSQL 检索权限评测 unauthorized=0。

### 2026-08-08 · M2 / M3

- 结构图已支持授权记忆选择、AI graph、确认后进入 React Flow，以及 PNG/SVG 导出。
- 科研图片已支持四个模型、比例、1–4 张、科研增强、水印要求、语言、历史和受保护 asset。
- `make e2e` 已扩展到报告、周期订阅、结构图、科研图片、对齐和决策的真实容器路径。
- E2E 发现并修复共享 visual 在来源撤回后仍返回项目元数据的问题；列表、详情、任务状态和图片
  内容现在统一执行来源再授权，新增 API 回归测试。

### 2026-08-08 · M7

- `make check` 全量通过：Web 66 项、API 169 项、格式、lint、类型、OpenAPI、迁移升降级、
  PostgreSQL 权限评测和生产构建均通过；schema drift 为 0、unauthorized recall 为 0。
- `make e2e` 通过 fake chat/image provider 的结构图、科研图片、持久报告、周期订阅、观点本人确认、
  OWNER 决策和来源撤权关键路径。
- 1440x900 桌面视口完成八个聊天模型、四个生图引擎、生成偏好、个人洞察和团队智能交互验收。
- 390x844 移动视口完成导航、科研绘图、团队智能和报告表单验收；页面级 `scrollWidth` 等于
  `innerWidth`，未发现横向溢出或控件遮挡。
- Docker Compose 已重新构建并部署到 `http://localhost:8080/`，Web 与 API 健康检查通过。

## Acceptance criteria

- [x] 科研绘图默认显示画廊和输入框，不再以空白画布作为首页。
- [x] 授权记忆可以自动生成文字正确、来源可追溯、可编辑的结构图。
- [x] 配置图片模型后可以生成真实科研图片；未配置时明确显示不可用。
- [x] 刷新后可恢复 visual job、历史版本、报告和对齐议题。
- [x] 用户能生成本人、成员、团队和项目报告并查看原始来源。
- [x] 系统只能提出候选分歧，成员只能确认自己的观点。
- [x] 决策保存为新的正式记忆，保留反对意见、来源和复盘时间。
- [x] 任一来源撤权后，相关共享图、图片、报告和对齐内容不会继续泄漏。
- [x] 并发长任务不会透支 credits；失败任务释放预留且不扣费。
- [x] 管理员不能通过报告、图片、任务事件或导出读取成员私有记忆。

## Verification

### Automated

- `make check`：format、lint、typecheck、Web/API tests、OpenAPI、迁移和构建。
- `make e2e`：fake chat/image provider 下的结构图、图片、报告、对齐和决策路径。
- PostgreSQL 集成：来源撤权、删除、并发 credit reservation、worker 重试和 job 恢复。

### Permission matrix

至少覆盖：

- owner / other member / removed member。
- PRIVATE / WORKSPACE source。
- PERSONAL / TEAM / FAMILY workspace。
- 生成前撤权 / 生成中撤权 / 生成后撤权。
- 查看 / 编辑 / 分享 / 导出 / 生成报告 / 确认观点 / 发布决定。

### Browser

- 桌面：1440x900。
- 移动：390x844。
- 检查画廊、记忆选择、任务过程、结构确认、图片历史、报告、对齐和决策。
- 检查无横向溢出、遮挡、布局跳动和键盘不可达控件。

### Security

- `git diff --check`、secret scan、日志正文检查。
- 图片 MIME/魔数/大小/尺寸、SSRF 和恶意 SVG 检查。
- 模型返回的 source IDs、graph JSON 和图片都视为不可信输入。

## Rollout and recovery

1. 所有迁移先 additive，不删除现有 diagrams、reports API 或 assets 数据。
2. 先部署数据库、API 和 worker，再部署隐藏新入口的 Web。
3. 通过 `AI_VISUALS_ENABLED`、`TEAM_INTELLIGENCE_ENABLED` 分别启用。
4. 图片模型未配置或供应商失败时，结构图和已有工作台仍可使用。
5. 回滚时关闭 feature flags 并回滚应用；保留 visual/report/alignment 表和资产，避免用户数据丢失。
6. 只有确认新数据可丢弃后才执行 downgrade；生产操作前先备份 PostgreSQL。

## Progress log

- 2026-08-07: 完成需求澄清和代码事实调研；确认已有 reports、diagrams、assets、worker 和 billing
  可复用，缺少 image port、持久报告、alignment/decision 和长任务 credits reservation。
- 2026-08-07: 创建本计划，状态保持 planning，等待用户确认六项默认选择后开始 M0。
- 2026-08-07: 用户确认按本计划开发；完成 M0，新增 ADR-0008，并把 AI Native 工作台写入
  Product Brief。补充四个生图引擎、八个聊天模型及生成偏好要求，进入 M1。

## Decision log

- 2026-08-07: 结构图和开放式图片使用两条引擎；原因是文字准确性与视觉生成目标不同。
- 2026-08-07: 不新建第二套手动图编辑器；现有 diagrams/React Flow 作为结构生成后的编辑层。
- 2026-08-07: P0 复用受保护 PostgreSQL assets；原因是当前单机部署和备份链已覆盖该路径。
- 2026-08-07: 报告、对齐和图片都按来源实时撤权；原因是衍生内容本身也可能泄漏私有信息。
- 2026-08-07: 模型展示名与供应商模型 ID 分离；产品可以稳定展示用户指定名称，同时避免在
  供应商未实际提供对应模型时伪造可用状态。

## Completion summary

已交付 AI Native 科研绘图、模型/生成偏好、持久报告、周期订阅、团队观点对齐、正式决策记忆、
credits 预留结算和来源实时撤权，并完成桌面/移动响应式界面。结构图和图片生成均通过 fake provider
端到端验证，真实供应商仍需在部署环境配置对应 model ID 和密钥；真实支付、多人实时编辑、参考图
局部重绘和供应商账单对账仍属于后续范围。

本地验收地址为 `http://localhost:8080/`。开发账号为 `alex@memora.local`，密码由本地 seed 配置
提供，不写入 Git。
