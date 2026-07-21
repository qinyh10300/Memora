"use client";

import type { components } from "@memora/api-contract";
import { FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type SemanticStatus = components["schemas"]["SearchResponse"]["semantic_status"];
type ChatResponse = components["schemas"]["ChatResponse"];
type ChatScope = components["schemas"]["ChatRequest"]["scope"];
type ReportResponse = components["schemas"]["ReportResponse"];
type ReportScope = components["schemas"]["ReportRequest"]["scope"];
type MemoryFilter = "ALL" | "MINE" | "WORKSPACE";

const demoEmails = [
  "alex@memora.local",
  "blair@memora.local",
  "casey@memora.local",
  "devon@memora.local",
];

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState(demoEmails[0]);
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
      <section className="login-story" aria-labelledby="login-title">
        <div className="brand-mark">M</div>
        <p className="eyebrow">MEMORA · PRIVATE BY DEFAULT</p>
        <h1 id="login-title">把今天一闪而过的想法，交给未来的自己。</h1>
        <p className="lead">快速记录，按需分享，再用带来源的回答找回每一次判断与变化。</p>
        <div className="trust-note">
          <span aria-hidden="true">◉</span>
          新记录只对你可见，分享必须由你主动发起。
        </div>
      </section>

      <section className="login-panel" aria-label="登录 Memora">
        <div>
          <p className="panel-kicker">欢迎回来</p>
          <h2>进入测试工作区</h2>
          <p className="panel-copy">首轮版本只开放四个预置账号，不提供公开注册。</p>
        </div>

        <form onSubmit={handleSubmit}>
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

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "正在验证…" : "登录 Memora"}
          </button>
        </form>

        <details className="demo-accounts">
          <summary>查看四个本地测试账号</summary>
          <ul>
            {demoEmails.map((demoEmail) => (
              <li key={demoEmail}>
                <button type="button" onClick={() => setEmail(demoEmail)}>
                  {demoEmail}
                </button>
              </li>
            ))}
          </ul>
          <p>本地初始密码记录在开发文档；公网部署必须全部覆盖。</p>
        </details>
      </section>
    </main>
  );
}

function WorkspaceScreen({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [membersError, setMembersError] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(true);
  const [memoryError, setMemoryError] = useState("");
  const [captureBody, setCaptureBody] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [filter, setFilter] = useState<MemoryFilter>("ALL");
  const [supplementing, setSupplementing] = useState<Memory | null>(null);
  const [busyMemoryId, setBusyMemoryId] = useState<string | null>(null);
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [semanticStatus, setSemanticStatus] = useState<SemanticStatus | null>(null);
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatTopic, setChatTopic] = useState("");
  const [chatScope, setChatScope] = useState<ChatScope>("PERSONAL");
  const [chatAuthorId, setChatAuthorId] = useState("");
  const [chatFrom, setChatFrom] = useState("");
  const [chatTo, setChatTo] = useState("");
  const [chatAnswer, setChatAnswer] = useState<ChatResponse | null>(null);
  const [chatError, setChatError] = useState("");
  const [chatting, setChatting] = useState(false);
  const [reportScope, setReportScope] = useState<ReportScope>("PERSONAL");
  const [reportAuthorId, setReportAuthorId] = useState("");
  const [reportTopic, setReportTopic] = useState("全部");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportAnswer, setReportAnswer] = useState<ReportResponse | null>(null);
  const [reportError, setReportError] = useState("");
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.GET("/workspace/members"), api.GET("/memories")])
      .then(([membersResult, memoriesResult]) => {
        if (!active) return;
        if (membersResult.data) setMembers([...membersResult.data]);
        else setMembersError("暂时无法读取工作区成员。");
        if (memoriesResult.data) setMemories([...memoriesResult.data]);
        else setMemoryError("暂时无法读取想法，请稍后刷新。");
      })
      .catch(() => {
        if (!active) return;
        setMembersError("暂时无法读取工作区成员。");
        setMemoryError("暂时无法读取想法，请稍后刷新。");
      })
      .finally(() => {
        if (active) setMemoriesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleCapture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = captureBody.trim();
    if (!body) {
      setCaptureError("先写下一点内容再保存。");
      return;
    }
    setCaptureError("");
    setCapturing(true);
    try {
      const { data, response } = await api.POST("/memories", {
        body: {
          body,
          supersedes_id: supplementing?.id ?? null,
        },
      });
      if (!data || !response.ok) {
        setCaptureError("这条想法没有保存成功，请稍后重试。");
        return;
      }
      setMemories((current) => [data, ...current]);
      setCaptureBody("");
      setSupplementing(null);
      setFilter("ALL");
      setSearchQuery("");
      setSearchResults(null);
      setSemanticStatus(null);
    } catch {
      setCaptureError("暂时无法连接 Memora，这条想法尚未保存。");
    } finally {
      setCapturing(false);
    }
  }

  function replaceMemory(updated: Memory) {
    setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setSearchResults(
      (current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null,
    );
  }

  async function toggleVisibility(memory: Memory) {
    setBusyMemoryId(memory.id);
    setMemoryError("");
    try {
      const result =
        memory.visibility === "PRIVATE"
          ? await api.POST("/memories/{memory_id}/share", {
              params: { path: { memory_id: memory.id } },
            })
          : await api.POST("/memories/{memory_id}/unshare", {
              params: { path: { memory_id: memory.id } },
            });
      if (!result.data || !result.response.ok) {
        setMemoryError("可见范围没有更新成功，请稍后重试。");
        return;
      }
      replaceMemory(result.data);
      if (
        memory.visibility === "WORKSPACE" &&
        reportAnswer?.scope !== "PERSONAL" &&
        reportAnswer?.citations.some((citation) => citation.memory_id === memory.id)
      ) {
        setReportAnswer(null);
      }
    } catch {
      setMemoryError("暂时无法更新可见范围，请稍后重试。");
    } finally {
      setBusyMemoryId(null);
    }
  }

  async function confirmDelete(memory: Memory) {
    setBusyMemoryId(memory.id);
    setMemoryError("");
    try {
      const { response } = await api.DELETE("/memories/{memory_id}", {
        params: { path: { memory_id: memory.id } },
      });
      if (!response.ok) {
        setMemoryError("这条想法没有删除成功，请稍后重试。");
        return;
      }
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setSearchResults((current) => current?.filter((item) => item.id !== memory.id) ?? null);
      if (chatAnswer?.citations.some((citation) => citation.memory_id === memory.id)) {
        setChatAnswer(null);
      }
      if (reportAnswer?.citations.some((citation) => citation.memory_id === memory.id)) {
        setReportAnswer(null);
      }
      setDeletingMemoryId(null);
      if (supplementing?.id === memory.id) setSupplementing(null);
    } catch {
      setMemoryError("暂时无法删除这条想法，请稍后重试。");
    } finally {
      setBusyMemoryId(null);
    }
  }

  async function retryProcessing(memory: Memory) {
    setBusyMemoryId(memory.id);
    setMemoryError("");
    try {
      const { data, response } = await api.POST("/memories/{memory_id}/retry-processing", {
        params: { path: { memory_id: memory.id } },
      });
      if (!data || !response.ok) {
        setMemoryError("没有重新提交成功，请稍后再试。");
        return;
      }
      replaceMemory(data);
    } catch {
      setMemoryError("暂时无法重新提交 AI 处理，请稍后再试。");
    } finally {
      setBusyMemoryId(null);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults(null);
      setSemanticStatus(null);
      return;
    }
    setSearching(true);
    setMemoryError("");
    try {
      const { data, response } = await api.POST("/search", {
        body: { q: query, limit: 50 },
      });
      if (!data || !response.ok) {
        setMemoryError(
          response.status === 429 ? "搜索太频繁，请稍后再试。" : "搜索失败，请稍后重试。",
        );
        return;
      }
      setSearchResults(data.results.map((result) => result.memory));
      setSemanticStatus(data.semantic_status);
      setFilter("ALL");
    } catch {
      setMemoryError("暂时无法搜索，请稍后重试。");
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setSearchQuery("");
    setSearchResults(null);
    setSemanticStatus(null);
  }

  async function handleChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = chatQuestion.trim();
    const topic = chatTopic.trim();
    if (!question || !topic) {
      setChatError("请同时填写问题和检索主题；如果要回顾全部记录，主题可写“全部”。");
      return;
    }
    if (chatScope === "COLLEAGUE" && !chatAuthorId) {
      setChatError("请选择要了解的同事。");
      return;
    }
    setChatting(true);
    setChatError("");
    setChatAnswer(null);
    try {
      const createdFrom = chatFrom ? new Date(`${chatFrom}T00:00:00`).toISOString() : null;
      let createdTo: string | null = null;
      if (chatTo) {
        const inclusiveEnd = new Date(`${chatTo}T00:00:00`);
        inclusiveEnd.setDate(inclusiveEnd.getDate() + 1);
        createdTo = inclusiveEnd.toISOString();
      }
      const { data, response } = await api.POST("/chat/questions", {
        body: {
          question,
          topic,
          scope: chatScope,
          author_id: chatScope === "COLLEAGUE" ? chatAuthorId : null,
          created_from: createdFrom,
          created_to: createdTo,
          evidence_limit: 8,
        },
      });
      if (!data || !response.ok) {
        setChatError(
          response.status === 429
            ? "提问太频繁，请稍后再试。"
            : "这次提问没有完成，请检查范围后重试。",
        );
        return;
      }
      setChatAnswer(data);
    } catch {
      setChatError("暂时无法连接 Memora Chat，请稍后重试。");
    } finally {
      setChatting(false);
    }
  }

  async function handleReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const topic = reportTopic.trim();
    if (!topic || !reportFrom || !reportTo) {
      setReportError("报告必须填写主题、开始日期和结束日期。");
      return;
    }
    if (reportScope === "COLLEAGUE" && !reportAuthorId) {
      setReportError("请选择报告对应的同事。");
      return;
    }
    setReporting(true);
    setReportError("");
    setReportAnswer(null);
    try {
      const createdFrom = new Date(`${reportFrom}T00:00:00`).toISOString();
      const inclusiveEnd = new Date(`${reportTo}T00:00:00`);
      inclusiveEnd.setDate(inclusiveEnd.getDate() + 1);
      const { data, response } = await api.POST("/reports", {
        body: {
          scope: reportScope,
          author_id: reportScope === "COLLEAGUE" ? reportAuthorId : null,
          topic,
          created_from: createdFrom,
          created_to: inclusiveEnd.toISOString(),
          evidence_limit: 20,
        },
      });
      if (!data || !response.ok) {
        setReportError(
          response.status === 429
            ? "报告生成太频繁，请稍后再试。"
            : "报告没有生成成功，请检查时间和范围。",
        );
        return;
      }
      setReportAnswer(data);
    } catch {
      setReportError("暂时无法生成报告，请稍后重试。");
    } finally {
      setReporting(false);
    }
  }

  function chooseReportRange(days: number) {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setReportFrom(localDateValue(start));
    setReportTo(localDateValue(end));
    setReportError("");
    setReportAnswer(null);
  }

  const timelineMemories = searchResults ?? memories;
  const visibleMemories = timelineMemories.filter((memory) => {
    if (filter === "MINE") return memory.author.id === user.id;
    if (filter === "WORKSPACE") return memory.visibility === "WORKSPACE";
    return true;
  });

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark brand-mark-small">M</span>
          <div>
            <strong>Memora</strong>
            <span>{user.workspace_name}</span>
          </div>
        </div>
        <div className="account-menu">
          <span className="avatar" aria-hidden="true">
            {user.display_name.slice(0, 1)}
          </span>
          <div>
            <strong>{user.display_name}</strong>
            <span>{user.email}</span>
          </div>
          <button type="button" className="text-button" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="sidebar" aria-label="主导航">
          <nav>
            <a className="nav-active" href="#home">
              记录与回顾
            </a>
            <a href="#timeline">全部想法</a>
            <a href="#chat">Memora Chat</a>
            <a href="#reports">按需报告</a>
          </nav>
          <div className="privacy-card">
            <span aria-hidden="true">●</span>
            <div>
              <strong>默认私有</strong>
              <p>只有主动分享的想法才会进入团队上下文。</p>
            </div>
          </div>
        </aside>

        <section className="workspace-main" id="home">
          <p className="eyebrow">CAPTURE · PRIVATE BY DEFAULT</p>
          <h1>此刻，你在想什么？</h1>
          <p className="workspace-lead">
            先忠实地记录，再决定是否让团队看见。保存后会自动带上作者与时间。
          </p>

          <section className="capture-card" aria-label="记录新想法">
            {supplementing ? (
              <div className="supplement-context">
                <div>
                  <strong>正在补充一条历史想法</strong>
                  <p>{supplementing.body}</p>
                </div>
                <button type="button" onClick={() => setSupplementing(null)}>
                  取消补充
                </button>
              </div>
            ) : null}
            <form onSubmit={handleCapture}>
              <label htmlFor="memory-body">{supplementing ? "写下你的补充" : "快速记录"}</label>
              <textarea
                id="memory-body"
                name="memory-body"
                placeholder="一个判断、一个疑问，或刚刚发生的进展…"
                value={captureBody}
                onChange={(event) => setCaptureBody(event.target.value)}
                maxLength={10_000}
                rows={5}
                disabled={capturing}
              />
              {captureError ? (
                <p className="form-error" role="alert">
                  {captureError}
                </p>
              ) : null}
              <div className="capture-footer">
                <div className="private-promise">
                  <span aria-hidden="true">●</span>
                  <div>
                    <strong>保存后仅自己可见</strong>
                    <small>之后可在记录上主动分享给整个工作区</small>
                  </div>
                </div>
                <div className="capture-submit">
                  <span>{captureBody.length}/10000</span>
                  <button className="primary-button" type="submit" disabled={capturing}>
                    {capturing ? "正在保存…" : "保存想法"}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="chat-card" id="chat" aria-labelledby="chat-title">
            <div className="chat-heading">
              <div>
                <p className="panel-kicker">MEMORA CHAT · CITED ANSWERS</p>
                <h2 id="chat-title">用你的记录回答，而不是凭空猜测</h2>
              </div>
              <span>先授权，再检索</span>
            </div>
            <p className="chat-intro">
              显式选择范围和主题。个人范围可使用你的私有记录；同事范围只使用对方主动共享的记录。
            </p>
            <form className="chat-form" onSubmit={handleChat}>
              <div className="chat-fields chat-fields-primary">
                <label>
                  回答范围
                  <select
                    value={chatScope}
                    onChange={(event) => {
                      setChatScope(event.target.value as ChatScope);
                      setChatAnswer(null);
                    }}
                  >
                    <option value="PERSONAL">仅我的记录</option>
                    <option value="COLLEAGUE">指定同事的共享记录</option>
                    <option value="WORKSPACE">我的记录 + 团队共享</option>
                  </select>
                </label>
                {chatScope === "COLLEAGUE" ? (
                  <label>
                    选择同事
                    <select
                      value={chatAuthorId}
                      onChange={(event) => setChatAuthorId(event.target.value)}
                      required
                    >
                      <option value="">请选择</option>
                      {members
                        .filter((member) => member.id !== user.id)
                        .map((member) => (
                          <option value={member.id} key={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  检索主题
                  <input
                    value={chatTopic}
                    onChange={(event) => setChatTopic(event.target.value)}
                    placeholder="例如：商业模式；回顾全部可写“全部”"
                    maxLength={500}
                    required
                  />
                </label>
              </div>
              <div className="chat-fields chat-date-fields">
                <label>
                  开始日期（可选）
                  <input
                    type="date"
                    value={chatFrom}
                    onChange={(event) => setChatFrom(event.target.value)}
                  />
                </label>
                <label>
                  结束日期（可选，含当天）
                  <input
                    type="date"
                    value={chatTo}
                    onChange={(event) => setChatTo(event.target.value)}
                  />
                </label>
              </div>
              <label htmlFor="chat-question">你想知道什么？</label>
              <textarea
                id="chat-question"
                value={chatQuestion}
                onChange={(event) => setChatQuestion(event.target.value)}
                placeholder="例如：我之前对这个商业模式的看法是什么？"
                rows={3}
                maxLength={2_000}
                required
              />
              <div className="chat-submit-row">
                <p>涉及“这段时间”时请填写起止日期；证据不足时 Memora 会明确说不知道。</p>
                <button className="primary-button" type="submit" disabled={chatting}>
                  {chatting ? "正在核对证据…" : "询问 Memora"}
                </button>
              </div>
            </form>
            {chatError ? (
              <p className="inline-error" role="alert">
                {chatError}
              </p>
            ) : null}
            {chatAnswer ? (
              <section className="chat-answer" aria-live="polite" aria-label="Memora 的回答">
                <header>
                  <strong>
                    {chatAnswer.status === "NEEDS_CLARIFICATION"
                      ? "需要你补充范围"
                      : chatAnswer.status === "NO_EVIDENCE"
                        ? "证据不足"
                        : "基于记录的回答"}
                  </strong>
                  <span>
                    {chatAnswer.model_status === "AVAILABLE"
                      ? "AI 已启用"
                      : chatAnswer.model_status === "DEGRADED"
                        ? "AI 降级 · 证据模式"
                        : "基础证据模式"}
                  </span>
                </header>
                <p className="chat-answer-body">{chatAnswer.answer}</p>
                {chatAnswer.citations.length > 0 ? (
                  <div className="citation-list">
                    <strong>原始记录 · {chatAnswer.citations.length} 条</strong>
                    {chatAnswer.citations.map((citation) => (
                      <a href={citation.href} key={citation.memory_id}>
                        <span>
                          {citation.author.display_name} ·{" "}
                          {new Date(citation.created_at).toLocaleString("zh-CN")}
                        </span>
                        <p>{citation.excerpt}</p>
                      </a>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </section>

          <section className="report-card" id="reports" aria-labelledby="report-title">
            <div className="report-heading">
              <div>
                <p className="panel-kicker">EVIDENCE REPORTS · EXPLICIT RANGE</p>
                <h2 id="report-title">把一段时间的记录，整理成可核对的报告</h2>
              </div>
              <span>不猜默认时间</span>
            </div>
            <p className="report-intro">
              个人报告可使用你的私有记录；同事和团队报告只使用成员主动共享的内容。团队范围也不会自动带入你自己的私有记录。
            </p>
            <form className="report-form" onSubmit={handleReport}>
              <div className="report-fields report-scope-fields">
                <label>
                  报告范围
                  <select
                    value={reportScope}
                    onChange={(event) => {
                      setReportScope(event.target.value as ReportScope);
                      setReportAnswer(null);
                    }}
                  >
                    <option value="PERSONAL">我的全部记录</option>
                    <option value="COLLEAGUE">指定同事的共享记录</option>
                    <option value="WORKSPACE">所有成员的共享记录</option>
                  </select>
                </label>
                {reportScope === "COLLEAGUE" ? (
                  <label>
                    报告成员
                    <select
                      value={reportAuthorId}
                      onChange={(event) => setReportAuthorId(event.target.value)}
                      required
                    >
                      <option value="">请选择</option>
                      {members
                        .filter((member) => member.id !== user.id)
                        .map((member) => (
                          <option value={member.id} key={member.id}>
                            {member.display_name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  报告主题
                  <input
                    value={reportTopic}
                    onChange={(event) => setReportTopic(event.target.value)}
                    maxLength={500}
                    placeholder="例如：商业模式；全部主题可写“全部”"
                    required
                  />
                </label>
              </div>
              <div className="report-fields report-date-fields">
                <label>
                  开始日期（含）
                  <input
                    type="date"
                    value={reportFrom}
                    onChange={(event) => setReportFrom(event.target.value)}
                    required
                  />
                </label>
                <label>
                  结束日期（含）
                  <input
                    type="date"
                    value={reportTo}
                    onChange={(event) => setReportTo(event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="report-range-presets" aria-label="快速选择报告时间">
                <span>快速选择</span>
                <button type="button" onClick={() => chooseReportRange(7)}>
                  最近 7 天
                </button>
                <button type="button" onClick={() => chooseReportRange(30)}>
                  最近 30 天
                </button>
              </div>
              <div className="report-submit-row">
                <p>报告固定区分时间线、延续、变化、矛盾和证据缺口；没有记录不等于没有发生。</p>
                <button className="primary-button" type="submit" disabled={reporting}>
                  {reporting ? "正在核对并生成…" : "生成报告"}
                </button>
              </div>
            </form>
            {reportError ? (
              <p className="inline-error" role="alert">
                {reportError}
              </p>
            ) : null}
            {reportAnswer ? (
              <article className="report-output" aria-live="polite" aria-label="Memora 报告">
                <header>
                  <div>
                    <p className="panel-kicker">GENERATED REPORT</p>
                    <h3>{reportAnswer.title}</h3>
                  </div>
                  <span>
                    {reportAnswer.model_status === "AVAILABLE"
                      ? "AI 摘要"
                      : reportAnswer.model_status === "DEGRADED"
                        ? "AI 降级 · 证据报告"
                        : "基础证据报告"}
                  </span>
                </header>
                <p className="report-summary">{reportAnswer.summary}</p>
                {reportAnswer.contributors.length > 0 ? (
                  <div className="report-contributors" aria-label="报告贡献成员">
                    {reportAnswer.contributors.map((contributor) => (
                      <span key={contributor.author_id}>
                        {contributor.display_name} · {contributor.record_count} 条
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="report-sections">
                  {reportAnswer.sections.map((section) => (
                    <section key={section.kind}>
                      <header>
                        <h4>{section.title}</h4>
                        <span>{section.citation_memory_ids.length} 条依据</span>
                      </header>
                      <p>{section.content}</p>
                    </section>
                  ))}
                </div>
                {reportAnswer.citations.length > 0 ? (
                  <div className="citation-list report-citations">
                    <strong>报告来源 · {reportAnswer.citations.length} 条</strong>
                    {reportAnswer.citations.map((citation) => (
                      <a href={citation.href} key={citation.memory_id}>
                        <span>
                          {citation.author.display_name} ·{" "}
                          {new Date(citation.created_at).toLocaleString("zh-CN")}
                        </span>
                        <p>{citation.excerpt}</p>
                      </a>
                    ))}
                  </div>
                ) : null}
              </article>
            ) : null}
          </section>

          <div className="content-grid">
            <section className="timeline-section" id="timeline" aria-labelledby="timeline-title">
              <div className="section-heading timeline-heading">
                <div>
                  <p className="panel-kicker">MEMORY TIMELINE</p>
                  <h2 id="timeline-title">可访问的想法</h2>
                </div>
                <span>{visibleMemories.length} 条</span>
              </div>

              <form className="search-form" role="search" onSubmit={handleSearch}>
                <label htmlFor="memory-search">搜索已有想法</label>
                <div>
                  <input
                    id="memory-search"
                    type="search"
                    placeholder="输入关键词或一句相似的想法"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    maxLength={500}
                  />
                  <button type="submit" disabled={searching}>
                    {searching ? "搜索中…" : "搜索"}
                  </button>
                  {searchResults !== null ? (
                    <button type="button" className="clear-search" onClick={clearSearch}>
                      清除
                    </button>
                  ) : null}
                </div>
              </form>
              {semanticStatus ? (
                <p className={`semantic-note semantic-${semanticStatus.toLowerCase()}`}>
                  {semanticStatus === "AVAILABLE"
                    ? "已合并关键词与语义相似结果。"
                    : semanticStatus === "DISABLED"
                      ? "当前使用关键词检索；配置 embedding 模型后会自动启用语义检索。"
                      : "语义服务暂时不可用，本次结果仅来自关键词检索。"}
                </p>
              ) : null}

              <div className="filter-bar" aria-label="筛选想法">
                {(
                  [
                    ["ALL", "全部可见"],
                    ["MINE", "我的记录"],
                    ["WORKSPACE", "团队共享"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={filter === value ? "filter-active" : ""}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {memoryError ? (
                <p className="inline-error" role="alert">
                  {memoryError}
                </p>
              ) : null}
              {memoriesLoading ? <p className="empty-state">正在读取你的时间线…</p> : null}
              {!memoriesLoading && visibleMemories.length === 0 ? (
                <div className="empty-state">
                  <strong>
                    {searchResults !== null
                      ? "没有找到你有权限访问的记录。"
                      : memories.length === 0
                        ? "第一条想法，从现在开始。"
                        : "这个范围还没有记录。"}
                  </strong>
                  <p>新想法默认私有，不会自动出现在同事的时间线里。</p>
                </div>
              ) : null}

              <div className="memory-list">
                {visibleMemories.map((memory) => {
                  const timestamp = new Intl.DateTimeFormat("zh-CN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(memory.created_at));
                  const isBusy = busyMemoryId === memory.id;
                  const isDeleting = deletingMemoryId === memory.id;
                  return (
                    <article className="memory-card" id={`memory-${memory.id}`} key={memory.id}>
                      <header>
                        <div className="memory-author">
                          <span className="avatar" aria-hidden="true">
                            {memory.author.display_name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>{memory.author.display_name}</strong>
                            <time dateTime={memory.created_at}>{timestamp}</time>
                          </div>
                        </div>
                        <span
                          className={`visibility-pill ${memory.visibility === "PRIVATE" ? "visibility-private" : "visibility-shared"}`}
                        >
                          {memory.visibility === "PRIVATE" ? "仅自己" : "工作区共享"}
                        </span>
                      </header>
                      {memory.supersedes_id ? (
                        <a className="supplement-link" href={`#memory-${memory.supersedes_id}`}>
                          ↳ 这是对一条历史想法的补充
                        </a>
                      ) : null}
                      <p className="memory-body">{memory.body}</p>
                      <div
                        className={`processing-state processing-${memory.processing_status.toLowerCase()}`}
                      >
                        <span aria-hidden="true">●</span>
                        {memory.processing_status === "COMPLETED"
                          ? "可用于语义检索"
                          : memory.processing_status === "WAITING_CONFIGURATION"
                            ? "语义能力待配置，记录仍可通过关键词找到"
                            : memory.processing_status === "FAILED"
                              ? "AI 处理失败，原始记录已安全保存"
                              : "等待 AI 处理，原始记录已保存"}
                      </div>
                      {memory.is_owner ? (
                        <footer className="memory-actions">
                          <button
                            type="button"
                            onClick={() => setSupplementing(memory)}
                            disabled={isBusy}
                          >
                            补充这条
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleVisibility(memory)}
                            disabled={isBusy}
                          >
                            {memory.visibility === "PRIVATE" ? "分享给工作区" : "取消共享"}
                          </button>
                          {memory.processing_status === "FAILED" ? (
                            <button
                              type="button"
                              onClick={() => void retryProcessing(memory)}
                              disabled={isBusy}
                            >
                              重试 AI 处理
                            </button>
                          ) : null}
                          {isDeleting ? (
                            <span className="delete-confirm">
                              <span>删除后正文不可恢复</span>
                              <button
                                type="button"
                                className="danger-button"
                                onClick={() => void confirmDelete(memory)}
                                disabled={isBusy}
                              >
                                确认删除
                              </button>
                              <button type="button" onClick={() => setDeletingMemoryId(null)}>
                                取消
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="danger-link"
                              onClick={() => setDeletingMemoryId(memory.id)}
                              disabled={isBusy}
                            >
                              删除
                            </button>
                          )}
                        </footer>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <aside className="members-section" aria-labelledby="members-title">
              <div className="section-heading">
                <div>
                  <p className="panel-kicker">TEST SPACE</p>
                  <h2 id="members-title">工作区成员</h2>
                </div>
                <span>{members.length}/4</span>
              </div>
              {membersError ? <p role="alert">{membersError}</p> : null}
              <div className="member-list">
                {members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <span className="avatar" aria-hidden="true">
                      {member.display_name.slice(0, 1)}
                    </span>
                    <strong>{member.display_name}</strong>
                    <span>{member.role === "OWNER" ? "管理员" : "成员"}</span>
                  </div>
                ))}
              </div>
              <p className="member-scope-note">
                你只能看到成员主动共享的记录，私有内容不会参与团队上下文。
              </p>
            </aside>
          </div>
        </section>
      </section>
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
        正在打开你的记忆空间…
      </main>
    );
  }

  return user ? (
    <WorkspaceScreen user={user} onLogout={() => void handleLogout()} />
  ) : (
    <LoginScreen onLogin={setUser} />
  );
}
