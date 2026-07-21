"use client";

import type { components } from "@memora/api-contract";
import { FormEvent, useEffect, useState } from "react";

import { api } from "@/lib/api";

type CurrentUser = components["schemas"]["CurrentUserResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];

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

  useEffect(() => {
    let active = true;
    void api.GET("/workspace/members").then(({ data }) => {
      if (!active) return;
      if (data) setMembers([...data]);
      else setMembersError("暂时无法读取工作区成员。");
    });
    return () => {
      active = false;
    };
  }, []);

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
              今日记忆
            </a>
            <span>全部想法</span>
            <span>Memora Chat</span>
            <span>报告</span>
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
          <p className="eyebrow">IDENTITY READY</p>
          <h1>早上好，{user.display_name}。</h1>
          <p className="workspace-lead">
            你的身份与工作区边界已经生效。下一步将在这里完成十五秒记录闭环。
          </p>

          <article className="foundation-card">
            <div>
              <span className="card-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <h2>安全会话已建立</h2>
                <p>会话可以立即注销，其他成员无法使用你的身份访问私有内容。</p>
              </div>
            </div>
            <span className="status-pill">M2 已就绪</span>
          </article>

          <section className="members-section" aria-labelledby="members-title">
            <div className="section-heading">
              <div>
                <p className="panel-kicker">测试空间</p>
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
          </section>
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
