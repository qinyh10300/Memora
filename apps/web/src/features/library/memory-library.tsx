"use client";

import { FilePenLine, LockKeyhole, PencilLine, Search, Users, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownPreview, MarkdownWorkspace } from "@/features/capture/markdown-workspace";
import type {
  Memory,
  MemorySearchFilters,
  MemoryVisibility,
  RevisionMode,
  Workspace,
  WorkspaceMember,
} from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { LibraryIcon, SparkleIcon } from "@/features/shared/icons";
import {
  dayKey,
  dayLabel,
  formatDateTime,
  formatTime,
  memoryExcerpt,
  memoryTitle,
} from "@/features/shared/utils";

function MemorySearchPopover({
  workspace,
  members,
  showMemberFilter,
  filters,
  active,
  searching,
  controlledOpen,
  hideTrigger = false,
  onChange,
  onSubmit,
  onReset,
  onOpenChange,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  showMemberFilter: boolean;
  filters: MemorySearchFilters;
  active: boolean;
  searching: boolean;
  controlledOpen?: boolean;
  hideTrigger?: boolean;
  onChange: (filters: MemorySearchFilters) => void;
  onSubmit: () => void;
  onReset: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const hasCriteria = Boolean(
    filters.query.trim() || filters.from || filters.to || filters.authorId,
  );

  const changeOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) setLocalOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    function closePopover(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) changeOpen(false);
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") changeOpen(false);
    }
    window.addEventListener("mousedown", closePopover);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("mousedown", closePopover);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [changeOpen, open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasCriteria || searching) return;
    onSubmit();
    changeOpen(false);
  }

  return (
    <div className="library-search" ref={rootRef}>
      {hideTrigger ? null : (
        <button
          className={active ? "library-search-trigger is-active" : "library-search-trigger"}
          type="button"
          aria-label="检索记忆库"
          title="检索记忆库"
          aria-expanded={open}
          onClick={() => changeOpen(!open)}
        >
          <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      )}
      {open ? (
        <form className="library-search-popover" onSubmit={submit}>
          <header>
            <strong>检索记忆</strong>
            <button type="button" aria-label="关闭检索" onClick={() => changeOpen(false)}>
              <X aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          </header>
          <label className="library-search-query">
            <span>关键词</span>
            <span>
              <Search aria-hidden="true" size={14} strokeWidth={1.8} />
              <input
                autoFocus
                value={filters.query}
                onChange={(event) => onChange({ ...filters, query: event.target.value })}
                placeholder={filters.field === "TITLE" ? "检索标题" : "检索正文与标题"}
              />
            </span>
          </label>
          <div className="library-search-segment" role="group" aria-label="关键词检索范围">
            <button
              type="button"
              className={filters.field === "ALL" ? "is-active" : ""}
              aria-pressed={filters.field === "ALL"}
              onClick={() => onChange({ ...filters, field: "ALL" })}
            >
              全文
            </button>
            <button
              type="button"
              className={filters.field === "TITLE" ? "is-active" : ""}
              aria-pressed={filters.field === "TITLE"}
              onClick={() => onChange({ ...filters, field: "TITLE" })}
            >
              仅标题
            </button>
          </div>
          <div className="library-date-fields">
            <label>
              <span>开始日期</span>
              <input
                type="date"
                value={filters.from}
                onChange={(event) => onChange({ ...filters, from: event.target.value })}
              />
            </label>
            <label>
              <span>结束日期</span>
              <input
                type="date"
                value={filters.to}
                onChange={(event) => onChange({ ...filters, to: event.target.value })}
              />
            </label>
          </div>
          {showMemberFilter && isCollaborativeWorkspace(workspace) ? (
            <label>
              <span>空间成员</span>
              <select
                value={filters.authorId}
                onChange={(event) => onChange({ ...filters, authorId: event.target.value })}
              >
                <option value="">全部成员</option>
                {members.map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <footer>
            <button
              type="button"
              disabled={!active && !hasCriteria}
              onClick={() => {
                onReset();
                changeOpen(false);
              }}
            >
              清除
            </button>
            <button className="primary-action" type="submit" disabled={!hasCriteria || searching}>
              {searching ? "检索中…" : "检索"}
            </button>
          </footer>
        </form>
      ) : null}
    </div>
  );
}

export function Timeline({
  workspace,
  members,
  memories,
  selectedId,
  loading,
  searchFilters,
  searchActive,
  onSearchFiltersChange,
  onSearch,
  onResetSearch,
  onMemberSelect,
  onSelect,
  title = "记忆库",
  eyebrow,
  headerAction,
  showMemberFilter = isCollaborativeWorkspace(workspace),
  showMemberQuickFilter = showMemberFilter,
  searchOpen,
  onSearchOpenChange,
  hideSearchTrigger = false,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  memories: Memory[];
  selectedId: string | null;
  loading: boolean;
  searchFilters: MemorySearchFilters;
  searchActive: boolean;
  onSearchFiltersChange: (filters: MemorySearchFilters) => void;
  onSearch: () => void;
  onResetSearch: () => void;
  onMemberSelect?: (authorId: string) => void;
  onSelect: (memory: Memory) => void;
  title?: string;
  eyebrow?: string;
  headerAction?: ReactNode;
  showMemberFilter?: boolean;
  showMemberQuickFilter?: boolean;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  hideSearchTrigger?: boolean;
}) {
  const displayedMemories = useMemo(
    () =>
      searchFilters.authorId
        ? memories.filter((memory) => memory.author.id === searchFilters.authorId)
        : memories,
    [memories, searchFilters.authorId],
  );
  const groups = useMemo(() => {
    const result: { key: string; label: string; memories: Memory[] }[] = [];
    for (const memory of displayedMemories) {
      const key = dayKey(memory.created_at);
      const current = result[result.length - 1];
      if (!current || current.key !== key) {
        result.push({ key, label: dayLabel(memory.created_at), memories: [memory] });
      } else {
        current.memories.push(memory);
      }
    }
    return result;
  }, [displayedMemories]);

  return (
    <section
      className="timeline-panel"
      aria-label={isCollaborativeWorkspace(workspace) ? "共享记忆时间线" : "个人记忆时间线"}
    >
      <header className="library-list-header">
        <div>
          <p className="eyebrow">
            {eyebrow ?? (isCollaborativeWorkspace(workspace) ? workspace.name : "个人记忆")}
          </p>
          <h1>{title}</h1>
          <span>
            {displayedMemories.length} 条记忆
            {searchFilters.authorId
              ? ` · ${members.find((member) => member.id === searchFilters.authorId)?.display_name ?? "已选成员"}`
              : ""}
          </span>
        </div>
        <div className="library-list-actions">
          {headerAction}
          <MemorySearchPopover
            workspace={workspace}
            members={members}
            showMemberFilter={showMemberFilter}
            filters={searchFilters}
            active={searchActive}
            searching={loading}
            controlledOpen={searchOpen}
            hideTrigger={hideSearchTrigger}
            onChange={onSearchFiltersChange}
            onSubmit={onSearch}
            onReset={onResetSearch}
            onOpenChange={onSearchOpenChange}
          />
        </div>
      </header>
      {showMemberQuickFilter && isCollaborativeWorkspace(workspace) ? (
        <div className="memory-member-filter" aria-label="按成员筛选记忆">
          <button
            type="button"
            aria-pressed={!searchFilters.authorId}
            className={!searchFilters.authorId ? "is-active" : ""}
            onClick={() => onMemberSelect?.("")}
          >
            全部成员
          </button>
          {members.map((member) => (
            <button
              type="button"
              key={member.id}
              aria-label={`查看 ${member.display_name} 的记忆`}
              aria-pressed={searchFilters.authorId === member.id}
              className={searchFilters.authorId === member.id ? "is-active" : ""}
              onClick={() => onMemberSelect?.(member.id)}
            >
              <span aria-hidden="true">{member.display_name.trim().slice(0, 1).toUpperCase()}</span>
              {member.display_name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="timeline-scroll">
        {loading ? (
          <div className="timeline-skeleton" role="status" aria-label="正在读取记忆…">
            {[0, 1, 2, 3].map((row) => (
              <div key={row}>
                <span className="skeleton-line" />
                <span className="skeleton-node" />
                <span className="skeleton-copy">
                  <span className="skeleton-line" />
                  <span className="skeleton-line" />
                </span>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="timeline-empty">
            <LibraryIcon />
            <strong>{searchActive ? "没有匹配的记忆" : "还没有记忆"}</strong>
            <p>
              {searchActive
                ? "可以调整关键词、日期或成员筛选。"
                : "先去记录一个想法，它会按时间出现在这里。"}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <section className="timeline-group" key={group.key}>
              <h2>{group.label}</h2>
              <div>
                {group.memories.map((memory) => (
                  <button
                    className={`memory-card is-${memory.revision_kind.toLowerCase()} ${
                      selectedId === memory.id ? "is-selected" : ""
                    }`}
                    type="button"
                    key={memory.id}
                    onClick={() => onSelect(memory)}
                    aria-label={`查看记忆：${memory.title ?? memoryTitle(memory.body)}，作者 ${memory.author.display_name}`}
                  >
                    <time dateTime={memory.created_at}>{formatTime(memory.created_at)}</time>
                    <span className="timeline-node" />
                    <span className="memory-card-copy">
                      <span className="memory-card-activity">
                        <span aria-hidden="true">
                          {memory.author.display_name.trim().slice(0, 1).toUpperCase()}
                        </span>
                        <b>{memory.author.display_name}</b>
                        <em>
                          {memory.revision_kind === "UPDATE_CURRENT"
                            ? "更新了"
                            : memory.revision_kind === "NEW_VERSION"
                              ? "新增了版本"
                              : memory.visibility === "WORKSPACE"
                                ? "共享了"
                                : "新建了"}
                        </em>
                      </span>
                      <strong>{memory.title ?? memoryTitle(memory.body)}</strong>
                      <small>{memoryExcerpt(memory.body)}</small>
                      <span className="memory-card-meta">
                        <span>
                          {memory.revision_kind === "UPDATE_CURRENT"
                            ? "已保留旧修订"
                            : memory.revision_kind === "NEW_VERSION"
                              ? "独立时间点"
                              : "首个版本"}
                        </span>
                        <span className={`is-${memory.visibility.toLowerCase()}`}>
                          {memory.visibility === "WORKSPACE" ? "团队共享" : "仅自己"}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </section>
  );
}

export function MemoryDetail({
  workspace,
  memory,
  markdown,
  baseline,
  revisions,
  refining,
  savingMode,
  deleting,
  visibilityChanging,
  aiStatus,
  onMarkdownChange,
  onRefine,
  onSaveRevision,
  onVisibilityChange,
  onDelete,
}: {
  workspace: Workspace;
  memory: Memory | null;
  markdown: string;
  baseline: string;
  revisions: Memory[];
  refining: boolean;
  savingMode: RevisionMode | null;
  deleting: boolean;
  visibilityChanging: boolean;
  aiStatus: string;
  onMarkdownChange: (value: string) => void;
  onRefine: (instruction: string) => Promise<void>;
  onSaveRevision: (mode: RevisionMode) => Promise<void>;
  onVisibilityChange: (visibility: MemoryVisibility) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<"CONTENT" | "HISTORY">("CONTENT");
  const [editing, setEditing] = useState(false);
  const dirty = Boolean(memory?.is_owner && markdown.trim() && markdown.trim() !== baseline.trim());

  if (!memory) {
    return (
      <section className="memory-detail is-empty">
        <div>
          <LibraryIcon />
          <h2>选择一条记忆</h2>
          <p>原始 Markdown 会显示在这里，你可以直接修改或让 AI 帮你调整。</p>
        </div>
      </section>
    );
  }

  async function submitAi(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = instruction.trim();
    if (!value || refining) return;
    setInstruction("");
    await onRefine(value);
  }

  async function requestDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    await onDelete();
  }

  return (
    <section className="memory-detail" aria-label="记忆详情">
      <header className="detail-header">
        <div>
          <p className="eyebrow">记忆详情</p>
          <h2>{memoryTitle(baseline)}</h2>
          <p>
            {formatDateTime(memory.created_at)} · {memory.author.display_name} ·{" "}
            {memory.visibility === "WORKSPACE" ? "团队共享" : "仅自己可见"}
          </p>
        </div>
        <div className="detail-header-actions">
          {memory.is_owner ? (
            <button
              className={editing ? "memory-edit-toggle is-active" : "memory-edit-toggle"}
              type="button"
              aria-pressed={editing}
              onClick={() => {
                setEditing((current) => !current);
                setActiveTab("CONTENT");
              }}
            >
              {editing ? (
                <FilePenLine aria-hidden="true" size={15} strokeWidth={1.8} />
              ) : (
                <PencilLine aria-hidden="true" size={15} strokeWidth={1.8} />
              )}
              {editing ? "返回阅读" : "编辑 Markdown"}
            </button>
          ) : null}
          {memory.is_owner && isCollaborativeWorkspace(workspace) ? (
            <button
              className="visibility-action"
              type="button"
              disabled={visibilityChanging}
              onClick={() =>
                void onVisibilityChange(memory.visibility === "WORKSPACE" ? "PRIVATE" : "WORKSPACE")
              }
            >
              {memory.visibility === "WORKSPACE" ? (
                <LockKeyhole aria-hidden="true" size={15} strokeWidth={1.8} />
              ) : (
                <Users aria-hidden="true" size={15} strokeWidth={1.8} />
              )}
              {visibilityChanging
                ? "更新中…"
                : memory.visibility === "WORKSPACE"
                  ? "撤回共享"
                  : "共享给空间"}
            </button>
          ) : null}
          {memory.is_owner ? (
            <button
              className={confirmingDelete ? "delete-button is-confirming" : "delete-button"}
              type="button"
              disabled={deleting}
              onClick={() => void requestDelete()}
              onBlur={() => setConfirmingDelete(false)}
            >
              {deleting ? "正在删除…" : confirmingDelete ? "确认删除" : "删除"}
            </button>
          ) : null}
        </div>
      </header>

      {memory.document_citations?.length ? (
        <div className="memory-document-sources" aria-label="记忆文档来源">
          <span>文档来源</span>
          <div>
            {memory.document_citations.map((citation) => (
              <a
                href={citation.content_url}
                key={citation.id}
                target="_blank"
                rel="noopener noreferrer"
                title={citation.excerpt}
              >
                <strong>{citation.asset_name}</strong>
                <small>
                  第 {citation.page_number} 页{citation.heading ? ` · ${citation.heading}` : ""}
                </small>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <nav className="memory-detail-tabs" role="tablist" aria-label="记忆详情视图">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "CONTENT"}
          className={activeTab === "CONTENT" ? "is-active" : ""}
          onClick={() => setActiveTab("CONTENT")}
        >
          Markdown 内容
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "HISTORY"}
          className={activeTab === "HISTORY" ? "is-active" : ""}
          onClick={() => setActiveTab("HISTORY")}
        >
          修改记录 <span>{revisions.length}</span>
        </button>
      </nav>

      {activeTab === "CONTENT" ? (
        editing && memory.is_owner ? (
          <MarkdownWorkspace
            className="detail-editor-wrap"
            editorClassName="detail-editor"
            value={markdown}
            onChange={onMarkdownChange}
            ariaLabel="记忆 Markdown"
            previewVisible
          />
        ) : (
          <div className="memory-markdown-reader">
            <MarkdownPreview value={markdown} />
          </div>
        )
      ) : (
        <section className="memory-revision-panel" aria-label="记忆修改记录">
          <header>
            <div>
              <strong>{memory.is_owner ? "完整修订记录" : "当前共享版本"}</strong>
              <p>
                {memory.is_owner
                  ? "每次正文修改都生成不可变修订，当前版本排在最前。"
                  : "你只能查看作者主动共享的当前版本，隐藏修订仍由作者保留。"}
              </p>
            </div>
            <span>{revisions.length} 个可见版本</span>
          </header>
          <ol>
            {revisions.map((revision, index) => (
              <li key={revision.id}>
                <span className="revision-marker" aria-hidden="true" />
                <div>
                  <p>
                    <strong>
                      {revision.revision_kind === "UPDATE_CURRENT"
                        ? "更新了当前记忆"
                        : revision.revision_kind === "NEW_VERSION"
                          ? "保存为新版本"
                          : revision.visibility === "WORKSPACE"
                            ? "创建并共享了记忆"
                            : "创建了记忆"}
                    </strong>
                    <span>{index === 0 ? "当前" : `历史 ${index}`}</span>
                  </p>
                  <time dateTime={revision.created_at}>
                    {formatDateTime(revision.created_at)} · {revision.author.display_name}
                  </time>
                  <small>{memoryExcerpt(revision.body)}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {memory.is_owner && editing && activeTab === "CONTENT" ? (
        <div className="detail-tools">
          <form className="ai-edit-bar" onSubmit={submitAi}>
            <SparkleIcon />
            <input
              aria-label="让 AI 修改这条记忆"
              placeholder="让 AI 修改，例如：补一个更清楚的标题"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={refining}
            />
            <button type="submit" disabled={!instruction.trim() || refining}>
              {refining ? "修改中…" : "修改草稿"}
            </button>
          </form>
          {aiStatus ? (
            <p className="tool-status" role="status">
              {aiStatus}
            </p>
          ) : null}

          <div className={dirty ? "revision-actions is-dirty" : "revision-actions"}>
            <div>
              <strong>{dirty ? "有尚未保存的修改" : "内容已保存"}</strong>
              <small>
                {dirty
                  ? "更新会保留内部历史；新版本会增加一个时间线条目。"
                  : "修改正文后，可以选择怎样保存。"}
              </small>
            </div>
            <div>
              <button
                className="secondary-action"
                type="button"
                disabled={!dirty || savingMode !== null}
                onClick={() => void onSaveRevision("UPDATE_CURRENT")}
              >
                {savingMode === "UPDATE_CURRENT" ? "更新中…" : "更新当前记忆"}
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!dirty || savingMode !== null}
                onClick={() => void onSaveRevision("NEW_VERSION")}
              >
                {savingMode === "NEW_VERSION" ? "保存中…" : "保存为新版本"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!memory.is_owner ? (
        <div className="shared-memory-readonly">
          <Users aria-hidden="true" size={18} strokeWidth={1.7} />
          <div>
            <strong>
              由 {memory.author.display_name} 分享到 {workspace.name}
            </strong>
            <p>你可以阅读和引用这条记忆，修改、撤回与删除仍由作者控制。</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
