import type { components } from "@memora/api-contract";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

type Memory = components["schemas"]["MemoryResponse"];

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

const teamUser = {
  id: "user-alex",
  email: "alex@memora.local",
  display_name: "Alex",
  workspace_id: "workspace-team",
  workspace_name: "Memora 测试工作区",
  role: "OWNER",
};

const personalUser = {
  ...teamUser,
  workspace_id: "workspace-personal",
  workspace_name: "Alex 的个人空间",
};

const personalWorkspace = {
  id: "workspace-personal",
  name: "Alex 的个人空间",
  kind: "PERSONAL",
  role: "OWNER",
  is_current: false,
};

const teamWorkspace = {
  id: "workspace-team",
  name: "Memora 测试工作区",
  kind: "TEAM",
  role: "OWNER",
  is_current: true,
};

const memory: Memory = {
  id: "memory-1",
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

function ok<T>(data: T, status = 200) {
  return { data, response: { ok: true, status } };
}

function missing(status = 404) {
  return { data: undefined, response: { ok: false, status } };
}

function mockAuthenticatedSession(initialMemories: Memory[] = [memory]) {
  let activated = false;
  let currentMemories = [...initialMemories];

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
    if (path === "/memories") return Promise.resolve(ok(currentMemories));
    if (path === "/memories/{memory_id}/revisions") {
      return Promise.resolve(ok(currentMemories.length ? [currentMemories[0]] : []));
    }
    return Promise.resolve(missing());
  });

  apiMocks.POST.mockImplementation((path: string, options?: unknown) => {
    if (path === "/workspaces/{workspace_id}/activate") {
      activated = true;
      return Promise.resolve(ok({ ...personalWorkspace, is_current: true }));
    }
    if (path === "/auth/logout") return Promise.resolve(ok(undefined, 204));
    if (path === "/drafts/chat") {
      const body = (
        options as {
          body: {
            markdown: string;
            web_search: "AUTO" | "REQUIRED" | "DISABLED";
            messages: { role: "USER" | "ASSISTANT"; content: string }[];
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
            citations: [],
            web_search_status: "AVAILABLE",
            web_citations: [{ url: "https://openai.com/", title: "OpenAI 官方" }],
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
          }),
        );
      }
      return Promise.resolve(
        ok({
          markdown: "# 产品方向\n\n先验证个人记录和回顾。",
          assistant_message: "已按你的要求更新右侧草稿。保存前你还可以继续修改。",
          draft_changed: true,
          model_status: "AVAILABLE",
          citations: [],
          web_search_status: "NOT_USED",
          web_citations: [],
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
      currentMemories = [memory, ...currentMemories.filter((item) => item.id !== memory.id)];
      return Promise.resolve(ok(memory, 201));
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
}

describe("Memora personal Markdown MVP", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.DELETE.mockReset();
  });

  it("匿名入口解释个人 Markdown 价值且不暴露本地密码", async () => {
    apiMocks.GET.mockResolvedValue(missing());

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "把想法留下来" })).toBeInTheDocument();
    expect(screen.getByText(/整理成属于你的 Markdown 记忆/)).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("登录后自动进入个人空间并只保留两个主导航", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

    expect(await screen.findByLabelText("Memora 导航")).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/workspaces/{workspace_id}/activate", {
        params: { path: { workspace_id: personalWorkspace.id } },
      });
    });
    expect(screen.getByRole("button", { name: "记录想法" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记忆库" })).toBeInTheDocument();
    expect(screen.getByText("所有新记忆仅你可见")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "团队记忆" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "分析" })).not.toBeInTheDocument();
  });

  it("个人空间激活失败时停止写入界面，避免保存到团队空间", async () => {
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
      await screen.findByRole("heading", { name: "暂时无法进入个人空间" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/避免把个人记忆写入错误的空间/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown 草稿")).not.toBeInTheDocument();
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());
  });

  it("通过对话生成右侧草稿，且只有明确点击后才保存", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "我想先验证个人记录和回顾。" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const editor = await screen.findByLabelText("Markdown 草稿");
    await waitFor(() => {
      expect(editor).toHaveValue("# 产品方向\n\n先验证个人记录和回顾。");
    });
    expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
      body: {
        markdown: "",
        web_search: "AUTO",
        messages: [{ role: "USER", content: "我想先验证个人记录和回顾。" }],
      },
    });
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "保存为我的记忆" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/memories", {
        body: { body: "# 产品方向\n\n先验证个人记录和回顾。" },
      });
    });
    expect(await screen.findByText("已保存到你的个人记忆库。")).toBeInTheDocument();
  });

  it("可以强制本轮联网，把优化后的内容和可点击来源加入右侧", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

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
    const source = await screen.findByRole("link", { name: /OpenAI 官方/ });
    expect(source).toHaveAttribute("href", "https://openai.com/");
    expect(source).toHaveAttribute("target", "_blank");
    expect(screen.getByText(/已联网 · 1 个来源/)).toBeInTheDocument();
    expect(mode).toHaveValue("AUTO");
    expect(apiMocks.POST).not.toHaveBeenCalledWith("/memories", expect.anything());
  });

  it("连续对话把原话和助手回复一并发送给草稿 Chatbot", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

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

    const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "截图.png", {
      type: "image/png",
    });
    const imageInput = await screen.findByLabelText("选择图片");
    fireEvent.change(imageInput, { target: { files: [file] } });

    expect(await screen.findByAltText("截图.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith("/drafts/chat", {
        body: {
          markdown: "",
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

    const file = new File(["plain text"], "记录.txt", { type: "text/plain" });
    fireEvent.change(await screen.findByLabelText("选择图片"), {
      target: { files: [file] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("只支持 PNG、JPEG 和 WEBP 图片");
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  });

  it("Chatbot 回答个人记忆问题时显示可打开的来源", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    fireEvent.change(composer, { target: { value: "我以前记了什么？" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("你以前记录过先验证个人记录和回顾。")).toBeInTheDocument();
    const source = screen.getByRole("button", { name: /来源 1/ });
    expect(source).toHaveTextContent("Alex");
    fireEvent.click(source);

    const editor = await screen.findByLabelText("记忆 Markdown");
    expect(editor).toHaveValue(memory.body);
  });

  it("记忆库按时间选择 Markdown，并提供两种明确保存方式", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "记忆库" }));

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

  it("记忆详情可让 AI 修改，但仍要求用户选择保存动作", async () => {
    mockAuthenticatedSession();

    render(<HomePage />);
    fireEvent.click(await screen.findByRole("button", { name: "记忆库" }));
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

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    const file = new File(["screenshot"], "shot.png", { type: "image/png" });
    fireEvent.paste(composer, { clipboardData: { files: [file] } });

    expect(await screen.findByRole("button", { name: "移除图片 shot.png" })).toBeInTheDocument();
  });

  it("粘贴不支持的文件类型时提示且不加入附件", async () => {
    mockAuthenticatedSession([]);

    render(<HomePage />);

    const composer = await screen.findByLabelText("告诉 Memora 你的想法");
    const file = new File(["notes"], "notes.pdf", { type: "application/pdf" });
    fireEvent.paste(composer, { clipboardData: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("只支持 PNG、JPEG 和 WEBP 图片。");
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
    fireEvent.click(await screen.findByRole("button", { name: "记忆库" }));

    const editor = await screen.findByLabelText("记忆 Markdown");
    fireEvent.change(editor, { target: { value: "# 产品方向\n\n补充一条。" } });
    fireEvent.click(screen.getByRole("button", { name: "更新当前记忆" }));

    expect(await screen.findByLabelText("正在读取记忆…")).toBeInTheDocument();

    releaseReload();
    await waitFor(() => {
      expect(screen.queryByLabelText("正在读取记忆…")).not.toBeInTheDocument();
    });
  });

  it("提示消息会先播放退出动画再移除", async () => {
    vi.useFakeTimers();
    try {
      mockAuthenticatedSession([]);

      render(<HomePage />);

      const editor = await vi.waitFor(() => screen.getByLabelText("Markdown 草稿"));
      fireEvent.change(editor, { target: { value: "# 手动草稿" } });
      fireEvent.click(screen.getByRole("button", { name: "保存为我的记忆" }));

      const toast = await vi.waitFor(() => screen.getByText("已保存为个人记忆"));
      expect(toast).not.toHaveClass("is-leaving");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3250);
      });
      expect(screen.getByText("已保存为个人记忆")).toHaveClass("is-leaving");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(screen.queryByText("已保存为个人记忆")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
