"""集中导入 ORM 模型，保证 API、worker 与迁移拥有相同的 Metadata。"""

from memora.assets.models import Asset
from memora.audit.models import AuditEvent
from memora.conversations.models import Conversation, Message, MessageCitation
from memora.identity.models import User, UserSession
from memora.jobs.models import Job
from memora.memories.models import Memory
from memora.retrieval.models import MemoryEmbedding
from memora.workspaces.models import Workspace, WorkspaceMembership

MODEL_TYPES = (
    AuditEvent,
    Asset,
    Conversation,
    Message,
    MessageCitation,
    User,
    UserSession,
    Job,
    Memory,
    MemoryEmbedding,
    Workspace,
    WorkspaceMembership,
)


def load_all_models() -> None:
    """导入模块即完成注册；显式函数让进程入口可声明这一前置条件。"""
    if not MODEL_TYPES:
        raise RuntimeError("Memora model registry is empty")
