"use client";

import type { components } from "@memora/api-contract";
import {
  ArrowRight,
  BookOpenText,
  BrainCircuit,
  Building2,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileClock,
  Hash,
  LockKeyhole,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api, streamDraftChat } from "@/lib/api";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type Workspace = components["schemas"]["WorkspaceResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type WorkspaceJoinRequest = components["schemas"]["WorkspaceJoinRequestResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type EvidenceCitation = components["schemas"]["EvidenceCitationResponse"];
type WebCitation = components["schemas"]["WebCitationResponse"];
type DraftModel = components["schemas"]["DraftModelResponse"];
type DraftImageInput = components["schemas"]["DraftImageInput"];
type DraftChatResponse = components["schemas"]["DraftChatResponse"];
type DraftTrace = components["schemas"]["DraftTraceResponse"];
type DraftTraceStep = components["schemas"]["DraftTraceStepResponse"];
type Asset = components["schemas"]["AssetResponse"];
type AssetMediaType = components["schemas"]["CreateAssetRequest"]["media_type"];
type WebSearchMode = components["schemas"]["DraftChatRequest"]["web_search"];
type RevisionMode = components["schemas"]["CreateMemoryRevisionRequest"]["mode"];
type MemoryVisibility = components["schemas"]["CreateMemoryRequest"]["visibility"];
type AvatarMediaType = components["schemas"]["UpdateAvatarRequest"]["media_type"];
type AppView = "CAPTURE" | "LIBRARY" | "TEAM";
type SettingsView = "PROFILE" | "SECURITY";
type PublicAuthMode = "LOGIN" | "REGISTER";
type TeamAccessMode = "CREATE" | "JOIN";

type MemorySearchFilters = {
  query: string;
  field: "ALL" | "TITLE";
  from: string;
  to: string;
  authorId: string;
};

type DraftImageAttachment = DraftImageInput & {
  id: string;
  assetId: string;
  markdownUrl: string;
  previewUrl: string;
};

type DraftImagePreview = Pick<DraftImageAttachment, "id" | "name" | "previewUrl">;

type DraftDocumentAttachment = {
  id: string;
  assetId: string;
  name: string;
  mediaType: AssetMediaType;
  sizeBytes: number;
};

type DraftDocumentPreview = Pick<DraftDocumentAttachment, "id" | "name" | "mediaType">;

type DraftMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  meta?: string;
  citations?: EvidenceCitation[];
  webCitations?: WebCitation[];
  images?: DraftImagePreview[];
  attachments?: DraftDocumentPreview[];
  activity?: DraftTrace;
};

const MAX_DRAFT_IMAGES = 3;
const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DRAFT_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_DRAFT_DOCUMENTS = 3;
const MAX_DRAFT_PDF_BYTES = 20 * 1024 * 1024;
const ACCEPTED_DRAFT_IMAGE_TYPES = new Set<DraftImageInput["media_type"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const ACCEPTED_ASSET_TYPES = new Set<AssetMediaType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
const IMAGE_ONLY_INSTRUCTION = "请读取这些图片，提取其中的文字，并整理到右侧 Markdown。";
const AUTO_WEB_SEARCH_MARKERS = [
  "联网",
  "上网",
  "搜索",
  "搜一下",
  "查一下",
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
const SPLIT_GUTTER_PX = 8;
const SPLIT_KEY_STEP = 4;
const SPLIT_KEY_LARGE_STEP = 10;
const COMPOSER_DEFAULT_HEIGHT = 184;
const COMPOSER_MIN_HEIGHT = 156;
const COMPOSER_MAX_HEIGHT = 360;
const COMPOSER_KEY_STEP = 18;
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
const EMPTY_MEMORY_SEARCH: MemorySearchFilters = {
  query: "",
  field: "ALL",
  from: "",
  to: "",
  authorId: "",
};

const demoAccounts = [
  { name: "Alex", email: "alex@memora.local" },
  { name: "Blair", email: "blair@memora.local" },
  { name: "Casey", email: "casey@memora.local" },
  { name: "Devon", email: "devon@memora.local" },
];

const initialMessage: DraftMessage = {
  id: "welcome",
  role: "ASSISTANT",
  content: "告诉我一个想法，或者让我整理、补充右侧草稿。",
  meta: "只有点击“保存为我的记忆”后，内容才会进入记忆库",
};

let localId = 0;

function nextId(prefix: string) {
  localId += 1;
  return `${prefix}-${Date.now()}-${localId}`;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredNumber(key: string) {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function storeNumber(key: string, value: number) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences are optional and must never block the workspace.
  }
}

function readStoredBoolean(key: string) {
  if (typeof window === "undefined" || typeof window.localStorage?.getItem !== "function") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(key);
    return value === "true" ? true : value === "false" ? false : null;
  } catch {
    return null;
  }
}

function storeBoolean(key: string, value: boolean) {
  if (typeof window === "undefined" || typeof window.localStorage?.setItem !== "function") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Layout preferences are optional and must never block the workspace.
  }
}

function splitBounds(containerWidth: number, minLeftPx: number, minRightPx: number) {
  const width = Math.max(containerWidth, minLeftPx + minRightPx + SPLIT_GUTTER_PX);
  const min = (minLeftPx / width) * 100;
  const max = ((width - minRightPx - SPLIT_GUTTER_PX) / width) * 100;
  return max > min ? { min, max } : { min: 0, max: 100 };
}

function willSearchWeb(instruction: string, mode: WebSearchMode) {
  if (mode === "DISABLED") return false;
  if (mode === "REQUIRED") return true;
  const normalized = instruction.toLocaleLowerCase();
  return AUTO_WEB_SEARCH_MARKERS.some((marker) => normalized.includes(marker));
}

function modelSupports(
  model: DraftModel | undefined,
  capability: DraftModel["capabilities"][number],
) {
  return !model || model.capabilities.includes(capability);
}

function selectedDraftModelLabel(models: DraftModel[], modelId: string | null) {
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

function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "detail" in error && typeof error.detail === "string") {
    return error.detail;
  }
  return fallback;
}

function buildLiveTrace({
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

function upsertTraceStep(steps: DraftTraceStep[], next: DraftTraceStep) {
  const existingIndex = steps.findIndex((step) => step.id === next.id);
  if (existingIndex < 0) return [...steps, next];
  return steps.map((step, index) => (index === existingIndex ? next : step));
}

function buildCompletedTrace({
  modelLabel,
  images,
  documents,
  requestedWebSearch,
  response,
}: {
  modelLabel: string;
  images: DraftImageAttachment[];
  documents: DraftDocumentAttachment[];
  requestedWebSearch: boolean;
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

  steps.push({
    id: "retrieval",
    kind: "RETRIEVAL",
    status: "COMPLETED",
    title: "授权个人记忆已检索",
    detail: response.citations.length
      ? `检索个人记忆：引用 ${response.citations.length} 条`
      : "检索个人记忆：未引用已有记录",
    elapsed_ms: 0,
    duration_ms: null,
    item_count: response.citations.length,
  });

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

function buildFailedTrace({
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

function base64FromDataUrl(value: string) {
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) throw new Error("file_read_failed");
  return value.slice(commaIndex + 1);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("file_read_failed"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadAsset(file: File, data: string): Promise<Asset> {
  const { data: asset, response } = await api.POST("/assets", {
    body: {
      name: file.name || "未命名附件",
      media_type: file.type as AssetMediaType,
      data,
    },
  });
  if (!asset || !response.ok) throw new Error("asset_upload_failed");
  return asset;
}

async function readImageAttachment(file: File): Promise<DraftImageAttachment> {
  const previewUrl = await readFileAsDataUrl(file);
  const data = base64FromDataUrl(previewUrl);
  const asset = await uploadAsset(file, data);
  if (!asset.markdown_url) throw new Error("asset_upload_failed");
  return {
    id: nextId("image"),
    assetId: asset.id,
    markdownUrl: asset.markdown_url,
    name: asset.name,
    media_type: asset.media_type as DraftImageInput["media_type"],
    data,
    previewUrl,
  };
}

async function readDocumentAttachment(file: File): Promise<DraftDocumentAttachment> {
  const dataUrl = await readFileAsDataUrl(file);
  const asset = await uploadAsset(file, base64FromDataUrl(dataUrl));
  return {
    id: nextId("attachment"),
    assetId: asset.id,
    name: asset.name,
    mediaType: asset.media_type,
    sizeBytes: asset.size_bytes,
  };
}

function appendMarkdownImage(markdown: string, image: DraftImageAttachment) {
  const alt = image.name.replace(/[\]\n\r]/g, " ").trim() || "图片";
  const imageMarkdown = `![${alt}](${image.markdownUrl})`;
  return markdown.trim() ? `${markdown.replace(/\s*$/, "")}\n\n${imageMarkdown}` : imageMarkdown;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function sourceHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return "今天";
  if (dayKey(value) === dayKey(yesterday.toISOString())) return "昨天";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function memoryTitle(body: string) {
  const firstContentLine = body
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find(Boolean);
  if (!firstContentLine) return "未命名记忆";
  return firstContentLine.length > 34 ? `${firstContentLine.slice(0, 33)}…` : firstContentLine;
}

function memoryExcerpt(body: string) {
  const normalized = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>`[\]()~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 72 ? `${normalized.slice(0, 71)}…` : normalized;
}

function safeMarkdownImageSrc(value: string) {
  if (value.startsWith("/api/assets/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function MarkdownPreview({ value }: { value: string }) {
  return (
    <div className="markdown-preview-pane" aria-label="Markdown 预览">
      <div className="markdown-preview-toolbar">
        <span>预览</span>
        <small>GFM</small>
      </div>
      <div className={`markdown-preview ${value.trim() ? "" : "is-empty"}`}>
        {value.trim() ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, href }) => (
                <a
                  href={href}
                  target={href?.startsWith("http") ? "_blank" : undefined}
                  rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
                >
                  {children}
                </a>
              ),
              img: ({ alt, src }) => {
                const safeSrc = typeof src === "string" ? safeMarkdownImageSrc(src) : null;
                return safeSrc ? (
                  <Image
                    src={safeSrc}
                    alt={alt || "Markdown 图片"}
                    width={1280}
                    height={720}
                    unoptimized
                  />
                ) : (
                  <span className="markdown-image-error">图片地址不可用</span>
                );
              },
            }}
          >
            {value}
          </ReactMarkdown>
        ) : (
          <span>暂无预览</span>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <Image alt="" height={1024} src="/memora-logo-owl-minimal-tight.png" width={1024} />
    </span>
  );
}

function Icon({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CaptureIcon() {
  return (
    <Icon>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
    </Icon>
  );
}

function LibraryIcon() {
  return (
    <Icon>
      <path d="M6 3h11a2 2 0 0 1 2 2v16H8a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1Z" />
      <path d="M5 17h14M9 7h6M9 10h5" />
    </Icon>
  );
}

function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </Icon>
  );
}

function AttachmentIcon() {
  return (
    <Icon>
      <path d="m20.5 11.5-8.7 8.7a6 6 0 0 1-8.5-8.5l9.4-9.4a4 4 0 0 1 5.7 5.7L9 17.4a2 2 0 0 1-2.8-2.8l8.7-8.7" />
    </Icon>
  );
}

function GlobeIcon() {
  return (
    <Icon size={16}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </Icon>
  );
}

function SparkleIcon() {
  return (
    <Icon>
      <path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25Z" />
      <path d="m18.5 14 .75 2.25L21.5 17l-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75Z" />
    </Icon>
  );
}

function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

function PreviewIcon({ hidden = false }: { hidden?: boolean }) {
  return (
    <Icon size={16}>
      <path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      {hidden ? <path d="m4 4 16 16" /> : null}
    </Icon>
  );
}

function UserAvatar({
  user,
  src = user.avatar_url,
  className = "",
}: {
  user: Pick<CurrentUser, "display_name" | "avatar_url">;
  src?: string | null;
  className?: string;
}) {
  return (
    <span className={`user-avatar ${className}`} aria-hidden="true">
      <span>{user.display_name.slice(0, 1).toUpperCase()}</span>
      {src ? (
        <Image
          alt=""
          height={96}
          key={src}
          src={src}
          unoptimized
          width={96}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

function AuthDialog({
  mode,
  onClose,
  onModeChange,
  onAuthenticated,
}: {
  mode: PublicAuthMode;
  onClose: () => void;
  onModeChange: (mode: PublicAuthMode) => void;
  onAuthenticated: (user: CurrentUser) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const isRegister = mode === "REGISTER";

  useEffect(() => {
    const timer = window.setTimeout(() => firstInputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (isRegister && password.length < 10) {
      setError("密码至少需要 10 个字符。");
      return;
    }
    if (isRegister && password !== passwordConfirm) {
      setError("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    try {
      const result = isRegister
        ? await api.POST("/auth/register", {
            body: { display_name: displayName, email, password },
          })
        : await api.POST("/auth/login", { body: { email, password } });
      if (!result.data || !result.response.ok) {
        if (result.response.status === 429) {
          setError("尝试次数过多，请稍后再试。");
        } else if (isRegister && result.response.status === 409) {
          setError("该邮箱已经注册，请直接登录。");
        } else if (isRegister && result.response.status === 422) {
          setError("请检查昵称、邮箱和密码是否有效。");
        } else {
          setError("邮箱或密码错误。");
        }
        return;
      }
      onAuthenticated(result.data);
    } catch {
      setError("暂时无法连接 Memora，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="auth-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
      >
        <header className="auth-dialog-header">
          <div className="auth-dialog-brand">
            <Logo />
            <span>Memora</span>
          </div>
          <button type="button" aria-label="关闭账号窗口" onClick={onClose}>
            <X aria-hidden="true" size={18} strokeWidth={1.7} />
          </button>
        </header>

        <div className="auth-dialog-copy">
          <p>{isRegister ? "CREATE YOUR SPACE" : "WELCOME BACK"}</p>
          <h2 id="auth-dialog-title">{isRegister ? "创建个人空间" : "登录 Memora"}</h2>
          <span>
            {isRegister
              ? "注册后会立即创建一个只属于你的私有工作台。"
              : "继续整理你的草稿、记忆和思考脉络。"}
          </span>
        </div>

        <div className="auth-mode-tabs" role="tablist" aria-label="账号入口">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? "is-active" : ""}
            onClick={() => onModeChange("LOGIN")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? "is-active" : ""}
            onClick={() => onModeChange("REGISTER")}
          >
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={submit}>
          {isRegister ? (
            <label>
              <span>昵称</span>
              <input
                ref={firstInputRef}
                name="display_name"
                type="text"
                autoComplete="name"
                placeholder="你的名字"
                value={displayName}
                maxLength={120}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          ) : null}
          <label>
            <span>邮箱账号</span>
            <input
              ref={isRegister ? undefined : firstInputRef}
              name="email"
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              maxLength={320}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>密码</span>
            <span className="auth-password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isRegister ? "new-password" : "current-password"}
                placeholder={isRegister ? "至少 10 个字符" : "输入账号密码"}
                value={password}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          {isRegister ? (
            <label>
              <span>确认密码</span>
              <input
                name="password_confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="再次输入密码"
                value={passwordConfirm}
                maxLength={128}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                required
              />
            </label>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="auth-submit" type="submit" disabled={submitting}>
            <span>{submitting ? "请稍候…" : isRegister ? "创建并进入" : "登录并进入"}</span>
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </form>

        {!isRegister ? (
          <details className="demo-accounts">
            <summary>开发环境测试账号</summary>
            <div className="demo-account-list">
              {demoAccounts.map((account) => (
                <button key={account.email} type="button" onClick={() => setEmail(account.email)}>
                  <span>{account.name}</span>
                  <small>{account.email}</small>
                </button>
              ))}
            </div>
          </details>
        ) : null}
        <p className="auth-footnote">
          <ShieldCheck aria-hidden="true" size={14} />
          密码经 Argon2 哈希保存，内容默认仅自己可见
        </p>
      </section>
    </div>
  );
}

function PublicLanding({ onAuthenticated }: { onAuthenticated: (user: CurrentUser) => void }) {
  const [authMode, setAuthMode] = useState<PublicAuthMode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const openAuth = (mode: PublicAuthMode) => {
    setMenuOpen(false);
    setAuthMode(mode);
  };

  return (
    <main className="landing-page" id="landing-top">
      <header className="landing-nav">
        <a className="landing-brand" href="#landing-top" aria-label="Memora 首页">
          <Logo />
          <span>Memora</span>
        </a>
        <nav className={menuOpen ? "is-open" : ""} aria-label="首页导航">
          <a href="#landing-workflow" onClick={() => setMenuOpen(false)}>
            开始使用
          </a>
          <a href="#landing-features" onClick={() => setMenuOpen(false)}>
            产品功能
          </a>
          <a href="#landing-principles" onClick={() => setMenuOpen(false)}>
            工作方式
          </a>
          <a href="#landing-faq" onClick={() => setMenuOpen(false)}>
            常见问题
          </a>
        </nav>
        <div className="landing-nav-actions">
          <button className="landing-login-button" type="button" onClick={() => openAuth("LOGIN")}>
            登录
          </button>
          <button
            className="landing-start-button"
            type="button"
            onClick={() => openAuth("REGISTER")}
          >
            快速开始
          </button>
          <button
            className="landing-menu-button"
            type="button"
            aria-label={menuOpen ? "关闭首页导航" : "打开首页导航"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <button
            className="landing-announcement"
            type="button"
            onClick={() => openAuth("REGISTER")}
          >
            Memora 个人记忆工作台现已开放
            <ArrowRight aria-hidden="true" size={13} />
          </button>
          <h1 id="landing-title">
            <span>Memora</span>
            <span>让思考长期生长</span>
          </h1>
          <p>
            从一段随手记录，到可编辑的 Markdown 草稿，再到带时间与版本的个人记忆。 AI
            处理重复整理工作，最终保存权始终在你手里。
          </p>
          <div className="landing-hero-actions">
            <button type="button" onClick={() => openAuth("REGISTER")}>
              快速开始
            </button>
            <a href="#landing-features">了解更多</a>
          </div>
          <div className="landing-trust-row">
            <span className="landing-trust-marks" aria-hidden="true">
              <i>M</i>
              <i>#</i>
              <i>✓</i>
            </span>
            <span>
              <strong>默认私有</strong>
              用户确认后保存 · 原始记录可追溯
            </span>
          </div>
        </div>

        <div className="landing-product-stage" aria-label="Memora 产品界面预览">
          <div className="landing-stage-window">
            <div className="landing-stage-topbar">
              <div>
                <Logo />
                <strong>Memora</strong>
              </div>
              <span>gpt-5.6-terra</span>
              <small>默认私有</small>
            </div>
            <div className="landing-stage-body">
              <aside>
                <strong>个人空间</strong>
                <span className="is-active">
                  <CaptureIcon /> 记录想法
                </span>
                <span>
                  <LibraryIcon /> 记忆库
                </span>
                <small>所有新记忆仅你可见</small>
              </aside>
              <div className="landing-stage-chat">
                <p>把今天对产品方向的判断整理成一条可追溯记录。</p>
                <div>
                  <Sparkles size={14} />
                  <span>正在整理原始想法</span>
                </div>
                <blockquote>已保留你的原意，并把关键判断同步到右侧 Markdown。</blockquote>
              </div>
              <div className="landing-stage-editor">
                <header>
                  <span>Markdown 草稿</span>
                  <small>实时预览</small>
                </header>
                <code># 产品方向</code>
                <p>先验证个人记录和长期回顾，再逐步扩展协作能力。</p>
                <code>## 下一步</code>
                <p>- 验证保存意愿</p>
                <p>- 保留判断依据</p>
                <button type="button" tabIndex={-1}>
                  保存为我的记忆
                </button>
              </div>
            </div>
          </div>
          <div className="landing-stage-card is-memory">
            <FileClock aria-hidden="true" size={17} />
            <span>历史版本已保留</span>
            <strong>3 个思考节点</strong>
          </div>
          <div className="landing-stage-card is-source">
            <BookOpenText aria-hidden="true" size={17} />
            <span>回答引用原始记录</span>
            <strong>证据先于流畅</strong>
          </div>
        </div>
      </section>

      <section className="landing-foundation" aria-label="Memora 核心原则">
        <p>围绕长期个人记忆构建的 AI 工作流</p>
        <div>
          <span>
            <LockKeyhole size={16} /> Private
          </span>
          <span>
            <BookOpenText size={16} /> Markdown
          </span>
          <span>
            <FileClock size={16} /> Revisions
          </span>
          <span>
            <Search size={16} /> Retrieval
          </span>
          <span>
            <BrainCircuit size={16} /> AI Agent
          </span>
        </div>
      </section>

      <section className="landing-section landing-features" id="landing-features">
        <div className="landing-section-heading">
          <p>ONE WORKSPACE</p>
          <h2>重新定义个人知识工作流</h2>
          <span>
            记录、整理、检索和回顾不再散落在多个工具中。Memora 把思考发生的过程和最后
            保存的内容留在同一个工作台。
          </span>
        </div>

        <div className="landing-feature-showcase">
          <article>
            <div>
              <FileClock size={19} />
              <h3>随时记录，长期可见</h3>
              <p>对话先进入草稿，保存后按日期进入记忆库；刷新、退出和重新登录都不会丢失。</p>
            </div>
            <div className="landing-timeline-visual" aria-hidden="true">
              <span>今天</span>
              <i>
                <b />
                产品判断<strong>12:25</strong>
              </i>
              <span>7 月 30 日</span>
              <i>
                <b />
                Memora 图标与构建<strong>17:42</strong>
              </i>
              <i>
                <b />
                研究资料整理<strong>09:18</strong>
              </i>
            </div>
          </article>
          <article>
            <div>
              <BrainCircuit size={19} />
              <h3>一站式 Markdown Agent</h3>
              <p>让 AI 阅读图片与 PDF、联网核对信息、修改草稿；AI 可以工作，但不能替你保存。</p>
            </div>
            <div className="landing-agent-visual" aria-hidden="true">
              <span>
                <Search size={15} /> 检索个人记忆
              </span>
              <span>
                <Sparkles size={15} /> 整理为 Markdown
              </span>
              <span>
                <BookOpenText size={15} /> 保留来源链接
              </span>
              <i />
            </div>
          </article>
        </div>

        <div className="landing-capability-grid">
          <article>
            <LockKeyhole size={18} />
            <h3>默认私有</h3>
            <p>新账号只拥有自己的个人空间，记录不会自动分享给其他用户。</p>
          </article>
          <article>
            <BookOpenText size={18} />
            <h3>实时 Markdown</h3>
            <p>编辑区与预览同步，最终保存的是你确认后的清晰正文。</p>
          </article>
          <article>
            <FileClock size={18} />
            <h3>版本可追溯</h3>
            <p>更新当前记忆或保存为新版本，都不会静默覆盖历史判断。</p>
          </article>
          <article>
            <Search size={18} />
            <h3>个人记忆检索</h3>
            <p>回答先经过身份和可见性过滤，再引用你有权访问的原始记录。</p>
          </article>
          <article>
            <Sparkles size={18} />
            <h3>多模态整理</h3>
            <p>上传图片或 PDF，让 AI 提取、归纳并写入仍可继续编辑的草稿。</p>
          </article>
          <article>
            <BrainCircuit size={18} />
            <h3>动态工作过程</h3>
            <p>模型、搜索、附件读取和草稿同步过程会在对话中持续反馈。</p>
          </article>
        </div>
      </section>

      <section className="landing-workflow" id="landing-workflow">
        <div className="landing-workflow-copy">
          <p>FOCUS WITHOUT SWITCHING</p>
          <h2>你可以在聊天、笔记与检索间来回切换，但不必如此</h2>
          <span>从原始输入到正式记忆，所有中间状态都留在一个连续的工作面上。</span>
        </div>
        <div className="landing-workflow-track" aria-label="Memora 工作流程">
          <article>
            <span>01</span>
            <h3>说出想法</h3>
            <p>输入文字，或附加图片与 PDF。</p>
          </article>
          <ArrowRight aria-hidden="true" />
          <article>
            <span>02</span>
            <h3>AI 整理</h3>
            <p>查看过程，继续要求修改和核对。</p>
          </article>
          <ArrowRight aria-hidden="true" />
          <article>
            <span>03</span>
            <h3>确认保存</h3>
            <p>由你决定何时成为正式个人记忆。</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-principles" id="landing-principles">
        <div className="landing-section-heading">
          <p>MEASURABLE BY DESIGN</p>
          <h2>看得见的边界，有依据的结果</h2>
        </div>
        <div className="landing-stat-grid">
          <article>
            <strong>1</strong>
            <span>个连续工作台</span>
            <p>聊天、草稿和记忆库保持同一上下文。</p>
          </article>
          <article>
            <strong>100%</strong>
            <span>用户确认后保存</span>
            <p>AI 不会在你不知情时写入正式记忆。</p>
          </article>
          <article>
            <strong>0</strong>
            <span>条默认公开记录</span>
            <p>每个新想法从 PRIVATE 开始。</p>
          </article>
          <article>
            <strong>∞</strong>
            <span>持续演进的版本</span>
            <p>新判断补充历史，而不是抹去历史。</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-faq" id="landing-faq">
        <div className="landing-section-heading">
          <p>FAQ</p>
          <h2>常见问题</h2>
        </div>
        <div className="landing-faq-list">
          <details>
            <summary>
              Memora 和普通聊天机器人有什么不同？
              <ChevronRight size={17} />
            </summary>
            <p>
              聊天只是入口。Memora 同时维护可编辑
              Markdown、正式记忆、版本关系和经过授权过滤的个人检索。
            </p>
          </details>
          <details>
            <summary>
              AI 会自动保存我说过的所有内容吗？
              <ChevronRight size={17} />
            </summary>
            <p>
              不会。AI 只能更新草稿，只有你明确点击保存或明确发出保存命令后，内容才会进入记忆库。
            </p>
          </details>
          <details>
            <summary>
              注册后会加入其他人的团队空间吗？
              <ChevronRight size={17} />
            </summary>
            <p>不会。公开注册只创建你的个人空间，不会授予测试团队或任何其他用户数据的访问权。</p>
          </details>
          <details>
            <summary>
              我的密码和个人内容如何保护？
              <ChevronRight size={17} />
            </summary>
            <p>
              密码使用 Argon2 慢哈希保存，会话使用 HttpOnly
              Cookie；个人记忆在检索和生成前都应用服务端身份过滤。
            </p>
          </details>
          <details>
            <summary>
              可以修改已经保存的记忆吗？
              <ChevronRight size={17} />
            </summary>
            <p>可以。你可以更新当前时间线条目或另存为新版本，旧正文都会作为历史修订保留。</p>
          </details>
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <Logo />
          <p>YOUR MEMORY, IN MOTION</p>
          <h2>让每一次思考，都成为下一次判断的起点</h2>
          <button type="button" onClick={() => openAuth("REGISTER")}>
            开始使用 Memora
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="#landing-top">
          <Logo />
          <span>Memora</span>
        </a>
        <p>Personal Markdown Memory Workspace</p>
        <button type="button" onClick={() => openAuth("LOGIN")}>
          登录
        </button>
      </footer>

      {authMode ? (
        <AuthDialog
          key={authMode}
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
          onAuthenticated={onAuthenticated}
        />
      ) : null}
    </main>
  );
}

function formattedTeamCode(code: string | null) {
  if (!code) return "";
  return code.length === 12 ? `${code.slice(0, 6)}-${code.slice(6)}` : code;
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

function TeamAccessDialog({
  initialMode,
  onClose,
  onWorkspaceReady,
}: {
  initialMode: TeamAccessMode;
  onClose: () => void;
  onWorkspaceReady: (workspace: Workspace, alreadyActive: boolean) => Promise<void>;
}) {
  const [mode, setMode] = useState(initialMode);
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
        const result = await api.POST("/workspaces", { body: { name: normalizedName } });
        if (!result.data || !result.response.ok) {
          throw new Error(apiErrorMessage(result.error, "创建团队失败"));
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
        <p className="eyebrow">TEAM WORKSPACE</p>
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

function TeamWorkspace({
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
      onNotify("团队号已复制");
    } catch {
      onNotify("复制失败，请手动选择团队号");
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
    onNotify(`已邀请 ${result.data.display_name} 加入团队`);
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
        onNotify(`已允许 ${joinRequest.display_name} 加入团队`);
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
      onNotify(`已将 ${member.display_name} 移出团队`);
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
          <p className="eyebrow">TEAM WORKSPACE</p>
          <h1 id="team-workspace-title">{workspace.name}</h1>
          <p>团队记忆只包含成员主动设为“团队共享”的内容。</p>
        </div>
        <span className="team-role-badge">{workspace.role === "OWNER" ? "所有者" : "成员"}</span>
      </header>

      <div className={`team-summary-band ${workspace.role === "OWNER" ? "has-requests" : ""}`}>
        <div>
          <Hash aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>
            <small>团队号</small>
            <code>{joinCode || "尚未生成"}</code>
          </span>
          {joinCode ? (
            <button
              type="button"
              aria-label="复制团队号"
              title="复制团队号"
              onClick={() => void copyJoinCode()}
            >
              <Copy aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
        <div>
          <Users aria-hidden="true" size={18} strokeWidth={1.7} />
          <span>
            <small>团队成员</small>
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
                        title={confirmRemoveId === member.id ? "再次点击确认移除" : "移出团队"}
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
                {inviting ? "邀请中…" : "添加到团队"}
              </button>
            </form>
          ) : (
            <p>团队所有者可以通过已注册邮箱添加成员。</p>
          )}
          <div className="team-invite-code">
            <Hash aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>也可以把团队号发给对方；对方提交申请后，由所有者审核。</span>
          </div>
        </section>
      </div>
    </section>
  );
}

function Sidebar({
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

function AccountSettingsDialog({
  user,
  onClose,
  onUserChange,
  onNotify,
}: {
  user: CurrentUser;
  onClose: () => void;
  onUserChange: (user: CurrentUser) => void;
  onNotify: (message: string) => void;
}) {
  const [settingsView, setSettingsView] = useState<SettingsView>("PROFILE");
  const [displayName, setDisplayName] = useState(user.display_name);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatar_url);
  const [avatarUpdate, setAvatarUpdate] = useState<{
    name: string;
    media_type: AvatarMediaType;
    data: string;
  } | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const normalizedName = displayName.trim().replace(/\s+/g, " ");
  const profileDirty =
    normalizedName !== user.display_name || avatarUpdate !== null || removeAvatar;

  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.classList.add("is-settings-open");
    window.addEventListener("keydown", closeOnEscape);
    closeButtonRef.current?.focus();
    return () => {
      document.body.classList.remove("is-settings-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  async function chooseAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!ACCEPTED_DRAFT_IMAGE_TYPES.has(file.type as DraftImageInput["media_type"])) {
      setProfileError("头像仅支持 PNG、JPEG 或 WEBP 图片。");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setProfileError("头像不能超过 8 MiB。");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
      setAvatarPreview(dataUrl);
      setAvatarUpdate({
        name: file.name,
        media_type: file.type as AvatarMediaType,
        data: encoded,
      });
      setRemoveAvatar(false);
      setProfileError("");
      setProfileStatus("");
    } catch {
      setProfileError("没有读到这张图片，请重新选择。");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizedName) {
      setProfileError("昵称不能为空。");
      return;
    }
    setProfileSaving(true);
    setProfileError("");
    setProfileStatus("");
    let resolvedUser = user;
    try {
      if (avatarUpdate) {
        const avatarResult = await api.PUT("/auth/avatar", { body: avatarUpdate });
        if (!avatarResult.data || !avatarResult.response.ok) {
          throw new Error(apiErrorMessage(avatarResult.error, "头像保存失败，请稍后重试。"));
        }
        resolvedUser = avatarResult.data;
      } else if (removeAvatar && user.avatar_url) {
        const avatarResult = await api.DELETE("/auth/avatar");
        if (!avatarResult.data || !avatarResult.response.ok) {
          throw new Error(apiErrorMessage(avatarResult.error, "头像移除失败，请稍后重试。"));
        }
        resolvedUser = avatarResult.data;
      }

      if (normalizedName !== resolvedUser.display_name) {
        const profileResult = await api.PATCH("/auth/profile", {
          body: { display_name: normalizedName },
        });
        if (!profileResult.data || !profileResult.response.ok) {
          throw new Error(apiErrorMessage(profileResult.error, "昵称保存失败，请稍后重试。"));
        }
        resolvedUser = profileResult.data;
      }

      onUserChange(resolvedUser);
      setDisplayName(resolvedUser.display_name);
      setAvatarPreview(resolvedUser.avatar_url);
      setAvatarUpdate(null);
      setRemoveAvatar(false);
      setProfileStatus("个人资料已更新");
      onNotify("个人资料已更新");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "个人资料保存失败，请稍后重试。");
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordStatus("");
    if (newPassword.length < 10) {
      setPasswordError("新密码至少需要 10 个字符。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同。");
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await api.PUT("/auth/password", {
        body: { current_password: currentPassword, new_password: newPassword },
      });
      if (!result.response.ok) {
        throw new Error(apiErrorMessage(result.error, "密码修改失败，请稍后重试。"));
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordStatus("密码已更新，其他设备上的会话已退出");
      onNotify("密码已更新");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "密码修改失败，请稍后重试。");
    } finally {
      setPasswordSaving(false);
    }
  }

  function openSettingsView(nextView: SettingsView) {
    setSettingsView(nextView);
    setProfileError("");
    setPasswordError("");
  }

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !profileSaving && !passwordSaving) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-header">
          <div>
            <span className="settings-kicker">
              <SettingsIcon aria-hidden="true" size={12} strokeWidth={1.8} />
              ACCOUNT
            </span>
            <h2 id="settings-title">个人设置</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="settings-close"
            type="button"
            aria-label="关闭个人设置"
            title="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <div className="settings-layout">
          <aside className="settings-sidebar">
            <div className="settings-identity">
              <UserAvatar user={user} src={avatarPreview} className="is-large" />
              <div>
                <strong>{normalizedName || user.display_name}</strong>
                <small>{user.email}</small>
              </div>
            </div>
            <div className="settings-tabs" role="tablist" aria-label="设置分类">
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "PROFILE"}
                className={settingsView === "PROFILE" ? "is-active" : ""}
                onClick={() => openSettingsView("PROFILE")}
              >
                <UserRound aria-hidden="true" size={17} strokeWidth={1.8} />
                个人资料
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={settingsView === "SECURITY"}
                className={settingsView === "SECURITY" ? "is-active" : ""}
                onClick={() => openSettingsView("SECURITY")}
              >
                <LockKeyhole aria-hidden="true" size={17} strokeWidth={1.8} />
                账号安全
              </button>
            </div>
          </aside>

          <div className="settings-content">
            {settingsView === "PROFILE" ? (
              <form
                className="settings-form"
                role="tabpanel"
                aria-label="个人资料"
                onSubmit={saveProfile}
              >
                <div className="settings-section-heading">
                  <h3>个人资料</h3>
                  <p>头像和昵称会显示在你的个人工作台中。</p>
                </div>
                <div className="avatar-editor">
                  <div className="avatar-preview-wrap">
                    <UserAvatar user={user} src={avatarPreview} className="is-editor" />
                    <button
                      type="button"
                      aria-label="选择新头像"
                      title="选择新头像"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <Camera aria-hidden="true" size={17} strokeWidth={1.8} />
                    </button>
                  </div>
                  <div>
                    <input
                      ref={avatarInputRef}
                      className="image-input"
                      type="file"
                      aria-label="选择头像图片"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void chooseAvatar(event)}
                    />
                    <div className="avatar-actions">
                      <button type="button" onClick={() => avatarInputRef.current?.click()}>
                        <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
                        更换头像
                      </button>
                      {(avatarPreview || avatarUpdate) && (
                        <button
                          className="is-danger"
                          type="button"
                          aria-label="移除头像"
                          title="移除头像"
                          onClick={() => {
                            setAvatarPreview(null);
                            setAvatarUpdate(null);
                            setRemoveAvatar(true);
                            setProfileStatus("");
                          }}
                        >
                          <Trash2 aria-hidden="true" size={15} strokeWidth={1.8} />
                        </button>
                      )}
                    </div>
                    <small>PNG、JPEG 或 WEBP，最大 8 MiB</small>
                  </div>
                </div>
                <label className="settings-field" htmlFor="profile-display-name">
                  <span>昵称</span>
                  <input
                    id="profile-display-name"
                    value={displayName}
                    maxLength={120}
                    autoComplete="nickname"
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      setProfileError("");
                      setProfileStatus("");
                    }}
                  />
                </label>
                <label className="settings-field" htmlFor="profile-email">
                  <span>登录邮箱</span>
                  <input id="profile-email" value={user.email} readOnly />
                </label>
                <div className="settings-form-footer">
                  <span
                    className={profileError ? "settings-feedback is-error" : "settings-feedback"}
                    role={profileError ? "alert" : "status"}
                  >
                    {profileError || profileStatus}
                  </span>
                  <button
                    className="settings-save"
                    type="submit"
                    disabled={!profileDirty || profileSaving}
                  >
                    {profileSaving ? (
                      "正在保存…"
                    ) : (
                      <>
                        <Check aria-hidden="true" size={15} strokeWidth={2} />
                        保存更改
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form
                className="settings-form"
                role="tabpanel"
                aria-label="账号安全"
                onSubmit={savePassword}
              >
                <div className="settings-section-heading">
                  <h3>账号安全</h3>
                  <p>更新后，当前设备会保持登录。</p>
                </div>
                {[
                  ["current-password", "当前密码", currentPassword, setCurrentPassword],
                  ["new-password", "新密码", newPassword, setNewPassword],
                  ["confirm-password", "确认新密码", confirmPassword, setConfirmPassword],
                ].map(([id, label, value, setter]) => (
                  <label className="settings-field" htmlFor={id as string} key={id as string}>
                    <span>{label as string}</span>
                    <span className="password-input-wrap">
                      <input
                        id={id as string}
                        type={passwordVisible ? "text" : "password"}
                        value={value as string}
                        minLength={id === "current-password" ? 1 : 10}
                        maxLength={128}
                        autoComplete={
                          id === "current-password" ? "current-password" : "new-password"
                        }
                        onChange={(event) => {
                          (setter as (value: string) => void)(event.target.value);
                          setPasswordError("");
                          setPasswordStatus("");
                        }}
                        required
                      />
                      <button
                        type="button"
                        aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                        title={passwordVisible ? "隐藏密码" : "显示密码"}
                        onClick={() => setPasswordVisible((visible) => !visible)}
                      >
                        {passwordVisible ? (
                          <EyeOff aria-hidden="true" size={16} strokeWidth={1.8} />
                        ) : (
                          <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
                        )}
                      </button>
                    </span>
                  </label>
                ))}
                <div className="password-meter" aria-hidden="true">
                  <span className={newPassword.length >= 10 ? "is-filled" : ""} />
                  <span className={newPassword.length >= 14 ? "is-filled" : ""} />
                  <span
                    className={
                      /[A-Za-z]/.test(newPassword) && /\d/.test(newPassword) ? "is-filled" : ""
                    }
                  />
                </div>
                <div className="settings-form-footer">
                  <span
                    className={passwordError ? "settings-feedback is-error" : "settings-feedback"}
                    role={passwordError ? "alert" : "status"}
                  >
                    {passwordError || passwordStatus}
                  </span>
                  <button
                    className="settings-save"
                    type="submit"
                    disabled={
                      passwordSaving || !currentPassword || !newPassword || !confirmPassword
                    }
                  >
                    {passwordSaving ? (
                      "正在更新…"
                    ) : (
                      <>
                        <LockKeyhole aria-hidden="true" size={15} strokeWidth={1.8} />
                        更新密码
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ResizableSplit({
  className,
  label,
  storageKey,
  defaultLeftPercent,
  minLeftPx,
  minRightPx,
  left,
  right,
}: {
  className: string;
  label: string;
  storageKey?: string;
  defaultLeftPercent: number;
  minLeftPx: number;
  minRightPx: number;
  left: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
  const leftPercentRef = useRef(leftPercent);
  const [dragging, setDragging] = useState(false);

  const clampSplitPercent = useCallback(
    (value: number) => {
      const width =
        containerRef.current?.getBoundingClientRect().width ??
        minLeftPx + minRightPx + SPLIT_GUTTER_PX;
      const { min, max } = splitBounds(width, minLeftPx, minRightPx);
      return clampNumber(value, min, max);
    },
    [minLeftPx, minRightPx],
  );

  const setAndPersistSplit = useCallback(
    (value: number) => {
      const nextValue = clampSplitPercent(value);
      leftPercentRef.current = nextValue;
      setLeftPercent(nextValue);
      if (storageKey) storeNumber(storageKey, Number(nextValue.toFixed(2)));
    },
    [clampSplitPercent, storageKey],
  );

  useEffect(() => {
    if (!storageKey) return undefined;
    const timer = window.setTimeout(() => {
      const stored = readStoredNumber(storageKey);
      if (stored !== null && stored > 0 && stored < 100) setAndPersistSplit(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [setAndPersistSplit, storageKey]);

  useEffect(() => {
    const clampAfterResize = () => setAndPersistSplit(leftPercentRef.current);
    window.addEventListener("resize", clampAfterResize);
    return () => window.removeEventListener("resize", clampAfterResize);
  }, [setAndPersistSplit]);

  function percentFromClientX(clientX: number) {
    const container = containerRef.current;
    if (!container) return leftPercent;
    const rect = container.getBoundingClientRect();
    const width = rect.width || minLeftPx + minRightPx + SPLIT_GUTTER_PX;
    const raw = ((clientX - rect.left) / width) * 100;
    const { min, max } = splitBounds(width, minLeftPx, minRightPx);
    return clampNumber(raw, min, max);
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    document.body.classList.add("is-resizing-panels");
    const initialPercent = percentFromClientX(event.clientX);
    leftPercentRef.current = initialPercent;
    setLeftPercent(initialPercent);

    const resize = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      const nextPercent = percentFromClientX(moveEvent.clientX);
      leftPercentRef.current = nextPercent;
      setLeftPercent(nextPercent);
    };
    const stopResize = () => {
      setAndPersistSplit(leftPercentRef.current);
      setDragging(false);
      document.body.classList.remove("is-resizing-panels");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? SPLIT_KEY_LARGE_STEP : SPLIT_KEY_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setAndPersistSplit(leftPercentRef.current - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setAndPersistSplit(leftPercentRef.current + step);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const width =
        containerRef.current?.getBoundingClientRect().width ??
        minLeftPx + minRightPx + SPLIT_GUTTER_PX;
      const { min, max } = splitBounds(width, minLeftPx, minRightPx);
      setAndPersistSplit(event.key === "Home" ? min : max);
    }
  }

  const splitStyle = {
    "--split-left": `${leftPercent.toFixed(2)}%`,
    "--split-left-min": `${minLeftPx}px`,
    "--split-right-min": `${minRightPx}px`,
    "--split-gutter": `${SPLIT_GUTTER_PX}px`,
  } as CSSProperties;

  return (
    <div
      ref={containerRef}
      className={`${className} resizable-split ${dragging ? "is-dragging" : ""}`}
      style={splitStyle}
    >
      {left}
      <div
        className="split-handle"
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(leftPercent)}
        tabIndex={0}
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={startResize}
        onDoubleClick={() => setAndPersistSplit(defaultLeftPercent)}
        onKeyDown={resizeWithKeyboard}
      >
        <span />
      </div>
      {right}
    </div>
  );
}

function ComposerResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (height: number) => void;
}) {
  const dragOrigin = useRef<{ clientY: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;

    const resize = (event: globalThis.PointerEvent) => {
      const origin = dragOrigin.current;
      if (!origin) return;
      event.preventDefault();
      onHeightChange(
        clampNumber(
          origin.height + origin.clientY - event.clientY,
          COMPOSER_MIN_HEIGHT,
          COMPOSER_MAX_HEIGHT,
        ),
      );
    };
    const stopResize = () => {
      dragOrigin.current = null;
      setDragging(false);
    };

    document.body.classList.add("is-resizing-composer");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      document.body.classList.remove("is-resizing-composer");
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [dragging, onHeightChange]);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragOrigin.current = { clientY: event.clientY, height };
    setDragging(true);
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHeightChange(
        clampNumber(height + COMPOSER_KEY_STEP, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT),
      );
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onHeightChange(
        clampNumber(height - COMPOSER_KEY_STEP, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT),
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      onHeightChange(event.key === "Home" ? COMPOSER_MIN_HEIGHT : COMPOSER_MAX_HEIGHT);
    }
  }

  return (
    <div
      className={`composer-resize-handle ${dragging ? "is-dragging" : ""}`}
      role="separator"
      aria-label="调整输入区高度"
      aria-orientation="horizontal"
      aria-valuemin={COMPOSER_MIN_HEIGHT}
      aria-valuemax={COMPOSER_MAX_HEIGHT}
      aria-valuenow={Math.round(height)}
      tabIndex={0}
      title="拖动调整输入区高度，双击恢复默认"
      onPointerDown={startResize}
      onDoubleClick={() => onHeightChange(COMPOSER_DEFAULT_HEIGHT)}
      onKeyDown={resizeWithKeyboard}
    >
      <span />
    </div>
  );
}

function PreviewToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  const label = visible ? "隐藏 Markdown 预览" : "显示 Markdown 预览";
  return (
    <button
      className={`preview-toggle ${visible ? "is-active" : ""}`}
      type="button"
      aria-label={label}
      aria-pressed={visible}
      title={label}
      onClick={onToggle}
    >
      <PreviewIcon hidden={!visible} />
      <span>{visible ? "预览" : "已隐藏"}</span>
    </button>
  );
}

function MarkdownWorkspace({
  value,
  onChange,
  ariaLabel,
  placeholder,
  previewVisible,
  className = "",
  editorClassName = "",
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  previewVisible: boolean;
  className?: string;
  editorClassName?: string;
  readOnly?: boolean;
}) {
  const editor = (
    <textarea
      className={`markdown-editor ${editorClassName}`}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      spellCheck={false}
    />
  );

  if (!previewVisible) {
    return <div className={`${className} markdown-editor-grid is-preview-hidden`}>{editor}</div>;
  }

  return (
    <ResizableSplit
      className={`${className} markdown-editor-grid`}
      label="调整 Markdown 编辑和预览宽度"
      storageKey="memora.split.markdown"
      defaultLeftPercent={52}
      minLeftPx={160}
      minRightPx={170}
      left={editor}
      right={<MarkdownPreview value={value} />}
    />
  );
}

function ActivityTrace({
  trace,
  active = false,
  citations = [],
  webCitations = [],
  onOpenCitation,
}: {
  trace: DraftTrace;
  active?: boolean;
  citations?: EvidenceCitation[];
  webCitations?: WebCitation[];
  onOpenCitation?: (memoryId: string) => Promise<void>;
}) {
  const [activeElapsedMs, setActiveElapsedMs] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now() - trace.duration_ms;
    const timer = window.setInterval(() => setActiveElapsedMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [active, trace.duration_ms]);

  if (!trace.steps.length) return null;
  const elapsedMs = active ? Math.max(trace.duration_ms, activeElapsedMs) : trace.duration_ms;
  const elapsedLabel = `${Math.max(1, Math.round(elapsedMs / 1000))} 秒`;
  const statusLabel: Record<DraftTraceStep["status"], string> = {
    RUNNING: "进行中",
    COMPLETED: "完成",
    SKIPPED: "已跳过",
    DEGRADED: "已降级",
    REJECTED: "已拒绝",
    FAILED: "失败",
  };

  return (
    <details
      className={`activity-trace${active ? " is-active" : ""}`}
      open={active ? true : undefined}
    >
      <summary>
        <span className="trace-summary-icon">
          <SparkleIcon />
        </span>
        <span>
          <strong>{active ? "正在工作" : "工作过程"}</strong>
          <small>{elapsedLabel}</small>
        </span>
        <span className="trace-summary-state">
          {active ? "实时更新" : `${trace.steps.length} 步`}
        </span>
        <span className="trace-chevron" aria-hidden="true" />
      </summary>
      <div className="trace-body">
        <p className="trace-safety-note">安全过程摘要，不包含模型隐藏思维链。</p>
        <ol>
          {trace.steps.map((step) => {
            const showWebSources = step.id.includes("web-search") && webCitations.length > 0;
            const showMemorySources = step.kind === "RETRIEVAL" && citations.length > 0;
            return (
              <li className={`is-${step.status.toLowerCase()}`} key={step.id}>
                <span className="trace-node" aria-hidden="true">
                  {step.kind === "TOOL" && step.id.includes("web-search") ? (
                    <GlobeIcon />
                  ) : step.kind === "ATTACHMENT" || step.kind === "RETRIEVAL" ? (
                    <LibraryIcon />
                  ) : (
                    <SparkleIcon />
                  )}
                </span>
                <div className="trace-step-content">
                  <div className="trace-step-title">
                    <strong>{step.title}</strong>
                    <span>{statusLabel[step.status]}</span>
                    {step.duration_ms != null ? (
                      <time>{Math.max(1, Math.round(step.duration_ms / 1000))} 秒</time>
                    ) : null}
                  </div>
                  {step.detail ? <p>{step.detail}</p> : null}
                  {showWebSources ? (
                    <div className="trace-web-results" aria-label="联网搜索结果">
                      {webCitations.map((citation) => (
                        <a
                          href={citation.url}
                          key={citation.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <GlobeIcon />
                          <span>
                            <strong>{citation.title}</strong>
                            <small>{sourceHostname(citation.url)}</small>
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {showMemorySources ? (
                    <div className="trace-memory-results" aria-label="个人记忆检索结果">
                      {citations.map((citation) => (
                        <button
                          type="button"
                          key={citation.memory_id}
                          aria-label={`查看来源：${citation.author.display_name} ${formatDateTime(
                            citation.created_at,
                          )}`}
                          onClick={() => void onOpenCitation?.(citation.memory_id)}
                        >
                          <LibraryIcon />
                          <span>
                            <strong>{citation.author.display_name}</strong>
                            <small>{formatDateTime(citation.created_at)}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
        {!active ? (
          <footer className="trace-footer">
            <span>{trace.model ?? "未调用模型"}</span>
            <span>
              {trace.input_tokens + trace.output_tokens > 0
                ? `${trace.input_tokens + trace.output_tokens} tokens`
                : "本轮无 token 记录"}
            </span>
          </footer>
        ) : null}
      </div>
    </details>
  );
}

function CaptureWorkspace({
  workspace,
  draft,
  messages,
  refining,
  activity,
  saving,
  savedBody,
  saveVisibility,
  savedVisibility,
  modelOptions,
  selectedModelId,
  onDraftChange,
  onRefine,
  onSave,
  onSaveVisibilityChange,
  onReset,
  onModelChange,
  onOpenCitation,
}: {
  workspace: Workspace;
  draft: string;
  messages: DraftMessage[];
  refining: boolean;
  activity: DraftTrace | null;
  saving: boolean;
  savedBody: string | null;
  saveVisibility: MemoryVisibility;
  savedVisibility: MemoryVisibility | null;
  modelOptions: DraftModel[];
  selectedModelId: string | null;
  onDraftChange: (value: string) => void;
  onRefine: (
    instruction: string,
    images: DraftImageAttachment[],
    documents: DraftDocumentAttachment[],
    webSearch: WebSearchMode,
    modelId: string | null,
  ) => Promise<void>;
  onSave: () => Promise<void>;
  onSaveVisibilityChange: (visibility: MemoryVisibility) => void;
  onReset: () => void;
  onModelChange: (modelId: string | null) => void;
  onOpenCitation: (memoryId: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [attachments, setAttachments] = useState<DraftImageAttachment[]>([]);
  const [documents, setDocuments] = useState<DraftDocumentAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("AUTO");
  const [composerHeight, setComposerHeight] = useState(COMPOSER_DEFAULT_HEIGHT);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [draftPreviewVisible, setDraftPreviewVisible] = useState(true);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);
  const normalizedDraft = draft.trim();
  const isSaved = Boolean(
    normalizedDraft && normalizedDraft === savedBody && saveVisibility === savedVisibility,
  );
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId);
  const selectedModelLabel = selectedDraftModelLabel(modelOptions, selectedModelId);
  const canUseImages = modelSupports(selectedModel, "vision");
  const canUseWeb = modelSupports(selectedModel, "web_search");

  const changeComposerHeight = useCallback((height: number) => {
    const nextHeight = clampNumber(height, COMPOSER_MIN_HEIGHT, COMPOSER_MAX_HEIGHT);
    setComposerHeight(nextHeight);
    storeNumber("memora.composer.height", nextHeight);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedHeight = readStoredNumber("memora.composer.height");
      if (storedHeight !== null && storedHeight > 0) changeComposerHeight(storedHeight);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [changeComposerHeight]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, refining]);

  // Return focus to the composer once a turn finishes so typing can continue.
  useEffect(() => {
    if (!refining) composerRef.current?.focus?.();
  }, [refining]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = instruction.trim();
    if ((!value && attachments.length === 0 && documents.length === 0) || refining) return;
    const message =
      value ||
      (documents.length && !attachments.length
        ? "请阅读这些 PDF，把与当前想法相关的内容整理到右侧 Markdown。"
        : IMAGE_ONLY_INSTRUCTION);
    const selectedAttachments = attachments;
    const selectedDocuments = documents;
    setInstruction("");
    setAttachments([]);
    setDocuments([]);
    setAttachmentError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
    const selectedWebSearchMode = webSearchMode;
    if (selectedWebSearchMode === "REQUIRED") setWebSearchMode("AUTO");
    await onRefine(
      message,
      selectedAttachments,
      selectedDocuments,
      selectedWebSearchMode,
      selectedModelId,
    );
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function changeModel(modelId: string | null) {
    const nextModel = modelOptions.find((model) => model.id === modelId);
    if (attachments.length && !modelSupports(nextModel, "vision")) {
      setAttachments([]);
      setAttachmentError("已切换到不支持图片的模型，待发送图片已移除。");
    } else {
      setAttachmentError("");
    }
    if (!modelSupports(nextModel, "web_search")) {
      setWebSearchMode("DISABLED");
    }
    onModelChange(modelId);
  }

  // Returns an error message, or "" when the batch may be attached.
  function validateFiles(files: File[]) {
    const imageFiles = files.filter((file) =>
      ACCEPTED_DRAFT_IMAGE_TYPES.has(file.type as DraftImageInput["media_type"]),
    );
    const pdfFiles = files.filter((file) => file.type === "application/pdf");
    if (imageFiles.length && !canUseImages) {
      return "当前模型不支持图片，请先切换支持图片的模型。";
    }
    if (imageFiles.length + pdfFiles.length !== files.length) {
      return "只支持 PNG、JPEG、WEBP 图片和 PDF。";
    }
    const availableImageSlots = MAX_DRAFT_IMAGES - attachments.length;
    if (availableImageSlots < imageFiles.length) {
      return `每条消息最多上传 ${MAX_DRAFT_IMAGES} 张图片。`;
    }
    const availableDocumentSlots = MAX_DRAFT_DOCUMENTS - documents.length;
    if (availableDocumentSlots < pdfFiles.length) {
      return `每条消息最多上传 ${MAX_DRAFT_DOCUMENTS} 个 PDF。`;
    }
    if (imageFiles.some((file) => file.size > MAX_DRAFT_IMAGE_BYTES)) {
      return "单张图片不能超过 8 MiB。";
    }
    if (pdfFiles.some((file) => file.size > MAX_DRAFT_PDF_BYTES)) {
      return "单个 PDF 不能超过 20 MiB。";
    }
    const currentBytes = attachments.reduce(
      (total, attachment) => total + Math.ceil((attachment.data.length * 3) / 4),
      0,
    );
    const incomingBytes = imageFiles.reduce((total, file) => total + file.size, 0);
    if (currentBytes + incomingBytes > MAX_DRAFT_IMAGE_TOTAL_BYTES) {
      return "每条消息的图片总大小不能超过 16 MiB。";
    }
    return "";
  }

  async function attachFiles(files: File[]) {
    setAttachmentError("");
    const validationError = validateFiles(files);
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }
    try {
      const imageFiles = files.filter((file) =>
        ACCEPTED_DRAFT_IMAGE_TYPES.has(file.type as DraftImageInput["media_type"]),
      );
      const pdfFiles = files.filter((file) => file.type === "application/pdf");
      const nextAttachments = await Promise.all(imageFiles.map(readImageAttachment));
      const nextDocuments = await Promise.all(pdfFiles.map(readDocumentAttachment));
      if (nextAttachments.length) {
        const nextDraft = nextAttachments.reduce(appendMarkdownImage, draft);
        onDraftChange(nextDraft);
      }
      if (nextAttachments.length || nextDocuments.length) {
        setComposerHeight((current) => Math.max(current, 248));
      }
      setAttachments((current) => [...current, ...nextAttachments]);
      setDocuments((current) => [...current, ...nextDocuments]);
    } catch {
      setAttachmentError("附件上传失败，请重新选择。");
    }
  }

  async function selectImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    await attachFiles(files);
    event.target.value = "";
  }

  async function pasteIntoComposer(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length || refining) return;
    event.preventDefault();
    await attachFiles(files);
  }

  function dragFilesOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files") || refining) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function dragFilesEnter(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files") || refining) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function dragFilesLeave(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }

  async function dropFiles(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files") || refining) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) await attachFiles(files);
  }

  return (
    <ResizableSplit
      className="capture-workspace"
      label="调整记录和草稿宽度"
      storageKey="memora.split.capture"
      defaultLeftPercent={54}
      minLeftPx={360}
      minRightPx={340}
      left={
        <section
          className={`conversation-panel ${draggingFiles ? "is-file-dragging" : ""}`}
          aria-label="草稿对话"
          style={{ "--composer-height": `${composerHeight}px` } as CSSProperties}
          onDragEnter={dragFilesEnter}
          onDragLeave={dragFilesLeave}
          onDragOver={dragFilesOver}
          onDrop={(event) => void dropFiles(event)}
        >
          {draggingFiles ? (
            <div className="file-drop-overlay" aria-hidden="true">
              <Upload size={22} strokeWidth={1.7} />
              <span>放下以加入当前消息</span>
            </div>
          ) : null}
          <header className="panel-header">
            <div className="chat-model-title">
              <span>
                <SparkleIcon />
              </span>
              <div>
                <h1>{selectedModelLabel}</h1>
                <small>Memora Markdown Agent</small>
              </div>
            </div>
            <span className="private-status">
              <span className="privacy-dot" />
              {workspace.kind === "TEAM" ? "团队空间 · 默认私有" : "默认私有"}
            </span>
          </header>

          <div className="conversation-scroll">
            <div className="conversation-intro">
              <span className="intro-mark">
                <Logo />
              </span>
              <h2>今天在想什么？</h2>
            </div>
            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article
                  className={`chat-message is-${message.role.toLowerCase()}`}
                  key={message.id}
                >
                  {message.role === "ASSISTANT" ? <Logo /> : null}
                  <div>
                    {message.activity ? (
                      <ActivityTrace
                        trace={message.activity}
                        citations={message.citations}
                        webCitations={message.webCitations}
                        onOpenCitation={onOpenCitation}
                      />
                    ) : null}
                    <p>{message.content}</p>
                    {message.images?.length ? (
                      <div className="message-images" aria-label="消息图片">
                        {message.images.map((image) => (
                          <Image
                            alt={image.name}
                            height={120}
                            key={image.id}
                            src={image.previewUrl}
                            unoptimized
                            width={180}
                          />
                        ))}
                      </div>
                    ) : null}
                    {message.attachments?.length ? (
                      <div className="message-attachments" aria-label="消息附件">
                        {message.attachments.map((attachment) => (
                          <span key={attachment.id}>
                            <LibraryIcon />
                            {attachment.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {message.meta ? <small>{message.meta}</small> : null}
                    {!message.activity && message.citations?.length ? (
                      <div className="chat-citations" aria-label="回答来源">
                        {message.citations.map((citation, index) => (
                          <button
                            type="button"
                            key={citation.memory_id}
                            onClick={() => void onOpenCitation(citation.memory_id)}
                          >
                            <span>来源 {index + 1}</span>
                            <strong>{citation.author.display_name}</strong>
                            <time dateTime={citation.created_at}>
                              {formatDateTime(citation.created_at)}
                            </time>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {!message.activity && message.webCitations?.length ? (
                      <div className="web-citations" aria-label="网页来源">
                        {message.webCitations.map((citation, index) => (
                          <a
                            href={citation.url}
                            key={citation.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>网页 {index + 1}</span>
                            <strong>{citation.title}</strong>
                            <small>{sourceHostname(citation.url)}</small>
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {refining ? (
                <article className="chat-message is-assistant">
                  <Logo />
                  <div className="thinking-indicator" role="status" aria-live="polite">
                    {activity ? <ActivityTrace trace={activity} active /> : null}
                  </div>
                </article>
              ) : null}
              <div ref={messageEndRef} />
            </div>
          </div>

          <ComposerResizeHandle height={composerHeight} onHeightChange={changeComposerHeight} />
          <div className="composer-wrap">
            <form className="composer" onSubmit={submit}>
              {attachments.length || documents.length ? (
                <div className="pending-images" aria-label="待发送附件">
                  {attachments.map((image) => (
                    <div key={image.id}>
                      <Image
                        alt={image.name}
                        height={72}
                        src={image.previewUrl}
                        unoptimized
                        width={96}
                      />
                      <button
                        type="button"
                        aria-label={`移除图片 ${image.name}`}
                        onClick={() =>
                          setAttachments((current) =>
                            current.filter((attachment) => attachment.id !== image.id),
                          )
                        }
                      >
                        <CloseIcon />
                      </button>
                      <span>{image.name}</span>
                    </div>
                  ))}
                  {documents.map((document) => (
                    <div className="pending-document" key={document.id}>
                      <LibraryIcon />
                      <button
                        type="button"
                        aria-label={`移除附件 ${document.name}`}
                        onClick={() =>
                          setDocuments((current) =>
                            current.filter((attachment) => attachment.id !== document.id),
                          )
                        }
                      >
                        <CloseIcon />
                      </button>
                      <span>{document.name}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="composer-tools">
                {modelOptions.length ? (
                  <label className="model-control">
                    <SparkleIcon />
                    <select
                      aria-label="模型"
                      value={selectedModelId ?? ""}
                      onChange={(event) => changeModel(event.target.value || null)}
                      disabled={refining}
                    >
                      {modelOptions.map((model) => (
                        <option value={model.id} key={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="model-unavailable">AI 未配置</span>
                )}
                <label className={`search-mode-control is-${webSearchMode.toLowerCase()}`}>
                  <GlobeIcon />
                  <select
                    aria-label="联网模式"
                    value={webSearchMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as WebSearchMode;
                      if (nextMode !== "DISABLED" && !canUseWeb) {
                        setAttachmentError("当前模型不支持联网，请切换模型或关闭联网。");
                        setWebSearchMode("DISABLED");
                        return;
                      }
                      setAttachmentError("");
                      setWebSearchMode(nextMode);
                    }}
                    disabled={refining || !canUseWeb}
                  >
                    <option value="AUTO">自动联网</option>
                    <option value="REQUIRED">本轮联网</option>
                    <option value="DISABLED">关闭联网</option>
                  </select>
                </label>
                <span>
                  {!canUseWeb
                    ? "当前模型不支持联网"
                    : webSearchMode === "AUTO"
                      ? "需要最新信息时自动搜索"
                      : webSearchMode === "REQUIRED"
                        ? "发送后恢复自动"
                        : "只使用对话与个人记忆"}
                </span>
              </div>
              <div className="composer-row">
                <input
                  ref={imageInputRef}
                  className="image-input"
                  type="file"
                  accept={Array.from(ACCEPTED_ASSET_TYPES).join(",")}
                  multiple
                  aria-label="选择图片或 PDF"
                  onChange={(event) => void selectImages(event)}
                  disabled={
                    refining ||
                    (attachments.length >= MAX_DRAFT_IMAGES &&
                      documents.length >= MAX_DRAFT_DOCUMENTS)
                  }
                />
                <button
                  className="attach-button"
                  type="button"
                  aria-label="上传图片或 PDF"
                  title="上传图片或 PDF"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={
                    refining ||
                    (attachments.length >= MAX_DRAFT_IMAGES &&
                      documents.length >= MAX_DRAFT_DOCUMENTS)
                  }
                >
                  <AttachmentIcon />
                </button>
                <textarea
                  ref={composerRef}
                  aria-label="告诉 Memora 你的想法"
                  placeholder={draft ? "继续说，或告诉我怎样修改草稿…" : "输入想法或上传图片…"}
                  rows={1}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={composerKeyDown}
                  onPaste={(event) => void pasteIntoComposer(event)}
                  disabled={refining}
                />
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送"
                  disabled={
                    (!instruction.trim() && attachments.length === 0 && documents.length === 0) ||
                    refining
                  }
                >
                  <SendIcon />
                </button>
              </div>
            </form>
            {attachmentError ? (
              <p className="attachment-error" role="alert">
                {attachmentError}
              </p>
            ) : null}
          </div>
        </section>
      }
      right={
        <section className="markdown-panel" aria-label="Markdown 草稿编辑器">
          <header className="markdown-header">
            <div>
              <p className="eyebrow">草稿</p>
              <h2>草稿</h2>
            </div>
            <div className="draft-header-actions">
              <PreviewToggle
                visible={draftPreviewVisible}
                onToggle={() => setDraftPreviewVisible((visible) => !visible)}
              />
              {draft ? (
                <button className="text-button" type="button" onClick={onReset}>
                  新想法
                </button>
              ) : null}
              <span className={isSaved ? "save-state is-saved" : "save-state"}>
                {isSaved ? "已保存" : "未保存"}
              </span>
            </div>
          </header>
          <MarkdownWorkspace
            value={draft}
            onChange={onDraftChange}
            ariaLabel="Markdown 草稿"
            placeholder={"# 想法标题\n\n你的 Markdown 草稿会出现在这里。"}
            previewVisible={draftPreviewVisible}
          />
          <footer className="draft-footer">
            <div>
              <span>{draft.length.toLocaleString("zh-CN")} 字符</span>
              <small>{draftPreviewVisible ? "Markdown · 实时预览" : "Markdown · 专注编辑"}</small>
            </div>
            {workspace.kind === "TEAM" ? (
              <div className="memory-visibility-control" role="group" aria-label="保存可见范围">
                <button
                  type="button"
                  className={saveVisibility === "PRIVATE" ? "is-active" : ""}
                  aria-pressed={saveVisibility === "PRIVATE"}
                  onClick={() => onSaveVisibilityChange("PRIVATE")}
                >
                  <LockKeyhole aria-hidden="true" size={14} strokeWidth={1.8} />
                  仅自己
                </button>
                <button
                  type="button"
                  className={saveVisibility === "WORKSPACE" ? "is-active" : ""}
                  aria-pressed={saveVisibility === "WORKSPACE"}
                  onClick={() => onSaveVisibilityChange("WORKSPACE")}
                >
                  <Users aria-hidden="true" size={14} strokeWidth={1.8} />
                  团队共享
                </button>
              </div>
            ) : null}
            <button
              className="primary-action"
              type="button"
              disabled={!normalizedDraft || saving || isSaved}
              onClick={() => void onSave()}
            >
              {saving
                ? "正在保存…"
                : isSaved
                  ? "已保存"
                  : saveVisibility === "WORKSPACE"
                    ? "保存为团队记忆"
                    : "保存为我的记忆"}
            </button>
          </footer>
        </section>
      }
    />
  );
}

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
          {workspace.kind === "TEAM" ? (
            <label>
              <span>团队成员</span>
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

function Timeline({
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
      aria-label={workspace.kind === "TEAM" ? "团队记忆时间线" : "个人记忆时间线"}
    >
      <header className="library-list-header">
        <div>
          <p className="eyebrow">{workspace.kind === "TEAM" ? workspace.name : "个人记忆"}</p>
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

function MemoryDetail({
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
          {memory.is_owner && workspace.kind === "TEAM" ? (
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
                  : "共享给团队"}
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

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [view, setView] = useState<AppView>("CAPTURE");
  const [viewMotion, setViewMotion] = useState<"forward" | "back">("forward");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [teamAccessMode, setTeamAccessMode] = useState<TeamAccessMode | null>(null);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [memorySearchFilters, setMemorySearchFilters] =
    useState<MemorySearchFilters>(EMPTY_MEMORY_SEARCH);
  const [memorySearchActive, setMemorySearchActive] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryMarkdown, setMemoryMarkdown] = useState("");
  const [memoryBaseline, setMemoryBaseline] = useState("");
  const [revisions, setRevisions] = useState<Memory[]>([]);

  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [saveVisibility, setSaveVisibility] = useState<MemoryVisibility>("PRIVATE");
  const [savedVisibility, setSavedVisibility] = useState<MemoryVisibility | null>(null);
  const [messages, setMessages] = useState<DraftMessage[]>([initialMessage]);
  const [refiningDraft, setRefiningDraft] = useState(false);
  const [draftActivity, setDraftActivity] = useState<DraftTrace | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [modelOptions, setModelOptions] = useState<DraftModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const [refiningMemory, setRefiningMemory] = useState(false);
  const [savingMode, setSavingMode] = useState<RevisionMode | null>(null);
  const [deletingMemory, setDeletingMemory] = useState(false);
  const [visibilityChanging, setVisibilityChanging] = useState(false);
  const [memoryAiStatus, setMemoryAiStatus] = useState("");
  const [toast, setToast] = useState("");
  const [toastLeaving, setToastLeaving] = useState(false);
  const toastTimers = useRef<number[]>([]);

  const showToast = useCallback((message: string) => {
    toastTimers.current.forEach(window.clearTimeout);
    toastTimers.current = [];
    setToastLeaving(false);
    setToast(message);
    // Start the exit animation first, then unmount once it has played.
    toastTimers.current.push(window.setTimeout(() => setToastLeaving(true), 3200));
    toastTimers.current.push(
      window.setTimeout(() => {
        setToast("");
        setToastLeaving(false);
      }, 3400),
    );
  }, []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  function navigateTo(nextView: AppView) {
    if (nextView !== view) {
      setViewMotion(nextView === "LIBRARY" ? "forward" : "back");
      setView(nextView);
    }
    setSidebarOpen(false);
  }

  function updateCurrentUser(updatedUser: CurrentUser) {
    setUser(updatedUser);
    const updateAuthor = (memory: Memory) =>
      memory.author.id === updatedUser.id
        ? {
            ...memory,
            author: { ...memory.author, display_name: updatedUser.display_name },
          }
        : memory;
    setMemories((current) => current.map(updateAuthor));
    setSelectedMemory((current) => (current ? updateAuthor(current) : current));
    setRevisions((current) => current.map(updateAuthor));
  }

  useEffect(() => {
    const timers = toastTimers;
    return () => {
      timers.current.forEach(window.clearTimeout);
    };
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const stored = readStoredBoolean("memora.sidebar.collapsed");
      if (stored !== null) setSidebarCollapsed(stored);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const loadMemories = useCallback(async (userId: string, workspaceKind: Workspace["kind"]) => {
    setLoadingMemories(true);
    try {
      const { data, response } =
        workspaceKind === "PERSONAL"
          ? await api.GET("/memories", {
              params: {
                query: {
                  author_id: userId,
                  visibility: "PRIVATE",
                  limit: 200,
                },
              },
            })
          : await api.GET("/memories", {
              params: {
                query: {
                  limit: 200,
                },
              },
            });
      if (!data || !response.ok) {
        throw new Error("memory_list_failed");
      }
      setMemories(data);
      return data;
    } finally {
      setLoadingMemories(false);
    }
  }, []);

  const loadWorkspaceMembers = useCallback(async (workspaceKind: Workspace["kind"]) => {
    if (workspaceKind !== "TEAM") {
      setMembers([]);
      return [];
    }
    setLoadingMembers(true);
    try {
      const { data, response } = await api.GET("/workspace/members");
      if (!data || !response.ok) {
        throw new Error("workspace_members_failed");
      }
      setMembers(data);
      return data;
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const enterPersonalSpace = useCallback(
    async (authenticatedUser: CurrentUser, preferPersonal = false) => {
      setBooting(true);
      setSessionError("");
      try {
        const workspaceResult = await api.GET("/workspaces");
        if (!workspaceResult.data || !workspaceResult.response.ok) {
          throw new Error("workspace_list_failed");
        }
        const personal = workspaceResult.data.find(
          (workspace: Workspace) => workspace.kind === "PERSONAL",
        );
        const current = workspaceResult.data.find((workspace: Workspace) => workspace.is_current);
        const target = (preferPersonal ? personal : current) ?? personal ?? workspaceResult.data[0];
        if (!target) {
          throw new Error("workspace_missing");
        }

        let resolvedUser = authenticatedUser;
        if (!target.is_current) {
          const activation = await api.POST("/workspaces/{workspace_id}/activate", {
            params: { path: { workspace_id: target.id } },
          });
          if (!activation.data || !activation.response.ok) {
            throw new Error("workspace_activation_failed");
          }
          const refreshed = await api.GET("/auth/me");
          if (!refreshed.data || !refreshed.response.ok) {
            throw new Error("session_refresh_failed");
          }
          resolvedUser = refreshed.data;
        }

        const resolvedWorkspaces = workspaceResult.data.map((workspace: Workspace) => ({
          ...workspace,
          is_current: workspace.id === target.id,
        }));
        const resolvedWorkspace = resolvedWorkspaces.find(
          (workspace: Workspace) => workspace.id === target.id,
        );
        if (!resolvedWorkspace) throw new Error("workspace_missing_after_activation");

        setUser(resolvedUser);
        setWorkspaces(resolvedWorkspaces);
        setActiveWorkspace(resolvedWorkspace);
        setSessionError("");
        setView("CAPTURE");
        setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
        setMemorySearchActive(false);
        setSaveVisibility("PRIVATE");
        setSavedVisibility(null);
        const modelResult = await api.GET("/drafts/models");
        if (modelResult.data && modelResult.response.ok) {
          setModelOptions(modelResult.data);
          setSelectedModelId(
            modelResult.data.find((model: DraftModel) => model.is_default)?.id ??
              modelResult.data[0]?.id ??
              null,
          );
        } else {
          setModelOptions([]);
          setSelectedModelId(null);
        }
        await loadMemories(resolvedUser.id, resolvedWorkspace.kind);
        await loadWorkspaceMembers(resolvedWorkspace.kind);
      } catch {
        setSessionError("无法进入工作空间，请刷新后重试。");
        setUser(null);
        setWorkspaces([]);
        setActiveWorkspace(null);
        setMembers([]);
        setModelOptions([]);
        setSelectedModelId(null);
      } finally {
        setBooting(false);
      }
    },
    [loadMemories, loadWorkspaceMembers],
  );

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const { data, response } = await api.GET("/auth/me");
        if (!active) return;
        if (!data || !response.ok) {
          setBooting(false);
          return;
        }
        await enterPersonalSpace(data, false);
      } catch {
        if (active) setBooting(false);
      }
    }
    void bootstrap();
    return () => {
      active = false;
    };
  }, [enterPersonalSpace]);

  useEffect(() => {
    if (view === "LIBRARY" && !selectedMemory && memories[0]) {
      void selectMemory(memories[0]);
    }
  }, [view, memories, selectedMemory]);

  async function selectMemory(memory: Memory) {
    setSelectedMemory(memory);
    setMemoryMarkdown(memory.body);
    setMemoryBaseline(memory.body);
    setMemoryAiStatus("");
    const { data, response } = await api.GET("/memories/{memory_id}/revisions", {
      params: { path: { memory_id: memory.id } },
    });
    setRevisions(data && response.ok ? data : [memory]);
  }

  function workspaceChangeIsBlocked() {
    if (savingDraft || refiningDraft) {
      showToast("请等待当前操作完成后再切换空间");
      return true;
    }
    if (draft.trim() && draft.trim() !== savedBody) {
      showToast("当前草稿尚未保存，请先保存或点击“新想法”清空草稿");
      return true;
    }
    return false;
  }

  async function switchWorkspace(workspace: Workspace, alreadyActive = false) {
    if (workspace.id === activeWorkspace?.id && !alreadyActive) return true;
    if (workspaceChangeIsBlocked()) return false;
    setWorkspaceBusy(true);
    try {
      if (!alreadyActive) {
        const activation = await api.POST("/workspaces/{workspace_id}/activate", {
          params: { path: { workspace_id: workspace.id } },
        });
        if (!activation.data || !activation.response.ok) {
          throw new Error("workspace_activation_failed");
        }
      }
      const [userResult, workspaceResult] = await Promise.all([
        api.GET("/auth/me"),
        api.GET("/workspaces"),
      ]);
      if (
        !userResult.data ||
        !userResult.response.ok ||
        !workspaceResult.data ||
        !workspaceResult.response.ok
      ) {
        throw new Error("workspace_refresh_failed");
      }
      const resolvedWorkspace = workspaceResult.data.find(
        (item: Workspace) => item.id === workspace.id,
      );
      if (!resolvedWorkspace) throw new Error("workspace_membership_missing");

      setUser(userResult.data);
      setWorkspaces(workspaceResult.data);
      setActiveWorkspace(resolvedWorkspace);
      setSelectedMemory(null);
      setMemoryMarkdown("");
      setMemoryBaseline("");
      setRevisions([]);
      setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
      setMemorySearchActive(false);
      resetDraft();
      setView(resolvedWorkspace.kind === "TEAM" ? "TEAM" : "CAPTURE");
      setViewMotion("forward");
      setSidebarOpen(false);
      await loadMemories(userResult.data.id, resolvedWorkspace.kind);
      await loadWorkspaceMembers(resolvedWorkspace.kind);
      showToast(`已进入 ${resolvedWorkspace.name}`);
      return true;
    } catch {
      showToast("切换空间失败，请稍后重试");
      return false;
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function openTeamAccess(mode: TeamAccessMode) {
    if (workspaceChangeIsBlocked()) return;
    setSidebarOpen(false);
    setTeamAccessMode(mode);
  }

  async function finishTeamAccess(workspace: Workspace, alreadyActive: boolean) {
    const switched = await switchWorkspace(workspace, alreadyActive);
    if (!switched) throw new Error("无法进入团队，请稍后重试");
  }

  function addInvitedMember(member: WorkspaceMember) {
    setMembers((current) =>
      [...current.filter((item) => item.id !== member.id), member].sort((left, right) =>
        left.display_name.localeCompare(right.display_name, "zh-CN"),
      ),
    );
  }

  function removeMemberFromDirectory(memberId: string) {
    setMembers((current) => current.filter((member) => member.id !== memberId));
  }

  async function searchMemoryLibrary() {
    if (!user || !activeWorkspace) return;
    const { query, field, from, to, authorId } = memorySearchFilters;
    if (from && to && from > to) {
      showToast("结束日期不能早于开始日期");
      return;
    }
    const createdFrom = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
    let createdTo: string | undefined;
    if (to) {
      const nextDay = new Date(`${to}T00:00:00`);
      nextDay.setDate(nextDay.getDate() + 1);
      createdTo = nextDay.toISOString();
    }
    setLoadingMemories(true);
    try {
      const { data, response } = await api.POST("/search", {
        body: {
          q: query.trim(),
          mode: "KEYWORD",
          field,
          limit: 200,
          ...(createdFrom ? { created_from: createdFrom } : {}),
          ...(createdTo ? { created_to: createdTo } : {}),
          ...(activeWorkspace.kind === "TEAM" && authorId
            ? { author_id: authorId }
            : activeWorkspace.kind === "PERSONAL"
              ? { author_id: user.id }
              : {}),
        },
      });
      if (!data || !response.ok) throw new Error("memory_search_failed");
      setSelectedMemory(null);
      setMemoryMarkdown("");
      setMemoryBaseline("");
      setRevisions([]);
      setMemories(data.results.map((result) => result.memory));
      setMemorySearchActive(true);
    } catch {
      showToast("检索失败，请稍后重试");
    } finally {
      setLoadingMemories(false);
    }
  }

  async function resetMemorySearch() {
    if (!user || !activeWorkspace) return;
    setMemorySearchFilters(EMPTY_MEMORY_SEARCH);
    setMemorySearchActive(false);
    setSelectedMemory(null);
    setMemoryMarkdown("");
    setMemoryBaseline("");
    setRevisions([]);
    try {
      await loadMemories(user.id, activeWorkspace.kind);
    } catch {
      showToast("重新读取记忆失败，请稍后重试");
    }
  }

  async function refineCapture(
    instruction: string,
    images: DraftImageAttachment[],
    documents: DraftDocumentAttachment[],
    webSearch: WebSearchMode,
    modelId: string | null,
  ) {
    const requestedWebSearch = willSearchWeb(instruction, webSearch);
    const modelLabel = selectedDraftModelLabel(modelOptions, modelId);
    let liveTrace = buildLiveTrace({
      modelLabel,
      images,
      documents,
    });
    const userMessage: DraftMessage = {
      id: nextId("user"),
      role: "USER",
      content: instruction,
      images: images.map(({ id, name, previewUrl }) => ({ id, name, previewUrl })),
      attachments: documents.map(({ id, name, mediaType }) => ({ id, name, mediaType })),
    };
    const priorConversation = messages
      .filter((message) => message.id !== "welcome")
      .slice(-23)
      .map((message) => ({ role: message.role, content: message.content }));
    const currentTurn = images.length
      ? {
          role: userMessage.role,
          content: userMessage.content,
          images: images.map(({ name, media_type, data }) => ({ name, media_type, data })),
          attachments: [...images, ...documents].map((attachment) => ({
            asset_id: attachment.assetId,
          })),
        }
      : {
          role: userMessage.role,
          content: userMessage.content,
          ...(documents.length
            ? {
                attachments: documents.map((attachment) => ({
                  asset_id: attachment.assetId,
                })),
              }
            : {}),
        };
    const conversation = [...priorConversation, currentTurn];
    setMessages((current) => [...current, userMessage]);
    setDraftActivity(liveTrace);
    setRefiningDraft(true);
    try {
      const data = await streamDraftChat(
        {
          markdown: draft,
          messages: conversation,
          web_search: webSearch,
          ...(modelId ? { model_id: modelId } : {}),
        },
        (event) => {
          if (event.type === "progress") {
            liveTrace = {
              ...liveTrace,
              duration_ms: Math.max(liveTrace.duration_ms, event.step.elapsed_ms),
              steps: upsertTraceStep(liveTrace.steps, event.step),
            };
            setDraftActivity(liveTrace);
          } else if (event.type === "result" && event.response.trace) {
            liveTrace = event.response.trace;
            setDraftActivity(liveTrace);
          } else if (event.type === "error") {
            liveTrace = event.trace;
            setDraftActivity(liveTrace);
          }
        },
      );
      setDraft(data.markdown);
      const savedMemory = data.saved_memory;
      if (savedMemory) {
        setSavedBody(savedMemory.body);
        setSavedVisibility(savedMemory.visibility);
        setSaveVisibility(savedMemory.visibility);
        setMemories((current) => [
          savedMemory,
          ...current.filter((memory) => memory.id !== savedMemory.id),
        ]);
      }
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: data.assistant_message,
          meta: savedMemory
            ? savedMemory.visibility === "WORKSPACE"
              ? "已自动保存为团队共享记忆"
              : "已自动保存为我的记忆"
            : data.tool_events?.find((event) => event.name === "save_memory")?.status === "REJECTED"
              ? "保存工具已拒绝 · 需要明确保存指令"
              : data.web_search_status === "AVAILABLE"
                ? data.draft_changed
                  ? `已联网 · ${data.web_citations.length} 个来源 · Markdown 已同步`
                  : `已联网 · ${data.web_citations.length} 个来源 · Markdown 未改变`
                : data.web_search_status === "DEGRADED"
                  ? "联网失败 · 草稿已安全保留"
                  : data.web_search_status === "DISABLED" && webSearch !== "DISABLED"
                    ? "联网能力未启用 · 草稿已安全保留"
                    : data.model_status === "AVAILABLE"
                      ? data.draft_changed
                        ? "右侧 Markdown 已同步"
                        : data.citations.length
                          ? `引用 ${data.citations.length} 条个人记忆`
                          : "已回答，Markdown 未改变"
                      : data.model_status === "DISABLED"
                        ? "基础草稿模式"
                        : "草稿已安全保留",
          citations: data.citations,
          webCitations: data.web_citations,
          activity: buildCompletedTrace({
            modelLabel,
            images,
            documents,
            requestedWebSearch,
            response: data,
          }),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: "这次没有整理成功，右侧草稿保持不变。请稍后再试。",
          activity: buildFailedTrace({
            modelLabel,
            trace: liveTrace,
          }),
        },
      ]);
    } finally {
      setRefiningDraft(false);
      setDraftActivity(null);
    }
  }

  async function saveDraft() {
    if (!draft.trim() || savingDraft || !activeWorkspace) return;
    const requestedVisibility =
      activeWorkspace.kind === "TEAM" ? saveVisibility : ("PRIVATE" as const);
    setSavingDraft(true);
    try {
      const { data, response } = await api.POST("/memories", {
        body: { body: draft, visibility: requestedVisibility },
      });
      if (!data || !response.ok) throw new Error("memory_create_failed");
      setDraft(data.body);
      setSavedBody(data.body);
      setSavedVisibility(data.visibility);
      setSaveVisibility(data.visibility);
      setMemories((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content:
            data.visibility === "WORKSPACE"
              ? `已共享到 ${activeWorkspace.name} 的团队记忆库。`
              : "已保存为仅自己可见的记忆。",
          meta: formatDateTime(data.created_at),
        },
      ]);
      showToast(data.visibility === "WORKSPACE" ? "已保存为团队共享记忆" : "已保存为私人记忆");
    } catch {
      showToast("保存失败，请稍后重试");
    } finally {
      setSavingDraft(false);
    }
  }

  function resetDraft() {
    setDraft("");
    setSavedBody(null);
    setSaveVisibility("PRIVATE");
    setSavedVisibility(null);
    setMessages([initialMessage]);
  }

  async function openCitation(memoryId: string) {
    let resolved = memories.find((memory) => memory.id === memoryId);
    if (!resolved) {
      const { data, response } = await api.GET("/memories/{memory_id}", {
        params: { path: { memory_id: memoryId } },
      });
      if (!data || !response.ok) {
        showToast("这条来源当前不可访问");
        return;
      }
      resolved = data;
      setMemories((current) => [data, ...current.filter((memory) => memory.id !== data.id)]);
    }
    navigateTo("LIBRARY");
    await selectMemory(resolved);
  }

  async function refineSelectedMemory(instruction: string) {
    if (!selectedMemory) return;
    setRefiningMemory(true);
    setMemoryAiStatus("");
    try {
      const { data, response } = await api.POST("/drafts/refine", {
        body: { markdown: memoryMarkdown, instruction },
      });
      if (!data || !response.ok) throw new Error("memory_refine_failed");
      setMemoryMarkdown(data.markdown);
      setMemoryAiStatus(data.assistant_message);
    } catch {
      setMemoryAiStatus("AI 修改失败，当前内容没有丢失。");
    } finally {
      setRefiningMemory(false);
    }
  }

  async function saveRevision(mode: RevisionMode) {
    if (!selectedMemory || !memoryMarkdown.trim() || savingMode) return;
    setSavingMode(mode);
    try {
      const { data, response } = await api.POST("/memories/{memory_id}/revisions", {
        params: { path: { memory_id: selectedMemory.id } },
        body: { body: memoryMarkdown, mode },
      });
      if (!data || !response.ok) {
        if (response.status === 409 && user && activeWorkspace) {
          await loadMemories(user.id, activeWorkspace.kind);
          throw new Error("stale_memory");
        }
        throw new Error("revision_failed");
      }
      if (user && activeWorkspace) await loadMemories(user.id, activeWorkspace.kind);
      await selectMemory(data);
      showToast(mode === "UPDATE_CURRENT" ? "已更新当前记忆，旧内容已保留" : "已保存为新版本");
    } catch (error) {
      showToast(
        error instanceof Error && error.message === "stale_memory"
          ? "这条记忆已有更新，请重新选择"
          : "保存修改失败，请稍后重试",
      );
    } finally {
      setSavingMode(null);
    }
  }

  async function changeSelectedVisibility(visibility: MemoryVisibility) {
    if (!selectedMemory?.is_owner || !activeWorkspace || visibilityChanging) return;
    setVisibilityChanging(true);
    try {
      const result =
        visibility === "WORKSPACE"
          ? await api.POST("/memories/{memory_id}/share", {
              params: { path: { memory_id: selectedMemory.id } },
            })
          : await api.POST("/memories/{memory_id}/unshare", {
              params: { path: { memory_id: selectedMemory.id } },
            });
      if (!result.data || !result.response.ok) throw new Error("visibility_update_failed");
      setSelectedMemory(result.data);
      setMemories((current) =>
        current.map((memory) => (memory.id === result.data?.id ? result.data : memory)),
      );
      showToast(visibility === "WORKSPACE" ? "已共享给团队" : "已撤回为仅自己可见");
    } catch {
      showToast("可见范围更新失败，请稍后重试");
    } finally {
      setVisibilityChanging(false);
    }
  }

  async function deleteSelectedMemory() {
    if (!selectedMemory || deletingMemory) return;
    setDeletingMemory(true);
    try {
      const { response } = await api.DELETE("/memories/{memory_id}", {
        params: { path: { memory_id: selectedMemory.id } },
      });
      if (!response.ok) throw new Error("delete_failed");
      const remaining = memories.filter(
        (item) => item.timeline_entry_id !== selectedMemory.timeline_entry_id,
      );
      setMemories(remaining);
      setSelectedMemory(null);
      setMemoryMarkdown("");
      setMemoryBaseline("");
      setRevisions([]);
      if (remaining[0]) await selectMemory(remaining[0]);
      showToast("记忆已删除");
    } catch {
      showToast("删除失败，请稍后重试");
    } finally {
      setDeletingMemory(false);
    }
  }

  async function logout() {
    await api.POST("/auth/logout");
    setSettingsOpen(false);
    setTeamAccessMode(null);
    setUser(null);
    setWorkspaces([]);
    setActiveWorkspace(null);
    setMembers([]);
    setMemories([]);
    setModelOptions([]);
    setSelectedModelId(null);
    setSelectedMemory(null);
    resetDraft();
  }

  async function retryPersonalSpace() {
    setBooting(true);
    try {
      const { data, response } = await api.GET("/auth/me");
      if (!data || !response.ok) throw new Error("session_missing");
      await enterPersonalSpace(data, false);
    } catch {
      setBooting(false);
      setSessionError("无法进入工作空间，请刷新后重试。");
    }
  }

  if (booting) {
    return (
      <main className="boot-screen" aria-label="正在加载 Memora">
        <Logo />
        <span />
      </main>
    );
  }

  if (!user && sessionError) {
    return (
      <main className="session-failure" aria-labelledby="session-failure-title">
        <Logo />
        <h1 id="session-failure-title">暂时无法进入工作空间</h1>
        <p>为了避免把记忆写入错误的个人或团队空间，Memora 已停止当前操作。</p>
        <button type="button" onClick={() => void retryPersonalSpace()}>
          重新尝试
        </button>
      </main>
    );
  }

  if (!user) {
    return (
      <PublicLanding
        onAuthenticated={(authenticatedUser) => void enterPersonalSpace(authenticatedUser, true)}
      />
    );
  }

  if (!activeWorkspace) {
    return (
      <main className="boot-screen" aria-label="正在读取工作空间">
        <Logo />
        <span />
      </main>
    );
  }

  const mobileTitle = view === "CAPTURE" ? "记录想法" : view === "LIBRARY" ? "记忆库" : "团队";

  return (
    <main className={`app-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <Sidebar
        user={user}
        workspaces={workspaces}
        activeWorkspace={activeWorkspace}
        workspaceBusy={workspaceBusy}
        view={view}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        onView={navigateTo}
        onWorkspaceSelect={(workspace) => void switchWorkspace(workspace)}
        onTeamAccess={openTeamAccess}
        onClose={() => setSidebarOpen(false)}
        onCollapse={() => {
          setSidebarCollapsed(true);
          storeBoolean("memora.sidebar.collapsed", true);
        }}
        onExpand={() => {
          setSidebarCollapsed(false);
          storeBoolean("memora.sidebar.collapsed", false);
        }}
        onOpenSettings={() => {
          setSidebarOpen(false);
          openSettings();
        }}
        onLogout={() => void logout()}
      />
      <section className="app-main">
        <header className="mobile-header">
          <button type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>
            <MenuIcon />
          </button>
          <div>
            <Logo />
            <strong>{mobileTitle}</strong>
          </div>
          <button
            className="mobile-account-button"
            type="button"
            aria-label="打开移动端个人设置"
            onClick={openSettings}
          >
            <UserAvatar user={user} />
          </button>
        </header>

        {sessionError ? (
          <div className="session-error" role="alert">
            {sessionError}
          </div>
        ) : null}

        {view === "CAPTURE" ? (
          <div className={`view-transition is-${viewMotion}`} key={`capture-${activeWorkspace.id}`}>
            <CaptureWorkspace
              workspace={activeWorkspace}
              draft={draft}
              messages={messages}
              refining={refiningDraft}
              activity={draftActivity}
              saving={savingDraft}
              savedBody={savedBody}
              saveVisibility={saveVisibility}
              savedVisibility={savedVisibility}
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              onDraftChange={setDraft}
              onRefine={refineCapture}
              onSave={saveDraft}
              onSaveVisibilityChange={setSaveVisibility}
              onReset={resetDraft}
              onModelChange={setSelectedModelId}
              onOpenCitation={openCitation}
            />
          </div>
        ) : view === "LIBRARY" ? (
          <ResizableSplit
            className={`library-workspace view-transition is-${viewMotion}`}
            key="library"
            label="调整记忆列表和详情宽度"
            storageKey="memora.split.library"
            defaultLeftPercent={34}
            minLeftPx={260}
            minRightPx={360}
            left={
              <Timeline
                workspace={activeWorkspace}
                members={members}
                memories={memories}
                selectedId={selectedMemory?.id ?? null}
                loading={loadingMemories}
                searchFilters={memorySearchFilters}
                searchActive={memorySearchActive}
                onSearchFiltersChange={setMemorySearchFilters}
                onSearch={() => void searchMemoryLibrary()}
                onResetSearch={() => void resetMemorySearch()}
                onSelect={(memory) => void selectMemory(memory)}
              />
            }
            right={
              <MemoryDetail
                key={selectedMemory?.id ?? "empty-memory"}
                workspace={activeWorkspace}
                memory={selectedMemory}
                markdown={memoryMarkdown}
                baseline={memoryBaseline}
                revisions={revisions}
                refining={refiningMemory}
                savingMode={savingMode}
                deleting={deletingMemory}
                visibilityChanging={visibilityChanging}
                aiStatus={memoryAiStatus}
                onMarkdownChange={setMemoryMarkdown}
                onRefine={refineSelectedMemory}
                onSaveRevision={saveRevision}
                onVisibilityChange={changeSelectedVisibility}
                onDelete={deleteSelectedMemory}
              />
            }
          />
        ) : (
          <div className={`view-transition is-${viewMotion}`} key={`team-${activeWorkspace.id}`}>
            <TeamWorkspace
              workspace={activeWorkspace}
              members={members}
              loading={loadingMembers}
              onMemberInvited={addInvitedMember}
              onMemberRemoved={removeMemberFromDirectory}
              onNotify={showToast}
            />
          </div>
        )}
      </section>
      {settingsOpen ? (
        <AccountSettingsDialog
          user={user}
          onClose={closeSettings}
          onUserChange={updateCurrentUser}
          onNotify={showToast}
        />
      ) : null}
      {teamAccessMode ? (
        <TeamAccessDialog
          initialMode={teamAccessMode}
          onClose={() => setTeamAccessMode(null)}
          onWorkspaceReady={finishTeamAccess}
        />
      ) : null}
      {toast ? (
        <div className={toastLeaving ? "toast is-leaving" : "toast"} role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
