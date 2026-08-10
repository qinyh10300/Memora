"use client";

import {
  ArrowRight,
  Check,
  Copy,
  Hash,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type {
  TeamAccessMode,
  Workspace,
  WorkspaceJoinRequest,
  WorkspaceMember,
} from "@/features/shared/contracts";
import { Logo } from "@/features/shared/icons";
import { apiErrorMessage, formatDateTime } from "@/features/shared/utils";
import { api } from "@/lib/api";

function formattedTeamCode(code: string | null) {
  if (!code) return "";
  return code.length === 12 ? `${code.slice(0, 6)}-${code.slice(6)}` : code;
}

export function TeamAccessDialog({
  initialMode,
  onClose,
  onWorkspaceReady,
}: {
  initialMode: TeamAccessMode;
  onClose: () => void;
  onWorkspaceReady: (workspace: Workspace, alreadyActive: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState<"CREATE" | "JOIN">(initialMode === "JOIN" ? "JOIN" : "CREATE");
  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTeamName, setPendingTeamName] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const normalizedName = teamName.trim();
    const normalizedCode = joinCode.replace(/[^a-z0-9]/gi, "").toUpperCase();
    if (mode === "CREATE" && !normalizedName) {
      setError("请输入团队名称");
      return;
    }
    if (mode === "JOIN" && normalizedCode.length !== 12) {
      setError("请输入完整的 12 位团队号");
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (mode === "CREATE") {
        const result = await api.POST("/workspaces", {
          body: { name: normalizedName, kind: "TEAM" },
        });
        if (!result.data || !result.response.ok) {
          throw new Error(apiErrorMessage(result.error, "创建空间失败"));
        }
        await onWorkspaceReady(result.data, false);
        onClose();
        return;
      }

      const result = await api.POST("/workspaces/join", { body: { code: normalizedCode } });
      if (!result.data || !result.response.ok) {
        throw new Error(apiErrorMessage(result.error, "团队号无效"));
      }
      if (result.data.status === "PENDING" && result.data.join_request) {
        setPendingTeamName(result.data.join_request.workspace_name);
        return;
      }
      if (result.data.status !== "ACTIVE" || !result.data.workspace) {
        throw new Error("加入状态异常，请稍后重试");
      }
      await onWorkspaceReady(result.data.workspace, true);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop team-access-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="team-access-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-access-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div className="dialog-brand">
            <Logo />
            <span>Memora</span>
          </div>
          <button ref={closeButtonRef} type="button" aria-label="关闭团队窗口" onClick={onClose}>
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>
        <p className="eyebrow">COLLABORATIVE WORKSPACE</p>
        <h2 id="team-access-title">
          {pendingTeamName ? "申请已提交" : mode === "CREATE" ? "创建团队" : "加入团队"}
        </h2>
        {pendingTeamName ? (
          <div className="team-request-success" role="status">
            <ShieldCheck aria-hidden="true" size={24} strokeWidth={1.7} />
            <strong>{pendingTeamName}</strong>
            <p>团队所有者审核通过后，这个团队会出现在你的空间列表中。</p>
            <button className="primary-action" type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : (
          <>
            <div className="team-access-tabs" role="tablist" aria-label="团队入口">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "CREATE"}
                className={mode === "CREATE" ? "is-active" : ""}
                onClick={() => {
                  setMode("CREATE");
                  setError("");
                }}
              >
                创建团队
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "JOIN"}
                className={mode === "JOIN" ? "is-active" : ""}
                onClick={() => {
                  setMode("JOIN");
                  setError("");
                }}
              >
                团队号加入
              </button>
            </div>
            <form onSubmit={submit}>
              {mode === "CREATE" ? (
                <label>
                  <span>团队名称</span>
                  <input
                    autoFocus
                    maxLength={120}
                    value={teamName}
                    onChange={(event) => setTeamName(event.target.value)}
                    placeholder="例如：产品研究组"
                  />
                </label>
              ) : (
                <label>
                  <span>团队号</span>
                  <input
                    autoFocus
                    autoCapitalize="characters"
                    maxLength={13}
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    placeholder="XXXXXX-XXXXXX"
                  />
                </label>
              )}
              {error ? <p role="alert">{error}</p> : null}
              <button className="primary-action" type="submit" disabled={busy}>
                {busy ? "处理中…" : mode === "CREATE" ? "创建并进入" : "提交加入申请"}
                {!busy ? <ArrowRight aria-hidden="true" size={16} strokeWidth={1.8} /> : null}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export function TeamWorkspace({
  workspace,
  members,
  loading,
  onMemberInvited,
  onMemberRemoved,
  onNotify,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  loading: boolean;
  onMemberInvited: (member: WorkspaceMember) => void;
  onMemberRemoved: (memberId: string) => void;
  onNotify: (message: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [joinRequests, setJoinRequests] = useState<WorkspaceJoinRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(workspace.role === "OWNER");
  const [moderatingRequestId, setModeratingRequestId] = useState("");
  const [removingMemberId, setRemovingMemberId] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState("");
  const joinCode = formattedTeamCode(workspace.join_code);
  const spaceNoun = workspace.kind === "FAMILY" ? "家庭" : "团队";

  useEffect(() => {
    let active = true;
    if (workspace.role !== "OWNER") {
      return () => {
        active = false;
      };
    }
    void api.GET("/workspace/join-requests").then((result) => {
      if (!active) return;
      setJoinRequests(result.data && result.response.ok ? result.data : []);
      setLoadingRequests(false);
    });
    return () => {
      active = false;
    };
  }, [workspace.id, workspace.role]);

  async function copyJoinCode() {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      onNotify(`${spaceNoun}号已复制`);
    } catch {
      onNotify(`复制失败，请手动选择${spaceNoun}号`);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || inviting) return;
    setInviting(true);
    setInviteError("");
    const result = await api.POST("/workspaces/{workspace_id}/members", {
      params: { path: { workspace_id: workspace.id } },
      body: { email: normalizedEmail },
    });
    if (!result.data || !result.response.ok) {
      setInviteError(apiErrorMessage(result.error, "邀请失败，请确认对方已经注册"));
      setInviting(false);
      return;
    }
    onMemberInvited(result.data);
    setJoinRequests((current) => current.filter((item) => item.user_id !== result.data?.id));
    setEmail("");
    setInviting(false);
    onNotify(`已邀请 ${result.data.display_name} 加入${spaceNoun}`);
  }

  async function reviewJoinRequest(
    joinRequest: WorkspaceJoinRequest,
    decision: "APPROVE" | "REJECT",
  ) {
    if (moderatingRequestId) return;
    setModeratingRequestId(joinRequest.user_id);
    try {
      if (decision === "APPROVE") {
        const result = await api.POST("/workspace/join-requests/{user_id}/approve", {
          params: { path: { user_id: joinRequest.user_id } },
        });
        if (!result.data || !result.response.ok) throw new Error("approve_failed");
        onMemberInvited(result.data);
        onNotify(`已允许 ${joinRequest.display_name} 加入${spaceNoun}`);
      } else {
        const result = await api.POST("/workspace/join-requests/{user_id}/reject", {
          params: { path: { user_id: joinRequest.user_id } },
        });
        if (!result.data || !result.response.ok) throw new Error("reject_failed");
        onNotify(`已拒绝 ${joinRequest.display_name} 的申请`);
      }
      setJoinRequests((current) => current.filter((item) => item.user_id !== joinRequest.user_id));
    } catch {
      onNotify("审核失败，请稍后重试");
    } finally {
      setModeratingRequestId("");
    }
  }

  async function removeMember(member: WorkspaceMember) {
    if (removingMemberId) return;
    if (confirmRemoveId !== member.id) {
      setConfirmRemoveId(member.id);
      return;
    }
    setRemovingMemberId(member.id);
    try {
      const result = await api.DELETE("/workspace/members/{user_id}", {
        params: { path: { user_id: member.id } },
      });
      if (!result.response.ok) throw new Error("remove_failed");
      onMemberRemoved(member.id);
      setConfirmRemoveId("");
      onNotify(`已将 ${member.display_name} 移出${spaceNoun}`);
    } catch {
      onNotify("移除成员失败，请稍后重试");
    } finally {
      setRemovingMemberId("");
    }
  }

  return (
    <section className="team-workspace" aria-labelledby="team-workspace-title">
      <header className="team-workspace-header">
        <div>
          <p className="eyebrow">
            {workspace.kind === "FAMILY" ? "FAMILY SPACE" : "TEAM WORKSPACE"}
          </p>
          <h1 id="team-workspace-title">{workspace.name}</h1>
          <p>{spaceNoun}记忆只包含成员主动设为“空间共享”的内容。</p>
        </div>
        <span className="team-role-badge">{workspace.role === "OWNER" ? "所有者" : "成员"}</span>
      </header>

      <div className={`team-summary-band ${workspace.role === "OWNER" ? "has-requests" : ""}`}>
        <div>
          <Hash aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>
            <small>{spaceNoun}号</small>
            <code>{joinCode || "尚未生成"}</code>
          </span>
          {joinCode ? (
            <button
              type="button"
              aria-label={`复制${spaceNoun}号`}
              title={`复制${spaceNoun}号`}
              onClick={() => void copyJoinCode()}
            >
              <Copy aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div>
          <Users aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>
            <small>{spaceNoun}成员</small>
            <strong>{members.length}</strong>
          </span>
        </div>
        {workspace.role === "OWNER" ? (
          <div>
            <UserPlus aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>
              <small>待审核</small>
              <strong>{joinRequests.length}</strong>
            </span>
          </div>
        ) : null}
      </div>

      <div className="team-content-grid">
        {workspace.role === "OWNER" ? (
          <section className="team-requests-panel" aria-labelledby="team-requests-title">
            <header>
              <div>
                <p className="eyebrow">REQUESTS</p>
                <h2 id="team-requests-title">加入申请</h2>
              </div>
              <span>{joinRequests.length}</span>
            </header>
            {loadingRequests ? (
              <p className="team-members-loading" role="status">
                正在读取申请…
              </p>
            ) : joinRequests.length ? (
              <ol>
                {joinRequests.map((joinRequest) => (
                  <li key={joinRequest.user_id}>
                    <span className="member-avatar">
                      {joinRequest.display_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{joinRequest.display_name}</strong>
                      <time dateTime={joinRequest.requested_at}>
                        {formatDateTime(joinRequest.requested_at)} 申请
                      </time>
                    </span>
                    <span className="request-actions">
                      <button
                        type="button"
                        className="request-reject"
                        disabled={Boolean(moderatingRequestId)}
                        onClick={() => void reviewJoinRequest(joinRequest, "REJECT")}
                      >
                        拒绝
                      </button>
                      <button
                        type="button"
                        className="request-approve"
                        disabled={Boolean(moderatingRequestId)}
                        onClick={() => void reviewJoinRequest(joinRequest, "APPROVE")}
                      >
                        <Check aria-hidden="true" size={14} strokeWidth={2} />
                        {moderatingRequestId === joinRequest.user_id ? "处理中" : "允许"}
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="team-requests-empty">目前没有待审核的申请。</p>
            )}
          </section>
        ) : null}

        <section className="team-members-panel" aria-labelledby="team-members-title">
          <header>
            <div>
              <p className="eyebrow">MEMBERS</p>
              <h2 id="team-members-title">组织成员</h2>
            </div>
            <span>{members.length}</span>
          </header>
          {loading ? (
            <p className="team-members-loading" role="status">
              正在读取成员…
            </p>
          ) : (
            <ol>
              {members.map((member) => (
                <li key={member.id}>
                  <span className="member-avatar">
                    {member.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {member.display_name}
                      {member.is_current_user ? <small>你</small> : null}
                    </strong>
                    <time dateTime={member.joined_at}>{formatDateTime(member.joined_at)} 加入</time>
                  </span>
                  <span className="member-row-actions">
                    <em>{member.role === "OWNER" ? "所有者" : "成员"}</em>
                    {workspace.role === "OWNER" && member.role !== "OWNER" ? (
                      <button
                        type="button"
                        className={confirmRemoveId === member.id ? "is-confirming" : ""}
                        disabled={Boolean(removingMemberId)}
                        aria-label={`移除成员 ${member.display_name}`}
                        title={
                          confirmRemoveId === member.id ? "再次点击确认移除" : `移出${spaceNoun}`
                        }
                        onBlur={() => setConfirmRemoveId("")}
                        onClick={() => void removeMember(member)}
                      >
                        <UserMinus aria-hidden="true" size={14} strokeWidth={1.8} />
                        {confirmRemoveId === member.id ? "确认" : null}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="team-invite-panel" aria-labelledby="team-invite-title">
          <p className="eyebrow">INVITE</p>
          <h2 id="team-invite-title">邀请成员</h2>
          {workspace.role === "OWNER" ? (
            <form onSubmit={invite}>
              <label>
                <span>已注册邮箱</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                  disabled={inviting}
                />
              </label>
              {inviteError ? <p role="alert">{inviteError}</p> : null}
              <button className="primary-action" type="submit" disabled={!email.trim() || inviting}>
                <UserPlus aria-hidden="true" size={16} strokeWidth={1.8} />
                {inviting ? "邀请中…" : `添加到${spaceNoun}`}
              </button>
            </form>
          ) : (
            <p>{spaceNoun}所有者可以通过已注册邮箱添加成员。</p>
          )}
          <div className="team-invite-code">
            <Hash aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>也可以把{spaceNoun}号发给对方；对方提交申请后，由所有者审核。</span>
          </div>
        </section>
      </div>
    </section>
  );
}
