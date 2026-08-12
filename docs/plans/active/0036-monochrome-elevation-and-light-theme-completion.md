# Monochrome Elevation and Light Theme Completion

Status: approved
Owner: Claude Code
Last updated: 2026-08-12

## Outcome

在不改变信息架构、导航入口和组件结构的前提下，把 Memora Web 的单色视觉体系执行到底：
清除所有绕过 token 的散落颜色与刻度值，使订阅界面回归纯单色；把浅色主题从"手工补丁层"
升级为一等公民（无闪屏、默认跟随系统、一键切换）；并在截图基线保护下，对全部界面
（对话、侧边栏、记忆库、团队记忆中心、各弹窗、公开落地页、移动端）做一轮视觉打磨。
用户可观察的结果：深浅两套主题在所有页面视觉一致且无加载闪烁；全应用除危险语义红色
和模型供应商品牌标志外无任何彩色；界面层级、留白与字号节奏更精致。

## Context and evidence

- 相关产品规则：`docs/product/brief.md` 默认私有与引用规则不受影响；本计划不触碰任何
  权限、共享或数据语义。
- 相关架构与 ADR：纯 Web 样式与主题层变更，不涉及 API、数据库或 AI 检索边界。
  按 `PLANS.md`，单层变更本不强制立计划，但因涉及全部界面与主题机制，仍以计划管理。
- 当前代码事实（基线：`codex/core-platform-optimization` @ `dc91fc9`，`make` Web 检查全绿，
  93/93 测试通过，生产构建成功）：
  - `apps/web/src/styles/tokens.css` 定义 96 个自定义属性；`--mono-rgb: 255,255,255` 驱动
    全部发丝线与遮罩透明度，是浅色主题反转机制的核心。
  - 11 个样式分区文件中存在 **225 处未走 token 的字面量 `rgba()`**（features.css 55、
    public.css 47、capture.css 36、theme-light.css 33 为重灾区），这些值无法随
    `--mono-rgb` 反转，导致 `theme-light.css` 存在 **101 条组件级手工补丁规则**。
  - 主题类在 `workbench-shell.tsx:948` 的 `useEffect` 中应用，浅色用户每次加载先看到深色
    闪屏（FOUC）；无 `prefers-color-scheme` 检测；切换入口埋在
    `account-settings-dialog.tsx:561`（三级深度）。
  - 单色体系中残留 **约 26 个彩色值**：`features.css:2773-3080` 的订阅蓝色簇
    （`#3158e6` / `#3e66f0` / `#5478ff` 等约 10 处，计划 0030 曾批准，与计划 0022 的单色
    要求矛盾）、`capture.css:451` 暖白标题 `#f4f3f0`、`capture.css:429` 蓝灰上下文
    chip `#b6c9e5`；合法保留项为 `--danger` 系列与供应商品牌标志
    （`model-picker.tsx` 中 OpenAI/Claude/Gemini 的 logo 渐变色）。
  - 391 处 `font-size` 中约 103 处（26%）绕过 `--fs-*` 刻度；286 处 `border-radius` 中
    约 83 处（29%）用裸 px 而非 `--r-*`。
  - 9 个响应式断点（360/520/620/680/760/820/900/1000/1040/1100px）散落在 4 个文件，
    `features.css` 与 `responsive.css` 重复定义 1100px 与 820px 规则；无统一断点约定。
  - 现有 Web 测试以语义查询为主（约 297 处 role 查询，仅 7 处 `querySelector`），
    忠实重样式下基本不受影响；`apps/web` 已有 Playwright e2e 脚手架（`e2e` script）。
  - GitNexus MCP 工具在本会话不可用，按符号级影响分析改由全量测试与截图对比代替。

## Scope

### In scope

- **Token 完整性清扫**：11 个样式文件中全部字面量 `rgba()` 改写为
  `rgba(var(--mono-rgb), α)` 或既有/新增语义 token；越过刻度的 font-size 与
  border-radius 归位到 `--fs-*` / `--r-*`（确有设计意图的值提升为命名 token）；
  合并 `features.css` 与 `responsive.css` 的重复媒体查询，并在 `tokens.css` 以注释
  声明规范断点集。
- **彻底单色**：移除订阅蓝色簇，"推荐 Pro" 卡片与额度表改用对比度、字重、强发丝线与
  抬升表面表达强调；暖白标题与蓝灰 chip 归入 token。危险红与供应商品牌标志保留。
- **浅色主题一等化**：`layout.tsx` head 内置阻塞式内联脚本（读 localStorage，缺省回退
  `prefers-color-scheme`，try/catch 兜底深色），先于首帧应用主题类，消除闪屏；
  `interface-theme.ts` 扩展为三态 `dark | light | system`（新用户默认 system，
  已存的显式选择保持不变），并补单元测试；侧边栏账户菜单增加一键主题切换，
  设置页保留完整三态单选组；token 反转生效后删除 `theme-light.css` 中可删除的
  组件补丁，仅保留确需不对称的规则（如浅色阴影透明度）并逐条注释缘由。
- **截图基线**：基于现有 Playwright 脚手架建立截图脚本，覆盖 6 个关键界面
  （新对话、我的记忆、团队记忆中心、设置/订阅弹窗、认证弹窗、公开落地页）×
  {1280 / 820 / 390}px × {深 / 浅} 两主题；每个里程碑前后重拍对比。
  移动端不单列界面，由 390px 宽度档覆盖。
- **逐界面视觉打磨**（在 token 体系内，新视觉语汇先落 token 再使用），顺序：
  1. 对话（新对话）：引导页字型、居中→停靠动效衔接、活动轨迹样式；
  2. 外壳与侧边栏：focus-visible 状态、发丝线一致性、空态；
  3. 我的记忆：时间线层级、记忆卡片语法、详情页 Markdown 阅读体验；
  4. 团队记忆中心：页签样式与图谱/分析页签的视觉一致性；
  5. 弹窗族：认证/设置/团队/订阅统一模态语法，单色 Pro 卡片在此落地；
  6. 公开落地页：单色打磨、入场动效节制、reduced-motion 对等；
  7. 移动端：抽屉、间距、触控目标全量复查。

### Non-goals

- 不改变信息架构与一级导航；不恢复或删除 `RESEARCH` / `INSIGHTS` 等隐藏视图
  （沿用计划 0031 的 hide-don't-delete 决定）。
- 不拆分 `workbench-shell.tsx`，不做组件结构重构。
- 不新增运行时依赖；不引入 Tailwind 或组件库。
- 不触碰 API、OpenAPI 契约、数据库或权限语义。
- 不伪造订阅计费内容（价格、折扣、账期），延续计划 0020/0030 约束。
- 不复刻 InfMind 商标、图标或文案，参考仅限密度与层级。

## Assumptions and open questions

- [x] 基线为 `codex/core-platform-optimization` 最新提交 `dc91fc9`（2026-08-12 已与远端核对一致）。
- [x] 全单色（含订阅界面）；由用户于 2026-08-12 明确选定，推翻 0030 的蓝色特批。
- [x] 浅色主题一等化并默认跟随系统；已存显式主题选择不迁移、不清除。
- [x] 结构零改动；视觉工作全部落在样式层与被重样式组件的 className/标记内。
- [ ] "推荐 Pro" 卡片的具体单色强调方案（对比度 + 字重 + 强发丝线 + 表面抬升的组合）
  需在 M3 截图评审时与用户确认一版。
- [ ] 落地页入场动效的节奏与幅度是否下调，待 M7 截图评审决定。

## Design and boundaries

### 主题启动与状态

- 存储沿用 `memora.interface.theme`，合法值扩展为 `dark | light | system`；
  键缺失视同 `system`。
- 阻塞脚本行为：读取存储值 → 显式 `dark`/`light` 直接应用；`system` 或缺失时按
  `matchMedia("(prefers-color-scheme: light)")` 决定；任何异常兜底深色。
  应用方式与现状一致（`html.memora-theme-light` 类 + `data-memora-theme`），
  React 侧 `interface-theme.ts` 与脚本读写同一契约，不出现双源。
- `system` 态监听 `prefers-color-scheme` 变化实时跟随；显式态不监听。

### 颜色与刻度边界

- 原始颜色值只允许出现在两处：`tokens.css` 的 token 定义（`.privacy-dot` 现存的一处
  组件字面量一并归位），以及 `theme-light.css` 顶部的 token 覆写块（浅色 token 值本身
  必须是原始颜色）；两文件的组件级规则与其余全部文件只允许 `var(--…)` 与
  `rgba(var(--mono-rgb), α)`。
- 彩色允许清单仅两项：`--danger` 系列；`model-picker.tsx` 内联 SVG 品牌标志。
- 验收以 grep 审计为准（见 Verification），新增偏离必须先加 token。

### 失败与回退策略

- 每个里程碑单独提交、`make check` 全绿后才进入下一个；任何视觉回归以里程碑为
  粒度 `git revert`。
- 截图对比发现非预期差异时，先修复再继续，不带病推进。
- 主题脚本异常时页面表现为现状（深色默认），无功能损失。

## Milestones

- [x] M1 — 截图基线脚本与首版基线（6 界面 × 3 宽度 × 2 主题）；验证：脚本可重复运行，
  产物齐全。
- [ ] M2 — Token 完整性清扫（rgba/字号/圆角/断点）；验证：grep 审计通过，
  `make check` 全绿，截图对比仅出现预期内微差。
- [ ] M3 — 彻底单色（订阅蓝色簇移除、散落彩值归位）；验证：彩色 grep 仅剩允许清单，
  Pro 卡片新样式截图经用户确认。
- [ ] M4 — 浅色主题一等化（阻塞脚本、三态偏好、账户菜单快捷切换、补丁层删减、
  `interface-theme` 单元测试）；验证：浅色硬刷新无深色闪帧，system 态跟随系统切换，
  浅色全界面截图审查通过。
- [ ] M5 — 对话与外壳/侧边栏打磨；验证：截图对比 + 既有测试全绿。
- [ ] M6 — 记忆库与团队记忆中心打磨；验证：截图对比 + 既有测试全绿。
- [ ] M7 — 弹窗族、落地页与移动端打磨；验证：截图对比 + 既有测试全绿 +
  390×844 浏览器走查。

## Acceptance criteria

- [ ] `apps/web/src/styles/` 除 `tokens.css` 外无任何原始颜色字面量
  （`grep -E 'rgba\(\s*[0-9]|#[0-9a-fA-F]{3,8}'` 复核，允许清单除外）。
- [ ] 全应用除危险语义与供应商品牌标志外无彩色；订阅界面为纯单色。
- [ ] `theme-light.css` 组件补丁规则数量降到个位数且逐条有注释说明不对称原因。
- [ ] 浅色主题用户硬刷新任何页面均无深色闪帧；无存储偏好的新用户跟随系统主题。
- [ ] 账户菜单可一键切换主题；设置页三态单选组工作正常且被测试覆盖。
- [ ] 字号与圆角声明全部走 `--fs-*` / `--r-*` 或命名 token；断点集中且无重复定义。
- [ ] 既有 93 个 Web 测试全绿，新增 `interface-theme` 测试通过，`make check` 通过。
- [ ] 6 个关键界面在 3 宽度 × 2 主题共 36 张截图经审查确认，打磨里程碑逐个对照基线评审。
- [ ] `prefers-reduced-motion` 行为与现状对等，不因打磨退化。

## Verification

- 自动化检查：`make check`（format / lint / typecheck / test / contract-check / build）。
- 集成验证：Playwright 截图脚本按 6 界面 × {1280/820/390} × {深/浅} 产出并逐里程碑对比。
- 手工或浏览器验证：桌面与 390×844 移动端走查；浅色硬刷新闪屏检查；系统主题切换跟随检查。
- 安全与权限验证：不涉及权限语义变更；确认资产与头像等受权限保护的 URL 未因样式改动改变
  加载方式。

## Rollout and recovery

纯 Web 静态资源变更，无数据库迁移、无 API 变更、无部署顺序约束。按里程碑逐个提交，
回滚即 revert 对应提交；主题偏好存储向后兼容（旧值 `dark`/`light` 语义不变），
回滚后新值 `system` 被旧代码按缺省深色处理，无数据损坏风险。

## Progress log

- 2026-08-12: 并行子代理完成产品、组件、设计轨迹与技术栈四路勘察（基于 main），随后
  发现远端 `codex/core-platform-optimization` 已完成组件化拆分与单色改版，经用户确认
  切换基线至该分支 `dc91fc9`；分支健康验证全绿（安装/类型/lint/93 测试/生产构建）。
- 2026-08-12: 用户确认四项方向决策（提升现有单色气质、全表面范围、彻底单色、浅色主题
  一等化、结构零改动），设计经分节评审通过，计划成文。
- 2026-08-12: M1 完成。本机无 Docker 守护进程，经 colima 启动（VM 镜像与 PyPI 轮子在受限
  网络下改走镜像源并按官方校验和验证，`apps/api/Dockerfile` 增加 `PYPI_INDEX` 构建参数、
  默认值保持官方源不变）。截图基线 42 张全部产出（7 屏 × 3 宽 × 深/浅），Playwright 6/6
  通过，Web 全量门禁绿。基线截图已确认浅色主题下"有什么可以帮助您的?"标题因
  `capture.css` 硬编码 `#f4f3f0` 近乎不可见——M2/M3 目标问题的实证。审计脚本
  `scripts/audit-styles.sh` 落地，当前 378 处原始颜色违规为 M2 工作清单。

## Decision log

- 2026-08-12: 基线选 `codex` 分支而非 `main`；原因：分支已完成本计划原第一阶段
  （组件化 + token 分区 + 浅色雏形），在 main 上重做必然与远端冲突；被放弃方案：
  基于 main 重做拆分。
- 2026-08-12: 彻底单色，移除订阅蓝色簇；原因：用户选定，且 0022 单色主张与 0030 蓝色
  特批矛盾需收敛；被放弃方案：保留单一"商业蓝"token、全应用重新引入强调色。
- 2026-08-12: 浅色主题一等化（阻塞脚本 + 三态 + 快捷切换）；原因：现状 FOUC 与手工
  补丁层是最大质量缺口；被放弃方案：深色优先维持现状、删除浅色主题。
- 2026-08-12: 结构零改动；原因：用户选定最快到达视觉工作，且尊重 0031 hide-don't-delete；
  被放弃方案：清理不可达视图、拆分 workbench-shell。
- 2026-08-12: 不引入 Tailwind/组件库；原因：现有 token 体系纪律良好，问题在执行一致性
  而非技术选型，且仓库有最小依赖与依赖发布时长门槛约束；被放弃方案：Tailwind + shadcn 迁移。

## Completion summary

（完成后填写。）
