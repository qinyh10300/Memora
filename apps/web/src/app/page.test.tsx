import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

const apiMocks = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
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

describe("HomePage identity flow", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
  });

  it("匿名用户看到默认私有的登录入口", async () => {
    apiMocks.GET.mockResolvedValue({ data: undefined });

    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "进入测试工作区" })).toBeInTheDocument();
    expect(screen.getByText(/新记录只对你可见/)).toBeInTheDocument();
    expect(screen.queryByText("memora-local-alex")).not.toBeInTheDocument();
  });

  it("登录成功后展示当前身份和四位工作区成员", async () => {
    apiMocks.GET.mockImplementation((path: string) =>
      Promise.resolve(path === "/auth/me" ? { data: undefined } : { data: members }),
    );
    apiMocks.POST.mockResolvedValue({
      data: alex,
      response: { ok: true, status: 200 },
    });

    render(<HomePage />);
    await screen.findByRole("heading", { name: "进入测试工作区" });

    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "memora-local-alex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录 Memora" }));

    expect(await screen.findByRole("heading", { name: "早上好，Alex。" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("4/4")).toBeInTheDocument());
    expect(screen.getByText("alex@memora.local")).toBeInTheDocument();
  });

  it("已有会话时直接恢复工作区", async () => {
    apiMocks.GET.mockImplementation((path: string) =>
      Promise.resolve(path === "/auth/me" ? { data: alex } : { data: members }),
    );

    render(<HomePage />);

    expect(await screen.findByText("安全会话已建立")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "进入测试工作区" })).not.toBeInTheDocument();
  });
});
