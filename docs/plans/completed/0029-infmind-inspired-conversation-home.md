# InfMind-inspired conversation home polish

Status: completed
Owner: Codex
Last updated: 2026-08-11

## Outcome

让登录后的新对话首页在保持 Memora 品牌和现有功能的前提下，采用用户所示 InfMind
参考图的视觉密度、亮度层级和交互动效；左下账户区改为无外框的紧凑头像、套餐和升级入口。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 已批准对话作为首要界面、可切换主题、套餐入口和
  登录后新对话居中输入态。
- 相关架构与 ADR：本次不改变 OpenAPI、权限、workspace 隔离或 conversation 生命周期。
- 当前代码事实：账户区仍使用整块描边卡片；新对话首屏已有逐字与输入框入场动画，但
  宽度、光影和控件动态反馈与参考图存在明显差异。
- 外部参考：用户提供两张 InfMind 工作台截图；公开站点用于确认其暗色、高对比、低饱和
  的设计语言，不复制 InfMind 商标、图标或文案。

## Scope

### In scope

- 左下账户区去除外层边框和底色，缩小高度，保留头像、用户名、Plus Plan 与“升级”。
- 调整空对话标题、Logo、输入框尺寸、间距、亮度和暗色层级。
- 增加克制的分段入场、悬停、聚焦和按压反馈，并完整支持减少动态效果。
- 更新相关 Web 组件测试并做桌面与窄屏浏览器验证。

### Non-goals

- 不复制 InfMind 品牌资产、商标、功能导航或产品文案。
- 不修改 API、数据库、订阅计费规则、conversation 行为或公开营销首页。
- 不移除现有附件、模型、联网、历史对话和账户菜单功能。

## Design and boundaries

新样式只作用于 `Sidebar` 账户区和 `CaptureWorkspace` 的空对话状态。已有对话的底部
composer 保持相同功能与尺寸边界。动效只使用 CSS transform、opacity、filter 和 shadow，
不引入持续占用资源的脚本动画；系统或应用启用减少动态效果时直接呈现最终状态。

## Milestones

- [x] M1 — 完成账户区和空对话首屏样式；验证：组件测试与静态检查。
- [x] M2 — 验证入场、悬停、聚焦、按压、明暗主题与窄屏；验证：本地浏览器。
- [x] M3 — 完成全量检查并重新部署本地网页；验证：`make check` 与服务健康检查。

## Acceptance criteria

- [x] 左下账户区没有整块卡片边框或底色，头像、Plus Plan、升级入口完整可用。
- [x] 空对话首页在参考图比例下呈现更宽、更低、更明暗分明的输入区和匹配的标题层级。
- [x] 首屏入场、输入聚焦、按钮悬停/按压有连续而克制的动态反馈。
- [x] 减少动态效果设置与 `prefers-reduced-motion` 下没有隐藏或滞留元素。
- [x] 已有历史对话、附件、模型、联网、发送和账户菜单测试不回归。

## Verification

- 自动化检查：Web 定向测试、类型检查、lint、`make check`。
- 集成验证：本地容器重新构建，健康接口通过。
- 手工或浏览器验证：1280×720 与宽屏的新对话首屏、账户区、focus/hover、明暗主题。
- 安全与权限验证：无网络契约和权限代码改动；diff 不包含密钥或用户数据。

## Rollout and recovery

无迁移或契约变化。回滚只需恢复本次 Web 组件、样式和测试；容器旧镜像可继续使用现有数据。

## Progress log

- 2026-08-11: 完成参考图、公开站点和当前本地工作台对比；GitNexus 对 `Sidebar` 与
  `CaptureWorkspace` 的上游影响均为 LOW。
- 2026-08-11: 完成 1280×720、2048×1242 和 390×844 浏览器验证；账户 hover、composer
  focus、桌面比例与移动抽屉均符合验收。
- 2026-08-11: `make check` 通过（Web 86、API 184），本地 Compose 重新构建并通过
  `http://localhost:8080/health` 健康检查。

## Decision log

- 2026-08-11: 将用户所说“首页”解释为截图中的登录后新对话首页；公开营销首页不在范围内。
- 2026-08-11: 复刻视觉语言与动效节奏，不引入 InfMind 品牌资产或功能导航。

## Completion summary

左下账户卡片已替换为 48px 高的透明无框账户底栏，保留头像、用户名、Plus Plan、升级和
完整账户菜单。空对话首页使用更接近参考图的宽屏比例、宋体标题层级、低亮度环境光和
分段入场；composer、加号和升级按钮增加 hover/focus/press 反馈。所有改动均为 Web
呈现层，无 API、权限或数据行为变化。最终镜像已部署到本地 `localhost:8080`。
