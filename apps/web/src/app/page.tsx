"use client";

import type { components } from "@memora/api-contract";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
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

import { api } from "@/lib/api";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type Workspace = components["schemas"]["WorkspaceResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type EvidenceCitation = components["schemas"]["EvidenceCitationResponse"];
type WebCitation = components["schemas"]["WebCitationResponse"];
type DraftModel = components["schemas"]["DraftModelResponse"];
type DraftImageInput = components["schemas"]["DraftImageInput"];
type Asset = components["schemas"]["AssetResponse"];
type AssetMediaType = components["schemas"]["CreateAssetRequest"]["media_type"];
type WebSearchMode = components["schemas"]["DraftChatRequest"]["web_search"];
type RevisionMode = components["schemas"]["CreateMemoryRevisionRequest"]["mode"];
type AppView = "CAPTURE" | "LIBRARY";

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

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const { data, response } = await api.POST("/auth/login", {
        body: { email, password },
      });
      if (!data || !response.ok) {
        setError(response.status === 429 ? "尝试次数过多，请稍后再试。" : "邮箱或密码错误。");
        return;
      }
      onLogin(data);
    } catch {
      setError("暂时无法连接 Memora，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <Logo />
          <span>Memora</span>
        </div>
        <div className="login-copy">
          <p className="overline">私人记忆</p>
          <h1 id="login-title">把想法留下来</h1>
          <p>和 Memora 对话，把零散想法整理成属于你的 Markdown 记忆。</p>
        </div>
        <form className="login-form" onSubmit={submit}>
          <label htmlFor="email">邮箱</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="login-submit" type="submit" disabled={submitting}>
            {submitting ? "正在登录…" : "继续"}
          </button>
        </form>
        <details className="demo-accounts">
          <summary>选择本地测试账号</summary>
          <div className="demo-account-list">
            {demoAccounts.map((account) => (
              <button key={account.email} type="button" onClick={() => setEmail(account.email)}>
                <span>{account.name}</span>
                <small>{account.email}</small>
              </button>
            ))}
          </div>
        </details>
        <p className="login-footnote">默认私有 · 手动保存 · 历史可追溯</p>
      </section>
    </main>
  );
}

function Sidebar({
  user,
  view,
  open,
  onView,
  onClose,
  onLogout,
}: {
  user: CurrentUser;
  view: AppView;
  open: boolean;
  onView: (view: AppView) => void;
  onClose: () => void;
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
      <aside className={`app-sidebar ${open ? "is-open" : ""}`} aria-label="Memora 导航">
        <div className="sidebar-brand">
          <Logo />
          <span>Memora</span>
          <button className="mobile-close" type="button" aria-label="关闭导航" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

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
        </nav>

        <div className="sidebar-note">
          <span className="privacy-dot" />
          <div>
            <strong>个人空间</strong>
            <small>所有新记忆仅你可见</small>
          </div>
        </div>

        <div className="sidebar-account">
          <span className="avatar">{user.display_name.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{user.display_name}</strong>
            <small>{user.email}</small>
          </div>
          <button type="button" onClick={onLogout}>
            退出
          </button>
        </div>
      </aside>
    </>
  );
}

function ResizableSplit({
  className,
  label,
  defaultLeftPercent,
  minLeftPx,
  minRightPx,
  left,
  right,
}: {
  className: string;
  label: string;
  defaultLeftPercent: number;
  minLeftPx: number;
  minRightPx: number;
  left: ReactNode;
  right: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
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
    setLeftPercent(percentFromClientX(event.clientX));

    const resize = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      setLeftPercent(percentFromClientX(moveEvent.clientX));
    };
    const stopResize = () => {
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
      setLeftPercent((current) => clampSplitPercent(current - step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setLeftPercent((current) => clampSplitPercent(current + step));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const width =
        containerRef.current?.getBoundingClientRect().width ??
        minLeftPx + minRightPx + SPLIT_GUTTER_PX;
      const { min, max } = splitBounds(width, minLeftPx, minRightPx);
      setLeftPercent(event.key === "Home" ? min : max);
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
        onPointerDown={startResize}
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
      onPointerDown={startResize}
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
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  previewVisible: boolean;
  className?: string;
  editorClassName?: string;
}) {
  const editor = (
    <textarea
      className={`markdown-editor ${editorClassName}`}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
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
      defaultLeftPercent={52}
      minLeftPx={160}
      minRightPx={170}
      left={editor}
      right={<MarkdownPreview value={value} />}
    />
  );
}

function CaptureWorkspace({
  draft,
  messages,
  refining,
  searching,
  saving,
  savedBody,
  modelOptions,
  selectedModelId,
  onDraftChange,
  onRefine,
  onSave,
  onReset,
  onModelChange,
  onOpenCitation,
}: {
  draft: string;
  messages: DraftMessage[];
  refining: boolean;
  searching: boolean;
  saving: boolean;
  savedBody: string | null;
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
  const [draftPreviewVisible, setDraftPreviewVisible] = useState(true);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const normalizedDraft = draft.trim();
  const isSaved = Boolean(normalizedDraft && normalizedDraft === savedBody);
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId);
  const canUseImages = modelSupports(selectedModel, "vision");
  const canUseWeb = modelSupports(selectedModel, "web_search");

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

  return (
    <ResizableSplit
      className="capture-workspace"
      label="调整记录和草稿宽度"
      defaultLeftPercent={54}
      minLeftPx={360}
      minRightPx={340}
      left={
        <section
          className="conversation-panel"
          aria-label="草稿对话"
          style={{ "--composer-height": `${composerHeight}px` } as CSSProperties}
        >
          <header className="panel-header">
            <div>
              <p className="eyebrow">记录</p>
              <h1>记录想法</h1>
            </div>
            <span className="private-status">
              <span className="privacy-dot" />
              默认私有
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
                    {message.citations?.length ? (
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
                    {message.webCitations?.length ? (
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
                  <div className="thinking-indicator" role="status">
                    <div
                      className="thinking-dots"
                      aria-label={searching ? "Memora 正在联网搜索并整理" : "Memora 正在整理"}
                    >
                      <span />
                      <span />
                      <span />
                    </div>
                    <small>{searching ? "正在联网搜索并整理…" : "正在整理…"}</small>
                  </div>
                </article>
              ) : null}
              <div ref={messageEndRef} />
            </div>
          </div>

          <ComposerResizeHandle height={composerHeight} onHeightChange={setComposerHeight} />
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
            <button
              className="primary-action"
              type="button"
              disabled={!normalizedDraft || saving || isSaved}
              onClick={() => void onSave()}
            >
              {saving ? "正在保存…" : isSaved ? "已保存" : "保存为我的记忆"}
            </button>
          </footer>
        </section>
      }
    />
  );
}

function Timeline({
  memories,
  selectedId,
  loading,
  onSelect,
}: {
  memories: Memory[];
  selectedId: string | null;
  loading: boolean;
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
    <section className="timeline-panel" aria-label="个人记忆时间线">
      <header className="library-list-header">
        <div>
          <p className="eyebrow">个人记忆</p>
          <h1>记忆库</h1>
        </div>
        <span>{memories.length}</span>
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
            <strong>还没有记忆</strong>
            <p>先去记录一个想法，它会按时间出现在这里。</p>
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
                    aria-label={`查看记忆：${memoryTitle(memory.body)}`}
                  >
                    <time dateTime={memory.created_at}>{formatTime(memory.created_at)}</time>
                    <span className="timeline-node" />
                    <span className="memory-card-copy">
                      <strong>{memoryTitle(memory.body)}</strong>
                      <small>{memoryExcerpt(memory.body)}</small>
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
  memory,
  markdown,
  baseline,
  revisions,
  refining,
  savingMode,
  deleting,
  aiStatus,
  onMarkdownChange,
  onRefine,
  onSaveRevision,
  onDelete,
}: {
  memory: Memory | null;
  markdown: string;
  baseline: string;
  revisions: Memory[];
  refining: boolean;
  savingMode: RevisionMode | null;
  deleting: boolean;
  aiStatus: string;
  onMarkdownChange: (value: string) => void;
  onRefine: (instruction: string) => Promise<void>;
  onSaveRevision: (mode: RevisionMode) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const dirty = Boolean(memory && markdown.trim() && markdown.trim() !== baseline.trim());

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
          <p>{formatDateTime(memory.created_at)} · 仅自己可见</p>
        </div>
        <div className="detail-header-actions">
          <PreviewToggle
            visible={previewVisible}
            onToggle={() => setPreviewVisible((visible) => !visible)}
          />
          <button
            className={confirmingDelete ? "delete-button is-confirming" : "delete-button"}
            type="button"
            disabled={deleting}
            onClick={() => void requestDelete()}
            onBlur={() => setConfirmingDelete(false)}
          >
            {deleting ? "正在删除…" : confirmingDelete ? "确认删除" : "删除"}
          </button>
        </div>
      </header>

      <MarkdownWorkspace
        className="detail-editor-wrap"
        editorClassName="detail-editor"
        value={markdown}
        onChange={onMarkdownChange}
        ariaLabel="记忆 Markdown"
        previewVisible={previewVisible}
      />

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
                  <time dateTime={revision.created_at}>{formatDateTime(revision.created_at)}</time>
                  <p>{memoryExcerpt(revision.body)}</p>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [sessionError, setSessionError] = useState("");
  const [view, setView] = useState<AppView>("CAPTURE");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [memories, setMemories] = useState<Memory[]>([]);
  const [loadingMemories, setLoadingMemories] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);
  const [memoryMarkdown, setMemoryMarkdown] = useState("");
  const [memoryBaseline, setMemoryBaseline] = useState("");
  const [revisions, setRevisions] = useState<Memory[]>([]);

  const [draft, setDraft] = useState("");
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [messages, setMessages] = useState<DraftMessage[]>([initialMessage]);
  const [refiningDraft, setRefiningDraft] = useState(false);
  const [searchingWeb, setSearchingWeb] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [modelOptions, setModelOptions] = useState<DraftModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const [refiningMemory, setRefiningMemory] = useState(false);
  const [savingMode, setSavingMode] = useState<RevisionMode | null>(null);
  const [deletingMemory, setDeletingMemory] = useState(false);
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

  useEffect(() => {
    const timers = toastTimers;
    return () => {
      timers.current.forEach(window.clearTimeout);
    };
  }, []);

  const loadMemories = useCallback(async (userId: string) => {
    setLoadingMemories(true);
    try {
      const { data, response } = await api.GET("/memories", {
        params: {
          query: {
            author_id: userId,
            visibility: "PRIVATE",
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

  const enterPersonalSpace = useCallback(
    async (authenticatedUser: CurrentUser) => {
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
        if (!personal) {
          throw new Error("personal_workspace_missing");
        }
        let resolvedUser = authenticatedUser;
        if (!personal.is_current) {
          const activation = await api.POST("/workspaces/{workspace_id}/activate", {
            params: { path: { workspace_id: personal.id } },
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
        setUser(resolvedUser);
        setSessionError("");
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
        await loadMemories(resolvedUser.id);
      } catch {
        setSessionError("无法进入个人空间，请刷新后重试。");
        setUser(null);
        setModelOptions([]);
        setSelectedModelId(null);
      } finally {
        setBooting(false);
      }
    },
    [loadMemories],
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
        await enterPersonalSpace(data);
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

  async function refineCapture(
    instruction: string,
    images: DraftImageAttachment[],
    documents: DraftDocumentAttachment[],
    webSearch: WebSearchMode,
    modelId: string | null,
  ) {
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
    setRefiningDraft(true);
    setSearchingWeb(willSearchWeb(instruction, webSearch));
    try {
      const { data, response } = await api.POST("/drafts/chat", {
        body: {
          markdown: draft,
          messages: conversation,
          web_search: webSearch,
          ...(modelId ? { model_id: modelId } : {}),
        },
      });
      if (!data || !response.ok) throw new Error("draft_chat_failed");
      setDraft(data.markdown);
      const savedMemory = data.saved_memory;
      if (savedMemory) {
        setSavedBody(savedMemory.body);
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
            ? "已自动保存为我的记忆"
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
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: "这次没有整理成功，右侧草稿保持不变。请稍后再试。",
        },
      ]);
    } finally {
      setRefiningDraft(false);
      setSearchingWeb(false);
    }
  }

  async function saveDraft() {
    if (!draft.trim() || savingDraft) return;
    setSavingDraft(true);
    try {
      const { data, response } = await api.POST("/memories", {
        body: { body: draft },
      });
      if (!data || !response.ok) throw new Error("memory_create_failed");
      setDraft(data.body);
      setSavedBody(data.body);
      setMemories((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: "已保存到你的个人记忆库。",
          meta: formatDateTime(data.created_at),
        },
      ]);
      showToast("已保存为个人记忆");
    } catch {
      showToast("保存失败，请稍后重试");
    } finally {
      setSavingDraft(false);
    }
  }

  function resetDraft() {
    setDraft("");
    setSavedBody(null);
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
    setView("LIBRARY");
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
        if (response.status === 409 && user) {
          await loadMemories(user.id);
          throw new Error("stale_memory");
        }
        throw new Error("revision_failed");
      }
      if (user) await loadMemories(user.id);
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
    setUser(null);
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
      await enterPersonalSpace(data);
    } catch {
      setBooting(false);
      setSessionError("无法进入个人空间，请刷新后重试。");
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
        <h1 id="session-failure-title">暂时无法进入个人空间</h1>
        <p>为了避免把个人记忆写入错误的空间，Memora 已停止当前操作。</p>
        <button type="button" onClick={() => void retryPersonalSpace()}>
          重新尝试
        </button>
      </main>
    );
  }

  if (!user) {
    return (
      <LoginScreen onLogin={(authenticatedUser) => void enterPersonalSpace(authenticatedUser)} />
    );
  }

  return (
    <main className="app-shell">
      <Sidebar
        user={user}
        view={view}
        open={sidebarOpen}
        onView={(nextView) => {
          setView(nextView);
          setSidebarOpen(false);
        }}
        onClose={() => setSidebarOpen(false)}
        onLogout={() => void logout()}
      />
      <section className="app-main">
        <header className="mobile-header">
          <button type="button" aria-label="打开导航" onClick={() => setSidebarOpen(true)}>
            <MenuIcon />
          </button>
          <div>
            <Logo />
            <strong>{view === "CAPTURE" ? "记录想法" : "记忆库"}</strong>
          </div>
          <span className="privacy-dot" />
        </header>

        {sessionError ? (
          <div className="session-error" role="alert">
            {sessionError}
          </div>
        ) : null}

        {view === "CAPTURE" ? (
          <div className="view-transition" key="capture">
            <CaptureWorkspace
              draft={draft}
              messages={messages}
              refining={refiningDraft}
              searching={searchingWeb}
              saving={savingDraft}
              savedBody={savedBody}
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              onDraftChange={setDraft}
              onRefine={refineCapture}
              onSave={saveDraft}
              onReset={resetDraft}
              onModelChange={setSelectedModelId}
              onOpenCitation={openCitation}
            />
          </div>
        ) : (
          <ResizableSplit
            className="library-workspace view-transition"
            key="library"
            label="调整记忆列表和详情宽度"
            defaultLeftPercent={34}
            minLeftPx={260}
            minRightPx={360}
            left={
              <Timeline
                memories={memories}
                selectedId={selectedMemory?.id ?? null}
                loading={loadingMemories}
                onSelect={(memory) => void selectMemory(memory)}
              />
            }
            right={
              <MemoryDetail
                key={selectedMemory?.id ?? "empty-memory"}
                memory={selectedMemory}
                markdown={memoryMarkdown}
                baseline={memoryBaseline}
                revisions={revisions}
                refining={refiningMemory}
                savingMode={savingMode}
                deleting={deletingMemory}
                aiStatus={memoryAiStatus}
                onMarkdownChange={setMemoryMarkdown}
                onRefine={refineSelectedMemory}
                onSaveRevision={saveRevision}
                onDelete={deleteSelectedMemory}
              />
            }
          />
        )}
      </section>
      {toast ? (
        <div className={toastLeaving ? "toast is-leaving" : "toast"} role="status">
          {toast}
        </div>
      ) : null}
    </main>
  );
}
