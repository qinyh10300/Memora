"use client";

import type { components } from "@memora/api-contract";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import {
  inferTimeRange,
  MessageRoute,
  parseVisibilityChoice,
  QueryRoute,
  QuestionRoute,
  ReportRoute,
  routeMessage,
} from "@/lib/conversation-router";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type Citation = components["schemas"]["EvidenceCitationResponse"];
type ModelStatus = components["schemas"]["ChatResponse"]["model_status"];

type ConversationMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: Citation[];
  meta?: string;
};

type PendingClarification = {
  kind: "TOPIC" | "TIME";
  route: QueryRoute;
};

type PendingColleague = {
  queryKind: QueryRoute["kind"];
  question: string;
  topic: string | null;
  timeRange: QueryRoute["timeRange"];
};

type CaptureDraft = {
  body: string;
  supersedesId: string | null;
};

type MemoryCommand = Extract<
  MessageRoute,
  { kind: "SHARE_LATEST" | "UNSHARE_LATEST" | "DELETE_LATEST" | "SUPPLEMENT_LATEST" }
>;

const demoAccounts = [
  { name: "Alex", email: "alex@memora.local" },
  { name: "Blair", email: "blair@memora.local" },
  { name: "Casey", email: "casey@memora.local" },
  { name: "Devon", email: "devon@memora.local" },
];

let messageSequence = 0;

function messageId() {
  messageSequence += 1;
  return `message-${Date.now()}-${messageSequence}`;
}

function scopeLabel(
  scope: QueryRoute["scope"],
  members: WorkspaceMember[],
  authorId: string | null,
) {
  if (scope === "PERSONAL") return "仅检索你的记录";
  if (scope === "WORKSPACE") return "检索你有权访问的团队记录";
  const member = members.find((item) => item.id === authorId);
  return `仅检索 ${member?.display_name ?? "指定同事"} 主动共享的记录`;
}

function modelLabel(status: ModelStatus) {
  if (status === "AVAILABLE") return "AI 回答";
  if (status === "DEGRADED") return "AI 暂时降级 · 证据模式";
  return "基础证据模式";
}

function Logo() {
  return (
    <span className="logo-mark" aria-hidden="true">
      M
    </span>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M12 19V5m0 0-6 6m6-6 6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState(demoAccounts[0].email);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
          <p className="overline">YOUR PRIVATE MEMORY</p>
          <h1 id="login-title">继续你的对话</h1>
          <p>把想法告诉 Memora，之后随时问回来。新记录始终先征求你的共享选择。</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
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
          <summary>本地测试账号</summary>
          <div className="demo-account-list">
            {demoAccounts.map((account) => (
              <button key={account.email} type="button" onClick={() => setEmail(account.email)}>
                <span>{account.name}</span>
                <small>{account.email}</small>
              </button>
            ))}
          </div>
        </details>
        <p className="login-footnote">默认私有 · 明确共享 · 回答附带来源</p>
      </section>
    </main>
  );
}

function CitationList({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="source-list" aria-label={`回答来源，共 ${citations.length} 条`}>
      <p className="source-heading">来源 · {citations.length}</p>
      {citations.map((citation, index) => (
        <details
          className="source-card"
          id={`memory-${citation.memory_id}`}
          key={citation.memory_id}
        >
          <summary>
            <span>{index + 1}</span>
            <strong>{citation.author.display_name}</strong>
            <time dateTime={citation.created_at}>
              {new Intl.DateTimeFormat("zh-CN", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(citation.created_at))}
            </time>
          </summary>
          <p>{citation.excerpt}</p>
        </details>
      ))}
    </div>
  );
}

function ChatScreen({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesError, setMemoriesError] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: "welcome",
      role: "ASSISTANT",
      content:
        "把一个想法直接发给我，我会先问你存给自己还是共享给团队。你也可以问：“我之前记了什么？”",
      meta: "默认只检索你的记录",
    },
  ]);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<CaptureDraft | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [pendingClarification, setPendingClarification] = useState<PendingClarification | null>(
    null,
  );
  const [pendingColleague, setPendingColleague] = useState<PendingColleague | null>(null);
  const conversationEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.GET("/workspace/members"), api.GET("/memories")])
      .then(([membersResult, memoriesResult]) => {
        if (!active) return;
        if (membersResult.data) setMembers([...membersResult.data]);
        else setMembersError("暂时无法读取工作区成员，个人记录仍可正常使用。");
        if (memoriesResult.data) setMemories([...memoriesResult.data]);
        else setMemoriesError("暂时无法读取最近记录，记录管理命令暂不可用。");
      })
      .catch(() => {
        if (!active) return;
        setMembersError("暂时无法读取工作区成员，个人记录仍可正常使用。");
        setMemoriesError("暂时无法读取最近记录，记录管理命令暂不可用。");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const target = conversationEnd.current;
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, busy]);

  function appendMessage(message: Omit<ConversationMessage, "id">) {
    setMessages((current) => [...current, { ...message, id: messageId() }]);
  }

  async function askQuestion(route: QuestionRoute) {
    setBusy(true);
    try {
      const { data, response } = await api.POST("/chat/questions", {
        body: {
          question: route.question,
          topic: route.topic,
          scope: route.scope,
          author_id: route.authorId,
          created_from: route.timeRange?.createdFrom ?? null,
          created_to: route.timeRange?.createdTo ?? null,
          evidence_limit: 8,
        },
      });
      if (!data || !response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content:
            response.status === 429
              ? "请求有点频繁，请稍后再问我。"
              : "这次没有完成。我没有保存或改动任何记录，请稍后重试。",
          meta: "请求失败",
        });
        return;
      }
      if (data.status === "NEEDS_CLARIFICATION") {
        const kind: PendingClarification["kind"] = data.answer.includes("日期") ? "TIME" : "TOPIC";
        setPendingClarification({ kind, route });
        appendMessage({ role: "ASSISTANT", content: data.answer, meta: "需要补充范围" });
        return;
      }
      setPendingClarification(null);
      appendMessage({
        role: "ASSISTANT",
        content: data.answer,
        citations: [...data.citations],
        meta: `${scopeLabel(route.scope, members, route.authorId)} · ${modelLabel(data.model_status)}`,
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法连接 Memora。我没有保存或改动任何记录，请稍后重试。",
        meta: "连接失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function generateReport(route: ReportRoute) {
    if (!route.topic || !route.timeRange) return;
    setBusy(true);
    try {
      const { data, response } = await api.POST("/reports", {
        body: {
          scope: route.scope,
          author_id: route.authorId,
          topic: route.topic,
          created_from: route.timeRange.createdFrom,
          created_to: route.timeRange.createdTo,
          evidence_limit: 20,
        },
      });
      if (!data || !response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content:
            response.status === 429
              ? "报告请求有点频繁，请稍后再试。"
              : "这次报告没有生成成功。我没有改动任何记录，请稍后重试。",
          meta: "报告生成失败",
        });
        return;
      }
      const sections = data.sections
        .map((section) => `${section.title}\n${section.content}`)
        .join("\n\n");
      appendMessage({
        role: "ASSISTANT",
        content: `${data.title}\n\n${data.summary}${sections ? `\n\n${sections}` : ""}`,
        citations: [...data.citations],
        meta: `${scopeLabel(route.scope, members, route.authorId)} · ${modelLabel(data.model_status)} · 显式时间范围`,
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法连接 Memora。这次报告没有生成，我也没有改动任何记录。",
        meta: "连接失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function dispatchQuery(route: QueryRoute) {
    if (!route.topic) {
      setPendingClarification({ kind: "TOPIC", route });
      appendMessage({
        role: "ASSISTANT",
        content: "你想回顾哪个主题？如果希望查看全部记录，可以直接回复“全部”。",
        meta: "等待检索主题",
      });
      return;
    }
    if (route.kind === "REPORT") {
      if (!route.timeRange) {
        setPendingClarification({ kind: "TIME", route });
        appendMessage({
          role: "ASSISTANT",
          content: "报告需要明确时间范围。你可以回复“最近 7 天”，或“2026-07-01 到 2026-07-22”。",
          meta: "等待报告时间范围",
        });
        return;
      }
      await generateReport(route);
      return;
    }
    await askQuestion(route);
  }

  async function saveCapture(visibility: "PRIVATE" | "WORKSPACE") {
    if (!pendingCapture) return;
    const draft = pendingCapture;
    setBusy(true);
    let created: Memory | null = null;
    try {
      const result = await api.POST("/memories", {
        body: { body: draft.body, supersedes_id: draft.supersedesId },
      });
      if (!result.data || !result.response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "这条内容没有保存成功。我保留了草稿，你可以重新选择保存范围。",
          meta: "未保存",
        });
        return;
      }
      created = result.data;
      setMemories((current) => [created as Memory, ...current]);
      if (visibility === "WORKSPACE") {
        const shared = await api.POST("/memories/{memory_id}/share", {
          params: { path: { memory_id: created.id } },
        });
        if (!shared.data || !shared.response.ok) {
          setPendingCapture(null);
          appendMessage({
            role: "ASSISTANT",
            content: "OK，已保存，但团队共享没有成功。这条记录目前仍然仅你可见。",
            meta: "已私有保存 · 共享失败",
          });
          return;
        }
        setMemories((current) =>
          current.map((memory) => (memory.id === shared.data.id ? shared.data : memory)),
        );
      }
      setPendingCapture(null);
      appendMessage({
        role: "ASSISTANT",
        content:
          visibility === "WORKSPACE" ? "OK，已保存并共享给团队。" : "OK，已保存。只有你可以看到。",
        meta: visibility === "WORKSPACE" ? "工作区共享" : "仅自己可见",
      });
    } catch {
      if (created) {
        setPendingCapture(null);
        appendMessage({
          role: "ASSISTANT",
          content: "OK，已保存，但团队共享没有成功。这条记录目前仍然仅你可见。",
          meta: "已私有保存 · 共享失败",
        });
      } else {
        appendMessage({
          role: "ASSISTANT",
          content: "暂时无法连接 Memora。这条内容尚未保存，草稿仍在当前对话中。",
          meta: "未保存",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  function latestOwnedMemory() {
    return memories.find((memory) => memory.is_owner) ?? null;
  }

  async function executeMemoryCommand(command: MemoryCommand) {
    if (memoriesError) {
      appendMessage({ role: "ASSISTANT", content: memoriesError, meta: "没有执行操作" });
      return;
    }
    const memory = latestOwnedMemory();
    if (!memory) {
      appendMessage({
        role: "ASSISTANT",
        content: "你还没有可以操作的记录。先告诉我一个想法吧。",
        meta: "没有执行操作",
      });
      return;
    }
    if (command.kind === "DELETE_LATEST") {
      setPendingDelete(memory);
      appendMessage({
        role: "ASSISTANT",
        content: `确认删除上一条记录吗？“${memory.body.slice(0, 80)}${memory.body.length > 80 ? "…" : ""}”`,
        meta: "删除后正文不可恢复",
      });
      return;
    }
    if (command.kind === "SUPPLEMENT_LATEST") {
      setPendingCapture({ body: command.body, supersedesId: memory.id });
      appendMessage({
        role: "ASSISTANT",
        content: "这条补充是存给自己，还是共享给团队？",
        meta: "尚未保存 · 将关联上一条记录",
      });
      return;
    }
    if (command.kind === "SHARE_LATEST" && memory.visibility === "WORKSPACE") {
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录已经共享给团队。",
        meta: "没有重复操作",
      });
      return;
    }
    if (command.kind === "UNSHARE_LATEST" && memory.visibility === "PRIVATE") {
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录本来就只有你可见。",
        meta: "没有重复操作",
      });
      return;
    }

    setBusy(true);
    try {
      const result =
        command.kind === "SHARE_LATEST"
          ? await api.POST("/memories/{memory_id}/share", {
              params: { path: { memory_id: memory.id } },
            })
          : await api.POST("/memories/{memory_id}/unshare", {
              params: { path: { memory_id: memory.id } },
            });
      if (!result.data || !result.response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "上一条记录的共享范围没有更新成功，请稍后重试。",
          meta: "操作失败",
        });
        return;
      }
      const updated = result.data;
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      appendMessage({
        role: "ASSISTANT",
        content:
          command.kind === "SHARE_LATEST"
            ? "OK，上一条记录已共享给团队。"
            : "OK，上一条记录已改为仅自己可见。",
        meta: command.kind === "SHARE_LATEST" ? "工作区共享" : "仅自己可见",
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法更新上一条记录的共享范围，请稍后重试。",
        meta: "操作失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolveDelete(confirm: boolean, reply: string, appendReply = true) {
    if (!pendingDelete || busy) return;
    if (appendReply) appendMessage({ role: "USER", content: reply });
    if (!confirm) {
      setPendingDelete(null);
      appendMessage({ role: "ASSISTANT", content: "已取消删除。", meta: "记录未改动" });
      return;
    }
    const memory = pendingDelete;
    setBusy(true);
    try {
      const { response } = await api.DELETE("/memories/{memory_id}", {
        params: { path: { memory_id: memory.id } },
      });
      if (!response.ok) {
        appendMessage({
          role: "ASSISTANT",
          content: "删除没有成功，记录仍然保留。",
          meta: "操作失败",
        });
        return;
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setPendingDelete(null);
      appendMessage({
        role: "ASSISTANT",
        content: "上一条记录已删除。",
        meta: "正文与检索投影已移除",
      });
    } catch {
      appendMessage({
        role: "ASSISTANT",
        content: "暂时无法删除，记录仍然保留。",
        meta: "操作失败",
      });
    } finally {
      setBusy(false);
    }
  }

  async function resolveVisibility(visibility: "PRIVATE" | "WORKSPACE", reply: string) {
    if (busy || !pendingCapture) return;
    appendMessage({ role: "USER", content: reply });
    await saveCapture(visibility);
  }

  async function processMessage(content: string) {
    appendMessage({ role: "USER", content });

    if (pendingCapture) {
      const visibility = parseVisibilityChoice(content);
      if (!visibility) {
        appendMessage({
          role: "ASSISTANT",
          content: "请明确告诉我：“只存给自己”或“共享给团队”。在你选择前，我不会保存。",
          meta: "等待共享选择",
        });
        return;
      }
      await saveCapture(visibility);
      return;
    }

    if (pendingDelete) {
      if (/^确认删除[。.!！]?$/.test(content.trim())) {
        await resolveDelete(true, content, false);
      } else if (/^(?:取消|不要删除|保留)[。.!！]?$/.test(content.trim())) {
        await resolveDelete(false, content, false);
      } else {
        appendMessage({
          role: "ASSISTANT",
          content: "请回复“确认删除”或“取消”。在你确认前，记录不会被删除。",
          meta: "等待删除确认",
        });
      }
      return;
    }

    if (pendingClarification) {
      if (pendingClarification.kind === "TIME") {
        const timeRange = inferTimeRange(content);
        if (!timeRange) {
          appendMessage({
            role: "ASSISTANT",
            content: "请给我明确时间，例如“最近 7 天”或“2026-07-01 到 2026-07-22”。",
            meta: "等待时间范围",
          });
          return;
        }
        const route = { ...pendingClarification.route, timeRange };
        setPendingClarification(null);
        await dispatchQuery(route);
        return;
      }
      const route = { ...pendingClarification.route, topic: content.trim() };
      setPendingClarification(null);
      await dispatchQuery(route);
      return;
    }

    if (pendingColleague) {
      const normalized = content.toLocaleLowerCase("zh-CN");
      const colleague = members.find(
        (member) =>
          member.id !== user.id &&
          normalized.includes(member.display_name.toLocaleLowerCase("zh-CN")),
      );
      if (!colleague) {
        appendMessage({
          role: "ASSISTANT",
          content: `请告诉我具体是哪位同事：${members
            .filter((member) => member.id !== user.id)
            .map((member) => member.display_name)
            .join("、")}。`,
          meta: "不会检索未指定成员",
        });
        return;
      }
      const route: QueryRoute = {
        kind: pendingColleague.queryKind,
        question: pendingColleague.question,
        topic: pendingColleague.topic,
        scope: "COLLEAGUE",
        authorId: colleague.id,
        timeRange: pendingColleague.timeRange,
      };
      setPendingColleague(null);
      await dispatchQuery(route);
      return;
    }

    const route = routeMessage(content, members, user.id);
    if (route.kind === "CAPTURE") {
      setPendingCapture({ body: route.body, supersedesId: null });
      appendMessage({
        role: "ASSISTANT",
        content: "这条内容是存给自己，还是共享给团队？",
        meta: "尚未保存",
      });
      return;
    }
    if (
      route.kind === "SHARE_LATEST" ||
      route.kind === "UNSHARE_LATEST" ||
      route.kind === "DELETE_LATEST" ||
      route.kind === "SUPPLEMENT_LATEST"
    ) {
      await executeMemoryCommand(route);
      return;
    }
    if (route.kind === "NEEDS_COLLEAGUE") {
      setPendingColleague(route);
      appendMessage({
        role: "ASSISTANT",
        content: `你想了解哪位同事？请告诉我名字：${members
          .filter((member) => member.id !== user.id)
          .map((member) => member.display_name)
          .join("、")}。`,
        meta: "先明确成员，再执行授权检索",
      });
      return;
    }
    await dispatchQuery(route);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = composer.trim();
    if (!content || busy) return;
    setComposer("");
    await processMessage(content);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const showVisibilityChoices = pendingCapture !== null && !busy;
  const showDeleteChoices = pendingDelete !== null && !busy;
  const showColleagueChoices = pendingColleague !== null && !busy;

  return (
    <main className="chat-page">
      <header className="chat-header">
        <div className="brand-lockup">
          <Logo />
          <div>
            <h1>Memora</h1>
            <span>{user.workspace_name}</span>
          </div>
        </div>
        <div className="header-actions">
          <span className="privacy-status">
            <i /> 默认私有
          </span>
          <details className="account-menu">
            <summary aria-label="打开账号菜单">
              {user.display_name.slice(0, 1).toUpperCase()}
            </summary>
            <div className="account-popover">
              <strong>{user.display_name}</strong>
              <span>{user.email}</span>
              <button type="button" onClick={onLogout}>
                退出登录
              </button>
            </div>
          </details>
        </div>
      </header>

      <section className="conversation" aria-label="与 Memora 的对话">
        <div className="conversation-inner">
          <div className="conversation-title">
            <span className="assistant-orb">
              <Logo />
            </span>
            <h2>今天想记下什么？</h2>
            <p>说出一个想法，或者问问过去的自己。</p>
          </div>

          <div className="message-list" aria-live="polite">
            {messages.map((message) => (
              <article className={`message message-${message.role.toLowerCase()}`} key={message.id}>
                {message.role === "ASSISTANT" ? (
                  <span className="message-avatar">
                    <Logo />
                  </span>
                ) : null}
                <div className="message-content">
                  <p>{message.content}</p>
                  {message.meta ? <small>{message.meta}</small> : null}
                  {message.citations ? <CitationList citations={message.citations} /> : null}
                </div>
              </article>
            ))}
            {busy ? (
              <div className="thinking" role="status" aria-label="Memora 正在处理">
                <span />
                <span />
                <span />
              </div>
            ) : null}
            {showVisibilityChoices ? (
              <div className="quick-replies" aria-label="选择保存范围">
                <button
                  type="button"
                  onClick={() => void resolveVisibility("PRIVATE", "只存给自己")}
                >
                  只存给自己
                </button>
                <button
                  type="button"
                  onClick={() => void resolveVisibility("WORKSPACE", "共享给团队")}
                >
                  共享给团队
                </button>
              </div>
            ) : null}
            {showDeleteChoices ? (
              <div className="quick-replies danger-replies" aria-label="确认删除">
                <button type="button" onClick={() => void resolveDelete(true, "确认删除")}>
                  确认删除
                </button>
                <button type="button" onClick={() => void resolveDelete(false, "取消")}>
                  取消
                </button>
              </div>
            ) : null}
            {showColleagueChoices ? (
              <div className="quick-replies" aria-label="选择同事">
                {members
                  .filter((member) => member.id !== user.id)
                  .map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => void processMessage(member.display_name)}
                    >
                      {member.display_name}
                    </button>
                  ))}
              </div>
            ) : null}
            {membersError ? (
              <p className="inline-notice" role="alert">
                {membersError}
              </p>
            ) : null}
            <div ref={conversationEnd} />
          </div>
        </div>
      </section>

      <footer className="composer-dock">
        <form className="composer-form" onSubmit={handleSubmit}>
          <label className="sr-only" htmlFor="message-composer">
            给 Memora 发消息
          </label>
          <textarea
            id="message-composer"
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="记录一个想法，或问：我之前记了什么？"
            maxLength={10_000}
            rows={1}
            disabled={busy}
          />
          <button
            className="send-button"
            type="submit"
            aria-label="发送"
            disabled={busy || !composer.trim()}
          >
            <SendIcon />
          </button>
        </form>
        <p>Enter 发送 · Shift + Enter 换行 · 新内容保存前会询问可见范围</p>
      </footer>
    </main>
  );
}

export default function HomePage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void api
      .GET("/auth/me")
      .then(({ data }) => {
        if (active) setUser(data ?? null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    try {
      await api.POST("/auth/logout");
    } finally {
      setUser(null);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen" aria-busy="true">
        <Logo />
        <span>正在打开 Memora…</span>
      </main>
    );
  }

  return user ? (
    <ChatScreen user={user} onLogout={() => void handleLogout()} />
  ) : (
    <LoginScreen onLogin={setUser} />
  );
}
