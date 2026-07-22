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

function mockSession(initialMemories: (typeof privateMemory)[] = []) {
  apiMocks.GET.mockImplementation((path: string) => {
    if (path === "/auth/me") return Promise.resolve({ data: alex });
    if (path === "/workspace/members") return Promise.resolve({ data: members });
    if (path === "/memories") return Promise.resolve({ data: initialMemories });
    return Promise.resolve({ data: undefined });
  });
}

async function sendMessage(content: string) {
  const composer = await screen.findByLabelText("给 Memora 发消息");
  fireEvent.change(composer, { target: { value: content } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

describe("HomePage conversation-first flow", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.DELETE.mockReset();
  });

  it("匿名用户看到暗色极简登录入口且页面不暴露密码", async () => {
    apiMocks.GET.mockResolvedValue({ data: undefined });

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "继续你的对话" })).toBeInTheDocument();
    expect(screen.getByText(/新记录始终先征求你的共享选择/)).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("登录成功后直接进入单一 Chatbot 界面", async () => {
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
    await screen.findByRole("heading", { name: "继续你的对话" });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "memora-local-alex" } });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));

    expect(await screen.findByRole("heading", { name: "今天想记下什么？" })).toBeInTheDocument();
    expect(screen.getByText(/我之前记了什么/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("普通陈述先追问可见范围，明确选择后才私有保存", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/memories"
          ? { data: privateMemory, response: { ok: true, status: 201 } }
          : { data: undefined, response: { ok: false, status: 404 } },
      ),
    );

    render(<HomePage />);
    await sendMessage(privateMemory.body);

    expect(await screen.findByText("这条内容是存给自己，还是共享给团队？")).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "只存给自己" }));
    expect(await screen.findByText("OK，已保存。只有你可以看到。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
      body: { body: privateMemory.body, supersedes_id: null },
    });
  });

  it("团队选择先创建私有记录，再调用显式共享接口", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/memories") {
        return Promise.resolve({ data: privateMemory, response: { ok: true, status: 201 } });
      }
      if (path === "/memories/{memory_id}/share") {
        return Promise.resolve({
          data: { ...privateMemory, visibility: "WORKSPACE" },
          response: { ok: true, status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });

    render(<HomePage />);
    await sendMessage(privateMemory.body);
    fireEvent.click(await screen.findByRole("button", { name: "共享给团队" }));

    expect(await screen.findByText("OK，已保存并共享给团队。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories/{memory_id}/share", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("共享失败时明确告知记录仍已私有保存", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/memories") {
        return Promise.resolve({ data: privateMemory, response: { ok: true, status: 201 } });
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 503 } });
    });

    render(<HomePage />);
    await sendMessage(privateMemory.body);
    fireEvent.click(await screen.findByRole("button", { name: "共享给团队" }));

    expect(
      await screen.findByText("OK，已保存，但团队共享没有成功。这条记录目前仍然仅你可见。"),
    ).toBeInTheDocument();
  });

  it("通过聊天命令共享上一条记录", async () => {
    mockSession([privateMemory]);
    apiMocks.POST.mockImplementation((path: string) =>
      Promise.resolve(
        path === "/memories/{memory_id}/share"
          ? {
              data: { ...privateMemory, visibility: "WORKSPACE" },
              response: { ok: true, status: 200 },
            }
          : { data: undefined, response: { ok: false, status: 404 } },
      ),
    );

    render(<HomePage />);
    await sendMessage("把上一条共享给团队");

    expect(await screen.findByText("OK，上一条记录已共享给团队。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories/{memory_id}/share", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("删除聊天命令必须二次确认", async () => {
    mockSession([privateMemory]);
    apiMocks.DELETE.mockResolvedValue({ response: { ok: true, status: 204 } });

    render(<HomePage />);
    await sendMessage("删除上一条");

    expect(await screen.findByText(/确认删除上一条记录吗/)).toBeInTheDocument();
    expect(apiMocks.DELETE).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(await screen.findByText("上一条记录已删除。")).toBeInTheDocument();
    expect(apiMocks.DELETE).toHaveBeenCalledWith("/memories/{memory_id}", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("回顾问题默认检索个人记录并在回答中展示来源", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/chat/questions") {
        return Promise.resolve({
          data: {
            conversation_id: "conversation-1",
            message_id: "message-1",
            status: "ANSWERED",
            model_status: "DISABLED",
            scope: "PERSONAL",
            topic: "全部",
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
    await sendMessage("我之前记了什么？");

    expect(await screen.findByText("找到 1 条可核对的相关记录。")).toBeInTheDocument();
    expect(screen.getByText("来源 · 1")).toBeInTheDocument();
    expect(screen.getByText(/仅检索你的记录 · 基础证据模式/)).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/chat/questions", {
      body: {
        question: "我之前记了什么？",
        topic: "全部",
        scope: "PERSONAL",
        author_id: null,
        created_from: null,
        created_to: null,
        evidence_limit: 8,
      },
    });
  });

  it("明确说团队时才使用工作区范围", async () => {
    mockSession();
    apiMocks.POST.mockResolvedValue({
      data: {
        conversation_id: "conversation-1",
        message_id: "message-1",
        status: "NO_EVIDENCE",
        model_status: "DISABLED",
        scope: "WORKSPACE",
        topic: "全部",
        answer: "在团队共享范围内没有找到足够证据。",
        citations: [],
      },
      response: { ok: true, status: 200 },
    });

    render(<HomePage />);
    await sendMessage("团队之前记了什么？");

    expect(await screen.findByText("在团队共享范围内没有找到足够证据。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith(
      "/chat/questions",
      expect.objectContaining({ body: expect.objectContaining({ scope: "WORKSPACE" }) }),
    );
  });

  it("报告请求也留在对话中并调用显式范围报告接口", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/reports") {
        return Promise.resolve({
          data: {
            report_id: "report-1",
            status: "GENERATED",
            model_status: "DISABLED",
            scope: "PERSONAL",
            topic: "全部",
            created_from: "2026-07-16T00:00:00Z",
            created_to: "2026-07-23T00:00:00Z",
            title: "我的想法报告 · 全部",
            summary: "找到 1 条可核对记录。",
            contributors: [{ author_id: alex.id, display_name: "Alex", record_count: 1 }],
            sections: [
              {
                kind: "TIMELINE",
                title: "时间线",
                content: "按记录时间排列。",
                citation_memory_ids: [privateMemory.id],
              },
            ],
            citations: [],
          },
          response: { ok: true, status: 200 },
        });
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });

    render(<HomePage />);
    await sendMessage("给我一份最近 7 天的想法变化报告");

    expect(await screen.findByText(/我的想法报告 · 全部/)).toBeInTheDocument();
    expect(screen.getByText(/时间线\s+按记录时间排列/)).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith(
      "/reports",
      expect.objectContaining({
        body: expect.objectContaining({
          scope: "PERSONAL",
          topic: "全部",
          created_from: expect.any(String),
          created_to: expect.any(String),
        }),
      }),
    );
  });

  it("同事指代不清时在对话中追问，选择成员后才检索", async () => {
    mockSession();
    apiMocks.POST.mockResolvedValue({
      data: {
        conversation_id: "conversation-1",
        message_id: "message-1",
        status: "NO_EVIDENCE",
        model_status: "DISABLED",
        scope: "COLLEAGUE",
        topic: null,
        answer: "没有找到 Blair 主动共享的相关记录。",
        citations: [],
      },
      response: { ok: true, status: 200 },
    });

    render(<HomePage />);
    await sendMessage("这个同事最近有什么进展？");
    expect(await screen.findByText(/你想了解哪位同事/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Blair" }));
    expect(await screen.findByText(/你想回顾哪个主题/)).toBeInTheDocument();
    await sendMessage("全部");
    expect(await screen.findByText("没有找到 Blair 主动共享的相关记录。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith(
      "/chat/questions",
      expect.objectContaining({
        body: expect.objectContaining({ scope: "COLLEAGUE", author_id: "user-blair" }),
      }),
    );
  });

  it("退出后回到登录界面", async () => {
    mockSession();
    apiMocks.POST.mockResolvedValue({ response: { ok: true, status: 204 } });

    render(<HomePage />);
    await screen.findByRole("heading", { name: "今天想记下什么？" });
    fireEvent.click(screen.getByLabelText("打开账号菜单"));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "继续你的对话" })).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.POST).toHaveBeenCalledWith("/auth/logout"));
  });
});
