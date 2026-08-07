import type { components } from "@memora/api-contract";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TeamIntelligenceWorkspace } from "./team-intelligence-workspace";

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), PATCH: vi.fn(), POST: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: apiMocks }));

function ok<T>(data: T, status = 200) {
  return { data, response: { ok: true, status } };
}

const workspace: components["schemas"]["WorkspaceResponse"] = {
  id: "workspace-team",
  name: "Memora 产品团队",
  kind: "TEAM",
  role: "OWNER",
  is_current: true,
  join_code: "ABCD23EFGH45",
};

const members: components["schemas"]["WorkspaceMemberResponse"][] = [
  {
    id: "user-alex",
    display_name: "Alex",
    role: "OWNER",
    joined_at: "2026-08-01T00:00:00Z",
    is_current_user: true,
  },
  {
    id: "user-blair",
    display_name: "Blair",
    role: "MEMBER",
    joined_at: "2026-08-02T00:00:00Z",
    is_current_user: false,
  },
];

const subscription: components["schemas"]["SubscriptionResponse"] = {
  plan_code: "PLUS",
  plan_name: "Plus",
  status: "ACTIVE",
  credits_granted: 2000,
  credits_used: 0,
  credits_reserved: 0,
  credits_remaining: 2000,
  period_started_at: "2026-08-01T00:00:00Z",
  period_ends_at: "2026-09-01T00:00:00Z",
};

const report: components["schemas"]["ReportResponse"] = {
  report_id: "report-1",
  status: "GENERATED",
  model_status: "AVAILABLE",
  scope: "WORKSPACE",
  topic: "产品方向",
  created_from: "2026-07-01T00:00:00Z",
  created_to: "2026-08-01T00:00:00Z",
  title: "团队共享想法报告 · 产品方向",
  summary: "团队记录显示产品方向仍有两个待确认分支。",
  contributors: [],
  sections: [
    {
      kind: "GAPS",
      title: "证据缺口",
      content: "企业客户访谈记录仍不足。",
      citation_memory_ids: [],
    },
  ],
  citations: [],
  visibility: "PRIVATE",
  is_owner: true,
  sources_available: true,
  saved_memory_id: null,
  created_at: "2026-08-07T08:00:00Z",
};

const reportSubscription: components["schemas"]["ReportSubscriptionResponse"] = {
  id: "report-subscription-1",
  preset: "MEETING",
  scope: "WORKSPACE",
  topic: "会议主题相关进展、分歧与待确认事项",
  subject_author_id: null,
  visibility: "PRIVATE",
  cadence: "DAILY",
  status: "ACTIVE",
  next_run_at: "2026-08-08T08:00:00Z",
  last_run_at: null,
  last_report_id: null,
  last_error_code: null,
  created_at: "2026-08-07T08:00:00Z",
  updated_at: "2026-08-07T08:00:00Z",
};

const topic: components["schemas"]["AlignmentTopicResponse"] = {
  id: "alignment-1",
  title: "下一阶段服务哪类用户",
  context: "确认团队优先级",
  status: "OPEN",
  summary_status: "INSUFFICIENT_EVIDENCE",
  is_owner: true,
  can_publish_decision: true,
  evidence_from: "2026-05-01T00:00:00Z",
  evidence_to: "2026-08-07T08:00:00Z",
  positions: [
    {
      id: "position-alex",
      user_id: "user-alex",
      display_name: "Alex",
      status: "CANDIDATE",
      text: "先服务研究团队。",
      is_current_user: true,
      citations: [],
      confirmed_at: null,
      updated_at: "2026-08-07T08:00:00Z",
    },
  ],
  decisions: [],
  created_at: "2026-08-07T08:00:00Z",
  updated_at: "2026-08-07T08:00:00Z",
};

describe("TeamIntelligenceWorkspace", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.PATCH.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/reports") return Promise.resolve(ok([]));
      if (path === "/report-subscriptions") return Promise.resolve(ok([]));
      if (path === "/alignments") return Promise.resolve(ok([]));
      if (path === "/visuals/costs") return Promise.resolve(ok({ report: 20, alignment: 15 }));
      if (path === "/billing/subscription") return Promise.resolve(ok(subscription));
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/reports") return Promise.resolve(ok(report));
      if (path === "/report-subscriptions") return Promise.resolve(ok(reportSubscription, 201));
      if (path === "/alignments") return Promise.resolve(ok(topic, 201));
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });
    apiMocks.PATCH.mockImplementation((path: string) => {
      if (path === "/report-subscriptions/{subscription_id}") {
        return Promise.resolve(ok({ ...reportSubscription, status: "PAUSED" as const }));
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });
  });

  function renderWorkspace() {
    render(
      <TeamIntelligenceWorkspace
        workspace={workspace}
        members={members}
        subscription={subscription}
        onSubscriptionChange={vi.fn()}
        onUpgrade={vi.fn()}
        onOpenMemory={vi.fn()}
        onMemoryCreated={vi.fn()}
        onCreateVisual={vi.fn()}
        onNotify={vi.fn()}
      />,
    );
  }

  it("creates persistent reports and alignment topics from the same workspace", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "团队智能" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    const reportPanel = screen.getByRole("heading", { name: "生成报告" }).closest("section");
    expect(reportPanel).not.toBeNull();
    fireEvent.change(within(reportPanel!).getByLabelText("报告主题"), {
      target: { value: "产品方向" },
    });
    fireEvent.click(within(reportPanel!).getByRole("button", { name: /生成报告/ }));
    expect(await screen.findByRole("heading", { name: report.title })).toBeVisible();
    expect(screen.getByText(report.summary)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /对齐/ }));
    fireEvent.click(screen.getByRole("button", { name: "发起对齐" }));
    const alignmentPanel = screen.getByRole("heading", { name: "发起观点对齐" }).closest("section");
    expect(alignmentPanel).not.toBeNull();
    fireEvent.change(
      within(alignmentPanel!).getByPlaceholderText("例如：下一阶段应该优先服务哪类用户？"),
      { target: { value: topic.title } },
    );
    fireEvent.click(within(alignmentPanel!).getByRole("button", { name: /创建议题/ }));
    expect(await screen.findByRole("heading", { name: topic.title })).toBeVisible();
    expect(screen.getByRole("button", { name: /这是我的观点/ })).toBeVisible();

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith(
        "/alignments",
        expect.objectContaining({
          body: expect.objectContaining({ title: topic.title }),
        }),
      );
    });
  });

  it("creates and pauses a recurring evidence report", async () => {
    renderWorkspace();
    expect(await screen.findByRole("heading", { name: "团队智能" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));
    const reportPanel = screen.getByRole("heading", { name: "生成报告" }).closest("section");
    expect(reportPanel).not.toBeNull();
    fireEvent.click(within(reportPanel!).getByRole("button", { name: "会前简报" }));
    fireEvent.click(within(reportPanel!).getByRole("switch", { name: "定期生成报告" }));
    fireEvent.change(within(reportPanel!).getByLabelText("生成频率"), {
      target: { value: "DAILY" },
    });
    fireEvent.click(within(reportPanel!).getByRole("button", { name: /生成报告/ }));

    expect(await screen.findByRole("button", { name: "暂停会前简报" })).toBeVisible();
    expect(apiMocks.POST).toHaveBeenCalledWith(
      "/report-subscriptions",
      expect.objectContaining({
        body: expect.objectContaining({
          preset: "MEETING",
          scope: "WORKSPACE",
          cadence: "DAILY",
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "暂停会前简报" }));
    await waitFor(() => {
      expect(apiMocks.PATCH).toHaveBeenCalledWith(
        "/report-subscriptions/{subscription_id}",
        expect.objectContaining({ body: { status: "PAUSED" } }),
      );
    });
    expect(await screen.findByRole("button", { name: "恢复会前简报" })).toBeVisible();
  });
});
