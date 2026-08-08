# Sidebar polish, model picker, and email-code authentication

Status: completed
Owner: Codex
Last updated: 2026-08-09

## Outcome

侧栏空间与账户弹层使用一致且更紧凑的文字系统；聊天模型菜单可以正常显示和切换；后端在保留密码认证及四个开发账号的同时，支持通过邮箱验证码注册和登录。

## Scope

- 统一空间弹层与账户弹层的字号、字重、颜色、行高和纵向留白。
- 修复模型菜单已打开但被输入框裁切的问题，保持桌面和移动端可操作。
- 新增短时、单次使用的邮箱验证码挑战，只保存验证码摘要并限制发送与校验频率。
- 新增可配置 SMTP 发送边界；未配置时明确返回服务不可用，不在日志或 API 中暴露验证码。
- 新增验证码注册和验证码登录接口，继续保留现有密码注册、密码登录和四个 seed 账号。
- 增加数据库迁移、OpenAPI 契约、配置说明、安全测试和浏览器验证。

## Milestones

- [x] M1 - 完成侧栏弹层排版统一与密度调整。
- [x] M2 - 修复并验证聊天模型选择菜单。
- [x] M3 - 完成邮箱验证码模型、发送器、API 和迁移。
- [x] M4 - 完成自动化、真实数据库迁移和浏览器验证。

## Acceptance criteria

- [x] 两个侧栏弹层的正文使用相同字号、字重和颜色，纵向空间比原界面更紧凑。
- [x] 点击聊天模型按钮后菜单可见，可选择未锁定模型，点击外部或 Escape 可关闭。
- [x] 注册验证码只能用于规范化后的目标邮箱和 `REGISTER` 用途，成功后创建隔离个人空间并登录。
- [x] 登录验证码只能用于已有活动账号和 `LOGIN` 用途，成功后创建数据库 session。
- [x] 验证码过期、错误、超次数或重复使用均被拒绝，数据库和日志不保存明文验证码。
- [x] `/auth/register`、`/auth/login` 与四个开发 seed 账号继续工作。
- [x] SMTP 未配置或发送失败不会创建可用挑战，也不会影响密码登录。

## Verification

- `make check`: Web 69 项测试、API 176 项测试通过；格式、lint、类型检查、离线及 PostgreSQL 检索评估、错误脱敏、OpenAPI 契约检查和生产构建均通过。
- PostgreSQL migration: `20260809_0022` 完成 upgrade、downgrade、再次 upgrade，Alembic autogenerate 无 schema 漂移。
- Browser: 在 1440x900 桌面视口和 390x844 移动视口验证空间菜单、账户菜单及模型菜单；模型切换与滚动正常，无裁切。
- GitNexus: 对整棵未提交工作树执行 `detect_changes`；因包含此前多轮未提交改动，整体风险为 `MEDIUM`，识别到 1 条账户设置既有流程受影响，已由全量测试与浏览器检查覆盖。
- `git diff --check`: 通过。

## Rollout and recovery

迁移只新增 `email_verification_challenges` 表。旧应用可忽略该表；回滚应用时保留表即可，只有确认没有待完成验证码流程后才执行 schema downgrade。验证码邮件功能默认关闭，配置 SMTP 并显式启用后生效。
