"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  GalleryHorizontalEnd,
  GitBranch,
  ImageIcon,
  Languages,
  LoaderCircle,
  LockKeyhole,
  Network,
  PanelTop,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Square,
  Users,
  WandSparkles,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import { DiagramWorkspace } from "@/features/diagrams/diagram-workspace";
import type {
  DraftModel,
  GenerateVisualRequest,
  ImageModel,
  Memory,
  Subscription,
  VisualProject,
  VisualTemplate,
  Workspace,
  WorkspaceMember,
} from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { planAllows, RichModelPicker } from "@/features/shared/model-picker";
import { api } from "@/lib/api";

type VisualKind = VisualTemplate["kind"];
type VisualMode = VisualTemplate["mode"];
type Ratio = GenerateVisualRequest["aspect_ratio"];

const JOB_FINISHED = new Set(["WAITING_CONFIRMATION", "COMPLETED", "FAILED", "CANCELLED"]);

const TEMPLATE_ICONS: Record<VisualKind, typeof ImageIcon> = {
  SCIENTIFIC: ImageIcon,
  MIND_MAP: Network,
  FLOWCHART: GitBranch,
  TIMELINE: Clock3,
};

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "已进入生成队列",
  AUTHORIZING_SOURCES: "正在核验记忆访问权限",
  PREPARING_PROMPT: "正在整理来源和绘图要求",
  CALLING_MODEL: "绘图模型正在生成",
  VALIDATING_OUTPUT: "正在检查输出结构",
  SAVING_RESULT: "正在安全保存结果",
  WAITING_CONFIRMATION: "结构草案等待你的确认",
  COMPLETED: "生成完成",
  FAILED: "生成未完成",
  CANCELLED: "已取消生成",
};

function visualError(result: { error?: unknown; response: Response }, fallback: string) {
  if (result.response.status === 402) return "Credits 余额不足，请升级套餐后继续。";
  if (result.response.status === 403) return "当前套餐或空间权限不允许这次生成。";
  if (result.response.status === 422) return "当前绘图模型尚未配置，请换一个模型。";
  if (typeof result.error === "object" && result.error && "detail" in result.error) {
    const detail = (result.error as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function graphElements(graph: Record<string, unknown> | null): {
  nodes: Node[];
  edges: Edge[];
} {
  if (!graph) return { nodes: [], edges: [] };
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];
  const nodes: Node[] = rawNodes.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id : `node-${index}`;
    const position =
      value.position && typeof value.position === "object"
        ? (value.position as Record<string, unknown>)
        : {};
    return [
      {
        id,
        position: {
          x: typeof position.x === "number" ? position.x : 80 + (index % 3) * 260,
          y: typeof position.y === "number" ? position.y : 70 + Math.floor(index / 3) * 150,
        },
        data: { label: typeof value.label === "string" ? value.label : "未命名节点" },
        className: `visual-preview-node is-${String(value.kind ?? "note").toLowerCase()}`,
      },
    ];
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: Edge[] = rawEdges.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const source = typeof value.source === "string" ? value.source : "";
    const target = typeof value.target === "string" ? value.target : "";
    if (!nodeIds.has(source) || !nodeIds.has(target)) return [];
    return [
      {
        id: typeof value.id === "string" ? value.id : `edge-${index}`,
        source,
        target,
        label: typeof value.label === "string" ? value.label : undefined,
        type: "smoothstep",
      },
    ];
  });
  return { nodes, edges };
}

function TemplatePreview({ template }: { template: VisualTemplate }) {
  const Icon = TEMPLATE_ICONS[template.kind];
  return (
    <span className={`visual-template-preview is-${template.kind.toLowerCase()}`}>
      <Icon aria-hidden="true" size={30} strokeWidth={1.35} />
      <span />
      <span />
      <span />
    </span>
  );
}

function PublicProgress({ project }: { project: VisualProject }) {
  const job = project.latest_job;
  if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return null;
  return (
    <section className="visual-progress" aria-live="polite">
      <span className="visual-progress-icon">
        <LoaderCircle aria-hidden="true" size={16} />
      </span>
      <div>
        <strong>{STAGE_LABELS[job.stage] ?? "正在生成"}</strong>
        <small>这里只展示可验证的工作阶段，不展示模型的隐藏推理。</small>
      </div>
      <span>{job.progress}%</span>
      <div className="visual-progress-track" aria-hidden="true">
        <span style={{ width: `${Math.max(4, job.progress)}%` }} />
      </div>
    </section>
  );
}

function VisualOutput({
  project,
  confirming,
  onConfirm,
}: {
  project: VisualProject;
  confirming: boolean;
  onConfirm: (versionId: string) => void;
}) {
  const versions = project.versions.filter((version) => version.sources_available);
  const latest = versions[0];
  const graph = graphElements(latest?.graph ?? null);

  if (project.status === "FAILED") {
    return (
      <div className="visual-empty-output is-error">
        <RotateCcw aria-hidden="true" size={24} />
        <strong>这次没有生成成功</strong>
        <span>已保留你的提示词和来源，额度不会因失败被消耗。</span>
      </div>
    );
  }
  if (!versions.length) {
    return (
      <div className="visual-empty-output">
        <WandSparkles aria-hidden="true" size={26} />
        <strong>从记忆开始一张新图</strong>
        <span>选择模板、来源与模型，生成结果会出现在这里。</span>
      </div>
    );
  }

  if (project.mode === "IMAGE") {
    return (
      <div className="visual-image-grid" data-count={versions.length}>
        {versions.map((version) =>
          version.asset_url ? (
            <figure key={version.id}>
              <Image
                src={version.asset_url}
                alt={`${project.title} 第 ${version.version_number} 版`}
                width={1200}
                height={900}
                sizes="(max-width: 720px) 100vw, 60vw"
                unoptimized
              />
              <figcaption>版本 {version.version_number}</figcaption>
            </figure>
          ) : null,
        )}
      </div>
    );
  }

  return (
    <div className="visual-structure-candidate">
      <div className="visual-structure-canvas">
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          colorMode="dark"
          minZoom={0.25}
          maxZoom={1.6}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={24}
            size={1}
            color="rgba(148, 180, 220, .15)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {latest.status === "CANDIDATE" ? (
        <footer>
          <span>
            <Check aria-hidden="true" size={15} />
            结构草案已通过格式检查，确认后才会写入框图库。
          </span>
          <button type="button" disabled={confirming} onClick={() => onConfirm(latest.id)}>
            {confirming ? "正在确认" : "确认并进入编辑"}
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </footer>
      ) : null}
    </div>
  );
}

function MemorySourcePicker({
  memories,
  selected,
  sharedOnly,
  onChange,
}: {
  memories: Memory[];
  selected: string[];
  sharedOnly: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = sharedOnly
    ? memories.filter((memory) => memory.visibility === "WORKSPACE")
    : memories;

  return (
    <div className="visual-source-picker">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Plus aria-hidden="true" size={17} />
        <span>{selected.length ? `已选 ${selected.length} 条记忆` : "选择记忆来源"}</span>
      </button>
      {open ? (
        <div className="visual-source-menu">
          <header>
            <strong>记忆来源</strong>
            <small>
              {sharedOnly ? "团队作品只能引用已公开给团队的记忆" : "只会读取你有权访问的内容"}
            </small>
          </header>
          <div>
            {available.map((memory) => {
              const checked = selected.includes(memory.id);
              return (
                <label key={memory.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      onChange(
                        checked
                          ? selected.filter((id) => id !== memory.id)
                          : [...selected, memory.id],
                      )
                    }
                  />
                  <FileText aria-hidden="true" size={15} />
                  <span>
                    <strong>{memory.title || memory.body.slice(0, 42)}</strong>
                    <small>{memory.author.display_name}</small>
                  </span>
                </label>
              );
            })}
            {!available.length ? <p>当前空间还没有可选择的记忆。</p> : null}
          </div>
          <button type="button" onClick={() => setOpen(false)}>
            完成
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function VisualWorkspace({
  workspace,
  memories,
  members,
  chatModels,
  subscription,
  initialSeed,
  onSubscriptionChange,
  onUpgrade,
  onNotify,
}: {
  workspace: Workspace;
  memories: Memory[];
  members: WorkspaceMember[];
  chatModels: DraftModel[];
  subscription: Subscription | null;
  initialSeed?: { projectId: string; memoryIds: string[] } | null;
  onSubscriptionChange: (subscription: Subscription) => void;
  onUpgrade: () => void;
  onNotify: (message: string) => void;
}) {
  const [projects, setProjects] = useState<VisualProject[]>([]);
  const [templates, setTemplates] = useState<VisualTemplate[]>([]);
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [memoryIds, setMemoryIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">("PRIVATE");
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [chatModelId, setChatModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<Ratio>("1:1");
  const [count, setCount] = useState(1);
  const [scientificStyle, setScientificStyle] = useState(true);
  const [cleanOutput, setCleanOutput] = useState(true);
  const [outputLanguage, setOutputLanguage] = useState("auto");
  const [highQuality, setHighQuality] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [editorDiagramId, setEditorDiagramId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null;
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const mode: VisualMode = selectedTemplate?.mode ?? "STRUCTURED";
  const kind: VisualKind = selectedTemplate?.kind ?? "MIND_MAP";
  const selectedImageModel = imageModels.find((model) => model.id === imageModelId) ?? null;
  const currentModelId = mode === "IMAGE" ? imageModelId : chatModelId;
  const estimatedCost =
    mode === "IMAGE"
      ? (currentModelId ? (costs[currentModelId] ?? 0) : 0) * count
      : (costs.structured_visual ?? 0);
  const canGenerate = Boolean(
    prompt.trim() &&
    currentModelId &&
    !submitting &&
    (mode === "STRUCTURED" ||
      (selectedImageModel && !selectedImageModel.locked && selectedImageModel.configured)),
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.GET("/visuals"),
      api.GET("/visuals/templates"),
      api.GET("/visuals/models"),
      api.GET("/visuals/costs"),
    ])
      .then(([projectResult, templateResult, modelResult, costResult]) => {
        if (!active) return;
        if (!projectResult.data || !projectResult.response.ok) throw new Error("projects");
        if (!templateResult.data || !templateResult.response.ok) throw new Error("templates");
        setProjects(projectResult.data);
        setTemplates(templateResult.data);
        setImageModels(modelResult.data && modelResult.response.ok ? modelResult.data : []);
        setCosts(costResult.data && costResult.response.ok ? costResult.data : {});
        const seededProject = projectResult.data.find(
          (project) => project.id === initialSeed?.projectId,
        );
        setSelectedProjectId(seededProject?.id ?? projectResult.data[0]?.id ?? null);
        setSelectedTemplateId(
          templateResult.data.find(
            (template) =>
              template.kind === seededProject?.kind && template.mode === seededProject.mode,
          )?.id ??
            templateResult.data[0]?.id ??
            null,
        );
        setMemoryIds(initialSeed?.memoryIds ?? []);
        if (seededProject) setPrompt(seededProject.title);
        const defaultImage =
          modelResult.data?.find((model) => model.is_default) ?? modelResult.data?.[0];
        setImageModelId(defaultImage?.id ?? null);
        const defaultChat = chatModels.find((model) => model.is_default) ?? chatModels[0];
        setChatModelId(defaultChat?.id ?? null);
      })
      .catch(() => {
        if (active) setError("科研绘图工作区暂时无法载入，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id, chatModels, initialSeed]);

  useEffect(() => {
    const job = selectedProject?.latest_job;
    if (!job || JOB_FINISHED.has(job.status)) return;
    const timer = window.setTimeout(async () => {
      const jobResult = await api.GET("/visual-jobs/{job_id}", {
        params: { path: { job_id: job.id } },
      });
      if (!jobResult.data || !jobResult.response.ok) return;
      if (JOB_FINISHED.has(jobResult.data.status)) {
        const projectResult = await api.GET("/visuals/{project_id}", {
          params: { path: { project_id: selectedProject.id } },
        });
        if (projectResult.data && projectResult.response.ok) {
          setProjects((current) => [
            projectResult.data,
            ...current.filter((project) => project.id !== projectResult.data.id),
          ]);
          if (jobResult.data.status === "FAILED") setError("生成任务未成功，额度已自动释放。");
        }
        const subscriptionResult = await api.GET("/billing/subscription");
        if (subscriptionResult.data && subscriptionResult.response.ok) {
          onSubscriptionChange(subscriptionResult.data);
        }
      } else {
        setProjects((current) =>
          current.map((project) =>
            project.id === selectedProject.id
              ? { ...project, latest_job: jobResult.data, status: "GENERATING" }
              : project,
          ),
        );
      }
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [selectedProject, onSubscriptionChange]);

  function startNew(template = selectedTemplate) {
    setSelectedProjectId(null);
    setPrompt("");
    setMemoryIds([]);
    setError("");
    if (template) setSelectedTemplateId(template.id);
  }

  async function generate() {
    if (!selectedTemplate || !currentModelId || !canGenerate) return;
    setSubmitting(true);
    setError("");
    try {
      let project = selectedProjectId ? selectedProject : null;
      if (!project || project.kind !== kind || project.mode !== mode || !project.is_owner) {
        const createResult = await api.POST("/visuals", {
          body: {
            title: prompt.trim().slice(0, 60) || selectedTemplate.label,
            kind,
            mode,
            visibility,
          },
        });
        if (!createResult.data || !createResult.response.ok) {
          setError(visualError(createResult, "无法创建绘图项目。"));
          return;
        }
        project = createResult.data;
      }
      const result = await api.POST("/visuals/{project_id}/generate", {
        params: { path: { project_id: project.id } },
        body: {
          prompt: prompt.trim(),
          memory_ids: memoryIds,
          model_id: currentModelId,
          aspect_ratio: aspectRatio,
          count: mode === "IMAGE" ? count : 1,
          scientific_style: scientificStyle,
          watermark_mode: cleanOutput ? "CLEAN_OUTPUT" : "ALLOW",
          output_language: outputLanguage,
          quality: highQuality ? "high" : "standard",
        },
      });
      if (!result.data || !result.response.ok) {
        setError(visualError(result, "生成任务没有成功提交。"));
        return;
      }
      setProjects((current) => [
        result.data.project,
        ...current.filter((item) => item.id !== result.data.project.id),
      ]);
      setSelectedProjectId(result.data.project.id);
      onNotify(`已预留 ${result.data.credits_reserved} Credits，任务失败会自动退回`);
      const subscriptionResult = await api.GET("/billing/subscription");
      if (subscriptionResult.data && subscriptionResult.response.ok) {
        onSubscriptionChange(subscriptionResult.data);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelJob() {
    const job = selectedProject?.latest_job;
    if (!job) return;
    const result = await api.POST("/visual-jobs/{job_id}/cancel", {
      params: { path: { job_id: job.id } },
    });
    if (!result.data || !result.response.ok) {
      setError("当前任务无法取消，请刷新后查看状态。");
      return;
    }
    setProjects((current) =>
      current.map((project) =>
        project.id === selectedProject.id
          ? { ...project, status: "CANCELLED", latest_job: result.data }
          : project,
      ),
    );
    const subscriptionResult = await api.GET("/billing/subscription");
    if (subscriptionResult.data && subscriptionResult.response.ok) {
      onSubscriptionChange(subscriptionResult.data);
    }
    onNotify("任务已取消，预留 Credits 已退回");
  }

  async function confirmStructure(versionId: string) {
    if (!selectedProject) return;
    setConfirming(true);
    setError("");
    try {
      const result = await api.POST("/visuals/{project_id}/confirm-structure", {
        params: { path: { project_id: selectedProject.id } },
        body: { version_id: versionId },
      });
      if (!result.data || !result.response.ok) {
        setError(visualError(result, "结构草案暂时无法确认。"));
        return;
      }
      setProjects((current) =>
        current.map((project) => (project.id === result.data.id ? result.data : project)),
      );
      const diagramId = result.data.versions.find(
        (version) => version.id === versionId,
      )?.diagram_id;
      setEditorDiagramId(diagramId ?? null);
      setEditorOpen(true);
      onNotify("结构已确认并写入框图库");
    } finally {
      setConfirming(false);
    }
  }

  const chatModelOptions = useMemo(
    () =>
      chatModels.map((model) => ({
        id: model.id,
        label: model.label,
        description: model.description,
        minPlan: model.min_plan,
        badges: model.badges,
        locked: !planAllows(subscription?.plan_code, model.min_plan),
      })),
    [chatModels, subscription?.plan_code],
  );
  const imageModelOptions = useMemo(
    () =>
      imageModels.map((model) => ({
        id: model.id,
        label: model.label,
        description: model.configured ? model.description : `${model.description} · 未配置`,
        minPlan: model.min_plan,
        badges: model.badge ? [model.badge] : [],
        locked: model.locked || !model.configured,
      })),
    [imageModels],
  );

  if (editorOpen) {
    return (
      <section className="visual-editor-shell">
        <header>
          <button type="button" onClick={() => setEditorOpen(false)}>
            <ArrowLeft aria-hidden="true" size={16} />
            返回生成图库
          </button>
          <span>已确认的结构可继续拖动、连接和补充节点</span>
        </header>
        <DiagramWorkspace
          workspace={workspace}
          memories={memories}
          members={members}
          initialDiagramId={editorDiagramId}
          onNotify={onNotify}
        />
      </section>
    );
  }

  return (
    <ReactFlowProvider>
      <section className="visual-workspace">
        <header className="visual-workspace-header">
          <div>
            <span>AI VISUAL STUDIO</span>
            <h1>科研绘图</h1>
          </div>
          <div>
            <span className="visual-credit-balance">
              <Sparkles aria-hidden="true" size={14} />
              {subscription?.credits_remaining ?? 0} Credits
            </span>
            <button type="button" onClick={() => setEditorOpen(true)}>
              <PanelTop aria-hidden="true" size={16} />
              框图编辑器
            </button>
            <button className="primary-action" type="button" onClick={() => startNew()}>
              <Plus aria-hidden="true" size={16} />
              新作品
            </button>
          </div>
        </header>

        {loading ? (
          <div className="visual-loading" role="status">
            <LoaderCircle aria-hidden="true" size={20} />
            正在读取绘图工作区
          </div>
        ) : (
          <div className="visual-scroll-area">
            <section className="visual-template-strip" aria-label="科研绘图模板">
              {templates.map((template) => {
                const active = template.id === selectedTemplate?.id;
                return (
                  <button
                    className={active ? "is-active" : ""}
                    type="button"
                    key={template.id}
                    onClick={() => {
                      setSelectedTemplateId(template.id);
                      setSelectedProjectId(null);
                      setError("");
                    }}
                  >
                    <TemplatePreview template={template} />
                    <span>
                      <strong>{template.label}</strong>
                      <small>{template.description}</small>
                    </span>
                    {active ? <Check aria-hidden="true" size={15} /> : null}
                  </button>
                );
              })}
            </section>

            <div className="visual-stage-layout">
              <aside className="visual-history">
                <header>
                  <span>
                    <GalleryHorizontalEnd aria-hidden="true" size={15} />
                    最近作品
                  </span>
                  <small>{projects.length}</small>
                </header>
                <div>
                  {projects.map((project) => (
                    <button
                      className={project.id === selectedProject?.id ? "is-active" : ""}
                      type="button"
                      key={project.id}
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setPrompt(project.title);
                        setError("");
                      }}
                    >
                      {project.mode === "IMAGE" ? (
                        <ImageIcon aria-hidden="true" size={15} />
                      ) : (
                        <Network aria-hidden="true" size={15} />
                      )}
                      <span>
                        <strong>{project.title}</strong>
                        <small>
                          {STAGE_LABELS[project.latest_job?.stage ?? project.status] ??
                            project.status}
                        </small>
                      </span>
                    </button>
                  ))}
                  {!projects.length ? <p>生成后的作品会保存在这里。</p> : null}
                </div>
              </aside>

              <main className="visual-output-stage">
                {selectedProject ? (
                  <>
                    <header>
                      <span>{selectedProject.mode === "IMAGE" ? "生成图像" : "可编辑结构"}</span>
                      <h2>{selectedProject.title}</h2>
                      <small>
                        {selectedProject.visibility === "WORKSPACE" ? "团队可见" : "仅自己可见"}
                      </small>
                    </header>
                    <PublicProgress project={selectedProject} />
                    <VisualOutput
                      project={selectedProject}
                      confirming={confirming}
                      onConfirm={(versionId) => void confirmStructure(versionId)}
                    />
                  </>
                ) : (
                  <div className="visual-stage-intro">
                    <TemplatePreview
                      template={
                        selectedTemplate ?? {
                          id: "empty",
                          label: "思维导图",
                          description: "",
                          mode: "STRUCTURED",
                          kind: "MIND_MAP",
                          preview_tone: "blue",
                        }
                      }
                    />
                    <h2>开始你的第一张科研绘图</h2>
                    <p>描述你要表达的关系，或从记忆库中选择材料作为依据。</p>
                  </div>
                )}
              </main>
            </div>
          </div>
        )}

        <section className="visual-composer" aria-label="科研绘图生成器">
          {error ? <p role="alert">{error}</p> : null}
          <textarea
            value={prompt}
            aria-label="绘图描述"
            placeholder="描述你想生成的科研绘图、思维导图或框图"
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className="visual-composer-toolbar">
            <MemorySourcePicker
              memories={memories}
              selected={memoryIds}
              sharedOnly={visibility === "WORKSPACE"}
              onChange={setMemoryIds}
            />
            <RichModelPicker
              compact
              label={mode === "IMAGE" ? "选择绘图引擎" : "选择结构生成模型"}
              options={mode === "IMAGE" ? imageModelOptions : chatModelOptions}
              selectedId={currentModelId}
              onChange={(id) => (mode === "IMAGE" ? setImageModelId(id) : setChatModelId(id))}
              onUpgrade={onUpgrade}
            />
            <button
              className={`visual-settings-trigger ${settingsOpen ? "is-active" : ""}`}
              type="button"
              aria-label="生成偏好"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((value) => !value)}
            >
              <Settings2 aria-hidden="true" size={16} />
              <span>
                {aspectRatio} · {mode === "IMAGE" ? `${count} 张` : "可编辑"}
              </span>
            </button>
            <span className="visual-cost">预计 {estimatedCost} Credits</span>
            {selectedProject?.latest_job &&
            ["QUEUED", "RUNNING"].includes(selectedProject.latest_job.status) ? (
              <button className="visual-cancel" type="button" onClick={() => void cancelJob()}>
                <Square aria-hidden="true" size={14} />
                取消
              </button>
            ) : null}
            <button
              className="visual-generate-button"
              type="button"
              aria-label="开始生成"
              disabled={!canGenerate}
              onClick={() => void generate()}
            >
              {submitting ? (
                <LoaderCircle aria-hidden="true" size={18} />
              ) : (
                <WandSparkles aria-hidden="true" size={18} />
              )}
            </button>
          </div>

          {settingsOpen ? (
            <div className="visual-settings-panel">
              <header>生成偏好</header>
              <label>
                <span>图片比例</span>
                <select
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value as Ratio)}
                >
                  <option value="1:1">1:1 正方形</option>
                  <option value="4:3">4:3 横向</option>
                  <option value="3:4">3:4 竖向</option>
                  <option value="16:9">16:9 宽屏</option>
                  <option value="9:16">9:16 竖屏</option>
                </select>
              </label>
              {mode === "IMAGE" ? (
                <>
                  <div className="visual-setting-row">
                    <span>生成数量</span>
                    <div className="visual-count-control" role="group" aria-label="生成数量">
                      {[1, 2, 3, 4].map((value) => (
                        <button
                          type="button"
                          className={count === value ? "is-active" : ""}
                          key={value}
                          onClick={() => setCount(value)}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="visual-toggle-row">
                    <span>科研风格增强</span>
                    <input
                      type="checkbox"
                      checked={scientificStyle}
                      onChange={(event) => setScientificStyle(event.target.checked)}
                    />
                  </label>
                  <label className="visual-toggle-row">
                    <span>请求无水印输出</span>
                    <input
                      type="checkbox"
                      checked={cleanOutput}
                      onChange={(event) => setCleanOutput(event.target.checked)}
                    />
                  </label>
                  <label className="visual-toggle-row">
                    <span>高质量</span>
                    <input
                      type="checkbox"
                      checked={highQuality}
                      onChange={(event) => setHighQuality(event.target.checked)}
                    />
                  </label>
                </>
              ) : null}
              <label>
                <span>
                  <Languages aria-hidden="true" size={14} />
                  输出语言
                </span>
                <select
                  value={outputLanguage}
                  onChange={(event) => setOutputLanguage(event.target.value)}
                >
                  <option value="auto">Auto</option>
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              {isCollaborativeWorkspace(workspace) ? (
                <div className="visual-setting-row">
                  <span>作品范围</span>
                  <div className="visual-visibility-control">
                    <button
                      type="button"
                      className={visibility === "PRIVATE" ? "is-active" : ""}
                      onClick={() => setVisibility("PRIVATE")}
                    >
                      <LockKeyhole aria-hidden="true" size={13} />
                      仅自己
                    </button>
                    <button
                      type="button"
                      className={visibility === "WORKSPACE" ? "is-active" : ""}
                      onClick={() => {
                        setVisibility("WORKSPACE");
                        setMemoryIds((current) =>
                          current.filter(
                            (id) =>
                              memories.find((memory) => memory.id === id)?.visibility ===
                              "WORKSPACE",
                          ),
                        );
                      }}
                    >
                      <Users aria-hidden="true" size={13} />
                      团队
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </section>
    </ReactFlowProvider>
  );
}
