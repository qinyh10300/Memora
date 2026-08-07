from dataclasses import dataclass

from memora.visuals.schemas import VisualKind, VisualMode


@dataclass(frozen=True)
class VisualTemplate:
    id: str
    label: str
    description: str
    mode: VisualMode
    kind: VisualKind
    preview_tone: str


VISUAL_TEMPLATES: tuple[VisualTemplate, ...] = (
    VisualTemplate(
        id="scientific-illustration",
        label="科研插画",
        description="适合论文概念、机制和实验场景的清晰视觉",
        mode="IMAGE",
        kind="SCIENTIFIC",
        preview_tone="cobalt",
    ),
    VisualTemplate(
        id="mind-map",
        label="思维导图",
        description="从记忆提炼主题、分支和证据来源",
        mode="STRUCTURED",
        kind="MIND_MAP",
        preview_tone="cyan",
    ),
    VisualTemplate(
        id="flowchart",
        label="流程图",
        description="梳理步骤、条件、依赖和结果",
        mode="STRUCTURED",
        kind="FLOWCHART",
        preview_tone="indigo",
    ),
    VisualTemplate(
        id="timeline",
        label="时间线",
        description="按时间呈现观点、事件或项目演进",
        mode="STRUCTURED",
        kind="TIMELINE",
        preview_tone="slate",
    ),
)
