"use client";

import {
  Archive,
  BookOpenText,
  Check,
  ChevronDown,
  CirclePlus,
  CreditCard,
  Database,
  Ellipsis,
  House,
  LogOut,
  Mail,
  MessageSquarePlus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings,
  Sun,
  Trash2,
  UserRound,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type {
  AppView,
  ConversationSummary,
  CurrentUser,
  SettingsView,
  Subscription,
  TeamAccessMode,
  Workspace,
} from "@/features/shared/contracts";
import { CaptureIcon, CloseIcon, LibraryIcon, Logo, UserAvatar } from "@/features/shared/icons";
import {
  readInterfaceTheme,
  storeInterfaceThemePreference,
  type InterfaceTheme,
} from "@/features/shared/interface-theme";

const CONVERSATION_MENU_WIDTH = 158;
const CONVERSATION_MENU_HEIGHT = 150;

type ConversationDialogState = {
  action: "RENAME" | "DELETE";
  conversation: ConversationSummary;
};

function ConversationActionDialog({
  state,
  onClose,
  onRename,
  onDelete,
}: {
  state: ConversationDialogState;
  onClose: () => void;
  onRename: (conversation: ConversationSummary, title: string) => Promise<boolean>;
  onDelete: (conversation: ConversationSummary) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(state.conversation.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isRename = state.action === "RENAME";
  const normalizedTitle = title.replaceAll(/\s+/g, " ").trim();

  useEffect(() => {
    if (isRename) {
      inputRef.current?.focus();
      inputRef.current?.select();
    } else {
      cancelButtonRef.current?.focus();
    }
  }, [isRename]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  useEffect(() => {
    if (busy) {
      dialogRef.current?.focus();
    } else if (error) {
      if (isRename) inputRef.current?.focus();
      else cancelButtonRef.current?.focus();
    }
  }, [busy, error, isRename]);

  async function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedTitle || busy) return;
    if (normalizedTitle === state.conversation.title) {
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    const renamed = await onRename(state.conversation, normalizedTitle);
    setBusy(false);
    if (renamed) onClose();
    else setError("重命名失败，请稍后重试");
  }

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setError("");
    const deleted = await onDelete(state.conversation);
    setBusy(false);
    if (deleted) onClose();
    else setError("删除失败，请稍后重试");
  }

  function keepFocusInside(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    if (busy) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="conversation-action-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`conversation-action-dialog ${isRename ? "" : "is-danger"}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-action-title"
        tabIndex={-1}
        onKeyDown={keepFocusInside}
      >
        <header>
          <div>
            <strong id="conversation-action-title">{isRename ? "重命名对话" : "删除对话"}</strong>
            <small>{state.conversation.title}</small>
          </div>
          <button type="button" aria-label="关闭对话操作" disabled={busy} onClick={onClose}>
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </header>

        {isRename ? (
          <form onSubmit={(event) => void submitRename(event)}>
            <label htmlFor="conversation-title-input">对话名称</label>
            <input
              ref={inputRef}
              id="conversation-title-input"
              aria-label="对话名称"
              value={title}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error ? <p role="alert">{error}</p> : null}
            <footer>
              <button ref={cancelButtonRef} type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button type="submit" className="primary-action" disabled={!normalizedTitle || busy}>
                {busy ? "保存中…" : "保存"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="conversation-delete-confirmation">
            <p>删除后，该对话及其中的消息将永久移除，无法恢复。</p>
            <small>已经保存到记忆库的内容不会被删除。</small>
            {error ? <p role="alert">{error}</p> : null}
            <footer>
              <button ref={cancelButtonRef} type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                type="button"
                className="danger-action"
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? "删除中…" : "确认删除"}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}

function workspaceIcon(workspace: Workspace, size = 16) {
  if (workspace.kind === "FAMILY")
    return <House aria-hidden="true" size={size} strokeWidth={1.8} />;
  if (workspace.kind === "TEAM") return <Users aria-hidden="true" size={size} strokeWidth={1.8} />;
  return <UserRound aria-hidden="true" size={size} strokeWidth={1.8} />;
}

function WorkspaceSwitcher({
  user,
  workspaces,
  activeWorkspace,
  busy,
  subscription,
  onSelect,
  onTeamAccess,
  onTeamSettings,
}: {
  user: CurrentUser;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  busy: boolean;
  subscription: Subscription | null;
  onSelect: (workspace: Workspace) => void;
  onTeamAccess: (mode: TeamAccessMode) => void;
  onTeamSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groups = [
    { label: "个人团队", kind: "PERSONAL" as const, empty: "没有个人空间" },
    { label: "协作团队", kind: "TEAM" as const, empty: "还没有加入团队" },
  ];

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function selectWorkspace(workspace: Workspace) {
    setOpen(false);
    onSelect(workspace);
  }

  function openAccess(mode: TeamAccessMode) {
    setOpen(false);
    onTeamAccess(mode);
  }

  function openSettings() {
    setOpen(false);
    onTeamSettings();
  }

  const canOpenTeamSettings = activeWorkspace.kind === "TEAM";

  return (
    <section
      ref={switcherRef}
      className={`workspace-switcher ${open ? "is-open" : ""}`}
      aria-label="团队与空间"
    >
      <header className="workspace-switcher-heading">
        <span>团队</span>
        <button
          type="button"
          aria-label="打开团队创建与加入"
          title="新建或加入团队"
          onClick={() => openAccess("CREATE")}
        >
          <UserRoundPlus aria-hidden="true" size={16} strokeWidth={1.7} />
        </button>
      </header>
      <div className="workspace-trigger-stack">
        <button
          ref={triggerRef}
          className="workspace-trigger"
          type="button"
          aria-label={`切换空间，当前为 ${activeWorkspace.name}`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <strong>{activeWorkspace.name}</strong>
          <small>{subscription?.plan_name ?? "Plus"} Plan</small>
          <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>

        {open ? (
          <div className="workspace-menu" role="menu" aria-label="可用空间">
            <p>我的团队 · 切换后订阅与对话独立隔离</p>
            {groups.map((group) => {
              const spaces = workspaces.filter((workspace) => workspace.kind === group.kind);
              return (
                <div className="workspace-menu-group" key={group.kind}>
                  <span>{group.label}</span>
                  {spaces.length ? (
                    spaces.map((workspace) => (
                      <button
                        type="button"
                        role="menuitem"
                        className={workspace.id === activeWorkspace.id ? "is-current" : ""}
                        key={workspace.id}
                        disabled={busy}
                        onClick={() => selectWorkspace(workspace)}
                      >
                        {workspaceIcon(workspace, 15)}
                        <span>{workspace.name}</span>
                        {workspace.id === activeWorkspace.id ? (
                          <Check aria-hidden="true" size={14} strokeWidth={2} />
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <small>{group.empty}</small>
                  )}
                </div>
              );
            })}
            <div className="workspace-menu-actions">
              <button type="button" onClick={() => openAccess("CREATE")}>
                <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
                新建团队
              </button>
              <button
                type="button"
                disabled={!canOpenTeamSettings}
                title={canOpenTeamSettings ? "打开团队设置" : "切换到协作团队后可用"}
                onClick={openSettings}
              >
                <Users aria-hidden="true" size={15} strokeWidth={1.8} />
                团队设置
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <button
        className="workspace-current-member"
        type="button"
        aria-label={canOpenTeamSettings ? "打开团队设置" : "当前空间成员"}
        disabled={!canOpenTeamSettings}
        title={canOpenTeamSettings ? "打开团队设置" : "当前为个人空间"}
        onClick={openSettings}
      >
        <UserAvatar user={user} />
        <strong>{user.display_name}</strong>
        <small>{activeWorkspace.role === "OWNER" ? "所有者" : "成员"}</small>
      </button>
    </section>
  );
}

const navItems: Array<{
  view: AppView;
  label: string;
  icon: React.ReactNode;
}> = [
  { view: "CAPTURE", label: "新对话", icon: <MessageSquarePlus size={18} strokeWidth={1.75} /> },
  { view: "LIBRARY", label: "我的记忆", icon: <BookOpenText size={18} strokeWidth={1.75} /> },
  { view: "KNOWLEDGE", label: "团队记忆", icon: <Database size={18} strokeWidth={1.75} /> },
];

export function Sidebar({
  user,
  workspaces,
  activeWorkspace,
  workspaceBusy,
  subscription,
  conversations,
  pendingConversationActions,
  activeConversationId,
  view,
  open,
  collapsed,
  onView,
  onNewConversation,
  onConversationSelect,
  onConversationPin,
  onConversationRename,
  onConversationArchive,
  onConversationDelete,
  onWorkspaceSelect,
  onTeamAccess,
  onClose,
  onHome,
  onCollapse,
  onExpand,
  onUpgrade,
  onOpenSettings,
  onLogout,
}: {
  user: CurrentUser;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  workspaceBusy: boolean;
  subscription: Subscription | null;
  conversations: ConversationSummary[];
  pendingConversationActions: ReadonlySet<string>;
  activeConversationId: string | null;
  view: AppView;
  open: boolean;
  collapsed: boolean;
  onView: (view: AppView) => void;
  onNewConversation: () => void;
  onConversationSelect: (conversation: ConversationSummary) => void;
  onConversationPin: (conversation: ConversationSummary, pinned: boolean) => void;
  onConversationRename: (conversation: ConversationSummary, title: string) => Promise<boolean>;
  onConversationArchive: (conversation: ConversationSummary) => void;
  onConversationDelete: (conversation: ConversationSummary) => Promise<boolean>;
  onWorkspaceSelect: (workspace: Workspace) => void;
  onTeamAccess: (mode: TeamAccessMode) => void;
  onClose: () => void;
  onHome: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onUpgrade: () => void;
  onOpenSettings: (view: SettingsView) => void;
  onLogout: () => void;
}) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [interfaceTheme, setInterfaceTheme] = useState<InterfaceTheme>("dark");
  function toggleAccountMenu() {
    setInterfaceTheme(readInterfaceTheme());
    setAccountMenuOpen((current) => !current);
  }
  function toggleInterfaceTheme() {
    const next = readInterfaceTheme() === "dark" ? "light" : "dark";
    storeInterfaceThemePreference(next);
    setInterfaceTheme(next);
  }
  const [conversationMenu, setConversationMenu] = useState<{
    id: string;
    left: number;
    top: number;
  } | null>(null);
  const [conversationDialog, setConversationDialog] = useState<ConversationDialogState | null>(
    null,
  );
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const historyNewButtonRef = useRef<HTMLButtonElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const conversationMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountMenuOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!conversationMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!conversationMenuRef.current?.contains(event.target as Node)) setConversationMenu(null);
    };
    const closeMenu = () => setConversationMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConversationMenu(null);
      window.requestAnimationFrame(() => conversationMenuTriggerRef.current?.focus());
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    const focusFrame = window.requestAnimationFrame(() => {
      conversationMenuRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    });
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [conversationMenu]);

  function closeConversationMenu(restoreFocus = false) {
    setConversationMenu(null);
    if (restoreFocus) {
      restoreConversationTriggerFocus();
    }
  }

  function restoreConversationTriggerFocus() {
    window.requestAnimationFrame(() => {
      const trigger = conversationMenuTriggerRef.current;
      if (trigger?.isConnected) trigger.focus();
      else historyNewButtonRef.current?.focus();
    });
  }

  function moveConversationMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      conversationMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [],
    );
    if (!items.length) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Home") items[0]?.focus();
    else if (event.key === "End") items.at(-1)?.focus();
    else if (event.key === "ArrowDown")
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    else items[(currentIndex - 1 + items.length) % items.length]?.focus();
  }

  function openSettings(view: SettingsView) {
    setAccountMenuOpen(false);
    onOpenSettings(view);
  }

  function openSubscription() {
    setAccountMenuOpen(false);
    onUpgrade();
  }

  function logout() {
    setAccountMenuOpen(false);
    onLogout();
  }

  const menuConversation = conversationMenu
    ? conversations.find((conversation) => conversation.id === conversationMenu.id)
    : null;
  const pinnedConversations = conversations.filter((conversation) => conversation.pinned_at);
  const recentConversations = conversations.filter((conversation) => !conversation.pinned_at);

  function conversationRow(conversation: ConversationSummary) {
    const menuOpen = conversationMenu?.id === conversation.id;
    const actionPending = pendingConversationActions.has(conversation.id);
    return (
      <div
        className={`sidebar-history-row ${conversation.id === activeConversationId ? "is-active" : ""} ${menuOpen ? "is-menu-open" : ""}`}
        key={conversation.id}
      >
        <button
          className="sidebar-history-open"
          type="button"
          aria-busy={actionPending}
          disabled={actionPending}
          onClick={() => onConversationSelect(conversation)}
        >
          <span>{conversation.title}</span>
        </button>
        <button
          className="sidebar-history-more"
          type="button"
          aria-label={`更多对话操作 ${conversation.title}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-busy={actionPending}
          disabled={actionPending}
          title={actionPending ? "操作处理中" : "更多操作"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const hasRoomBelow = window.innerHeight - rect.bottom >= CONVERSATION_MENU_HEIGHT + 8;
            conversationMenuTriggerRef.current = event.currentTarget;
            setConversationMenu((current) =>
              current?.id === conversation.id
                ? null
                : {
                    id: conversation.id,
                    left: Math.max(8, rect.right - CONVERSATION_MENU_WIDTH),
                    top: hasRoomBelow
                      ? rect.bottom + 5
                      : Math.max(8, rect.top - CONVERSATION_MENU_HEIGHT - 5),
                  },
            );
          }}
        >
          <Ellipsis aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        className={`sidebar-scrim ${open ? "is-visible" : ""}`}
        type="button"
        aria-label="关闭导航"
        onClick={onClose}
      />
      <aside
        className={`app-sidebar ${open ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""}`}
        aria-label="Memora 导航"
      >
        <div className="sidebar-collapsed-content" hidden={!collapsed}>
          <button
            className="sidebar-collapsed-home"
            type="button"
            aria-label="返回 Memora 首页"
            title="返回首页"
            onClick={onHome}
          >
            <Logo />
          </button>
          <button type="button" aria-label="展开侧边栏" title="展开侧边栏" onClick={onExpand}>
            <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.7} />
          </button>
          <nav aria-label="快捷功能">
            {navItems.map((item) => (
              <button
                type="button"
                className={view === item.view ? "is-active" : ""}
                aria-label={item.label}
                title={item.label}
                key={item.view}
                onClick={() => (item.view === "CAPTURE" ? onNewConversation() : onView(item.view))}
              >
                {item.icon}
              </button>
            ))}
          </nav>
          <button
            className="collapsed-avatar-button"
            type="button"
            aria-label="个人设置"
            onClick={() => onOpenSettings("PROFILE")}
          >
            <UserAvatar user={user} />
          </button>
        </div>

        <div className="sidebar-expanded-content" hidden={collapsed}>
          <div className="sidebar-brand">
            <button
              className="sidebar-brand-home"
              type="button"
              aria-label="返回 Memora 首页"
              title="返回首页"
              onClick={onHome}
            >
              <Logo />
              <span>Memora</span>
            </button>
            <button
              className="sidebar-collapse"
              type="button"
              aria-label="收起侧边栏"
              title="收起侧边栏"
              onClick={onCollapse}
            >
              <PanelLeftClose aria-hidden="true" size={17} strokeWidth={1.7} />
            </button>
            <button className="mobile-close" type="button" aria-label="关闭导航" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          <nav className="primary-nav" aria-label="主要功能">
            {navItems.map((item) => (
              <button
                className={view === item.view ? "is-active" : ""}
                type="button"
                key={item.view}
                onClick={() => (item.view === "CAPTURE" ? onNewConversation() : onView(item.view))}
              >
                {item.view === "CAPTURE" ? (
                  <CaptureIcon />
                ) : item.view === "LIBRARY" ? (
                  <LibraryIcon />
                ) : (
                  item.icon
                )}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <WorkspaceSwitcher
            user={user}
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            busy={workspaceBusy}
            subscription={subscription}
            onSelect={onWorkspaceSelect}
            onTeamAccess={onTeamAccess}
            onTeamSettings={() => onView("TEAM")}
          />

          <section className="sidebar-history" aria-labelledby="sidebar-history-title">
            <header>
              <span id="sidebar-history-title">历史对话</span>
              <button
                ref={historyNewButtonRef}
                type="button"
                aria-label="新建对话"
                title="新建对话"
                onClick={onNewConversation}
              >
                <CirclePlus aria-hidden="true" size={16} strokeWidth={1.7} />
              </button>
            </header>
            <div className="sidebar-history-scroll">
              {pinnedConversations.length ? (
                <section className="sidebar-history-group" aria-labelledby="pinned-history-title">
                  <h3 id="pinned-history-title">
                    <Pin aria-hidden="true" size={12} strokeWidth={1.8} />
                    已置顶
                  </h3>
                  {pinnedConversations.map(conversationRow)}
                </section>
              ) : null}
              {recentConversations.length ? (
                <section
                  className="sidebar-history-group"
                  aria-labelledby={pinnedConversations.length ? "recent-history-title" : undefined}
                  aria-label={pinnedConversations.length ? undefined : "最近对话"}
                >
                  {pinnedConversations.length ? <h3 id="recent-history-title">最近</h3> : null}
                  {recentConversations.map(conversationRow)}
                </section>
              ) : null}
              {!conversations.length ? <small>还没有历史对话</small> : null}
            </div>
            {conversationMenu && menuConversation ? (
              <div
                ref={conversationMenuRef}
                className="sidebar-history-menu"
                role="menu"
                aria-label={`对话操作 ${menuConversation.title}`}
                style={{ left: conversationMenu.left, top: conversationMenu.top }}
                onKeyDown={moveConversationMenuFocus}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`${menuConversation.pinned_at ? "取消置顶" : "置顶"}对话 ${menuConversation.title}`}
                  onClick={() => {
                    closeConversationMenu();
                    window.requestAnimationFrame(() => historyNewButtonRef.current?.focus());
                    onConversationPin(menuConversation, !menuConversation.pinned_at);
                  }}
                >
                  {menuConversation.pinned_at ? (
                    <PinOff aria-hidden="true" size={15} strokeWidth={1.7} />
                  ) : (
                    <Pin aria-hidden="true" size={15} strokeWidth={1.7} />
                  )}
                  {menuConversation.pinned_at ? "取消置顶" : "置顶"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`重命名对话 ${menuConversation.title}`}
                  onClick={() => {
                    setConversationDialog({ action: "RENAME", conversation: menuConversation });
                    closeConversationMenu();
                  }}
                >
                  <Pencil aria-hidden="true" size={15} strokeWidth={1.7} />
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`归档对话 ${menuConversation.title}`}
                  onClick={() => {
                    closeConversationMenu();
                    window.requestAnimationFrame(() => historyNewButtonRef.current?.focus());
                    onConversationArchive(menuConversation);
                  }}
                >
                  <Archive aria-hidden="true" size={15} strokeWidth={1.7} />
                  归档
                </button>
                <button
                  className="is-danger"
                  type="button"
                  role="menuitem"
                  aria-label={`删除对话 ${menuConversation.title}`}
                  onClick={() => {
                    setConversationDialog({ action: "DELETE", conversation: menuConversation });
                    closeConversationMenu();
                  }}
                >
                  <Trash2 aria-hidden="true" size={15} strokeWidth={1.7} />
                  删除
                </button>
              </div>
            ) : null}
          </section>

          <div
            ref={accountMenuRef}
            className={`sidebar-account-stack ${accountMenuOpen ? "is-menu-open" : ""}`}
          >
            {accountMenuOpen ? (
              <div className="sidebar-account-menu" role="menu" aria-label="账户菜单">
                <header>
                  <UserAvatar user={user} />
                  <span>
                    <strong>{user.display_name}</strong>
                    <small>{subscription?.plan_name ?? "Plus"} Plan</small>
                  </span>
                </header>
                <div className="sidebar-account-menu-items">
                  <button type="button" role="menuitem" onClick={() => openSettings("PROFILE")}>
                    <UserRound aria-hidden="true" size={18} strokeWidth={1.7} />
                    个人资料
                  </button>
                  <button type="button" role="menuitem" onClick={() => openSettings("INVITATIONS")}>
                    <Mail aria-hidden="true" size={18} strokeWidth={1.7} />
                    我的邀请
                  </button>
                  <button type="button" role="menuitem" onClick={openSubscription}>
                    <CreditCard aria-hidden="true" size={18} strokeWidth={1.7} />
                    <span>
                      订阅与账单
                      <small>
                        {subscription?.credits_remaining.toLocaleString("zh-CN") ?? "—"} credits
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`切换主题，当前${interfaceTheme === "dark" ? "深色" : "浅色"}`}
                    onClick={toggleInterfaceTheme}
                  >
                    {interfaceTheme === "dark" ? (
                      <Moon aria-hidden="true" size={18} strokeWidth={1.7} />
                    ) : (
                      <Sun aria-hidden="true" size={18} strokeWidth={1.7} />
                    )}
                    切换主题
                  </button>
                  <button type="button" role="menuitem" onClick={() => openSettings("GENERAL")}>
                    <Settings aria-hidden="true" size={18} strokeWidth={1.7} />
                    通用设置
                  </button>
                </div>
                <button
                  className="account-menu-logout"
                  type="button"
                  role="menuitem"
                  onClick={logout}
                >
                  <LogOut aria-hidden="true" size={18} strokeWidth={1.7} />
                  退出登录
                </button>
              </div>
            ) : null}
            <div className="sidebar-account-dock">
              <button
                ref={accountButtonRef}
                className="account-profile-button"
                type="button"
                aria-label="打开账户菜单"
                aria-expanded={accountMenuOpen}
                title="账户菜单"
                onClick={toggleAccountMenu}
              >
                <UserAvatar user={user} />
                <span className="account-copy">
                  <strong>{user.display_name}</strong>
                  <small>{subscription?.plan_name ?? "Plus"} Plan</small>
                </span>
              </button>
              <button
                className="account-upgrade-button"
                type="button"
                aria-label={`打开订阅与账单，当前 ${subscription?.credits_remaining.toLocaleString("zh-CN") ?? "—"} credits`}
                onClick={openSubscription}
              >
                升级
              </button>
            </div>
          </div>
        </div>
      </aside>
      {conversationDialog ? (
        <ConversationActionDialog
          key={`${conversationDialog.action}-${conversationDialog.conversation.id}`}
          state={conversationDialog}
          onClose={() => {
            setConversationDialog(null);
            restoreConversationTriggerFocus();
          }}
          onRename={onConversationRename}
          onDelete={onConversationDelete}
        />
      ) : null}
    </>
  );
}
