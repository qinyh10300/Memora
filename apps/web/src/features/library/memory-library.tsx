"use client";

import { LockKeyhole, Search, Users, X } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MarkdownWorkspace, PreviewToggle } from "@/features/capture/markdown-workspace";
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
  filters,
  active,
  searching,
  onChange,
  onSubmit,
  onReset,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  filters: MemorySearchFilters;
  active: boolean;
  searching: boolean;
  onChange: (filters: MemorySearchFilters) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasCriteria = Boolean(
    filters.query.trim() || filters.from || filters.to || filters.authorId,
  );

  useEffect(() => {
    if (!open) return;
    function closePopover(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeWithEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", closePopover);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("mousedown", closePopover);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasCriteria || searching) return;
    onSubmit();
    setOpen(false);
  }

  return (
    <div className="library-search" ref={rootRef}>
      <button
        className={active ? "library-search-trigger is-active" : "library-search-trigger"}
        type="button"
        aria-label="检索记忆库"
        title="检索记忆库"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
      </button>
      {open ? (
        <form className="library-search-popover" onSubmit={submit}>
          <header>
            <strong>检索记忆</strong>
            <button type="button" aria-label="关闭检索" onClick={() => setOpen(false)}>
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
          {isCollaborativeWorkspace(workspace) ? (
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
                setOpen(false);
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
  onSelect,
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
  onSelect: (memory: Memory) => void;
}) {
  const groups = useMemo(() => {
    const result: { key: string; label: string; memories: Memory[] }[] = [];
    for (const memory of memories) {
      const key = dayKey(memory.created_at);
      const current = result[result.length - 1];
      if (!current || current.key !== key) {
        result.push({ key, label: dayLabel(memory.created_at), memories: [memory] });
      } else {
        current.memories.push(memory);
      }
    }
    return result;
  }, [memories]);

  return (
    <section
      className="timeline-panel"
      aria-label={isCollaborativeWorkspace(workspace) ? "共享记忆时间线" : "个人记忆时间线"}
    >
      <header className="library-list-header">
        <div>
          <p className="eyebrow">
            {isCollaborativeWorkspace(workspace) ? workspace.name : "个人记忆"}
          </p>
          <h1>记忆库</h1>
        </div>
        <div className="library-list-actions">
          <span>{memories.length}</span>
          <MemorySearchPopover
            workspace={workspace}
            members={members}
            filters={searchFilters}
            active={searchActive}
            searching={loading}
            onChange={onSearchFiltersChange}
            onSubmit={onSearch}
            onReset={onResetSearch}
          />
        </div>
      </header>
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
                    className={selectedId === memory.id ? "memory-card is-selected" : "memory-card"}
                    type="button"
                    key={memory.id}
                    onClick={() => onSelect(memory)}
                    aria-label={`查看记忆：${memory.title ?? memoryTitle(memory.body)}，作者 ${memory.author.display_name}`}
                  >
                    <time dateTime={memory.created_at}>{formatTime(memory.created_at)}</time>
                    <span className="timeline-node" />
                    <span className="memory-card-copy">
                      <strong>{memory.title ?? memoryTitle(memory.body)}</strong>
                      <small>{memoryExcerpt(memory.body)}</small>
                      <span className="memory-card-meta">
                        <span>{memory.author.display_name}</span>
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
  const [previewVisible, setPreviewVisible] = useState(true);
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
          <PreviewToggle
            visible={previewVisible}
            onToggle={() => setPreviewVisible((visible) => !visible)}
          />
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

      <MarkdownWorkspace
        className="detail-editor-wrap"
        editorClassName="detail-editor"
        value={markdown}
        onChange={onMarkdownChange}
        ariaLabel="记忆 Markdown"
        previewVisible={previewVisible}
        readOnly={!memory.is_owner}
      />

      {memory.is_owner ? (
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

          {revisions.length > 1 ? (
            <details className="revision-history">
              <summary>查看修订历史 · {revisions.length} 个版本</summary>
              <ol>
                {revisions.map((revision, index) => (
                  <li key={revision.id}>
                    <span>{index === 0 ? "当前" : `历史 ${index}`}</span>
                    <time dateTime={revision.created_at}>
                      {formatDateTime(revision.created_at)}
                    </time>
                    <p>{memoryExcerpt(revision.body)}</p>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="shared-memory-readonly">
          <Users aria-hidden="true" size={18} strokeWidth={1.7} />
          <div>
            <strong>
              由 {memory.author.display_name} 分享到 {workspace.name}
            </strong>
            <p>你可以阅读和引用这条记忆，修改、撤回与删除仍由作者控制。</p>
          </div>
        </div>
      )}
    </section>
  );
}
