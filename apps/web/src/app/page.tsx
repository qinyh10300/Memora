const foundations = [
  {
    title: "默认私有",
    description: "每条想法首先只属于你，只有主动分享后团队成员才能访问。",
  },
  {
    title: "时间可信",
    description: "想法以追加方式沉淀，不静默改写过去，为观点变化保留真实轨迹。",
  },
  {
    title: "回答有据",
    description: "AI 回答必须回到原记录、作者与时间，证据不足时明确说明。",
  },
];

export default function HomePage() {
  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">MEMORA · M1 FOUNDATION</p>
        <h1 id="page-title">让每个想法，都能在需要时被重新找到。</h1>
        <p className="lead">
          Memora 正在搭建第一版工程基础：可靠记录、主动共享，以及带来源引用的个人与团队记忆。
        </p>
        <div className="status" role="status">
          <span className="status-dot" aria-hidden="true" />
          工程骨架运行正常
        </div>
      </section>

      <section className="principles" aria-label="产品基础原则">
        {foundations.map((foundation) => (
          <article key={foundation.title}>
            <h2>{foundation.title}</h2>
            <p>{foundation.description}</p>
          </article>
        ))}
      </section>

      <footer>
        <p>当前阶段不包含登录、想法记录或 Chatbot 业务功能。</p>
      </footer>
    </main>
  );
}
