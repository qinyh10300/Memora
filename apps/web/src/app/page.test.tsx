import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

const teamUser = {
  id: "user-alex",
  email: "alex@memora.local",
  display_name: "Alex",
  workspace_id: "workspace-team",
  workspace_name: "Memora 产品组",
  role: "OWNER",
};

const personalUser = {
  ...teamUser,
  workspace_id: "workspace-personal",
  workspace_name: "Alex 的私人空间",
  role: "OWNER",
};

const teamWorkspace = {
  id: "workspace-team",
  name: "Memora 产品组",
  kind: "TEAM",
  role: "OWNER",
  is_current: true,
};

const personalWorkspace = {
  id: "workspace-personal",
  name: "Alex 的私人空间",
  kind: "PERSONAL",
  role: "OWNER",
  is_current: false,
};

const members = [
  { id: "user-alex", display_name: "Alex", role: "OWNER" },
  { id: "user-blair", display_name: "Blair", role: "MEMBER" },
];

const privateMemory = {
  id: "memory-private",
  body: "先把记录摩擦降到十五秒。",
  visibility: "PRIVATE",
  author: { id: "user-alex", display_name: "Alex" },
  is_owner: true,
  created_at: "2026-07-22T01:00:00Z",
  shared_at: null,
  supersedes_id: null,
  processing_status: "PENDING",
};

const sharedMemory = {
  ...privateMemory,
  id: "memory-shared",
  body: "本周完成了检索权限过滤。",
  visibility: "WORKSPACE",
  author: { id: "user-blair", display_name: "Blair" },
  is_owner: false,
  shared_at: "2026-07-22T02:00:00Z",
};

const conversation = {
  id: "conversation-1",
  title: "商业模式回顾",
  topic: "",
  scope: "PERSONAL",
  message_count: 0,
  created_at: "2026-07-22T01:00:00Z",
  updated_at: "2026-07-22T01:00:00Z",
  archived_at: null,
};

const newConversation = {
  ...conversation,
  id: "conversation-new",
  title: "新对话",
};

const emptyConversationDetail = {
  ...conversation,
  messages: [],
};

function ok<T>(data: T, status = 200) {
  return { data, response: { ok: true, status } };
}

function missing() {
  return { data: undefined, response: { ok: false, status: 404 } };
}

function mockSession({
  memories = [],
  conversations = [],
}: {
  memories?: (typeof privateMemory | typeof sharedMemory)[];
  conversations?: (typeof conversation)[];
} = {}) {
  apiMocks.GET.mockImplementation((path: string, options?: unknown) => {
    if (path === "/auth/me") return Promise.resolve(ok(teamUser));
    if (path === "/workspaces") {
      return Promise.resolve(ok([personalWorkspace, teamWorkspace]));
    }
    if (path === "/conversations") return Promise.resolve(ok(conversations));
    if (path === "/conversations/{conversation_id}") {
      const conversationId = (
        options as { params?: { path?: { conversation_id?: string } } } | undefined
      )?.params?.path?.conversation_id;
      return Promise.resolve(
        conversationId === conversation.id ? ok(emptyConversationDetail) : missing(),
      );
    }
    if (path === "/workspace/members") return Promise.resolve(ok(members));
    if (path === "/memories") return Promise.resolve(ok(memories));
    if (path === "/memories/{memory_id}") {
      const memoryId = (options as { params?: { path?: { memory_id?: string } } } | undefined)
        ?.params?.path?.memory_id;
      const memory = memories.find((item) => item.id === memoryId);
      return Promise.resolve(memory ? ok(memory) : missing());
    }
    return Promise.resolve(missing());
  });
}

function mockConversationCreation() {
  apiMocks.POST.mockImplementation((path: string) => {
    if (path === "/conversations") return Promise.resolve(ok(newConversation, 201));
    return Promise.resolve(missing());
  });
}

async function sendMessage(content: string) {
  const composer = await screen.findByLabelText("给 Memora 发消息");
  fireEvent.change(composer, { target: { value: content } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

describe("Memora workspace conversation shell", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.PATCH.mockReset();
    apiMocks.DELETE.mockReset();
  });

  it("匿名入口不暴露测试密码，并解释默认私有策略", async () => {
    apiMocks.GET.mockResolvedValue(missing());

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "继续你的对话" })).toBeInTheDocument();
    expect(screen.getByText(/新记录始终先征求你的共享选择/)).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("进入后提供空间切换、任务工作台和持久对话入口", async () => {
    mockSession({ conversations: [conversation] });

    render(<HomePage />);

    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /当前团队.*Memora 产品组/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /记录记忆/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记忆问答" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "团队记忆" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "成员与权限" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "商业模式回顾" })).toBeInTheDocument();
    expect(apiMocks.GET).toHaveBeenCalledWith("/conversations/{conversation_id}", {
      params: { path: { conversation_id: conversation.id } },
    });
  });

  it("记录记忆创建专用对话并把输入焦点交给用户", async () => {
    mockSession();
    mockConversationCreation();

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: /记录记忆/ }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/conversations", {
        body: { title: "记录记忆" },
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("给 Memora 发消息")).toHaveFocus();
    });
  });

  it("新聊天先创建持久对话，再询问范围并私有保存", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/conversations") return Promise.resolve(ok(newConversation, 201));
      if (path === "/memories") return Promise.resolve(ok(privateMemory, 201));
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    await sendMessage(privateMemory.body);

    expect(await screen.findByText("这条内容是存给自己，还是共享给团队？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "只存给自己" }));

    expect(await screen.findByText("OK，已保存。只有你可以看到。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
      body: {
        body: privateMemory.body,
        supersedes_id: null,
        conversation_id: newConversation.id,
      },
    });
  });

  it("只有明确选择团队共享时才调用共享接口", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/conversations") return Promise.resolve(ok(newConversation, 201));
      if (path === "/memories") return Promise.resolve(ok(privateMemory, 201));
      if (path === "/memories/{memory_id}/share") {
        return Promise.resolve(
          ok({ ...privateMemory, visibility: "WORKSPACE", shared_at: "2026-07-22T02:00:00Z" }),
        );
      }
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    await sendMessage(privateMemory.body);
    fireEvent.click(await screen.findByRole("button", { name: "共享给团队" }));

    expect(await screen.findByText("OK，已保存并共享给团队。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/memories/{memory_id}/share", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("问题复用当前对话，回答来源可二次鉴权打开原文", async () => {
    mockSession({ memories: [privateMemory], conversations: [conversation] });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/chat/questions") {
        return Promise.resolve(
          ok({
            conversation_id: conversation.id,
            message_id: "message-answer",
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
          }),
        );
      }
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    await screen.findByRole("button", { name: "商业模式回顾" });
    await sendMessage("我之前记了什么？");

    expect(await screen.findByText("找到 1 条可核对的相关记录。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/chat/questions", {
      body: {
        conversation_id: conversation.id,
        question: "我之前记了什么？",
        topic: "全部",
        scope: "PERSONAL",
        author_id: null,
        created_from: null,
        created_to: null,
        evidence_limit: 8,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Alex.*先把记录摩擦/ }));
    await waitFor(() => {
      expect(
        within(screen.getByLabelText("原始记忆详情")).getByText(privateMemory.body),
      ).toBeInTheDocument();
    });
    expect(apiMocks.GET).toHaveBeenCalledWith("/memories/{memory_id}", {
      params: { path: { memory_id: privateMemory.id } },
    });
  });

  it("记忆库把个人原文与团队主动共享内容清楚隔离", async () => {
    mockSession({ memories: [privateMemory, sharedMemory] });
    mockConversationCreation();

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "团队记忆" }));

    expect(await screen.findByRole("heading", { name: "团队记忆", level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /先把记录摩擦/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /本周完成了检索权限过滤/ })).toBeInTheDocument();
    expect(screen.getByText(/不包含任何成员的私有内容/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /我的记忆/ }));

    expect(screen.getByRole("button", { name: /先把记录摩擦/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /本周完成了检索权限过滤/ }),
    ).not.toBeInTheDocument();
  });

  it("分析工作台只提交显式范围，并让报告结论回到原始证据", async () => {
    mockSession({ memories: [privateMemory, sharedMemory] });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/reports") {
        return Promise.resolve(
          ok({
            report_id: "report-1",
            status: "GENERATED",
            model_status: "DISABLED",
            scope: "WORKSPACE",
            topic: "商业模式",
            created_from: "2026-06-22T01:00:00Z",
            created_to: "2026-07-22T01:00:00Z",
            title: "团队商业模式复盘",
            summary: "团队从收费工具逐步转向记忆基础设施。",
            contributors: [{ author_id: "user-blair", display_name: "Blair", record_count: 1 }],
            sections: [
              {
                kind: "CHANGES",
                title: "变化",
                content: "定价假设发生了变化。",
                citation_memory_ids: [sharedMemory.id],
              },
            ],
            citations: [
              {
                memory_id: sharedMemory.id,
                excerpt: sharedMemory.body,
                author: sharedMemory.author,
                created_at: sharedMemory.created_at,
                href: `/#memory-${sharedMemory.id}`,
              },
            ],
          }),
        );
      }
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "分析" }));
    fireEvent.change(screen.getByLabelText("分析范围"), {
      target: { value: "WORKSPACE" },
    });
    fireEvent.change(screen.getByLabelText("主题"), { target: { value: "商业模式" } });
    fireEvent.click(screen.getByRole("button", { name: /生成分析/ }));

    expect(await screen.findByRole("heading", { name: "团队商业模式复盘" })).toBeInTheDocument();
    expect(screen.getByText("团队从收费工具逐步转向记忆基础设施。")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/reports", {
      body: {
        scope: "WORKSPACE",
        author_id: null,
        topic: "商业模式",
        created_from: expect.any(String),
        created_to: expect.any(String),
        evidence_limit: 20,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Blair.*本周完成了检索权限过滤/ }));
    await waitFor(() => {
      expect(
        within(screen.getByLabelText("原始记忆详情")).getByText(sharedMemory.body),
      ).toBeInTheDocument();
    });
  });

  it("成员目录明确显示角色和共享边界，但不伪造未实现的组织管理", async () => {
    mockSession();

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "成员与权限" }));

    expect(
      await screen.findByRole("heading", { name: "成员与权限", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Blair")).toBeInTheDocument();
    expect(screen.getByText(/新记录首先只属于作者/)).toBeInTheDocument();
    expect(screen.getByText(/本版本的组织目录只读/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /邀请成员/ })).not.toBeInTheDocument();
  });

  it("切换空间必须调用激活接口，并刷新身份边界", async () => {
    let activated = false;
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(ok(activated ? personalUser : teamUser));
      if (path === "/workspaces") {
        return Promise.resolve(
          ok([
            { ...personalWorkspace, is_current: activated },
            { ...teamWorkspace, is_current: !activated },
          ]),
        );
      }
      if (path === "/conversations" || path === "/memories") return Promise.resolve(ok([]));
      if (path === "/workspace/members") return Promise.resolve(ok(members));
      return Promise.resolve(missing());
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/workspaces/{workspace_id}/activate") {
        activated = true;
        return Promise.resolve(ok({ ...personalWorkspace, is_current: true }));
      }
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: /当前团队.*Memora 产品组/ }));
    fireEvent.click(screen.getByRole("button", { name: /Alex 的私人空间.*只有你/ }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces/{workspace_id}/activate", {
        params: { path: { workspace_id: personalWorkspace.id } },
      });
    });
    expect(await screen.findByText("个人空间")).toBeInTheDocument();
    expect(
      screen.getByText("Alex 的私人空间", { selector: ".workspace-heading span" }),
    ).toBeInTheDocument();
  });

  it("可以从空间菜单创建并进入新的团队空间", async () => {
    const createdWorkspace = {
      ...teamWorkspace,
      id: "workspace-new",
      name: "Futura 产品组",
      is_current: false,
    };
    let currentUser = teamUser;
    mockSession();
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(ok(currentUser));
      if (path === "/workspaces") return Promise.resolve(ok([personalWorkspace, teamWorkspace]));
      if (path === "/conversations" || path === "/memories") return Promise.resolve(ok([]));
      if (path === "/workspace/members") return Promise.resolve(ok(members));
      return Promise.resolve(missing());
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/workspaces") return Promise.resolve(ok(createdWorkspace, 201));
      if (path === "/workspaces/{workspace_id}/activate") {
        currentUser = {
          ...teamUser,
          workspace_id: createdWorkspace.id,
          workspace_name: createdWorkspace.name,
        };
        return Promise.resolve(ok({ ...createdWorkspace, is_current: true }));
      }
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: /当前团队.*Memora 产品组/ }));
    fireEvent.click(screen.getByRole("button", { name: "创建团队空间" }));
    fireEvent.change(screen.getByLabelText("新团队空间名称"), {
      target: { value: createdWorkspace.name },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces", {
        body: { name: createdWorkspace.name },
      });
    });
    expect(
      await screen.findByText(createdWorkspace.name, { selector: ".workspace-heading span" }),
    ).toBeInTheDocument();
  });

  it("账号菜单可以退出并回到登录入口", async () => {
    mockSession();
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/auth/logout") return Promise.resolve(ok(undefined, 204));
      return Promise.resolve(missing());
    });

    render(<HomePage />);
    const accountName = await screen.findByText("Alex", { selector: ".sidebar-account strong" });
    fireEvent.click(accountName.closest("summary") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "继续你的对话" })).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/auth/logout");
  });
});
