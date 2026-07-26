"use client";

import type { components } from "@memora/api-contract";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import {
  inferTimeRange,
  MessageRoute,
  parseVisibilityChoice,
  QueryRoute,
  ReportRoute,
  routeMessage,
} from "@/lib/conversation-router";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type Workspace = components["schemas"]["WorkspaceResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type ConversationSummary = components["schemas"]["ConversationSummaryResponse"];
type StoredMessage = components["schemas"]["ConversationMessageResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type Citation = components["schemas"]["EvidenceCitationResponse"];
type ModelStatus = components["schemas"]["ChatResponse"]["model_status"];

type AppView = "CHAT" | "MEMORIES";
type MemoryTab = "MINE" | "TEAM";

type ConversationMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: Citation[];
  memory?: Memory | null;
  meta?: string;
};

type PendingClarification = {
  kind: "TOPIC" | "TIME";
  route: QueryRoute;
};

type PendingColleague = {
  queryKind: QueryRoute["kind"];
  question: string;
  topic: string | null;
  timeRange: QueryRoute["timeRange"];
};

type CaptureDraft = {
  body: string;
  supersedesId: string | null;
};

type MemoryCommand = Extract<
  MessageRoute,
  { kind: "SHARE_LATEST" | "UNSHARE_LATEST" | "DELETE_LATEST" | "SUPPLEMENT_LATEST" }
>;

const demoAccounts = [
  { name: "Alex", email: "alex@memora.local" },
  { name: "Blair", email: "blair@memora.local" },
  { name: "Casey", email: "casey@memora.local" },
  { name: "Devon", email: "devon@memora.local" },
];

const welcomeMessage: ConversationMessage = {
  id: "welcome",
  role: "ASSISTANT",
  content:
    "把一个想法直接发给我，我会先问你存给自己还是共享给当前团队。你也可以问：“我之前记了什么？”",
  meta: "默认只检索你在当前空间中的记录",
};

let messageSequence = 0;

function messageId() {
  messageSequence += 1;
  return `message-${Date.now()}-${messageSequence}`;
}

function scopeLabel(
  scope: QueryRoute["scope"],
  members: WorkspaceMember[],
  authorId: string | null,
) {
  if (scope === "PERSONAL") return "仅检索你的记录";
  if (scope === "WORKSPACE") return "检索当前空间的团队共享";
  const member = members.find((item) => item.id === authorId);
  return `仅检索 ${member?.display_name ?? "指定同事"} 主动共享的记录`;
}

function modelLabel(status: ModelStatus) {
  if (status === "AVAILABLE") return "AI 回答";
  if (status === "DEGRADED") return "AI 暂时降级 · 证据模式";
  return "基础证据模式";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function memoryVisibilityLabel(memory: Memory) {
  return memory.visibility === "WORKSPACE" ? "团队共享" : "仅自己可见";
}

function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      M
    </span>
  );
}

function Icon({ children, size = 18 }: { children: React.ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </Icon>
  );
}

function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

function ChatIcon() {
  return (
    <Icon>
      <path d="M5 18.5 3.5 21v-5A8 8 0 1 1 6 18.5Z" />
    </Icon>
  );
}

function MemoryIcon() {
  return (
    <Icon>
      <path key="book" d="M6 4.5h10a2 2 0 0 1 2 2V20H8a2 2 0 0 1-2-2Z" />
      <path key="lines" d="M6 17.5h12M9 8h6M9 11h5" />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

function ChevronIcon() {
  return (
    <Icon size={15}>
      <path d="m8 10 4 4 4-4" />
    </Icon>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { data, response } = await api.POST("/auth/login", {
        body: { email, password },
      });
      if (!data || !response.ok) {
        setError(response.status === 429 ? "尝试次数过多，请稍后再试。" : "邮箱或密码错误。");
        return;
      }
      onLogin(data);
    } catch {
      setError("暂时无法连接 Memora，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <Logo />
          <span>Memora</span>
        </div>
        <div className="login-copy">
          <p className="overline">YOUR PRIVATE MEMORY</p>
          <h1 id="login-title">继续你的对话</h1>
          <p>把想法告诉 Memora，之后随时问回来。新记录始终先征求你的共享选择。</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? "正在登录…" : "继续"}
          </button>
        </form>
        <details className="demo-accounts">
          <summary>本地测试账号</summary>
          <div className="demo-account-list">
            {demoAccounts.map((account) => (
              <button key={account.email} type="button" onClick={() => setEmail(account.email)}>
                <span>{account.name}</span>
                <small>{account.email}</small>
              </button>
            ))}
          </div>
        </details>
        <p className="login-footnote">默认私有 · 明确共享 · 回答附带来源</p>
      </section>
    </main>
  );
}

function CitationList({
  citations,
  onOpenMemory,
}: {
  citations: Citation[];
  onOpenMemory: (memoryId: string) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <div className="source-list" aria-label={`回答来源，共 ${citations.length} 条`}>
      <p className="source-heading">来源 · {citations.length}</p>
      <div className="source-grid">
        {citations.map((citation, index) => (
          <button
            className="source-card"
            type="button"
            key={citation.memory_id}
            onClick={() => onOpenMemory(citation.memory_id)}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{citation.author.display_name}</strong>
              <time dateTime={citation.created_at}>{formatDate(citation.created_at)}</time>
              <p>{citation.excerpt}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function WorkspaceSidebar({
  user,
  workspaces,
  conversations,
  activeWorkspace,
  activeConversationId,
  activeView,
  open,
  collapsed,
  switching,
  onClose,
  onToggleCollapsed,
  onSelectView,
  onSelectConversation,
  onNewConversation,
  onSwitchWorkspace,
  onCreateWorkspace,
  onLogout,
}: {
  user: CurrentUser;
  workspaces: Workspace[];
  conversations: ConversationSummary[];
  activeWorkspace: Workspace | null;
  activeConversationId: string | null;
  activeView: AppView;
  open: boolean;
  collapsed: boolean;
  switching: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onSelectView: (view: AppView) => void;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onSwitchWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => Promise<boolean>;
  onLogout: () => void;
}) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceName.trim()) return;
    const created = await onCreateWorkspace(workspaceName);
    if (created) {
      setWorkspaceName("");
      setCreatingWorkspace(false);
      setWorkspaceMenuOpen(false);
    }
  }

  return (
    <>
      <button
        className={`sidebar-scrim ${open ? "is-visible" : ""}`}
        type="button"
        aria-label="关闭导航栏"
        onClick={onClose}
      />
      <aside
        className={`workspace-sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""}`}
        aria-label="Memora 导航"
      >
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand">
              <Logo />
              <span>Memora</span>
            </div>
            <button
              className="icon-button collapse-button"
              type="button"
              aria-label={collapsed ? "展开导航栏" : "收起导航栏"}
              onClick={onToggleCollapsed}
            >
              <Icon>
                <path d={collapsed ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} />
              </Icon>
            </button>
            <button
              className="icon-button mobile-close"
              type="button"
              aria-label="关闭导航栏"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>

          <div className="workspace-switcher">
            <button
              type="button"
              className="workspace-trigger"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((value) => !value)}
            >
              <span className={`workspace-glyph ${activeWorkspace?.kind.toLowerCase() ?? ""}`}>
                {activeWorkspace?.kind === "PERSONAL" ? user.display_name.slice(0, 1) : "W"}
              </span>
              <span className="workspace-trigger-copy">
                <small>{activeWorkspace?.kind === "PERSONAL" ? "个人空间" : "当前团队"}</small>
                <strong>{activeWorkspace?.name ?? user.workspace_name}</strong>
              </span>
              <ChevronIcon />
            </button>
            {workspaceMenuOpen ? (
              <div className="workspace-popover">
                <p>你的空间</p>
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    className={workspace.is_current ? "is-current" : ""}
                    disabled={switching}
                    onClick={() => {
                      setWorkspaceMenuOpen(false);
                      onSwitchWorkspace(workspace.id);
                    }}
                  >
                    <span className={`workspace-glyph ${workspace.kind.toLowerCase()}`}>
                      {workspace.kind === "PERSONAL" ? user.display_name.slice(0, 1) : "W"}
                    </span>
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>{workspace.kind === "PERSONAL" ? "只有你" : workspace.role}</small>
                    </span>
                    {workspace.is_current ? <i aria-label="当前空间" /> : null}
                  </button>
                ))}
                {creatingWorkspace ? (
                  <form className="workspace-create-form" onSubmit={submitWorkspace}>
                    <label htmlFor="workspace-name">新团队空间名称</label>
                    <input
                      id="workspace-name"
                      value={workspaceName}
                      maxLength={120}
                      autoFocus
                      onChange={(event) => setWorkspaceName(event.target.value)}
                      placeholder="例如：Futura 产品组"
                    />
                    <div>
                      <button type="button" onClick={() => setCreatingWorkspace(false)}>
                        取消
                      </button>
                      <button type="submit" disabled={!workspaceName.trim() || switching}>
                        创建
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="create-workspace-button"
                    onClick={() => setCreatingWorkspace(true)}
                  >
                    <PlusIcon />
                    <span>创建团队空间</span>
                  </button>
                )}
              </div>
            ) : null}
          </div>

          <button className="new-chat-button" type="button" onClick={onNewConversation}>
            <PlusIcon />
            <span>新建对话</span>
          </button>

          <nav className="primary-navigation">
            <button
              type="button"
              className={activeView === "CHAT" ? "is-active" : ""}
              onClick={() => onSelectView("CHAT")}
            >
              <ChatIcon />
              <span>对话</span>
            </button>
            <button
              type="button"
              className={activeView === "MEMORIES" ? "is-active" : ""}
              onClick={() => onSelectView("MEMORIES")}
            >
              <MemoryIcon />
              <span>记忆库</span>
            </button>
          </nav>
        </div>

        <div className="conversation-history">
          <p>最近对话</p>
          {conversations.length === 0 ? (
            <span className="empty-history">这个空间还没有对话</span>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  activeView === "CHAT" && conversation.id === activeConversationId
                    ? "is-active"
                    : ""
                }
                onClick={() => onSelectConversation(conversation.id)}
                title={conversation.title}
              >
                <ChatIcon />
                <span>{conversation.title}</span>
              </button>
            ))
          )}
        </div>

        <details className="sidebar-account">
          <summary>
            <span>{user.display_name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{user.display_name}</strong>
              <small>{user.email}</small>
            </div>
            <ChevronIcon />
          </summary>
          <div>
            <p>{user.email}</p>
            <button type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </details>
      </aside>
    </>
  );
}

function MemoryLibrary({
  user,
  memories,
  tab,
  loading,
  error,
  onTabChange,
  onOpenMemory,
}: {
  user: CurrentUser;
  memories: Memory[];
  tab: MemoryTab;
  loading: boolean;
  error: string;
  onTabChange: (tab: MemoryTab) => void;
  onOpenMemory: (memoryId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const visibleMemories = memories.filter((memory) => {
    const inTab = tab === "MINE" ? memory.is_owner : memory.visibility === "WORKSPACE";
    return (
      inTab && memory.body.toLocaleLowerCase("zh-CN").includes(query.toLocaleLowerCase("zh-CN"))
    );
  });

  return (
    <section className="memory-library" aria-labelledby="memory-library-title">
      <div className="memory-library-header">
        <div>
          <p className="eyebrow">ORIGINAL RECORDS</p>
          <h2 id="memory-library-title">记忆库</h2>
          <span>查看当前空间中你有权访问的原始记录。</span>
        </div>
        <label className="memory-search">
          <span className="sr-only">搜索记忆</span>
          <Icon>
            <circle key="lens" cx="11" cy="11" r="6" />
            <path key="handle" d="m16 16 4 4" />
          </Icon>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索当前列表"
          />
        </label>
      </div>

      <div className="memory-tabs" role="tablist" aria-label="记忆范围">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "MINE"}
          className={tab === "MINE" ? "is-active" : ""}
          onClick={() => onTabChange("MINE")}
        >
          我的记忆
          <span>{memories.filter((memory) => memory.is_owner).length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "TEAM"}
          className={tab === "TEAM" ? "is-active" : ""}
          onClick={() => onTabChange("TEAM")}
        >
          团队共享
          <span>{memories.filter((memory) => memory.visibility === "WORKSPACE").length}</span>
        </button>
      </div>

      {tab === "TEAM" ? (
        <div className="permission-banner">
          <i />
          这里只包含成员主动共享到当前空间的记录，不包含任何成员的私有内容。
        </div>
      ) : (
        <div className="permission-banner private-banner">
          <i />
          这里是 {user.display_name} 在当前空间中的记录，包括私有和已共享内容。
        </div>
      )}

      {loading ? <div className="memory-state">正在读取记忆…</div> : null}
      {!loading && error ? (
        <div className="memory-state error-state" role="alert">
          {error}
        </div>
      ) : null}
      {!loading && !error && visibleMemories.length === 0 ? (
        <div className="memory-state">
          <MemoryIcon />
          <strong>{query ? "没有匹配的记录" : "这里还没有记录"}</strong>
          <span>
            {tab === "MINE" ? "回到对话告诉 Memora 一个想法。" : "团队成员主动共享后会出现在这里。"}
          </span>
        </div>
      ) : null}

      <div className="memory-grid">
        {visibleMemories.map((memory) => (
          <button
            className="memory-card"
            type="button"
            key={memory.id}
            onClick={() => onOpenMemory(memory.id)}
          >
            <div className="memory-card-topline">
              <span className={`visibility-badge ${memory.visibility.toLowerCase()}`}>
                <i />
                {memoryVisibilityLabel(memory)}
              </span>
              <time dateTime={memory.created_at}>{formatDate(memory.created_at)}</time>
            </div>
            <p>{memory.body}</p>
            <div className="memory-card-footer">
              <span>{memory.author.display_name}</span>
              <small>
                {memory.processing_status === "COMPLETED" ? "可语义检索" : "基础检索可用"}
              </small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function MemoryDrawer({
  memory,
  open,
  loading,
  error,
  deleting,
  onClose,
  onShareChange,
  onDelete,
}: {
  memory: Memory | null;
  open: boolean;
  loading: boolean;
  error: string;
  deleting: boolean;
  onClose: () => void;
  onShareChange: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`drawer-scrim ${open ? "is-visible" : ""}`}
        aria-label="关闭原始记忆"
        onClick={onClose}
      />
      <aside className={`memory-drawer ${open ? "is-open" : ""}`} aria-label="原始记忆详情">
        <header>
          <div>
            <p className="eyebrow">SOURCE MEMORY</p>
            <h2>原始记忆</h2>
          </div>
          <button className="icon-button" type="button" aria-label="关闭原始记忆" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {loading ? <div className="drawer-state">正在核验访问权限…</div> : null}
        {!loading && error ? (
          <div className="drawer-state error-state" role="alert">
            {error}
          </div>
        ) : null}
        {!loading && !error && memory ? (
          <div className="drawer-content">
            <div className="drawer-meta">
              <span className={`visibility-badge ${memory.visibility.toLowerCase()}`}>
                <i />
                {memoryVisibilityLabel(memory)}
              </span>
              <span>{memory.author.display_name}</span>
              <time dateTime={memory.created_at}>
                {new Intl.DateTimeFormat("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(new Date(memory.created_at))}
              </time>
            </div>
            <article>{memory.body}</article>
            <dl>
              <div>
                <dt>作者</dt>
                <dd>{memory.author.display_name}</dd>
              </div>
              <div>
                <dt>可见范围</dt>
                <dd>{memoryVisibilityLabel(memory)}</dd>
              </div>
              <div>
                <dt>检索状态</dt>
                <dd>
                  {memory.processing_status === "COMPLETED"
                    ? "关键词与语义检索可用"
                    : "关键词检索可用，语义处理进行中"}
                </dd>
              </div>
              {memory.supersedes_id ? (
                <div>
                  <dt>记录关系</dt>
                  <dd>这是对一条历史记录的追加补充</dd>
                </div>
              ) : null}
            </dl>
            {memory.is_owner ? (
              <div className="drawer-actions">
                <button type="button" onClick={() => onShareChange(memory)} disabled={deleting}>
                  {memory.visibility === "WORKSPACE" ? "改为仅自己可见" : "共享到当前团队"}
                </button>
                {confirmDelete ? (
                  <div className="drawer-delete-confirm">
                    <p>删除后正文和检索投影都会移除，无法在产品中恢复。</p>
                    <button type="button" onClick={() => setConfirmDelete(false)}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={deleting}
                      onClick={() => onDelete(memory)}
                    >
                      {deleting ? "正在删除…" : "确认删除"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="danger-link"
                    onClick={() => setConfirmDelete(true)}
                  >
                    删除这条记录
                  </button>
                )}
              </div>
            ) : (
              <p className="drawer-readonly">这条记录由团队成员共享，只有作者可以修改可见范围。</p>
            )}
          </div>
        ) : null}
      </aside>
    </>
  );
}

function WorkspaceApp({
  user,
  onUserChange,
  onLogout,
}: {
  user: CurrentUser;
  onUserChange: (user: CurrentUser) => void;
  onLogout: () => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("CHAT");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([welcomeMessage]);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [memoriesError, setMemoriesError] = useState("");
  const [pendingCapture, setPendingCapture] = useState<CaptureDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(
    null,
  );
  const [pendingColleague, setPendingColleague] = useState<PendingColleague | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [memoryTab, setMemoryTab] = useState<MemoryTab>("MINE");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMemory, setDrawerMemory] = useState<Memory | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [drawerDeleting, setDrawerDeleting] = useState(false);
  const conversationEnd = useRef<HTMLDivElement>(null);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.is_current) ??
    workspaces.find((workspace) => workspace.id === user.workspace_id) ??
    null;
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ?? null;

  const clearPendingState = useCallback(() => {
    setPendingCapture(null);
    setPendingDelete(null);
    setPendingClarification(null);
    setPendingColleague(null);
  }, []);

  const mapStoredMessages = useCallback((storedMessages: StoredMessage[]) => {
    return storedMessages.map<ConversationMessage>((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: [...message.citations],
      memory: message.memory,
      meta: message.memory
        ? memoryVisibilityLabel(message.memory)
        : message.status === "REDACTED"
          ? "来源已撤回或记录已删除"
          : undefined,
    }));
  }, []);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      const { data, response } = await api.GET("/conversations/{conversation_id}", {
        params: { path: { conversation_id: conversationId } },
      });
      if (!data || !response.ok) {
        setMessages([
          {
            id: messageId(),
            role: "ASSISTANT",
            content: "这个对话不存在，或已经不属于当前空间。",
            meta: "未加载历史",
          },
        ]);
        setActiveConversationId(null);
        return false;
      }
      setActiveConversationId(data.id);
      setMessages(data.messages.length > 0 ? mapStoredMessages(data.messages) : [welcomeMessage]);
      clearPendingState();
      return true;
    },
    [clearPendingState, mapStoredMessages],
  );

  const refreshConversations = useCallback(async () => {
    try {
      const { data } = await api.GET("/conversations");
      if (data) setConversations([...data]);
    } catch {
      // 当前对话仍可继续；侧栏会在下一次成功请求时刷新。
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.GET("/workspaces"),
      api.GET("/conversations"),
      api.GET("/workspace/members"),
      api.GET("/memories"),
    ])
      .then(async ([workspaceResult, conversationResult, memberResult, memoryResult]) => {
        if (!active) return;
        if (workspaceResult.data) setWorkspaces([...workspaceResult.data]);
        else setWorkspaceError("暂时无法读取空间列表。");
        const loadedConversations = conversationResult.data ? [...conversationResult.data] : [];
        setConversations(loadedConversations);
        if (memberResult.data) setMembers([...memberResult.data]);
        else setMembersError("暂时无法读取当前空间成员，个人记录仍可使用。");
        if (memoryResult.data) setMemories([...memoryResult.data]);
        else setMemoriesError("暂时无法读取当前空间的记忆。");
        const firstConversation = loadedConversations[0];
        if (firstConversation) {
          await loadConversation(firstConversation.id);
        }
      })
      .catch(() => {
        if (active) setWorkspaceError("暂时无法连接 Memora 工作区。");
      })
      .finally(() => {
        if (active) setWorkspaceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clearPendingState, loadConversation, user.workspace_id]);

  useEffect(() => {
    const target = conversationEnd.current;
    if (activeView === "CHAT" && typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, busy, activeView]);

  function appendMessage(message: Omit<ConversationMessage, "id">) {
    setMessages((current) => [...current, { ...message, id: messageId() }]);
  }

  async function startConversation() {
    setBusy(true);
    try {
      const { data, response } = await api.POST("/conversations", {
        body: { title: "新对话" },
      });
      if (!data || !response.ok) {
        setWorkspaceError("新对话创建失败，请稍后重试。");
        return null;
      }
      setConversations((current) => [data, ...current]);
      setActiveConversationId(data.id);
      setMessages([welcomeMessage]);
      clearPendingState();
      setActiveView("CHAT");
      setSidebarOpen(false);
      return data.id;
    } catch {
      setWorkspaceError("暂时无法创建新对话。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function ensureConversation() {
    if (activeConversationId) return activeConversationId;
    return startConversation();
  }

  async function selectConversation(conversationId: string) {
    if (busy || conversationId === activeConversationId) {
      setActiveView("CHAT");
      setSidebarOpen(false);
      return;
    }
    setBusy(true);
    try {
      await loadConversation(conversationId);
      setActiveView("CHAT");
      setSidebarOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function switchWorkspace(workspaceId: string) {
    if (busy || workspaceId === activeWorkspace?.id) return;
    setBusy(true);
    setDrawerOpen(false);
    setComposer("");
    clearPendingState();
    try {
      const activated = await api.POST("/workspaces/{workspace_id}/activate", {
        params: { path: { workspace_id: workspaceId } },
      });
      if (!activated.data || !activated.response.ok) {
        setWorkspaceError("无法切换到这个空间。");
        return;
      }
      const me = await api.GET("/auth/me");
      if (!me.data) {
        setWorkspaceError("空间已切换，但无法刷新账号状态。");
        return;
      }
      setSidebarOpen(false);
      onUserChange(me.data);
    } catch {
      setWorkspaceError("空间切换失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(name: string) {
    setBusy(true);
    try {
      const created = await api.POST("/workspaces", { body: { name } });
      if (!created.data || !created.response.ok) {
        setWorkspaceError("团队空间创建失败。");
        return false;
      }
      const activated = await api.POST("/workspaces/{workspace_id}/activate", {
        params: { path: { workspace_id: created.data.id } },
      });
      if (!activated.data || !activated.response.ok) {
        setWorkspaces((current) => [...current, created.data as Workspace]);
        setWorkspaceError("空间已创建，但暂时无法切换。");
        return false;
      }
      const me = await api.GET("/auth/me");
      if (me.data) onUserChange(me.data);
      return Boolean(me.data);
    } catch {
      setWorkspaceError("团队空间创建失败，请稍后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function openMemory(memoryId: string) {
    setDrawerOpen(true);
    setDrawerLoading(true);
    setDrawerError("");
    setDrawerMemory(null);
    try {
      const { data, response } = await api.GET("/memories/{memory_id}", {
        params: { path: { memory_id: memoryId } },
      });
      if (!data || !response.ok) {
        setDrawerError("这条原始记录已删除、撤回，或你不再有权访问。");
        return;
      }
      setDrawerMemory(data);
    } catch {
      setDrawerError("暂时无法读取原始记录。");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function changeDrawerVisibility(memory: Memory) {
    setDrawerLoading(true);
    try {
      const result =
        memory.visibility === "WORKSPACE"
          ? await api.POST("/memories/{memory_id}/unshare", {
              params: { path: { memory_id: memory.id } },
            })
          : await api.POST("/memories/{memory_id}/share", {
              params: { path: { memory_id: memory.id } },
            });
      if (!result.data || !result.response.ok) {
        setDrawerError("可见范围没有更新成功。");
        return;
      }
      setDrawerMemory(result.data);
      setMemories((current) =>
        current.map((item) => (item.id === result.data?.id ? result.data : item)),
      );
    } catch {
      setDrawerError("暂时无法更新可见范围。");
    } finally {
      setDrawerLoading(false);
    }
  }

  async function deleteDrawerMemory(memory: Memory) {
    setDrawerDeleting(true);
    try {
      const { response } = await api.DELETE("/memories/{memory_id}", {
        params: { path: { memory_id: memory.id } },
      });
      if (!response.ok) {
        setDrawerError("删除没有成功，记录仍然保留。");
        return;
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setDrawerOpen(false);
      setDrawerMemory(null);
      if (activeConversationId) await loadConversation(activeConversationId);
      await refreshConversations();
    } catch {
      setDrawerError("暂时无法删除，记录仍然保留。");
    } finally {
      setDrawerDeleting(false);
    }
  }

  async function askQuestion(route: QueryRoute, conversationId: string) {
    setBusy(true);
    try {
      const { data, response } = await api.POST("/chat/questions", {
        body: {
          conversation_id: conversationId,
          question: route.question,
          topic: route.topic,
          scope: route.scope,
          author_id: route.authorId,
          created_from: route.timeRange?.createdFrom ?? null,
          created_to: route.timeRange?.createdTo ?? null,
          evidence_limit: 8,
        },
      });
      if (!data || !response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content:
            response.status === 429
              ? "请求有点频繁，请稍后再问我。"
              : "这次没有完成。我没有保存或改动任何记录，请稍后重试。",
          meta: "请求失败",
        });
        return;
      }
      if (data.status === "NEEDS_CLARIFICATION") {
        const kind: PendingClarification["kind"] = data.answer.includes("日期") ? "TIME" : "TOPIC";
        setPendingClarification({ kind, route });
        appendMessage({ role: "ASSISTANT", content: data.answer, meta: "需要补充范围" });
        await refreshConversations();
        return;
      }
      setPendingClarification(null);
      appendMessage({
        role: "ASSISTANT",
        content: data.answer,
        citations: [...data.citations],
        meta: `${scopeLabel(route.scope, members, route.authorId)} · ${modelLabel(data.model_status)}`,
      });
      await refreshConversations();
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法连接 Memora。我没有保存或改动任何记录，请稍后重试。",
        meta: "连接失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function generateReport(route: ReportRoute) {
    if (!route.topic || !route.timeRange) return;
    setBusy(true);
    try {
      const { data, response } = await api.POST("/reports", {
        body: {
          scope: route.scope,
          author_id: route.authorId,
          topic: route.topic,
          created_from: route.timeRange.createdFrom,
          created_to: route.timeRange.createdTo,
          evidence_limit: 20,
        },
      });
      if (!data || !response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content:
            response.status === 429
              ? "报告请求有点频繁，请稍后再试。"
              : "这次报告没有生成成功。我没有改动任何记录，请稍后重试。",
          meta: "报告生成失败",
        });
        return;
      }
      const sections = data.sections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      appendMessage({
        role: "ASSISTANT",
        content: `${data.title}\n\n${data.summary}${sections ? `\n\n${sections}` : ""}`,
        citations: [...data.citations],
        meta: `${scopeLabel(route.scope, members, route.authorId)} · ${modelLabel(data.model_status)} · 显式时间范围`,
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法连接 Memora。这次报告没有生成，我也没有改动任何记录。",
        meta: "连接失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function dispatchQuery(route: QueryRoute, conversationId: string) {
    if (!route.topic) {
      setPendingClarification({ kind: "TOPIC", route });
      appendMessage({
        role: "ASSISTANT",
        content: "你想回顾哪个主题？如果希望查看全部记录，可以直接回复“全部”。",
        meta: "等待检索主题",
      });
      return;
    }
    if (route.kind === "REPORT") {
      if (!route.timeRange) {
        setPendingClarification({ kind: "TIME", route });
        appendMessage({
          role: "ASSISTANT",
          content: "报告需要明确时间范围。你可以回复“最近 7 天”，或“2026-07-01 到 2026-07-22”。",
          meta: "等待报告时间范围",
        });
        return;
      }
      await generateReport(route);
      return;
    }
    await askQuestion(route, conversationId);
  }

  async function saveCapture(visibility: "PRIVATE" | "WORKSPACE", conversationId: string) {
    if (!pendingCapture) return;
    const draft = pendingCapture;
    setBusy(true);
    try {
      const result = await api.POST("/memories", {
        body: {
          body: draft.body,
          supersedes_id: draft.supersedesId,
          conversation_id: conversationId,
        },
      });
      if (!result.data || !result.response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "这条内容没有保存成功。我保留了草稿，你可以重新选择保存范围。",
          meta: "未保存",
        });
        return;
      }
      const privateMemory = result.data;
      setMemories((current) => [privateMemory, ...current]);
      if (visibility === "WORKSPACE") {
        try {
          const shared = await api.POST("/memories/{memory_id}/share", {
            params: { path: { memory_id: privateMemory.id } },
          });
          if (!shared.data || !shared.response.ok) {
            setPendingCapture(null);
            appendMessage({
              role: "ASSISTANT",
              content: "OK，已保存，但团队共享没有成功。这条记录目前仍然仅你可见。",
              memory: privateMemory,
              meta: "已私有保存 · 共享失败",
            });
            await refreshConversations();
            return;
          }
          setPendingCapture(null);
          setMemories((current) =>
            current.map((memory) => (memory.id === shared.data.id ? shared.data : memory)),
          );
          appendMessage({
            role: "ASSISTANT",
            content: "OK，已保存并共享给团队。",
            memory: shared.data,
            meta: "团队共享",
          });
          await refreshConversations();
          return;
        } catch {
          setPendingCapture(null);
          appendMessage({
            role: "ASSISTANT",
            content: "OK，已保存，但团队共享没有成功。这条记录目前仍然仅你可见。",
            memory: privateMemory,
            meta: "已私有保存 · 共享失败",
          });
          await refreshConversations();
          return;
        }
      }
      setPendingCapture(null);
      appendMessage({
        role: "ASSISTANT",
        content: "OK，已保存。只有你可以看到。",
        memory: privateMemory,
        meta: "仅自己可见",
      });
      await refreshConversations();
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法连接 Memora。这条内容尚未保存，草稿仍在当前对话中。",
        meta: "未保存",
      });
    } finally {
      setBusy(false);
    }
  }

  function latestOwnedMemory() {
    return memories.find((memory) => memory.is_owner) ?? null;
  }

  async function executeMemoryCommand(command: MemoryCommand) {
    if (memoriesError) {
      appendMessage({ role: "ASSISTANT", content: memoriesError, meta: "没有执行操作" });
      return;
    }
    const memory = latestOwnedMemory();
    if (!memory) {
      appendMessage({
        role: "ASSISTANT",
        content: "你在当前空间还没有可以操作的记录。先告诉我一个想法吧。",
        meta: "没有执行操作",
      });
      return;
    }
    if (command.kind === "DELETE_LATEST") {
      setPendingDelete(memory);
      appendMessage({
        role: "ASSISTANT",
        content: `确认删除上一条记录吗？“${memory.body.slice(0, 80)}${memory.body.length > 80 ? "…" : ""}”`,
        meta: "删除后正文不可恢复",
      });
      return;
    }
    if (command.kind === "SUPPLEMENT_LATEST") {
      setPendingCapture({ body: command.body, supersedesId: memory.id });
      appendMessage({
        role: "ASSISTANT",
        content: "这条补充是存给自己，还是共享给团队？",
        meta: "尚未保存 · 将关联上一条记录",
      });
      return;
    }
    if (command.kind === "SHARE_LATEST" && memory.visibility === "WORKSPACE") {
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录已经共享给团队。",
        meta: "没有重复操作",
      });
      return;
    }
    if (command.kind === "UNSHARE_LATEST" && memory.visibility === "PRIVATE") {
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录本来就只有你可见。",
        meta: "没有重复操作",
      });
      return;
    }

    setBusy(true);
    try {
      const result =
        command.kind === "SHARE_LATEST"
          ? await api.POST("/memories/{memory_id}/share", {
              params: { path: { memory_id: memory.id } },
            })
          : await api.POST("/memories/{memory_id}/unshare", {
              params: { path: { memory_id: memory.id } },
            });
      if (!result.data || !result.response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "上一条记录的共享范围没有更新成功，请稍后重试。",
          meta: "操作失败",
        });
        return;
      }
      const updated = result.data;
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      appendMessage({
        role: "ASSISTANT",
        content:
          command.kind === "SHARE_LATEST"
            ? "OK，上一条记录已共享给团队。"
            : "OK，上一条记录已改为仅自己可见。",
        memory: updated,
        meta: command.kind === "SHARE_LATEST" ? "团队共享" : "仅自己可见",
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法更新上一条记录的共享范围，请稍后重试。",
        meta: "操作失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolveDelete(confirm: boolean, reply: string, appendReply = true) {
    if (!pendingDelete || busy) return;
    if (appendReply) appendMessage({ role: "USER", content: reply });
    if (!confirm) {
      setPendingDelete(null);
      appendMessage({ role: "ASSISTANT", content: "已取消删除。", meta: "记录未改动" });
      return;
    }
    const memory = pendingDelete;
    setBusy(true);
    try {
      const { response } = await api.DELETE("/memories/{memory_id}", {
        params: { path: { memory_id: memory.id } },
      });
      if (!response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "删除没有成功，记录仍然保留。",
          meta: "操作失败",
        });
        return;
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDelete(null);
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录已删除。",
        meta: "正文、conversation 副本与检索投影已移除",
      });
      await refreshConversations();
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法删除，记录仍然保留。",
        meta: "操作失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolveVisibility(visibility: "PRIVATE" | "WORKSPACE", reply: string) {
    if (busy || !pendingCapture) return;
    const conversationId = await ensureConversation();
    if (!conversationId) return;
    appendMessage({ role: "USER", content: reply });
    await saveCapture(visibility, conversationId);
  }

  async function processMessage(content: string, conversationId: string) {
    appendMessage({ role: "USER", content });

    if (pendingCapture) {
      const visibility = parseVisibilityChoice(content);
      if (!visibility) {
        appendMessage({
          role: "ASSISTANT",
          content: "请明确告诉我：“只存给自己”或“共享给团队”。在你选择前，我不会保存。",
          meta: "等待共享选择",
        });
        return;
      }
      await saveCapture(visibility, conversationId);
      return;
    }

    if (pendingDelete) {
      if (/^确认删除[。.!！]?$/.test(content.trim())) {
        await resolveDelete(true, content, false);
      } else if (/^(?:取消|不要删除|保留)[。.!！]?$/.test(content.trim())) {
        await resolveDelete(false, content, false);
      } else {
        appendMessage({
          role: "ASSISTANT",
          content: "请回复“确认删除”或“取消”。在你确认前，记录不会被删除。",
          meta: "等待删除确认",
        });
      }
      return;
    }

    if (pendingClarification) {
      if (pendingClarification.kind === "TIME") {
        const timeRange = inferTimeRange(content);
        if (!timeRange) {
          appendMessage({
            role: "ASSISTANT",
            content: "请给我明确时间，例如“最近 7 天”或“2026-07-01 到 2026-07-22”。",
            meta: "等待时间范围",
          });
          return;
        }
        const route = { ...pendingClarification.route, timeRange };
        setPendingClarification(null);
        await dispatchQuery(route, conversationId);
        return;
      }
      const route = { ...pendingClarification.route, topic: content.trim() };
      setPendingClarification(null);
      await dispatchQuery(route, conversationId);
      return;
    }

    if (pendingColleague) {
      const normalized = content.toLocaleLowerCase("zh-CN");
      const colleague = members.find(
        (member) =>
          member.id !== user.id &&
          normalized.includes(member.display_name.toLocaleLowerCase("zh-CN")),
      );
      if (!colleague) {
        appendMessage({
          role: "ASSISTANT",
          content: `请告诉我具体是哪位同事：${members
            .filter((member) => member.id !== user.id)
            .map((member) => member.display_name)
            .join("、")}。`,
          meta: "不会检索未指定成员",
        });
        return;
      }
      const route: QueryRoute = {
        kind: pendingColleague.queryKind,
        question: pendingColleague.question,
        topic: pendingColleague.topic,
        scope: "COLLEAGUE",
        authorId: colleague.id,
        timeRange: pendingColleague.timeRange,
      };
      setPendingColleague(null);
      await dispatchQuery(route, conversationId);
      return;
    }

    const route = routeMessage(content, members, user.id);
    if (route.kind === "CAPTURE") {
      setPendingCapture({ body: route.body, supersedesId: null });
      appendMessage({
        role: "ASSISTANT",
        content: "这条内容是存给自己，还是共享给团队？",
        meta: "尚未保存 · 当前空间",
      });
      return;
    }
    if (
      route.kind === "SHARE_LATEST" ||
      route.kind === "UNSHARE_LATEST" ||
      route.kind === "DELETE_LATEST" ||
      route.kind === "SUPPLEMENT_LATEST"
    ) {
      await executeMemoryCommand(route);
      return;
    }
    if (route.kind === "NEEDS_COLLEAGUE") {
      setPendingColleague(route);
      appendMessage({
        role: "ASSISTANT",
        content: `你想了解哪位同事？请告诉我名字：${members
          .filter((member) => member.id !== user.id)
          .map((member) => member.display_name)
          .join("、")}。`,
        meta: "先明确成员，再执行授权检索",
      });
      return;
    }
    await dispatchQuery(route, conversationId);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composer.trim();
    if (!content || busy) return;
    const conversationId = await ensureConversation();
    if (!conversationId) return;
    setComposer("");
    await processMessage(content, conversationId);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const showVisibilityChoices = pendingCapture !== null && !busy;
  const showDeleteChoices = pendingDelete !== null && !busy;
  const showColleagueChoices = pendingColleague !== null && !busy;

  return (
    <main className={`workspace-app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <WorkspaceSidebar
        user={user}
        workspaces={workspaces}
        conversations={conversations}
        activeWorkspace={activeWorkspace}
        activeConversationId={activeConversationId}
        activeView={activeView}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        switching={busy}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onSelectView={(view) => {
          setActiveView(view);
          setSidebarOpen(false);
        }}
        onSelectConversation={(conversationId) => void selectConversation(conversationId)}
        onNewConversation={() => void startConversation()}
        onSwitchWorkspace={(workspaceId) => void switchWorkspace(workspaceId)}
        onCreateWorkspace={createWorkspace}
        onLogout={onLogout}
      />

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <button
              className="icon-button mobile-menu"
              type="button"
              aria-label="打开导航栏"
              onClick={() => setSidebarOpen(true)}
            >
              <MenuIcon />
            </button>
            <div className="workspace-heading">
              <strong>
                {activeView === "MEMORIES" ? "记忆库" : (activeConversation?.title ?? "新对话")}
              </strong>
              <span>{activeWorkspace?.name ?? user.workspace_name}</span>
            </div>
          </div>
          <div className="header-context">
            {activeView === "CHAT" ? (
              <span className="scope-status">
                <i /> 默认检索我的记忆
              </span>
            ) : null}
            <span className="privacy-status">
              <i /> 新记录默认私有
            </span>
          </div>
        </header>

        {workspaceError ? (
          <div className="workspace-alert" role="alert">
            {workspaceError}
            <button type="button" onClick={() => setWorkspaceError("")}>
              关闭
            </button>
          </div>
        ) : null}

        {activeView === "MEMORIES" ? (
          <MemoryLibrary
            user={user}
            memories={memories}
            tab={memoryTab}
            loading={workspaceLoading}
            error={memoriesError}
            onTabChange={setMemoryTab}
            onOpenMemory={(memoryId) => void openMemory(memoryId)}
          />
        ) : (
          <>
            <section className="conversation" aria-label="与 Memora 的对话">
              <div className="conversation-inner">
                {messages.length === 1 && messages[0].id === "welcome" ? (
                  <div className="conversation-title">
                    <span className="assistant-orb">
                      <Logo />
                    </span>
                    <h1>今天想记下什么？</h1>
                    <p>记录一个想法，或者从当前空间找回过去。</p>
                  </div>
                ) : null}

                <div className="message-list" aria-live="polite">
                  {messages.map((message) => (
                    <article
                      className={`message message-${message.role.toLowerCase()}`}
                      key={message.id}
                    >
                      {message.role === "ASSISTANT" ? (
                        <span className="message-avatar">
                          <Logo />
                        </span>
                      ) : null}
                      <div className="message-content">
                        <p>{message.content}</p>
                        {message.memory ? (
                          <button
                            className="message-memory-link"
                            type="button"
                            onClick={() => void openMemory(message.memory?.id ?? "")}
                          >
                            <span>{memoryVisibilityLabel(message.memory)}</span>
                            查看原始记忆
                          </button>
                        ) : message.meta ? (
                          <small>{message.meta}</small>
                        ) : null}
                        {message.citations ? (
                          <CitationList
                            citations={message.citations}
                            onOpenMemory={(memoryId) => void openMemory(memoryId)}
                          />
                        ) : null}
                      </div>
                    </article>
                  ))}
                  {busy ? (
                    <div className="thinking" role="status" aria-label="Memora 正在处理">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : null}
                  {showVisibilityChoices ? (
                    <div className="quick-replies" aria-label="选择保存范围">
                      <button
                        type="button"
                        onClick={() => void resolveVisibility("PRIVATE", "只存给自己")}
                      >
                        只存给自己
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolveVisibility("WORKSPACE", "共享给团队")}
                      >
                        共享给团队
                      </button>
                    </div>
                  ) : null}
                  {showDeleteChoices ? (
                    <div className="quick-replies danger-replies" aria-label="确认删除">
                      <button type="button" onClick={() => void resolveDelete(true, "确认删除")}>
                        确认删除
                      </button>
                      <button type="button" onClick={() => void resolveDelete(false, "取消")}>
                        取消
                      </button>
                    </div>
                  ) : null}
                  {showColleagueChoices ? (
                    <div className="quick-replies" aria-label="选择同事">
                      {members
                        .filter((member) => member.id !== user.id)
                        .map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            onClick={async () => {
                              const conversationId = await ensureConversation();
                              if (conversationId) {
                                await processMessage(member.display_name, conversationId);
                              }
                            }}
                          >
                            {member.display_name}
                          </button>
                        ))}
                    </div>
                  ) : null}
                  {membersError ? (
                    <p className="inline-notice" role="alert">
                      {membersError}
                    </p>
                  ) : null}
                  <div ref={conversationEnd} />
                </div>
              </div>
            </section>

            <footer className="composer-dock">
              <form className="composer-form" onSubmit={handleSubmit}>
                <label className="sr-only" htmlFor="message-composer">
                  给 Memora 发消息
                </label>
                <textarea
                  id="message-composer"
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder="记录一个想法，或问：我之前记了什么？"
                  maxLength={10_000}
                  rows={1}
                  disabled={busy}
                />
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送"
                  disabled={busy || !composer.trim()}
                >
                  <SendIcon />
                </button>
              </form>
              <p>Enter 发送 · Shift + Enter 换行 · 新内容保存前会询问可见范围</p>
            </footer>
          </>
        )}
      </section>

      <MemoryDrawer
        key={drawerOpen ? (drawerMemory?.id ?? "loading") : "closed"}
        memory={drawerMemory}
        open={drawerOpen}
        loading={drawerLoading}
        error={drawerError}
        deleting={drawerDeleting}
        onClose={() => setDrawerOpen(false)}
        onShareChange={(memory) => void changeDrawerVisibility(memory)}
        onDelete={(memory) => void deleteDrawerMemory(memory)}
      />
    </main>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api
      .GET("/auth/me")
      .then(({ data }) => {
        if (active) setUser(data ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    try {
      await api.POST("/auth/logout");
    } finally {
      setUser(null);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen" aria-busy="true">
        <Logo />
        <span>正在打开 Memora…</span>
      </main>
    );
  }

  return user ? (
    <WorkspaceApp
      key={user.workspace_id}
      user={user}
      onUserChange={setUser}
      onLogout={() => void handleLogout()}
    />
  ) : (
    <LoginScreen onLogin={setUser} />
  );
}
