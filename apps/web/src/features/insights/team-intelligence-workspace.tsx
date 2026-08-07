"use client";

import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  FileClock,
  FileText,
  GitCompareArrows,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  Network,
  Pause,
  Play,
  Plus,
  Repeat2,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type {
  AlignmentPosition,
  AlignmentTopic,
  GeneratedReport,
  Memory,
  ReportSubscription,
  Subscription,
  Workspace,
  WorkspaceMember,
} from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";
import { api } from "@/lib/api";

type InsightTab = "REPORTS" | "ALIGNMENT" | "DECISIONS";
type ReportScope = GeneratedReport["scope"];

const REPORT_PRESETS = [
  {
    id: "MISSED",
    label: "我错过了什么",
    topic: "过去 30 天的重要变化与未跟进事项",
    icon: FileClock,
  },
  {
    id: "MEETING",
    label: "会前简报",
    topic: "会议主题相关进展、分歧与待确认事项",
    icon: CalendarClock,
  },
  {
    id: "ONBOARDING",
    label: "新人入组",
    topic: "团队背景、当前方向、关键决策与知识缺口",
    icon: UserRound,
  },
  {
    id: "HANDOVER",
    label: "交接报告",
    topic: "当前进展、待办、风险与下一位负责人的上下文",
    icon: BookOpenCheck,
  },
  {
    id: "KNOWLEDGE_GAPS",
    label: "知识缺口",
    topic: "证据不足、过期决定与单点知识风险",
    icon: CircleAlert,
  },
] as const satisfies readonly {
  id: ReportSubscription["preset"];
  label: string;
  topic: string;
  icon: typeof FileClock;
}[];

const PRESET_LABELS: Record<ReportSubscription["preset"], string> = Object.fromEntries(
  REPORT_PRESETS.map((preset) => [preset.id, preset.label]),
) as Record<ReportSubscription["preset"], string>;

const CADENCE_LABELS: Record<ReportSubscription["cadence"], string> = {
  DAILY: "每天",
  WEEKLY: "每周",
  MONTHLY: "每月",
};

const SUMMARY_LABELS = {
  CONSENSUS: "已确认一致",
  DIFFERENCES: "仍有明确差异",
  INSUFFICIENT_EVIDENCE: "等待成员确认",
} as const;

const POSITION_LABELS = {
  CANDIDATE: "候选观点",
  CONFIRMED: "本人已确认",
  REVISED: "本人已修正",
  WITHDRAWN: "本人已撤回",
  NO_RECORDED_POSITION: "未记录观点",
} as const;

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function requestError(result: { error?: unknown; response: Response }, fallback: string) {
  if (result.response.status === 402) return "Credits 余额不足，请升级套餐后继续。";
  if (result.response.status === 403) return "当前账号没有执行此操作的权限。";
  if (typeof result.error === "object" && result.error && "detail" in result.error) {
    const detail = (result.error as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

function ScopeIcon({ scope }: { scope: ReportScope }) {
  if (scope === "PERSONAL") return <UserRound aria-hidden="true" size={15} />;
  if (scope === "MEMBER" || scope === "COLLEAGUE") {
    return <Users aria-hidden="true" size={15} />;
  }
  return <BrainCircuit aria-hidden="true" size={15} />;
}

function ReportDetail({
  report,
  busy,
  onOpenMemory,
  onSave,
  onCreateVisual,
}: {
  report: GeneratedReport | null;
  busy: string;
  onOpenMemory: (memoryId: string) => void;
  onSave: () => void;
  onCreateVisual: () => void;
}) {
  if (!report) {
    return (
      <div className="insight-empty-detail">
        <BrainCircuit aria-hidden="true" size={28} />
        <strong>从一份有来源的报告开始</strong>
        <span>选择范围和时间后，Memora 只会使用你当前有权访问的记忆。</span>
      </div>
    );
  }
  return (
    <article className="report-detail">
      <header>
        <span>
          <ScopeIcon scope={report.scope} />
          {report.visibility === "WORKSPACE" ? "团队可见" : "仅自己可见"}
        </span>
        <h2>{report.title}</h2>
        <small>
          {new Date(report.created_from).toLocaleDateString("zh-CN")} -{" "}
          {new Date(report.created_to).toLocaleDateString("zh-CN")}
        </small>
        {report.is_owner ? (
          <div>
            <button type="button" disabled={Boolean(busy)} onClick={onSave}>
              <Save aria-hidden="true" size={14} />
              {report.saved_memory_id ? "已保存为记忆" : "保存为记忆"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={onCreateVisual}>
              <Network aria-hidden="true" size={14} />
              生成框图
            </button>
          </div>
        ) : null}
      </header>
      <section className="report-summary">
        <span>摘要</span>
        <p>{report.summary}</p>
      </section>
      <div className="report-sections">
        {report.sections.map((section) => (
          <section key={section.kind}>
            <header>
              <strong>{section.title}</strong>
              <small>{section.citation_memory_ids.length} 条来源</small>
            </header>
            <p>{section.content}</p>
          </section>
        ))}
      </div>
      <section className="report-citations">
        <header>
          <ShieldCheck aria-hidden="true" size={15} />
          可核对来源
        </header>
        <div>
          {report.citations.map((citation) => (
            <button
              type="button"
              key={citation.memory_id}
              onClick={() => onOpenMemory(citation.memory_id)}
            >
              <FileText aria-hidden="true" size={14} />
              <span>
                <strong>{citation.author.display_name}</strong>
                <small>{citation.excerpt}</small>
              </span>
              <ChevronRight aria-hidden="true" size={14} />
            </button>
          ))}
          {!report.citations.length ? <p>这个范围内没有足够证据，Memora 不会猜测。</p> : null}
        </div>
      </section>
    </article>
  );
}

function ReportCreatePanel({
  workspace,
  members,
  busy,
  onClose,
  onCreated,
  onScheduleFailure,
  onUpgrade,
  creditCost,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  busy: boolean;
  onClose: () => void;
  onCreated: (report: GeneratedReport, subscription?: ReportSubscription) => void;
  onScheduleFailure: (message: string) => void;
  onUpgrade: () => void;
  creditCost: number;
}) {
  const collaborative = isCollaborativeWorkspace(workspace);
  const [selectedPreset, setSelectedPreset] = useState<ReportSubscription["preset"]>("MISSED");
  const [scope, setScope] = useState<ReportScope>(collaborative ? "WORKSPACE" : "PERSONAL");
  const [authorId, setAuthorId] = useState("");
  const [topic, setTopic] = useState("全部");
  const [createdFrom, setCreatedFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return dateInputValue(date);
  });
  const [createdTo, setCreatedTo] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return dateInputValue(date);
  });
  const [visibility, setVisibility] = useState<"PRIVATE" | "WORKSPACE">("PRIVATE");
  const [recurring, setRecurring] = useState(false);
  const [cadence, setCadence] = useState<ReportSubscription["cadence"]>("WEEKLY");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!topic.trim()) return;
    if (scope === "MEMBER" && !authorId) {
      setError("请选择要生成报告的成员。");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await api.POST("/reports", {
        body: {
          scope,
          topic: topic.trim(),
          created_from: new Date(`${createdFrom}T00:00:00`).toISOString(),
          created_to: new Date(`${createdTo}T00:00:00`).toISOString(),
          evidence_limit: 30,
          visibility,
          ...(scope === "MEMBER" ? { author_id: authorId } : {}),
        },
      });
      if (!result.data || !result.response.ok) {
        setError(requestError(result, "报告没有生成成功，请稍后重试。"));
        if (result.response.status === 402) onUpgrade();
        return;
      }
      let createdSubscription: ReportSubscription | undefined;
      if (recurring) {
        const scheduleResult = await api.POST("/report-subscriptions", {
          body: {
            preset: selectedPreset,
            scope: scope === "COLLEAGUE" ? "MEMBER" : scope,
            topic: topic.trim(),
            visibility,
            cadence,
            ...(scope === "MEMBER" ? { subject_author_id: authorId } : {}),
          },
        });
        if (!scheduleResult.data || !scheduleResult.response.ok) {
          onCreated(result.data);
          onScheduleFailure("本次报告已生成，但定期任务没有保存成功，请重新设置。");
          return;
        }
        createdSubscription = scheduleResult.data;
      }
      onCreated(result.data, createdSubscription);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="insight-create-panel">
      <header>
        <div>
          <span>NEW EVIDENCE REPORT</span>
          <h2>生成报告</h2>
        </div>
        <button type="button" aria-label="关闭报告设置" onClick={onClose}>
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="report-presets">
        {REPORT_PRESETS.map((presetOption) => {
          const Icon = presetOption.icon;
          return (
            <button
              type="button"
              key={presetOption.id}
              className={presetOption.id === selectedPreset ? "is-active" : ""}
              onClick={() => {
                setSelectedPreset(presetOption.id);
                setTopic(presetOption.topic);
              }}
            >
              <Icon aria-hidden="true" size={16} />
              {presetOption.label}
            </button>
          );
        })}
      </div>
      <label>
        <span>报告主题</span>
        <textarea value={topic} onChange={(event) => setTopic(event.target.value)} />
      </label>
      <div className="insight-form-grid">
        <label>
          <span>范围</span>
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as ReportScope);
              setAuthorId("");
              if (event.target.value === "PERSONAL") setVisibility("PRIVATE");
            }}
          >
            <option value="PERSONAL">我的记录</option>
            {collaborative ? <option value="MEMBER">成员共享记录</option> : null}
            {collaborative ? <option value="WORKSPACE">团队共享记录</option> : null}
            {collaborative ? <option value="PROJECT">项目主题</option> : null}
          </select>
        </label>
        {scope === "MEMBER" ? (
          <label>
            <span>成员</span>
            <select value={authorId} onChange={(event) => setAuthorId(event.target.value)}>
              <option value="">选择成员</option>
              {members
                .filter((member) => !member.is_current_user)
                .map((member) => (
                  <option value={member.id} key={member.id}>
                    {member.display_name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label>
          <span>开始日期</span>
          <input
            type="date"
            value={createdFrom}
            onChange={(event) => setCreatedFrom(event.target.value)}
          />
        </label>
        <label>
          <span>结束日期</span>
          <input
            type="date"
            value={createdTo}
            onChange={(event) => setCreatedTo(event.target.value)}
          />
        </label>
      </div>
      {collaborative && scope !== "PERSONAL" ? (
        <div className="insight-visibility" role="group" aria-label="报告可见范围">
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
            onClick={() => setVisibility("WORKSPACE")}
          >
            <Users aria-hidden="true" size={13} />
            团队
          </button>
        </div>
      ) : null}
      <section className={`report-schedule ${recurring ? "is-active" : ""}`}>
        <header>
          <Repeat2 aria-hidden="true" size={16} />
          <span>
            <strong>定期生成</strong>
            <small>按计划自动整理同一范围内的新记忆</small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={recurring}
            aria-label="定期生成报告"
            onClick={() => setRecurring((current) => !current)}
          >
            <span />
          </button>
        </header>
        {recurring ? (
          <div>
            <label>
              <span>生成频率</span>
              <select
                aria-label="生成频率"
                value={cadence}
                onChange={(event) =>
                  setCadence(event.target.value as ReportSubscription["cadence"])
                }
              >
                <option value="DAILY">每天</option>
                <option value="WEEKLY">每周</option>
                <option value="MONTHLY">每月</option>
              </select>
            </label>
            <small>首次自动运行将在{CADENCE_LABELS[cadence]}后进行，每次按实际运行扣费。</small>
          </div>
        ) : null}
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <footer>
        <span>
          本次预计 {creditCost} Credits
          {recurring ? ` · 后续${CADENCE_LABELS[cadence]}运行` : ""}
        </span>
        <button
          type="button"
          disabled={busy || submitting || !topic.trim()}
          onClick={() => void submit()}
        >
          {submitting ? (
            <LoaderCircle aria-hidden="true" size={16} />
          ) : (
            <Sparkles aria-hidden="true" size={16} />
          )}
          生成报告
        </button>
      </footer>
    </section>
  );
}

function ReportSubscriptionList({
  subscriptions,
  busy,
  onToggle,
}: {
  subscriptions: ReportSubscription[];
  busy: string;
  onToggle: (subscription: ReportSubscription) => void;
}) {
  if (!subscriptions.length) return null;
  return (
    <section className="report-subscriptions" aria-label="定期报告">
      <header>
        <Repeat2 aria-hidden="true" size={13} />
        定期报告
        <small>{subscriptions.length}</small>
      </header>
      {subscriptions.map((subscription) => {
        const active = subscription.status === "ACTIVE";
        const pending = busy === `SUBSCRIPTION:${subscription.id}`;
        return (
          <article className={active ? "is-active" : ""} key={subscription.id}>
            <span>
              <strong>{PRESET_LABELS[subscription.preset]}</strong>
              <small>
                {active
                  ? `${CADENCE_LABELS[subscription.cadence]} · 下次 ${new Date(
                      subscription.next_run_at,
                    ).toLocaleDateString("zh-CN")}`
                  : "已暂停"}
              </small>
            </span>
            <button
              type="button"
              disabled={pending}
              aria-label={`${active ? "暂停" : "恢复"}${PRESET_LABELS[subscription.preset]}`}
              onClick={() => onToggle(subscription)}
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" size={14} />
              ) : active ? (
                <Pause aria-hidden="true" size={14} />
              ) : (
                <Play aria-hidden="true" size={14} />
              )}
            </button>
          </article>
        );
      })}
    </section>
  );
}

function PositionCard({
  topic,
  position,
  busy,
  onChanged,
  onOpenMemory,
}: {
  topic: AlignmentTopic;
  position: AlignmentPosition;
  busy: string;
  onChanged: (position: AlignmentPosition) => void;
  onOpenMemory: (memoryId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(position.text ?? "");
  const [error, setError] = useState("");

  async function update(action: "CONFIRM" | "REVISE" | "WITHDRAW") {
    setError("");
    const result = await api.POST("/alignments/{topic_id}/positions/{position_id}/confirm", {
      params: { path: { topic_id: topic.id, position_id: position.id } },
      body: { action, ...(action === "REVISE" ? { text } : {}) },
    });
    if (!result.data || !result.response.ok) {
      setError(requestError(result, "观点暂时无法更新。"));
      return;
    }
    setEditing(false);
    onChanged(result.data);
  }

  return (
    <article className={`alignment-position is-${position.status.toLowerCase()}`}>
      <header>
        <span className="alignment-avatar">{position.display_name.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{position.display_name}</strong>
          <small>{POSITION_LABELS[position.status]}</small>
        </div>
        {position.status === "CONFIRMED" || position.status === "REVISED" ? (
          <Check aria-label="本人已确认" size={16} />
        ) : null}
      </header>
      {editing ? (
        <textarea value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      ) : (
        <p>{position.text ?? "这位成员还没有留下可核对的观点。"}</p>
      )}
      {position.citations.length ? (
        <div className="alignment-citations">
          {position.citations.map((citation) => (
            <button
              type="button"
              key={citation.memory_id}
              onClick={() => onOpenMemory(citation.memory_id)}
            >
              <FileText aria-hidden="true" size={12} />
              {new Date(citation.created_at).toLocaleDateString("zh-CN")}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <small className="alignment-error">{error}</small> : null}
      {position.is_current_user && topic.status === "OPEN" ? (
        <footer>
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={Boolean(busy) || !text.trim()}
                onClick={() => void update("REVISE")}
              >
                确认我的修正
              </button>
            </>
          ) : (
            <>
              {position.status === "CANDIDATE" ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void update("CONFIRM")}
                >
                  <Check aria-hidden="true" size={13} />
                  这是我的观点
                </button>
              ) : null}
              <button type="button" onClick={() => setEditing(true)}>
                {position.text ? "修正" : "填写我的观点"}
              </button>
              {position.text ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void update("WITHDRAW")}
                >
                  撤回
                </button>
              ) : null}
            </>
          )}
        </footer>
      ) : null}
    </article>
  );
}

function AlignmentCreatePanel({
  busy,
  onClose,
  onCreated,
  onUpgrade,
  creditCost,
}: {
  busy: boolean;
  onClose: () => void;
  onCreated: (topic: AlignmentTopic) => void;
  onUpgrade: () => void;
  creditCost: number;
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const result = await api.POST("/alignments", {
        body: { title: title.trim(), context: context.trim(), participant_ids: [] },
      });
      if (!result.data || !result.response.ok) {
        setError(requestError(result, "对齐议题暂时无法创建。"));
        if (result.response.status === 402) onUpgrade();
        return;
      }
      onCreated(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="insight-create-panel alignment-create-panel">
      <header>
        <div>
          <span>NEW ALIGNMENT TOPIC</span>
          <h2>发起观点对齐</h2>
        </div>
        <button type="button" aria-label="关闭议题设置" onClick={onClose}>
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <label>
        <span>需要对齐的问题</span>
        <input
          value={title}
          placeholder="例如：下一阶段应该优先服务哪类用户？"
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        <span>背景说明</span>
        <textarea
          value={context}
          placeholder="补充目标、限制或需要确认的范围"
          onChange={(event) => setContext(event.target.value)}
        />
      </label>
      <p className="alignment-boundary-copy">
        系统只从成员已共享的记忆中提出候选观点；每位成员只能确认自己的观点。
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <footer>
        <span>预计消耗 {creditCost} Credits</span>
        <button
          type="button"
          disabled={busy || submitting || !title.trim()}
          onClick={() => void submit()}
        >
          {submitting ? (
            <LoaderCircle aria-hidden="true" size={16} />
          ) : (
            <GitCompareArrows aria-hidden="true" size={16} />
          )}
          创建议题
        </button>
      </footer>
    </section>
  );
}

function DecisionComposer({
  topic,
  busy,
  onCreated,
}: {
  topic: AlignmentTopic;
  busy: boolean;
  onCreated: (topic: AlignmentTopic) => void;
}) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState("");
  const [rationale, setRationale] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [reviewAt, setReviewAt] = useState("");
  const [error, setError] = useState("");

  async function publish() {
    setError("");
    const result = await api.POST("/alignments/{topic_id}/decisions", {
      params: { path: { topic_id: topic.id } },
      body: {
        decision: decision.trim(),
        rationale: rationale.trim(),
        alternatives: alternatives
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        review_at: reviewAt ? new Date(`${reviewAt}T09:00:00`).toISOString() : null,
        supersedes_id: topic.decisions[0]?.id ?? null,
      },
    });
    if (!result.data || !result.response.ok) {
      setError(requestError(result, "最终决策暂时无法发布。"));
      return;
    }
    const refreshed = await api.GET("/alignments/{topic_id}", {
      params: { path: { topic_id: topic.id } },
    });
    if (refreshed.data && refreshed.response.ok) onCreated(refreshed.data);
    setOpen(false);
  }

  if (!topic.can_publish_decision) return null;
  if (!open) {
    return (
      <button className="decision-open-button" type="button" onClick={() => setOpen(true)}>
        <BookOpenCheck aria-hidden="true" size={15} />
        {topic.decisions.length ? "发布补充决策" : "形成最终决策"}
      </button>
    );
  }
  return (
    <section className="decision-composer">
      <header>
        <strong>发布团队决策</strong>
        <button type="button" aria-label="关闭决策编辑" onClick={() => setOpen(false)}>
          <X aria-hidden="true" size={15} />
        </button>
      </header>
      <label>
        <span>最终决定</span>
        <textarea value={decision} onChange={(event) => setDecision(event.target.value)} />
      </label>
      <label>
        <span>理由</span>
        <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} />
      </label>
      <label>
        <span>备选方案（每行一个）</span>
        <textarea value={alternatives} onChange={(event) => setAlternatives(event.target.value)} />
      </label>
      <label>
        <span>复盘日期</span>
        <input type="date" value={reviewAt} onChange={(event) => setReviewAt(event.target.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        disabled={busy || !decision.trim() || !rationale.trim()}
        onClick={() => void publish()}
      >
        发布为新的团队记忆
        <ArrowRight aria-hidden="true" size={14} />
      </button>
    </section>
  );
}

function AlignmentDetail({
  topic,
  busy,
  onTopicChange,
  onOpenMemory,
}: {
  topic: AlignmentTopic | null;
  busy: string;
  onTopicChange: (topic: AlignmentTopic) => void;
  onOpenMemory: (memoryId: string) => void;
}) {
  if (!topic) {
    return (
      <div className="insight-empty-detail">
        <GitCompareArrows aria-hidden="true" size={28} />
        <strong>让差异被准确表达</strong>
        <span>发起议题后，每个人只确认自己的观点，系统不会代替团队作出决定。</span>
      </div>
    );
  }
  return (
    <article className="alignment-detail">
      <header>
        <span>{SUMMARY_LABELS[topic.summary_status]}</span>
        <h2>{topic.title}</h2>
        {topic.context ? <p>{topic.context}</p> : null}
        <small>
          证据范围：{new Date(topic.evidence_from).toLocaleDateString("zh-CN")} -{" "}
          {new Date(topic.evidence_to).toLocaleDateString("zh-CN")}
        </small>
      </header>
      <section className="alignment-position-grid">
        {topic.positions.map((position) => (
          <PositionCard
            topic={topic}
            position={position}
            busy={busy}
            key={position.id}
            onOpenMemory={onOpenMemory}
            onChanged={(updated) =>
              onTopicChange({
                ...topic,
                positions: topic.positions.map((item) => (item.id === updated.id ? updated : item)),
              })
            }
          />
        ))}
      </section>
      <DecisionComposer topic={topic} busy={Boolean(busy)} onCreated={onTopicChange} />
      {topic.decisions.length ? (
        <section className="decision-history">
          <header>
            <BookOpenCheck aria-hidden="true" size={15} />
            决策记录
          </header>
          {topic.decisions.map((decision) => (
            <article key={decision.id}>
              <strong>{decision.decision}</strong>
              <p>{decision.rationale}</p>
              <footer>
                <button type="button" onClick={() => onOpenMemory(decision.memory_id)}>
                  查看正式记忆
                  <ChevronRight aria-hidden="true" size={13} />
                </button>
                {decision.review_at ? (
                  <span>复盘 {new Date(decision.review_at).toLocaleDateString("zh-CN")}</span>
                ) : null}
              </footer>
            </article>
          ))}
        </section>
      ) : null}
    </article>
  );
}

export function TeamIntelligenceWorkspace({
  workspace,
  members,
  subscription,
  onSubscriptionChange,
  onUpgrade,
  onOpenMemory,
  onMemoryCreated,
  onCreateVisual,
  onNotify,
}: {
  workspace: Workspace;
  members: WorkspaceMember[];
  subscription: Subscription | null;
  onSubscriptionChange: (subscription: Subscription) => void;
  onUpgrade: () => void;
  onOpenMemory: (memoryId: string) => void;
  onMemoryCreated: (memory: Memory) => void;
  onCreateVisual: (projectId: string, memoryIds: string[]) => void;
  onNotify: (message: string) => void;
}) {
  const collaborative = isCollaborativeWorkspace(workspace);
  const [tab, setTab] = useState<InsightTab>("REPORTS");
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [reportSubscriptions, setReportSubscriptions] = useState<ReportSubscription[]>([]);
  const [topics, setTopics] = useState<AlignmentTopic[]>([]);
  const [taskCosts, setTaskCosts] = useState<Record<string, number>>({});
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState<"REPORT" | "ALIGNMENT" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const selectedReport = reports.find((report) => report.report_id === selectedReportId) ?? null;
  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) ?? null;
  const decisions = useMemo(
    () => topics.flatMap((topic) => topic.decisions.map((decision) => ({ topic, decision }))),
    [topics],
  );

  useEffect(() => {
    let active = true;
    const alignmentRequest = collaborative ? api.GET("/alignments") : Promise.resolve(null);
    const requests = Promise.all([
      api.GET("/reports"),
      api.GET("/report-subscriptions"),
      alignmentRequest,
      api.GET("/visuals/costs"),
    ]);
    void requests
      .then(([reportResult, subscriptionResult, alignmentResult, costResult]) => {
        if (!active) return;
        const nextReports = reportResult.data && reportResult.response.ok ? reportResult.data : [];
        const nextSubscriptions =
          subscriptionResult.data && subscriptionResult.response.ok ? subscriptionResult.data : [];
        const nextTopics =
          alignmentResult?.data && alignmentResult.response.ok ? alignmentResult.data : [];
        setReports(nextReports);
        setReportSubscriptions(nextSubscriptions);
        setTopics(nextTopics);
        setTaskCosts(costResult.data && costResult.response.ok ? costResult.data : {});
        setSelectedReportId(nextReports[0]?.report_id ?? null);
        setSelectedTopicId(nextTopics[0]?.id ?? null);
      })
      .catch(() => {
        if (active) setError("团队智能暂时无法载入，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id, collaborative]);

  async function refreshSubscription() {
    const result = await api.GET("/billing/subscription");
    if (result.data && result.response.ok) onSubscriptionChange(result.data);
  }

  async function saveReport() {
    if (!selectedReport) return;
    setBusy("SAVE_REPORT");
    const result = await api.POST("/reports/{report_id}/save-memory", {
      params: { path: { report_id: selectedReport.report_id } },
      body: { visibility: "PRIVATE" },
    });
    if (result.data && result.response.ok) {
      onMemoryCreated(result.data);
      setReports((current) =>
        current.map((report) =>
          report.report_id === selectedReport.report_id
            ? { ...report, saved_memory_id: result.data.id }
            : report,
        ),
      );
      onNotify("报告已保存为一条新的私有记忆");
    } else {
      setError(requestError(result, "报告暂时无法保存。"));
    }
    setBusy("");
  }

  async function createVisualFromReport() {
    if (!selectedReport) return;
    setBusy("CREATE_VISUAL");
    const result = await api.POST("/reports/{report_id}/create-visual", {
      params: { path: { report_id: selectedReport.report_id } },
      body: { kind: "MIND_MAP", visibility: "PRIVATE" },
    });
    if (result.data && result.response.ok) {
      onCreateVisual(result.data.project.id, result.data.memory_ids);
    } else {
      setError(requestError(result, "暂时无法从报告创建框图。"));
    }
    setBusy("");
  }

  function upsertTopic(topic: AlignmentTopic) {
    setTopics((current) => [topic, ...current.filter((item) => item.id !== topic.id)]);
    setSelectedTopicId(topic.id);
  }

  async function toggleReportSubscription(subscription: ReportSubscription) {
    setBusy(`SUBSCRIPTION:${subscription.id}`);
    const nextStatus = subscription.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    const result = await api.PATCH("/report-subscriptions/{subscription_id}", {
      params: { path: { subscription_id: subscription.id } },
      body: { status: nextStatus },
    });
    if (result.data && result.response.ok) {
      setReportSubscriptions((current) =>
        current.map((item) => (item.id === result.data.id ? result.data : item)),
      );
      onNotify(nextStatus === "ACTIVE" ? "定期报告已恢复" : "定期报告已暂停");
    } else {
      setError(requestError(result, "定期报告状态暂时无法更新。"));
    }
    setBusy("");
  }

  if (loading) {
    return (
      <div className="insight-loading" role="status">
        <LoaderCircle aria-hidden="true" size={20} />
        正在整理工作空间洞察
      </div>
    );
  }

  return (
    <section className="insight-workspace">
      <header className="insight-workspace-header">
        <div>
          <span>{collaborative ? "AI NATIVE TEAM MEMORY" : "PERSONAL MEMORY INSIGHTS"}</span>
          <h1>{collaborative ? "团队智能" : "我的洞察"}</h1>
        </div>
        <div>
          <span>
            <Sparkles aria-hidden="true" size={14} />
            {subscription?.credits_remaining ?? 0} Credits
          </span>
          <button
            type="button"
            onClick={() => setCreateMode(tab === "ALIGNMENT" ? "ALIGNMENT" : "REPORT")}
          >
            <Plus aria-hidden="true" size={15} />
            {tab === "ALIGNMENT" ? "发起对齐" : "生成报告"}
          </button>
        </div>
      </header>

      <nav className="insight-tabs" aria-label="团队智能视图">
        <button
          className={tab === "REPORTS" ? "is-active" : ""}
          type="button"
          onClick={() => setTab("REPORTS")}
        >
          报告
          <small>{reports.length}</small>
        </button>
        {collaborative ? (
          <button
            className={tab === "ALIGNMENT" ? "is-active" : ""}
            type="button"
            onClick={() => setTab("ALIGNMENT")}
          >
            对齐
            <small>{topics.length}</small>
          </button>
        ) : null}
        {collaborative ? (
          <button
            className={tab === "DECISIONS" ? "is-active" : ""}
            type="button"
            onClick={() => setTab("DECISIONS")}
          >
            决策
            <small>{decisions.length}</small>
          </button>
        ) : null}
      </nav>

      {error ? (
        <div className="insight-error" role="alert">
          <CircleAlert aria-hidden="true" size={15} />
          {error}
          <button type="button" aria-label="关闭错误" onClick={() => setError("")}>
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <div className="insight-layout">
        <aside className="insight-list">
          {tab === "REPORTS" ? (
            <>
              <ReportSubscriptionList
                subscriptions={reportSubscriptions}
                busy={busy}
                onToggle={(subscription) => void toggleReportSubscription(subscription)}
              />
              {reports.map((report) => (
                <button
                  className={report.report_id === selectedReportId ? "is-active" : ""}
                  type="button"
                  key={report.report_id}
                  onClick={() => setSelectedReportId(report.report_id)}
                >
                  <ScopeIcon scope={report.scope} />
                  <span>
                    <strong>{report.title}</strong>
                    <small>{new Date(report.created_at).toLocaleDateString("zh-CN")}</small>
                  </span>
                </button>
              ))}
            </>
          ) : tab === "ALIGNMENT" ? (
            topics.map((topic) => (
              <button
                className={topic.id === selectedTopicId ? "is-active" : ""}
                type="button"
                key={topic.id}
                onClick={() => setSelectedTopicId(topic.id)}
              >
                <GitCompareArrows aria-hidden="true" size={15} />
                <span>
                  <strong>{topic.title}</strong>
                  <small>{SUMMARY_LABELS[topic.summary_status]}</small>
                </span>
              </button>
            ))
          ) : (
            decisions.map(({ topic, decision }) => (
              <button
                type="button"
                key={decision.id}
                onClick={() => onOpenMemory(decision.memory_id)}
              >
                <BookOpenCheck aria-hidden="true" size={15} />
                <span>
                  <strong>{topic.title}</strong>
                  <small>{new Date(decision.created_at).toLocaleDateString("zh-CN")}</small>
                </span>
              </button>
            ))
          )}
          {tab === "REPORTS" && !reports.length ? <p>还没有生成报告。</p> : null}
          {tab === "ALIGNMENT" && !topics.length ? <p>还没有发起对齐议题。</p> : null}
          {tab === "DECISIONS" && !decisions.length ? <p>还没有正式决策。</p> : null}
        </aside>

        <main className="insight-detail-stage">
          {tab === "REPORTS" ? (
            <ReportDetail
              report={selectedReport}
              busy={busy}
              onOpenMemory={onOpenMemory}
              onSave={() => void saveReport()}
              onCreateVisual={() => void createVisualFromReport()}
            />
          ) : tab === "ALIGNMENT" ? (
            <AlignmentDetail
              topic={selectedTopic}
              busy={busy}
              onOpenMemory={onOpenMemory}
              onTopicChange={upsertTopic}
            />
          ) : (
            <section className="decision-overview">
              <header>
                <Lightbulb aria-hidden="true" size={18} />
                <div>
                  <h2>正式决策</h2>
                  <p>每项决定都是新的团队记忆，保留成员观点、备选方案和复盘时间。</p>
                </div>
              </header>
              {decisions.map(({ topic, decision }) => (
                <article key={decision.id}>
                  <span>{topic.title}</span>
                  <h3>{decision.decision}</h3>
                  <p>{decision.rationale}</p>
                  <button type="button" onClick={() => onOpenMemory(decision.memory_id)}>
                    查看决策记忆
                    <ArrowRight aria-hidden="true" size={14} />
                  </button>
                </article>
              ))}
            </section>
          )}
        </main>
      </div>

      {createMode === "REPORT" ? (
        <ReportCreatePanel
          workspace={workspace}
          members={members}
          busy={Boolean(busy)}
          onClose={() => setCreateMode(null)}
          onScheduleFailure={setError}
          onUpgrade={onUpgrade}
          creditCost={taskCosts.report ?? 0}
          onCreated={(report, createdSubscription) => {
            setReports((current) => [report, ...current]);
            if (createdSubscription) {
              setReportSubscriptions((current) => [createdSubscription, ...current]);
            }
            setSelectedReportId(report.report_id);
            setCreateMode(null);
            void refreshSubscription();
            onNotify(createdSubscription ? "报告已生成，定期任务已启用" : "报告已生成并安全保存");
          }}
        />
      ) : null}
      {createMode === "ALIGNMENT" ? (
        <AlignmentCreatePanel
          busy={Boolean(busy)}
          onClose={() => setCreateMode(null)}
          onUpgrade={onUpgrade}
          creditCost={taskCosts.alignment ?? 0}
          onCreated={(topic) => {
            upsertTopic(topic);
            setCreateMode(null);
            void refreshSubscription();
            onNotify("对齐议题已创建，等待成员确认各自观点");
          }}
        />
      ) : null}
    </section>
  );
}
