"use client";

import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import {
  Download,
  FileText,
  GitBranch,
  LockKeyhole,
  Plus,
  Save,
  StickyNote,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Diagram, Memory, Workspace, WorkspaceMember } from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { api } from "@/lib/api";

type DiagramNodeData = {
  label: string;
  kind: "MEMORY" | "PERSON" | "NOTE";
  memoryId?: string;
  userId?: string;
  text?: string;
  authorName?: string;
  available: boolean;
};

function flowNodeFor(node: Diagram["nodes"][number]): Node<DiagramNodeData> {
  return {
    id: node.id,
    position: node.position,
    data: {
      label: node.label,
      kind: node.kind,
      memoryId: node.memory_id ?? undefined,
      userId: node.user_id ?? undefined,
      text: node.kind === "NOTE" ? node.label : undefined,
      authorName: node.author_name ?? undefined,
      available: node.available,
    },
    className: `diagram-node is-${node.kind.toLowerCase()} ${node.available ? "" : "is-unavailable"}`,
  };
}

function edgeFor(edge: Diagram["edges"][number]): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label ?? undefined,
  };
}

function DiagramCanvas({
  workspace,
  memories,
  members,
  initialDiagramId,
  onNotify,
}: {
  workspace: Workspace;
  memories: Memory[];
  members: WorkspaceMember[];
  initialDiagramId?: string | null;
  onNotify: (message: string) => void;
}) {
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("未命名框图");
  const [kind, setKind] = useState<"MIND_MAP" | "FLOWCHART" | "TIMELINE">("MIND_MAP");
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">("PRIVATE");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<DiagramNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<"PNG" | "SVG" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const selected = diagrams.find((diagram) => diagram.id === selectedId) ?? null;
  const canEdit = selected ? selected.is_owner : true;

  const applyDiagram = useCallback(
    (diagram: Diagram) => {
      setSelectedId(diagram.id);
      setTitle(diagram.title);
      setKind(diagram.kind);
      setVisibility(diagram.visibility);
      setNodes(diagram.nodes.map(flowNodeFor));
      setEdges(diagram.edges.map(edgeFor));
      setError("");
    },
    [setEdges, setNodes],
  );

  useEffect(() => {
    let active = true;
    void api.GET("/diagrams").then((result) => {
      if (!active) return;
      const next = result.data && result.response.ok ? result.data : [];
      setDiagrams(next);
      const preferred = next.find((diagram) => diagram.id === initialDiagramId) ?? next[0];
      if (preferred) applyDiagram(preferred);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [workspace.id, initialDiagramId, applyDiagram]);

  const addNode = useCallback(
    (data: DiagramNodeData) => {
      const index = nodes.length;
      setNodes((current) => [
        ...current,
        {
          id: `${data.kind.toLowerCase()}-${Date.now()}-${index}`,
          position: { x: 80 + (index % 3) * 250, y: 90 + Math.floor(index / 3) * 150 },
          data,
          className: `diagram-node is-${data.kind.toLowerCase()}`,
        },
      ]);
    },
    [nodes.length, setNodes],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canEdit) return;
      setEdges((current) =>
        addEdge({ ...connection, id: `edge-${Date.now()}`, type: "smoothstep" }, current),
      );
    },
    [canEdit, setEdges],
  );

  function startNew() {
    setSelectedId(null);
    setTitle("未命名框图");
    setKind("MIND_MAP");
    setVisibility("PRIVATE");
    setNodes([]);
    setEdges([]);
    setError("");
  }

  function addMemory() {
    const memory = memories.find((item) => item.id === selectedMemoryId);
    if (!memory) return;
    addNode({
      label: memory.title || memory.body.slice(0, 80),
      kind: "MEMORY",
      memoryId: memory.id,
      authorName: memory.author.display_name,
      available: true,
    });
    setSelectedMemoryId("");
  }

  function addMember() {
    const member = members.find((item) => item.id === selectedMemberId);
    if (!member) return;
    addNode({
      label: member.display_name,
      kind: "PERSON",
      userId: member.id,
      available: true,
    });
    setSelectedMemberId("");
  }

  function addNote() {
    const text = note.trim();
    if (!text) return;
    addNode({ label: text, kind: "NOTE", text, available: true });
    setNote("");
  }

  async function save() {
    if (!canEdit || saving) return;
    const unavailable = nodes.some((node) => !node.data.available);
    if (unavailable) {
      setError("请先删除不可用的来源节点，再保存框图。");
      return;
    }
    setSaving(true);
    setError("");
    const body = {
      title: title.trim() || "未命名框图",
      kind,
      visibility,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        position: node.position,
        ...(node.data.memoryId ? { memory_id: node.data.memoryId } : {}),
        ...(node.data.userId ? { user_id: node.data.userId } : {}),
        ...(node.data.kind === "NOTE" ? { text: node.data.text ?? node.data.label } : {}),
      })),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        ...(typeof edge.label === "string" ? { label: edge.label } : {}),
      })),
    };
    try {
      const result = selectedId
        ? await api.PUT("/diagrams/{diagram_id}", {
            params: { path: { diagram_id: selectedId } },
            body,
          })
        : await api.POST("/diagrams", { body });
      if (!result.data || !result.response.ok) {
        const detail = result.error && "detail" in result.error ? result.error.detail : null;
        throw new Error(typeof detail === "string" ? detail : "保存框图失败");
      }
      setDiagrams((current) => [
        result.data,
        ...current.filter((diagram) => diagram.id !== result.data?.id),
      ]);
      applyDiagram(result.data);
      onNotify("框图已保存");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存框图失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected?.is_owner) return;
    const result = await api.DELETE("/diagrams/{diagram_id}", {
      params: { path: { diagram_id: selected.id } },
    });
    if (!result.response.ok) {
      setError("删除框图失败，请稍后重试。");
      return;
    }
    const remaining = diagrams.filter((diagram) => diagram.id !== selected.id);
    setDiagrams(remaining);
    if (remaining[0]) applyDiagram(remaining[0]);
    else startNew();
    onNotify("框图已删除");
  }

  async function exportDiagram(format: "PNG" | "SVG") {
    const canvas = canvasRef.current?.querySelector<HTMLElement>(".react-flow");
    if (!canvas) return;
    setExporting(format);
    setError("");
    try {
      const options = {
        backgroundColor: "#05070b",
        pixelRatio: format === "PNG" ? 2 : 1,
        filter: (node: HTMLElement) =>
          !node.classList?.contains("react-flow__controls") &&
          !node.classList?.contains("react-flow__minimap") &&
          !node.classList?.contains("react-flow__panel"),
      };
      const dataUrl =
        format === "PNG" ? await toPng(canvas, options) : await toSvg(canvas, options);
      const link = document.createElement("a");
      const fileName = title.trim().replaceAll(/[^\p{L}\p{N}._-]+/gu, "-") || "memora-diagram";
      link.download = `${fileName}.${format.toLowerCase()}`;
      link.href = dataUrl;
      link.click();
      setExportOpen(false);
      onNotify(`已导出 ${format} 文件`);
    } catch {
      setError("导出失败，请稍后重试");
    } finally {
      setExporting(null);
    }
  }

  const sharedMemories = useMemo(
    () =>
      memories.filter((memory) => visibility === "PRIVATE" || memory.visibility === "WORKSPACE"),
    [memories, visibility],
  );

  return (
    <section className="diagram-workspace" aria-labelledby="diagram-title">
      <aside className="diagram-library">
        <header>
          <div>
            <p className="eyebrow">MAMARAIL</p>
            <h1 id="diagram-title">框图</h1>
          </div>
          <button type="button" aria-label="新建框图" title="新建框图" onClick={startNew}>
            <Plus aria-hidden="true" size={17} />
          </button>
        </header>
        <div className="diagram-list">
          {loading ? <span>正在读取框图…</span> : null}
          {diagrams.map((diagram) => (
            <button
              type="button"
              className={diagram.id === selectedId ? "is-active" : ""}
              key={diagram.id}
              onClick={() => applyDiagram(diagram)}
            >
              <GitBranch aria-hidden="true" size={15} />
              <span>
                <strong>{diagram.title}</strong>
                <small>{diagram.visibility === "WORKSPACE" ? "空间共享" : "仅自己"}</small>
              </span>
            </button>
          ))}
          {!loading && !diagrams.length ? <small>还没有保存的框图</small> : null}
        </div>
      </aside>

      <section className="diagram-editor">
        <header className="diagram-toolbar">
          <input
            aria-label="框图标题"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canEdit}
          />
          <div className="segmented-control" role="group" aria-label="框图类型">
            <button
              type="button"
              className={kind === "MIND_MAP" ? "is-active" : ""}
              disabled={!canEdit}
              onClick={() => setKind("MIND_MAP")}
            >
              思维导图
            </button>
            <button
              type="button"
              className={kind === "FLOWCHART" ? "is-active" : ""}
              disabled={!canEdit}
              onClick={() => setKind("FLOWCHART")}
            >
              流程图
            </button>
            <button
              type="button"
              className={kind === "TIMELINE" ? "is-active" : ""}
              disabled={!canEdit}
              onClick={() => setKind("TIMELINE")}
            >
              时间线
            </button>
          </div>
          {isCollaborativeWorkspace(workspace) ? (
            <div className="segmented-control" role="group" aria-label="框图可见范围">
              <button
                type="button"
                className={visibility === "PRIVATE" ? "is-active" : ""}
                disabled={!canEdit}
                onClick={() => setVisibility("PRIVATE")}
              >
                <LockKeyhole aria-hidden="true" size={13} />
                仅自己
              </button>
              <button
                type="button"
                className={visibility === "WORKSPACE" ? "is-active" : ""}
                disabled={!canEdit}
                onClick={() => setVisibility("WORKSPACE")}
              >
                <Users aria-hidden="true" size={13} />
                空间共享
              </button>
            </div>
          ) : null}
          <span className="diagram-toolbar-spacer" />
          <div className="diagram-export">
            <button
              type="button"
              aria-label="导出框图"
              title="导出框图"
              disabled={!nodes.length || Boolean(exporting)}
              onClick={() => setExportOpen((current) => !current)}
            >
              <Download aria-hidden="true" size={15} />
            </button>
            {exportOpen ? (
              <div>
                <button type="button" onClick={() => void exportDiagram("PNG")}>
                  {exporting === "PNG" ? "正在导出" : "PNG 图片"}
                </button>
                <button type="button" onClick={() => void exportDiagram("SVG")}>
                  {exporting === "SVG" ? "正在导出" : "SVG 矢量图"}
                </button>
              </div>
            ) : null}
          </div>
          {selected?.is_owner ? (
            <button
              type="button"
              className="icon-action is-danger"
              aria-label="删除框图"
              onClick={() => void remove()}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          ) : null}
          <button
            type="button"
            className="primary-action"
            disabled={!canEdit || saving}
            onClick={() => void save()}
          >
            <Save aria-hidden="true" size={15} />
            {saving ? "保存中…" : "保存"}
          </button>
        </header>

        {canEdit ? (
          <div className="diagram-node-tools">
            <label>
              <FileText aria-hidden="true" size={14} />
              <select
                aria-label="选择记忆节点"
                value={selectedMemoryId}
                onChange={(event) => setSelectedMemoryId(event.target.value)}
              >
                <option value="">选择记忆</option>
                {sharedMemories.map((memory) => (
                  <option value={memory.id} key={memory.id}>
                    {memory.title || memory.body.slice(0, 36)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="添加记忆节点"
                disabled={!selectedMemoryId}
                onClick={addMemory}
              >
                <Plus size={14} />
              </button>
            </label>
            {isCollaborativeWorkspace(workspace) ? (
              <label>
                <UserRound aria-hidden="true" size={14} />
                <select
                  aria-label="选择成员节点"
                  value={selectedMemberId}
                  onChange={(event) => setSelectedMemberId(event.target.value)}
                >
                  <option value="">选择成员</option>
                  {members.map((member) => (
                    <option value={member.id} key={member.id}>
                      {member.display_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="添加成员节点"
                  disabled={!selectedMemberId}
                  onClick={addMember}
                >
                  <Plus size={14} />
                </button>
              </label>
            ) : null}
            <label>
              <StickyNote aria-hidden="true" size={14} />
              <input
                aria-label="注释节点文字"
                value={note}
                maxLength={240}
                onChange={(event) => setNote(event.target.value)}
                placeholder="添加注释"
              />
              <button
                type="button"
                aria-label="添加注释节点"
                disabled={!note.trim()}
                onClick={addNote}
              >
                <Plus size={14} />
              </button>
            </label>
          </div>
        ) : (
          <div className="diagram-readonly">由 {selected?.owner.display_name} 共享 · 只读</div>
        )}
        {error ? (
          <p className="diagram-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="diagram-canvas" ref={canvasRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={canEdit ? onNodesChange : undefined}
            onEdgesChange={canEdit ? onEdgesChange : undefined}
            onConnect={onConnect}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            elementsSelectable
            fitView
            colorMode="dark"
            minZoom={0.25}
            maxZoom={2}
            deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="rgba(148, 180, 220, .16)"
            />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </section>
    </section>
  );
}

export function DiagramWorkspace(props: Parameters<typeof DiagramCanvas>[0]) {
  return (
    <ReactFlowProvider>
      <DiagramCanvas {...props} />
    </ReactFlowProvider>
  );
}
