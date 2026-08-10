"use client";

import {
  ArrowUpRight,
  BookOpenText,
  FilePenLine,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Plus,
  RefreshCw,
  Square,
  SquarePen,
  Upload,
  Users,
} from "lucide-react";
import Image from "next/image";
import type {
  ChangeEvent,
  ClipboardEvent,
  CSSProperties,
  DragEvent,
  FormEvent,
  KeyboardEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DraftDocumentAttachment,
  DraftDocumentCitation,
  DraftImageAttachment,
  DraftImageInput,
  DraftMessage,
  DraftModel,
  DraftTrace,
  Memory,
  MemoryVisibility,
  WebSearchMode,
  Workspace,
} from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { CloseIcon, GlobeIcon, LibraryIcon, Logo, SendIcon } from "@/features/shared/icons";
import {
  formatDateTime,
  readStoredNumber,
  sourceHostname,
  storeNumber,
} from "@/features/shared/utils";
import { planAllows, RichModelPicker } from "@/features/shared/model-picker";
import { KnowledgeBaseWorkspace } from "@/features/knowledge/knowledge-base-workspace";
import {
  clampComposerHeight,
  COMPOSER_DEFAULT_HEIGHT,
  ComposerResizeHandle,
  ResizableSplit,
} from "@/features/workbench/layout";

import { ActivityTrace } from "./activity-trace";
import type { CaptureAgentPhase } from "./agent-state";
import {
  ACCEPTED_ASSET_TYPES,
  ACCEPTED_DRAFT_IMAGE_TYPES,
  appendMarkdownImage,
  cancelDocumentParse,
  getDocumentStatus,
  IMAGE_ONLY_INSTRUCTION,
  MAX_DRAFT_DOCUMENTS,
  MAX_DRAFT_IMAGE_BYTES,
  MAX_DRAFT_IMAGE_TOTAL_BYTES,
  MAX_DRAFT_IMAGES,
  MAX_DRAFT_PDF_BYTES,
  readDocumentAttachment,
  readImageAttachment,
  retryDocumentParse,
} from "./attachments";
import { MarkdownWorkspace, PreviewToggle } from "./markdown-workspace";
import { modelSupports, selectedDraftModelLabel } from "./trace";

const CENTERED_COMPOSER_HEIGHT = 100;
const COMPOSER_TEXT_BASE_HEIGHT = 34;

export function CaptureWorkspace({
  mode = "CAPTURE",
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
  subscriptionPlan,
  rightPanelOpen,
  rightPanelView,
  memories,
  loadingMemories,
  agentPhase,
  canRetry,
  documentCitations,
  onDraftChange,
  onRefine,
  onSave,
  onSaveVisibilityChange,
  onReset,
  onModelChange,
  onRightPanelOpenChange,
  onRightPanelViewChange,
  onOpenKnowledge,
  onOpenKnowledgeMemory,
  onUpgrade,
  onOpenCitation,
  onCancel,
  onRetry,
}: {
  mode?: "CAPTURE" | "RESEARCH";
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
  subscriptionPlan?: "PLUS" | "PRO" | "ULTRA";
  rightPanelOpen: boolean;
  rightPanelView: "DRAFT" | "KNOWLEDGE";
  memories: Memory[];
  loadingMemories: boolean;
  agentPhase: CaptureAgentPhase;
  canRetry: boolean;
  documentCitations: DraftDocumentCitation[];
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
  onRightPanelOpenChange: (open: boolean) => void;
  onRightPanelViewChange: (view: "DRAFT" | "KNOWLEDGE") => void;
  onOpenKnowledge: () => void;
  onOpenKnowledgeMemory: (memory: Memory) => void;
  onUpgrade: () => void;
  onOpenCitation: (memoryId: string) => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const researchMode = mode === "RESEARCH";
  const [instruction, setInstruction] = useState("");
  const [attachments, setAttachments] = useState<DraftImageAttachment[]>([]);
  const [documents, setDocuments] = useState<DraftDocumentAttachment[]>([]);
  const [uploadingDocuments, setUploadingDocuments] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>("AUTO");
  const [composerHeight, setComposerHeight] = useState(COMPOSER_DEFAULT_HEIGHT);
  const [autoComposerHeight, setAutoComposerHeight] = useState(CENTERED_COMPOSER_HEIGHT);
  const [renderedComposerHeight, setRenderedComposerHeight] = useState(CENTERED_COMPOSER_HEIGHT);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [draftPreviewVisible, setDraftPreviewVisible] = useState(true);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const visibleMessages = messages.filter((message) => message.id !== "welcome");
  const emptyConversation =
    visibleMessages.length === 0 &&
    !draft.trim() &&
    !refining &&
    attachments.length === 0 &&
    documents.length === 0 &&
    uploadingDocuments === 0;
  const normalizedDraft = draft.trim();
  const isSaved = Boolean(
    normalizedDraft && normalizedDraft === savedBody && saveVisibility === savedVisibility,
  );
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId);
  const selectedModelLabel = selectedDraftModelLabel(modelOptions, selectedModelId);
  const introTitle = researchMode ? "今天想深入研究什么？" : "有什么可以帮助您的？";
  const pickerOptions = modelOptions.map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
    minPlan: model.min_plan,
    badges: model.badges,
    locked: !planAllows(subscriptionPlan, model.min_plan),
  }));
  const canUseImages = modelSupports(selectedModel, "vision");
  const canUseWeb = modelSupports(selectedModel, "web_search");
  const documentProcessing = documents.some((document) =>
    ["QUEUED", "PARSING", "OCR", "CANCEL_REQUESTED"].includes(document.document.status),
  );
  const attachmentUploadDisabled =
    refining ||
    uploadingDocuments > 0 ||
    (attachments.length >= MAX_DRAFT_IMAGES && documents.length >= MAX_DRAFT_DOCUMENTS);

  useEffect(() => {
    const pending = documents.filter((document) =>
      ["QUEUED", "PARSING", "OCR", "CANCEL_REQUESTED"].includes(document.document.status),
    );
    if (!pending.length) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void Promise.all(
        pending.map(async (document) => ({
          assetId: document.assetId,
          status: await getDocumentStatus(document.assetId),
        })),
      )
        .then((updates) => {
          if (!active) return;
          const byAsset = new Map(updates.map((update) => [update.assetId, update.status]));
          setDocuments((current) =>
            current.map((document) => ({
              ...document,
              document: byAsset.get(document.assetId) ?? document.document,
            })),
          );
        })
        .catch(() => {
          if (active) setAttachmentError("暂时无法读取 PDF 解析进度，稍后会继续尝试。");
        });
    }, 800);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [documents]);

  const changeComposerHeight = useCallback((height: number) => {
    const nextHeight = clampComposerHeight(height);
    setComposerHeight(nextHeight);
    storeNumber("memora.composer.height.fluid", nextHeight);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedHeight = readStoredNumber("memora.composer.height.fluid");
      if (storedHeight !== null && storedHeight > 0) changeComposerHeight(storedHeight);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [changeComposerHeight]);

  const syncComposerAutoHeight = useCallback(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const baseHeight = emptyConversation ? CENTERED_COMPOSER_HEIGHT : COMPOSER_DEFAULT_HEIGHT;
    const viewportLimit = Math.max(baseHeight, Math.floor(window.innerHeight / 3));
    const previousHeight = composer.style.height;
    const previousFlex = composer.style.flex;
    composer.style.height = "0px";
    composer.style.flex = "none";
    const contentHeight = Math.max(COMPOSER_TEXT_BASE_HEIGHT, composer.scrollHeight);
    composer.style.height = previousHeight;
    composer.style.flex = previousFlex;
    setAutoComposerHeight(
      Math.min(viewportLimit, baseHeight + Math.max(0, contentHeight - COMPOSER_TEXT_BASE_HEIGHT)),
    );
  }, [emptyConversation]);

  useEffect(() => {
    syncComposerAutoHeight();
    window.addEventListener("resize", syncComposerAutoHeight);
    return () => window.removeEventListener("resize", syncComposerAutoHeight);
  }, [instruction, syncComposerAutoHeight]);

  useEffect(() => {
    if (!emptyConversation) return;
    const composerWrap = composerWrapRef.current;
    if (!composerWrap) return;
    const syncRenderedHeight = () => {
      const nextHeight = Math.round(composerWrap.getBoundingClientRect().height * 2) / 2;
      if (nextHeight <= 0) return;
      setRenderedComposerHeight((current) =>
        Math.abs(current - nextHeight) < 0.5 ? current : nextHeight,
      );
    };
    const observer = new ResizeObserver(syncRenderedHeight);
    observer.observe(composerWrap);
    syncRenderedHeight();
    window.addEventListener("resize", syncRenderedHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncRenderedHeight);
    };
  }, [emptyConversation]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, refining]);

  useEffect(() => {
    if (!refining) composerRef.current?.focus?.();
  }, [refining]);

  useEffect(() => {
    if (!addMenuOpen) return;

    function closeMenu(event: globalThis.MouseEvent) {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    }

    function closeMenuOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setAddMenuOpen(false);
    }

    document.addEventListener("mousedown", closeMenu);
    window.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [addMenuOpen]);

  const handleRightPanelCollapsedChange = useCallback(
    (collapsed: boolean) => {
      onRightPanelOpenChange(!collapsed);
    },
    [onRightPanelOpenChange],
  );

  function openRightPanel(view: "DRAFT" | "KNOWLEDGE") {
    onRightPanelViewChange(view);
    onRightPanelOpenChange(true);
  }

  function startNewConversation() {
    setInstruction("");
    setAttachments([]);
    setDocuments([]);
    setAttachmentError("");
    setAddMenuOpen(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
    onReset();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = instruction.trim();
    if ((!value && attachments.length === 0 && documents.length === 0) || refining) return;
    if (documentProcessing || uploadingDocuments > 0) {
      setAttachmentError("PDF 仍在解析，请等待完成后再发送。");
      return;
    }
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
    setAddMenuOpen(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
    const selectedWebSearchMode = researchMode ? "REQUIRED" : webSearchMode;
    if (!researchMode && selectedWebSearchMode === "REQUIRED") setWebSearchMode("AUTO");
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
      setUploadingDocuments(pdfFiles.length);
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
    } finally {
      setUploadingDocuments(0);
    }
  }

  async function cancelDocument(document: DraftDocumentAttachment) {
    try {
      const status = await cancelDocumentParse(document.assetId);
      setDocuments((current) =>
        current.map((item) =>
          item.assetId === document.assetId ? { ...item, document: status } : item,
        ),
      );
    } catch {
      setAttachmentError("没有成功取消 PDF 解析，请稍后重试。");
    }
  }

  async function retryDocument(document: DraftDocumentAttachment) {
    try {
      const status = await retryDocumentParse(document.assetId);
      setAttachmentError("");
      setDocuments((current) =>
        current.map((item) =>
          item.assetId === document.assetId ? { ...item, document: status } : item,
        ),
      );
    } catch {
      setAttachmentError("没有成功重新开始 PDF 解析，请稍后重试。");
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
      rightCollapsed={!rightPanelOpen}
      onRightCollapsedChange={handleRightPanelCollapsedChange}
      left={
        <section
          className={`conversation-panel ${emptyConversation ? "is-empty-conversation" : ""} ${draggingFiles ? "is-file-dragging" : ""}`}
          aria-label="草稿对话"
          style={
            {
              "--composer-height": `${composerHeight}px`,
              "--composer-auto-height": `${autoComposerHeight}px`,
              "--composer-auto-half-height": `${
                Math.min(renderedComposerHeight, autoComposerHeight) / 2
              }px`,
            } as CSSProperties
          }
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
              {modelOptions.length ? (
                <RichModelPicker
                  header
                  label="切换顶部聊天模型"
                  options={pickerOptions}
                  selectedId={selectedModelId}
                  disabled={refining}
                  onChange={changeModel}
                  onUpgrade={onUpgrade}
                />
              ) : (
                <span className="model-unavailable">AI 未配置</span>
              )}
              <h1 className="chat-model-heading">{selectedModelLabel}</h1>
            </div>
            <button
              className="conversation-new-chat"
              type="button"
              aria-label="在顶部开始新对话"
              onClick={startNewConversation}
            >
              <SquarePen aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>新对话</span>
            </button>
          </header>

          <div className="conversation-scroll">
            {emptyConversation ? (
              <div className="conversation-intro">
                <span className="intro-mark">
                  <Logo />
                </span>
                <h2 aria-label={introTitle}>
                  {Array.from(introTitle).map((character, index) => (
                    <span
                      aria-hidden="true"
                      key={`${character}-${index}`}
                      style={{ "--character-delay": `${80 + index * 62}ms` } as CSSProperties}
                    >
                      {character}
                    </span>
                  ))}
                </h2>
              </div>
            ) : null}
            <div className="message-list" aria-live="polite">
              {visibleMessages.map((message) => (
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
                    {message.documentCitations?.length ? (
                      <div className="document-citations" aria-label="文档来源">
                        {message.documentCitations.map((citation, index) => (
                          <a
                            href={citation.content_url}
                            key={citation.chunk_id}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <span>
                              文档 {index + 1} · 第 {citation.page_number} 页
                            </span>
                            <strong>{citation.asset_name}</strong>
                            <small>{citation.heading || citation.excerpt}</small>
                          </a>
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
                    {message.resultTarget ? (
                      <div
                        className={`assistant-result-card is-${message.resultTarget.toLowerCase()}`}
                        role="status"
                      >
                        <div className="assistant-result-copy">
                          <BookOpenText aria-hidden="true" size={17} strokeWidth={1.8} />
                          <span>
                            <strong>
                              {message.resultTarget === "MEMORY" ? "已写入云知识库" : "草稿已更新"}
                            </strong>
                            <small>
                              {message.resultTarget === "MEMORY"
                                ? "可以继续在当前对话工作，也可以打开知识库查看。"
                                : "仍是私有草稿，确认保存后才会进入云知识库。"}
                            </small>
                          </span>
                        </div>
                        <div className="assistant-result-actions">
                          {message.resultTarget === "DRAFT" ? (
                            <button type="button" onClick={() => openRightPanel("DRAFT")}>
                              <FilePenLine aria-hidden="true" size={14} strokeWidth={1.8} />
                              查看草稿
                            </button>
                          ) : null}
                          <button type="button" onClick={onOpenKnowledge}>
                            <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
                            前往云知识库
                          </button>
                          <button
                            type="button"
                            aria-label="在右侧打开云知识库"
                            onClick={() => openRightPanel("KNOWLEDGE")}
                          >
                            <PanelRightOpen aria-hidden="true" size={14} strokeWidth={1.8} />
                            在右侧打开
                          </button>
                        </div>
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
                    <button
                      className="agent-cancel-button"
                      type="button"
                      disabled={agentPhase === "CANCELLING"}
                      onClick={() => void onCancel()}
                    >
                      {agentPhase === "CANCELLING"
                        ? "正在取消…"
                        : agentPhase === "RECOVERING"
                          ? "停止恢复"
                          : "停止"}
                    </button>
                  </div>
                </article>
              ) : null}
              <div ref={messageEndRef} />
            </div>
          </div>

          {canRetry ? (
            <div className="agent-retry-bar" role="status">
              <span>{agentPhase === "CANCELLED" ? "这轮已取消" : "这轮没有完成"}</span>
              <button type="button" onClick={() => void onRetry()}>
                重试
              </button>
            </div>
          ) : null}

          {!emptyConversation ? (
            <ComposerResizeHandle height={composerHeight} onHeightChange={changeComposerHeight} />
          ) : null}
          <div
            ref={composerWrapRef}
            className={`composer-wrap ${emptyConversation ? "is-centered" : "is-docked"}`}
          >
            <form className="composer" onSubmit={submit}>
              {attachments.length || documents.length || uploadingDocuments ? (
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
                    <div
                      className={`pending-document is-${document.document.status.toLowerCase()}`}
                      key={document.id}
                    >
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
                      <span>
                        <strong>{document.name}</strong>
                        <small>{document.document.message}</small>
                        {document.document.page_count ? (
                          <small>
                            {Math.min(
                              document.document.processed_pages,
                              document.document.page_count,
                            )}
                            /{document.document.page_count} 页
                          </small>
                        ) : null}
                      </span>
                      {document.document.can_cancel ? (
                        <button
                          className="document-status-action"
                          type="button"
                          title="停止解析"
                          aria-label={`停止解析 ${document.name}`}
                          onClick={() => void cancelDocument(document)}
                        >
                          <Square aria-hidden="true" size={12} />
                        </button>
                      ) : null}
                      {document.document.can_retry ? (
                        <button
                          className="document-status-action"
                          type="button"
                          title="重新解析"
                          aria-label={`重新解析 ${document.name}`}
                          onClick={() => void retryDocument(document)}
                        >
                          <RefreshCw aria-hidden="true" size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {uploadingDocuments ? (
                    <div className="pending-document is-uploading" role="status">
                      <Upload aria-hidden="true" size={16} />
                      <span>
                        <strong>正在上传 {uploadingDocuments} 个 PDF</strong>
                        <small>上传完成后会自动进入解析队列</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                aria-label="告诉 Memora 你的想法"
                placeholder={
                  researchMode
                    ? "描述研究问题、范围和期望输出…"
                    : draft
                      ? "继续说，或告诉我怎样修改草稿…"
                      : "发送消息，输入 ‘/’ 以调用指令"
                }
                rows={1}
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={composerKeyDown}
                onPaste={(event) => void pasteIntoComposer(event)}
                disabled={refining}
              />
              <div className="composer-tools">
                <input
                  ref={imageInputRef}
                  className="image-input"
                  type="file"
                  accept={Array.from(ACCEPTED_ASSET_TYPES).join(",")}
                  multiple
                  aria-label="选择图片或 PDF"
                  onChange={(event) => void selectImages(event)}
                  disabled={attachmentUploadDisabled}
                />
                <div
                  className={`composer-add-menu ${addMenuOpen ? "is-open" : ""}`}
                  ref={addMenuRef}
                >
                  <button
                    className="attach-button composer-add-trigger"
                    type="button"
                    aria-label="添加内容"
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    title="添加内容"
                    onClick={() => setAddMenuOpen((open) => !open)}
                    disabled={refining}
                  >
                    <Plus aria-hidden="true" size={20} strokeWidth={1.8} />
                  </button>
                  {addMenuOpen ? (
                    <div className="composer-add-popover" role="menu" aria-label="添加内容">
                      <button
                        type="button"
                        role="menuitem"
                        disabled={attachmentUploadDisabled}
                        onClick={() => {
                          setAddMenuOpen(false);
                          imageInputRef.current?.click();
                        }}
                      >
                        <Paperclip aria-hidden="true" size={17} strokeWidth={1.8} />
                        <span>上传附件</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          openRightPanel("KNOWLEDGE");
                        }}
                      >
                        <LibraryIcon />
                        <span>从知识库选择</span>
                      </button>
                    </div>
                  ) : null}
                </div>
                {modelOptions.length ? (
                  <RichModelPicker
                    compact
                    label="选择聊天模型"
                    options={pickerOptions}
                    selectedId={selectedModelId}
                    disabled={refining}
                    onChange={changeModel}
                    onUpgrade={onUpgrade}
                  />
                ) : (
                  <span className="model-unavailable">AI 未配置</span>
                )}
                <label
                  className={`search-mode-control is-${researchMode ? "required" : webSearchMode.toLowerCase()}`}
                >
                  <GlobeIcon />
                  <select
                    aria-label="联网模式"
                    value={researchMode ? "REQUIRED" : webSearchMode}
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
                    disabled={researchMode || refining || !canUseWeb}
                  >
                    <option value="AUTO">自动联网</option>
                    <option value="REQUIRED">本轮联网</option>
                    <option value="DISABLED">关闭联网</option>
                  </select>
                </label>
                <span>
                  {researchMode
                    ? "深度调研会检索实时网页并展示来源"
                    : !canUseWeb
                      ? "当前模型不支持联网"
                      : webSearchMode === "AUTO"
                        ? "需要最新信息时自动搜索"
                        : webSearchMode === "REQUIRED"
                          ? "发送后恢复自动"
                          : "只使用对话与个人记忆"}
                </span>
                <button
                  className="send-button"
                  type="submit"
                  aria-label="发送"
                  disabled={
                    (!instruction.trim() && attachments.length === 0 && documents.length === 0) ||
                    refining ||
                    documentProcessing ||
                    uploadingDocuments > 0
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
        rightPanelView === "KNOWLEDGE" ? (
          <KnowledgeBaseWorkspace
            embedded
            workspace={workspace}
            memories={memories}
            loading={loadingMemories}
            onOpenMemory={onOpenKnowledgeMemory}
            onCapture={() => openRightPanel("DRAFT")}
            onOpenDraft={() => openRightPanel("DRAFT")}
            onOpenFull={onOpenKnowledge}
            onClose={() => onRightPanelOpenChange(false)}
          />
        ) : (
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
                <button
                  className="icon-button"
                  type="button"
                  aria-label="切换到右侧云知识库"
                  title="云知识库"
                  onClick={() => openRightPanel("KNOWLEDGE")}
                >
                  <BookOpenText aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="关闭右侧草稿"
                  title="关闭"
                  onClick={() => onRightPanelOpenChange(false)}
                >
                  <PanelRightClose aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
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
            {documentCitations.length ? (
              <div className="draft-document-sources" aria-label="草稿文档来源">
                <span>文档来源</span>
                {documentCitations.map((citation) => (
                  <a
                    href={citation.content_url}
                    key={citation.chunk_id}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {citation.asset_name} · 第 {citation.page_number} 页
                  </a>
                ))}
              </div>
            ) : null}
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
              {isCollaborativeWorkspace(workspace) ? (
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
                    空间共享
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
                      ? "保存为空间记忆"
                      : "保存为我的记忆"}
              </button>
            </footer>
          </section>
        )
      }
    />
  );
}
