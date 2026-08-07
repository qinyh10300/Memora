# Subscription, diagrams, and knowledge workspaces

Status: completed

Owner: Codex

Last updated: 2026-08-07

## Outcome

Memora 在保持黑色主视觉、默认私有和现有 Markdown 记忆闭环的前提下，升级为更完整的
知识工作台：用户拥有默认头像、可查看 credits 和 Plus / Pro / Ultra 套餐并升级；可以在
个人、团队或家庭空间中创建受权限保护的流程图和思维导图；侧栏提供新对话、知识框图、
云知识库、深度调研、空间与历史对话入口。

本阶段的“升级”是可工作的内部订阅状态和额度账本，不代表真实银行卡、支付宝或微信扣款。
在指定支付供应商、价格币种、税务和退款规则前，不向用户展示虚假的支付成功信息。

## Context and evidence

- `docs/product/brief.md` 当前批准界面只包含记录、记忆库和团队，并暂时隐藏多 conversation；
  旧版 non-goals 还排除了知识图谱与商业计费。本计划由用户的新明确需求授权，需要同步更新
  product brief 和新增 ADR，不能静默改变范围。
- `docs/architecture/overview.md` 要求继续使用 Next.js、FastAPI、PostgreSQL/pgvector 的模块化
  单体，所有 workspace、作者和 visibility 边界在服务端执行。
- 当前已经有个人/团队 workspace、团队号申请与审核、受保护文档、持久 conversation API、
  授权记忆检索和模型使用记录；Web 只需要把 conversation 历史重新接入当前工作台。
- 当前没有订阅、额度、图表持久化或 `FAMILY` workspace 数据模型。
- 用户提供的 InfMind 截图确认了目标交互：黑色主体、深灰侧栏、紧凑一级功能入口、空间和
  历史分组、底部账户与升级入口，以及中心聚焦的工作输入区。

## Scope

### In scope

- 用户级 Plus / Pro / Ultra 套餐、周期额度、余额、不可篡改 credits 账本、额度不足门禁。
- 内部升级流程：立即切换套餐并补齐新套餐当期额度；重复请求幂等，不接真实支付。
- AI 草稿对话成功使用模型时扣减固定 credits；禁用、失败或纯本地降级不收费。
- `PERSONAL`、`TEAM`、`FAMILY` 三类空间；家庭空间复用团队号、申请审核、成员移除和共享规则。
- workspace 内私有或共享的知识框图，支持思维导图和流程图、记忆选择、作者标注、拖拽节点、
  连线、保存和再次打开。
- 共享图只允许引用同 workspace 的 `WORKSPACE` 记忆；私有图可引用本人私有记忆和当前有权
  访问的共享记忆。其他成员永远不能通过图标题、节点、接口或日志获知私有记录。
- 深度调研入口复用受控 Agent 和强制联网模式，保留工具过程、来源和用户确认保存规则。
- 云知识库聚合当前授权记忆和被授权记忆引用的受保护文档来源，不扩展为任意网盘。
- 重新启用当前用户、当前 workspace 的 conversation 历史；支持新对话、恢复和归档。
- 无自定义头像时展示 Memora 默认头像；统一侧栏密度、悬停、焦点、动效与移动端抽屉。

### Non-goals

- 真实支付、自动续费、发票、税务、退款、优惠券或第三方 webhook。
- 跨 workspace 构图、跨空间统一搜索或把私有记忆复制到共享图。
- 多人同时编辑同一张图、评论、在线光标或复杂图数据库。
- 任意第三方知识库同步、通用文件夹或绕过记忆确认流程的文件分享。
- 依据 credits 付费等级放宽任何隐私或 workspace 权限。

## Assumptions and open questions

- [x] “MamaRail”按上下文解释为 Memora 产品本身。
- [x] 第一版套餐升级使用内部状态，不模拟真实支付结果。
- [x] Plus / Pro / Ultra 当期 credits 分别为 2,000 / 10,000 / 50,000；后续可通过迁移或配置调整。
- [x] 第一版一次成功 AI 对话扣 10 credits，失败或未调用模型不扣费。
- [x] 家庭空间与团队空间使用同一隔离、加入审核和成员管理规则，只改变空间语义和显示。
- [x] “机库关系”按上下文解释为记忆库中记忆、作者、修订和显式连线关系。

## Design and boundaries

### Subscription and credits

- `subscriptions` 以 `user_id` 为唯一事实来源，保存 plan、status、period 和余额。
- `credit_ledger_entries` 只保存数量、余额、原因、幂等键和非正文引用，不保存 prompt、记忆正文
  或模型输出。
- 注册和旧用户首次读取订阅时自动获得 Plus；旧用户迁移不需要手工补数据。
- 升级事务同时锁定订阅、更新套餐、补齐差额并写入账本。降级第一版允许立即切换，但不会把
  已消费额度恢复为负数。
- AI 路径先检查可用余额，成功调用模型后原子扣费；并发时数据库行锁阻止余额透支。

### Diagram authorization

- 图绑定 `workspace_id + owner_id`，可见性只有 `PRIVATE` 或 `WORKSPACE`。
- 节点与边使用经过 Pydantic 验证的 JSON；节点只保存 memory id、用户可编辑标签、位置和
  类型，不缓存记忆正文。
- 每次读写都重新验证 membership、owner/visibility 和节点 memory 授权。读取共享图时如果
  某来源已删除或撤回共享，该节点在响应中标记失效且不返回原始标题或正文。
- React Flow 负责画布、拖动、缩放和连线；服务端仍是保存与权限事实来源。

### Conversations and knowledge surfaces

- 草稿聊天可携带当前 conversation id。服务端验证其属于当前用户和 workspace，再持久化
  用户消息和助手消息；前端不可信地声明 owner/workspace。
- 历史恢复只读取当前用户自己的 conversation，并在返回引用前重新应用 memory 授权。
- 深度调研仍使用当前授权记忆和受保护文档，只把外部搜索作为额外证据。
- 云知识库的文档来源从当前可访问记忆的 `document_citations` 聚合，不创建公共静态 URL。

## Milestones

- [x] M1 — 产品范围、ADR 和执行计划明确订阅、家庭空间、图与历史的边界；验证：文档审查。
- [x] M2 — subscriptions/credits 模型、迁移、API、并发安全扣费和权限测试；验证：API 测试。
- [x] M3 — Plus / Pro / Ultra 套餐弹窗、余额卡、升级和默认头像；验证：Web 测试与截图。
- [x] M4 — `FAMILY` workspace 创建、切换、邀请/申请审核与成员目录；验证：API/Web 测试。
- [x] M5 — 图模型、CRUD、权限过滤和 React Flow 画布；验证：跨用户权限测试与浏览器交互。
- [x] M6 — 深度调研、云知识库和 conversation 历史恢复；验证：持久化与授权回归测试。
- [x] M7 — InfMind 风格侧栏、响应式适配、全量检查与本地部署；验证：`make check`、
  `make e2e`、Playwright 桌面/移动截图和线上容器健康。

## Acceptance criteria

- [x] 用户能看到当前套餐、周期 credits、已用/剩余额度和最近账本记录。
- [x] 用户能在 Plus、Pro、Ultra 中升级，刷新和重新登录后状态保持。
- [x] 无额度时 AI 请求被明确阻止；失败请求不扣 credits，成功请求只扣一次。
- [x] 默认头像在侧栏、移动端和账号设置中一致显示，用户上传头像后立即替换。
- [x] 用户能创建家庭空间并通过团队号或邮箱成员流程管理成员。
- [x] 用户能从授权记忆创建思维导图或流程图，拖动、连线、保存并重新打开。
- [x] 私有图和私有记忆不会出现在其他成员的列表、详情、节点或日志中。
- [x] 共享图不能保存对私有记忆的引用；撤回共享后节点内容不会继续泄露。
- [x] 深度调研会显示来源和受控工作过程，失败时不覆盖草稿。
- [x] 云知识库只展示当前用户有权访问的记忆与文档来源。
- [x] 历史对话按当前用户和 workspace 隔离，可创建、恢复和归档。
- [x] 桌面侧栏收起、悬停、焦点和移动端抽屉均无溢出或重叠。

## Verification

- 自动化检查：`make check`。
- API 集成：subscriptions/credits 并发、升级幂等、FAMILY membership、diagram 私有/共享、
  conversation 隔离和撤权回归测试。
- Web 组件：套餐、余额、导航、框图、知识库、历史、默认头像和移动布局测试。
- 浏览器：登录、升级、创建家庭空间、保存框图、恢复历史、桌面 1440x900 和移动 390x844。
- 安全：`git diff --check`、gitleaks、OpenAPI 契约和真实 PostgreSQL migration check。

## Rollout and recovery

- 新迁移只增加 subscriptions、credit ledger、diagrams 表并扩展 workspace kind 约束；先迁移再
  部署应用。旧应用会忽略新表，但不能理解 FAMILY，因此回滚应用前应暂停创建家庭空间。
- downgrade 只在确认无需要保留的订阅/账本/图数据后执行；生产优先回滚应用并保留新增表。
- 部署前执行数据库备份；容器重建后验证 revision、首页、ready、登录和 credits API。

## Progress log

- 2026-08-07: 创建计划；确认现有 conversation API 可复用，现有 Web 尚未展示历史；确认
  InfMind 参考的侧栏分组和账户升级位置。
- 2026-08-07: 完成 M1；product brief 新增批准扩展，ADR-0007 固定内部订阅、FAMILY 权限
  复用、图引用撤权和 conversation 隔离，architecture overview 同步模块与数据模型。
- 2026-08-07: 完成 M2-M6；新增三项数据库迁移、billing/diagram API、成功后幂等扣费、
  FAMILY 协作空间、云知识库、深度调研、历史恢复及对应 API/Web 回归测试。
- 2026-08-07: 完成 M7；修复 React Flow 画布高度约束，在 1440x900 与 390x844 实际验证
  展开/收起侧栏、移动抽屉、套餐弹层、默认头像、知识库与框图节点，并重建本地容器。

## Decision log

- 2026-08-07: 使用内部订阅账本而非虚假支付；原因是未指定支付供应商和商业规则。
- 2026-08-07: 图使用 PostgreSQL JSON 节点/边加服务端引用校验，不引入图数据库；原因是当前
  规模和模块化单体约束不支持第二事实来源。
- 2026-08-07: FAMILY 复用 TEAM 权限模型；原因是家庭与团队只需要语义区别，不应复制一套
  membership 实现。

## Completion summary

已交付订阅与 credits 账本、Plus / Pro / Ultra 内部升级、默认头像、FAMILY 空间、受权限保护的
思维导图/流程图、深度调研、云知识库、历史对话和 InfMind 风格响应式侧栏。`make check`
通过（Web 63 项、API 150 项），`make e2e` 通过，OpenAPI、迁移升降级、PostgreSQL 检索隔离、
桌面/移动浏览器交互和容器健康均已验证。本地地址为 `http://localhost:8080/`。

剩余边界：升级仍是内部订阅状态，不会发起真实支付；接入真实计费前仍需确定支付供应商、
价格、币种、税务、续费、退款和 webhook 对账规则。全仓 gitleaks 命中仅来自被 `.gitignore`
排除的本地 `.env` 与 Next.js 构建缓存，本次跟踪代码及文档无新增密钥。
