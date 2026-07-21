"use client";

import type { components } from "@memora/api-contract";
import { FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type Memory = components["schemas"]["MemoryResponse"];
type SemanticStatus = components["schemas"]["SearchResponse"]["semantic_status"];
type MemoryFilter = "ALL" | "MINE" | "WORKSPACE";

const demoEmails = [
  "alex@memora.local",
  "blair@memora.local",
  "casey@memora.local",
  "devon@memora.local",
];

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
            <span aria-disabled="true">Memora Chat · 即将开放</span>
            <span aria-disabled="true">报告 · 即将开放</span>
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
