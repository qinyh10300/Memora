# Rich Markdown Chatbot, attachments, and model selection

Status: in progress
Owner: Codex
Last updated: 2026-07-30

## Outcome

将 Memora 的“记录想法”升级为接近 ChatGPT 和 Codex 体验的 Markdown Chatbot
工作台：用户可以在同一个输入框中输入文本、粘贴图片、添加图片或 PDF 等附件、
控制联网、选择模型，并让 AI 修改右侧 Markdown。图片保存后必须长期可见；PDF 等
非图片附件只作为当前轮或草稿上下文，不直接嵌入 Markdown。正式记忆仍只在用户点击
保存后写入。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 和
  `docs/product/minimum-viable-product-requirements.md` 已批准个人 Markdown 草稿、
  图片理解、联网搜索、显式保存和默认私有边界。
- 相关架构与 ADR：`docs/architecture/overview.md` 要求 OpenAPI 契约、可替换 AI
  provider 端口、服务端授权过滤；ADR-0003 要求记忆正文不可原地覆盖。
- 当前代码事实：
  - `apps/web/src/app/page.tsx` 已有图片按钮、待发送图片预览、三态联网下拉和
    `clipboardData.files` 粘贴处理。
  - `apps/api/src/memora/api/drafts.py` 的 `POST /drafts/chat` 已支持当前轮图片、
    授权个人记忆证据和 `AUTO | REQUIRED | DISABLED` 联网模式。
  - 当前 Markdown 草稿和记忆详情仍是纯 `textarea`，没有 Markdown 图片资产插入、
    预览和长期图片访问控制。
  - 当前聊天模型只从 `AI_CHAT_MODEL` 环境变量读取，请求中没有用户可选模型字段。
  - 当前图片只在本轮发送给模型，不进入数据库或对象存储，保存后无法长期可见。

## Scope

### In scope

- 图片长期保存：PNG、JPEG、WEBP 图片可由粘贴、选择或拖拽加入草稿，并以
  Markdown 图片语法插入正文。
- 受权限保护的图片资产：图片保存后可随 Markdown 长期显示；未授权用户不能访问。
- 多类型附件：第一版支持图片和 PDF。图片可嵌入 Markdown；PDF 只进入 Chatbot
  上下文或被 AI 摘要到 Markdown，不以附件形式出现在正式 Markdown 中。
- ChatGPT/Codex 式输入区：统一承载文本、附件、工具调用状态、联网模式、模型选择、
  发送状态、附件预览和错误提示。
- 模型选择：下方提供模型选择器，服务端返回可用模型及能力；`POST /drafts/chat`
  接收稳定的模型别名并在服务端校验。
- 统一模型注册表：以同一套配置描述聊天、图片和联网模型，而不是为每种能力维护
  独立散落配置。
- 工具调用编排：模型可在服务端允许的工具集中自动选择联网、检索个人记忆、读取附件、
  更新草稿或保存记忆。
- 保存边界：`save_memory` 可作为模型工具开放，但只有用户本轮明确表达“帮我保存 /
  保存到记忆库 / 记下来”等保存意图时，后端才允许执行。模糊表达或普通陈述不得保存。
- 回归测试覆盖权限、图片长期可见、PDF 上下文、联网、模型能力和失败保留草稿。

### Non-goals

- 不做通用网盘、文件夹、全文附件库或团队共享附件。
- 不把 PDF 原文嵌入 Markdown；只允许 AI 抽取或总结为用户可编辑的 Markdown。
- 不做音频、视频、压缩包、Office 文档或网页离线归档。
- 不做浏览器自动化、代码执行沙箱或真正的 Codex 代码代理能力；本阶段只追求
  ChatGPT/Codex 风格的输入、附件、模型和联网体验。
- 不允许未授权用户通过静态 URL、日志、提示词或引用访问私有图片或附件。

## Assumptions and open questions

- [x] 图片保存后必须长期可见。
- [x] 附件支持图片和 PDF 等多种格式，但 Markdown 中只放图片。
- [x] 整体体验接近 Codex 和 ChatGPT。
- [x] 同时支持聊天模型、图片模型和联网模型，并倾向统一接口配置。
- [x] 图片和 PDF 存储第一版是否使用 PostgreSQL 大对象/二进制列，还是本地磁盘
  `uploads/` 加数据库元数据。已选择 PostgreSQL `BYTEA`，便于当前单机部署随数据库备份。
- [x] PDF 第一版的最大页数和大小。单个 PDF 最大 20 MiB，当前轮最多抽取前 20 页、
  12,000 字符上下文，超限拒绝或截断。
- [x] 图片插入 Markdown 时的默认 alt 文本策略。使用文件名，允许用户后续编辑。
- [ ] 模型清单的初始别名、展示名和真实供应商模型名需要由部署环境确认。

## Design and boundaries

### Data lifecycle

1. 用户粘贴、选择或拖拽图片。
2. Web 先本地预览并进行类型和大小校验。
3. 需要长期显示的图片上传到新的受保护资产接口，服务端重新校验 MIME、魔数、大小、
   所属用户和当前个人 workspace。
4. 服务端保存资产元数据和文件位置，返回受权限保护的 Markdown URL。
5. Web 将 `![alt](url)` 插入当前光标位置或草稿末尾。
6. 用户点击“保存为我的记忆”后，正式保存的是包含图片 Markdown URL 的正文。
7. 读取记忆或草稿预览时，图片 URL 通过服务端鉴权后返回文件内容。
8. 删除记忆时，正文和向量按现有规则移除；若图片不再被任何当前用户可访问的活动
   Markdown 引用，则进入清理流程或立即删除，具体策略在实现前确认。

PDF 附件不走 Markdown 嵌入路径。它可以在当前轮发送给 Chatbot，由服务端抽取文本或
页级内容后作为不可信上下文交给模型。用户要求保留 PDF 信息时，AI 只把摘要、摘录或
结构化内容写入右侧 Markdown。

### Model registry

需要新增统一模型注册表，而不是继续只依赖单个 `AI_CHAT_MODEL`：

```json
[
  {
    "id": "balanced",
    "label": "Balanced",
    "provider": "openai-compatible",
    "provider_model": "gpt-5.6-terra",
    "capabilities": ["chat", "vision", "web_search"],
    "default": true
  },
  {
    "id": "fast-chat",
    "label": "Fast Chat",
    "provider": "openai-compatible",
    "provider_model": "gpt-4o-mini",
    "capabilities": ["chat"]
  },
  {
    "id": "vision",
    "label": "Vision",
    "provider": "openai-compatible",
    "provider_model": "gpt-5.6-terra",
    "capabilities": ["chat", "vision"]
  }
]
```

配置可以共用同一个 base URL、API key、timeout 和输出 token 上限。前端只看到
`id`、`label`、`capabilities` 和默认值；后端保留真实 provider model 和密钥。
embedding 模型仍属于内部检索投影，不作为用户下方模型选择项，除非后续产品明确需要
暴露。

`POST /drafts/chat` 接收 `model_id`。服务端根据注册表构造 Chat 或 WebSearch port：

- 只聊天：要求 `chat` capability。
- 带图片：要求 `vision` capability。
- 联网：要求 `web_search` capability 且全局联网开关启用。
- 模型不支持当前请求时返回可解释错误，Web 提示用户切换模型或关闭能力。

### Tool orchestration

个人 Markdown Chatbot 应从“后端用关键词决定是否搜索”逐步升级为“模型在受控工具集中
决策”。第一版工具集：

- `search_memories`：后端只返回当前用户、当前个人 workspace、当前可访问的活动记忆。
- `web_search`：优先使用 Responses API hosted tool；供应商不支持时降级为现有受控
  `WebSearchPort`，不改用任意网页抓取。
- `update_draft`：只更新当前未保存 Markdown 草稿。
- `save_memory`：创建个人私有记忆。后端必须在执行前检查本轮用户消息含明确保存意图；
  若不满足，返回工具拒绝结果并让模型解释“我已准备草稿，请你明确说保存后再执行”。

`save_memory` 不接受模型指定作者、workspace 或可见性；这些字段全部来自服务端
`Principal`，第一版固定保存为 `PRIVATE`。保存成功后返回新记忆 ID、创建时间和标题，
并清空或标记当前草稿为已保存。

### Permissions and privacy

- 资产必须绑定 `workspace_id`、`owner_id`、创建时间、内容类型、大小、状态和存储 key。
- 图片和 PDF 不得放在 Web `public/` 目录，也不能通过无需鉴权的静态 URL 暴露。
- 读取资产时必须验证当前 session、workspace membership、owner 或当前仍可访问的
  Markdown 引用。
- AI 输入中的图片、PDF 文本、网页证据和 Markdown 正文全部视为不可信数据，不能改变
  保存、删除、权限或模型选择规则。
- 日志和审计记录只保存资产 ID、类型、大小、模型和 token 用量，不保存图片 Base64、
  PDF 原文、Markdown 正文或提示词。

### UI behavior

- 输入框底部包含：附件按钮、联网模式、模型选择器、发送按钮。
- 图片可通过 `Ctrl+V`、文件选择和拖拽添加；粘贴处理需要同时支持
  `clipboardData.files` 和 `clipboardData.items`。
- Markdown 草稿区增加编辑/预览能力，预览中图片可渲染。
- 图片上传失败、模型不支持图片、PDF 超限、联网不可用时，提示应清楚且不清空草稿。
- 当用户选择不支持视觉的模型时，图片上传按钮禁用或提示切换模型。
- 当用户选择不支持联网的模型时，“本轮联网”不可选或提示切换模型。
- 当模型调用工具时，消息流中显示简短状态，例如“正在搜索网页”“正在保存记忆”。

## Milestones

- [x] M1 - 模型注册表、模型选择契约和基础工具调用编排；验证：API 测试、OpenAPI 生成、
  Web 模型下拉测试。
- [x] M2 - 受保护图片资产上传、读取和删除/清理边界；验证：权限集成测试和浏览器图片渲染。
- [x] M3 - Markdown 编辑/预览和图片插入体验；验证：组件测试、桌面和移动截图检查。
- [x] M4 - PDF 附件当前轮上下文；验证：PDF 类型/大小/文本抽取/失败降级测试。
- [x] M5 - ChatGPT/Codex 式输入区打磨和端到端验收；验证：`make check`、`make e2e`、
  浏览器粘贴图片、选择模型、强制联网、保存后重开记忆图片仍可见。

## Acceptance criteria

- [x] 用户可以 `Ctrl+V` 粘贴截图，图片出现在待发送附件或直接插入 Markdown。
- [x] 用户可以把图片插入 Markdown，并在预览中看到图片。
- [x] 保存记忆后，刷新页面或重新登录仍能看到 Markdown 中的图片。
- [x] 其他用户无法访问私有图片 URL。
- [x] 删除记忆后，图片不再能通过原 URL 被未授权或已失效上下文访问。
- [x] 用户可以附加 PDF，让 AI 基于 PDF 内容回答或更新 Markdown。
- [x] PDF 不会作为 Markdown 附件保存；只有用户确认后的 Markdown 正文会保存。
- [x] 下方模型选择器展示服务端允许的模型和能力。
- [x] 选择不支持图片的模型时，图片请求被前端限制或服务端拒绝且草稿保留。
- [x] 选择不支持联网的模型时，联网请求被前端限制或服务端拒绝且草稿保留。
- [x] 用户明确说“帮我保存”时，模型可调用 `save_memory`，系统创建个人私有记忆并显示保存回执。
- [x] 用户只是陈述想法或要求整理时，即使模型尝试调用 `save_memory`，后端也会拒绝执行。
- [x] 强制联网响应只展示实际使用且经过白名单校验的 HTTP(S) 来源。
- [x] AI、上传、PDF 抽取或联网失败都不会覆盖当前 Markdown 或自动创建 memory。

## Verification

- 自动化检查：`make check`，包含 API 单元/集成测试、Web 组件测试、OpenAPI 漂移检查、
  类型检查和构建。
- 集成验证：真实 PostgreSQL 中的资产元数据、权限矩阵、删除传播、模型能力校验。
- 手工或浏览器验证：粘贴截图、拖拽图片、Markdown 预览、PDF 提问、模型切换、联网搜索、
  保存后刷新和重新登录。
- 安全与权限验证：私有资产跨用户 403/404、URL 不在 `public/` 暴露、日志不含 Base64、
  PDF 原文或私有 Markdown 正文。

## Rollout and recovery

- 需要数据库迁移新增资产表；迁移前备份数据库。
- 如果使用本地磁盘存储，需要把上传目录纳入备份和部署卷，并文档化恢复顺序。
- 回滚应用时应保留资产表和文件，旧版前端会把 Markdown 图片 URL 当作普通 Markdown 文本；
  不应删除已上传资产。
- 模型注册表可兼容旧环境变量：没有新注册表时，从 `AI_CHAT_MODEL` 生成一个默认模型。
- 联网能力仍可通过全局 `AI_WEB_SEARCH_ENABLED=false` 关闭。

## Progress log

- 2026-07-30: 用户确认图片需长期可见，附件支持图片和 PDF 等格式，Markdown 中只放图片，
  体验目标接近 Codex/ChatGPT，并希望聊天、图片、联网模型用统一接口配置。
- 2026-07-30: 用户进一步确认希望模型具备自动调用工具能力，并允许开放 `save_memory`
  工具，但仅在用户明确要求保存时自动执行。
- 2026-07-30: 完成 M1 垂直切片：新增统一模型注册表、`GET /drafts/models`、`model_id`
  契约、OpenAI-compatible tool calling loop、受控 `web_search` 与 `save_memory` 工具，
  并在 Web 输入区加入模型选择器和自动保存回执。图片/PDF 长期附件仍在 M2-M4。
- 2026-07-30: 验证通过 `make check`；在临时禁用外部 AI key/model 的容器环境下通过
  `MEMORA_PUBLIC_URL=http://183.173.108.244:8080 make e2e`。当前 `.env` 的外部 provider
  配置会让报告生成等待远程调用，已在 E2E 后恢复容器到原配置。
- 2026-07-30: 完成 M2-M5：新增受保护 `assets` 表与上传/读取接口，图片上传后插入
  Markdown 并可预览，PDF 作为当前轮受保护附件抽取有限文本，删除最后一个引用的 memory
  会使相关图片资产失效。验证通过 `make check` 和临时禁用外部 AI 的 `make e2e`。

## Decision log

- 2026-07-30: 图片从“当前轮模型输入”升级为“可长期显示的受保护资产”；原因是
  Markdown 记忆保存后必须完整可回看。
- 2026-07-30: PDF 不直接嵌入 Markdown；原因是用户明确只在 Markdown 中放图片，
  PDF 更适合作为 AI 当前轮上下文并由用户确认摘要。
- 2026-07-30: 采用统一模型注册表；原因是聊天、视觉和联网本质上是同一模型接口的
  能力差异，前端应选择稳定别名，后端负责能力校验和供应商映射。
- 2026-07-30: `save_memory` 工具可以开放给模型；原因是这更接近 ChatGPT/Codex 的
  agent 体验。执行权仍由后端保存意图检测和服务端身份上下文约束，不能由模型单独决定。
- 2026-07-30: 第一版资产内容存入 PostgreSQL `BYTEA`；原因是当前单服务器测试版以
  PostgreSQL 为事实来源，避免新增文件卷备份/恢复顺序。后续如果图片/PDF 规模增长，
  可用新的迁移把 blob 外移到对象存储或受保护文件卷。

## Completion summary

M1-M5 已完成并通过自动化验证。后续可继续优化 PDF 抽取质量、图片资产清理策略和更完整
的 Markdown 渲染能力。
