from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

DiagramKind = Literal["MIND_MAP", "FLOWCHART", "TIMELINE"]
DiagramVisibility = Literal["PRIVATE", "WORKSPACE"]
DiagramNodeKind = Literal["MEMORY", "PERSON", "NOTE"]


class DiagramPosition(BaseModel):
    x: float = Field(ge=-100_000, le=100_000)
    y: float = Field(ge=-100_000, le=100_000)


class DiagramNodeInput(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    kind: DiagramNodeKind
    position: DiagramPosition
    memory_id: UUID | None = None
    user_id: UUID | None = None
    text: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def validate_reference(self) -> Self:
        if self.kind == "MEMORY" and (
            self.memory_id is None or self.user_id is not None or self.text is not None
        ):
            raise ValueError("记忆节点只能引用一条记忆")
        if self.kind == "PERSON" and (
            self.user_id is None or self.memory_id is not None or self.text is not None
        ):
            raise ValueError("成员节点只能引用一位空间成员")
        if self.kind == "NOTE":
            normalized = " ".join((self.text or "").split())
            if not normalized or self.memory_id is not None or self.user_id is not None:
                raise ValueError("注释节点需要文字且不能引用记忆或成员")
            self.text = normalized
        return self


class DiagramEdgeInput(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_.:-]+$")
    source: str = Field(min_length=1, max_length=80)
    target: str = Field(min_length=1, max_length=80)
    label: str | None = Field(default=None, max_length=120)

    @field_validator("label")
    @classmethod
    def normalize_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return " ".join(value.split()) or None


class DiagramWriteRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: DiagramKind = "MIND_MAP"
    visibility: DiagramVisibility = "PRIVATE"
    nodes: list[DiagramNodeInput] = Field(default_factory=list, max_length=120)
    edges: list[DiagramEdgeInput] = Field(default_factory=list, max_length=240)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("框图标题不能为空")
        return normalized

    @model_validator(mode="after")
    def validate_graph(self) -> Self:
        node_ids = [node.id for node in self.nodes]
        edge_ids = [edge.id for edge in self.edges]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("节点 ID 不能重复")
        if len(edge_ids) != len(set(edge_ids)):
            raise ValueError("连线 ID 不能重复")
        known_nodes = set(node_ids)
        if any(
            edge.source not in known_nodes or edge.target not in known_nodes for edge in self.edges
        ):
            raise ValueError("连线必须连接当前框图中的节点")
        return self


class DiagramNodeResponse(BaseModel):
    id: str
    kind: DiagramNodeKind
    position: DiagramPosition
    label: str
    memory_id: UUID | None = None
    user_id: UUID | None = None
    author_name: str | None = None
    available: bool = True


class DiagramOwnerResponse(BaseModel):
    id: UUID
    display_name: str


class DiagramResponse(BaseModel):
    id: UUID
    title: str
    kind: DiagramKind
    visibility: DiagramVisibility
    owner: DiagramOwnerResponse
    is_owner: bool
    nodes: list[DiagramNodeResponse]
    edges: list[DiagramEdgeInput]
    created_at: datetime
    updated_at: datetime
