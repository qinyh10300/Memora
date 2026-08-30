# Development account one-click login

Status: completed
Owner: Codex
Last updated: 2026-08-30

## Outcome

本地登录窗口直接展示 Alex、Blair、Casey、Devon 四个开发账号；用户点击任一账号后无需
输入邮箱或密码即可建立安全的数据库 session 并进入工作台。普通邮箱密码登录与注册继续保留，
生产环境不暴露测试账号，也不能调用开发直登能力。

## Context and evidence

- 产品规则：四个 seed 账号用于开发验收；公开注册用户不自动进入测试工作区。
- 架构与 ADR：认证继续使用服务端不透明 session 和 HttpOnly Cookie；ADR-0009 要求新增认证
  方式不能破坏密码登录，生产不得暴露短时或开发凭据。
- 当前代码事实：登录弹窗已有折叠的测试账号列表，但点击仅填写邮箱；当前数据库为空且
  `SEED_DEVELOPMENT_DATA_ENABLED` 未启用。
- 影响分析：GitNexus 对 `AuthDialog` 与现有 `demoAccounts` 返回 LOW、无直接调用者；由于变更
  位于认证入口，仍按高敏感路径增加生产反向测试、未配置账号测试和浏览器验收。

## Scope

### In scope

- 新增服务端开发账号发现与直登接口，只返回显示名和邮箱，不返回或接受密码。
- 接口仅在 `APP_ENV=development`、`SEED_DEVELOPMENT_DATA_ENABLED=true` 且独立的
  `DEVELOPMENT_QUICK_LOGIN_ENABLED=true` 时可用；其他配置返回 404。
- 登录弹窗直接展示四个可点击账号，点击后显示进行中状态并自动进入工作台。
- 保留普通登录、注册、限流、session Cookie 和工作区选择行为。
- 启用并幂等创建本机四个 seed 账号，重新生成 OpenAPI 客户端并重部署 API/Web。

### Non-goals

- 不为生产环境增加免密登录，不把 seed 密码写入前端、API 响应、日志或新文档。
- 不修改现有密码、验证码、注册、权限或记忆可见性语义。
- 不创建数据库迁移，不清空或重建数据库卷。
- 不提交、推送或公开部署。

## Assumptions and open questions

- [x] 一次点击指在登录弹窗中点击账号卡片后直接进入工作台。
- [x] 普通邮箱密码表单继续保留，便于非 seed 用户登录。

## Design and boundaries

API 从服务端 seed 配置生成允许列表，GET 只返回当前数据库中已存在、活动且拥有 workspace
membership 的账号；POST 只接受该允许列表中的邮箱，并复用现有 session 创建与首个 workspace
选择规则。客户端不保存 seed 密码。生产配置拒绝启用 development seed 或 quick login；运行时
同时要求 development 环境、seed 开关和独立 quick-login 开关，形成三重门禁。

Web 打开登录弹窗时读取可用开发账号；若接口 404 或返回空列表，不渲染快捷入口。点击账号
期间禁用重复提交并显示明确状态；失败时保留普通登录表单和可操作错误提示。

## Milestones

- [x] M1 — 开发直登 API 与安全反向测试完成；验证：API identity 定向测试。
- [x] M2 — 登录弹窗一键账号 UI 与回归测试完成；验证：Web page 定向测试和类型检查。
- [x] M3 — 本机 seed、重部署与浏览器验收完成；验证：四账号按钮、点击直登、session 恢复和健康端点。

## Acceptance criteria

- [x] 登录弹窗直接显示 Alex、Blair、Casey、Devon 四个账号。
- [x] 点击任一账号无需填写邮箱或密码即可进入工作台。
- [x] 前端 bundle、API 响应和日志不包含 seed 密码。
- [x] development seed、quick-login 任一未启用或环境不是 development 时，发现与直登接口均返回 404。
- [x] 非 seed 邮箱不能通过开发直登接口创建 session。
- [x] 普通密码登录和注册测试继续通过。
- [x] 本机 Web/API healthy，页面仅绑定 loopback。

## Verification

- 自动化检查：API identity、Web page、格式、lint、类型、OpenAPI contract、生产构建。
- 集成验证：本机 PostgreSQL seed 幂等性、四账号计数、session Cookie 与 `/auth/me`。
- 手工或浏览器验证：四张账号卡片、点击直登、进入工作台、退出后再次直登。
- 安全与权限验证：生产/禁用反向测试、非允许账号拒绝、无密码响应与无敏感日志。

## Rollout and recovery

先保留当前 API/Web 镜像回退标签，再构建新镜像。启用本地 seed 配置并运行幂等 seed 后，
只重建 API 与 Web；数据库 schema 不变。失败时恢复旧镜像并关闭
`DEVELOPMENT_QUICK_LOGIN_ENABLED` 和 `SEED_DEVELOPMENT_DATA_ENABLED`，已有四个开发账号可
保留或按明确授权另行清理。若开发直登曾意外对非本机网络暴露，应立即关闭入口、撤销 seed
用户活动 session，并轮换会话密钥和 seed 密码后审计访问日志。

## Progress log

- 2026-08-30: 完成产品、架构、ADR、认证实现与测试基线调查；确定采用服务端开发允许列表，
  不把密码嵌入前端。
- 2026-08-30: GitNexus 影响分析为 LOW；人工提升为认证高敏感路径并增加反向门禁验收。
- 2026-08-30: 完成三重配置门禁、服务端账号允许列表、成功请求限流和 session 复用；API 定向
  测试 36 项通过。
- 2026-08-30: 完成四账号卡片、快捷登录状态、失败回退、移动端聚焦和请求取消；Web 页面定向
  测试 74 项通过。
- 2026-08-30: 将 Compose 与示例配置默认端口收紧到 loopback，并增加 quick-login 启用时拒绝
  非 loopback 发布端口的门禁；`make dev` 和 `make check` 强制执行，后台启动文档要求先检查，
  安全正向与多种非 loopback 反向回归测试通过。
- 2026-08-30: 幂等 seed 两次，结果从 `4/8` 创建变为 `0/0`；数据库最终为 4 users、5
  workspaces、8 memberships，schema 保持 `20260810_0023`。
- 2026-08-30: 重建并重启 API、worker、Web 和 proxy；健康端点通过，端口为
  `127.0.0.1:8080/8443`，前端镜像和服务日志未发现 seed 密码标记。
- 2026-08-30: 浏览器桌面点击 Alex 后直接进入且刷新恢复 session；390×844 视口四卡可见，
  点击 Devon 直接进入；控制台无 warning/error。
- 2026-08-30: `make check` 完整通过：Web 114 项、API 195 项、格式、lint、类型、OpenAPI、
  两套检索评测和生产构建全部通过。

## Decision log

- 2026-08-30: 不让账号卡片自动填入默认密码；原因是前端 bundle 不应携带认证凭据。
- 2026-08-30: 使用独立 development-only 直登接口；原因是它能在服务端验证环境、seed 开关、
  账号允许列表、活动状态和 workspace membership，并复用现有 session Cookie。

## Completion summary

已交付仅限本机开发环境的四账号一键登录。客户端只拿到服务端允许列表中的账号标识、显示名
和邮箱；点击后复用既有数据库 session，不接收或保存密码。普通密码登录和注册保持不变。

本机已部署最终镜像并保留 `memora-api:pre-0041-20260830`、
`memora-worker:pre-0041-20260830` 和 `memora-web:pre-0041-20260830` 回退标签。无数据库迁移；
常规回退保留 seed 数据并关闭 quick-login 开关。`make dev`、`make check`、默认配置、本机配置
和后台启动文档均强制或要求端口安全检查；操作者仍可显式绕过仓库入口直接调用 Docker Compose，
但生产配置会拒绝启用开发直登。
