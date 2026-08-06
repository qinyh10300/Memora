import type { components } from "@memora/api-contract";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

type Memory = components["schemas"]["MemoryResponse"];
type DraftModel = components["schemas"]["DraftModelResponse"];
type Workspace = components["schemas"]["WorkspaceResponse"];
type WorkspaceMember = components["schemas"]["WorkspaceMemberResponse"];
type WorkspaceJoinRequest = components["schemas"]["WorkspaceJoinRequestResponse"];

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PATCH: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
  STREAM: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks, streamDraftChat: apiMocks.STREAM }));

const teamUser = {
  id: "user-alex",
  email: "alex@memora.local",
  display_name: "Alex",
  avatar_url: null,
  workspace_id: "workspace-team",
  workspace_name: "Memora 测试工作区",
  role: "OWNER",
};

const personalUser = {
  ...teamUser,
  workspace_id: "workspace-personal",
  workspace_name: "Alex 的个人空间",
};

const personalWorkspace: Workspace = {
  id: "workspace-personal",
  name: "Alex 的个人空间",
  kind: "PERSONAL",
  role: "OWNER",
  is_current: false,
  join_code: null,
};

const teamWorkspace: Workspace = {
  id: "workspace-team",
  name: "Memora 测试工作区",
  kind: "TEAM",
  role: "OWNER",
  is_current: true,
  join_code: "ABCD23EFGH45",
};

const teamMembers: WorkspaceMember[] = [
  {
    id: "user-alex",
    display_name: "Alex",
    role: "OWNER",
    joined_at: "2026-07-20T08:00:00Z",
    is_current_user: true,
  },
  {
    id: "user-blair",
    display_name: "Blair",
    role: "MEMBER",
    joined_at: "2026-07-22T09:00:00Z",
    is_current_user: false,
  },
];

const memory: Memory = {
  id: "memory-1",
  title: "产品方向",
  body: "# 产品方向\n\n先验证个人记录和回顾。",
  visibility: "PRIVATE",
  author: { id: "user-alex", display_name: "Alex" },
  is_owner: true,
  created_at: "2026-07-26T09:30:00Z",
  shared_at: null,
  supersedes_id: null,
  timeline_entry_id: "memory-1",
  timeline_visible: true,
  revision_kind: "ROOT",
  processing_status: "PENDING",
};

const teammateMemory: Memory = {
  ...memory,
  id: "memory-blair",
  title: "社会世界模型",
  body: "# 社会世界模型\n\n梳理团队共同关注的产品方向。",
  visibility: "WORKSPACE",
  author: { id: "user-blair", display_name: "Blair" },
  is_owner: false,
  shared_at: "2026-08-05T08:00:00Z",
  timeline_entry_id: "memory-blair",
};

const draftModel: DraftModel = {
  id: "balanced",
  label: "Balanced",
  capabilities: ["chat", "vision", "web_search", "tools"],
  is_default: true,
};

function ok<T>(data: T, status = 200) {
  return { data, response: { ok: true, status } };
}

function missing(status = 404) {
  return { data: undefined, response: { ok: false, status } };
}

function mockAuthenticatedSession(
  initialMemories: Memory[] = [memory],
  initialWorkspaceId = personalWorkspace.id,
) {
  let activeWorkspaceId = initialWorkspaceId;
  let currentMemories = [...initialMemories];
  let availableWorkspaces: Workspace[] = [personalWorkspace, teamWorkspace];

  apiMocks.GET.mockImplementation((path: string) => {
    if (path === "/auth/me") {
      const currentWorkspace =
        availableWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ??
        personalWorkspace;
      return Promise.resolve(
        ok(
          currentWorkspace.kind === "TEAM"
            ? {
                ...teamUser,
                workspace_id: currentWorkspace.id,
                workspace_name: currentWorkspace.name,
                role: currentWorkspace.role,
              }
            : personalUser,
        ),
      );
    }
    if (path === "/drafts/models") return Promise.resolve(ok([draftModel]));
    if (path === "/workspaces") {
      return Promise.resolve(
        ok(
          availableWorkspaces.map((workspace) => ({
            ...workspace,
            is_current: workspace.id === activeWorkspaceId,
          })),
        ),
      );
    }
    if (path === "/workspace/members") {
      return Promise.resolve(ok(teamMembers));
    }
    if (path === "/workspace/join-requests") return Promise.resolve(ok([]));
    if (path === "/memories") return Promise.resolve(ok(currentMemories));
    if (path === "/memories/{memory_id}/revisions") {
      return Promise.resolve(ok(currentMemories.length ? [currentMemories[0]] : []));
    }
    return Promise.resolve(missing());
  });

  apiMocks.POST.mockImplementation((path: string, options?: unknown) => {
    if (path === "/workspaces/{workspace_id}/activate") {
      const workspaceId = (options as { params: { path: { workspace_id: string } } }).params.path
        .workspace_id;
      activeWorkspaceId = workspaceId;
      const workspace = workspaceId === teamWorkspace.id ? teamWorkspace : personalWorkspace;
      return Promise.resolve(ok({ ...workspace, is_current: true }));
    }
    if (path === "/workspaces") {
      const body = (options as { body: { name: string } }).body;
      const created: Workspace = {
        id: "workspace-created",
        name: body.name,
        kind: "TEAM",
        role: "OWNER",
        is_current: false,
        join_code: "JKLM23NPQR45",
      };
      availableWorkspaces = [...availableWorkspaces, created];
      return Promise.resolve(ok(created, 201));
    }
    if (path === "/workspaces/join") {
      return Promise.resolve(
        ok({
          status: "PENDING",
          workspace: null,
          join_request: {
            workspace_id: "workspace-joined",
            workspace_name: "加入的研究团队",
            user_id: teamUser.id,
            display_name: teamUser.display_name,
            status: "PENDING",
            requested_at: "2026-08-06T12:00:00Z",
            reviewed_at: null,
          },
        }),
      );
    }
    if (path === "/search") {
      const body = (
        options as {
          body: {
            q: string;
            field: "ALL" | "TITLE";
            author_id?: string;
          };
        }
      ).body;
      const normalized = body.q.toLocaleLowerCase();
      const results = currentMemories
        .filter((item) => !body.author_id || item.author.id === body.author_id)
        .filter((item) => {
          if (!normalized) return true;
          const value = body.field === "TITLE" ? (item.title ?? "") : `${item.title} ${item.body}`;
          return value.toLocaleLowerCase().includes(normalized);
        })
        .map((item) => ({ memory: item, score: 1, match_reasons: ["KEYWORD"] }));
      return Promise.resolve(ok({ query: body.q, semantic_status: "DISABLED", results }));
    }
    if (path === "/workspaces/{workspace_id}/members") {
      const body = (options as { body: { email: string } }).body;
      return Promise.resolve(
        ok(
          {
            id: "user-casey",
            display_name: body.email.split("@")[0] || "Casey",
            role: "MEMBER",
            joined_at: "2026-08-06T11:00:00Z",
            is_current_user: false,
          } satisfies WorkspaceMember,
          201,
        ),
      );
    }
    if (path === "/auth/logout") return Promise.resolve(ok(undefined, 204));
    if (path === "/assets") {
      const body = (
        options as {
          body: {
            name: string;
            media_type: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
            data: string;
          };
        }
      ).body;
      const id = body.media_type === "application/pdf" ? "asset-pdf" : "asset-image";
      return Promise.resolve(
        ok(
          {
            id,
            name: body.name,
            kind: body.media_type === "application/pdf" ? "PDF" : "IMAGE",
            media_type: body.media_type,
            size_bytes: body.data.length,
            markdown_url:
              body.media_type === "application/pdf" ? null : `/api/assets/${id}/content`,
            created_at: "2026-07-30T08:00:00Z",
          },
          201,
        ),
      );
    }
    if (path === "/drafts/chat") {
      const body = (
        options as {
          body: {
            markdown: string;
            model_id?: string;
            web_search: "AUTO" | "REQUIRED" | "DISABLED";
            messages: {
              role: "USER" | "ASSISTANT";
              content: string;
              images?: unknown[];
              attachments?: unknown[];
            }[];
          };
        }
      ).body;
      if (body.web_search === "REQUIRED") {
        return Promise.resolve(
          ok({
            markdown:
              "# OpenAI 模型进展\n\n已核对官方发布。\n\n## 来源\n\n- [OpenAI 官方](https://openai.com/)",
            assistant_message: "已联网核对并把重点整理到右侧。",
            draft_changed: true,
            model_status: "AVAILABLE",
            model_id: body.model_id ?? null,
            citations: [],
            web_search_status: "AVAILABLE",
            web_citations: [{ url: "https://openai.com/", title: "OpenAI 官方" }],
            tool_events: [],
            saved_memory: null,
          }),
        );
      }
      if (body.messages.at(-1)?.content.includes("帮我保存")) {
        const saved = {
          ...memory,
          id: "memory-auto",
          body: body.markdown || "# 产品方向\n\n先验证个人记录和回顾。",
        };
        currentMemories = [saved, ...currentMemories];
        return Promise.resolve(
          ok({
            markdown: saved.body,
            assistant_message: "已保存到我的记忆。",
            draft_changed: false,
            model_status: "AVAILABLE",
            model_id: body.model_id ?? null,
            citations: [],
            web_search_status: "NOT_USED",
            web_citations: [],
            tool_events: [
              {
                name: "save_memory",
                status: "COMPLETED",
                message: "已保存为个人私有记忆。",
              },
            ],
            saved_memory: saved,
          }),
        );
      }
      if (body.messages.at(-1)?.content.includes("以前")) {
        return Promise.resolve(
          ok({
            markdown: body.markdown,
            assistant_message: "你以前记录过先验证个人记录和回顾。",
            draft_changed: false,
            model_status: "AVAILABLE",
            model_id: body.model_id ?? null,
            citations: [
              {
                memory_id: memory.id,
                excerpt: memory.body,
                author: memory.author,
                created_at: memory.created_at,
                href: `/#memory-${memory.id}`,
              },
            ],
            web_search_status: "NOT_USED",
            web_citations: [],
            tool_events: [],
            saved_memory: null,
          }),
        );
      }
      return Promise.resolve(
        ok({
          markdown: "# 产品方向\n\n先验证个人记录和回顾。",
          assistant_message: "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
          draft_changed: true,
          model_status: "AVAILABLE",
          model_id: body.model_id ?? null,
          citations: [],
          web_search_status: "NOT_USED",
          web_citations: [],
          tool_events: [],
          saved_memory: null,
        }),
      );
    }
    if (path === "/drafts/refine") {
      return Promise.resolve(
        ok({
          markdown: "# 产品方向\n\n先验证个人记录和回顾。",
          assistant_message: "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
          model_status: "AVAILABLE",
        }),
      );
    }
    if (path === "/memories") {
      const body = (options as { body: { body: string; visibility: "PRIVATE" | "WORKSPACE" } })
        .body;
      const created: Memory = {
        ...memory,
        body: body.body,
        visibility: body.visibility,
        shared_at: body.visibility === "WORKSPACE" ? "2026-08-06T10:00:00Z" : null,
      };
      currentMemories = [created, ...currentMemories.filter((item) => item.id !== created.id)];
      return Promise.resolve(ok(created, 201));
    }
    if (path === "/memories/{memory_id}/revisions") {
      const body = (
        options as {
          body: { body: string; mode: "UPDATE_CURRENT" | "NEW_VERSION" };
        }
      ).body;
      const revised = {
        ...memory,
        id: body.mode === "UPDATE_CURRENT" ? "memory-2" : "memory-3",
        body: body.body,
        supersedes_id: memory.id,
        timeline_entry_id: body.mode === "UPDATE_CURRENT" ? memory.timeline_entry_id : "memory-3",
        revision_kind: body.mode,
        created_at: "2026-07-26T10:30:00Z",
      };
      currentMemories = body.mode === "UPDATE_CURRENT" ? [revised] : [revised, ...currentMemories];
      return Promise.resolve(ok(revised, 201));
    }
    return Promise.resolve(missing());
  });

  apiMocks.DELETE.mockResolvedValue(ok(undefined, 204));
  apiMocks.PATCH.mockImplementation((path: string, options?: unknown) => {
    if (path === "/auth/profile") {
      const body = (options as { body: { display_name: string } }).body;
      return Promise.resolve(ok({ ...personalUser, display_name: body.display_name }));
    }
    return Promise.resolve(missing());
  });
  apiMocks.PUT.mockImplementation((path: string) => {
    if (path === "/auth/avatar") {
      return Promise.resolve(
        ok({ ...personalUser, avatar_url: "/api/auth/avatar/avatar-profile" }),
      );
    }
    if (path === "/auth/password") return Promise.resolve(ok(undefined, 204));
    return Promise.resolve(missing());
  });
  apiMocks.STREAM.mockImplementation(
    async (
      payload: unknown,
      onEvent: (event: { type: string; step?: unknown; response?: unknown }) => void,
    ) => {
      onEvent({
        type: "progress",
        step: {
          id: "analysis",
          kind: "ANALYSIS",
          status: "COMPLETED",
          title: "已理解这轮请求",
          detail: "已检查执行边界。",
          elapsed_ms: 12,
          duration_ms: 12,
          item_count: null,
        },
      });
      const result = await apiMocks.POST("/drafts/chat", { body: payload });
      if (!result.data || !result.response.ok) throw new Error("draft_chat_failed");
      onEvent({ type: "result", response: result.data });
      return result.data;
    },
  );
}

async function openCaptureView() {
  fireEvent.click(await screen.findByRole("button", { name: "记录想法" }));
}

async function openLibraryView() {
  fireEvent.click(await screen.findByRole("button", { name: "记忆库" }));
}

describe("Memora personal Markdown MVP", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.PATCH.mockReset();
    apiMocks.PUT.mockReset();
    apiMocks.DELETE.mockReset();
    apiMocks.STREAM.mockReset();
    const storedValues = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: () => storedValues.clear(),
        getItem: (key: string) => storedValues.get(key) ?? null,
        removeItem: (key: string) => storedValues.delete(key),
        setItem: (key: string, value: string) => storedValues.set(key, value),
      },
    });
  });

  it("匿名入口显示 Memora 完整首页且不暴露本地密码", async () => {
    apiMocks.GET.mockResolvedValue(missing());

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: /Memora.*让思考长期生长/ })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "首页导航" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "重新定义个人知识工作流" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "常见问题" })).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("公开首页可以注册账号并进入现有个人工作台", async () => {
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(missing(401));
      if (path === "/workspaces") {
        return Promise.resolve(ok([{ ...personalWorkspace, is_current: true }]));
      }
      if (path === "/drafts/models") return Promise.resolve(ok([draftModel]));
      if (path === "/memories") return Promise.resolve(ok([]));
      return Promise.resolve(missing());
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/auth/register") return Promise.resolve(ok(personalUser, 201));
      return Promise.resolve(missing());
    });

    render(<HomePage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "快速开始" }))[0]);
    expect(screen.getByRole("dialog", { name: "创建个人空间" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "Lin Yue" } });
    fireEvent.change(screen.getByLabelText("邮箱账号"), {
      target: { value: "lin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码", { selector: "input" }), {
      target: { value: "memora-account-2026" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "not-the-same-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建并进入/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(apiMocks.POST).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "memora-account-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: /创建并进入/ }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/auth/register", {
        body: {
          display_name: "Lin Yue",
          email: "lin@example.com",
          password: "memora-account-2026",
        },
      });
    });
    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今天在想什么？" })).toBeInTheDocument();
  });

  it("公开首页可以使用邮箱账号和密码登录", async () => {
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(missing(401));
      if (path === "/workspaces") {
        return Promise.resolve(ok([{ ...personalWorkspace, is_current: true }]));
      }
      if (path === "/drafts/models") return Promise.resolve(ok([draftModel]));
      if (path === "/memories") return Promise.resolve(ok([]));
      return Promise.resolve(missing());
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/auth/login") return Promise.resolve(ok(personalUser));
      return Promise.resolve(missing());
    });

    render(<HomePage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "登录" }))[0]);
    expect(screen.getByRole("dialog", { name: "登录 Memora" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("邮箱账号"), {
      target: { value: "alex@memora.local" },
    });
    fireEvent.change(screen.getByLabelText("密码", { selector: "input" }), {
      target: { value: "memora-local-alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: /登录并进入/ }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/auth/login", {
        body: { email: "alex@memora.local", password: "memora-local-alex" },
      });
    });
    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
  });

  it("刷新后恢复上次使用的个人空间并直接显示记录想法工作区", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith(
      "/workspaces/{workspace_id}/activate",
      expect.anything(),
    );
    expect(screen.getByRole("button", { name: "记录想法" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记忆库" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "首页" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Balanced" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "今天在想什么？" })).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 草稿")).toBeInTheDocument();
    expect(screen.getByText("所有新记忆仅你可见")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "团队" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
  });

  it("刷新后保留团队空间，并显示团队号、组织成员和邀请入口", async () => {
    mockAuthenticatedSession([], teamWorkspace.id);

    render(<HomePage />);

    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith(
      "/workspaces/{workspace_id}/activate",
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "团队" }));

    expect(await screen.findByRole("heading", { name: teamWorkspace.name })).toBeVisible();
    expect(screen.getByText("ABCD23-EFGH45")).toBeInTheDocument();
    expect(screen.getByText("Blair")).toBeInTheDocument();
    expect(apiMocks.GET).toHaveBeenCalledWith("/workspace/members");

    fireEvent.change(screen.getByLabelText("已注册邮箱"), {
      target: { value: "casey@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "添加到团队" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces/{workspace_id}/members", {
        params: { path: { workspace_id: teamWorkspace.id } },
        body: { email: "casey@example.com" },
      });
    });
    expect(await screen.findByText("casey")).toBeInTheDocument();
  });

  it("团队所有者可以审核加入申请并移除普通成员", async () => {
    mockAuthenticatedSession([], teamWorkspace.id);
    const pendingRequest = {
      workspace_id: teamWorkspace.id,
      workspace_name: teamWorkspace.name,
      user_id: "user-casey",
      display_name: "Casey",
      status: "PENDING",
      requested_at: "2026-08-06T12:00:00Z",
      reviewed_at: null,
    } satisfies WorkspaceJoinRequest;
    const baseGet = apiMocks.GET.getMockImplementation();
    const basePost = apiMocks.POST.getMockImplementation();
    apiMocks.GET.mockImplementation((path: string, options?: unknown) =>
      path === "/workspace/join-requests"
        ? Promise.resolve(ok([pendingRequest]))
        : baseGet?.(path, options),
    );
    apiMocks.POST.mockImplementation((path: string, options?: unknown) => {
      if (path === "/workspace/join-requests/{user_id}/approve") {
        return Promise.resolve(
          ok({
            id: pendingRequest.user_id,
            display_name: pendingRequest.display_name,
            role: "MEMBER",
            joined_at: "2026-08-06T12:05:00Z",
            is_current_user: false,
          } satisfies WorkspaceMember),
        );
      }
      return basePost?.(path, options);
    });

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "团队" }));

    expect(await screen.findByRole("heading", { name: "加入申请" })).toBeVisible();
    expect(screen.getByText("Casey")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "允许" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspace/join-requests/{user_id}/approve", {
        params: { path: { user_id: pendingRequest.user_id } },
      });
    });
    expect(await screen.findByText("已允许 Casey 加入团队")).toBeInTheDocument();

    const removeBlair = screen.getByRole("button", { name: "移除成员 Blair" });
    fireEvent.click(removeBlair);
    expect(removeBlair).toHaveTextContent("确认");
    fireEvent.click(removeBlair);
    await waitFor(() => {
      expect(apiMocks.DELETE).toHaveBeenCalledWith("/workspace/members/{user_id}", {
        params: { path: { user_id: "user-blair" } },
      });
    });
  });

  it("可以创建团队，并使用团队号提交加入申请", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    fireEvent.click(
      await screen.findByRole("button", { name: `切换空间，当前为 ${personalWorkspace.name}` }),
    );
    fireEvent.click(screen.getByRole("button", { name: "创建团队" }));
    fireEvent.change(screen.getByLabelText("团队名称"), { target: { value: "社会智能研究组" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并进入" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces", {
        body: { name: "社会智能研究组" },
      });
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces/{workspace_id}/activate", {
        params: { path: { workspace_id: "workspace-created" } },
      });
    });
    expect(await screen.findByRole("heading", { name: "社会智能研究组" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "切换空间，当前为 社会智能研究组" }));
    fireEvent.click(screen.getByRole("button", { name: "使用团队号加入" }));
    fireEvent.change(screen.getByLabelText("团队号"), { target: { value: "stuv23-wxyz45" } });
    fireEvent.click(screen.getByRole("button", { name: "提交加入申请" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces/join", {
        body: { code: "STUV23WXYZ45" },
      });
    });
    expect(await screen.findByRole("heading", { name: "申请已提交" })).toBeVisible();
    expect(screen.getByText("加入的研究团队")).toBeVisible();
    expect(screen.getByText(/团队所有者审核通过后/)).toBeVisible();
  });

  it("有未保存草稿时阻止切换团队空间", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    fireEvent.change(await screen.findByLabelText("Markdown 草稿"), {
      target: { value: "# 还没保存的想法" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: `切换空间，当前为 ${personalWorkspace.name}` }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: teamWorkspace.name }));

    expect(
      await screen.findByText("当前草稿尚未保存，请先保存或点击“新想法”清空草稿"),
    ).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith(
      "/workspaces/{workspace_id}/activate",
      expect.anything(),
    );
  });

  it("桌面侧边栏可以收起为品牌窄栏并恢复", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    const navigation = await screen.findByLabelText("Memora 导航");
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));

    expect(navigation).toHaveClass("is-collapsed");
    expect(window.localStorage.getItem("memora.sidebar.collapsed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "展开侧边栏" }));
    expect(navigation).not.toHaveClass("is-collapsed");
  });

  it("模型菜单可以在 GPT、Claude 和 Gemini 之间切换", async () => {
    mockAuthenticatedSession([]);
    const models: DraftModel[] = [
      { id: "gpt", label: "GPT 5.6", capabilities: ["chat", "tools"], is_default: true },
      {
        id: "claude",
        label: "Claude Sonnet 4.6",
        capabilities: ["chat", "tools"],
        is_default: false,
      },
      {
        id: "gemini",
        label: "Gemini 3.1 Pro",
        capabilities: ["chat", "tools"],
        is_default: false,
      },
    ];
    const baseGet = apiMocks.GET.getMockImplementation();
    apiMocks.GET.mockImplementation((path: string, options?: unknown) =>
      path === "/drafts/models" ? Promise.resolve(ok(models)) : baseGet?.(path, options),
    );

    render(<HomePage />);
    const modelSelect = await screen.findByLabelText("模型");
    expect(screen.getByRole("option", { name: "GPT 5.6" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Claude Sonnet 4.6" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gemini 3.1 Pro" })).toBeInTheDocument();

    fireEvent.change(modelSelect, { target: { value: "claude" } });
    expect(screen.getByRole("heading", { name: "Claude Sonnet 4.6" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("告诉 Memora 你的想法"), {
      target: { value: "整理这条想法" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => {
      expect(apiMocks.STREAM).toHaveBeenCalledWith(
        expect.objectContaining({ model_id: "claude" }),
        expect.any(Function),
      );
    });
  });

  it("桌面分栏可以用拖动和键盘调整宽度", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const separator = await screen.findByRole("separator", { name: "调整记录和草稿宽度" });
    const split = separator.parentElement as HTMLElement;
    vi.spyOn(split, "getBoundingClientRect").mockReturnValue({
      bottom: 720,
      height: 720,
      left: 0,
      right: 1000,
      top: 0,
      width: 1000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(separator, { button: 0, clientX: 580, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 620, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(split.style.getPropertyValue("--split-left")).toBe("62.00%");
    expect(separator).toHaveAttribute("aria-valuenow", "62");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(split.style.getPropertyValue("--split-left")).toBe("58.00%");
    expect(separator).toHaveAttribute("aria-valuenow", "58");

    fireEvent.doubleClick(separator);
    expect(split.style.getPropertyValue("--split-left")).toBe("54.00%");
    expect(separator).toHaveAttribute("aria-valuenow", "54");

    await openLibraryView();
    expect(await screen.findByRole("separator", { name: "调整记忆列表和详情宽度" })).toBeVisible();
  });

  it("聊天输入区可以拖动并用键盘调整高度", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const separator = await screen.findByRole("separator", { name: "调整输入区高度" });
    const panel = separator.parentElement as HTMLElement;

    expect(panel.style.getPropertyValue("--composer-height")).toBe("184px");

    fireEvent.pointerDown(separator, { button: 0, clientY: 520, pointerId: 1 });
    fireEvent.pointerMove(window, { clientY: 460, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(panel.style.getPropertyValue("--composer-height")).toBe("244px");
    expect(separator).toHaveAttribute("aria-valuenow", "244");

    fireEvent.keyDown(separator, { key: "ArrowDown" });
    expect(panel.style.getPropertyValue("--composer-height")).toBe("226px");
    expect(separator).toHaveAttribute("aria-valuenow", "226");
  });

  it("Markdown 编译预览可以调宽、隐藏并渲染 GFM", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const editor = await screen.findByLabelText("Markdown 草稿");
    fireEvent.change(editor, {
      target: {
        value:
          "# 产品方向\n\n- 快速记录\n- 长期可见\n\n| 能力 | 状态 |\n| --- | --- |\n| 预览 | 完成 |",
      },
    });

    expect(screen.getByRole("heading", { name: "产品方向" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "调整 Markdown 编辑和预览宽度" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "隐藏 Markdown 预览" }));
    expect(screen.queryByLabelText("Markdown 预览")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("separator", { name: "调整 Markdown 编辑和预览宽度" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 草稿")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "显示 Markdown 预览" }));
    expect(await screen.findByLabelText("Markdown 预览")).toBeVisible();
  });

  it("工作空间激活失败时停止写入界面，避免保存到错误空间", async () => {
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/auth/me") return Promise.resolve(ok(teamUser));
      if (path === "/workspaces") {
        return Promise.resolve(ok([personalWorkspace, teamWorkspace]));
      }
      return Promise.resolve(missing());
    });
    apiMocks.POST.mockResolvedValue(missing(500));

    render(<HomePage />);

    expect(
      await screen.findByRole("heading", { name: "暂时无法进入工作空间" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/避免把记忆写入错误的个人或团队空间/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown 草稿")).not.toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());
  });

  it("通过对话生成右侧草稿，且只有明确点击后才保存", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "我想先验证个人记录和回顾。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const editor = await screen.findByLabelText("Markdown 草稿");
    await waitFor(() => {
      expect(editor).toHaveValue("# 产品方向\n\n先验证个人记录和回顾。");
    });
    expect(screen.getByText("使用模型：Balanced")).toBeInTheDocument();
    expect(screen.getByText("Markdown 编辑区已同步")).toBeInTheDocument();
    expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
      body: {
        markdown: "",
        model_id: "balanced",
        web_search: "AUTO",
        messages: [{ role: "USER", content: "我想先验证个人记录和回顾。" }],
      },
    });
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "保存为我的记忆" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
        body: { body: "# 产品方向\n\n先验证个人记录和回顾。", visibility: "PRIVATE" },
      });
    });
    expect(await screen.findByText("已保存为仅自己可见的记忆。")).toBeInTheDocument();
  });

  it("团队空间保存前明确选择共享范围，并把共享状态提交给 API", async () => {
    mockAuthenticatedSession([], teamWorkspace.id);

    render(<HomePage />);
    fireEvent.change(await screen.findByLabelText("Markdown 草稿"), {
      target: { value: "# 团队判断\n\n记录共同的产品结论。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "团队共享" }));
    fireEvent.click(screen.getByRole("button", { name: "保存为团队记忆" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
        body: {
          body: "# 团队判断\n\n记录共同的产品结论。",
          visibility: "WORKSPACE",
        },
      });
    });
    expect(
      await screen.findByText(`已共享到 ${teamWorkspace.name} 的团队记忆库。`),
    ).toBeInTheDocument();
  });

  it("团队记忆标注作者，其他成员只能阅读而不能修改或删除", async () => {
    mockAuthenticatedSession([teammateMemory], teamWorkspace.id);

    render(<HomePage />);
    await openLibraryView();
    fireEvent.click(await screen.findByRole("button", { name: /查看记忆：社会世界模型/ }));

    const editor = await screen.findByLabelText("记忆 Markdown");
    expect(editor).toHaveAttribute("readonly");
    expect(screen.getByText(`由 Blair 分享到 ${teamWorkspace.name}`)).toBeInTheDocument();
    expect(screen.getByText("团队共享", { selector: ".memory-card-meta span" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("让 AI 修改这条记忆")).not.toBeInTheDocument();
  });

  it("可以强制本轮联网，把优化后的内容和可点击来源加入右侧", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const mode = await screen.findByRole("combobox", { name: "联网模式" });
    expect(mode).toHaveValue("AUTO");
    fireEvent.change(mode, { target: { value: "REQUIRED" } });
    expect(screen.getByText("发送后恢复自动")).toBeInTheDocument();

    const composer = screen.getByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, {
      target: { value: "检索 OpenAI 的最新模型进展，优化后加入右侧。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
        body: {
          markdown: "",
          model_id: "balanced",
          web_search: "REQUIRED",
          messages: [
            {
              role: "USER",
              content: "检索 OpenAI 的最新模型进展，优化后加入右侧。",
            },
          ],
        },
      });
    });
    expect(
      ((await screen.findByLabelText("Markdown 草稿")) as HTMLTextAreaElement).value,
    ).toContain("## 来源");
    const sources = await screen.findAllByRole("link", { name: /OpenAI 官方/ });
    expect(sources).toHaveLength(2);
    sources.forEach((source) => {
      expect(source).toHaveAttribute("href", "https://openai.com/");
      expect(source).toHaveAttribute("target", "_blank");
    });
    expect(screen.getByText(/已联网 · 1 个来源/)).toBeInTheDocument();
    expect(screen.getByText("联网搜索")).toBeInTheDocument();
    expect(screen.getByText("使用 1 个来源")).toBeInTheDocument();
    expect(mode).toHaveValue("AUTO");
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());
  });

  it("明确要求保存时展示自动保存回执且不再调用手动保存接口", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "我想先验证个人记录和回顾。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("已按你的要求更新右侧草稿。保存前你还可以继续修改。");

    fireEvent.change(composer, { target: { value: "帮我保存这条记忆。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("已保存到我的记忆。")).toBeInTheDocument();
    expect(screen.getByText("已自动保存为我的记忆")).toBeInTheDocument();
    expect(screen.getByText("保存到个人记忆")).toBeInTheDocument();
    expect(screen.getByText("已保存为个人私有记忆。")).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());
  });

  it("连续对话把原话和助手回复一并发送给草稿 Chatbot", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, {
      target: { value: "我们的分工是一骁搭平台，我负责整理数据库。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await screen.findByText("已按你的要求更新右侧草稿。保存前你还可以继续修改。");
    fireEvent.change(composer, { target: { value: "恢复成我的原话，不要改写。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenLastCalledWith("/drafts/chat", {
        body: {
          markdown: "# 产品方向\n\n先验证个人记录和回顾。",
          model_id: "balanced",
          web_search: "AUTO",
          messages: [
            {
              role: "USER",
              content: "我们的分工是一骁搭平台，我负责整理数据库。",
            },
            {
              role: "ASSISTANT",
              content: "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
            },
            { role: "USER", content: "恢复成我的原话，不要改写。" },
          ],
        },
      });
    });
  });

  it("上传图片后可以无文字发送给同一个 Markdown Chatbot", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "截图.png", {
      type: "image/png",
    });
    const imageInput = await screen.findByLabelText("选择图片或 PDF");
    fireEvent.change(imageInput, { target: { files: [file] } });

    expect(await screen.findByRole("button", { name: "移除图片 截图.png" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Markdown 草稿")).toHaveValue(
      "![截图.png](/api/assets/asset-image/content)",
    );
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
        body: {
          markdown: "![截图.png](/api/assets/asset-image/content)",
          model_id: "balanced",
          web_search: "AUTO",
          messages: [
            {
              role: "USER",
              content: "请读取这些图片，提取其中的文字，并整理到右侧 Markdown。",
              images: [
                {
                  name: "截图.png",
                  media_type: "image/png",
                  data: expect.any(String),
                },
              ],
              attachments: [{ asset_id: "asset-image" }],
            },
          ],
        },
      });
    });
    expect(
      screen.getByText("请读取这些图片，提取其中的文字，并整理到右侧 Markdown。"),
    ).toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());

    const composer = screen.getByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "把最后一条改成引用块。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenLastCalledWith("/drafts/chat", {
        body: {
          markdown: "# 产品方向\n\n先验证个人记录和回顾。",
          model_id: "balanced",
          web_search: "AUTO",
          messages: [
            {
              role: "USER",
              content: "请读取这些图片，提取其中的文字，并整理到右侧 Markdown。",
            },
            {
              role: "ASSISTANT",
              content: "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
            },
            { role: "USER", content: "把最后一条改成引用块。" },
          ],
        },
      });
    });
  });

  it("图片上传在前端拒绝不支持的文件类型", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const file = new File(["plain text"], "记录.txt", { type: "text/plain" });
    fireEvent.change(await screen.findByLabelText("选择图片或 PDF"), {
      target: { files: [file] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("只支持 PNG、JPEG、WEBP 图片和 PDF");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("PDF 附件作为本轮上下文发送但不插入 Markdown", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const file = new File(["%PDF-1.4"], "方案.pdf", { type: "application/pdf" });
    fireEvent.change(await screen.findByLabelText("选择图片或 PDF"), {
      target: { files: [file] },
    });

    expect(await screen.findByRole("button", { name: "移除附件 方案.pdf" })).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown 草稿")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
        body: {
          markdown: "",
          model_id: "balanced",
          web_search: "AUTO",
          messages: [
            {
              role: "USER",
              content: "请阅读这些 PDF，把与当前想法相关的内容整理到右侧 Markdown。",
              attachments: [{ asset_id: "asset-pdf" }],
            },
          ],
        },
      });
    });
    expect(screen.getByText("附件已准备")).toBeInTheDocument();
    expect(screen.getByText("1 个 PDF：方案.pdf")).toBeInTheDocument();
    expect(screen.getByText("使用模型：Balanced")).toBeInTheDocument();
  });

  it("Chatbot 回答个人记忆问题时显示可打开的来源", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "我以前记了什么？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("你以前记录过先验证个人记录和回顾。")).toBeInTheDocument();
    const source = screen.getByRole("button", { name: /查看来源：Alex/ });
    expect(source).toHaveTextContent("Alex");
    fireEvent.click(source);

    const editor = await screen.findByLabelText("记忆 Markdown");
    expect(editor).toHaveValue(memory.body);
  });

  it("记忆库按时间选择 Markdown，并提供两种明确保存方式", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);
    await openLibraryView();

    fireEvent.click(await screen.findByRole("button", { name: /查看记忆：产品方向/ }));
    const editor = await screen.findByLabelText("记忆 Markdown");
    expect(editor).toHaveValue(memory.body);
    expect(screen.getByRole("heading", { name: /7月26日/ })).toBeInTheDocument();
    expect(screen.getByText("仅自己可见", { exact: false })).toBeInTheDocument();

    fireEvent.change(editor, {
      target: { value: "# 产品方向\n\n先验证个人记录、回顾和连续使用率。" },
    });
    expect(screen.getByRole("button", { name: "更新当前记忆" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存为新版本" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "更新当前记忆" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/memories/{memory_id}/revisions", {
        params: { path: { memory_id: memory.id } },
        body: {
          body: "# 产品方向\n\n先验证个人记录、回顾和连续使用率。",
          mode: "UPDATE_CURRENT",
        },
      });
    });
    expect(await screen.findByText("已更新当前记忆，旧内容已保留")).toBeInTheDocument();
  });

  it("团队记忆库可以按标题、日期和成员组合检索", async () => {
    mockAuthenticatedSession([memory, teammateMemory], teamWorkspace.id);

    render(<HomePage />);
    await openLibraryView();
    fireEvent.click(await screen.findByRole("button", { name: "检索记忆库" }));
    fireEvent.change(screen.getByLabelText("关键词"), { target: { value: "社会世界" } });
    fireEvent.click(screen.getByRole("button", { name: "仅标题" }));
    fireEvent.change(screen.getByLabelText("开始日期"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText("结束日期"), {
      target: { value: "2026-08-06" },
    });
    fireEvent.change(screen.getByLabelText("团队成员"), {
      target: { value: "user-blair" },
    });
    fireEvent.click(screen.getByRole("button", { name: "检索" }));

    const expectedFrom = new Date("2026-08-01T00:00:00").toISOString();
    const expectedToDate = new Date("2026-08-06T00:00:00");
    expectedToDate.setDate(expectedToDate.getDate() + 1);
    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/search", {
        body: {
          q: "社会世界",
          mode: "KEYWORD",
          field: "TITLE",
          limit: 200,
          created_from: expectedFrom,
          created_to: expectedToDate.toISOString(),
          author_id: "user-blair",
        },
      });
    });
    expect(await screen.findByText("社会世界模型")).toBeInTheDocument();
    expect(screen.queryByText("产品方向")).not.toBeInTheDocument();
  });

  it("记忆详情可让 AI 修改，但仍要求用户选择保存动作", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);
    await openLibraryView();
    fireEvent.click(await screen.findByRole("button", { name: /查看记忆：产品方向/ }));

    const aiInput = await screen.findByLabelText("让 AI 修改这条记忆");
    fireEvent.change(aiInput, { target: { value: "改得更清楚" } });
    fireEvent.click(screen.getByRole("button", { name: "修改草稿" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/refine", {
        body: { markdown: memory.body, instruction: "改得更清楚" },
      });
    });
    expect(screen.getByRole("button", { name: "更新当前记忆" })).toBeDisabled();
  });

  it("在输入框粘贴图片会加入待发送附件", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    const file = new File(["screenshot"], "shot.png", { type: "image/png" });
    fireEvent.paste(composer, { clipboardData: { files: [file] } });

    expect(await screen.findByRole("button", { name: "移除图片 shot.png" })).toBeInTheDocument();
  });

  it("粘贴不支持的文件类型时提示且不加入附件", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    fireEvent.paste(composer, { clipboardData: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("只支持 PNG、JPEG、WEBP 图片和 PDF");
    expect(screen.queryByRole("button", { name: /移除图片/ })).not.toBeInTheDocument();
  });

  it("重新读取记忆时展示骨架占位而不是空白列表", async () => {
    mockAuthenticatedSession();
    const baseGet = apiMocks.GET.getMockImplementation();
    // Let the initial boot load finish, then hold the reload triggered by saving.
    let releaseReload = () => {};
    const heldReload = new Promise<void>((resolve) => {
      releaseReload = resolve;
    });
    let listCalls = 0;
    apiMocks.GET.mockImplementation(async (path: string, options?: unknown) => {
      if (path === "/memories") {
        listCalls += 1;
        if (listCalls > 1) await heldReload;
      }
      return baseGet?.(path, options);
    });

    render(<HomePage />);
    await openLibraryView();

    const editor = await screen.findByLabelText("记忆 Markdown");
    fireEvent.change(editor, { target: { value: "# 产品方向\n\n补充一条。" } });
    fireEvent.click(screen.getByRole("button", { name: "更新当前记忆" }));

    expect(await screen.findByLabelText("正在读取记忆…")).toBeInTheDocument();

    releaseReload();
    await waitFor(() => {
      expect(screen.queryByLabelText("正在读取记忆…")).not.toBeInTheDocument();
    });
  });

  it("个人设置可以更新昵称和头像", async () => {
    mockAuthenticatedSession([]);

    const { container } = render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "打开个人设置" }));

    expect(screen.getByRole("dialog", { name: "个人设置" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "Alex Chen" } });

    const avatarFile = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "me.png", {
      type: "image/png",
    });
    fireEvent.change(screen.getByLabelText("选择头像图片"), {
      target: { files: [avatarFile] },
    });

    const saveButton = screen.getByRole("button", { name: "保存更改" });
    await waitFor(() => {
      expect(container.querySelector(".avatar-preview-wrap img")?.getAttribute("src")).toContain(
        "data:image/png",
      );
      expect(saveButton).toBeEnabled();
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiMocks.PUT).toHaveBeenCalledWith(
        "/auth/avatar",
        expect.objectContaining({
          body: expect.objectContaining({ name: "me.png", media_type: "image/png" }),
        }),
      );
      expect(apiMocks.PATCH).toHaveBeenCalledWith("/auth/profile", {
        body: { display_name: "Alex Chen" },
      });
    });
    expect((await screen.findAllByText("个人资料已更新")).length).toBeGreaterThan(0);
  });

  it("账号安全会校验确认密码并提交密码更新", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "打开个人设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "账号安全" }));

    fireEvent.change(screen.getByLabelText("当前密码"), {
      target: { value: "memora-local-alex" },
    });
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "new-password-2026" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    expect(await screen.findByText("两次输入的新密码不一致。")).toBeInTheDocument();
    expect(apiMocks.PUT).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "new-password-2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));
    await waitFor(() => {
      expect(apiMocks.PUT).toHaveBeenCalledWith("/auth/password", {
        body: {
          current_password: "memora-local-alex",
          new_password: "new-password-2026",
        },
      });
    });
    expect(await screen.findByText("密码已更新，其他设备上的会话已退出")).toBeInTheDocument();
  });

  it("拖入附件时显示投放反馈并加入当前消息", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();
    const conversation = screen.getByLabelText("草稿对话");
    const image = new File([new Uint8Array([137, 80, 78, 71])], "drop.png", {
      type: "image/png",
    });
    const dataTransfer = {
      files: [image],
      types: ["Files"],
      dropEffect: "none",
    };

    fireEvent.dragEnter(conversation, { dataTransfer });
    expect(screen.getByText("放下以加入当前消息")).toBeInTheDocument();
    fireEvent.drop(conversation, { dataTransfer });

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith(
        "/assets",
        expect.objectContaining({
          body: expect.objectContaining({ name: "drop.png", media_type: "image/png" }),
        }),
      );
    });
    expect(screen.queryByText("放下以加入当前消息")).not.toBeInTheDocument();
  });

  it("提示消息会先播放退出动画再移除", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);
    await openCaptureView();
    const editor = await vi.waitFor(() => screen.getByLabelText("Markdown 草稿"));
    fireEvent.change(editor, { target: { value: "# 手动草稿" } });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "保存为我的记忆" }));

      const toast = await vi.waitFor(() => screen.getByText("已保存为私人记忆"));
      expect(toast).not.toHaveClass("is-leaving");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3250);
      });
      expect(screen.getByText("已保存为私人记忆")).toHaveClass("is-leaving");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(screen.queryByText("已保存为私人记忆")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
