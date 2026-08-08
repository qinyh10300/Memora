"use client";

import {
  Archive,
  BookOpenText,
  BrainCircuit,
  Check,
  ChevronDown,
  CreditCard,
  Database,
  Hash,
  History,
  House,
  LogOut,
  Mail,
  MessageSquarePlus,
  Microscope,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  UserRound,
  Users,
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
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { CaptureIcon, CloseIcon, LibraryIcon, Logo, UserAvatar } from "@/features/shared/icons";

function workspaceIcon(workspace: Workspace, size = 16) {
  if (workspace.kind === "FAMILY")
    return <House aria-hidden="true" size={size} strokeWidth={1.8} />;
  if (workspace.kind === "TEAM") return <Users aria-hidden="true" size={size} strokeWidth={1.8} />;
  return <UserRound aria-hidden="true" size={size} strokeWidth={1.8} />;
}

function WorkspaceSwitcher({
  workspaces,
  activeWorkspace,
  busy,
  onSelect,
  onTeamAccess,
}: {
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  busy: boolean;
  onSelect: (workspace: Workspace) => void;
  onTeamAccess: (mode: TeamAccessMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = [
    { label: "个人", kind: "PERSONAL" as const, empty: "没有个人空间" },
    { label: "团队", kind: "TEAM" as const, empty: "还没有加入团队" },
  ];

  function selectWorkspace(workspace: Workspace) {
    setOpen(false);
    onSelect(workspace);
  }

  function openAccess(mode: TeamAccessMode) {
    setOpen(false);
    onTeamAccess(mode);
  }

  const activeLabel =
    activeWorkspace.kind === "FAMILY"
      ? "家庭空间"
      : activeWorkspace.kind === "TEAM"
        ? "团队空间"
        : "个人空间";

  return (
    <div className={`workspace-switcher ${open ? "is-open" : ""}`}>
      <button
        className="workspace-trigger"
        type="button"
        aria-label={`切换空间，当前为 ${activeWorkspace.name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="workspace-trigger-icon">{workspaceIcon(activeWorkspace, 17)}</span>
        <span>
          <small>{activeLabel}</small>
          <strong>{activeWorkspace.name}</strong>
        </span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="workspace-menu" role="menu" aria-label="可用空间">
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
              创建团队
            </button>
            <button type="button" onClick={() => openAccess("JOIN")}>
              <Hash aria-hidden="true" size={15} strokeWidth={1.8} />
              使用团队号加入
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const navItems: Array<{
  view: AppView;
  label: string;
  icon: React.ReactNode;
}> = [
  { view: "CAPTURE", label: "新对话", icon: <MessageSquarePlus size={18} strokeWidth={1.75} /> },
  { view: "DIAGRAMS", label: "框图", icon: <Network size={18} strokeWidth={1.75} /> },
  { view: "KNOWLEDGE", label: "云知识库", icon: <Database size={18} strokeWidth={1.75} /> },
  { view: "RESEARCH", label: "深度调研", icon: <Microscope size={18} strokeWidth={1.75} /> },
  { view: "INSIGHTS", label: "智能洞察", icon: <BrainCircuit size={18} strokeWidth={1.75} /> },
  { view: "LIBRARY", label: "记忆库", icon: <BookOpenText size={18} strokeWidth={1.75} /> },
];

export function Sidebar({
  user,
  workspaces,
  activeWorkspace,
  workspaceBusy,
  subscription,
  conversations,
  activeConversationId,
  view,
  open,
  collapsed,
  onView,
  onNewConversation,
  onConversationSelect,
  onConversationArchive,
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
  activeConversationId: string | null;
  view: AppView;
  open: boolean;
  collapsed: boolean;
  onView: (view: AppView) => void;
  onNewConversation: () => void;
  onConversationSelect: (conversation: ConversationSummary) => void;
  onConversationArchive: (conversation: ConversationSummary) => void;
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
  const collaborative = isCollaborativeWorkspace(activeWorkspace);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);

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
                aria-label={
                  item.view === "INSIGHTS" ? (collaborative ? "团队智能" : "我的洞察") : item.label
                }
                title={
                  item.view === "INSIGHTS" ? (collaborative ? "团队智能" : "我的洞察") : item.label
                }
                key={item.view}
                onClick={() => (item.view === "CAPTURE" ? onNewConversation() : onView(item.view))}
              >
                {item.icon}
              </button>
            ))}
            {collaborative ? (
              <button
                type="button"
                className={view === "TEAM" ? "is-active" : ""}
                aria-label={activeWorkspace.kind === "FAMILY" ? "家庭成员" : "团队"}
                title={activeWorkspace.kind === "FAMILY" ? "家庭成员" : "团队"}
                onClick={() => onView("TEAM")}
              >
                <Users size={18} strokeWidth={1.75} />
              </button>
            ) : null}
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

          <WorkspaceSwitcher
            workspaces={workspaces}
            activeWorkspace={activeWorkspace}
            busy={workspaceBusy}
            onSelect={onWorkspaceSelect}
            onTeamAccess={onTeamAccess}
          />

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
                <span>
                  {item.view === "INSIGHTS"
                    ? collaborative
                      ? "团队智能"
                      : "我的洞察"
                    : item.label}
                </span>
              </button>
            ))}
            {collaborative ? (
              <button
                className={view === "TEAM" ? "is-active" : ""}
                type="button"
                aria-label={activeWorkspace.kind === "FAMILY" ? "家庭成员" : "团队"}
                onClick={() => onView("TEAM")}
              >
                {activeWorkspace.kind === "FAMILY" ? <House size={18} /> : <Users size={18} />}
                <span>{activeWorkspace.kind === "FAMILY" ? "家庭成员" : "团队"}</span>
              </button>
            ) : null}
          </nav>

          <section className="sidebar-history" aria-labelledby="sidebar-history-title">
            <header>
              <span id="sidebar-history-title">
                <History aria-hidden="true" size={14} />
                历史对话
              </span>
              <button
                type="button"
                aria-label="新建对话"
                title="新建对话"
                onClick={onNewConversation}
              >
                <Plus aria-hidden="true" size={14} />
              </button>
            </header>
            <div>
              {conversations.slice(0, 8).map((conversation) => (
                <div
                  className={conversation.id === activeConversationId ? "is-active" : ""}
                  key={conversation.id}
                >
                  <button type="button" onClick={() => onConversationSelect(conversation)}>
                    <span>{conversation.title}</span>
                    <small>{conversation.message_count}</small>
                  </button>
                  <button
                    type="button"
                    aria-label={`归档对话 ${conversation.title}`}
                    title="归档"
                    onClick={() => onConversationArchive(conversation)}
                  >
                    <Archive aria-hidden="true" size={12} />
                  </button>
                </div>
              ))}
              {!conversations.length ? <small>还没有历史对话</small> : null}
            </div>
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
            <div className="sidebar-account-card">
              <button
                ref={accountButtonRef}
                className="account-profile-button"
                type="button"
                aria-label="打开账户菜单"
                aria-expanded={accountMenuOpen}
                title="账户菜单"
                onClick={() => setAccountMenuOpen((current) => !current)}
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
    </>
  );
}
