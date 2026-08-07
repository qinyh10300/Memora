import type { components } from "@memora/api-contract";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VisualWorkspace } from "./visual-workspace";

const apiMocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMocks }));

type DraftModel = components["schemas"]["DraftModelResponse"];
type ImageModel = components["schemas"]["ImageModelResponse"];
type VisualProject = components["schemas"]["VisualProjectResponse"];

function ok<T>(data: T, status = 200) {
  return { data, response: { ok: true, status } };
}

const workspace: components["schemas"]["WorkspaceResponse"] = {
  id: "workspace-personal",
  name: "Alex 的个人空间",
  kind: "PERSONAL",
  role: "OWNER",
  is_current: true,
  join_code: null,
};

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

const chatModels: DraftModel[] = [
  {
    id: "gpt-5.6-luna",
    label: "GPT 5.6 Luna",
    description: "快速经济，1M 长上下文",
    min_plan: "PLUS",
    badges: [],
    capabilities: ["chat", "tools"],
    is_default: true,
  },
];

const imageModels: ImageModel[] = [
  {
    id: "gpt-image-2",
    label: "GPT Image 2",
    description: "高质量科研图像",
    min_plan: "PLUS",
    badge: "BEST",
    is_default: true,
    configured: true,
    locked: false,
  },
  {
    id: "nano-banana",
    label: "Nano Banana",
    description: "快速图像生成",
    min_plan: "PLUS",
    badge: null,
    is_default: false,
    configured: true,
    locked: false,
  },
  {
    id: "nano-banana-2",
    label: "Nano Banana 2",
    description: "增强图像生成",
    min_plan: "PRO",
    badge: "NEW",
    is_default: false,
    configured: true,
    locked: true,
  },
  {
    id: "nano-banana-pro",
    label: "Nano Banana Pro",
    description: "旗舰图像生成",
    min_plan: "ULTRA",
    badge: null,
    is_default: false,
    configured: true,
    locked: true,
  },
];

const project: VisualProject = {
  id: "visual-1",
  title: "社会世界模型关系图",
  mode: "IMAGE",
  kind: "SCIENTIFIC",
  visibility: "PRIVATE",
  status: "QUEUED",
  owner_id: "user-alex",
  is_owner: true,
  latest_job: {
    id: "visual-job-1",
    project_id: "visual-1",
    status: "QUEUED",
    stage: "QUEUED",
    progress: 0,
    model_id: "gpt-image-2",
    credit_cost: 360,
    error_code: null,
    created_at: "2026-08-07T08:00:00Z",
    started_at: null,
    completed_at: null,
  },
  versions: [],
  created_at: "2026-08-07T08:00:00Z",
  updated_at: "2026-08-07T08:00:00Z",
};

describe("VisualWorkspace", () => {
  beforeEach(() => {
    apiMocks.GET.mockReset();
    apiMocks.POST.mockReset();
    apiMocks.GET.mockImplementation((path: string) => {
      if (path === "/visuals") return Promise.resolve(ok([]));
      if (path === "/visuals/templates") {
        return Promise.resolve(
          ok([
            {
              id: "scientific-illustration",
              label: "科研图像",
              description: "适合论文概念与机制示意",
              mode: "IMAGE" as const,
              kind: "SCIENTIFIC" as const,
              preview_tone: "blue",
            },
            {
              id: "mind-map",
              label: "思维导图",
              description: "从中心主题展开层级关系",
              mode: "STRUCTURED" as const,
              kind: "MIND_MAP" as const,
              preview_tone: "blue",
            },
          ]),
        );
      }
      if (path === "/visuals/models") return Promise.resolve(ok(imageModels));
      if (path === "/visuals/costs") {
        return Promise.resolve(ok({ structured_visual: 30, "gpt-image-2": 120 }));
      }
      if (path === "/billing/subscription") return Promise.resolve(ok(subscription));
      if (path === "/visual-jobs/{job_id}") return new Promise(() => undefined);
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });
    apiMocks.POST.mockImplementation((path: string) => {
      if (path === "/visuals") {
        return Promise.resolve(ok({ ...project, status: "DRAFT", latest_job: null }, 201));
      }
      if (path === "/visuals/{project_id}/generate") {
        return Promise.resolve(ok({ project, job: project.latest_job, credits_reserved: 360 }));
      }
      return Promise.resolve({ data: undefined, response: { ok: false, status: 404 } });
    });
  });

  it("shows all requested image engines and submits the selected generation preferences", async () => {
    render(
      <VisualWorkspace
        workspace={workspace}
        memories={[]}
        members={[]}
        chatModels={chatModels}
        subscription={subscription}
        onSubscriptionChange={vi.fn()}
        onUpgrade={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: "科研绘图" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "选择绘图引擎" }));
    expect(screen.getByRole("option", { name: /GPT Image 2/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Nano Banana快速图像生成/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Nano Banana 2/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /Nano Banana Pro/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "选择绘图引擎" }));

    fireEvent.click(screen.getByRole("button", { name: "生成偏好" }));
    fireEvent.change(screen.getByLabelText("图片比例"), { target: { value: "16:9" } });
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    fireEvent.change(screen.getByLabelText("输出语言"), { target: { value: "zh-CN" } });
    fireEvent.change(screen.getByLabelText("绘图描述"), {
      target: { value: "社会世界模型的多主体关系科研图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    await waitFor(() => {
      expect(apiMocks.POST).toHaveBeenCalledWith(
        "/visuals/{project_id}/generate",
        expect.objectContaining({
          body: expect.objectContaining({
            model_id: "gpt-image-2",
            aspect_ratio: "16:9",
            count: 3,
            scientific_style: true,
            watermark_mode: "CLEAN_OUTPUT",
            output_language: "zh-CN",
          }),
        }),
      );
    });
  });
});
