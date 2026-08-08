"""集中导入 ORM 模型，保证 API、worker 与迁移拥有相同的 Metadata。"""

from memora.agent.models import AgentEvent, AgentExecution
from memora.alignment.models import (
    AlignmentPosition,
    AlignmentPositionSource,
    AlignmentTopic,
    DecisionRecord,
)
from memora.assets.models import Asset
from memora.audit.models import AuditEvent
from memora.billing.models import CreditLedgerEntry, CreditReservation, Subscription
from memora.conversations.models import Conversation, Message, MessageCitation
from memora.diagrams.models import Diagram
from memora.documents.models import (
    DocumentChunk,
    DocumentPage,
    DocumentParseJob,
    MemoryDocumentCitation,
)
from memora.identity.models import EmailVerificationChallenge, User, UserSession
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.reports.models import GeneratedReport, ReportSource, ReportSubscription
from memora.retrieval.models import MemoryEmbedding
from memora.visuals.models import VisualGenerationJob, VisualProject, VisualSource, VisualVersion
from memora.workspaces.models import Workspace, WorkspaceJoinRequest, WorkspaceMembership

MODEL_TYPES = (
    AgentExecution,
    AgentEvent,
    AlignmentTopic,
    AlignmentPosition,
    AlignmentPositionSource,
    DecisionRecord,
    AuditEvent,
    Asset,
    Subscription,
    CreditLedgerEntry,
    CreditReservation,
    Conversation,
    Message,
    MessageCitation,
    Diagram,
    DocumentParseJob,
    DocumentPage,
    DocumentChunk,
    MemoryDocumentCitation,
    User,
    UserSession,
    EmailVerificationChallenge,
    Job,
    Memory,
    MemoryEmbedding,
    GeneratedReport,
    ReportSource,
    ReportSubscription,
    Workspace,
    WorkspaceJoinRequest,
    WorkspaceMembership,
    VisualProject,
    VisualGenerationJob,
    VisualVersion,
    VisualSource,
)


def load_all_models() -> None:
    """导入模块即完成注册；显式函数让进程入口可声明这一前置条件。"""
    if not MODEL_TYPES:
        raise RuntimeError("Memora model registry is empty")
