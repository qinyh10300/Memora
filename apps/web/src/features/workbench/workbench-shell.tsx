"use client";

import {
  ArrowRight,
  BookOpenText,
  BrainCircuit,
  ChevronRight,
  Eye,
  EyeOff,
  FileClock,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  captureAgentReducer,
  INITIAL_CAPTURE_AGENT_STATE,
  isCaptureAgentActive,
  traceFromExecution,
} from "@/features/capture/agent-state";
import { CaptureWorkspace } from "@/features/capture/capture-workspace";
import {
  buildCompletedTrace,
  buildFailedTrace,
  buildLiveTrace,
  selectedDraftModelLabel,
  upsertTraceStep,
  willSearchWeb,
} from "@/features/capture/trace";
import { SubscriptionDialog } from "@/features/billing/subscription-dialog";
import { KnowledgeBaseWorkspace } from "@/features/knowledge/knowledge-base-workspace";
import { TeamIntelligenceWorkspace } from "@/features/insights/team-intelligence-workspace";
import { MemoryDetail, Timeline } from "@/features/library/memory-library";
import { ServerStateClient, serverStateKeys } from "@/features/server-state/query-client";
import { AccountSettingsDialog } from "@/features/settings/account-settings-dialog";
import type {
  AppView,
  ConversationSummary,
  CurrentUser,
  DraftDocumentAttachment,
  DraftDocumentCitation,
  DraftImageAttachment,
  DraftMessage,
  DraftModel,
  Memory,
  MemorySearchFilters,
  MemoryVisibility,
  PublicAuthMode,
  RevisionMode,
  Subscription,
  TeamAccessMode,
  WebSearchMode,
  Workspace,
  WorkspaceMember,
} from "@/features/shared/contracts";
import {
  EMPTY_MEMORY_SEARCH,
  INITIAL_DRAFT_MESSAGE as initialMessage,
  isCollaborativeWorkspace,
} from "@/features/shared/contracts";
import {
  CaptureIcon,
  CloseIcon,
  LibraryIcon,
  Logo,
  MenuIcon,
  UserAvatar,
} from "@/features/shared/icons";
import {
  clampNumber,
  formatDateTime,
  nextId,
  readStoredBoolean,
  readStoredNumber,
  storeBoolean,
  storeNumber,
} from "@/features/shared/utils";
import { TeamAccessDialog, TeamWorkspace } from "@/features/team/team";
import { VisualWorkspace } from "@/features/visuals/visual-workspace";
import {
  ResizableSplit,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_EXPANDED_WIDTH,
  SidebarResizeHandle,
} from "@/features/workbench/layout";
import { Sidebar } from "@/features/workspaces/sidebar";
import {
  api,
  cancelAgentExecution,
  DraftChatStreamError,
  getAgentExecution,
  streamDraftChat,
} from "@/lib/api";

const demoAccounts = [
  { name: "Alex", email: "alex@memora.local" },
  { name: "Blair", email: "blair@memora.local" },
  { name: "Casey", email: "casey@memora.local" },
  { name: "Devon", email: "devon@memora.local" },
];

function AuthDialog({
  mode,
  onClose,
  onModeChange,
  onAuthenticated,
}: {
  mode: PublicAuthMode;
  onClose: () => void;
  onModeChange: (mode: PublicAuthMode) => void;
  onAuthenticated: (user: CurrentUser) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const isRegister = mode === "REGISTER";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const activeElement = document.activeElement;
      const userIsEditing =
        activeElement instanceof HTMLElement &&
        activeElement.matches('input, textarea, select, [contenteditable="true"]');
      if (!userIsEditing) firstInputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (isRegister && password.length < 10) {
      setError("密码至少需要 10 个字符。");
      return;
    }
    if (isRegister && password !== passwordConfirm) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      const result = isRegister
        ? await api.POST("/auth/register", {
            body: { display_name: displayName, email, password },
          })
        : await api.POST("/auth/login", { body: { email, password } });
      if (!result.data || !result.response.ok) {
        if (result.response.status === 429) {
          setError("尝试次数过多，请稍后再试。");
        } else if (isRegister && result.response.status === 409) {
          setError("该邮箱已经注册，请直接登录。");
        } else if (isRegister && result.response.status === 422) {
          setError("请检查昵称、邮箱和密码是否有效。");
        } else {
          setError("邮箱或密码错误。");
        }
        return;
      }
      onAuthenticated(result.data);
    } catch {
      setError("暂时无法连接 Memora，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="auth-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <header className="auth-dialog-header">
          <div className="auth-dialog-brand">
            <Logo />
            <span>Memora</span>
          </div>
          <button type="button" aria-label="关闭账号窗口" onClick={onClose}>
            <X aria-hidden="true" size={18} strokeWidth={1.7} />
          </button>
        </header>

        <div className="auth-dialog-copy">
          <p>{isRegister ? "CREATE YOUR SPACE" : "WELCOME BACK"}</p>
          <h2 id="auth-dialog-title">{isRegister ? "创建个人空间" : "登录 Memora"}</h2>
          <span>
            {isRegister
              ? "注册后会立即创建一个只属于你的私有工作台。"
              : "继续整理你的草稿、记忆和思考脉络。"}
          </span>
        </div>

        <div className="auth-mode-tabs" role="tablist" aria-label="账号入口">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? "is-active" : ""}
            onClick={() => onModeChange("LOGIN")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? "is-active" : ""}
            onClick={() => onModeChange("REGISTER")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {isRegister ? (
            <label>
              <span>昵称</span>
              <input
                ref={firstInputRef}
                name="display_name"
                type="text"
                autoComplete="name"
                placeholder="你的名字"
                value={displayName}
                maxLength={120}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            <span>邮箱账号</span>
            <input
              ref={isRegister ? undefined : firstInputRef}
              name="email"
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              maxLength={320}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>密码</span>
            <span className="auth-password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={isRegister ? "至少 10 个字符" : "输入账号密码"}
                value={password}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {isRegister ? (
            <label>
              <span>确认密码</span>
              <input
                name="password_confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="再次输入密码"
                value={passwordConfirm}
                maxLength={128}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                required
              />
            </label>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-submit" type="submit" disabled={submitting}>
            <span>{submitting ? "请稍候…" : isRegister ? "创建并进入" : "登录并进入"}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </form>

        {!isRegister ? (
          <details className="demo-accounts">
            <summary>开发环境测试账号</summary>
            <div className="demo-account-list">
              {demoAccounts.map((account) => (
                <button key={account.email} type="button" onClick={() => setEmail(account.email)}>
                  <span>{account.name}</span>
                  <small>{account.email}</small>
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <p className="auth-footnote">
          <ShieldCheck aria-hidden="true" size={14} />
          密码经 Argon2 哈希保存，内容默认仅自己可见
        </p>
      </section>
    </div>
  );
}

function PublicLanding({ onAuthenticated }: { onAuthenticated: (user: CurrentUser) => void }) {
  const [authMode, setAuthMode] = useState<PublicAuthMode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openAuth = (mode: PublicAuthMode) => {
    setMenuOpen(false);
    setAuthMode(mode);
  };

  return (
    <main className="landing-page" id="landing-top">
      <header className="landing-nav">
        <a className="landing-brand" href="#landing-top" aria-label="Memora 首页">
          <Logo />
          <span>Memora</span>
        </a>
        <nav className={menuOpen ? "is-open" : ""} aria-label="首页导航">
          <a href="#landing-workflow" onClick={() => setMenuOpen(false)}>
            开始使用
          </a>
          <a href="#landing-features" onClick={() => setMenuOpen(false)}>
            产品功能
          </a>
          <a href="#landing-principles" onClick={() => setMenuOpen(false)}>
            工作方式
          </a>
          <a href="#landing-faq" onClick={() => setMenuOpen(false)}>
            常见问题
          </a>
        </nav>
        <div className="landing-nav-actions">
          <button className="landing-login-button" type="button" onClick={() => openAuth("LOGIN")}>
            登录
          </button>
          <button
            className="landing-start-button"
            type="button"
            onClick={() => openAuth("REGISTER")}
          >
            快速开始
          </button>
          <button
            className="landing-menu-button"
            type="button"
            aria-label={menuOpen ? "关闭首页导航" : "打开首页导航"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <button
            className="landing-announcement"
            type="button"
            onClick={() => openAuth("REGISTER")}
          >
            Memora 个人记忆工作台现已开放
            <ArrowRight aria-hidden="true" size={13} />
          </button>
          <h1 id="landing-title">
            <span>Memora</span>
            <span>让思考长期生长</span>
          </h1>
          <p>
            从一段随手记录，到可编辑的 Markdown 草稿，再到带时间与版本的个人记忆。 AI
            处理重复整理工作，最终保存权始终在你手里。
          </p>
          <div className="landing-hero-actions">
            <button type="button" onClick={() => openAuth("REGISTER")}>
              快速开始
            </button>
            <a href="#landing-features">了解更多</a>
          </div>
          <div className="landing-trust-row">
            <span className="landing-trust-marks" aria-hidden="true">
              <i>M</i>
              <i>#</i>
              <i>✓</i>
            </span>
            <span>
              <strong>默认私有</strong>
              用户确认后保存 · 原始记录可追溯
            </span>
          </div>
        </div>

        <div className="landing-product-stage" aria-label="Memora 产品界面预览">
          <div className="landing-stage-window">
            <div className="landing-stage-topbar">
              <div>
                <Logo />
                <strong>Memora</strong>
              </div>
              <span>gpt-5.6-terra</span>
              <small>默认私有</small>
            </div>
            <div className="landing-stage-body">
              <aside>
                <strong>个人空间</strong>
                <span className="is-active">
                  <CaptureIcon /> 记录想法
                </span>
                <span>
                  <LibraryIcon /> 记忆库
                </span>
                <small>所有新记忆仅你可见</small>
              </aside>
              <div className="landing-stage-chat">
                <p>把今天对产品方向的判断整理成一条可追溯记录。</p>
                <div>
                  <Sparkles size={14} />
                  <span>正在整理原始想法</span>
                </div>
                <blockquote>已保留你的原意，并把关键判断同步到右侧 Markdown。</blockquote>
              </div>
              <div className="landing-stage-editor">
                <header>
                  <span>Markdown 草稿</span>
                  <small>实时预览</small>
                </header>
                <code># 产品方向</code>
                <p>先验证个人记录和长期回顾，再逐步扩展协作能力。</p>
                <code>## 下一步</code>
                <p>- 验证保存意愿</p>
                <p>- 保留判断依据</p>
                <button type="button" tabIndex={-1}>
                  保存为我的记忆
                </button>
              </div>
            </div>
          </div>
          <div className="landing-stage-card is-memory">
            <FileClock aria-hidden="true" size={17} />
            <span>历史版本已保留</span>
            <strong>3 个思考节点</strong>
          </div>
          <div className="landing-stage-card is-source">
            <BookOpenText aria-hidden="true" size={17} />
            <span>回答引用原始记录</span>
            <strong>证据先于流畅</strong>
          </div>
        </div>
      </section>

      <section className="landing-foundation" aria-label="Memora 核心原则">
        <p>围绕长期个人记忆构建的 AI 工作流</p>
        <div>
          <span>
            <LockKeyhole size={16} /> Private
          </span>
          <span>
            <BookOpenText size={16} /> Markdown
          </span>
          <span>
            <FileClock size={16} /> Revisions
          </span>
          <span>
            <Search size={16} /> Retrieval
          </span>
          <span>
            <BrainCircuit size={16} /> AI Agent
          </span>
        </div>
      </section>

      <section className="landing-section landing-features" id="landing-features">
        <div className="landing-section-heading">
          <p>ONE WORKSPACE</p>
          <h2>重新定义个人知识工作流</h2>
          <span>
            记录、整理、检索和回顾不再散落在多个工具中。Memora 把思考发生的过程和最后
            保存的内容留在同一个工作台。
          </span>
        </div>

        <div className="landing-feature-showcase">
          <article>
            <div>
              <FileClock size={19} />
              <h3>随时记录，长期可见</h3>
              <p>对话先进入草稿，保存后按日期进入记忆库；刷新、退出和重新登录都不会丢失。</p>
            </div>
            <div className="landing-timeline-visual" aria-hidden="true">
              <span>今天</span>
              <i>
                <b />
                产品判断<strong>12:25</strong>
              </i>
              <span>7 月 30 日</span>
              <i>
                <b />
                Memora 图标与构建<strong>17:42</strong>
              </i>
              <i>
                <b />
                研究资料整理<strong>09:18</strong>
              </i>
            </div>
          </article>
          <article>
            <div>
              <BrainCircuit size={19} />
              <h3>一站式 Markdown Agent</h3>
              <p>让 AI 阅读图片与 PDF、联网核对信息、修改草稿；AI 可以工作，但不能替你保存。</p>
            </div>
            <div className="landing-agent-visual" aria-hidden="true">
              <span>
                <Search size={15} /> 检索个人记忆
              </span>
              <span>
                <Sparkles size={15} /> 整理为 Markdown
              </span>
              <span>
                <BookOpenText size={15} /> 保留来源链接
              </span>
              <i />
            </div>
          </article>
        </div>

        <div className="landing-capability-grid">
          <article>
            <LockKeyhole size={18} />
            <h3>默认私有</h3>
            <p>新账号只拥有自己的个人空间，记录不会自动分享给其他用户。</p>
          </article>
          <article>
            <BookOpenText size={18} />
            <h3>实时 Markdown</h3>
            <p>编辑区与预览同步，最终保存的是你确认后的清晰正文。</p>
          </article>
          <article>
            <FileClock size={18} />
            <h3>版本可追溯</h3>
            <p>更新当前记忆或保存为新版本，都不会静默覆盖历史判断。</p>
          </article>
          <article>
            <Search size={18} />
            <h3>个人记忆检索</h3>
            <p>回答先经过身份和可见性过滤，再引用你有权访问的原始记录。</p>
          </article>
          <article>
            <Sparkles size={18} />
            <h3>多模态整理</h3>
            <p>上传图片或 PDF，让 AI 提取、归纳并写入仍可继续编辑的草稿。</p>
          </article>
          <article>
            <BrainCircuit size={18} />
            <h3>动态工作过程</h3>
            <p>模型、搜索、附件读取和草稿同步过程会在对话中持续反馈。</p>
          </article>
        </div>
      </section>

      <section className="landing-workflow" id="landing-workflow">
        <div className="landing-workflow-copy">
          <p>FOCUS WITHOUT SWITCHING</p>
          <h2>你可以在聊天、笔记与检索间来回切换，但不必如此</h2>
          <span>从原始输入到正式记忆，所有中间状态都留在一个连续的工作面上。</span>
        </div>
        <div className="landing-workflow-track" aria-label="Memora 工作流程">
          <article>
            <span>01</span>
            <h3>说出想法</h3>
            <p>输入文字，或附加图片与 PDF。</p>
          </article>
          <ArrowRight aria-hidden="true" />
          <article>
            <span>02</span>
            <h3>AI 整理</h3>
            <p>查看过程，继续要求修改和核对。</p>
          </article>
          <ArrowRight aria-hidden="true" />
          <article>
            <span>03</span>
            <h3>确认保存</h3>
            <p>由你决定何时成为正式个人记忆。</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-principles" id="landing-principles">
        <div className="landing-section-heading">
          <p>MEASURABLE BY DESIGN</p>
          <h2>看得见的边界，有依据的结果</h2>
        </div>
        <div className="landing-stat-grid">
          <article>
            <strong>1</strong>
            <span>个连续工作台</span>
            <p>聊天、草稿和记忆库保持同一上下文。</p>
          </article>
          <article>
            <strong>100%</strong>
            <span>用户确认后保存</span>
            <p>AI 不会在你不知情时写入正式记忆。</p>
          </article>
          <article>
            <strong>0</strong>
            <span>条默认公开记录</span>
            <p>每个新想法从 PRIVATE 开始。</p>
          </article>
          <article>
            <strong>∞</strong>
            <span>持续演进的版本</span>
            <p>新判断补充历史，而不是抹去历史。</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-faq" id="landing-faq">
        <div className="landing-section-heading">
          <p>FAQ</p>
          <h2>常见问题</h2>
        </div>
        <div className="landing-faq-list">
          <details>
            <summary>
              Memora 和普通聊天机器人有什么不同？
              <ChevronRight size={17} />
            </summary>
            <p>
              聊天只是入口。Memora 同时维护可编辑
              Markdown、正式记忆、版本关系和经过授权过滤的个人检索。
            </p>
          </details>
          <details>
            <summary>
              AI 会自动保存我说过的所有内容吗？
              <ChevronRight size={17} />
            </summary>
            <p>
              不会。AI 只能更新草稿，只有你明确点击保存或明确发出保存命令后，内容才会进入记忆库。
            </p>
          </details>
          <details>
            <summary>
              注册后会加入其他人的团队空间吗？
              <ChevronRight size={17} />
            </summary>
            <p>不会。公开注册只创建你的个人空间，不会授予测试团队或任何其他用户数据的访问权。</p>
          </details>
          <details>
            <summary>
              我的密码和个人内容如何保护？
              <ChevronRight size={17} />
            </summary>
            <p>
              密码使用 Argon2 慢哈希保存，会话使用 HttpOnly
              Cookie；个人记忆在检索和生成前都应用服务端身份过滤。
            </p>
          </details>
          <details>
            <summary>
              可以修改已经保存的记忆吗？
              <ChevronRight size={17} />
            </summary>
            <p>可以。你可以更新当前时间线条目或另存为新版本，旧正文都会作为历史修订保留。</p>
          </details>
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <Logo />
          <p>YOUR MEMORY, IN MOTION</p>
          <h2>让每一次思考，都成为下一次判断的起点</h2>
          <button type="button" onClick={() => openAuth("REGISTER")}>
            开始使用 Memora
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="#landing-top">
          <Logo />
          <span>Memora</span>
        </a>
        <p>Personal Markdown Memory Workspace</p>
        <button type="button" onClick={() => openAuth("LOGIN")}>
          登录
        </button>
      </footer>

      {authMode ? (
        <AuthDialog
          key={authMode}
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
          onAuthenticated={onAuthenticated}
        />
      ) : null}
    </main>
  );
}

export function WorkbenchShell() {
  const [serverState] = useState(() => new ServerStateClient());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [view, setView] = useState<AppView>("CAPTURE");
  const [viewMotion, setViewMotion] = useState<"forward" | "back">("forward");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const lastExpandedSidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [teamAccessMode, setTeamAccessMode] = useState<TeamAccessMode | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memorySearchFilters, setMemorySearchFilters] =
    useState<MemorySearchFilters>(EMPTY_MEMORY_SEARCH);
  const [memorySearchActive, setMemorySearchActive] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryMarkdown, setMemoryMarkdown] = useState("");
  const [memoryBaseline, setMemoryBaseline] = useState("");
  const [revisions, setRevisions] = useState<Memory[]>([]);

  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [saveVisibility, setSaveVisibility] = useState<MemoryVisibility>("PRIVATE");
  const [savedVisibility, setSavedVisibility] = useState<MemoryVisibility | null>(null);
  const [draftDocumentCitations, setDraftDocumentCitations] = useState<DraftDocumentCitation[]>([]);
  const [messages, setMessages] = useState<DraftMessage[]>([initialMessage]);
  const [draftAgent, dispatchDraftAgent] = useReducer(
    captureAgentReducer,
    INITIAL_CAPTURE_AGENT_STATE,
  );
  const draftAbortControllerRef = useRef<AbortController | null>(null);
  const draftExecutionIdRef = useRef<string | null>(null);
  const refiningDraft = isCaptureAgentActive(draftAgent.phase);
  const draftActivity = refiningDraft ? draftAgent.trace : null;
  const [savingDraft, setSavingDraft] = useState(false);
  const [modelOptions, setModelOptions] = useState<DraftModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [visualSeed, setVisualSeed] = useState<{
    projectId: string;
    memoryIds: string[];
  } | null>(null);

  const [refiningMemory, setRefiningMemory] = useState(false);
  const [savingMode, setSavingMode] = useState<RevisionMode | null>(null);
  const [deletingMemory, setDeletingMemory] = useState(false);
  const [visibilityChanging, setVisibilityChanging] = useState(false);
  const [memoryAiStatus, setMemoryAiStatus] = useState("");
  const [toast, setToast] = useState("");
  const [toastLeaving, setToastLeaving] = useState(false);
  const toastTimers = useRef<number[]>([]);

  const showToast = useCallback((message: string) => {
    toastTimers.current.forEach(window.clearTimeout);
    toastTimers.current = [];
    setToastLeaving(false);
    setToast(message);
    // Start the exit animation first, then unmount once it has played.
    toastTimers.current.push(window.setTimeout(() => setToastLeaving(true), 3200));
    toastTimers.current.push(
      window.setTimeout(() => {
        setToast("");
        setToastLeaving(false);
      }, 3400),
    );
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const applySidebarLayout = useCallback((width: number, collapsed: boolean, persist = false) => {
    const nextWidth = collapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : clampNumber(width, SIDEBAR_MIN_EXPANDED_WIDTH, SIDEBAR_MAX_WIDTH);
    if (!collapsed) lastExpandedSidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    setSidebarCollapsed(collapsed);
    if (persist) {
      storeNumber("memora.sidebar.width", nextWidth);
      storeBoolean("memora.sidebar.collapsed", collapsed);
    }
  }, []);

  function collapseSidebar() {
    applySidebarLayout(SIDEBAR_COLLAPSED_WIDTH, true, true);
  }

  function expandSidebar() {
    applySidebarLayout(lastExpandedSidebarWidthRef.current, false, true);
  }

  function toggleSidebar() {
    if (sidebarCollapsed) expandSidebar();
    else collapseSidebar();
  }

  function resetSidebarWidth() {
    applySidebarLayout(SIDEBAR_DEFAULT_WIDTH, false, true);
  }

  function navigateTo(nextView: AppView) {
    if (nextView !== view) {
      setViewMotion(nextView === "LIBRARY" ? "forward" : "back");
      setView(nextView);
    }
    setSidebarOpen(false);
  }

  function updateCurrentUser(updatedUser: CurrentUser) {
    setUser(updatedUser);
    const updateAuthor = (memory: Memory) =>
      memory.author.id === updatedUser.id
        ? {
            ...memory,
            author: { ...memory.author, display_name: updatedUser.display_name },
          }
        : memory;
    setMemories((current) => current.map(updateAuthor));
    setSelectedMemory((current) => (current ? updateAuthor(current) : current));
    setRevisions((current) => current.map(updateAuthor));
  }

  useEffect(() => {
    const timers = toastTimers;
    return () => {
      timers.current.forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = readStoredBoolean("memora.sidebar.collapsed");
      const storedWidth = readStoredNumber("memora.sidebar.width");
      applySidebarLayout(storedWidth ?? SIDEBAR_DEFAULT_WIDTH, stored === true, false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [applySidebarLayout]);

  const loadMemories = useCallback(
    async (userId: string, workspace: Workspace) => {
      setLoadingMemories(true);
      try {
        const data = await serverState.query({
          key: serverStateKeys.memories(workspace.id),
          force: true,
          queryFn: async () => {
            const result =
              workspace.kind === "PERSONAL"
                ? await api.GET("/memories", {
                    params: {
                      query: {
                        author_id: userId,
                        visibility: "PRIVATE",
                        limit: 200,
                      },
                    },
                  })
                : await api.GET("/memories", {
                    params: {
                      query: {
                        limit: 200,
                      },
                    },
                  });
            if (!result.data || !result.response.ok) throw new Error("memory_list_failed");
            return result.data;
          },
        });
        setMemories(data);
        return data;
      } finally {
        setLoadingMemories(false);
      }
    },
    [serverState],
  );

  const loadWorkspaceMembers = useCallback(
    async (workspace: Workspace) => {
      if (!isCollaborativeWorkspace(workspace)) {
        setMembers([]);
        return [];
      }
      setLoadingMembers(true);
      try {
        const data = await serverState.query({
          key: serverStateKeys.members(workspace.id),
          force: true,
          queryFn: async () => {
            const result = await api.GET("/workspace/members");
            if (!result.data || !result.response.ok) {
              throw new Error("workspace_members_failed");
            }
            return result.data;
          },
        });
        setMembers(data);
        return data;
      } finally {
        setLoadingMembers(false);
      }
    },
    [serverState],
  );

  const loadSubscription = useCallback(async () => {
    try {
      const result = await api.GET("/billing/subscription");
      const next = result.data && result.response.ok ? result.data : null;
      setSubscription(next);
      return next;
    } catch {
      setSubscription(null);
      return null;
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const result = await api.GET("/conversations");
      const next = result.data && result.response.ok ? result.data : [];
      setConversations(next);
      return next;
    } catch {
      setConversations([]);
      return [];
    }
  }, []);

  const enterPersonalSpace = useCallback(
    async (authenticatedUser: CurrentUser, preferPersonal = false) => {
      setBooting(true);
      setSessionError("");
      try {
        const workspaceResult = await api.GET("/workspaces");
        if (!workspaceResult.data || !workspaceResult.response.ok) {
          throw new Error("workspace_list_failed");
        }
        const personal = workspaceResult.data.find(
          (workspace: Workspace) => workspace.kind === "PERSONAL",
        );
        const current = workspaceResult.data.find((workspace: Workspace) => workspace.is_current);
        const target = (preferPersonal ? personal : current) ?? personal ?? workspaceResult.data[0];
        if (!target) {
          throw new Error("workspace_missing");
        }

        let resolvedUser = authenticatedUser;
        if (!target.is_current) {
          const activation = await api.POST("/workspaces/{workspace_id}/activate", {
            params: { path: { workspace_id: target.id } },
          });
          if (!activation.data || !activation.response.ok) {
            throw new Error("workspace_activation_failed");
          }
          const refreshed = await api.GET("/auth/me");
          if (!refreshed.data || !refreshed.response.ok) {
            throw new Error("session_refresh_failed");
          }
          resolvedUser = refreshed.data;
        }

        const resolvedWorkspaces = workspaceResult.data.map((workspace: Workspace) => ({
          ...workspace,
          is_current: workspace.id === target.id,
        }));
        const resolvedWorkspace = resolvedWorkspaces.find(
          (workspace: Workspace) => workspace.id === target.id,
        );
        if (!resolvedWorkspace) throw new Error("workspace_missing_after_activation");

        setUser(resolvedUser);
        setWorkspaces(resolvedWorkspaces);
        setActiveWorkspace(resolvedWorkspace);
        setSessionError("");
        setView("CAPTURE");
        setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
        setMemorySearchActive(false);
        setSaveVisibility("PRIVATE");
        setSavedVisibility(null);
        const modelResult = await api.GET("/drafts/models");
        if (modelResult.data && modelResult.response.ok) {
          setModelOptions(modelResult.data);
          setSelectedModelId(
            modelResult.data.find((model: DraftModel) => model.is_default)?.id ??
              modelResult.data[0]?.id ??
              null,
          );
        } else {
          setModelOptions([]);
          setSelectedModelId(null);
        }
        await Promise.all([
          loadMemories(resolvedUser.id, resolvedWorkspace),
          loadWorkspaceMembers(resolvedWorkspace),
          loadSubscription(),
          loadConversations(),
        ]);
      } catch {
        setSessionError("无法进入工作空间，请刷新后重试。");
        setUser(null);
        setWorkspaces([]);
        setActiveWorkspace(null);
        setMembers([]);
        setModelOptions([]);
        setSelectedModelId(null);
      } finally {
        setBooting(false);
      }
    },
    [loadConversations, loadMemories, loadSubscription, loadWorkspaceMembers],
  );

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const { data, response } = await api.GET("/auth/me");
        if (!active) return;
        if (!data || !response.ok) {
          setBooting(false);
          return;
        }
        await enterPersonalSpace(data, false);
      } catch {
        if (active) setBooting(false);
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, [enterPersonalSpace]);

  useEffect(() => {
    if (view === "LIBRARY" && !selectedMemory && memories[0]) {
      void selectMemory(memories[0]);
    }
  }, [view, memories, selectedMemory]);

  async function selectMemory(memory: Memory) {
    setMemoryAiStatus("");
    const [detailResult, revisionsResult] = await Promise.all([
      api.GET("/memories/{memory_id}", {
        params: { path: { memory_id: memory.id } },
      }),
      api.GET("/memories/{memory_id}/revisions", {
        params: { path: { memory_id: memory.id } },
      }),
    ]);
    const detail = detailResult.data && detailResult.response.ok ? detailResult.data : memory;
    setSelectedMemory(detail);
    setMemoryMarkdown(detail.body);
    setMemoryBaseline(detail.body);
    setRevisions(
      revisionsResult.data && revisionsResult.response.ok ? revisionsResult.data : [detail],
    );
  }

  function workspaceChangeIsBlocked() {
    if (savingDraft || refiningDraft) {
      showToast("请等待当前操作完成后再切换空间");
      return true;
    }
    if (draft.trim() && draft.trim() !== savedBody) {
      showToast("当前草稿尚未保存，请先保存或点击“新想法”清空草稿");
      return true;
    }
    return false;
  }

  async function switchWorkspace(workspace: Workspace, alreadyActive = false) {
    if (workspace.id === activeWorkspace?.id && !alreadyActive) return true;
    if (workspaceChangeIsBlocked()) return false;
    setWorkspaceBusy(true);
    try {
      if (!alreadyActive) {
        const activation = await api.POST("/workspaces/{workspace_id}/activate", {
          params: { path: { workspace_id: workspace.id } },
        });
        if (!activation.data || !activation.response.ok) {
          throw new Error("workspace_activation_failed");
        }
      }
      const [userResult, workspaceResult] = await Promise.all([
        api.GET("/auth/me"),
        api.GET("/workspaces"),
      ]);
      if (
        !userResult.data ||
        !userResult.response.ok ||
        !workspaceResult.data ||
        !workspaceResult.response.ok
      ) {
        throw new Error("workspace_refresh_failed");
      }
      const resolvedWorkspace = workspaceResult.data.find(
        (item: Workspace) => item.id === workspace.id,
      );
      if (!resolvedWorkspace) throw new Error("workspace_membership_missing");

      setUser(userResult.data);
      setWorkspaces(workspaceResult.data);
      setActiveWorkspace(resolvedWorkspace);
      setSelectedMemory(null);
      setMemoryMarkdown("");
      setMemoryBaseline("");
      setRevisions([]);
      setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
      setMemorySearchActive(false);
      setVisualSeed(null);
      resetDraft();
      setView(isCollaborativeWorkspace(resolvedWorkspace) ? "TEAM" : "CAPTURE");
      setViewMotion("forward");
      setSidebarOpen(false);
      await Promise.all([
        loadMemories(userResult.data.id, resolvedWorkspace),
        loadWorkspaceMembers(resolvedWorkspace),
        loadConversations(),
      ]);
      showToast(`已进入 ${resolvedWorkspace.name}`);
      return true;
    } catch {
      showToast("切换空间失败，请稍后重试");
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function openTeamAccess(mode: TeamAccessMode) {
    if (workspaceChangeIsBlocked()) return;
    setSidebarOpen(false);
    setTeamAccessMode(mode);
  }

  async function finishTeamAccess(workspace: Workspace, alreadyActive: boolean) {
    const switched = await switchWorkspace(workspace, alreadyActive);
    if (!switched) throw new Error("无法进入团队，请稍后重试");
  }

  function addInvitedMember(member: WorkspaceMember) {
    setMembers((current) =>
      [...current.filter((item) => item.id !== member.id), member].sort((left, right) =>
        left.display_name.localeCompare(right.display_name, "zh-CN"),
      ),
    );
  }

  function removeMemberFromDirectory(memberId: string) {
    setMembers((current) => current.filter((member) => member.id !== memberId));
  }

  async function searchMemoryLibrary() {
    if (!user || !activeWorkspace) return;
    const { query, field, from, to, authorId } = memorySearchFilters;
    if (from && to && from > to) {
      showToast("结束日期不能早于开始日期");
      return;
    }
    const createdFrom = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
    let createdTo: string | undefined;
    if (to) {
      const nextDay = new Date(`${to}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      createdTo = nextDay.toISOString();
    }
    setLoadingMemories(true);
    try {
      const requestBody = {
        q: query.trim(),
        mode: "KEYWORD" as const,
        field,
        limit: 200,
        ...(createdFrom ? { created_from: createdFrom } : {}),
        ...(createdTo ? { created_to: createdTo } : {}),
        ...(isCollaborativeWorkspace(activeWorkspace) && authorId
          ? { author_id: authorId }
          : activeWorkspace.kind === "PERSONAL"
            ? { author_id: user.id }
            : {}),
      };
      const data = await serverState.query({
        key: serverStateKeys.search(activeWorkspace.id, JSON.stringify(requestBody)),
        force: true,
        queryFn: async () => {
          const result = await api.POST("/search", { body: requestBody });
          if (!result.data || !result.response.ok) throw new Error("memory_search_failed");
          return result.data;
        },
      });
      setSelectedMemory(null);
      setMemoryMarkdown("");
      setMemoryBaseline("");
      setRevisions([]);
      setMemories(data.results.map((result) => result.memory));
      setMemorySearchActive(true);
    } catch {
      showToast("检索失败，请稍后重试");
    } finally {
      setLoadingMemories(false);
    }
  }

  async function resetMemorySearch() {
    if (!user || !activeWorkspace) return;
    setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
    setMemorySearchActive(false);
    setSelectedMemory(null);
    setMemoryMarkdown("");
    setMemoryBaseline("");
    setRevisions([]);
    try {
      await loadMemories(user.id, activeWorkspace);
    } catch {
      showToast("重新读取记忆失败，请稍后重试");
    }
  }

  function startNewConversation() {
    if (workspaceChangeIsBlocked()) return;
    resetDraft();
    navigateTo("CAPTURE");
  }

  async function openConversation(conversation: ConversationSummary) {
    if (conversation.id === activeConversationId) {
      navigateTo("CAPTURE");
      return;
    }
    if (workspaceChangeIsBlocked()) return;
    try {
      const result = await api.GET("/conversations/{conversation_id}", {
        params: { path: { conversation_id: conversation.id } },
      });
      if (!result.data || !result.response.ok) throw new Error("conversation_load_failed");
      const detail = result.data;
      const restoredMessages: DraftMessage[] = detail.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        meta:
          message.status === "REDACTED" ? "部分来源已不可访问" : formatDateTime(message.created_at),
        citations: message.citations,
      }));
      const linkedMemory = [...detail.messages]
        .reverse()
        .find((message) => message.memory !== null)?.memory;
      setMessages(restoredMessages.length ? restoredMessages : [initialMessage]);
      setActiveConversationId(detail.id);
      setDraft(linkedMemory?.body ?? "");
      setSavedBody(linkedMemory?.body ?? null);
      setSavedVisibility(linkedMemory?.visibility ?? null);
      setSaveVisibility(linkedMemory?.visibility ?? "PRIVATE");
      setDraftDocumentCitations(
        (linkedMemory?.document_citations ?? []).flatMap((citation) =>
          citation.chunk_id
            ? [
                {
                  asset_id: citation.asset_id,
                  asset_name: citation.asset_name,
                  chunk_id: citation.chunk_id,
                  page_number: citation.page_number,
                  heading: citation.heading,
                  excerpt: citation.excerpt,
                  content_url: citation.content_url,
                },
              ]
            : [],
        ),
      );
      navigateTo("CAPTURE");
    } catch {
      showToast("历史对话暂时无法读取");
    }
  }

  async function archiveConversation(conversation: ConversationSummary) {
    if (conversation.id === activeConversationId && workspaceChangeIsBlocked()) return;
    try {
      const result = await api.PATCH("/conversations/{conversation_id}", {
        params: { path: { conversation_id: conversation.id } },
        body: { archived: true },
      });
      if (!result.data || !result.response.ok) throw new Error("conversation_archive_failed");
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (conversation.id === activeConversationId) resetDraft();
      showToast("对话已归档");
    } catch {
      showToast("归档失败，请稍后重试");
    }
  }

  async function refineCapture(
    instruction: string,
    images: DraftImageAttachment[],
    documents: DraftDocumentAttachment[],
    webSearch: WebSearchMode,
    modelId: string | null,
    appendUserMessage = true,
  ) {
    let conversationId = activeConversationId;
    if (!conversationId) {
      const title = instruction.replaceAll(/\s+/g, " ").trim().slice(0, 48) || "新对话";
      try {
        const result = await api.POST("/conversations", { body: { title } });
        if (!result.data || !result.response.ok) throw new Error("conversation_create_failed");
        conversationId = result.data.id;
        setActiveConversationId(conversationId);
        setConversations((current) => [
          result.data,
          ...current.filter((item) => item.id !== result.data?.id),
        ]);
      } catch {
        showToast("无法开始新对话，请稍后重试");
        return;
      }
    }
    const requestedWebSearch = willSearchWeb(instruction, webSearch);
    const modelLabel = selectedDraftModelLabel(modelOptions, modelId);
    let liveTrace = buildLiveTrace({
      modelLabel,
      images,
      documents,
    });
    const retryRequest = { instruction, images, documents, webSearch, modelId };
    const abortController = new AbortController();
    draftAbortControllerRef.current = abortController;
    draftExecutionIdRef.current = null;
    const userMessage: DraftMessage = {
      id: nextId("user"),
      role: "USER",
      content: instruction,
      images: images.map(({ id, name, previewUrl }) => ({ id, name, previewUrl })),
      attachments: documents.map(({ id, name, mediaType, document }) => ({
        id,
        name,
        mediaType,
        document,
      })),
    };
    const priorConversation = messages
      .filter((message) => message.id !== "welcome")
      .slice(-23)
      .map((message) => ({ role: message.role, content: message.content }));
    const currentTurn = images.length
      ? {
          role: userMessage.role,
          content: userMessage.content,
          images: images.map(({ name, media_type, data }) => ({ name, media_type, data })),
          attachments: [...images, ...documents].map((attachment) => ({
            asset_id: attachment.assetId,
          })),
        }
      : {
          role: userMessage.role,
          content: userMessage.content,
          ...(documents.length
            ? {
                attachments: documents.map((attachment) => ({
                  asset_id: attachment.assetId,
                })),
              }
            : {}),
        };
    const conversation = [...priorConversation, currentTurn];
    if (appendUserMessage) setMessages((current) => [...current, userMessage]);
    dispatchDraftAgent({ type: "START", trace: liveTrace, request: retryRequest });
    try {
      const data = await streamDraftChat(
        {
          conversation_id: conversationId,
          markdown: draft,
          messages: conversation,
          web_search: webSearch,
          ...(modelId ? { model_id: modelId } : {}),
        },
        (event) => {
          if (event.type === "progress") {
            liveTrace = {
              ...liveTrace,
              duration_ms: Math.max(liveTrace.duration_ms, event.step.elapsed_ms),
              steps: upsertTraceStep(liveTrace.steps, event.step),
            };
            dispatchDraftAgent({
              type: "PROGRESS",
              step: event.step,
              sequence: event.sequence,
            });
          } else if (event.type === "result" && event.response.trace) {
            liveTrace = event.response.trace;
          } else if (event.type === "error") {
            liveTrace = event.trace;
          }
        },
        {
          signal: abortController.signal,
          onExecutionId: (executionId) => {
            draftExecutionIdRef.current = executionId;
            dispatchDraftAgent({ type: "EXECUTION_IDENTIFIED", executionId });
          },
        },
      );
      const responseDocumentCitations = data.document_citations ?? [];
      if (data.conversation_id) setActiveConversationId(data.conversation_id);
      if (data.credits_remaining !== null && data.credits_remaining !== undefined) {
        setSubscription((current) =>
          current
            ? {
                ...current,
                credits_remaining: data.credits_remaining ?? current.credits_remaining,
                credits_used:
                  current.credits_granted - (data.credits_remaining ?? current.credits_remaining),
              }
            : current,
        );
      }
      setDraft(data.markdown);
      if (data.draft_changed && responseDocumentCitations.length) {
        setDraftDocumentCitations((current) => {
          const merged = new Map(current.map((citation) => [citation.chunk_id, citation]));
          responseDocumentCitations.forEach((citation) => merged.set(citation.chunk_id, citation));
          return [...merged.values()];
        });
      }
      const savedMemory = data.saved_memory;
      if (savedMemory) {
        setSavedBody(savedMemory.body);
        setSavedVisibility(savedMemory.visibility);
        setSaveVisibility(savedMemory.visibility);
        setMemories((current) => [
          savedMemory,
          ...current.filter((memory) => memory.id !== savedMemory.id),
        ]);
        setDraftDocumentCitations(
          (savedMemory.document_citations ?? []).flatMap((citation) =>
            citation.chunk_id
              ? [
                  {
                    asset_id: citation.asset_id,
                    asset_name: citation.asset_name,
                    chunk_id: citation.chunk_id,
                    page_number: citation.page_number,
                    heading: citation.heading,
                    excerpt: citation.excerpt,
                    content_url: citation.content_url,
                  },
                ]
              : [],
          ),
        );
      }
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: data.assistant_message,
          meta: savedMemory
            ? savedMemory.visibility === "WORKSPACE"
              ? "已自动保存为空间共享记忆"
              : "已自动保存为我的记忆"
            : data.tool_events?.find((event) => event.name === "save_memory")?.status === "REJECTED"
              ? "保存工具已拒绝 · 需要明确保存指令"
              : data.web_search_status === "AVAILABLE"
                ? data.draft_changed
                  ? `已联网 · ${data.web_citations.length} 个来源 · Markdown 已同步`
                  : `已联网 · ${data.web_citations.length} 个来源 · Markdown 未改变`
                : data.web_search_status === "DEGRADED"
                  ? "联网失败 · 草稿已安全保留"
                  : data.web_search_status === "DISABLED" && webSearch !== "DISABLED"
                    ? "联网能力未启用 · 草稿已安全保留"
                    : data.model_status === "AVAILABLE"
                      ? data.draft_changed
                        ? "右侧 Markdown 已同步"
                        : data.citations.length
                          ? `引用 ${data.citations.length} 条个人记忆`
                          : "已回答，Markdown 未改变"
                      : data.model_status === "DISABLED"
                        ? "基础草稿模式"
                        : "草稿已安全保留",
          citations: data.citations,
          webCitations: data.web_citations,
          documentCitations: responseDocumentCitations,
          activity: buildCompletedTrace({
            modelLabel,
            images,
            documents,
            requestedWebSearch,
            response: data,
          }),
        },
      ]);
      dispatchDraftAgent({
        type: "RESULT",
        trace: buildCompletedTrace({
          modelLabel,
          images,
          documents,
          requestedWebSearch,
          response: data,
        }),
        savedMemoryId: savedMemory?.id,
      });
      void loadConversations();
    } catch (caught) {
      const streamError = caught instanceof DraftChatStreamError ? caught : null;
      if (streamError?.code === "http_402") {
        await loadSubscription();
        setSubscriptionOpen(true);
        showToast("Credits 余额不足，请升级套餐后继续");
      }
      const executionId = streamError?.executionId ?? draftExecutionIdRef.current;
      const cancelled = abortController.signal.aborted || streamError?.code === "cancelled";
      if (executionId) {
        dispatchDraftAgent({ type: "RECOVERY_STARTED", executionId });
        try {
          let execution = await getAgentExecution(executionId);
          for (let attempt = 0; attempt < 7; attempt += 1) {
            liveTrace = traceFromExecution(execution, streamError?.trace ?? liveTrace);
            dispatchDraftAgent({ type: "RECOVERED", execution, trace: liveTrace });
            if (
              execution.status === "COMPLETED" ||
              execution.status === "DEGRADED" ||
              execution.status === "FAILED" ||
              execution.status === "CANCELLED"
            ) {
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 300));
            execution = await getAgentExecution(executionId);
          }

          if (execution.saved_memory_id) {
            const savedResult = await api.GET("/memories/{memory_id}", {
              params: { path: { memory_id: execution.saved_memory_id } },
            });
            if (savedResult.data && savedResult.response.ok) {
              const recoveredMemory = savedResult.data;
              setDraft(recoveredMemory.body);
              setSavedBody(recoveredMemory.body);
              setSavedVisibility(recoveredMemory.visibility);
              setSaveVisibility(recoveredMemory.visibility);
              setMemories((current) => [
                recoveredMemory,
                ...current.filter((memory) => memory.id !== recoveredMemory.id),
              ]);
            }
          }

          if (execution.status === "COMPLETED" || execution.status === "DEGRADED") {
            setMessages((current) => [
              ...current,
              {
                id: nextId("assistant"),
                role: "ASSISTANT",
                content: execution.saved_memory_id
                  ? "连接中断后已恢复执行记录，保存结果已经同步。"
                  : "连接中断后已恢复工作过程；完整回复没有返回，右侧草稿保持不变。",
                meta: execution.saved_memory_id ? "保存回执已确认" : "可以重新发送这轮请求",
                activity: liveTrace,
              },
            ]);
            return;
          }
          if (execution.status === "CANCELLED") {
            setMessages((current) => [
              ...current,
              {
                id: nextId("assistant"),
                role: "ASSISTANT",
                content: "这轮工作已取消，右侧草稿保持不变。",
                activity: liveTrace,
              },
            ]);
            dispatchDraftAgent({
              type: "FAILED",
              trace: liveTrace,
              errorCode: "cancelled",
              executionId,
              cancelled: true,
            });
            return;
          }
        } catch {
          // Fall through to the retryable local failure state.
        }
      }

      const failedTrace = buildFailedTrace({
        modelLabel,
        trace: streamError?.trace ?? liveTrace,
      });
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: cancelled
            ? "这轮工作已取消，右侧草稿保持不变。"
            : streamError?.code === "http_402"
              ? "当前 Credits 不足，升级套餐后即可继续。右侧草稿保持不变。"
              : "这次没有整理成功，右侧草稿保持不变。请稍后再试。",
          activity: failedTrace,
        },
      ]);
      dispatchDraftAgent({
        type: "FAILED",
        trace: failedTrace,
        errorCode: cancelled ? "cancelled" : streamError?.code,
        executionId,
        cancelled,
      });
    } finally {
      if (draftAbortControllerRef.current === abortController) {
        draftAbortControllerRef.current = null;
      }
    }
  }

  async function cancelDraftRun() {
    if (!refiningDraft) return;
    dispatchDraftAgent({ type: "CANCEL_REQUESTED" });
    draftAbortControllerRef.current?.abort();
    const executionId = draftExecutionIdRef.current;
    if (!executionId) return;
    try {
      await cancelAgentExecution(executionId);
    } catch {
      showToast("取消请求未确认，正在恢复执行状态");
    }
  }

  async function retryDraftRun() {
    if (!draftAgent.retryRequest || refiningDraft) return;
    const request = draftAgent.retryRequest;
    await refineCapture(
      request.instruction,
      request.images,
      request.documents,
      request.webSearch,
      request.modelId,
      false,
    );
  }

  async function saveDraft() {
    if (!draft.trim() || savingDraft || !activeWorkspace) return;
    const requestedVisibility = isCollaborativeWorkspace(activeWorkspace)
      ? saveVisibility
      : ("PRIVATE" as const);
    setSavingDraft(true);
    try {
      const data = await serverState.mutate({
        mutationFn: async () => {
          const result = await api.POST("/memories", {
            body: {
              body: draft,
              visibility: requestedVisibility,
              ...(activeConversationId ? { conversation_id: activeConversationId } : {}),
              document_citations: draftDocumentCitations.map((citation) => ({
                chunk_id: citation.chunk_id,
              })),
            },
          });
          if (!result.data || !result.response.ok) throw new Error("memory_create_failed");
          return result.data;
        },
        invalidate: [serverStateKeys.memories(activeWorkspace.id)],
      });
      setDraft(data.body);
      setSavedBody(data.body);
      setSavedVisibility(data.visibility);
      setSaveVisibility(data.visibility);
      setMemories((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      setDraftDocumentCitations(
        (data.document_citations ?? []).flatMap((citation) =>
          citation.chunk_id
            ? [
                {
                  asset_id: citation.asset_id,
                  asset_name: citation.asset_name,
                  chunk_id: citation.chunk_id,
                  page_number: citation.page_number,
                  heading: citation.heading,
                  excerpt: citation.excerpt,
                  content_url: citation.content_url,
                },
              ]
            : [],
        ),
      );
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content:
            data.visibility === "WORKSPACE"
              ? `已共享到 ${activeWorkspace.name} 的空间记忆库。`
              : "已保存为仅自己可见的记忆。",
          meta: formatDateTime(data.created_at),
        },
      ]);
      showToast(data.visibility === "WORKSPACE" ? "已保存为空间共享记忆" : "已保存为私人记忆");
    } catch {
      showToast("保存失败，请稍后重试");
    } finally {
      setSavingDraft(false);
    }
  }

  function resetDraft() {
    draftAbortControllerRef.current?.abort();
    draftAbortControllerRef.current = null;
    draftExecutionIdRef.current = null;
    dispatchDraftAgent({ type: "RESET" });
    setDraft("");
    setSavedBody(null);
    setSaveVisibility("PRIVATE");
    setSavedVisibility(null);
    setDraftDocumentCitations([]);
    setMessages([initialMessage]);
    setActiveConversationId(null);
  }

  async function openCitation(memoryId: string) {
    let resolved = memories.find((memory) => memory.id === memoryId);
    if (!resolved) {
      const { data, response } = await api.GET("/memories/{memory_id}", {
        params: { path: { memory_id: memoryId } },
      });
      if (!data || !response.ok) {
        showToast("这条来源当前不可访问");
        return;
      }
      resolved = data;
      setMemories((current) => [data, ...current.filter((memory) => memory.id !== data.id)]);
    }
    navigateTo("LIBRARY");
    await selectMemory(resolved);
  }

  async function refineSelectedMemory(instruction: string) {
    if (!selectedMemory) return;
    setRefiningMemory(true);
    setMemoryAiStatus("");
    try {
      const { data, response } = await api.POST("/drafts/refine", {
        body: { markdown: memoryMarkdown, instruction },
      });
      if (!data || !response.ok) throw new Error("memory_refine_failed");
      setMemoryMarkdown(data.markdown);
      setMemoryAiStatus(data.assistant_message);
    } catch {
      setMemoryAiStatus("AI 修改失败，当前内容没有丢失。");
    } finally {
      setRefiningMemory(false);
    }
  }

  async function saveRevision(mode: RevisionMode) {
    if (!selectedMemory || !memoryMarkdown.trim() || savingMode) return;
    setSavingMode(mode);
    try {
      const memoryId = selectedMemory.id;
      const data = await serverState.mutate({
        mutationFn: async () => {
          const result = await api.POST("/memories/{memory_id}/revisions", {
            params: { path: { memory_id: memoryId } },
            body: { body: memoryMarkdown, mode },
          });
          if (!result.data || !result.response.ok) {
            throw new Error(result.response.status === 409 ? "stale_memory" : "revision_failed");
          }
          return result.data;
        },
        invalidate: [
          ...(activeWorkspace ? [serverStateKeys.memories(activeWorkspace.id)] : []),
          serverStateKeys.memory(memoryId),
          serverStateKeys.revisions(memoryId),
        ],
      });
      if (user && activeWorkspace) await loadMemories(user.id, activeWorkspace);
      await selectMemory(data);
      showToast(mode === "UPDATE_CURRENT" ? "已更新当前记忆，旧内容已保留" : "已保存为新版本");
    } catch (error) {
      if (error instanceof Error && error.message === "stale_memory" && user && activeWorkspace) {
        await loadMemories(user.id, activeWorkspace);
      }
      showToast(
        error instanceof Error && error.message === "stale_memory"
          ? "这条记忆已有更新，请重新选择"
          : "保存修改失败，请稍后重试",
      );
    } finally {
      setSavingMode(null);
    }
  }

  async function changeSelectedVisibility(visibility: MemoryVisibility) {
    if (!selectedMemory?.is_owner || !activeWorkspace || visibilityChanging) return;
    setVisibilityChanging(true);
    const previousSelected = selectedMemory;
    const previousMemories = memories;
    try {
      const data = await serverState.mutate({
        optimistic: () => {
          const optimisticMemory = { ...previousSelected, visibility };
          setSelectedMemory(optimisticMemory);
          setMemories((current) =>
            current.map((memory) =>
              memory.id === optimisticMemory.id ? optimisticMemory : memory,
            ),
          );
          return () => {
            setSelectedMemory(previousSelected);
            setMemories(previousMemories);
          };
        },
        mutationFn: async () => {
          const result =
            visibility === "WORKSPACE"
              ? await api.POST("/memories/{memory_id}/share", {
                  params: { path: { memory_id: previousSelected.id } },
                })
              : await api.POST("/memories/{memory_id}/unshare", {
                  params: { path: { memory_id: previousSelected.id } },
                });
          if (!result.data || !result.response.ok) {
            throw new Error("visibility_update_failed");
          }
          return result.data;
        },
        invalidate: [
          serverStateKeys.memories(activeWorkspace.id),
          serverStateKeys.memory(previousSelected.id),
        ],
      });
      setSelectedMemory(data);
      setMemories((current) => current.map((memory) => (memory.id === data.id ? data : memory)));
      showToast(visibility === "WORKSPACE" ? "已共享给空间" : "已撤回为仅自己可见");
    } catch {
      showToast("可见范围更新失败，请稍后重试");
    } finally {
      setVisibilityChanging(false);
    }
  }

  async function deleteSelectedMemory() {
    if (!selectedMemory || deletingMemory) return;
    setDeletingMemory(true);
    const deletedMemory = selectedMemory;
    const previousMemories = memories;
    const previousMarkdown = memoryMarkdown;
    const previousBaseline = memoryBaseline;
    const previousRevisions = revisions;
    const remaining = memories.filter(
      (item) => item.timeline_entry_id !== deletedMemory.timeline_entry_id,
    );
    try {
      await serverState.mutate({
        optimistic: () => {
          setMemories(remaining);
          setSelectedMemory(null);
          setMemoryMarkdown("");
          setMemoryBaseline("");
          setRevisions([]);
          return () => {
            setMemories(previousMemories);
            setSelectedMemory(deletedMemory);
            setMemoryMarkdown(previousMarkdown);
            setMemoryBaseline(previousBaseline);
            setRevisions(previousRevisions);
          };
        },
        mutationFn: async () => {
          const result = await api.DELETE("/memories/{memory_id}", {
            params: { path: { memory_id: deletedMemory.id } },
          });
          if (!result.response.ok) throw new Error("delete_failed");
        },
        invalidate: [
          ...(activeWorkspace ? [serverStateKeys.memories(activeWorkspace.id)] : []),
          serverStateKeys.memory(deletedMemory.id),
          serverStateKeys.revisions(deletedMemory.id),
        ],
      });
      if (remaining[0]) await selectMemory(remaining[0]);
      showToast("记忆已删除");
    } catch {
      showToast("删除失败，请稍后重试");
    } finally {
      setDeletingMemory(false);
    }
  }

  async function logout() {
    await api.POST("/auth/logout");
    serverState.clear();
    setSettingsOpen(false);
    setSubscriptionOpen(false);
    setTeamAccessMode(null);
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
    setMembers([]);
    setSubscription(null);
    setConversations([]);
    setMemories([]);
    setModelOptions([]);
    setSelectedModelId(null);
    setSelectedMemory(null);
    resetDraft();
  }

  async function retryPersonalSpace() {
    setBooting(true);
    try {
      const { data, response } = await api.GET("/auth/me");
      if (!data || !response.ok) throw new Error("session_missing");
      await enterPersonalSpace(data, false);
    } catch {
      setBooting(false);
      setSessionError("无法进入工作空间，请刷新后重试。");
    }
  }

  if (booting) {
    return (
      <main className="boot-screen" aria-label="正在加载 Memora">
        <Logo />
        <span />
      </main>
    );
  }

  if (!user && sessionError) {
    return (
      <main className="session-failure" aria-labelledby="session-failure-title">
        <Logo />
        <h1 id="session-failure-title">暂时无法进入工作空间</h1>
        <p>为了避免把记忆写入错误的个人或团队空间，Memora 已停止当前操作。</p>
        <button type="button" onClick={() => void retryPersonalSpace()}>
          重新尝试
        </button>
      </main>
    );
  }

  if (!user) {
    return (
      <PublicLanding
        onAuthenticated={(authenticatedUser) => void enterPersonalSpace(authenticatedUser, true)}
      />
    );
  }

  if (!activeWorkspace) {
    return (
      <main className="boot-screen" aria-label="正在读取工作空间">
        <Logo />
        <span />
      </main>
    );
  }

  const mobileTitle: Record<AppView, string> = {
    CAPTURE: "新对话",
    RESEARCH: "深度调研",
    KNOWLEDGE: "云知识库",
    DIAGRAMS: "框图",
    INSIGHTS: isCollaborativeWorkspace(activeWorkspace) ? "团队智能" : "我的洞察",
    LIBRARY: "记忆库",
    TEAM: activeWorkspace.kind === "FAMILY" ? "家庭空间" : "团队空间",
  };

  return (
    <main
      className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${sidebarResizing ? "is-sidebar-resizing" : ""}`}
      style={{ "--sidebar-current-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar
        user={user}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        workspaceBusy={workspaceBusy}
        subscription={subscription}
        conversations={conversations}
        activeConversationId={activeConversationId}
        view={view}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onView={navigateTo}
        onNewConversation={startNewConversation}
        onConversationSelect={(conversation) => void openConversation(conversation)}
        onConversationArchive={(conversation) => void archiveConversation(conversation)}
        onWorkspaceSelect={(workspace) => void switchWorkspace(workspace)}
        onTeamAccess={openTeamAccess}
        onClose={() => setSidebarOpen(false)}
        onCollapse={collapseSidebar}
        onExpand={expandSidebar}
        onUpgrade={() => setSubscriptionOpen(true)}
        onOpenSettings={() => {
          setSidebarOpen(false);
          openSettings();
        }}
        onLogout={() => void logout()}
      />
      <SidebarResizeHandle
        width={sidebarWidth}
        collapsed={sidebarCollapsed}
        onResize={(width, collapsed) => applySidebarLayout(width, collapsed)}
        onCommit={(width, collapsed) => applySidebarLayout(width, collapsed, true)}
        onToggle={toggleSidebar}
        onReset={resetSidebarWidth}
        onDraggingChange={setSidebarResizing}
      />
      <section className="app-main">
        <header className="mobile-header">
          <button type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>
            <MenuIcon />
          </button>
          <div>
            <Logo />
            <strong>{mobileTitle[view]}</strong>
          </div>
          <button
            className="mobile-account-button"
            type="button"
            aria-label="打开移动端个人设置"
            onClick={openSettings}
          >
            <UserAvatar user={user} />
          </button>
        </header>

        {sessionError ? (
          <div className="session-error" role="alert">
            {sessionError}
          </div>
        ) : null}

        {view === "CAPTURE" || view === "RESEARCH" ? (
          <div
            className={`view-transition is-${viewMotion}`}
            key={`${view.toLowerCase()}-${activeWorkspace.id}`}
          >
            <CaptureWorkspace
              mode={view}
              workspace={activeWorkspace}
              draft={draft}
              messages={messages}
              refining={refiningDraft}
              activity={draftActivity}
              saving={savingDraft}
              savedBody={savedBody}
              saveVisibility={saveVisibility}
              savedVisibility={savedVisibility}
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              subscriptionPlan={subscription?.plan_code}
              agentPhase={draftAgent.phase}
              documentCitations={draftDocumentCitations}
              canRetry={Boolean(
                draftAgent.retryRequest &&
                (draftAgent.phase === "FAILED" || draftAgent.phase === "CANCELLED"),
              )}
              onDraftChange={setDraft}
              onRefine={refineCapture}
              onSave={saveDraft}
              onSaveVisibilityChange={setSaveVisibility}
              onReset={resetDraft}
              onModelChange={setSelectedModelId}
              onUpgrade={() => setSubscriptionOpen(true)}
              onOpenCitation={openCitation}
              onCancel={cancelDraftRun}
              onRetry={retryDraftRun}
            />
          </div>
        ) : view === "KNOWLEDGE" ? (
          <div
            className={`view-transition is-${viewMotion}`}
            key={`knowledge-${activeWorkspace.id}`}
          >
            <KnowledgeBaseWorkspace
              workspace={activeWorkspace}
              memories={memories}
              loading={loadingMemories}
              onOpenMemory={(memory) => {
                navigateTo("LIBRARY");
                void selectMemory(memory);
              }}
              onCapture={() => navigateTo("CAPTURE")}
            />
          </div>
        ) : view === "DIAGRAMS" ? (
          <div
            className={`view-transition is-${viewMotion}`}
            key={`diagrams-${activeWorkspace.id}`}
          >
            <VisualWorkspace
              workspace={activeWorkspace}
              memories={memories}
              members={members}
              chatModels={modelOptions}
              subscription={subscription}
              initialSeed={visualSeed}
              onSubscriptionChange={setSubscription}
              onUpgrade={() => setSubscriptionOpen(true)}
              onNotify={showToast}
            />
          </div>
        ) : view === "INSIGHTS" ? (
          <div
            className={`view-transition is-${viewMotion}`}
            key={`insights-${activeWorkspace.id}`}
          >
            <TeamIntelligenceWorkspace
              workspace={activeWorkspace}
              members={members}
              subscription={subscription}
              onSubscriptionChange={setSubscription}
              onUpgrade={() => setSubscriptionOpen(true)}
              onOpenMemory={(memoryId) => void openCitation(memoryId)}
              onMemoryCreated={(memory) =>
                setMemories((current) => [
                  memory,
                  ...current.filter((item) => item.id !== memory.id),
                ])
              }
              onCreateVisual={(projectId, memoryIds) => {
                setVisualSeed({ projectId, memoryIds });
                navigateTo("DIAGRAMS");
              }}
              onNotify={showToast}
            />
          </div>
        ) : view === "LIBRARY" ? (
          <ResizableSplit
            className={`library-workspace view-transition is-${viewMotion}`}
            key="library"
            label="调整记忆列表和详情宽度"
            storageKey="memora.split.library"
            defaultLeftPercent={34}
            minLeftPx={260}
            minRightPx={360}
            left={
              <Timeline
                workspace={activeWorkspace}
                members={members}
                memories={memories}
                selectedId={selectedMemory?.id ?? null}
                loading={loadingMemories}
                searchFilters={memorySearchFilters}
                searchActive={memorySearchActive}
                onSearchFiltersChange={setMemorySearchFilters}
                onSearch={() => void searchMemoryLibrary()}
                onResetSearch={() => void resetMemorySearch()}
                onSelect={(memory) => void selectMemory(memory)}
              />
            }
            right={
              <MemoryDetail
                key={selectedMemory?.id ?? "empty-memory"}
                workspace={activeWorkspace}
                memory={selectedMemory}
                markdown={memoryMarkdown}
                baseline={memoryBaseline}
                revisions={revisions}
                refining={refiningMemory}
                savingMode={savingMode}
                deleting={deletingMemory}
                visibilityChanging={visibilityChanging}
                aiStatus={memoryAiStatus}
                onMarkdownChange={setMemoryMarkdown}
                onRefine={refineSelectedMemory}
                onSaveRevision={saveRevision}
                onVisibilityChange={changeSelectedVisibility}
                onDelete={deleteSelectedMemory}
              />
            }
          />
        ) : (
          <div className={`view-transition is-${viewMotion}`} key={`team-${activeWorkspace.id}`}>
            <TeamWorkspace
              workspace={activeWorkspace}
              members={members}
              loading={loadingMembers}
              onMemberInvited={addInvitedMember}
              onMemberRemoved={removeMemberFromDirectory}
              onNotify={showToast}
            />
          </div>
        )}
      </section>
      {settingsOpen ? (
        <AccountSettingsDialog
          user={user}
          onClose={closeSettings}
          onUserChange={updateCurrentUser}
          onNotify={showToast}
        />
      ) : null}
      {subscriptionOpen ? (
        <SubscriptionDialog
          current={subscription}
          onClose={() => setSubscriptionOpen(false)}
          onSubscriptionChange={setSubscription}
          onNotify={showToast}
        />
      ) : null}
      {teamAccessMode ? (
        <TeamAccessDialog
          initialMode={teamAccessMode}
          onClose={() => setTeamAccessMode(null)}
          onWorkspaceReady={finishTeamAccess}
        />
      ) : null}
      {toast ? (
        <div className={toastLeaving ? "toast is-leaving" : "toast"} role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
