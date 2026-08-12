"use client";

import { BarChart3, BookOpenText, GitBranch, MessageCircleQuestion, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { Workspace } from "@/features/shared/contracts";
import { isCollaborativeWorkspace } from "@/features/shared/contracts";

export type TeamMemoryTab = "MEMORIES" | "GRAPH" | "ANALYSIS";

const tabs: Array<{
  id: TeamMemoryTab;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { id: "MEMORIES", label: "共享记忆", icon: BookOpenText },
  { id: "GRAPH", label: "记忆图谱", icon: GitBranch },
  { id: "ANALYSIS", label: "记忆分析", icon: BarChart3 },
];

export function TeamMemoryCenter({
  workspace,
  sharedCount,
  memories,
  graph,
  analysis,
  onAskTeam,
}: {
  workspace: Workspace;
  sharedCount: number;
  memories: ReactNode;
  graph: ReactNode;
  analysis: ReactNode;
  onAskTeam: () => void;
}) {
  const [tab, setTab] = useState<TeamMemoryTab>("MEMORIES");
  const collaborative = isCollaborativeWorkspace(workspace);

  if (!collaborative) {
    return (
      <section className="team-memory-center is-empty" aria-labelledby="team-memory-title">
        <div className="team-memory-empty">
          <span>
            <Users aria-hidden="true" size={23} strokeWidth={1.65} />
          </span>
          <p className="eyebrow">TEAM MEMORY</p>
          <h1 id="team-memory-title">进入团队后查看共享记忆</h1>
          <p>从左侧的空间选择器进入协作团队，即可浏览成员主动共享的记忆、关系图谱和分析。</p>
        </div>
      </section>
    );
  }

  const activePanel = tab === "MEMORIES" ? memories : tab === "GRAPH" ? graph : analysis;

  return (
    <section className="team-memory-center" aria-labelledby="team-memory-title">
      <header className="team-memory-header">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1 id="team-memory-title">团队记忆</h1>
          <span>{sharedCount} 条成员主动共享的记忆</span>
        </div>
        <button className="team-memory-ask" type="button" onClick={onAskTeam}>
          <MessageCircleQuestion aria-hidden="true" size={17} strokeWidth={1.8} />
          问团队记忆
        </button>
      </header>

      <nav className="team-memory-tabs" aria-label="团队记忆视图" role="tablist">
        {tabs.map((item) => {
          const Icon = item.icon;
          const selected = tab === item.id;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "is-active" : ""}
              key={item.id}
              onClick={() => setTab(item.id)}
            >
              <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div
        className="team-memory-panel"
        role="tabpanel"
        aria-label={tabs.find((item) => item.id === tab)?.label}
      >
        {activePanel}
      </div>
    </section>
  );
}
