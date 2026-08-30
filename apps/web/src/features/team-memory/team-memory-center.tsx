"use client";

import {
  ArrowUpRight,
  GripHorizontal,
  MessageCircleQuestion,
  Search,
  Users,
  X,
} from "lucide-react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Memory, Workspace, WorkspaceMember } from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { clampNumber, dayKey, formatTime, memoryTitle } from "@/features/shared/utils";

function activityLabel(memory: Memory) {
  if (memory.revision_kind === "UPDATE_CURRENT") return "更新了";
  if (memory.revision_kind === "NEW_VERSION") return "新增了版本";
  return memory.visibility === "WORKSPACE" ? "共享了" : "新建了";
}

function activityTone(memory: Memory) {
  if (memory.revision_kind === "UPDATE_CURRENT") return "is-update";
  if (memory.revision_kind === "NEW_VERSION") return "is-version";
  return "is-share";
}

export function TeamMemoryCenter({
  workspace,
  members,
  sharedMemories,
  selectedAuthorId,
  memories,
  searchOpen,
  onSearchTeam,
  onMemberSelect,
  onAskTeam,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  sharedMemories: Memory[];
  selectedAuthorId: string;
  memories: ReactNode;
  searchOpen: boolean;
  onSearchTeam: () => void;
  onMemberSelect: (authorId: string) => void;
  onAskTeam: () => void;
}) {
  const collaborative = isCollaborativeWorkspace(workspace);
  const [askOpen, setAskOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const miniChatRef = useRef<HTMLDivElement>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const todayMemories = useMemo(() => {
    const today = dayKey(new Date().toISOString());
    return sharedMemories.filter((memory) => dayKey(memory.created_at) === today);
  }, [sharedMemories]);

  useEffect(() => {
    if (!askOpen) return undefined;
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setAskOpen(false);
    }
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, [askOpen]);

  useLayoutEffect(() => {
    if (!askOpen) return undefined;

    function keepMiniChatInViewport() {
      const panel = miniChatRef.current;
      if (!panel) return;
      const panelRect = panel.getBoundingClientRect();
      if (!panelRect.width || !panelRect.height) return;
      const rightEdge = window.innerWidth - 12;
      const bottomEdge = window.innerHeight - 12;
      let deltaX = 0;
      let deltaY = 0;

      if (panelRect.left < 12) deltaX = 12 - panelRect.left;
      else if (panelRect.right > rightEdge) deltaX = rightEdge - panelRect.right;
      if (panelRect.top < 12) deltaY = 12 - panelRect.top;
      else if (panelRect.bottom > bottomEdge) deltaY = bottomEdge - panelRect.bottom;

      if (deltaX || deltaY) {
        setPosition((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
      }
    }

    keepMiniChatInViewport();
    window.addEventListener("resize", keepMiniChatInViewport);
    window.visualViewport?.addEventListener("resize", keepMiniChatInViewport);
    return () => {
      window.removeEventListener("resize", keepMiniChatInViewport);
      window.visualViewport?.removeEventListener("resize", keepMiniChatInViewport);
    };
  }, [askOpen]);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );

  function startDragging(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const panel = miniChatRef.current;
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragCleanupRef.current?.();

    const panelRect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = position;
    document.body.classList.add("is-dragging-team-chat");

    const move = (moveEvent: globalThis.PointerEvent) => {
      const deltaX = clampNumber(
        moveEvent.clientX - startX,
        12 - panelRect.left,
        window.innerWidth - 12 - panelRect.right,
      );
      const deltaY = clampNumber(
        moveEvent.clientY - startY,
        12 - panelRect.top,
        window.innerHeight - 12 - panelRect.bottom,
      );
      setPosition({ x: origin.x + deltaX, y: origin.y + deltaY });
    };
    const stop = () => {
      document.body.classList.remove("is-dragging-team-chat");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  if (!collaborative) {
    return (
      <section className="team-memory-center is-empty" aria-labelledby="team-memory-title">
        <div className="team-memory-empty">
          <span>
            <Users aria-hidden="true" size={23} strokeWidth={1.65} />
          </span>
          <p className="eyebrow">TEAM MEMORY</p>
          <h1 id="team-memory-title">进入团队后查看共享记忆</h1>
          <p>从左侧的空间选择器进入协作团队，即可浏览成员主动共享的记忆。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="team-memory-center" aria-labelledby="team-memory-title">
      <header className="team-memory-header">
        <div className="team-memory-heading">
          <h1 id="team-memory-title">团队记忆</h1>
          <p className="team-memory-stats" aria-label="团队记忆概览">
            <span>
              <b>{members.length}</b> 位成员
            </span>
            <span>
              <b>{sharedMemories.length}</b> 条记忆
            </span>
            <span>
              今天 <b>{todayMemories.length}</b> 次更新
            </span>
          </p>
          <ul className="team-memory-recent" aria-label="今日团队记忆动态">
            {todayMemories.length ? (
              todayMemories.slice(0, 2).map((memory) => (
                <li className={activityTone(memory)} key={memory.id}>
                  <span aria-hidden="true" />
                  <b>{memory.author.display_name}</b>
                  <span>{activityLabel(memory)}</span>
                  <strong>“{memory.title ?? memoryTitle(memory.body)}”</strong>
                  <time dateTime={memory.created_at}>{formatTime(memory.created_at)}</time>
                </li>
              ))
            ) : (
              <li className="is-empty">今天还没有新的共享动态</li>
            )}
          </ul>
        </div>
        <div className="team-memory-actions">
          <button
            className="team-memory-search"
            type="button"
            aria-expanded={searchOpen}
            onClick={onSearchTeam}
          >
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            搜索
          </button>
          <button
            className="team-memory-ask"
            type="button"
            aria-expanded={askOpen}
            onClick={() => setAskOpen(true)}
          >
            <MessageCircleQuestion aria-hidden="true" size={17} strokeWidth={1.8} />
            问团队记忆
          </button>
        </div>
      </header>

      <nav className="team-memory-members" aria-label="按成员筛选团队记忆">
        <button
          type="button"
          aria-pressed={!selectedAuthorId}
          className={!selectedAuthorId ? "is-active" : ""}
          onClick={() => onMemberSelect("")}
        >
          全部成员
        </button>
        {members.map((member, index) => (
          <button
            type="button"
            key={member.id}
            aria-label={`查看 ${member.display_name} 的记忆`}
            aria-pressed={selectedAuthorId === member.id}
            className={`${selectedAuthorId === member.id ? "is-active " : ""}is-tone-${index % 3}`}
            onClick={() => onMemberSelect(member.id)}
          >
            <span aria-hidden="true">{member.display_name.trim().slice(0, 1).toUpperCase()}</span>
            {member.display_name}
          </button>
        ))}
      </nav>

      <div className="team-memory-panel">{memories}</div>

      {askOpen ? (
        <div
          className="team-chat-mini"
          role="dialog"
          aria-modal="false"
          aria-label="团队记忆新对话"
          ref={miniChatRef}
          style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` } as CSSProperties}
        >
          <header className="team-chat-mini-handle" onPointerDown={startDragging}>
            <GripHorizontal aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>团队记忆新对话</span>
            <button
              type="button"
              aria-label="关闭团队记忆新对话"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setAskOpen(false)}
            >
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </header>
          <button
            className="team-chat-mini-open"
            type="button"
            onClick={() => {
              setAskOpen(false);
              onAskTeam();
            }}
          >
            <span className="team-chat-mini-icon">
              <MessageCircleQuestion aria-hidden="true" size={20} strokeWidth={1.8} />
            </span>
            <span>
              <strong>询问团队共享的记忆</strong>
              <small>进入新对话后，只使用成员主动共享的内容回答。</small>
            </span>
            <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
          <p>拖动顶部可以移动 · 点击卡片进入完整新对话</p>
        </div>
      ) : null}
    </section>
  );
}
