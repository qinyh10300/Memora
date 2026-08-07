# ADR-0008: AI Native visuals, persistent reports, and team alignment

Status: Accepted

Date: 2026-08-07

## Context

Memora 已有授权记忆、对话、报告生成、受保护资产、手工知识框图和 credits，但没有可恢复的
AI 绘图任务、图片模型边界、持久报告或团队观点确认。新能力会把原始记忆转化为长期保存的
衍生内容，因此只在生成前检查权限不足以阻止撤回共享后的泄漏。

## Decision

1. 科研绘图使用两条生成路径：结构化图由 `ChatModelPort` 输出受限 graph JSON，确认后进入
   现有 React Flow 编辑器；开放式科研图片通过供应商无关的 `ImageGenerationPort` 生成。
2. 图片模型、聊天模型、套餐门槛和真实 provider model ID 由服务端注册表配置。前端只展示
   服务端声明的可用性，不根据产品名称假定供应商已支持。
3. visual、report、alignment 和 decision 全部保存在 PostgreSQL，并通过显式来源表关联 memory。
   图片继续保存为受保护 asset；不提供无鉴权静态链接。
4. 所有生成入口先按当前身份、workspace 和 visibility 授权来源；读取、共享和导出衍生结果时
   再次授权。任一来源失效时，对无权用户隐藏整个固化结果。
5. 长任务使用持久 job 和安全阶段事件。事件只公开“检索来源、生成结构、调用模型、校验、保存”
   等状态，不保存或展示隐藏推理。
6. credits 在任务入队时原子预留；成功结算，失败、取消或超时释放。reservation、job 和账本使用
   稳定幂等键，避免并发透支和重复扣费。
7. 报告默认私有，只引用用户当前有权访问的原始记忆。成员报告仅使用目标成员主动共享到当前
   workspace 的内容，不生成绩效、心理、性格或忠诚度判断。
8. 所有成员可创建对齐议题，每位成员只能确认、修正或撤回自己的观点。AI 未找到明确记录时
   返回 `NO_RECORDED_POSITION`；第一版只有 workspace OWNER 能发布最终 decision memory。
9. 决定、报告保存为记忆和观点修正都创建新记录；历史不原地覆盖，替代关系通过显式外键表达。

## Consequences

- 需要新增 additive migrations、worker job 处理、图片 adapter、credits reservation 以及独立的
  visuals、reports 和 alignment API/UI。
- 生成成功不等于永久可见；所有衍生内容读取路径都必须承担来源再授权成本。
- 未配置图片供应商时，结构图和其他工作台功能继续可用，图片生成入口明确显示不可用。
- PostgreSQL `BYTEA` 适合当前单机规模；达到资产容量或备份时长阈值后，必须通过新 ADR 决定
  是否迁移对象存储。

## Rejected alternatives

- 直接让图片模型生成所有思维导图：文字和连接关系不可可靠编辑或验证。
- 只在生成时检查来源：共享撤回后仍会通过旧报告或图片泄漏内容。
- 展示完整模型思维链：不可验证且可能泄漏内部提示词、隐私和供应商实现细节。
- 由管理员代成员确认观点：会把管理权限错误地解释为观点所有权。
