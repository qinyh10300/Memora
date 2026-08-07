"use client";

import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  Hash,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  UserRound,
  Users,
} from "lucide-react";
import { useState } from "react";

import type { AppView, CurrentUser, TeamAccessMode, Workspace } from "@/features/shared/contracts";
import { CaptureIcon, CloseIcon, LibraryIcon, Logo, UserAvatar } from "@/features/shared/icons";

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
  const personalSpaces = workspaces.filter((workspace) => workspace.kind === "PERSONAL");
  const teamSpaces = workspaces.filter((workspace) => workspace.kind === "TEAM");

  function selectWorkspace(workspace: Workspace) {
    setOpen(false);
    onSelect(workspace);
  }

  function openTeamAccess(mode: TeamAccessMode) {
    setOpen(false);
    onTeamAccess(mode);
  }

  return (
    <div className={`workspace-switcher ${open ? "is-open" : ""}`}>
      <button
        className="workspace-trigger"
        type="button"
        aria-label={`切换空间，当前为 ${activeWorkspace.name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="workspace-trigger-icon">
          {activeWorkspace.kind === "TEAM" ? (
            <Building2 aria-hidden="true" size={17} strokeWidth={1.8} />
          ) : (
            <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
          )}
        </span>
        <span>
          <small>{activeWorkspace.kind === "TEAM" ? "团队空间" : "个人空间"}</small>
          <strong>{activeWorkspace.name}</strong>
        </span>
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="workspace-menu" role="menu" aria-label="可用空间">
          <div className="workspace-menu-group">
            <span>个人</span>
            {personalSpaces.map((workspace) => (
              <button
                type="button"
                role="menuitem"
                className={workspace.id === activeWorkspace.id ? "is-current" : ""}
                key={workspace.id}
                disabled={busy}
                onClick={() => selectWorkspace(workspace)}
              >
                <UserRound aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>{workspace.name}</span>
                {workspace.id === activeWorkspace.id ? (
                  <Check aria-hidden="true" size={14} strokeWidth={2} />
                ) : null}
              </button>
            ))}
          </div>
          <div className="workspace-menu-group">
            <span>团队</span>
            {teamSpaces.length ? (
              teamSpaces.map((workspace) => (
                <button
                  type="button"
                  role="menuitem"
                  className={workspace.id === activeWorkspace.id ? "is-current" : ""}
                  key={workspace.id}
                  disabled={busy}
                  onClick={() => selectWorkspace(workspace)}
                >
                  <Building2 aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span>{workspace.name}</span>
                  {workspace.id === activeWorkspace.id ? (
                    <Check aria-hidden="true" size={14} strokeWidth={2} />
                  ) : null}
                </button>
              ))
            ) : (
              <small>还没有加入团队</small>
            )}
          </div>
          <div className="workspace-menu-actions">
            <button type="button" onClick={() => openTeamAccess("CREATE")}>
              <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
              创建团队
            </button>
            <button type="button" onClick={() => openTeamAccess("JOIN")}>
              <Hash aria-hidden="true" size={15} strokeWidth={1.8} />
              使用团队号加入
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Sidebar({
  user,
  workspaces,
  activeWorkspace,
  workspaceBusy,
  view,
  open,
  collapsed,
  onView,
  onWorkspaceSelect,
  onTeamAccess,
  onClose,
  onCollapse,
  onExpand,
  onOpenSettings,
  onLogout,
}: {
  user: CurrentUser;
  workspaces: Workspace[];
  activeWorkspace: Workspace;
  workspaceBusy: boolean;
  view: AppView;
  open: boolean;
  collapsed: boolean;
  onView: (view: AppView) => void;
  onWorkspaceSelect: (workspace: Workspace) => void;
  onTeamAccess: (mode: TeamAccessMode) => void;
  onClose: () => void;
  onCollapse: () => void;
  onExpand: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
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
        <div className="sidebar-collapsed-content">
          <Logo />
          <button type="button" aria-label="展开侧边栏" title="展开侧边栏" onClick={onExpand}>
            <PanelLeftOpen aria-hidden="true" size={18} strokeWidth={1.7} />
          </button>
        </div>

        <div className="sidebar-expanded-content">
          <div className="sidebar-brand">
            <Logo />
            <span>Memora</span>
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
            <button
              className={view === "CAPTURE" ? "is-active" : ""}
              type="button"
              onClick={() => onView("CAPTURE")}
            >
              <CaptureIcon />
              <span>记录想法</span>
            </button>
            <button
              className={view === "LIBRARY" ? "is-active" : ""}
              type="button"
              onClick={() => onView("LIBRARY")}
            >
              <LibraryIcon />
              <span>记忆库</span>
            </button>
            {activeWorkspace.kind === "TEAM" ? (
              <button
                className={view === "TEAM" ? "is-active" : ""}
                type="button"
                onClick={() => onView("TEAM")}
              >
                <Users aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>团队</span>
              </button>
            ) : null}
          </nav>

          <div className="sidebar-note">
            <span className="privacy-dot" />
            <div>
              <strong>{activeWorkspace.kind === "TEAM" ? activeWorkspace.name : "个人空间"}</strong>
              <small>
                {activeWorkspace.kind === "TEAM"
                  ? "保存时选择仅自己或团队共享"
                  : "所有新记忆仅你可见"}
              </small>
            </div>
          </div>

          <div className="sidebar-account">
            <button
              className="account-profile-button"
              type="button"
              aria-label="打开个人设置"
              title="个人设置"
              onClick={onOpenSettings}
            >
              <UserAvatar user={user} />
              <span className="account-copy">
                <strong>{user.display_name}</strong>
                <small>{user.email}</small>
              </span>
              <ChevronRight aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
            <button
              className="account-logout-button"
              type="button"
              aria-label="退出登录"
              title="退出登录"
              onClick={onLogout}
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
