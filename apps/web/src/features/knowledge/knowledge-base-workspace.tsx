"use client";

import {
  ArrowUpRight,
  BookOpenText,
  FilePenLine,
  FileText,
  PanelRightClose,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Memory, Workspace } from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { formatDateTime } from "@/features/shared/utils";

export function KnowledgeBaseWorkspace({
  workspace,
  memories,
  loading,
  embedded = false,
  onOpenMemory,
  onCapture,
  onClose,
  onOpenDraft,
  onOpenFull,
}: {
  workspace: Workspace;
  memories: Memory[];
  loading: boolean;
  embedded?: boolean;
  onOpenMemory: (memory: Memory) => void;
  onCapture: () => void;
  onClose?: () => void;
  onOpenDraft?: () => void;
  onOpenFull?: () => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleMemories = useMemo(
    () =>
      memories.filter((memory) => {
        if (!normalizedQuery) return true;
        return [memory.title ?? "", memory.body, memory.author.display_name]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    [memories, normalizedQuery],
  );
  const sources = useMemo(() => {
    const unique = new Map<
      string,
      { id: string; name: string; pages: Set<number>; memories: number }
    >();
    memories.forEach((memory) => {
      const seenInMemory = new Set<string>();
      (memory.document_citations ?? []).forEach((citation) => {
        const current = unique.get(citation.asset_id) ?? {
          id: citation.asset_id,
          name: citation.asset_name,
          pages: new Set<number>(),
          memories: 0,
        };
        current.pages.add(citation.page_number);
        if (!seenInMemory.has(citation.asset_id)) current.memories += 1;
        seenInMemory.add(citation.asset_id);
        unique.set(citation.asset_id, current);
      });
    });
    return [...unique.values()];
  }, [memories]);
  const authorCount = new Set(memories.map((memory) => memory.author.id)).size;

  return (
    <section
      className={`knowledge-workspace ${embedded ? "is-docked" : ""}`}
      aria-labelledby={embedded ? "docked-knowledge-title" : "knowledge-title"}
    >
      <header className="feature-workspace-header">
        <div>
          <p className="eyebrow">CLOUD KNOWLEDGE BASE</p>
          <h1 id={embedded ? "docked-knowledge-title" : "knowledge-title"}>云知识库</h1>
          <span>{workspace.name}</span>
        </div>
        {embedded ? (
          <div className="knowledge-dock-actions">
            <button type="button" aria-label="打开右侧草稿" title="打开草稿" onClick={onOpenDraft}>
              <FilePenLine aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              aria-label="前往完整云知识库"
              title="前往完整云知识库"
              onClick={onOpenFull}
            >
              <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
            <button type="button" aria-label="关闭右侧云知识库" title="关闭" onClick={onClose}>
              <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <button type="button" className="primary-action" onClick={onCapture}>
            <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
            导入资料
          </button>
        )}
      </header>

      <div className="knowledge-summary-band">
        <span>
          <BookOpenText aria-hidden="true" size={18} />
          <strong>{memories.length}</strong>
          <small>授权记忆</small>
        </span>
        <span>
          <FileText aria-hidden="true" size={18} />
          <strong>{sources.length}</strong>
          <small>文档来源</small>
        </span>
        <span>
          <Users aria-hidden="true" size={18} />
          <strong>{authorCount}</strong>
          <small>{isCollaborativeWorkspace(workspace) ? "贡献成员" : "内容作者"}</small>
        </span>
      </div>

      <div className="knowledge-search">
        <Search aria-hidden="true" size={16} strokeWidth={1.8} />
        <input
          aria-label="检索云知识库"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="检索标题、正文或作者"
        />
      </div>

      <div className="knowledge-layout">
        <section className="knowledge-source-list" aria-labelledby="source-list-title">
          <header>
            <h2 id="source-list-title">资料来源</h2>
            <small>由记忆中的页码引用自动构建</small>
          </header>
          {sources.length ? (
            sources.map((source) => (
              <article key={source.id}>
                <FileText aria-hidden="true" size={16} />
                <span>
                  <strong>{source.name}</strong>
                  <small>
                    {source.pages.size} 个引用页 · 关联 {source.memories} 条记忆
                  </small>
                </span>
              </article>
            ))
          ) : (
            <div className="feature-empty-state">
              <FileText aria-hidden="true" size={24} strokeWidth={1.5} />
              <strong>还没有文档来源</strong>
              <span>在聊天中上传 PDF 并保存草稿后，来源会出现在这里。</span>
            </div>
          )}
        </section>

        <section className="knowledge-memory-list" aria-labelledby="knowledge-memory-title">
          <header>
            <h2 id="knowledge-memory-title">知识条目</h2>
            <small>{visibleMemories.length} 条结果</small>
          </header>
          {loading ? <div className="feature-loading">正在读取知识库…</div> : null}
          {!loading && visibleMemories.length
            ? visibleMemories.map((memory) => (
                <button type="button" key={memory.id} onClick={() => onOpenMemory(memory)}>
                  <span>
                    <strong>{memory.title || "未命名记忆"}</strong>
                    <small>{memory.body.replaceAll("\n", " ").slice(0, 110)}</small>
                  </span>
                  <span>
                    <small>{memory.author.display_name}</small>
                    <time dateTime={memory.created_at}>{formatDateTime(memory.created_at)}</time>
                  </span>
                </button>
              ))
            : null}
          {!loading && !visibleMemories.length ? (
            <div className="feature-empty-state">
              <BookOpenText aria-hidden="true" size={24} strokeWidth={1.5} />
              <strong>{normalizedQuery ? "没有匹配结果" : "知识库还是空的"}</strong>
              <span>{normalizedQuery ? "试试更短的关键词。" : "先导入资料或保存一条记忆。"}</span>
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
