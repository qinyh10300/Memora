import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

const alex = {
  id: "user-alex",
  email: "alex@memora.local",
  display_name: "Alex",
  workspace_id: "workspace-1",
  workspace_name: "Memora 测试工作区",
  role: "MEMBER",
};

const members = [
  { id: "user-alex", display_name: "Alex", role: "MEMBER" },
  { id: "user-blair", display_name: "Blair", role: "MEMBER" },
  { id: "user-casey", display_name: "Casey", role: "MEMBER" },
  { id: "user-devon", display_name: "Devon", role: "MEMBER" },
];

const privateMemory = {
  id: "memory-1",
  body: "先把记录摩擦降到十五秒。",
  visibility: "PRIVATE",
  author: { id: "user-alex", display_name: "Alex" },
  is_owner: true,
  created_at: "2026-07-22T01:00:00Z",
  shared_at: null,
  supersedes_id: null,
  processing_status: "PENDING",
};

function mockWorkspaceGet(memories: (typeof privateMemory)[] = []) {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve({ data: alex });
    if (path === "/workspace/members") return Promise.resolve({ data: members });
    if (path === "/memories") return Promise.resolve({ data: memories });
    return Promise.resolve({ data: undefined });
  });
}

describe("HomePage identity flow", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.DELETE.mockReset();
  });

  it("匿名用户看到默认私有的登录入口", async () => {
    apiMocks.GET.mockResolvedValue({ data: undefined });

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "进入测试工作区" })).toBeInTheDocument();
    expect(screen.getByText(/新记录只对你可见/)).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("登录成功后展示当前身份和四位工作区成员", async () => {
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve({ data: undefined });
      if (path === "/workspace/members") return Promise.resolve({ data: members });
      if (path === "/memories") return Promise.resolve({ data: [] });
      return Promise.resolve({ data: undefined });
    });
    apiMocks.POST.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/auth/login"
          ? { data: alex, response: { ok: true, status: 200 } }
          : { data: undefined, response: { ok: false, status: 404 } },
      ),
    );

    render(<HomePage />);
    await screen.findByRole("heading", { name: "进入测试工作区" });

    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "memora-local-alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录 Memora" }));

    expect(await screen.findByRole("heading", { name: "此刻，你在想什么？" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("4/4")).toBeInTheDocument());
    expect(screen.getByText("alex@memora.local")).toBeInTheDocument();
  });

  it("已有会话时直接恢复工作区", async () => {
    mockWorkspaceGet();

    render(<HomePage />);

    expect(await screen.findByLabelText("快速记录")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "进入测试工作区" })).not.toBeInTheDocument();
  });

  it("保存的新想法默认私有并立即出现在时间线", async () => {
    mockWorkspaceGet();
    apiMocks.POST.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/memories"
          ? { data: privateMemory, response: { ok: true, status: 201 } }
          : { data: undefined, response: { ok: false, status: 404 } },
      ),
    );

    render(<HomePage />);
    const capture = await screen.findByLabelText("快速记录");
    fireEvent.change(capture, { target: { value: privateMemory.body } });
    fireEvent.click(screen.getByRole("button", { name: "保存想法" }));

    expect(await screen.findByText(privateMemory.body)).toBeInTheDocument();
    expect(screen.getByText("仅自己")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
      body: { body: privateMemory.body, supersedes_id: null },
    });
  });

  it("作者可以主动分享并再次取消共享", async () => {
    mockWorkspaceGet([privateMemory]);
    const sharedMemory = {
      ...privateMemory,
      visibility: "WORKSPACE",
      shared_at: "2026-07-22T01:05:00Z",
    };
    apiMocks.POST.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.endsWith("/share") ? sharedMemory : privateMemory,
        response: { ok: true, status: 200 },
      }),
    );

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "分享给工作区" }));

    expect(await screen.findByText("工作区共享")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消共享" }));
    expect(await screen.findByText("仅自己")).toBeInTheDocument();
  });

  it("删除要求二次确认并从时间线移除", async () => {
    mockWorkspaceGet([privateMemory]);
    apiMocks.DELETE.mockResolvedValue({ response: { ok: true, status: 204 } });

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "删除" }));
    expect(screen.getByText("删除后正文不可恢复")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(screen.queryByText(privateMemory.body)).not.toBeInTheDocument());
    expect(apiMocks.DELETE).toHaveBeenCalledWith("/memories/{memory_id}", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("关键词搜索明确显示语义能力未配置", async () => {
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve({ data: alex });
      if (path === "/workspace/members") return Promise.resolve({ data: members });
      if (path === "/memories") return Promise.resolve({ data: [privateMemory] });
      return Promise.resolve({ data: undefined });
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/search") {
        return Promise.resolve({
          data: {
            query: "记录摩擦",
            semantic_status: "DISABLED",
            results: [{ memory: privateMemory, score: 1, match_reasons: ["KEYWORD"] }],
          },
          response: { ok: true, status: 200 },
        });
      }
      return Promise.resolve({ data: undefined });
    });

    render(<HomePage />);
    const searchInput = await screen.findByLabelText("搜索已有想法");
    fireEvent.change(searchInput, { target: { value: "记录摩擦" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    expect(
      await screen.findByText(/当前使用关键词检索；配置 embedding 模型后/),
    ).toBeInTheDocument();
    expect(screen.getByText(privateMemory.body)).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/search", {
      body: { q: "记录摩擦", limit: 50 },
    });
  });

  it("Memora Chat 显示带作者和时间的原记录引用", async () => {
    mockWorkspaceGet([privateMemory]);
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/chat/questions") {
        return Promise.resolve({
          data: {
            conversation_id: "conversation-1",
            message_id: "message-1",
            status: "ANSWERED",
            model_status: "DISABLED",
            scope: "PERSONAL",
            topic: "记录摩擦",
            answer: "找到 1 条可核对的相关记录。",
            citations: [
              {
                memory_id: privateMemory.id,
                excerpt: privateMemory.body,
                author: privateMemory.author,
                created_at: privateMemory.created_at,
                href: `/#memory-${privateMemory.id}`,
              },
            ],
          },
          response: { ok: true, status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });

    render(<HomePage />);
    fireEvent.change(await screen.findByLabelText("检索主题"), {
      target: { value: "记录摩擦" },
    });
    fireEvent.change(screen.getByLabelText("你想知道什么？"), {
      target: { value: "我之前怎么看记录摩擦？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "询问 Memora" }));

    expect(await screen.findByText("找到 1 条可核对的相关记录。")).toBeInTheDocument();
    expect(screen.getByText("基础证据模式")).toBeInTheDocument();
    expect(screen.getAllByText(privateMemory.body)).toHaveLength(2);
    expect(apiMocks.POST).toHaveBeenCalledWith("/chat/questions", {
      body: {
        question: "我之前怎么看记录摩擦？",
        topic: "记录摩擦",
        scope: "PERSONAL",
        author_id: null,
        created_from: null,
        created_to: null,
        evidence_limit: 8,
      },
    });
  });

  it("按需报告要求显式日期并展示五类证据结构", async () => {
    mockWorkspaceGet([privateMemory]);
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/reports") {
        return Promise.resolve({
          data: {
            report_id: "report-1",
            status: "GENERATED",
            model_status: "DISABLED",
            scope: "PERSONAL",
            topic: "商业模式",
            created_from: "2026-07-01T00:00:00Z",
            created_to: "2026-08-01T00:00:00Z",
            title: "我的想法报告 · 商业模式",
            summary: "找到 1 条可核对记录，报告不推测未记录经历。",
            contributors: [{ author_id: "user-alex", display_name: "Alex", record_count: 1 }],
            sections: [
              {
                kind: "TIMELINE",
                title: "时间线",
                content: "按原始时间展示记录。",
                citation_memory_ids: [privateMemory.id],
              },
              {
                kind: "CONTINUITY",
                title: "延续",
                content: "记录数量不自动等于观点一致。",
                citation_memory_ids: [privateMemory.id],
              },
              {
                kind: "CHANGES",
                title: "变化",
                content: "只有一个时间点，无法可靠比较变化。",
                citation_memory_ids: [privateMemory.id],
              },
              {
                kind: "CONTRADICTIONS",
                title: "矛盾",
                content: "不会自动判定矛盾。",
                citation_memory_ids: [privateMemory.id],
              },
              {
                kind: "GAPS",
                title: "证据缺口",
                content: "未记录内容属于证据缺口。",
                citation_memory_ids: [privateMemory.id],
              },
            ],
            citations: [
              {
                memory_id: privateMemory.id,
                excerpt: privateMemory.body,
                author: privateMemory.author,
                created_at: privateMemory.created_at,
                href: `/#memory-${privateMemory.id}`,
              },
            ],
          },
          response: { ok: true, status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });

    render(<HomePage />);
    fireEvent.change(await screen.findByLabelText("报告主题"), {
      target: { value: "商业模式" },
    });
    fireEvent.change(screen.getByLabelText("开始日期（含）"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期（含）"), {
      target: { value: "2026-07-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成报告" }));

    expect(
      await screen.findByRole("heading", { name: "我的想法报告 · 商业模式" }),
    ).toBeInTheDocument();
    expect(screen.getByText("基础证据报告")).toBeInTheDocument();
    expect(screen.getByText("找到 1 条可核对记录，报告不推测未记录经历。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "证据缺口" })).toBeInTheDocument();
    const expectedFrom = new Date("2026-07-01T00:00:00").toISOString();
    const expectedTo = new Date("2026-07-31T00:00:00");
    expectedTo.setDate(expectedTo.getDate() + 1);
    expect(apiMocks.POST).toHaveBeenCalledWith("/reports", {
      body: {
        scope: "PERSONAL",
        author_id: null,
        topic: "商业模式",
        created_from: expectedFrom,
        created_to: expectedTo.toISOString(),
        evidence_limit: 20,
      },
    });
  });
});
