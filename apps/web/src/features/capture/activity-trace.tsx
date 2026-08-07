"use client";

import { useEffect, useState } from "react";

import type {
  DraftTrace,
  DraftTraceStep,
  EvidenceCitation,
  WebCitation,
} from "@/features/shared/contracts";
import { GlobeIcon, LibraryIcon, SparkleIcon } from "@/features/shared/icons";
import { formatDateTime, sourceHostname } from "@/features/shared/utils";

export function ActivityTrace({
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
