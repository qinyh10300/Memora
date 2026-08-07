from dataclasses import dataclass


@dataclass(frozen=True)
class PublicAgentPlanStep:
    id: str
    title: str


@dataclass(frozen=True)
class PublicAgentPlan:
    steps: tuple[PublicAgentPlanStep, ...]

    @property
    def summary(self) -> str:
        titles = "、".join(step.title for step in self.steps)
        return f"公开计划 {len(self.steps)} 步：{titles}。"


def build_public_draft_plan(
    *,
    restore_original: bool,
    has_attachments: bool,
    model_available: bool,
    web_search_requested: bool,
    web_search_available: bool,
    save_requested: bool,
) -> PublicAgentPlan:
    steps = [PublicAgentPlanStep(id="validate", title="校验账号与输入边界")]
    if restore_original:
        steps.extend(
            (
                PublicAgentPlanStep(id="restore", title="恢复当前会话原话"),
                PublicAgentPlanStep(id="output", title="返回可编辑草稿"),
            )
        )
        return PublicAgentPlan(steps=tuple(steps))
    if has_attachments:
        steps.append(PublicAgentPlanStep(id="attachments", title="读取已授权附件"))
    if model_available:
        steps.append(PublicAgentPlanStep(id="retrieval", title="检索已授权个人记忆"))
    if web_search_requested and web_search_available:
        steps.append(PublicAgentPlanStep(id="web-search", title="查询可验证网页来源"))
    if model_available:
        steps.append(PublicAgentPlanStep(id="model", title="调用所选模型整理草稿"))
    else:
        steps.append(PublicAgentPlanStep(id="fallback", title="执行本地安全降级"))
    if save_requested and model_available:
        steps.append(PublicAgentPlanStep(id="save", title="校验授权后保存私有记忆"))
    steps.append(PublicAgentPlanStep(id="output", title="返回草稿与公开执行结果"))
    return PublicAgentPlan(steps=tuple(steps))
