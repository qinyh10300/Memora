"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { PreviewIcon } from "@/features/shared/icons";
import { ResizableSplit } from "@/features/workbench/layout";

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

export function PreviewToggle({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
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

export function MarkdownWorkspace({
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
