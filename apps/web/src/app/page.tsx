"use client";

import type { components } from "@memora/api-contract";
import Image from "next/image";
import {
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
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
type DraftImageInput = components["schemas"]["DraftImageInput"];
type WebSearchMode = components["schemas"]["DraftChatRequest"]["web_search"];
type RevisionMode = components["schemas"]["CreateMemoryRevisionRequest"]["mode"];
type AppView = "CAPTURE" | "LIBRARY";

type DraftImageAttachment = DraftImageInput & {
  id: string;
  previewUrl: string;
};

type DraftImagePreview = Pick<DraftImageAttachment, "id" | "name" | "previewUrl">;

type DraftMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  meta?: string;
  citations?: EvidenceCitation[];
  webCitations?: WebCitation[];
  images?: DraftImagePreview[];
};

const MAX_DRAFT_IMAGES = 3;
const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DRAFT_IMAGE_TOTAL_BYTES = 16 * 1024 * 1024;
const ACCEPTED_DRAFT_IMAGE_TYPES = new Set<DraftImageInput["media_type"]>([
  "image/png",
  "image/jpeg",
  "image/webp",
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

function willSearchWeb(instruction: string, mode: WebSearchMode) {
  if (mode === "DISABLED") return false;
  if (mode === "REQUIRED") return true;
  const normalized = instruction.toLocaleLowerCase();
  return AUTO_WEB_SEARCH_MARKERS.some((marker) => normalized.includes(marker));
}

function readImageAttachment(file: File): Promise<DraftImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("image_read_failed"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("image_read_failed"));
        return;
      }
      const commaIndex = reader.result.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("image_read_failed"));
        return;
      }
      resolve({
        id: nextId("image"),
        name: file.name || "未命名图片",
        media_type: file.type as DraftImageInput["media_type"],
        data: reader.result.slice(commaIndex + 1),
        previewUrl: reader.result,
      });
    };
    reader.readAsDataURL(file);
  });
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

function CaptureWorkspace({
  draft,
  messages,
  refining,
  searching,
  saving,
  savedBody,
  onDraftChange,
  onRefine,
  onSave,
  onReset,
  onOpenCitation,
}: {
  draft: string;
  messages: DraftMessage[];
  refining: boolean;
  searching: boolean;
  saving: boolean;
  savedBody: string | null;
  onDraftChange: (value: string) => void;
  onRefine: (
    instruction: string,
    images: DraftImageAttachment[],
    webSearch: WebSearchMode,
  ) => Promise<void>;
  onSave: () => Promise<void>;
  onReset: () => void;
  onOpenCitation: (memoryId: string) => Promise<void>;
}) {
  const [instruction, setInstruction] = useState("");
  const [attachments, setAttachments] = useState<DraftImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("AUTO");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const normalizedDraft = draft.trim();
  const isSaved = Boolean(normalizedDraft && normalizedDraft === savedBody);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, refining]);

  // Grow the composer with its content up to the CSS max-height, then scroll.
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [instruction]);

  // Return focus to the composer once a turn finishes so typing can continue.
  useEffect(() => {
    if (!refining) composerRef.current?.focus?.();
  }, [refining]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = instruction.trim();
    if ((!value && attachments.length === 0) || refining) return;
    const message = value || IMAGE_ONLY_INSTRUCTION;
    const selectedAttachments = attachments;
    setInstruction("");
    setAttachments([]);
    setAttachmentError("");
    if (imageInputRef.current) imageInputRef.current.value = "";
    const selectedWebSearchMode = webSearchMode;
    if (selectedWebSearchMode === "REQUIRED") setWebSearchMode("AUTO");
    await onRefine(message, selectedAttachments, selectedWebSearchMode);
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  // Returns an error message, or "" when the batch may be attached.
  function validateFiles(files: File[]) {
    const availableSlots = MAX_DRAFT_IMAGES - attachments.length;
    if (availableSlots <= 0 || files.length > availableSlots) {
      return `每条消息最多上传 ${MAX_DRAFT_IMAGES} 张图片。`;
    }
    const hasInvalidType = files.some(
      (file) => !ACCEPTED_DRAFT_IMAGE_TYPES.has(file.type as DraftImageInput["media_type"]),
    );
    if (hasInvalidType) return "只支持 PNG、JPEG 和 WEBP 图片。";
    if (files.some((file) => file.size > MAX_DRAFT_IMAGE_BYTES)) {
      return "单张图片不能超过 8 MiB。";
    }
    const currentBytes = attachments.reduce(
      (total, attachment) => total + Math.ceil((attachment.data.length * 3) / 4),
      0,
    );
    const incomingBytes = files.reduce((total, file) => total + file.size, 0);
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
      const nextAttachments = await Promise.all(files.map(readImageAttachment));
      setAttachments((current) => [...current, ...nextAttachments]);
    } catch {
      setAttachmentError("图片读取失败，请重新选择。");
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
    <div className="capture-workspace">
      <section className="conversation-panel" aria-label="草稿对话">
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
            <p>说出原始想法，Memora 会帮你整理到右侧。</p>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.map((message) => (
              <article className={`chat-message is-${message.role.toLowerCase()}`} key={message.id}>
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

        <div className="composer-wrap">
          <form className="composer" onSubmit={submit}>
            {attachments.length ? (
              <div className="pending-images" aria-label="待发送图片">
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
              </div>
            ) : null}
            <div className="composer-tools">
              <label className={`search-mode-control is-${webSearchMode.toLowerCase()}`}>
                <GlobeIcon />
                <select
                  aria-label="联网模式"
                  value={webSearchMode}
                  onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)}
                  disabled={refining}
                >
                  <option value="AUTO">自动联网</option>
                  <option value="REQUIRED">本轮联网</option>
                  <option value="DISABLED">关闭联网</option>
                </select>
              </label>
              <span>
                {webSearchMode === "AUTO"
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
                accept="image/png,image/jpeg,image/webp"
                multiple
                aria-label="选择图片"
                onChange={(event) => void selectImages(event)}
                disabled={refining || attachments.length >= MAX_DRAFT_IMAGES}
              />
              <button
                className="attach-button"
                type="button"
                aria-label="上传图片"
                title="上传图片"
                onClick={() => imageInputRef.current?.click()}
                disabled={refining || attachments.length >= MAX_DRAFT_IMAGES}
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
                disabled={(!instruction.trim() && attachments.length === 0) || refining}
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
          <p>Enter 发送 · Shift + Enter 换行 · 可直接粘贴图片 · 对话不会自动保存</p>
        </div>
      </section>

      <section className="markdown-panel" aria-label="Markdown 草稿编辑器">
        <header className="markdown-header">
          <div>
            <p className="eyebrow">草稿</p>
            <h2>草稿</h2>
          </div>
          <div className="draft-header-actions">
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
        <textarea
          className="markdown-editor"
          aria-label="Markdown 草稿"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={"# 想法标题\n\n你的 Markdown 草稿会出现在这里。"}
          spellCheck={false}
        />
        <footer className="draft-footer">
          <div>
            <span>{draft.length.toLocaleString("zh-CN")} 字符</span>
            <small>你可以直接修改，也可以继续让 AI 修改</small>
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
    </div>
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
        <button
          className={confirmingDelete ? "delete-button is-confirming" : "delete-button"}
          type="button"
          disabled={deleting}
          onClick={() => void requestDelete()}
          onBlur={() => setConfirmingDelete(false)}
        >
          {deleting ? "正在删除…" : confirmingDelete ? "确认删除" : "删除"}
        </button>
      </header>

      <div className="detail-editor-wrap">
        <textarea
          className="markdown-editor detail-editor"
          aria-label="记忆 Markdown"
          value={markdown}
          onChange={(event) => onMarkdownChange(event.target.value)}
          spellCheck={false}
        />
      </div>

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
        await loadMemories(resolvedUser.id);
      } catch {
        setSessionError("无法进入个人空间，请刷新后重试。");
        setUser(null);
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
    webSearch: WebSearchMode,
  ) {
    const userMessage: DraftMessage = {
      id: nextId("user"),
      role: "USER",
      content: instruction,
      images: images.map(({ id, name, previewUrl }) => ({ id, name, previewUrl })),
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
        }
      : { role: userMessage.role, content: userMessage.content };
    const conversation = [...priorConversation, currentTurn];
    setMessages((current) => [...current, userMessage]);
    setRefiningDraft(true);
    setSearchingWeb(willSearchWeb(instruction, webSearch));
    try {
      const { data, response } = await api.POST("/drafts/chat", {
        body: { markdown: draft, messages: conversation, web_search: webSearch },
      });
      if (!data || !response.ok) throw new Error("draft_chat_failed");
      setDraft(data.markdown);
      setMessages((current) => [
        ...current,
        {
          id: nextId("assistant"),
          role: "ASSISTANT",
          content: data.assistant_message,
          meta:
            data.web_search_status === "AVAILABLE"
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
              onDraftChange={setDraft}
              onRefine={refineCapture}
              onSave={saveDraft}
              onReset={resetDraft}
              onOpenCitation={openCitation}
            />
          </div>
        ) : (
          <div className="library-workspace view-transition" key="library">
            <Timeline
              memories={memories}
              selectedId={selectedMemory?.id ?? null}
              loading={loadingMemories}
              onSelect={(memory) => void selectMemory(memory)}
            />
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
          </div>
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
