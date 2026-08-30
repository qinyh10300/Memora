import type {
  DraftChatResponse,
  DraftDocumentAttachment,
  DraftImageAttachment,
  DraftMemoryScope,
  DraftModel,
  DraftTrace,
  DraftTraceStep,
  WebSearchMode,
} from "@/features/shared/contracts";

const EXPLICIT_WEB_SEARCH_MARKERS = [
  "联网",
  "上网",
  "查最新",
  "最新消息",
  "最新进展",
  "官网",
  "新闻",
  "近期动态",
  "最近发布",
  "当前价格",
  "现在的价格",
  "web search",
  "latest news",
];

const MEMORY_SEARCH_TARGET_MARKERS = [
  "我的记忆",
  "个人记忆",
  "团队记忆",
  "共享记忆",
  "记忆库",
  "my memories",
  "personal memories",
  "team memories",
  "memory library",
];

const GENERIC_SEARCH_MARKERS = ["搜索", "搜一下", "查一下", "查查"];

export function willSearchWeb(
  instruction: string,
  mode: WebSearchMode,
  memoryScope: DraftMemoryScope = "NONE",
) {
  if (mode === "DISABLED") return false;
  if (mode === "REQUIRED") return true;
  const normalized = instruction.toLocaleLowerCase();
  if (EXPLICIT_WEB_SEARCH_MARKERS.some((marker) => normalized.includes(marker))) return true;
  if (
    memoryScope !== "NONE" &&
    MEMORY_SEARCH_TARGET_MARKERS.some((marker) => normalized.includes(marker))
  ) {
    return false;
  }
  return GENERIC_SEARCH_MARKERS.some((marker) => normalized.includes(marker));
}

export function modelSupports(
  model: DraftModel | undefined,
  capability: DraftModel["capabilities"][number],
) {
  return !model || model.capabilities.includes(capability);
}

export function selectedDraftModelLabel(models: DraftModel[], modelId: string | null) {
  const selected =
    models.find((model) => model.id === modelId) ??
    models.find((model) => model.is_default) ??
    models[0];
  return selected?.label ?? modelId ?? "默认模型";
}

function summarizeNamedItems(names: string[], unit: string) {
  if (!names.length) return "";
  const visibleNames = names.slice(0, 2).join("、");
  return names.length > 2 ? `${visibleNames} 等 ${names.length} ${unit}` : visibleNames;
}

export function buildLiveTrace({
  modelLabel,
  images,
  documents,
}: {
  modelLabel: string;
  images: DraftImageAttachment[];
  documents: DraftDocumentAttachment[];
}): DraftTrace {
  const attachmentNames = [
    ...images.map((image) => image.name),
    ...documents.map((document) => document.name),
  ];
  return {
    duration_ms: 0,
    model: modelLabel,
    input_tokens: 0,
    output_tokens: 0,
    steps: [
      {
        id: "analysis",
        kind: "ANALYSIS",
        status: "RUNNING",
        title: "理解请求并检查执行边界",
        detail: attachmentNames.length
          ? `准备读取：${summarizeNamedItems(attachmentNames, "个附件")}`
          : `准备调用 ${modelLabel}，并先检查授权记忆和工具范围。`,
        elapsed_ms: 0,
        duration_ms: null,
        item_count: attachmentNames.length || null,
      },
    ],
  };
}

export function upsertTraceStep(steps: DraftTraceStep[], next: DraftTraceStep) {
  const existingIndex = steps.findIndex((step) => step.id === next.id);
  if (existingIndex < 0) return [...steps, next];
  return steps.map((step, index) => (index === existingIndex ? next : step));
}

export function buildCompletedTrace({
  modelLabel,
  images,
  documents,
  requestedWebSearch,
  memoryScope,
  response,
}: {
  modelLabel: string;
  images: DraftImageAttachment[];
  documents: DraftDocumentAttachment[];
  requestedWebSearch: boolean;
  memoryScope: DraftMemoryScope;
  response: DraftChatResponse;
}): DraftTrace {
  if (response.trace) return response.trace;
  const steps: DraftTraceStep[] = [
    {
      id: "analysis",
      kind: "ANALYSIS",
      status: "COMPLETED",
      title: "已理解这轮请求",
      detail: "已检查模型能力、附件、联网模式和保存边界。",
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    },
  ];

  if (images.length || documents.length) {
    steps.push({
      id: "attachments",
      kind: "ATTACHMENT",
      status: "COMPLETED",
      title: "附件已准备",
      detail: [
        images.length
          ? `${images.length} 张图片：${summarizeNamedItems(
              images.map((image) => image.name),
              "张图片",
            )}`
          : "",
        documents.length
          ? `${documents.length} 个 PDF：${summarizeNamedItems(
              documents.map((document) => document.name),
              "个 PDF",
            )}`
          : "",
      ]
        .filter(Boolean)
        .join("；"),
      elapsed_ms: 0,
      duration_ms: null,
      item_count: images.length + documents.length,
    });
  }

  const retrievalLabel = memoryScope === "TEAM" ? "团队共享记忆" : "个人记忆";
  steps.push(
    memoryScope === "NONE"
      ? {
          id: "retrieval",
          kind: "RETRIEVAL",
          status: "SKIPPED",
          title: "本轮不使用记忆",
          detail: "通用聊天只使用当前对话、附件和本轮允许的网页来源。",
          elapsed_ms: 0,
          duration_ms: null,
          item_count: 0,
        }
      : {
          id: "retrieval",
          kind: "RETRIEVAL",
          status: "COMPLETED",
          title: `${retrievalLabel}已检索`,
          detail: response.citations.length
            ? `检索${retrievalLabel}：引用 ${response.citations.length} 条`
            : `检索${retrievalLabel}：未引用已有记录`,
          elapsed_ms: 0,
          duration_ms: null,
          item_count: response.citations.length,
        },
  );

  if (response.web_search_status === "AVAILABLE") {
    steps.push({
      id: "tool-web-search-1",
      kind: "TOOL",
      status: "COMPLETED",
      title: "联网搜索",
      detail: `使用 ${response.web_citations.length} 个来源`,
      elapsed_ms: 0,
      duration_ms: null,
      item_count: response.web_citations.length,
    });
  } else if (response.web_search_status === "DEGRADED") {
    steps.push({
      id: "tool-web-search-1",
      kind: "TOOL",
      status: "DEGRADED",
      title: "联网搜索",
      detail: "搜索失败，草稿已安全保留。",
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    });
  } else if (response.web_search_status === "DISABLED" && requestedWebSearch) {
    steps.push({
      id: "tool-web-search-1",
      kind: "TOOL",
      status: "REJECTED",
      title: "联网搜索",
      detail: "当前模型或配置未启用联网。",
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    });
  } else if (requestedWebSearch) {
    steps.push({
      id: "tool-web-search-1",
      kind: "TOOL",
      status: "SKIPPED",
      title: "联网搜索",
      detail: "本轮没有使用网页来源。",
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    });
  }

  response.tool_events.forEach((event, index) => {
    steps.push({
      id: `tool-${index}-${event.name}`,
      kind: "TOOL",
      status: event.status,
      title: event.name === "save_memory" ? "保存到个人记忆" : "联网搜索",
      detail: event.message,
      elapsed_ms: 0,
      duration_ms: null,
      item_count: null,
    });
  });

  steps.push({
    id: "model",
    kind: "MODEL",
    status:
      response.model_status === "AVAILABLE"
        ? "COMPLETED"
        : response.model_status === "DISABLED"
          ? "SKIPPED"
          : "DEGRADED",
    title: `使用模型：${modelLabel}`,
    detail: "已生成本轮聊天回复。",
    elapsed_ms: 0,
    duration_ms: null,
    item_count: null,
  });
  steps.push({
    id: "output",
    kind: "OUTPUT",
    status: "COMPLETED",
    title: response.saved_memory
      ? "已写入个人记忆库"
      : response.draft_changed
        ? "Markdown 编辑区已同步"
        : "Markdown 编辑区保持不变",
    detail: "回复、引用和 Markdown 已完成校验。",
    elapsed_ms: 0,
    duration_ms: null,
    item_count: response.citations.length + response.web_citations.length,
  });
  return {
    duration_ms: 0,
    model: modelLabel,
    input_tokens: 0,
    output_tokens: 0,
    steps,
  };
}

export function buildFailedTrace({
  modelLabel,
  trace,
}: {
  modelLabel: string;
  trace: DraftTrace;
}): DraftTrace {
  const steps = trace.steps.map((step) =>
    step.status === "RUNNING"
      ? { ...step, status: "FAILED" as const, detail: "请求中断，已停止后续执行。" }
      : step,
  );
  return {
    ...trace,
    model: trace.model ?? modelLabel,
    steps: upsertTraceStep(steps, {
      id: "output",
      kind: "OUTPUT",
      status: "FAILED",
      title: "请求未完成",
      detail: "右侧 Markdown 保持不变，可以稍后重试。",
      elapsed_ms: trace.duration_ms,
      duration_ms: null,
      item_count: null,
    }),
  };
}
