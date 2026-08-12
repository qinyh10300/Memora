# Blue Accent Restoration

Status: completed
Owner: Claude Code
Last updated: 2026-08-12

## Outcome

将蓝色恢复为全应用主强调色：订阅界面回到 0030 时期的蓝色视觉，且主按钮、导航激活态、
焦点环、页签指示、开关选中态与分栏把手反馈统一使用同一蓝色 token 族。与 0036 之前的
散落字面量不同，蓝色此次以一等 token 交付（深浅两主题各有校准值），色彩审计保持零违规。

## Context and evidence

- 0036 已完成全单色执行；用户在真机演示后复议："蓝色更好"，并选定"全应用强调色"范围
  （超出 0030 时期仅订阅界面的蓝色）。
- 0036 的 token 体系使本次变更为纯 token 层工作：新增 `--blue*` 族 + 触点规则替换，
  `scripts/audit-styles.sh` 审计约束不变。
- 历史蓝色取值（0030）：主填充 #3158e6 / 悬停 #3e66f0 / 亮部 #8aa8ff、#7b9bff 等。

## Scope

### In scope

- token：`--blue`(#3158e6)、`--blue-hover`、`--blue-bright`、`--blue-gradient-end`、
  `--blue-soft/line/glow/shadow`、`--on-blue`；浅色主题覆写 bright/gradient/soft/line/glow/shadow。
- 订阅界面完整恢复蓝色（Pro 卡、徽章、按钮、额度表、图标）。
- 主按钮族改蓝色实底（primary-action、send-button、settings-save、auth-submit、
  落地页 CTA、升级按钮悬停）；随之删除 theme-light 中黑色按钮簇补丁（蓝色双主题固定）。
- 导航/页签激活态图标与指示、设置开关选中态、分栏把手悬停反馈 → 蓝。
- 焦点环 outline → `--blue-bright`。

### Non-goals

- 危险语义红与品牌标志不变；正文/表面/发丝线仍为单色体系。
- 不动 IA、组件结构、API。

## Milestones

- [x] M1 — token 族 + 全部触点替换；验证：审计 0 违规、106 测试绿、42 截图两主题评审。

## Progress log

- 2026-08-12: 计划创建（0036 完成后的方向复议）。

## Decision log

- 2026-08-12: 蓝色升级为全应用强调色（用户选定，超越 0030 的订阅局部特批）；
  以 token 族实现而非恢复字面量，浅色主题首次获得校准蓝色变体。

## Completion summary

`--blue*` 九 token 族落地（填充色双主题固定，亮部/软色/线/辉光/阴影浅色单独校准）；
订阅界面 10 个块恢复 0030 蓝色视觉；主按钮族（primary-action、send-button、settings-save、
auth-submit、落地页 CTA、升级悬停）、导航激活指示与图标、设置页签图标、开关选中态、
团队记忆页签激活态、全局焦点环切换至蓝色。theme-light 中 5 条黑色按钮簇补丁因蓝色
双主题固定而删除（补丁层 20 → 15 条）。审计 0 违规、106/106 测试、构建绿；
42 张截图（artifacts/screenshots/0037-blue）两主题评审通过。
